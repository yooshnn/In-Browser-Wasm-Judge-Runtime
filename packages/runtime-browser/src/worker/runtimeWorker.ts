import type { WorkerRequest, WorkerResponse } from './workerProtocol.js';
import { isWorkerRequest } from './workerProtocol.js';
import { CompilerWithFlags, compileCpp, type CompilerAssets } from '../internal/cppCompiler.js';
import { executeWasm } from '../internal/wasiExecutor.js';
import { storeArtifact, getArtifact } from '../internal/artifactStore.js';

// Assets served from publicDir root (artifacts/ → vitest publicDir / vite publicDir)
const ASSETS_BASE_URL = '';

let compilerWithFlags: CompilerWithFlags | null = null;

async function loadCompilerAssets(): Promise<CompilerAssets> {
  function importAssetModule<T>(specifier: string): Promise<T> {
    const dynamicImport = new Function('s', 'return import(s)') as (value: string) => Promise<T>;
    return dynamicImport(specifier);
  }

  type EmFactory = (opts: object) => Promise<{ FS: any; callMain(args: string[]): number }>;

  const importFromCandidates = async (moduleName: 'clang.js' | 'wasm-ld.js'): Promise<EmFactory> => {
    const candidates = ASSETS_BASE_URL === '' ? ['/', '/assets'] : [ASSETS_BASE_URL];
    let lastError: unknown;
    for (const base of candidates) {
      try {
        const specifier = `${base}${moduleName}`;
        const module = await importAssetModule<{ default: EmFactory }>(specifier);
        return module.default;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error(`Failed to load ${moduleName}`);
  };

  type FetchLike = (input: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>;
  type SysrootEntry = { path: string; data: Uint8Array };

  async function fetchSysrootFromArchive(fetchImpl: FetchLike): Promise<SysrootEntry[]> {
    const candidates = ASSETS_BASE_URL === '' ? ['/', '/assets/'] : [`${ASSETS_BASE_URL}/`];
    for (const base of candidates) {
      const url = `${base}sysroot.tar.gz`;
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(url);
      } catch {
        continue;
      }
      if (!response.ok) continue;

      const compressed = await response.arrayBuffer();
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      const decompressed = new Uint8Array(await new Response(stream).arrayBuffer());

      const entries: SysrootEntry[] = [];
      let offset = 0;
      while (offset + 512 <= decompressed.byteLength) {
        const header = decompressed.subarray(offset, offset + 512);
        if (header.every((b) => b === 0)) break;
        const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0/g, '');
        const prefix = new TextDecoder().decode(header.subarray(345, 500)).replace(/\0/g, '');
        const sizeText = new TextDecoder().decode(header.subarray(124, 136)).replace(/\0/g, '').trim();
        const size = sizeText === '' ? 0 : Number.parseInt(sizeText, 8);
        const typeflag = header[156];
        const fullName = prefix ? `${prefix}/${name}` : name;
        offset += 512;
        const fileData = decompressed.slice(offset, offset + size);
        if ((typeflag === 0 || typeflag === 48) && fullName !== '') {
          entries.push({ path: `/${fullName}`, data: fileData });
        }
        offset += Math.ceil(size / 512) * 512;
      }
      return entries;
    }
    throw new Error('Failed to load sysroot.tar.gz from any candidate URL');
  }

  const [clangFactory, ldFactory, sysrootEntries] = await Promise.all([
    importFromCandidates('clang.js'),
    importFromCandidates('wasm-ld.js'),
    fetchSysrootFromArchive(fetch as FetchLike),
  ]);

  return { clangFactory, ldFactory, sysrootEntries };
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!isWorkerRequest(event.data)) return;
  const req = event.data as WorkerRequest;

  try {
    if (req.type === 'compile') {
      if (!compilerWithFlags) {
        const assets = await loadCompilerAssets();
        compilerWithFlags = CompilerWithFlags.create(assets);
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
        // artifact not found is a worker runtime failure, not a domain execution failure
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
