import type { WorkerRequest, WorkerResponse } from './workerProtocol.js';
import { isWorkerRequest } from './workerProtocol.js';
import { YowaspCppCompiler, compileCpp } from '../internal/yowasp/YowaspCppCompiler.js';
import { loadSysrootEntriesFromArchive, type SysrootEntry } from '../internal/toolchain/loadSysrootArchive.js';
import { loadVendoredYowaspClangFromBundleUrl, type YowaspCompilerModule } from '../internal/yowasp/loadVendoredYowaspClang.js';

let storedSysrootEntries: SysrootEntry[] | null = null;
let yowaspCompilerModulePromise: Promise<YowaspCompilerModule> | null = null;
let compilerWithFlags: YowaspCppCompiler | null = null;
let yowaspClangBundleUrl: string | null = null;

function loadCompilerModule(): Promise<YowaspCompilerModule> {
  if (!yowaspCompilerModulePromise) {
    if (!yowaspClangBundleUrl) throw new Error('Worker not initialized: missing yowasp bundle url');
    yowaspCompilerModulePromise = loadVendoredYowaspClangFromBundleUrl(yowaspClangBundleUrl);
  }
  return yowaspCompilerModulePromise;
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!isWorkerRequest(event.data)) return;
  const req = event.data as WorkerRequest;

  try {
    if (req.type === 'init') {
      if (yowaspClangBundleUrl && yowaspClangBundleUrl !== req.yowaspClangBundleUrl) {
        throw new Error('Worker already initialized with a different yowasp bundle url');
      }
      yowaspClangBundleUrl = req.yowaspClangBundleUrl;
      storedSysrootEntries = await loadSysrootEntriesFromArchive(req.sysrootGzData);
      await loadCompilerModule();
      self.postMessage({ type: 'init-result', requestId: req.requestId } satisfies WorkerResponse);
      return;
    }

    if (req.type === 'compile') {
      if (!compilerWithFlags) {
        if (!storedSysrootEntries) throw new Error('Worker not initialized: send init first');
        const compilerModule = await loadCompilerModule();
        compilerWithFlags = new YowaspCppCompiler(compilerModule, storedSysrootEntries);
      }

      const internal = await compileCpp(compilerWithFlags, req.sourceCode, req.flags);
      const transfer = internal.success ? [internal.artifact.wasmBinary.buffer as Transferable] : [];
      self.postMessage(
        { type: 'compile-result', requestId: req.requestId, result: internal } satisfies WorkerResponse,
        { transfer },
      );
      return;
    }
  } catch (e) {
    self.postMessage({ type: 'internal-error', requestId: req.requestId, message: String(e) } satisfies WorkerResponse);
  }
};
