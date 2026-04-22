import type { WorkerRequest, WorkerResponse } from './workerProtocol.js';
import { isWorkerRequest } from './workerProtocol.js';
import { CompilerWithFlags, compileCpp, type CompilerAssets } from '../internal/cppCompiler.js';
import { executeWasm } from '../internal/wasiExecutor.js';
import { storeArtifact, getArtifact } from '../internal/artifactStore.js';
import { loadSysrootEntriesFromArchive, type SysrootEntry } from '../internal/toolchain/loadSysrootArchive.js';

let storedSysrootEntries: SysrootEntry[] | null = null;
let storedClangWasm: ArrayBuffer | null = null;
let storedLdWasm: ArrayBuffer | null = null;
let compilerWithFlags: CompilerWithFlags | null = null;

async function loadCompilerFactories(): Promise<Pick<CompilerAssets, 'clangFactory' | 'ldFactory'>> {
  type EmFactory = (opts: object) => Promise<{ FS: any; callMain(args: string[]): number }>;

  const origin = self.location.origin;

  const importFromCandidates = async (moduleName: 'clang.js' | 'wasm-ld.js'): Promise<EmFactory> => {
    const candidates = [`${origin}/`, `${origin}/assets/`];
    let lastError: unknown;
    for (const base of candidates) {
      try {
        const url = `${base}${moduleName}`;
        // @vite-ignore suppresses static analysis; URL is derived at runtime from server origin
        const module = await import(/* @vite-ignore */ url) as { default: EmFactory };
        return module.default;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Failed to load ${moduleName}: ${lastError}`);
  };

  const [clangFactory, ldFactory] = await Promise.all([
    importFromCandidates('clang.js'),
    importFromCandidates('wasm-ld.js'),
  ]);
  return { clangFactory, ldFactory };
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!isWorkerRequest(event.data)) return;
  const req = event.data as WorkerRequest;

  try {
    if (req.type === 'init') {
      storedSysrootEntries = await loadSysrootEntriesFromArchive(req.sysrootGzData);
      storedClangWasm = req.clangWasmData;
      storedLdWasm = req.ldWasmData;
      self.postMessage({ type: 'init-result', requestId: req.requestId } satisfies WorkerResponse);
      return;
    }

    if (req.type === 'compile') {
      if (!compilerWithFlags) {
        if (!storedSysrootEntries) throw new Error('Worker not initialized: send init first');
        const { clangFactory: rawClangFactory, ldFactory: rawLdFactory } = await loadCompilerFactories();

        const clangWasm = storedClangWasm;
        const ldWasm = storedLdWasm;

        // Wrap factories to inject pre-fetched wasm binaries, avoiding in-worker fetch
        const clangFactory = (opts: object) => rawClangFactory({ ...opts, wasmBinary: clangWasm });
        const ldFactory = (opts: object) => rawLdFactory({ ...opts, wasmBinary: ldWasm });

        compilerWithFlags = CompilerWithFlags.create({
          clangFactory,
          ldFactory,
          sysrootEntries: storedSysrootEntries,
        });
      }

      const internal = await compileCpp(compilerWithFlags, req.sourceCode, req.flags);

      let publicResult: WorkerResponse;
      if (internal.success) {
        storeArtifact(internal.artifact.id, internal.wasmBinary);
        const { wasmBinary: _omit, ...compileSuccess } = internal;
        publicResult = { type: 'compile-result', requestId: req.requestId, result: compileSuccess };
      } else {
        publicResult = { type: 'compile-result', requestId: req.requestId, result: internal };
      }

      self.postMessage(publicResult);
      return;
    }

    if (req.type === 'execute') {
      const binary = getArtifact(req.artifactId);
      if (!binary) {
        self.postMessage({ type: 'internal-error', requestId: req.requestId, message: 'artifact not found' } satisfies WorkerResponse);
        return;
      }

      const result = await executeWasm(binary, req.stdin, req.limits, req.policy);
      self.postMessage({ type: 'execute-result', requestId: req.requestId, result } satisfies WorkerResponse);
    }
  } catch (e) {
    self.postMessage({ type: 'internal-error', requestId: req.requestId, message: String(e) } satisfies WorkerResponse);
  }
};
