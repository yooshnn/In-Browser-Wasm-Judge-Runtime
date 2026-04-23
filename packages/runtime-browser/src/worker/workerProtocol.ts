import type { CompileSuccess, CompileFailure } from '@cupya.me/wasm-judge-runtime-core';

export type WorkerRequest =
  | {
      type: 'init';
      requestId: string;
      sysrootGzData: ArrayBuffer; // transferable; worker decompresses and parses
      yowaspClangBundleUrl: string;
    }
  | {
      type: 'compile';
      requestId: string;
      language: 'cpp';
      sourceCode: string;
      flags: string[];
    };

export type WorkerResponse =
  | { type: 'init-result'; requestId: string }
  | { type: 'compile-result'; requestId: string; result: CompileSuccess | CompileFailure }
  | { type: 'internal-error'; requestId: string; message: string };

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  const requestId = obj.requestId;

  if (typeof requestId !== 'string') return false;

  if (type === 'init') {
    return obj.sysrootGzData instanceof ArrayBuffer && typeof obj.yowaspClangBundleUrl === 'string';
  }

  if (type === 'compile') {
    return (
      typeof obj.language === 'string' &&
      typeof obj.sourceCode === 'string' &&
      Array.isArray(obj.flags) &&
      obj.flags.every((f: unknown) => typeof f === 'string')
    );
  }

  return false;
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  const requestId = obj.requestId;

  return typeof requestId === 'string' && ['init-result', 'compile-result', 'internal-error'].includes(String(type));
}
