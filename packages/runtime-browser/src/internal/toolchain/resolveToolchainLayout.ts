export type SysrootEntryPath = {
  path: string;
};

export type ToolchainLayout = {
  target: 'wasm32-wasi';
  resourceDir: string;
  cxxIncludeDir: string;
  sysIncludeDir: string;
  crt1Path: string;
  libDir: string;
  builtinsPath: string;
};

function normalizeEntryPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function requireEntry(
  paths: Set<string>,
  path: string,
  description: string,
): string {
  if (!paths.has(path)) {
    throw new Error(`Missing ${description}: ${path}`);
  }
  return `/sysroot${path}`;
}

function resolveClangResourceDir(paths: Set<string>): string {
  for (const path of paths) {
    const match = path.match(/^\/lib\/clang\/([^/]+)\/include\/stddef\.h$/);
    if (match) {
      return `/sysroot/lib/clang/${match[1]}`;
    }
  }
  throw new Error('Missing clang resource dir: lib/clang/<version>/include/stddef.h');
}

function resolveBuiltinsPath(paths: Set<string>, resourceDir: string): string {
  const candidates = [
    `${resourceDir}/lib/wasm32-unknown-wasi/libclang_rt.builtins.a`,
    `${resourceDir}/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a`,
    `${resourceDir}/lib/wasm32-unknown-wasip2/libclang_rt.builtins.a`,
  ];

  for (const candidate of candidates) {
    const entryPath = candidate.replace('/sysroot', '');
    if (paths.has(entryPath)) return candidate;
  }

  throw new Error('Missing compiler-rt builtins for wasm32 wasi toolchain');
}

export function resolveToolchainLayout(entries: SysrootEntryPath[]): ToolchainLayout {
  const paths = new Set(entries.map((entry) => normalizeEntryPath(entry.path)));

  const target: ToolchainLayout['target'] = 'wasm32-wasi';
  const resourceDir = resolveClangResourceDir(paths);
  const cxxIncludeDir = requireEntry(paths, '/include/wasm32-wasi/c++/v1/iostream', 'libc++ headers')
    .replace('/iostream', '');
  const sysIncludeDir = requireEntry(paths, '/include/wasm32-wasi/stdio.h', 'wasi sysroot headers')
    .replace('/stdio.h', '');
  const crt1Path = requireEntry(paths, '/lib/wasm32-wasi/crt1.o', 'crt1 object');
  const libDir = requireEntry(paths, '/lib/wasm32-wasi/libc.a', 'wasi libc archive')
    .replace('/libc.a', '');
  requireEntry(paths, '/lib/wasm32-wasi/libc++.a', 'libc++ archive');
  requireEntry(paths, '/lib/wasm32-wasi/libc++abi.a', 'libc++abi archive');
  const builtinsPath = resolveBuiltinsPath(paths, resourceDir);

  return {
    target,
    resourceDir,
    cxxIncludeDir,
    sysIncludeDir,
    crt1Path,
    libDir,
    builtinsPath,
  };
}
