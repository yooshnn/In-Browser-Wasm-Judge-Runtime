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
  const ERRNO_SUCCESS = 0;
  const ERRNO_BADF = 8;
  const ERRNO_NOSYS = 52;

  class WasiExit {
    constructor(readonly code: number) {}
  }

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
        return ERRNO_SUCCESS;
      },
      fd_close() { return ERRNO_SUCCESS; },
      fd_seek(_fd: number, _offset: bigint, _whence: number, newOffsetPtr: number) {
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
        return ERRNO_SUCCESS;
      },
      fd_filestat_get(_fd: number, filestatPtr: number) {
        const view = withView();
        if (!view) return ERRNO_BADF;
        for (let offset = 0; offset < 64; offset += 8) {
          view.setBigUint64(filestatPtr + offset, 0n, true);
        }
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
        return ERRNO_SUCCESS;
      },
      random_get(bufPtr: number, bufLen: number) {
        const bytes = withBytes();
        if (!bytes) return ERRNO_BADF;
        const randomBytes = new Uint8Array(new ArrayBuffer(bufLen)) as Uint8Array<ArrayBuffer>;
        crypto.getRandomValues(randomBytes);
        bytes.set(randomBytes, bufPtr);
        return ERRNO_SUCCESS;
      },
      clock_time_get(_clockId: number, _precision: bigint, timePtr: number) {
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
        return ERRNO_SUCCESS;
      },
      environ_get() { return ERRNO_SUCCESS; },
      args_get() { return ERRNO_SUCCESS; },
      args_sizes_get(pc: number, pb: number) {
        if (!memory) return ERRNO_BADF;
        const view = new DataView(memory.buffer);
        view.setUint32(pc, 0, true);
        view.setUint32(pb, 0, true);
        return ERRNO_SUCCESS;
      },
    },
  };

  try {
    const bytes = new Uint8Array(new ArrayBuffer(wasmBinary.byteLength)) as Uint8Array<ArrayBuffer>;
    bytes.set(wasmBinary);
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
