import type { CompileSuccess, CompileFailure } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionSuccess, ExecutionFailure } from '@cupya.me/wasm-judge-runtime-core';
import type { ExecutionLimits, JudgePolicy } from '@cupya.me/wasm-judge-runtime-core';

export type WorkerRequest =
  | {
      type: 'init';
      requestId: string;
      sysrootGzData: ArrayBuffer; // transferable; worker decompresses and parses
      clangWasmData: ArrayBuffer; // transferable; passed directly to clang factory
      ldWasmData: ArrayBuffer;    // transferable; passed directly to wasm-ld factory
    }
  | {
      type: 'compile';
      requestId: string;
      language: 'cpp';
      sourceCode: string;
      flags: string[];
    }
  | {
      type: 'execute';
      requestId: string;
      artifactId: string;
      stdin: string;
      limits: ExecutionLimits;
      policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>;
    };

export type WorkerResponse =
  | { type: 'init-result'; requestId: string }
  | { type: 'compile-result'; requestId: string; result: CompileSuccess | CompileFailure }
  | { type: 'execute-result'; requestId: string; result: ExecutionSuccess | ExecutionFailure }
  | { type: 'internal-error'; requestId: string; message: string };

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  const requestId = obj.requestId;

  if (typeof requestId !== 'string') return false;

  if (type === 'init') {
    return (
      obj.sysrootGzData instanceof ArrayBuffer &&
      obj.clangWasmData instanceof ArrayBuffer &&
      obj.ldWasmData instanceof ArrayBuffer
    );
  }

  if (type === 'compile') {
    return (
      typeof obj.language === 'string' &&
      typeof obj.sourceCode === 'string' &&
      Array.isArray(obj.flags) &&
      obj.flags.every((f: unknown) => typeof f === 'string')
    );
  }

  if (type === 'execute') {
    return (
      typeof obj.artifactId === 'string' &&
      typeof obj.stdin === 'string' &&
      typeof obj.limits === 'object' &&
      obj.limits !== null &&
      typeof obj.policy === 'object' &&
      obj.policy !== null
    );
  }

  return false;
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  const requestId = obj.requestId;

  return typeof requestId === 'string' && ['init-result', 'compile-result', 'execute-result', 'internal-error'].includes(String(type));
}
