import { describe, expect, it, vi } from 'vitest';
import { BrowserExecutorPort } from '../../src/adapters/executor/BrowserExecutorPort.js';

type MessageListener = (event: MessageEvent<unknown>) => void;
type ErrorListener = (event: ErrorEvent) => void;

class FakeExecutionWorker {
  private messageListener: MessageListener | null = null;
  private messageErrorListener: (() => void) | null = null;
  private errorListener: ErrorListener | null = null;
  terminated = false;

  constructor(private readonly behavior: (message: unknown, worker: FakeExecutionWorker) => void) {}

  addEventListener(type: 'message' | 'messageerror' | 'error', listener: MessageListener | (() => void) | ErrorListener): void {
    if (type === 'message') this.messageListener = listener as MessageListener;
    if (type === 'messageerror') this.messageErrorListener = listener as () => void;
    if (type === 'error') this.errorListener = listener as ErrorListener;
  }

  postMessage(message: unknown): void {
    this.behavior(message, this);
  }

  terminate(): void {
    this.terminated = true;
  }

  dispatchMessage(data: unknown): void {
    this.messageListener?.({ data } as MessageEvent<unknown>);
  }

  dispatchMessageError(): void {
    this.messageErrorListener?.();
  }

  dispatchError(message: string): void {
    this.errorListener?.({ message } as ErrorEvent);
  }
}

describe('BrowserExecutorPort', () => {
  it('normalizes malformed worker responses to internal_error', async () => {
    const executor = new BrowserExecutorPort(
      () =>
        new FakeExecutionWorker((_message, worker) => {
          worker.dispatchMessage({ nope: true });
        }) as unknown as Worker,
    );

    const result = await executor.execute(
      { wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d]) },
      '',
      { timeLimitMs: 1000, memoryLimitBytes: 1024 * 1024 },
      { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 },
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe('internal_error');
      expect(result.reason).toContain('Malformed response');
    }
  });

  it('normalizes worker crashes to internal_error', async () => {
    const executor = new BrowserExecutorPort(
      () =>
        new FakeExecutionWorker((_message, worker) => {
          worker.dispatchError('boom');
        }) as unknown as Worker,
    );

    const result = await executor.execute(
      { wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d]) },
      '',
      { timeLimitMs: 1000, memoryLimitBytes: 1024 * 1024 },
      { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 },
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe('internal_error');
      expect(result.reason).toContain('boom');
    }
  });

  it('terminates the execution worker and returns time_limit_exceeded on timeout', async () => {
    vi.useFakeTimers();
    try {
      let fakeWorker: FakeExecutionWorker | null = null;
      const executor = new BrowserExecutorPort(
        () => {
          fakeWorker = new FakeExecutionWorker(() => {});
          return fakeWorker as unknown as Worker;
        },
      );

      const resultPromise = executor.execute(
        { wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d]) },
        '',
        { timeLimitMs: 100, memoryLimitBytes: 1024 * 1024 },
        { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 },
      );

      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(fakeWorker?.terminated).toBe(true);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe('time_limit_exceeded');
        expect(result.elapsedMs).toBe(100);
        expect(result.reason).toContain('100 ms');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose() terminates active workers and rejects pending execution', async () => {
    let fakeWorker: FakeExecutionWorker | null = null;
    const executor = new BrowserExecutorPort(
      () => {
        fakeWorker = new FakeExecutionWorker(() => {});
        return fakeWorker as unknown as Worker;
      },
    );

    const inFlight = executor.execute(
      { wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d]) },
      '',
      { timeLimitMs: 1000, memoryLimitBytes: 1024 * 1024 },
      { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 },
    );

    executor.dispose(new Error('disposed'));

    await expect(inFlight).rejects.toThrow(/disposed/i);
    expect(fakeWorker?.terminated).toBe(true);
    await expect(
      executor.execute(
        { wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d]) },
        '',
        { timeLimitMs: 1000, memoryLimitBytes: 1024 * 1024 },
        { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 },
      ),
    ).rejects.toThrow(/disposed/i);
  });
});
