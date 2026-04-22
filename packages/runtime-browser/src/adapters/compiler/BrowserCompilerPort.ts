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
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly worker: Worker,
    private readonly sysrootUrl = '/sysroot.tar.gz',
  ) {
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!isWorkerResponse(event.data)) return;
      const response = event.data as WorkerResponse;

      if (response.type === 'init-result') {
        const entry = this.pending.get(response.requestId);
        if (!entry) return;
        this.pending.delete(response.requestId);
        entry.resolve(undefined as any);
        return;
      }

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

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.sendInit();
    }
    return this.initPromise;
  }

  private async fetchBinary(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  private async sendInit(): Promise<void> {
    const [sysrootGzData, clangWasmData, ldWasmData] = await Promise.all([
      this.fetchBinary(this.sysrootUrl),
      this.fetchBinary('/clang.wasm'),
      this.fetchBinary('/wasm-ld.wasm'),
    ]);

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as any,
        reject,
      });
      const request: WorkerRequest = { type: 'init', requestId, sysrootGzData, clangWasmData, ldWasmData };
      this.worker.postMessage(request, [sysrootGzData, clangWasmData, ldWasmData]);
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

    await this.ensureInit();

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
