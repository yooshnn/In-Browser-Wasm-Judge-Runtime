import { describe, expect, it, vi } from 'vitest';
import { BrowserCompilerPort } from '../../src/adapters/compiler/BrowserCompilerPort.js';
import type { WorkerResponse } from '../../src/worker/workerProtocol.js';

class FakeWorker {
  private listener: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly postedMessages: unknown[] = [];
  readonly transferLists: Transferable[][] = [];

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listener = listener;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.postedMessages.push(message);
    this.transferLists.push(transfer ?? []);

    const request = message as { type: string; requestId: string };
    if (request.type === 'init') {
      this.dispatch({ type: 'init-result', requestId: request.requestId });
      return;
    }

    if (request.type === 'compile') {
      this.dispatch({
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

  private dispatch(response: WorkerResponse): void {
    this.listener?.({ data: response } as MessageEvent<unknown>);
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
    });
    expect(worker.postedMessages[0]).not.toMatchObject({
      clangWasmData: expect.anything(),
      ldWasmData: expect.anything(),
    });
    expect(worker.transferLists[0]).toHaveLength(1);

    vi.unstubAllGlobals();
  });
});
