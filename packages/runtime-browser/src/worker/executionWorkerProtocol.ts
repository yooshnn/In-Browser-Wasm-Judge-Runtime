import type { ExecutableArtifact, ExecutionFailure, ExecutionLimits, ExecutionResult, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';

export type ExecutionWorkerRequest = {
  type: 'execute';
  requestId: string;
  artifact: ExecutableArtifact;
  stdin: string;
  limits: ExecutionLimits;
  policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>;
};

export type ExecutionWorkerResponse =
  | { type: 'execute-result'; requestId: string; result: ExecutionResult }
  | { type: 'internal-error'; requestId: string; result: ExecutionFailure };

export function isExecutionWorkerRequest(value: unknown): value is ExecutionWorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  return (
    obj.type === 'execute' &&
    typeof obj.requestId === 'string' &&
    typeof obj.stdin === 'string' &&
    typeof obj.limits === 'object' &&
    obj.limits !== null &&
    typeof obj.policy === 'object' &&
    obj.policy !== null &&
    typeof obj.artifact === 'object' &&
    obj.artifact !== null &&
    (obj.artifact as { wasmBinary?: unknown }).wasmBinary instanceof Uint8Array
  );
}

export function isExecutionWorkerResponse(value: unknown): value is ExecutionWorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  return (
    typeof obj.requestId === 'string' &&
    (obj.type === 'execute-result' || obj.type === 'internal-error')
  );
}
