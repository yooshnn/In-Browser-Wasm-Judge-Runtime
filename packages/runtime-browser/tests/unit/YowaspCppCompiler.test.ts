import { describe, expect, it, vi } from 'vitest';
import {
  YowaspCppCompiler,
  buildYowaspClangInvocation,
  buildYowaspLdInvocation,
} from '../../src/internal/yowasp/YowaspCppCompiler.js';
import type { SysrootEntry } from '../../src/internal/toolchain/loadSysrootArchive.js';
import type { YowaspTree } from '../../src/internal/yowasp/loadVendoredYowaspClang.js';

const sysrootEntries: SysrootEntry[] = [
  { path: '/include/wasm32-wasi/c++/v1/iostream', data: new Uint8Array([1]) },
  { path: '/include/wasm32-wasi/stdio.h', data: new Uint8Array([1]) },
  { path: '/lib/wasm32-wasi/crt1.o', data: new Uint8Array([1]) },
  { path: '/lib/wasm32-wasi/libc.a', data: new Uint8Array([1]) },
  { path: '/lib/wasm32-wasi/libc++.a', data: new Uint8Array([1]) },
  { path: '/lib/wasm32-wasi/libc++abi.a', data: new Uint8Array([1]) },
  { path: '/lib/clang/22/include/stddef.h', data: new Uint8Array([1]) },
  { path: '/lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a', data: new Uint8Array([1]) },
];

describe('buildYowaspClangInvocation', () => {
  it('preserves the existing clang policy while using clang++ driver', () => {
    expect(buildYowaspClangInvocation('/work/source.cpp', '/work/source.o', ['-Wall'], sysrootEntries)).toEqual([
      'clang++',
      '--target=wasm32-wasi',
      '--sysroot=/sysroot',
      '-resource-dir', '/sysroot/lib/clang/22',
      '-isystem', '/sysroot/include/wasm32-wasi/c++/v1',
      '-isystem', '/sysroot/include/wasm32-wasi',
      '-std=c++17',
      '-fno-finite-loops',
      '-x', 'c++',
      '-c', '/work/source.cpp',
      '-o', '/work/source.o',
      '-O1',
      '-fno-exceptions',
      '-Wall',
    ]);
  });
});

describe('buildYowaspLdInvocation', () => {
  it('preserves the explicit linker policy and builtins archive', () => {
    expect(buildYowaspLdInvocation('/work/source.o', '/work/output.wasm', sysrootEntries)).toEqual([
      'wasm-ld',
      '/work/source.o',
      '/sysroot/lib/wasm32-wasi/crt1.o',
      '/sysroot/lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a',
      '-L/sysroot/lib/wasm32-wasi',
      '-lc',
      '-lc++',
      '-lc++abi',
      '-o', '/work/output.wasm',
    ]);
  });
});

describe('YowaspCppCompiler', () => {
  it('pipes clang output into wasm-ld and returns the linked wasm', async () => {
    const runClang = vi.fn(async (_args: string[], files?: YowaspTree) => {
      const next = structuredClone(files ?? {});
      (next.work as YowaspTree)['source.o'] = new Uint8Array([1, 2, 3]);
      return next;
    });
    const runLLVM = vi.fn(async (_args: string[], files?: YowaspTree) => {
      const next = structuredClone(files ?? {});
      (next.work as YowaspTree)['output.wasm'] = new Uint8Array([9, 8, 7]);
      return next;
    });

    const compiler = new YowaspCppCompiler({ runClang, runLLVM }, sysrootEntries);
    const result = await compiler.compile('int main() { return 0; }', ['-Wall']);

    expect(result.status).toBe('ok');
    expect(Array.from(result.wasmBinary ?? [])).toEqual([9, 8, 7]);
    expect(runClang).toHaveBeenCalledOnce();
    expect(runLLVM).toHaveBeenCalledOnce();
  });
});
