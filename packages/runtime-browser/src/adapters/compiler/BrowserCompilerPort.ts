import type { CompilerPort } from '@cupya.me/wasm-judge-runtime-core';
import type { LanguageId, SubmissionSource, CompileOptions } from '@cupya.me/wasm-judge-runtime-core';
import type { CompileSuccess, CompileFailure } from '@cupya.me/wasm-judge-runtime-core';
import type { WorkerRequest, WorkerResponse } from '../../worker/workerProtocol.js';
import { isWorkerResponse } from '../../worker/workerProtocol.js';

type PendingInit = {
  kind: 'init';
  resolve: () => void;
  reject: (error: Error) => void;
};

type PendingCompile = {
  kind: 'compile';
  resolve: (result: CompileSuccess | CompileFailure) => void;
  reject: (error: Error) => void;
};

type PendingRequest = PendingInit | PendingCompile;

function defaultYowaspClangBundleUrl(): string {
  const href = globalThis.location?.href;
  if (typeof href === 'string') {
    return new URL('/yowasp-clang/bundle.js', href).href;
  }
  return '/yowasp-clang/bundle.js';
}

export class BrowserCompilerPort implements CompilerPort {
  private readonly pending = new Map<string, PendingRequest>();
  private initPromise: Promise<void> | null = null;
  private fatalError: Error | null = null;

  constructor(
    private readonly worker: Worker,
    private readonly sysrootUrl = '/sysroot.tar.gz',
    private readonly yowaspClangBundleUrl = defaultYowaspClangBundleUrl(),
  ) {
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!isWorkerResponse(event.data)) return;
      const response = event.data as WorkerResponse;

      if (response.type === 'init-result') {
        const entry = this.pending.get(response.requestId);
        if (!entry) return;
        this.pending.delete(response.requestId);
        if (entry.kind === 'init') {
          entry.resolve();
        } else {
          entry.reject(new Error('Compiler worker returned init-result for a non-init request'));
        }
        return;
      }

      const entry = this.pending.get(response.requestId);
      if (!entry) return;
      this.pending.delete(response.requestId);

      if (response.type === 'compile-result') {
        if (entry.kind === 'compile') {
          entry.resolve(response.result);
        } else {
          entry.reject(new Error('Compiler worker returned compile-result for a non-compile request'));
        }
      } else if (response.type === 'internal-error') {
        entry.reject(new Error(response.message));
      }
    });

    worker.addEventListener('messageerror', () => {
      this.failAllPending(new Error('Compiler worker emitted messageerror'));
    });

    worker.addEventListener('error', (event: ErrorEvent) => {
      const reason = event.message || 'Compiler worker crashed';
      this.failAllPending(new Error(reason));
    });
  }

  init(): Promise<void> {
    if (this.fatalError) return Promise.reject(this.fatalError);
    return this.ensureInit();
  }

  dispose(reason: Error = new Error('Compiler port disposed')): void {
    this.failAllPending(reason);
  }

  private failAllPending(error: Error): void {
    if (!this.fatalError) this.fatalError = error;
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  private ensureInit(): Promise<void> {
    if (this.fatalError) return Promise.reject(this.fatalError);
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
    const sysrootGzData = await this.fetchBinary(this.sysrootUrl);
    if (this.fatalError) throw this.fatalError;

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { kind: 'init', resolve, reject });
      const request: WorkerRequest = {
        type: 'init',
        requestId,
        sysrootGzData,
        yowaspClangBundleUrl: this.yowaspClangBundleUrl,
      };
      this.worker.postMessage(request, [sysrootGzData]);
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

    if (this.fatalError) {
      throw this.fatalError;
    }

    await this.ensureInit();
    if (this.fatalError) throw this.fatalError;

    const requestId = crypto.randomUUID();
    const request: WorkerRequest = {
      type: 'compile',
      requestId,
      language: 'cpp',
      sourceCode: source.sourceCode,
      flags: options.flags,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { kind: 'compile', resolve, reject });
      this.worker.postMessage(request);
    });
  }
}
