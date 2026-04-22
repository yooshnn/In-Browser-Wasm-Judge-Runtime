import type { WorkerRequest, WorkerResponse } from './workerProtocol.js';
import { isWorkerRequest } from './workerProtocol.js';
import { YowaspCppCompiler, compileCpp } from '../internal/yowasp/YowaspCppCompiler.js';
import { executeWasm } from '../internal/wasiExecutor.js';
import { storeArtifact, getArtifact } from '../internal/artifactStore.js';
import { loadSysrootEntriesFromArchive, type SysrootEntry } from '../internal/toolchain/loadSysrootArchive.js';
import { loadVendoredYowaspClang, type YowaspCompilerModule } from '../internal/yowasp/loadVendoredYowaspClang.js';

let storedSysrootEntries: SysrootEntry[] | null = null;
let yowaspCompilerModulePromise: Promise<YowaspCompilerModule> | null = null;
let compilerWithFlags: YowaspCppCompiler | null = null;

function loadCompilerModule(): Promise<YowaspCompilerModule> {
  if (!yowaspCompilerModulePromise) {
    yowaspCompilerModulePromise = loadVendoredYowaspClang(self.location.origin);
  }
  return yowaspCompilerModulePromise;
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!isWorkerRequest(event.data)) return;
  const req = event.data as WorkerRequest;

  try {
    if (req.type === 'init') {
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
