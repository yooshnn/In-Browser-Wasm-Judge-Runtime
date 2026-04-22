export type ExecutionSuccess = {
  success: true;
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsedMs: number;
  memoryBytes?: number;
};

export type ExecutionFailure = {
  success: false;
  status: 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'output_limit_exceeded' | 'internal_error';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  elapsedMs: number;
  memoryBytes?: number;
  reason?: string;
};

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;
