import type { ExecutorPort } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutableArtifact, ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionSuccess, ExecutionFailure } from '@cupya.me/wasm-judge-runtime-core';
import type { WorkerRequest, WorkerResponse } from '../../worker/workerProtocol.js';
import { isWorkerResponse } from '../../worker/workerProtocol.js';

type PendingRequest = {
  resolve: (result: ExecutionSuccess | ExecutionFailure) => void;
  reject: (error: Error) => void;
};

export class BrowserExecutorPort implements ExecutorPort {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!isWorkerResponse(event.data)) return;
      const response = event.data as WorkerResponse;

      const entry = this.pending.get(response.requestId);
      if (!entry) return;
      this.pending.delete(response.requestId);

      if (response.type === 'execute-result') {
        entry.resolve(response.result);
      } else if (response.type === 'internal-error') {
        entry.reject(new Error(response.message));
      }
    });
  }

  async execute(
    artifact: ExecutableArtifact,
    stdin: string,
    limits: ExecutionLimits,
    policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>,
  ): Promise<ExecutionSuccess | ExecutionFailure> {
    const requestId = crypto.randomUUID();
    const request: WorkerRequest = {
      type: 'execute',
      requestId,
      artifactId: artifact.id,
      stdin,
      limits,
      policy,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }
}
