import type { CompilerPort } from '@cupya.me/wasm-judge-runtime-core';
import type { LanguageId, SubmissionSource, CompileOptions } from '@cupya.me/wasm-judge-runtime-core';
import type { CompileSuccess, CompileFailure } from '@cupya.me/wasm-judge-runtime-core';
import type { WorkerRequest, WorkerResponse } from '../../worker/workerProtocol.js';
import { isWorkerResponse } from '../../worker/workerProtocol.js';

type PendingRequest = {
  resolve: (result: CompileSuccess | CompileFailure) => void;
  reject: (error: Error) => void;
};

export class BrowserCompilerPort implements CompilerPort {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!isWorkerResponse(event.data)) return;
      const response = event.data as WorkerResponse;

      const entry = this.pending.get(response.requestId);
      if (!entry) return;
      this.pending.delete(response.requestId);

      if (response.type === 'compile-result') {
        entry.resolve(response.result);
      } else if (response.type === 'internal-error') {
        entry.reject(new Error(response.message));
      }
    });
  }

  async compile(
    language: LanguageId,
    source: SubmissionSource,
    options: CompileOptions,
  ): Promise<CompileSuccess | CompileFailure> {
    if (language !== 'cpp') {
      return {
        success: false,
        stdout: '',
        stderr: '',
        errors: [`unsupported language: ${language}`],
        elapsedMs: 0,
      };
    }

    const requestId = crypto.randomUUID();
    const request: WorkerRequest = {
      type: 'compile',
      requestId,
      language: 'cpp',
      sourceCode: source.sourceCode,
      flags: options.flags,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }
}
