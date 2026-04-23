import type { ExecutionFailure, ExecutionSuccess } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';
import { createWasiImports, wasmPagesForBytes, type WasiExecutionState } from './wasi/createWasiImports.js';
import {
  errorMessage,
  isLikelyMemoryLimitError,
  MemoryLimitExceeded,
  OutputLimitExceeded,
  WasiExit,
} from './wasi/errors.js';
import { OutputCollector } from './wasi/outputCollector.js';
import { buildExecutionFailure, buildFailure } from './wasi/resultBuilders.js';

export async function executeWasm(
  wasmBinary: Uint8Array,
  stdin: string,
  limits: ExecutionLimits,
  policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>,
): Promise<ExecutionSuccess | ExecutionFailure> {
  const start = performance.now();
  const output = new OutputCollector();
  const state: WasiExecutionState = { memory: undefined, exitCode: 0 };
  const wasi = createWasiImports({ stdin, limits, policy, output, state });

  try {
    const module = await compileExecutionArtifact(wasmBinary, start);
    if (!module.success) return module.failure;

    const instance = await instantiateExecutionArtifact(module.value, wasi, start);
    if (!instance.success) return instance.failure;

    state.memory = exportedMemoryOf(instance.value);
    const initialMemoryFailure = validateInitialMemory(state.memory, limits, start);
    if (initialMemoryFailure) return initialMemoryFailure;

    const startFn = instance.value.exports._start;
    if (typeof startFn !== 'function') {
      return buildFailure('runtime_error', 'no _start export', Math.round(performance.now() - start));
    }

    const runtimeFailure = runStart(startFn, output, start);
    if (runtimeFailure) return runtimeFailure;

    return buildFinalResult(state, output, limits, start);
  } catch (error) {
    return normalizeUnexpectedError(error, state.memory, start);
  }
}

async function compileExecutionArtifact(
  wasmBinary: Uint8Array,
  start: number,
): Promise<{ success: true; value: WebAssembly.Module } | { success: false; failure: ExecutionFailure }> {
  const bytes = new Uint8Array(new ArrayBuffer(wasmBinary.byteLength)) as Uint8Array<ArrayBuffer>;
  bytes.set(wasmBinary);

  try {
    return { success: true, value: await WebAssembly.compile(bytes) };
  } catch (error) {
    return {
      success: false,
      failure: buildFailure('internal_error', errorMessage(error), Math.round(performance.now() - start), {
        reason: 'Failed to compile execution artifact',
      }),
    };
  }
}

async function instantiateExecutionArtifact(
  module: WebAssembly.Module,
  imports: WebAssembly.Imports,
  start: number,
): Promise<{ success: true; value: WebAssembly.Instance } | { success: false; failure: ExecutionFailure }> {
  try {
    return { success: true, value: await WebAssembly.instantiate(module, imports) };
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - start);
    if (isLikelyMemoryLimitError(error)) {
      return {
        success: false,
        failure: buildFailure('memory_limit_exceeded', errorMessage(error), elapsedMs, {
          reason: 'Failed to instantiate wasm within memory limit',
        }),
      };
    }

    return {
      success: false,
      failure: buildFailure('internal_error', errorMessage(error), elapsedMs, {
        reason: 'Failed to instantiate execution artifact',
      }),
    };
  }
}

function exportedMemoryOf(instance: WebAssembly.Instance): WebAssembly.Memory | undefined {
  const exportedMemory = instance.exports.memory;
  return exportedMemory instanceof WebAssembly.Memory ? exportedMemory : undefined;
}

function validateInitialMemory(
  memory: WebAssembly.Memory | undefined,
  limits: ExecutionLimits,
  start: number,
): ExecutionFailure | null {
  if (!memory || memory.buffer.byteLength <= limits.memoryLimitBytes) return null;

  return buildFailure(
    'memory_limit_exceeded',
    `Wasm memory exceeded limit (${limits.memoryLimitBytes} bytes)`,
    Math.round(performance.now() - start),
    {
      memoryBytes: memory.buffer.byteLength,
      reason: `Execution memory exceeds limit of ${wasmPagesForBytes(limits.memoryLimitBytes)} wasm pages`,
    },
  );
}

function runStart(
  startFn: CallableFunction,
  output: OutputCollector,
  start: number,
): ExecutionFailure | null {
  try {
    startFn();
    return null;
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - start);
    if (error instanceof OutputLimitExceeded) {
      return buildExecutionFailure(
        'output_limit_exceeded',
        { stdout: error.stdout, stderr: error.stderr },
        elapsedMs,
        { reason: `${error.stream} exceeded configured output limit` },
      );
    }

    if (error instanceof MemoryLimitExceeded) {
      return buildExecutionFailure('memory_limit_exceeded', output.snapshot(), elapsedMs, {
        reason: error.reason,
      });
    }

    if (error instanceof WasiExit) {
      return null;
    }

    if (isLikelyMemoryLimitError(error)) {
      return buildExecutionFailure('memory_limit_exceeded', output.snapshot(), elapsedMs, {
        reason: errorMessage(error),
      });
    }

    return buildExecutionFailure('runtime_error', output.snapshot(), elapsedMs, {
      stderr: errorMessage(error),
    });
  }
}

function buildFinalResult(
  state: WasiExecutionState,
  output: OutputCollector,
  limits: ExecutionLimits,
  start: number,
): ExecutionSuccess | ExecutionFailure {
  const elapsedMs = Math.round(performance.now() - start);
  const { stdout, stderr } = output.snapshot();
  const { memory, exitCode } = state;

  if (memory && memory.buffer.byteLength > limits.memoryLimitBytes) {
    return buildExecutionFailure(
      'memory_limit_exceeded',
      { stdout, stderr },
      elapsedMs,
      {
        reason: `Wasm memory exceeded limit (${limits.memoryLimitBytes} bytes)`,
        memoryBytes: memory.buffer.byteLength,
      },
    );
  }

  if (exitCode === 0) {
    const success: ExecutionSuccess = {
      success: true,
      stdout,
      stderr,
      exitCode: 0,
      elapsedMs,
    };
    if (memory?.buffer.byteLength !== undefined) {
      success.memoryBytes = memory.buffer.byteLength;
    }
    return success;
  }

  const runtimeFailure: ExecutionFailure = {
    success: false,
    status: 'runtime_error',
    stdout,
    stderr,
    exitCode,
    elapsedMs,
  };
  if (memory?.buffer.byteLength !== undefined) {
    runtimeFailure.memoryBytes = memory.buffer.byteLength;
  }
  return runtimeFailure;
}

function normalizeUnexpectedError(
  error: unknown,
  memory: WebAssembly.Memory | undefined,
  start: number,
): ExecutionFailure {
  const elapsedMs = Math.round(performance.now() - start);
  if (isLikelyMemoryLimitError(error)) {
    const extras: Partial<ExecutionFailure> = {
      reason: errorMessage(error),
    };
    if (memory?.buffer.byteLength !== undefined) {
      extras.memoryBytes = memory.buffer.byteLength;
    }
    return buildFailure('memory_limit_exceeded', errorMessage(error), elapsedMs, extras);
  }

  return buildFailure('internal_error', errorMessage(error), elapsedMs, {
    reason: errorMessage(error),
  });
}
