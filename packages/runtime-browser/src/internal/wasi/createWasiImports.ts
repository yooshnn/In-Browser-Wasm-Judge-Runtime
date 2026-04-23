import type { ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';
import { MemoryLimitExceeded, WasiExit } from './errors.js';
import type { OutputCollector } from './outputCollector.js';

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_NOSYS = 52;
const WASM_PAGE_BYTES = 64 * 1024;

export type WasiExecutionState = {
  memory: WebAssembly.Memory | undefined;
  exitCode: number;
};

type CreateWasiImportsOptions = {
  stdin: string;
  limits: ExecutionLimits;
  policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>;
  output: OutputCollector;
  state: WasiExecutionState;
};

export function wasmPagesForBytes(byteLimit: number): number {
  return Math.max(1, Math.floor(byteLimit / WASM_PAGE_BYTES));
}

export function createWasiImports({
  stdin,
  limits,
  policy,
  output,
  state,
}: CreateWasiImportsOptions): WebAssembly.Imports {
  let stdinOffset = 0;
  const stdinBytes = new TextEncoder().encode(stdin);

  function memory(): WebAssembly.Memory | undefined {
    return state.memory;
  }

  function withView(): DataView | null {
    const currentMemory = memory();
    if (!currentMemory) return null;
    return new DataView(currentMemory.buffer);
  }

  function withBytes(): Uint8Array | null {
    const currentMemory = memory();
    if (!currentMemory) return null;
    return new Uint8Array(currentMemory.buffer);
  }

  function ensureMemoryWithinLimit(): void {
    const currentMemory = memory();
    if (!currentMemory) return;
    if (currentMemory.buffer.byteLength > limits.memoryLimitBytes) {
      throw new MemoryLimitExceeded(`Wasm memory exceeded limit (${limits.memoryLimitBytes} bytes)`);
    }
  }

  function writeU64(ptr: number, value: bigint): number {
    const view = withView();
    if (!view) return ERRNO_BADF;
    view.setBigUint64(ptr, value, true);
    return ERRNO_SUCCESS;
  }

  return {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        state.exitCode = code;
        throw new WasiExit(code);
      },
      fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) {
        if (fd !== 1 && fd !== 2) return ERRNO_BADF;
        const currentMemory = memory();
        if (!currentMemory) return ERRNO_BADF;

        const stream = fd === 1 ? 'stdout' : 'stderr';
        const byteLimit = fd === 1 ? policy.stdoutLimitBytes : policy.stderrLimitBytes;
        const view = new DataView(currentMemory.buffer);
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovsPtr + i * 8, true);
          const len = view.getUint32(iovsPtr + i * 8 + 4, true);
          if (len > 0) {
            const chunk = new Uint8Array(currentMemory.buffer.slice(ptr, ptr + len));
            output.write(stream, chunk, byteLimit);
          }
          total += len;
        }
        view.setUint32(nwrittenPtr, total, true);
        return ERRNO_SUCCESS;
      },
      fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) {
        if (fd !== 0) return ERRNO_BADF;
        const currentMemory = memory();
        if (!currentMemory) return ERRNO_BADF;

        const view = new DataView(currentMemory.buffer);
        let totalRead = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovsPtr + i * 8, true);
          const len = view.getUint32(iovsPtr + i * 8 + 4, true);
          const toRead = Math.min(len, stdinBytes.length - stdinOffset);
          if (toRead <= 0) break;
          new Uint8Array(currentMemory.buffer).set(stdinBytes.subarray(stdinOffset, stdinOffset + toRead), ptr);
          stdinOffset += toRead;
          totalRead += toRead;
        }
        view.setUint32(nreadPtr, totalRead, true);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      fd_close() {
        return ERRNO_SUCCESS;
      },
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
      fd_prestat_get() {
        return ERRNO_BADF;
      },
      fd_prestat_dir_name() {
        return ERRNO_BADF;
      },
      fd_pread() {
        return ERRNO_NOSYS;
      },
      fd_readdir() {
        return ERRNO_NOSYS;
      },
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
      path_open() {
        return ERRNO_NOSYS;
      },
      path_filestat_get() {
        return ERRNO_NOSYS;
      },
      path_create_directory() {
        return ERRNO_NOSYS;
      },
      path_link() {
        return ERRNO_NOSYS;
      },
      path_readlink() {
        return ERRNO_NOSYS;
      },
      path_remove_directory() {
        return ERRNO_NOSYS;
      },
      path_rename() {
        return ERRNO_NOSYS;
      },
      path_symlink() {
        return ERRNO_NOSYS;
      },
      path_unlink_file() {
        return ERRNO_NOSYS;
      },
      environ_sizes_get(pc: number, pb: number) {
        const currentMemory = memory();
        if (!currentMemory) return ERRNO_BADF;
        const view = new DataView(currentMemory.buffer);
        view.setUint32(pc, 0, true);
        view.setUint32(pb, 0, true);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
      environ_get() {
        return ERRNO_SUCCESS;
      },
      args_get() {
        return ERRNO_SUCCESS;
      },
      args_sizes_get(pc: number, pb: number) {
        const currentMemory = memory();
        if (!currentMemory) return ERRNO_BADF;
        const view = new DataView(currentMemory.buffer);
        view.setUint32(pc, 0, true);
        view.setUint32(pb, 0, true);
        ensureMemoryWithinLimit();
        return ERRNO_SUCCESS;
      },
    },
  };
}
