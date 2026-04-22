import type { ExecutableArtifact } from '../domain/execution/ExecutableArtifact.js';
import type { ExecutionLimits } from '../domain/problem/ExecutionLimits.js';
import type { JudgePolicy } from '../domain/problem/JudgePolicy.js';
import type { ExecutionResult } from '../domain/execution/ExecutionResult.js';

export interface ExecutorPort {
  execute(
    artifact: ExecutableArtifact,
    stdin: string,
    limits: ExecutionLimits,
    policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>,
  ): Promise<ExecutionResult>;
}
