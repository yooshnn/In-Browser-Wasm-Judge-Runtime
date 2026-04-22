import type { ExecutionFailure, ExecutionSuccess } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';

function decodeUtf8(chunks: Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);

  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

export async function executeWasm(
  wasmBinary: Uint8Array,
  stdin: string,
  limits: ExecutionLimits,
  policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>,
): Promise<ExecutionSuccess | ExecutionFailure> {
  const start = performance.now();
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  let memory: WebAssembly.Memory | undefined;
  let exitCode = 0;

  class WasiExit {
    constructor(readonly code: number) {}
  }

  let stdinOffset = 0;
  const stdinBytes = new TextEncoder().encode(stdin);

  const wasi = {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        exitCode = code;
        throw new WasiExit(code);
      },
      fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) {
        if (fd !== 1 && fd !== 2) return 8; // ERRNO_BADF
        if (!memory) return 8;

        const target = fd === 1 ? stdoutChunks : stderrChunks;
        const view = new DataView(memory.buffer);
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovsPtr + i * 8, true);
          const len = view.getUint32(iovsPtr + i * 8 + 4, true);
          if (len > 0) {
            target.push(new Uint8Array(memory.buffer.slice(ptr, ptr + len)));
          }
          total += len;
        }
        view.setUint32(nwrittenPtr, total, true);
        return 0;
      },
      fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) {
        if (fd !== 0) return 8; // ERRNO_BADF (only support stdin)
        if (!memory) return 8;

        const view = new DataView(memory.buffer);
        let totalRead = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovsPtr + i * 8, true);
          const len = view.getUint32(iovsPtr + i * 8 + 4, true);
          const toRead = Math.min(len, stdinBytes.length - stdinOffset);
          if (toRead <= 0) break;
          new Uint8Array(memory.buffer).set(stdinBytes.subarray(stdinOffset, stdinOffset + toRead), ptr);
          stdinOffset += toRead;
          totalRead += toRead;
        }
        view.setUint32(nreadPtr, totalRead, true);
        return 0;
      },
      fd_close() { return 0; },
      fd_seek() { return 0; },
      fd_fdstat_get() { return 0; },
      environ_get() { return 0; },
      environ_sizes_get(pc: number, pb: number) {
        if (!memory) return 8;
        const view = new DataView(memory.buffer);
        view.setUint32(pc, 0, true);
        view.setUint32(pb, 0, true);
        return 0;
      },
      args_get() { return 0; },
      args_sizes_get(pc: number, pb: number) {
        if (!memory) return 8;
        const view = new DataView(memory.buffer);
        view.setUint32(pc, 0, true);
        view.setUint32(pb, 0, true);
        return 0;
      },
    },
  };

  try {
    const bytes = new Uint8Array(wasmBinary); // ensures ArrayBuffer backing, not SharedArrayBuffer
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, wasi);
    const exportedMemory = instance.exports.memory;
    memory = exportedMemory instanceof WebAssembly.Memory ? exportedMemory : undefined;

    const startFn = instance.exports._start;
    if (typeof startFn !== 'function') {
      return {
        success: false,
        status: 'runtime_error',
        stdout: '',
        stderr: 'no _start export',
        exitCode: null,
        elapsedMs: Math.round(performance.now() - start),
      };
    }

    try {
      startFn();
    } catch (error) {
      if (!(error instanceof WasiExit)) {
        return {
          success: false,
          status: 'runtime_error',
          stdout: decodeUtf8(stdoutChunks),
          stderr: String(error),
          exitCode: null,
          elapsedMs: Math.round(performance.now() - start),
        };
      }
    }

    const elapsedMs = Math.round(performance.now() - start);
    const stdout = decodeUtf8(stdoutChunks);
    const stderr = decodeUtf8(stderrChunks);

    // Post-hoc TLE judgment: Phase 1 constraint
    if (elapsedMs > limits.timeLimitMs) {
      return {
        success: false,
        status: 'time_limit_exceeded',
        stdout: '',
        stderr: '',
        exitCode: null,
        elapsedMs,
      };
    }

    if (exitCode === 0) {
      return {
        success: true,
        stdout,
        stderr,
        exitCode: 0,
        elapsedMs,
      };
    }

    return {
      success: false,
      status: 'runtime_error',
      stdout,
      stderr,
      exitCode,
      elapsedMs,
    };
  } catch (error) {
    return {
      success: false,
      status: 'runtime_error',
      stdout: '',
      stderr: String(error),
      exitCode: null,
      elapsedMs: Math.round(performance.now() - start),
    };
  }
}
