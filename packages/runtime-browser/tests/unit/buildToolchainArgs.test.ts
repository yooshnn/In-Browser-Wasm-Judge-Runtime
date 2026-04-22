import { describe, expect, it } from 'vitest';
import { buildClangArgs, buildLdArgs } from '../../src/internal/toolchain/buildToolchainArgs.js';
import type { ToolchainLayout } from '../../src/internal/toolchain/resolveToolchainLayout.js';

const layout: ToolchainLayout = {
  target: 'wasm32-wasi',
  resourceDir: '/sysroot/lib/clang/22',
  cxxIncludeDir: '/sysroot/include/wasm32-wasi/c++/v1',
  sysIncludeDir: '/sysroot/include/wasm32-wasi',
  crt1Path: '/sysroot/lib/wasm32-wasi/crt1.o',
  libDir: '/sysroot/lib/wasm32-wasi',
  builtinsPath: '/sysroot/lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a',
};

describe('buildToolchainArgs', () => {
  it('builds clang args from resolved toolchain layout', () => {
    expect(buildClangArgs(layout, '/work/source.cpp', '/work/source.o', ['-std=c++20'])).toEqual([
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
      '-std=c++20',
    ]);
  });

  it('builds ld args including compiler-rt builtins', () => {
    expect(buildLdArgs(layout, '/work/source.o', '/work/output.wasm')).toEqual([
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
