import type { ExecutionFailure } from '@cupya.me/wasm-judge-runtime-core';
import { executeWasm } from '../internal/wasiExecutor.js';
import type { ExecutionWorkerResponse } from './executionWorkerProtocol.js';
import { isExecutionWorkerRequest } from './executionWorkerProtocol.js';

function internalError(requestId: string, reason: string): ExecutionWorkerResponse {
  return {
    type: 'internal-error',
    requestId,
    result: {
      success: false,
      status: 'internal_error',
      stdout: '',
      stderr: reason,
      exitCode: null,
      elapsedMs: 0,
      reason,
    } satisfies ExecutionFailure,
  };
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!isExecutionWorkerRequest(event.data)) return;
  const req = event.data;

  try {
    const result = await executeWasm(req.artifact.wasmBinary, req.stdin, req.limits, req.policy);
    self.postMessage({ type: 'execute-result', requestId: req.requestId, result } satisfies ExecutionWorkerResponse);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    self.postMessage(internalError(req.requestId, reason));
  }
};
