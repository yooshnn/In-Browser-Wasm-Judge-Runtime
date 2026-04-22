import type { CompileFailure, CompileSuccess } from '@cupya.me/wasm-judge-runtime-core';
import { buildClangArgs, buildLdArgs } from '../toolchain/buildToolchainArgs.js';
import { resolveToolchainLayout } from '../toolchain/resolveToolchainLayout.js';
import type { SysrootEntry } from '../toolchain/loadSysrootArchive.js';
import type { YowaspCompilerModule, YowaspTree } from './loadVendoredYowaspClang.js';

export type InternalCompileSuccess = CompileSuccess & {
  wasmBinary: Uint8Array;
};

type CompileResult = {
  status: 'ok' | 'ce';
  wasmBinary?: Uint8Array;
  stderr: string;
};

type YowaspExitLike = Error & {
  code?: number;
  files?: YowaspTree;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function appendTreeFile(tree: YowaspTree, path: string, data: Uint8Array | string): void {
  const segments = path.split('/').filter(Boolean);
  let current = tree;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (typeof existing === 'string' || existing instanceof Uint8Array) {
      throw new Error(`Cannot create directory over file at ${path}`);
    }
    if (!existing) {
      current[segment] = {};
    }
    current = current[segment] as YowaspTree;
  }

  const leaf = segments.at(-1);
  if (!leaf) {
    throw new Error(`Cannot write empty path: ${path}`);
  }
  current[leaf] = data;
}

function readTreeFile(tree: YowaspTree, path: string): Uint8Array | undefined {
  const segments = path.split('/').filter(Boolean);
  let current: YowaspTree | string | Uint8Array = tree;

  for (const segment of segments) {
    if (typeof current === 'string' || current instanceof Uint8Array) {
      return undefined;
    }
    current = current[segment];
    if (current === undefined) return undefined;
  }

  if (typeof current === 'string') return textEncoder.encode(current);
  if (current instanceof Uint8Array) return current;
  return undefined;
}

function createCompilerFilesystem(sysrootEntries: SysrootEntry[], sourceCode: string): YowaspTree {
  const tree: YowaspTree = {};

  for (const { path, data } of sysrootEntries) {
    appendTreeFile(tree, `sysroot${path}`, data);
  }

  appendTreeFile(tree, 'work/source.cpp', sourceCode);
  return tree;
}

function collectAscii(chunks: Uint8Array[]): string {
  if (chunks.length === 0) return '';
  return chunks.map((chunk) => textDecoder.decode(chunk)).join('');
}

function isExitLike(error: unknown): error is YowaspExitLike {
  return typeof error === 'object' && error !== null && 'files' in error;
}

async function runCommand(
  command: YowaspCompilerModule['runClang'] | YowaspCompilerModule['runLLVM'],
  args: string[],
  files: YowaspTree,
): Promise<{ ok: true; files: YowaspTree; stderr: string } | { ok: false; files: YowaspTree; stderr: string }> {
  const stderrChunks: Uint8Array[] = [];

  try {
    const output = await command(args, files, {
      stderr: (bytes) => {
        if (bytes) stderrChunks.push(bytes);
      },
    });
    return { ok: true, files: (output ?? files) as YowaspTree, stderr: collectAscii(stderrChunks) };
  } catch (error) {
    if (isExitLike(error)) {
      return {
        ok: false,
        files: (error.files ?? files) as YowaspTree,
        stderr: collectAscii(stderrChunks) || error.message,
      };
    }
    throw error;
  }
}

export function buildYowaspClangInvocation(
  sourcePath: string,
  objectPath: string,
  flags: string[],
  sysrootEntries: SysrootEntry[],
): string[] {
  const layout = resolveToolchainLayout(sysrootEntries);
  return ['clang++', ...buildClangArgs(layout, sourcePath, objectPath, flags)];
}

export function buildYowaspLdInvocation(
  objectPath: string,
  outputPath: string,
  sysrootEntries: SysrootEntry[],
): string[] {
  const layout = resolveToolchainLayout(sysrootEntries);
  return ['wasm-ld', ...buildLdArgs(layout, objectPath, outputPath)];
}

export class YowaspCppCompiler {
  constructor(
    private readonly compilerModule: YowaspCompilerModule,
    private readonly sysrootEntries: SysrootEntry[],
  ) {}

  async compile(sourceCode: string, flags: string[]): Promise<CompileResult> {
    const files = createCompilerFilesystem(this.sysrootEntries, sourceCode);
    const clangArgs = buildYowaspClangInvocation('/work/source.cpp', '/work/source.o', flags, this.sysrootEntries);
    const clangResult = await runCommand(this.compilerModule.runClang, clangArgs, files);

    if (!clangResult.ok) {
      return { status: 'ce', stderr: clangResult.stderr };
    }

    const ldArgs = buildYowaspLdInvocation('/work/source.o', '/work/output.wasm', this.sysrootEntries);
    const ldResult = await runCommand(this.compilerModule.runLLVM, ldArgs, clangResult.files);

    if (!ldResult.ok) {
      return { status: 'ce', stderr: ldResult.stderr };
    }

    const wasmBinary = readTreeFile(ldResult.files, '/work/output.wasm');
    if (!wasmBinary) {
      return {
        status: 'ce',
        stderr: 'YoWASP linker did not produce /work/output.wasm',
      };
    }

    return {
      status: 'ok',
      wasmBinary,
      stderr: '',
    };
  }
}

export async function compileCpp(
  compiler: YowaspCppCompiler,
  sourceCode: string,
  flags: string[],
): Promise<InternalCompileSuccess | CompileFailure> {
  const start = performance.now();

  try {
    const result = await compiler.compile(sourceCode, flags);
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
