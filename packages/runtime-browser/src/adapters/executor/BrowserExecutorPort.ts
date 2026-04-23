import type { ExecutorPort } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutableArtifact, ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionFailure, ExecutionResult } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionWorkerRequest, ExecutionWorkerResponse } from '../../worker/executionWorkerProtocol.js';
import { isExecutionWorkerResponse } from '../../worker/executionWorkerProtocol.js';

type WorkerFactory = () => Worker;

function internalErrorResult(reason: string): ExecutionFailure {
  return {
    success: false,
    status: 'internal_error',
    stdout: '',
    stderr: reason,
    exitCode: null,
    elapsedMs: 0,
    reason,
  };
}

export class BrowserExecutorPort implements ExecutorPort {
  constructor(
    private readonly createWorker: WorkerFactory = () =>
      new Worker(new URL('../../worker/executionWorker.ts', import.meta.url), { type: 'module' }),
  ) {}

  async execute(
    artifact: ExecutableArtifact,
    stdin: string,
    limits: ExecutionLimits,
    policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>,
  ): Promise<ExecutionResult> {
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
        worker.terminate();
        resolve(result);
      };

      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (settled) return;
        if (!isExecutionWorkerResponse(event.data)) {
          finish(internalErrorResult('Malformed response from execution worker'));
          return;
        }

        const response = event.data as ExecutionWorkerResponse;
        if (response.requestId !== requestId) {
          finish(internalErrorResult('Mismatched response from execution worker'));
          return;
        }

        finish(response.result);
      });

      worker.addEventListener('messageerror', () => {
        finish(internalErrorResult('Execution worker emitted messageerror'));
      });

      worker.addEventListener('error', (event: ErrorEvent) => {
        const reason = event.message || 'Execution worker crashed';
        finish(internalErrorResult(reason));
      });

      timeoutId = setTimeout(() => {
        finish({
          success: false,
          status: 'time_limit_exceeded',
          stdout: '',
          stderr: '',
          exitCode: null,
          elapsedMs: limits.timeLimitMs,
        });
      }, limits.timeLimitMs);

      const transfer: Transferable[] = [wasmBinary.buffer];

      try {
        worker.postMessage({ ...request, artifact: { wasmBinary } }, transfer);
      } catch (error) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        worker.terminate();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
