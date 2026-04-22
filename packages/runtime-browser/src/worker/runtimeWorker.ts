import type { WorkerRequest, WorkerResponse } from './workerProtocol.js';
import { isWorkerRequest } from './workerProtocol.js';
import { CompilerWithFlags, compileCpp, type CompilerAssets } from '../internal/cppCompiler.js';
import { executeWasm } from '../internal/wasiExecutor.js';
import { storeArtifact, getArtifact } from '../internal/artifactStore.js';

type SysrootEntry = { path: string; data: Uint8Array };

let storedSysrootEntries: SysrootEntry[] | null = null;
let storedClangWasm: ArrayBuffer | null = null;
let storedLdWasm: ArrayBuffer | null = null;
let compilerWithFlags: CompilerWithFlags | null = null;

function parseSysrootTar(decompressed: Uint8Array): SysrootEntry[] {
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
      // strip the 'sysroot/' tar root prefix so populateSysroot writes to /sysroot/include/...
      const stripped = fullName.startsWith('sysroot/') ? fullName.slice('sysroot'.length) : `/${fullName}`;
      entries.push({ path: stripped, data: fileData });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function decompressGzIfNeeded(data: ArrayBuffer): Promise<Uint8Array> {
  const view = new DataView(data);
  const isGzip = view.byteLength >= 2 && view.getUint8(0) === 0x1f && view.getUint8(1) === 0x8b;
  if (!isGzip) return new Uint8Array(data); // browser already decompressed via Content-Encoding: gzip

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

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
      const decompressed = await decompressGzIfNeeded(req.sysrootGzData);
      storedSysrootEntries = parseSysrootTar(decompressed);
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
