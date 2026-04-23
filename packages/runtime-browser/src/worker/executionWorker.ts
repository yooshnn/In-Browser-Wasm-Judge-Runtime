import { executeWasm } from '../internal/wasiExecutor.js';
import type { ExecutionWorkerResponse } from './executionWorkerProtocol.js';
import { executionInternalError, isExecutionWorkerRequest } from './executionWorkerProtocol.js';

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!isExecutionWorkerRequest(event.data)) return;
  const req = event.data;

  try {
    const result = await executeWasm(req.artifact.wasmBinary, req.stdin, req.limits, req.policy);
    self.postMessage({ type: 'execute-result', requestId: req.requestId, result } satisfies ExecutionWorkerResponse);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    self.postMessage(executionInternalError(req.requestId, reason));
  }
};
