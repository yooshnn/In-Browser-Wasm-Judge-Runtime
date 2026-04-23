import type {
  CheckerRegistry,
  JudgeRequest,
  JudgeResult,
  RuntimeHealth,
} from '@cupya.me/wasm-judge-runtime-core';

export type RuntimeBootstrapOptions = {
  artifactBaseUrl?: string;
  sysrootUrl?: string;
  yowaspClangBundleUrl?: string;
  checkers?: CheckerRegistry;
  version?: string;
  createCompilerWorker?: () => Worker;
  createExecutionWorker?: () => Worker;
};

export interface JudgeRuntime {
  judge(request: JudgeRequest): Promise<JudgeResult>;
  health(): Promise<RuntimeHealth>;
}

