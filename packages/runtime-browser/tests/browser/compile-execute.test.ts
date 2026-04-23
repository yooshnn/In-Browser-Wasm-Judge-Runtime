import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { CompileSuccess, CompileFailure, ExecutionFailure, ExecutionSuccess } from '@cupya.me/wasm-judge-runtime-core';
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
});
