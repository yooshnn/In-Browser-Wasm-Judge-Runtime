import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { CompileSuccess, CompileFailure, ExecutionSuccess } from '@cupya.me/wasm-judge-runtime-core';
import { BrowserCompilerPort } from '../../src/adapters/compiler/BrowserCompilerPort.js';
import { BrowserExecutorPort } from '../../src/adapters/executor/BrowserExecutorPort.js';

let worker: Worker;
let compiler: BrowserCompilerPort;
let executor: BrowserExecutorPort;

beforeAll(() => {
  worker = new Worker(new URL('../../src/worker/runtimeWorker.ts', import.meta.url), { type: 'module' });
  compiler = new BrowserCompilerPort(worker);
  executor = new BrowserExecutorPort(worker);
});

afterAll(() => {
  worker.terminate();
});

describe('compile-execute integration', () => {
  // [완료 조건 1] compile success — artifact.id 반환 확인
  it('compile success: returns artifact id', async () => {
    const result = await compiler.compile(
      'cpp',
      { sourceCode: '#include <iostream>\nint main() { return 0; }' },
      { flags: [] },
    );

    expect(result.success).toBe(true);
    const success = result as CompileSuccess;
    expect(typeof success.artifact.id).toBe('string');
    expect(success.artifact.id.length).toBeGreaterThan(0);
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
          '#include <iostream>',
          '#include <string>',
          'int main() {',
          '  std::string line;',
          '  std::getline(std::cin, line);',
          '  std::cout << line << std::endl;',
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
  });

  // [권장] stdout/stderr 분리 검증
  it('execute: stdout and stderr are separated', async () => {
    const compileResult = await compiler.compile(
      'cpp',
      {
        sourceCode: [
          '#include <iostream>',
          'int main() {',
          '  std::cerr << "err";',
          '  std::cout << "out";',
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
});
