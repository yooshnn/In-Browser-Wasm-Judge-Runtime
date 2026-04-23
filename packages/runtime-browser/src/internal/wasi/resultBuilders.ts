import type { ExecutionFailure } from '@cupya.me/wasm-judge-runtime-core';
import type { OutputSnapshot } from './outputCollector.js';

export function buildFailure(
  status: ExecutionFailure['status'],
  stderr: string,
  elapsedMs: number,
  extras?: Partial<ExecutionFailure>,
): ExecutionFailure {
  return {
    success: false,
    status,
    stdout: '',
    stderr,
    exitCode: null,
    elapsedMs,
    ...extras,
  };
}

export function buildExecutionFailure(
  status: ExecutionFailure['status'],
  output: OutputSnapshot,
  elapsedMs: number,
  extras?: Partial<ExecutionFailure>,
): ExecutionFailure {
  return {
    success: false,
    status,
    stdout: output.stdout,
    stderr: output.stderr,
    exitCode: null,
    elapsedMs,
    ...extras,
  };
}
