import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createCheckerRunner,
  judge,
  type CompileFailure,
  type CompileSuccess,
  type ExecutionFailure,
  type ExecutionLimits,
  type ExecutionSuccess,
  type JudgePolicy,
  type JudgeRequest,
} from '@cupya.me/wasm-judge-runtime-core';
import { BrowserCompilerPort } from '../../src/adapters/compiler/BrowserCompilerPort.js';
import { BrowserExecutorPort } from '../../src/adapters/executor/BrowserExecutorPort.js';

let worker: Worker;
let compiler: BrowserCompilerPort;
let executor: BrowserExecutorPort;

beforeAll(() => {
  worker = new Worker(new URL('../../src/worker/runtimeWorker.ts', import.meta.url), { type: 'module' });
  compiler = new BrowserCompilerPort(worker);
  executor = new BrowserExecutorPort();
});

afterAll(() => {
  worker.terminate();
});

const DEFAULT_LIMITS: ExecutionLimits = {
  timeLimitMs: 5000,
  memoryLimitBytes: 256 * 1024 * 1024,
};

const DEFAULT_OUTPUT_POLICY: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'> = {
  stdoutLimitBytes: 1024 * 1024,
  stderrLimitBytes: 1024 * 1024,
};

function cpp(lines: string[]): string {
  return lines.join('\n');
}

async function compileArtifact(sourceCode: string): Promise<CompileSuccess['artifact']> {
  const compileResult = await compiler.compile('cpp', { sourceCode }, { flags: [] });
  expect(compileResult.success).toBe(true);
  return (compileResult as CompileSuccess).artifact;
}

async function executeSource(
  sourceCode: string,
  stdin = '',
  limits = DEFAULT_LIMITS,
  policy = DEFAULT_OUTPUT_POLICY,
) {
  const artifact = await compileArtifact(sourceCode);
  return executor.execute(artifact, stdin, limits, policy);
}

function judgeRequest(
  sourceCode: string,
  overrides: Partial<JudgeRequest> = {},
): JudgeRequest {
  return {
    language: 'cpp',
    submission: { sourceCode },
    compile: { flags: [] },
    policy: {
      stopOnFirstFailure: false,
      stdoutLimitBytes: 1024 * 1024,
      stderrLimitBytes: 1024 * 1024,
    },
    problem: {
      id: 'browser-policy',
      tests: [
        { id: 't1', stdin: '', expected: 'ok\n' },
      ],
      limits: DEFAULT_LIMITS,
      checker: {
        kind: 'exact',
        ignoreTrailingWhitespace: false,
      },
    },
    ...overrides,
  };
}

describe('compile-execute integration', () => {
  it('compile success: returns a serializable wasm payload artifact', async () => {
    const result = await compiler.compile(
      'cpp',
      { sourceCode: '#include <iostream>\nint main() { return 0; }' },
      { flags: [] },
    );

    expect(result.success).toBe(true);
    const success = result as CompileSuccess;
    expect(success.artifact.wasmBinary).toBeInstanceOf(Uint8Array);
    expect(success.artifact.wasmBinary.byteLength).toBeGreaterThan(0);
  });

  // [완료 조건 2] compile failure — errors 필드 확인
  it('compile failure: returns errors on invalid code', async () => {
    const result = await compiler.compile(
      'cpp',
      { sourceCode: 'this is not valid c++ code' },
      { flags: [] },
    );

    expect(result.success).toBe(false);
    const failure = result as CompileFailure;
    expect(Array.isArray(failure.errors)).toBe(true);
    expect(failure.errors.length).toBeGreaterThan(0);
  });

  // [완료 조건 3] execute success with stdin → stdout
  it('execute: stdin is echoed to stdout', async () => {
    const compileResult = await compiler.compile(
      'cpp',
      {
        sourceCode: [
          '#include <cstdio>',
          'int main() {',
          '  char buf[1024];',
          '  if (fgets(buf, sizeof(buf), stdin)) printf("%s", buf);',
          '  return 0;',
          '}',
        ].join('\n'),
      },
      { flags: [] },
    );

    expect(compileResult.success).toBe(true);
    const { artifact } = compileResult as CompileSuccess;

    const execResult = await executor.execute(
      artifact,
      'abc\n',
      { timeLimitMs: 5000, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(execResult.success).toBe(true);
    const success = execResult as ExecutionSuccess;
    expect(success.stdout).toBe('abc\n');

    const secondExecResult = await executor.execute(
      artifact,
      'def\n',
      { timeLimitMs: 5000, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(secondExecResult.success).toBe(true);
    expect((secondExecResult as ExecutionSuccess).stdout).toBe('def\n');
  });

  // [권장] stdout/stderr 분리 검증
  it('execute: stdout and stderr are separated', async () => {
    const compileResult = await compiler.compile(
      'cpp',
      {
        sourceCode: [
          '#include <cstdio>',
          'int main() {',
          '  fprintf(stderr, "err");',
          '  printf("out");',
          '  return 0;',
          '}',
        ].join('\n'),
      },
      { flags: [] },
    );

    expect(compileResult.success).toBe(true);
    const { artifact } = compileResult as CompileSuccess;

    const execResult = await executor.execute(
      artifact,
      '',
      { timeLimitMs: 5000, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(execResult.success).toBe(true);
    const success = execResult as ExecutionSuccess;
    expect(success.stdout).toBe('out');
    expect(success.stderr).toBe('err');
  });

  it('execute: std::getline path links and echoes stdin', async () => {
    const compileResult = await compiler.compile(
      'cpp',
      {
        sourceCode: [
          '#include <iostream>',
          '#include <string>',
          'int main() {',
          '  std::string line;',
          '  if (std::getline(std::cin, line)) {',
          '    std::cout << line << "\\n";',
          '  }',
          '  return 0;',
          '}',
        ].join('\n'),
      },
      { flags: [] },
    );

    expect(compileResult.success).toBe(true);
    const { artifact } = compileResult as CompileSuccess;

    const execResult = await executor.execute(
      artifact,
      'stl-input',
      { timeLimitMs: 5000, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(execResult.success).toBe(true);
    const success = execResult as ExecutionSuccess;
    expect(success.stdout).toBe('stl-input\n');
  });

  it('execute: infinite loop is terminated as time_limit_exceeded', async () => {
    const compileResult = await compiler.compile(
      'cpp',
      {
        sourceCode: [
          'int main() {',
          '  while (true) {}',
          '}',
        ].join('\n'),
      },
      { flags: [] },
    );

    expect(compileResult.success).toBe(true);
    const { artifact } = compileResult as CompileSuccess;

    const execResult = await executor.execute(
      artifact,
      '',
      { timeLimitMs: 50, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(execResult.success).toBe(false);
    const failure = execResult as ExecutionFailure;
    expect(failure.status).toBe('time_limit_exceeded');
  });

  it('execute: timeout termination does not poison the next testcase worker', async () => {
    const infiniteArtifact = await compileArtifact(cpp([
      'int main() {',
      '  while (true) {}',
      '}',
    ]));
    const echoArtifact = await compileArtifact(cpp([
      '#include <cstdio>',
      'int main() {',
      '  char buf[32];',
      '  if (fgets(buf, sizeof(buf), stdin)) printf("%s", buf);',
      '  return 0;',
      '}',
    ]));

    const timedOut = await executor.execute(
      infiniteArtifact,
      '',
      { timeLimitMs: 50, memoryLimitBytes: 256 * 1024 * 1024 },
      DEFAULT_OUTPUT_POLICY,
    );
    expect(timedOut.success).toBe(false);
    expect((timedOut as ExecutionFailure).status).toBe('time_limit_exceeded');

    const recovered = await executor.execute(echoArtifact, 'recovered\n', DEFAULT_LIMITS, DEFAULT_OUTPUT_POLICY);
    expect(recovered.success).toBe(true);
    expect((recovered as ExecutionSuccess).stdout).toBe('recovered\n');
  });

  it('execute: non-zero exit is classified as runtime_error', async () => {
    const execResult = await executeSource('int main() { return 42; }');

    expect(execResult.success).toBe(false);
    const failure = execResult as ExecutionFailure;
    expect(failure.status).toBe('runtime_error');
    expect(failure.exitCode).toBe(42);
  });

  it('execute: stdout overflow returns output_limit_exceeded', async () => {
    const compileResult = await compiler.compile(
      'cpp',
      {
        sourceCode: [
          '#include <cstdio>',
          'int main() {',
          '  for (int i = 0; i < 512; i++) putchar(\'a\');',
          '  return 0;',
          '}',
        ].join('\n'),
      },
      { flags: [] },
    );

    expect(compileResult.success).toBe(true);
    const { artifact } = compileResult as CompileSuccess;

    const execResult = await executor.execute(
      artifact,
      '',
      { timeLimitMs: 5000, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 128, stderrLimitBytes: 1024 },
    );

    expect(execResult.success).toBe(false);
    const failure = execResult as ExecutionFailure;
    expect(failure.status).toBe('output_limit_exceeded');
    expect(failure.stdout.length).toBeGreaterThan(128);
  });

  it('execute: stderr overflow returns output_limit_exceeded without truncating collected output', async () => {
    const execResult = await executeSource(
      cpp([
        '#include <cstdio>',
        'int main() {',
        '  for (int i = 0; i < 512; i++) fputc(\'e\', stderr);',
        '  return 0;',
        '}',
      ]),
      '',
      DEFAULT_LIMITS,
      { stdoutLimitBytes: 1024, stderrLimitBytes: 128 },
    );

    expect(execResult.success).toBe(false);
    const failure = execResult as ExecutionFailure;
    expect(failure.status).toBe('output_limit_exceeded');
    expect(failure.stderr.length).toBeGreaterThan(128);
  });

  it('execute: large allocation is classified as memory_limit_exceeded', async () => {
    const compileResult = await compiler.compile(
      'cpp',
      {
        sourceCode: [
          '#include <cstdlib>',
          '#include <cstdio>',
          'int main() {',
          '  const size_t n = 8 * 1024 * 1024;',
          '  char* p = static_cast<char*>(std::malloc(n));',
          '  if (!p) return 1;',
          '  for (size_t i = 0; i < n; i++) p[i] = static_cast<char>(i);',
          '  puts("allocated");',
          '  std::free(p);',
          '  return 0;',
          '}',
        ].join('\n'),
      },
      { flags: [] },
    );

    expect(compileResult.success).toBe(true);
    const { artifact } = compileResult as CompileSuccess;

    const baseline = await executor.execute(
      artifact,
      '',
      { timeLimitMs: 5000, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(baseline.success).toBe(true);
    const observedMemory = (baseline as ExecutionSuccess).memoryBytes;
    expect(typeof observedMemory).toBe('number');

    const execResult = await executor.execute(
      artifact,
      '',
      { timeLimitMs: 5000, memoryLimitBytes: Math.max(64 * 1024, (observedMemory as number) - 64 * 1024) },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(execResult.success).toBe(false);
    const failure = execResult as ExecutionFailure;
    expect(failure.status).toBe('memory_limit_exceeded');
  });

  it('execute: memory_limit_exceeded does not poison the next testcase worker', async () => {
    const artifact = await compileArtifact('int main() { return 0; }');

    const exceeded = await executor.execute(
      artifact,
      '',
      { timeLimitMs: 5000, memoryLimitBytes: 64 * 1024 },
      DEFAULT_OUTPUT_POLICY,
    );
    expect(exceeded.success).toBe(false);
    expect((exceeded as ExecutionFailure).status).toBe('memory_limit_exceeded');

    const recovered = await executor.execute(artifact, '', DEFAULT_LIMITS, DEFAULT_OUTPUT_POLICY);
    expect(recovered.success).toBe(true);
    expect((recovered as ExecutionSuccess).exitCode).toBe(0);
  });

  it('execute: invalid artifact is normalized to internal_error', async () => {
    const execResult = await executor.execute(
      { wasmBinary: new Uint8Array([1, 2, 3, 4]) },
      '',
      { timeLimitMs: 5000, memoryLimitBytes: 256 * 1024 * 1024 },
      { stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    );

    expect(execResult.success).toBe(false);
    const failure = execResult as ExecutionFailure;
    expect(failure.status).toBe('internal_error');
  });

  it('judge: browser ports produce accepted exact results', async () => {
    const result = await judge(
      judgeRequest(cpp([
        '#include <cstdio>',
        'int main() {',
        '  puts("ok");',
        '  return 0;',
        '}',
      ])),
      { compiler, executor, checker: createCheckerRunner({}) },
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(true);
    expect(result.summary.status).toBe('accepted');
    expect(result.tests[0]?.status).toBe('accepted');
  });

  it.each([
    {
      status: 'runtime_error',
      sourceCode: 'int main() { return 42; }',
      limits: DEFAULT_LIMITS,
      policy: { stopOnFirstFailure: false, stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    },
    {
      status: 'time_limit_exceeded',
      sourceCode: cpp(['int main() {', '  while (true) {}', '}']),
      limits: { timeLimitMs: 50, memoryLimitBytes: 256 * 1024 * 1024 },
      policy: { stopOnFirstFailure: false, stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    },
    {
      status: 'memory_limit_exceeded',
      sourceCode: 'int main() { return 0; }',
      limits: { timeLimitMs: 5000, memoryLimitBytes: 64 * 1024 },
      policy: { stopOnFirstFailure: false, stdoutLimitBytes: 1024 * 1024, stderrLimitBytes: 1024 * 1024 },
    },
    {
      status: 'output_limit_exceeded',
      sourceCode: cpp([
        '#include <cstdio>',
        'int main() {',
        '  for (int i = 0; i < 512; i++) putchar(\'a\');',
        '  return 0;',
        '}',
      ]),
      limits: DEFAULT_LIMITS,
      policy: { stopOnFirstFailure: false, stdoutLimitBytes: 128, stderrLimitBytes: 1024 * 1024 },
    },
  ] as const)('judge: browser ports propagate $status into JudgeResult summary', async ({ status, sourceCode, limits, policy }) => {
    const result = await judge(
      judgeRequest(sourceCode, {
        policy,
        problem: {
          id: `browser-${status}`,
          tests: [
            { id: 't1', stdin: '', expected: 'ok\n' },
          ],
          limits,
          checker: {
            kind: 'exact',
            ignoreTrailingWhitespace: false,
          },
        },
      }),
      { compiler, executor, checker: createCheckerRunner({}) },
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(false);
    expect(result.summary.status).toBe(status);
    expect(result.tests[0]?.status).toBe(status);
  });

  it('judge: stopOnFirstFailure stops after the first browser execution failure', async () => {
    const result = await judge(
      judgeRequest('int main() { return 42; }', {
        policy: {
          stopOnFirstFailure: true,
          stdoutLimitBytes: 1024 * 1024,
          stderrLimitBytes: 1024 * 1024,
        },
        problem: {
          id: 'browser-stop-first',
          tests: [
            { id: 't1', stdin: '', expected: 'ok\n' },
            { id: 't2', stdin: '', expected: 'ok\n' },
          ],
          limits: DEFAULT_LIMITS,
          checker: {
            kind: 'exact',
            ignoreTrailingWhitespace: false,
          },
        },
      }),
      { compiler, executor, checker: createCheckerRunner({}) },
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.summary.status).toBe('runtime_error');
    expect(result.summary.total).toBe(1);
    expect(result.tests).toHaveLength(1);
  });
});
