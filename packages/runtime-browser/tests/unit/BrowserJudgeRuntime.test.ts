import { describe, expect, it, vi } from 'vitest';
import type {
  CompileSuccess,
  ExecutionResult,
  JudgeApplicationPorts,
  JudgeRequest,
  RuntimeHealth,
} from '@cupya.me/wasm-judge-runtime-core';
import { createCheckerRunner } from '@cupya.me/wasm-judge-runtime-core';
import { BrowserJudgeRuntime, JUDGE_RUNTIME_TERMINATED_MESSAGE } from '../../src/runtime/BrowserJudgeRuntime.js';

const artifact = { wasmBinary: new Uint8Array([0, 1, 2, 3]) };

function compileSuccess(): CompileSuccess {
  return {
    success: true,
    stdout: '',
    stderr: '',
    warnings: [],
    artifact,
    elapsedMs: 1,
  };
}

function request(): JudgeRequest {
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
      id: 'terminate',
      tests: [{ id: 't1', stdin: '', expected: 'ok\n' }],
      limits: {
        timeLimitMs: 1000,
        memoryLimitBytes: 64 * 1024 * 1024,
      },
      checker: { kind: 'exact', ignoreTrailingWhitespace: false },
    },
  };
}

function health(): RuntimeHealth {
  return {
    ready: true,
    version: 'test',
    capabilities: {
      languages: ['cpp'],
      stdioJudge: true,
      jsChecker: true,
    },
    artifacts: {
      compilerLoaded: true,
      sysrootLoaded: true,
    },
  };
}

describe('BrowserJudgeRuntime', () => {
  it('terminate() immediately rejects an in-flight judge while compile is pending', async () => {
    const compile = new Promise<CompileSuccess>(() => {});
    const onTerminate = vi.fn();
    const ports: JudgeApplicationPorts = {
      compiler: { compile: vi.fn(async () => compile) },
      executor: { execute: vi.fn() },
      checker: createCheckerRunner({}),
    };
    const runtime = new BrowserJudgeRuntime(ports, async () => health(), onTerminate);

    const inFlight = runtime.judge(request());
    await Promise.resolve();

    runtime.terminate();

    await expect(inFlight).rejects.toThrow(JUDGE_RUNTIME_TERMINATED_MESSAGE);
    expect(onTerminate).toHaveBeenCalledTimes(1);
    expect(ports.executor.execute).not.toHaveBeenCalled();
  });

  it('terminate() immediately rejects an in-flight judge and calls cleanup once', async () => {
    let resolveExecution: ((result: ExecutionResult) => void) | null = null;
    const execution = new Promise<ExecutionResult>((resolve) => {
      resolveExecution = resolve;
    });
    const onTerminate = vi.fn();
    const ports: JudgeApplicationPorts = {
      compiler: { compile: vi.fn(async () => compileSuccess()) },
      executor: { execute: vi.fn(async () => execution) },
      checker: createCheckerRunner({}),
    };
    const runtime = new BrowserJudgeRuntime(ports, async () => health(), onTerminate);

    const inFlight = runtime.judge(request());
    await Promise.resolve();

    runtime.terminate();
    runtime.terminate();

    await expect(inFlight).rejects.toThrow(JUDGE_RUNTIME_TERMINATED_MESSAGE);
    expect(onTerminate).toHaveBeenCalledTimes(1);

    resolveExecution?.({
      success: true,
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      elapsedMs: 1,
    });
  });
});
