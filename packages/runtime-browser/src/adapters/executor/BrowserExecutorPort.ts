import type { ExecutorPort } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutableArtifact, ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionResult } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionWorkerRequest, ExecutionWorkerResponse } from '../../worker/executionWorkerProtocol.js';
import {
  executionInternalErrorResult,
  executionResponseResult,
  isExecutionWorkerResponse,
} from '../../worker/executionWorkerProtocol.js';

type WorkerFactory = () => Worker;

type ActiveExecution = {
  worker: Worker;
  timeoutId: ReturnType<typeof setTimeout> | null;
  reject: (error: Error) => void;
};

export class BrowserExecutorPort implements ExecutorPort {
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private disposedError: Error | null = null;

  constructor(
    private readonly createWorker: WorkerFactory = () =>
      new Worker(new URL('../../worker/executionWorker.js', import.meta.url), { type: 'module' }),
  ) {}

  dispose(reason: Error = new Error('Executor port disposed')): void {
    if (!this.disposedError) this.disposedError = reason;

    for (const [requestId, execution] of this.activeExecutions) {
      if (execution.timeoutId !== null) clearTimeout(execution.timeoutId);
      execution.worker.terminate();
      execution.reject(reason);
      this.activeExecutions.delete(requestId);
    }
  }

  async execute(
    artifact: ExecutableArtifact,
    stdin: string,
    limits: ExecutionLimits,
    policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>,
  ): Promise<ExecutionResult> {
    if (this.disposedError) {
      throw this.disposedError;
    }

    const requestId = crypto.randomUUID();
    const request: ExecutionWorkerRequest = {
      type: 'execute',
      requestId,
      artifact,
      stdin,
      limits,
      policy,
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let worker: Worker;
      const wasmBinary = artifact.wasmBinary.slice();

      try {
        worker = this.createWorker();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const finish = (result: ExecutionResult): void => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        this.activeExecutions.delete(requestId);
        worker.terminate();
        resolve(result);
      };

      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (settled) return;
        if (!isExecutionWorkerResponse(event.data)) {
          finish(executionInternalErrorResult('Malformed response from execution worker'));
          return;
        }

        const response = event.data as ExecutionWorkerResponse;
        if (response.requestId !== requestId) {
          finish(executionInternalErrorResult('Mismatched response from execution worker'));
          return;
        }

        finish(executionResponseResult(response));
      });

      worker.addEventListener('messageerror', () => {
        finish(executionInternalErrorResult('Execution worker emitted messageerror'));
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const reason = event.message || 'Execution worker crashed';
        finish(executionInternalErrorResult(reason));
      });

      timeoutId = setTimeout(() => {
        finish({
          success: false,
          status: 'time_limit_exceeded',
          stdout: '',
          stderr: '',
          exitCode: null,
          elapsedMs: limits.timeLimitMs,
          reason: `Execution exceeded time limit (${limits.timeLimitMs} ms)`,
        });
      }, limits.timeLimitMs);

      this.activeExecutions.set(requestId, { worker, timeoutId, reject });

      const transfer: Transferable[] = [wasmBinary.buffer];

      try {
        worker.postMessage({ ...request, artifact: { wasmBinary } }, transfer);
      } catch (error) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        this.activeExecutions.delete(requestId);
        worker.terminate();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
