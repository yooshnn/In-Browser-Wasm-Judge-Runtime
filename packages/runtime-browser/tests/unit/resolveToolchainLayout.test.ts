import { describe, expect, it } from 'vitest';
import { resolveToolchainLayout, type SysrootEntryPath } from '../../src/internal/toolchain/resolveToolchainLayout.js';

function entry(path: string): SysrootEntryPath {
  return { path };
}

describe('resolveToolchainLayout', () => {
  it('resolves current wasi-sdk-32 layout for wasm32-wasi compilation', () => {
    const layout = resolveToolchainLayout([
      entry('/include/wasm32-wasi/c++/v1/iostream'),
      entry('/include/wasm32-wasi/stdio.h'),
      entry('/lib/clang/22/include/stddef.h'),
      entry('/lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a'),
      entry('/lib/wasm32-wasi/crt1.o'),
      entry('/lib/wasm32-wasi/libc.a'),
      entry('/lib/wasm32-wasi/libc++.a'),
      entry('/lib/wasm32-wasi/libc++abi.a'),
    ]);

    expect(layout.target).toBe('wasm32-wasi');
    expect(layout.resourceDir).toBe('/sysroot/lib/clang/22');
    expect(layout.cxxIncludeDir).toBe('/sysroot/include/wasm32-wasi/c++/v1');
    expect(layout.sysIncludeDir).toBe('/sysroot/include/wasm32-wasi');
    expect(layout.crt1Path).toBe('/sysroot/lib/wasm32-wasi/crt1.o');
    expect(layout.libDir).toBe('/sysroot/lib/wasm32-wasi');
    expect(layout.builtinsPath).toBe('/sysroot/lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a');
  });

  it('falls back to wasm32-unknown-wasip1 builtins when wasm32-unknown-wasi is absent', () => {
    const layout = resolveToolchainLayout([
      entry('/include/wasm32-wasi/c++/v1/iostream'),
      entry('/include/wasm32-wasi/stdio.h'),
      entry('/lib/clang/22/include/stddef.h'),
      entry('/lib/clang/22/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'),
      entry('/lib/wasm32-wasi/crt1.o'),
      entry('/lib/wasm32-wasi/libc.a'),
      entry('/lib/wasm32-wasi/libc++.a'),
      entry('/lib/wasm32-wasi/libc++abi.a'),
    ]);

    expect(layout.builtinsPath).toBe('/sysroot/lib/clang/22/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a');
  });

  it('throws a descriptive error when the clang resource dir is missing', () => {
    expect(() =>
      resolveToolchainLayout([
        entry('/include/wasm32-wasi/c++/v1/iostream'),
        entry('/include/wasm32-wasi/stdio.h'),
        entry('/lib/wasm32-wasi/crt1.o'),
        entry('/lib/wasm32-wasi/libc.a'),
        entry('/lib/wasm32-wasi/libc++.a'),
        entry('/lib/wasm32-wasi/libc++abi.a'),
      ]),
    ).toThrow(/clang resource dir/i);
  });
});
