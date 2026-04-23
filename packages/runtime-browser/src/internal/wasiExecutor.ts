import type { ExecutionFailure, ExecutionSuccess } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';

const WASM_PAGE_BYTES = 64 * 1024;

class WasiExit {
  constructor(readonly code: number) {}
}

class OutputLimitExceeded {
  constructor(
    readonly stream: 'stdout' | 'stderr',
    readonly stdout: string,
    readonly stderr: string,
  ) {}
}

class MemoryLimitExceeded {
  constructor(readonly reason: string) {}
}

function buildFailure(
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

function isLikelyMemoryLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('out of memory') ||
    message.includes('memory allocation') ||
    message.includes('insufficient memory') ||
    message.includes('could not allocate memory')
  );
}

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
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const ERRNO_SUCCESS = 0;
  const ERRNO_BADF = 8;
  const ERRNO_NOSYS = 52;

  function withView(): DataView | null {
    if (!memory) return null;
    return new DataView(memory.buffer);
  }

  function withBytes(): Uint8Array | null {
    if (!memory) return null;
    return new Uint8Array(memory.buffer);
  }

  function writeU64(ptr: number, value: bigint): number {
    const view = withView();
    if (!view) return ERRNO_BADF;
    view.setBigUint64(ptr, value, true);
    return ERRNO_SUCCESS;
  }

  let stdinOffset = 0;
  const stdinBytes = new TextEncoder().encode(stdin);

  function ensureMemoryWithinLimit(): void {
    if (!memory) return;
    if (memory.buffer.byteLength > limits.memoryLimitBytes) {
      throw new MemoryLimitExceeded(`Wasm memory exceeded limit (${limits.memoryLimitBytes} bytes)`);
    }
  }

  function currentPagesForLimit(): number {
    return Math.max(1, Math.floor(limits.memoryLimitBytes / WASM_PAGE_BYTES));
  }

  const wasi = {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        exitCode = code;
        throw new WasiExit(code);
      },
      fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) {
        if (fd !== 1 && fd !== 2) return ERRNO_BADF;
        if (!memory) return ERRNO_BADF;

        const target = fd === 1 ? stdoutChunks : stderrChunks;
        const byteLimit = fd === 1 ? policy.stdoutLimitBytes : policy.stderrLimitBytes;
        const view = new DataView(memory.buffer);
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovsPtr + i * 8, true);
          const len = view.getUint32(iovsPtr + i * 8 + 4, true);
          if (len > 0) {
            const chunk = new Uint8Array(memory.buffer.slice(ptr, ptr + len));
            target.push(chunk);
            if (fd === 1) {
              stdoutBytes += chunk.byteLength;
            } else {
              stderrBytes += chunk.byteLength;
            }
            if ((fd === 1 ? stdoutBytes : stderrBytes) > byteLimit) {
              throw new OutputLimitExceeded(fd === 1 ? 'stdout' : 'stderr', decodeUtf8(stdoutChunks), decodeUtf8(stderrChunks));
            }
          }
          total += len;
        }
        view.setUint32(nwrittenPtr, total, true);
        return ERRNO_SUCCESS;
      },
      fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) {
        if (fd !== 0) return ERRNO_BADF;
        if (!memory) return ERRNO_BADF;

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
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      fd_close() { return ERRNO_SUCCESS; },
      fd_seek(_fd: number, _offset: bigint, _whence: number, newOffsetPtr: number) {
        ensureMemoryWithinLimit();
        return writeU64(newOffsetPtr, 0n);
      },
      fd_fdstat_get(_fd: number, statPtr: number) {
        const view = withView();
        if (!view) return ERRNO_BADF;
        view.setUint8(statPtr, 0);
        view.setUint16(statPtr + 2, 0, true);
        view.setUint16(statPtr + 4, 0, true);
        view.setBigUint64(statPtr + 8, 0n, true);
        view.setBigUint64(statPtr + 16, 0n, true);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      fd_filestat_get(_fd: number, filestatPtr: number) {
        const view = withView();
        if (!view) return ERRNO_BADF;
        for (let offset = 0; offset < 64; offset += 8) {
          view.setBigUint64(filestatPtr + offset, 0n, true);
        }
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      fd_prestat_get() { return ERRNO_BADF; },
      fd_prestat_dir_name() { return ERRNO_BADF; },
      fd_pread() { return ERRNO_NOSYS; },
      fd_readdir() { return ERRNO_NOSYS; },
      poll_oneoff(_subscriptionsPtr: number, _eventsPtr: number, _subscriptionCount: number, eventCountPtr: number) {
        const view = withView();
        if (!view) return ERRNO_BADF;
        view.setUint32(eventCountPtr, 0, true);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      random_get(bufPtr: number, bufLen: number) {
        const bytes = withBytes();
        if (!bytes) return ERRNO_BADF;
        const randomBytes = new Uint8Array(new ArrayBuffer(bufLen)) as Uint8Array<ArrayBuffer>;
        crypto.getRandomValues(randomBytes);
        bytes.set(randomBytes, bufPtr);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      clock_time_get(_clockId: number, _precision: bigint, timePtr: number) {
        ensureMemoryWithinLimit();
        return writeU64(timePtr, BigInt(Date.now()) * 1_000_000n);
      },
      path_open() { return ERRNO_NOSYS; },
      path_filestat_get() { return ERRNO_NOSYS; },
      path_create_directory() { return ERRNO_NOSYS; },
      path_link() { return ERRNO_NOSYS; },
      path_readlink() { return ERRNO_NOSYS; },
      path_remove_directory() { return ERRNO_NOSYS; },
      path_rename() { return ERRNO_NOSYS; },
      path_symlink() { return ERRNO_NOSYS; },
      path_unlink_file() { return ERRNO_NOSYS; },
      environ_sizes_get(pc: number, pb: number) {
        if (!memory) return ERRNO_BADF;
        const view = new DataView(memory.buffer);
        view.setUint32(pc, 0, true);
        view.setUint32(pb, 0, true);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      environ_get() { return ERRNO_SUCCESS; },
      args_get() { return ERRNO_SUCCESS; },
      args_sizes_get(pc: number, pb: number) {
        if (!memory) return ERRNO_BADF;
        const view = new DataView(memory.buffer);
        view.setUint32(pc, 0, true);
        view.setUint32(pb, 0, true);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
    },
  };

  try {
    const bytes = new Uint8Array(new ArrayBuffer(wasmBinary.byteLength)) as Uint8Array<ArrayBuffer>;
    bytes.set(wasmBinary);
    let module: WebAssembly.Module;
    try {
      module = await WebAssembly.compile(bytes);
    } catch (error) {
      return buildFailure(
        'internal_error',
        error instanceof Error ? error.message : String(error),
        Math.round(performance.now() - start),
        { reason: 'Failed to compile execution artifact' },
      );
    }

    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(module, wasi);
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - start);
      if (isLikelyMemoryLimitError(error)) {
        return buildFailure('memory_limit_exceeded', error instanceof Error ? error.message : String(error), elapsedMs, {
          reason: 'Failed to instantiate wasm within memory limit',
        });
      }
      return buildFailure(
        'internal_error',
        error instanceof Error ? error.message : String(error),
        elapsedMs,
        { reason: 'Failed to instantiate execution artifact' },
      );
    }
    const exportedMemory = instance.exports.memory;
    memory = exportedMemory instanceof WebAssembly.Memory ? exportedMemory : undefined;
    if (memory && memory.buffer.byteLength > limits.memoryLimitBytes) {
      return buildFailure(
        'memory_limit_exceeded',
        `Wasm memory exceeded limit (${limits.memoryLimitBytes} bytes)`,
        Math.round(performance.now() - start),
        {
          memoryBytes: memory.buffer.byteLength,
          reason: `Execution memory exceeds limit of ${currentPagesForLimit()} wasm pages`,
        },
      );
    }

    const startFn = instance.exports._start;
    if (typeof startFn !== 'function') {
      return buildFailure('runtime_error', 'no _start export', Math.round(performance.now() - start));
    }

    try {
      startFn();
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - start);
      if (error instanceof OutputLimitExceeded) {
        return {
          success: false,
          status: 'output_limit_exceeded',
          stdout: error.stdout,
          stderr: error.stderr,
          exitCode: null,
          elapsedMs,
          reason: `${error.stream} exceeded configured output limit`,
        };
      }
      if (error instanceof MemoryLimitExceeded) {
      return {
        success: false,
        status: 'memory_limit_exceeded',
        stdout: decodeUtf8(stdoutChunks),
        stderr: decodeUtf8(stderrChunks),
        exitCode: null,
        elapsedMs,
        reason: error.reason,
      };
      }
      if (!(error instanceof WasiExit)) {
        if (isLikelyMemoryLimitError(error)) {
          return {
            success: false,
            status: 'memory_limit_exceeded',
            stdout: decodeUtf8(stdoutChunks),
            stderr: decodeUtf8(stderrChunks),
            exitCode: null,
            elapsedMs,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        return {
          success: false,
          status: 'runtime_error',
          stdout: decodeUtf8(stdoutChunks),
          stderr: String(error),
          exitCode: null,
          elapsedMs,
        };
      }
    }

    const elapsedMs = Math.round(performance.now() - start);
    const stdout = decodeUtf8(stdoutChunks);
    const stderr = decodeUtf8(stderrChunks);
    if (memory && memory.buffer.byteLength > limits.memoryLimitBytes) {
      return {
        success: false,
        status: 'memory_limit_exceeded',
        stdout,
        stderr,
        exitCode: null,
        elapsedMs,
        reason: `Wasm memory exceeded limit (${limits.memoryLimitBytes} bytes)`,
        memoryBytes: memory.buffer.byteLength,
      };
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
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - start);
    if (isLikelyMemoryLimitError(error)) {
      const extras: Partial<ExecutionFailure> = {
        reason: error instanceof Error ? error.message : String(error),
      };
      if (memory?.buffer.byteLength !== undefined) {
        extras.memoryBytes = memory.buffer.byteLength;
      }
      return buildFailure('memory_limit_exceeded', String(error), elapsedMs, extras);
    }
    return buildFailure('internal_error', String(error), elapsedMs, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
