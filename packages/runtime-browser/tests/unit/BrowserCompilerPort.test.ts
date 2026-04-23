import { describe, expect, it, vi } from 'vitest';
import { BrowserCompilerPort } from '../../src/adapters/compiler/BrowserCompilerPort.js';
import type { WorkerResponse } from '../../src/worker/workerProtocol.js';

class FakeWorker {
  private listeners: Partial<{
    message: (event: MessageEvent<unknown>) => void;
    messageerror: () => void;
    error: (event: ErrorEvent) => void;
  }> = {};
  readonly postedMessages: unknown[] = [];
  readonly transferLists: Transferable[][] = [];
  autoRespondToCompile = true;

  addEventListener(type: 'message' | 'messageerror' | 'error', listener: any): void {
    this.listeners[type] = listener;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.postedMessages.push(message);
    this.transferLists.push(transfer ?? []);

    const request = message as { type: string; requestId: string };
    if (request.type === 'init') {
      this.dispatchMessage({ type: 'init-result', requestId: request.requestId });
      return;
    }

    if (request.type === 'compile') {
      if (!this.autoRespondToCompile) return;
      this.dispatchMessage({
        type: 'compile-result',
        requestId: request.requestId,
        result: {
          success: true,
          stdout: '',
          stderr: '',
          warnings: [],
          artifact: { wasmBinary: new Uint8Array([1, 2, 3]) },
          elapsedMs: 1,
        },
      });
    }
  }

  dispatchMessage(response: WorkerResponse): void {
    this.listeners.message?.({ data: response } as MessageEvent<unknown>);
  }

  dispatchError(message = 'boom'): void {
    this.listeners.error?.({ message } as ErrorEvent);
  }
}

describe('BrowserCompilerPort', () => {
  it('initializes with sysroot only and does not request raw clang/ld wasm artifacts', async () => {
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(input).buffer,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const worker = new FakeWorker();
    const compiler = new BrowserCompilerPort(worker as unknown as Worker);
    const result = await compiler.compile(
      'cpp',
      { sourceCode: 'int main() { return 0; }' },
      { flags: [] },
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/sysroot.tar.gz');
    expect(worker.postedMessages[0]).toMatchObject({
      type: 'init',
      sysrootGzData: expect.any(ArrayBuffer),
      yowaspClangBundleUrl: '/yowasp-clang/bundle.js',
    });
    expect(worker.postedMessages[0]).not.toMatchObject({
      clangWasmData: expect.anything(),
      ldWasmData: expect.anything(),
    });
    expect(worker.transferLists[0]).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it('init() is idempotent (returns the same promise and does one fetch/post)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const worker = new FakeWorker();
    const compiler = new BrowserCompilerPort(worker as unknown as Worker);

    const p1 = compiler.init();
    const p2 = compiler.init();
    expect(p1).toBe(p2);
    await p1;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(worker.postedMessages.filter((m) => (m as any).type === 'init')).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it('worker crash rejects pending init/compile and prevents future compiles from hanging', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const worker = new FakeWorker();
    const compiler = new BrowserCompilerPort(worker as unknown as Worker);
    await compiler.init();

    // Simulate a compile request that never responds, then crash.
    worker.autoRespondToCompile = false;

    const inFlight = compiler.compile('cpp', { sourceCode: 'int main() { return 0; }' }, { flags: [] });
    worker.dispatchError('Compiler worker crashed');

    await expect(inFlight).rejects.toThrow(/crashed/i);
    await expect(
      compiler.compile('cpp', { sourceCode: 'int main() { return 0; }' }, { flags: [] }),
    ).rejects.toThrow(/crashed/i);

    vi.unstubAllGlobals();
  });

  it('dispose() rejects pending compile and makes future compiles fail fast', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const worker = new FakeWorker();
    const compiler = new BrowserCompilerPort(worker as unknown as Worker);
    await compiler.init();

    worker.autoRespondToCompile = false;
    const inFlight = compiler.compile('cpp', { sourceCode: 'int main() { return 0; }' }, { flags: [] });

    // Ensure the async compile path has a chance to register its pending entry.
    await Promise.resolve();

    compiler.dispose(new Error('disposed'));

    await expect(inFlight).rejects.toThrow(/disposed/i);
    await expect(
      compiler.compile('cpp', { sourceCode: 'int main() { return 0; }' }, { flags: [] }),
    ).rejects.toThrow(/disposed/i);

    vi.unstubAllGlobals();
  });
});
