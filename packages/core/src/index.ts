// Domain: Problem
export type { LanguageId } from './domain/problem/LanguageId.js';
export type { SubmissionSource } from './domain/problem/SubmissionSource.js';
export type { JudgeTestCase } from './domain/problem/JudgeTestCase.js';
export type { ExecutionLimits } from './domain/problem/ExecutionLimits.js';
export type { CompileOptions } from './domain/problem/CompileOptions.js';
export type { JudgePolicy } from './domain/problem/JudgePolicy.js';
export type { ProblemSpec } from './domain/problem/ProblemSpec.js';
export type { JudgeRequest } from './domain/problem/JudgeRequest.js';

// Domain: Judge
export type { ExactCheckerSpec, CustomCheckerSpec, CheckerSpec } from './domain/judge/CheckerSpec.js';
export type { CheckerContext } from './domain/judge/CheckerContext.js';
export type { CheckerOutcome } from './domain/judge/CheckerOutcome.js';
export type { CheckerFunction } from './domain/judge/CheckerFunction.js';
export type { JudgeStatus, TestJudgeStatus } from './domain/judge/JudgeStatus.js';
export type { JudgeSummary } from './domain/judge/JudgeSummary.js';
export type { JudgeTestResult } from './domain/judge/JudgeTestResult.js';
export type { JudgeResult } from './domain/judge/JudgeResult.js';

// Domain: Execution
export type { ExecutableArtifact } from './domain/execution/ExecutableArtifact.js';
export type { CompileSuccess, CompileFailure, CompileResult } from './domain/execution/CompileResult.js';
export type { ExecutionSuccess, ExecutionFailure, ExecutionResult } from './domain/execution/ExecutionResult.js';
export type { RuntimeHealth } from './domain/execution/RuntimeHealth.js';

// Ports
export type { CompilerPort } from './ports/CompilerPort.js';
export type { ExecutorPort } from './ports/ExecutorPort.js';
export type { CheckerRunnerPort } from './ports/CheckerRunnerPort.js';
export type { RuntimeHealthPort } from './ports/RuntimeHealthPort.js';
