import { describe, expect, it, vi } from 'vitest';
import type {
  CheckerFunction,
  CheckerRunnerPort,
  CompileFailure,
  CompileSuccess,
  ExecutionFailure,
  ExecutionResult,
  JudgeApplicationPorts,
  JudgeRequest,
} from '../../src/index.js';
import { createCheckerRunner, judge } from '../../src/index.js';

const artifact = { wasmBinary: new Uint8Array([0, 1, 2, 3]) };

function compileSuccess(): CompileSuccess {
  return {
    success: true,
    stdout: '',
    stderr: '',
    warnings: [],
    artifact,
    elapsedMs: 5,
  };
}

function compileFailure(): CompileFailure {
  return {
    success: false,
    stdout: '',
    stderr: 'compile failed',
    errors: ['compile failed'],
    elapsedMs: 7,
  };
}

function executionSuccess(stdout: string, elapsedMs = 10, memoryBytes?: number): ExecutionResult {
  return {
    success: true,
    stdout,
    stderr: '',
    exitCode: 0,
    elapsedMs,
    ...(memoryBytes === undefined ? {} : { memoryBytes }),
  };
}

function executionFailure(status: ExecutionFailure['status']): ExecutionFailure {
  return {
    success: false,
    status,
    stdout: 'partial',
    stderr: 'failed',
    exitCode: status === 'runtime_error' ? 1 : null,
    elapsedMs: 12,
    memoryBytes: 128,
    reason: `${status} reason`,
  };
}

function request(overrides: Partial<JudgeRequest> = {}): JudgeRequest {
  return {
    language: 'cpp',
    submission: { sourceCode: 'int main() { return 0; }' },
    compile: { flags: [] },
    policy: {
      stopOnFirstFailure: false,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
    },
    problem: {
      id: 'p1',
      limits: {
        timeLimitMs: 1000,
        memoryLimitBytes: 64 * 1024 * 1024,
      },
      checker: {
        kind: 'exact',
        ignoreTrailingWhitespace: false,
      },
      tests: [
        { id: 't1', stdin: 'in', expected: 'ok\n' },
      ],
    },
    ...overrides,
  };
}

function customCheckerRequest(checkerId = 'token'): JudgeRequest {
  const base = request();
  return request({
    problem: {
      ...base.problem,
      checker: {
        kind: 'custom',
        checkerId,
      },
    },
  });
}

function ports(options: {
  compile?: CompileSuccess | CompileFailure;
  executions?: ExecutionResult[];
  checker?: CheckerRunnerPort;
} = {}): JudgeApplicationPorts & {
  compileMock: ReturnType<typeof vi.fn>;
  executeMock: ReturnType<typeof vi.fn>;
  checkerMock: ReturnType<typeof vi.fn>;
} {
  const compileMock = vi.fn(async () => options.compile ?? compileSuccess());
  const executeMock = vi.fn(async () => {
    const next = options.executions?.shift();
    return next ?? executionSuccess('ok\n');
  });
  const checkerMock = vi.fn(async () => ({ status: 'internal_error' as const }));

  return {
    compiler: { compile: compileMock },
    executor: { execute: executeMock },
    checker: options.checker ?? { run: checkerMock },
    compileMock,
    executeMock,
    checkerMock,
  };
}

describe('judge application', () => {
  it('returns compile phase result and does not execute when compilation fails', async () => {
    const appPorts = ports({ compile: compileFailure() });

    const result = await judge(request(), appPorts);

    expect(result).toMatchObject({
      phase: 'compile',
      ok: false,
      compile: {
        success: false,
        errors: ['compile failed'],
      },
    });
    expect(appPorts.executeMock).not.toHaveBeenCalled();
    expect(appPorts.checkerMock).not.toHaveBeenCalled();
  });

  it('returns accepted JudgeResult for exact checker success', async () => {
    const result = await judge(request(), ports({ executions: [executionSuccess('ok\n', 11, 256)] }));

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(true);
    expect(result.tests).toEqual([
      {
        id: 't1',
        status: 'accepted',
        elapsedMs: 11,
        memoryBytes: 256,
        stdout: 'ok\n',
        stderr: '',
        exitCode: 0,
      },
    ]);
    expect(result.summary).toMatchObject({
      status: 'accepted',
      passed: 1,
      failed: 0,
      total: 1,
      totalElapsedMs: 11,
      maxTestElapsedMs: 11,
      slowestTestId: 't1',
      memoryBytes: 256,
    });
  });

  it('returns wrong_answer for exact checker mismatch', async () => {
    const result = await judge(request(), ports({ executions: [executionSuccess('nope\n')] }));

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(false);
    expect(result.tests[0]?.status).toBe('wrong_answer');
    expect(result.summary.status).toBe('wrong_answer');
  });

  it('applies line trailing whitespace normalization when exact checker requests it', async () => {
    const normalizedRequest = request({
      problem: {
        ...request().problem,
        checker: {
          kind: 'exact',
          ignoreTrailingWhitespace: true,
        },
        tests: [
          { id: 't1', stdin: '', expected: 'a\nb\n' },
        ],
      },
    });

    const accepted = await judge(
      normalizedRequest,
      ports({ executions: [executionSuccess('a   \nb\t')] }),
    );
    const rejected = await judge(
      request({
        problem: {
          ...normalizedRequest.problem,
          checker: {
            kind: 'exact',
            ignoreTrailingWhitespace: false,
          },
        },
      }),
      ports({ executions: [executionSuccess('a   \nb\t')] }),
    );

    expect(accepted.phase).toBe('finished');
    if (accepted.phase !== 'finished') throw new Error('expected finished result');
    expect(accepted.tests[0]?.status).toBe('accepted');
    expect(rejected.phase).toBe('finished');
    if (rejected.phase !== 'finished') throw new Error('expected finished result');
    expect(rejected.tests[0]?.status).toBe('wrong_answer');
  });

  it.each([
    'runtime_error',
    'time_limit_exceeded',
    'memory_limit_exceeded',
    'output_limit_exceeded',
    'internal_error',
  ] as const)('converts %s execution failure without calling checker', async (status) => {
    const appPorts = ports({ executions: [executionFailure(status)] });

    const result = await judge(request(), appPorts);

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests[0]).toMatchObject({
      id: 't1',
      status,
      elapsedMs: 12,
      memoryBytes: 128,
      message: `${status} reason`,
      stdout: 'partial',
      stderr: 'failed',
    });
    expect(result.summary.status).toBe(status);
    expect(appPorts.checkerMock).not.toHaveBeenCalled();
  });

  it('stops after the first failure when stopOnFirstFailure is true', async () => {
    const appPorts = ports({
      executions: [
        executionSuccess('bad\n'),
        executionSuccess('ok\n'),
      ],
    });

    const result = await judge(
      request({
        policy: {
          stopOnFirstFailure: true,
          stdoutLimitBytes: 1024,
          stderrLimitBytes: 1024,
        },
        problem: {
          ...request().problem,
          tests: [
            { id: 't1', stdin: '', expected: 'ok\n' },
            { id: 't2', stdin: '', expected: 'ok\n' },
          ],
        },
      }),
      appPorts,
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests).toHaveLength(1);
    expect(result.summary.total).toBe(1);
    expect(appPorts.executeMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    'runtime_error',
    'time_limit_exceeded',
    'memory_limit_exceeded',
    'output_limit_exceeded',
    'internal_error',
  ] as const)('stops after %s when stopOnFirstFailure is true', async (status) => {
    const appPorts = ports({
      executions: [
        executionFailure(status),
        executionSuccess('ok\n'),
      ],
    });

    const result = await judge(
      request({
        policy: {
          stopOnFirstFailure: true,
          stdoutLimitBytes: 1024,
          stderrLimitBytes: 1024,
        },
        problem: {
          ...request().problem,
          tests: [
            { id: 't1', stdin: '', expected: 'ok\n' },
            { id: 't2', stdin: '', expected: 'ok\n' },
          ],
        },
      }),
      appPorts,
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests).toHaveLength(1);
    expect(result.summary.status).toBe(status);
    expect(appPorts.executeMock).toHaveBeenCalledTimes(1);
    expect(appPorts.checkerMock).not.toHaveBeenCalled();
  });

  it('continues after failures when stopOnFirstFailure is false', async () => {
    const appPorts = ports({
      executions: [
        executionSuccess('bad\n'),
        executionSuccess('ok\n'),
      ],
    });

    const result = await judge(
      request({
        problem: {
          ...request().problem,
          tests: [
            { id: 't1', stdin: '', expected: 'ok\n' },
            { id: 't2', stdin: '', expected: 'ok\n' },
          ],
        },
      }),
      appPorts,
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests.map((test) => test.status)).toEqual(['wrong_answer', 'accepted']);
    expect(result.summary).toMatchObject({
      status: 'wrong_answer',
      passed: 1,
      failed: 1,
      total: 2,
      totalElapsedMs: 20,
      maxTestElapsedMs: 10,
    });
    expect(appPorts.executeMock).toHaveBeenCalledTimes(2);
  });

  it('returns accepted JudgeResult for custom checker success', async () => {
    const tokenChecker = vi.fn<CheckerFunction>(async ({ execution }) => (
      execution.stdout === 'custom-ok\n'
        ? { status: 'accepted' }
        : { status: 'wrong_answer' }
    ));

    const result = await judge(
      customCheckerRequest('token'),
      ports({
        executions: [executionSuccess('custom-ok\n')],
        checker: createCheckerRunner({ token: tokenChecker }),
      }),
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(true);
    expect(result.tests[0]).toMatchObject({
      status: 'accepted',
      stdout: 'custom-ok\n',
    });
    expect(result.summary.status).toBe('accepted');
    expect(tokenChecker).toHaveBeenCalledTimes(1);
    expect(tokenChecker.mock.calls[0]?.[0]).toMatchObject({
      testCase: { id: 't1' },
      execution: { success: true, stdout: 'custom-ok\n' },
    });
  });

  it('propagates custom checker wrong_answer messages into JudgeTestResult', async () => {
    const result = await judge(
      customCheckerRequest('token'),
      ports({
        executions: [executionSuccess('bad\n')],
        checker: createCheckerRunner({
          token: async () => ({
            status: 'wrong_answer',
            message: 'token mismatch',
          }),
        }),
      }),
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(false);
    expect(result.tests[0]).toMatchObject({
      status: 'wrong_answer',
      message: 'token mismatch',
    });
    expect(result.summary.status).toBe('wrong_answer');
  });

  it('propagates custom checker internal_error outcomes into summary', async () => {
    const result = await judge(
      customCheckerRequest('token'),
      ports({
        executions: [executionSuccess('ok\n')],
        checker: createCheckerRunner({
          token: async () => ({
            status: 'internal_error',
            message: 'checker failed',
          }),
        }),
      }),
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests[0]).toMatchObject({
      status: 'internal_error',
      message: 'checker failed',
    });
    expect(result.summary.status).toBe('internal_error');
  });

  it('returns internal_error when custom checker id is not registered', async () => {
    const result = await judge(
      customCheckerRequest('missing'),
      ports({
        executions: [executionSuccess('ok\n')],
        checker: createCheckerRunner({}),
      }),
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests[0]).toMatchObject({
      status: 'internal_error',
      message: 'custom checker is not registered: missing',
    });
  });

  it.each([
    ['throw', () => {
      throw new Error('checker exploded');
    }],
    ['reject', async () => {
      throw new Error('checker rejected');
    }],
  ] satisfies Array<[string, CheckerFunction]>)('normalizes custom checker %s to internal_error', async (_caseName, checker) => {
    const result = await judge(
      customCheckerRequest('token'),
      ports({
        executions: [executionSuccess('ok\n')],
        checker: createCheckerRunner({ token: checker }),
      }),
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests[0]?.status).toBe('internal_error');
    expect(result.tests[0]?.message).toContain('checker');
  });

  it('does not call custom checker when execution fails', async () => {
    const tokenChecker = vi.fn<CheckerFunction>(async () => ({ status: 'accepted' }));
    const result = await judge(
      customCheckerRequest('token'),
      ports({
        executions: [executionFailure('runtime_error')],
        checker: createCheckerRunner({ token: tokenChecker }),
      }),
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.tests[0]?.status).toBe('runtime_error');
    expect(tokenChecker).not.toHaveBeenCalled();
  });

  it('handles empty test lists as accepted with an empty result set', async () => {
    const appPorts = ports();

    const result = await judge(
      request({
        problem: {
          ...request().problem,
          tests: [],
        },
      }),
      appPorts,
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(true);
    expect(result.tests).toEqual([]);
    expect(result.summary).toEqual({
      status: 'accepted',
      passed: 0,
      failed: 0,
      total: 0,
      totalElapsedMs: 0,
      maxTestElapsedMs: 0,
    });
    expect(appPorts.executeMock).not.toHaveBeenCalled();
  });
});
