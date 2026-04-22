import type { ExecutableArtifact } from './ExecutableArtifact.js';

export type CompileSuccess = {
  success: true;
  stdout: string;
  stderr: string;
  warnings: string[];
  artifact: ExecutableArtifact;
  elapsedMs: number;
};

export type CompileFailure = {
  success: false;
  stdout: string;
  stderr: string;
  errors: string[];
  elapsedMs: number;
};

export type CompileResult = CompileSuccess | CompileFailure;
