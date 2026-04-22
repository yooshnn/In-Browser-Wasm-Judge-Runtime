import type { CompileFailure, CompileSuccess } from '@cupya.me/wasm-judge-runtime-core';

type EmFS = {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array | string, opts?: object): void;
  readFile(path: string, opts: { encoding: 'binary' }): Uint8Array;
};

type EmModule = {
  FS: EmFS;
  callMain(args: string[]): number;
};

type EmFactory = (opts: object) => Promise<EmModule>;

export type SysrootEntry = { path: string; data: Uint8Array };
export type SysrootManifest = {
  files: string[];
};
export type CompilerAssets = {
  clangFactory: EmFactory;
  ldFactory: EmFactory;
  sysrootEntries: SysrootEntry[];
};
export type CompilerAssetLoader = (assetsBaseUrl: string) => Promise<CompilerAssets>;
export type FetchLike = (input: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}>;

// Adapter type for upstream Compiler class
export interface Compiler {
  compile(source: string, harness?: string): Promise<{ status: 'ok' | 'ce'; wasmBinary?: Uint8Array; stderr: string }>;
}

// Internal type for worker-scoped use: includes wasmBinary
export type InternalCompileSuccess = CompileSuccess & {
  wasmBinary: Uint8Array;
};

function populateSysroot(fs: EmFS, entries: SysrootEntry[]): void {
  for (const { path, data } of entries) {
    const dirPart = '/sysroot' + path.substring(0, path.lastIndexOf('/'));
    fs.mkdirTree(dirPart);
    fs.writeFile('/sysroot' + path, data);
  }
}

// Compiler implementation with flag support for Phase 1+
export class CompilerWithFlags {
  private constructor(
    private readonly clangFactory: EmFactory,
    private readonly ldFactory: EmFactory,
    private readonly sysrootEntries: SysrootEntry[],
  ) {}

  static create(assets: CompilerAssets): CompilerWithFlags {
    return new CompilerWithFlags(assets.clangFactory, assets.ldFactory, assets.sysrootEntries);
  }

  async compile(sourceCode: string, flags: string[]): Promise<{ status: 'ok' | 'ce'; wasmBinary?: Uint8Array; stderr: string }> {
    const clangStderr: string[] = [];
    const ldStderr: string[] = [];

    const [clang, ld] = await Promise.all([
      this.clangFactory({
        thisProgram: 'clang',
        noInitialRun: true,
        print: () => {},
        printErr: (line: string) => clangStderr.push(line),
      }),
      this.ldFactory({
        thisProgram: 'wasm-ld',
        noInitialRun: true,
        print: () => {},
        printErr: (line: string) => ldStderr.push(line),
        locateFile: (path: string, scriptDir: string) =>
          path === 'lld.wasm' ? `${scriptDir}wasm-ld.wasm` : `${scriptDir}${path}`,
      }),
    ]);

    populateSysroot(clang.FS, this.sysrootEntries);
    populateSysroot(ld.FS, this.sysrootEntries);

    clang.FS.mkdirTree('/work');
    clang.FS.writeFile('/work/source.cpp', sourceCode);

    const clangArgs = [
      '--target=wasm32-wasi',
      '--sysroot=/sysroot',
      '-resource-dir', '/sysroot/lib/clang/18',
      '-isystem', '/sysroot/include/wasm32-wasi/c++/v1',
      '-isystem', '/sysroot/include/wasm32-wasi',
      '-std=c++17',
      '-fno-finite-loops',
      '-x', 'c++',
      '-c', '/work/source.cpp',
      '-o', '/work/source.o',
      '-O1',
      '-fno-exceptions',
      ...flags, // user flags: appended last, takes precedence over base preset
    ];

    const clangExit = clang.callMain(clangArgs);

    if (clangExit !== 0) {
      return { status: 'ce', stderr: clangStderr.join('\n') };
    }

    const objData = clang.FS.readFile('/work/source.o', { encoding: 'binary' });

    ld.FS.mkdirTree('/work');
    ld.FS.writeFile('/work/source.o', objData);

    const ldExit = ld.callMain([
      '/work/source.o',
      '/sysroot/lib/wasm32-wasi/crt1.o',
      '-L/sysroot/lib/wasm32-wasi',
      '-lc',
      '-lc++',
      '-lc++abi',
      '-o', '/work/output.wasm',
    ]);

    if (ldExit !== 0) {
      return { status: 'ce', stderr: ldStderr.join('\n') };
    }

    const wasmBinary = ld.FS.readFile('/work/output.wasm', { encoding: 'binary' });
    return { status: 'ok', wasmBinary, stderr: '' };
  }
}

// Wrapper for upstream Compiler or CompilerWithFlags
export async function compileCpp(
  compiler: Compiler | CompilerWithFlags,
  sourceCode: string,
  flags: string[],
): Promise<InternalCompileSuccess | CompileFailure> {
  const start = performance.now();

  try {
    // Call compiler with flag support if available, otherwise without flags
    const result = 'compile' in compiler && compiler instanceof CompilerWithFlags
      ? await compiler.compile(sourceCode, flags)
      : await (compiler as Compiler).compile(sourceCode);

    const elapsedMs = Math.round(performance.now() - start);

    if (result.status === 'ce') {
      return {
        success: false,
        stdout: '',
        stderr: result.stderr,
        errors: [result.stderr],
        elapsedMs,
      };
    }

    // Compilation succeeded
    if (!result.wasmBinary) {
      return {
        success: false,
        stdout: '',
        stderr: 'Compiler did not produce WASM binary',
        errors: ['Compiler did not produce WASM binary'],
        elapsedMs,
      };
    }

    return {
      success: true,
      stdout: '',
      stderr: '',
      warnings: [],
      artifact: {
        id: crypto.randomUUID(),
      },
      elapsedMs,
      wasmBinary: result.wasmBinary,
    };
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - start);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      stdout: '',
      stderr: errorMessage,
      errors: [errorMessage],
      elapsedMs,
    };
  }
}
