import type {
  JudgeRequest,
  JudgeResult,
  RuntimeHealth,
} from '@cupya.me/wasm-judge-runtime-core';

export const RUNTIME_NODE_NOT_IMPLEMENTED_MESSAGE =
  '@cupya.me/wasm-judge-runtime-node is not implemented yet';

export class NotImplementedError extends Error {
  constructor(message: string = RUNTIME_NODE_NOT_IMPLEMENTED_MESSAGE) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export type NodeRuntimeBootstrapOptions = Record<string, never>;

export interface JudgeRuntime {
  judge(request: JudgeRequest): Promise<JudgeResult>;
  health(): Promise<RuntimeHealth>;
  terminate(): void;
}

export async function createJudgeRuntime(
  _options: NodeRuntimeBootstrapOptions = {},
): Promise<JudgeRuntime> {
  throw new NotImplementedError();
}
