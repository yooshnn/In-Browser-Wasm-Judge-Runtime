import type { ExecutionFailure, ExecutionSuccess } from '../domain/execution/ExecutionResult.js';
import type { CheckerOutcome } from '../domain/judge/CheckerOutcome.js';
import type { JudgeTestResult } from '../domain/judge/JudgeTestResult.js';
import type { JudgeTestCase } from '../domain/problem/JudgeTestCase.js';

export function resultFromExecutionFailure(
  testCase: JudgeTestCase,
  execution: ExecutionFailure,
): JudgeTestResult {
  return {
    id: testCase.id,
    status: execution.status,
    elapsedMs: execution.elapsedMs,
    ...(execution.memoryBytes === undefined ? {} : { memoryBytes: execution.memoryBytes }),
    ...(execution.reason === undefined ? {} : { message: execution.reason }),
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: execution.exitCode,
  };
}

export function resultFromCheckerOutcome(
  testCase: JudgeTestCase,
  execution: ExecutionSuccess,
  outcome: CheckerOutcome,
): JudgeTestResult {
  return {
    id: testCase.id,
    status: outcome.status,
    elapsedMs: execution.elapsedMs,
    ...(execution.memoryBytes === undefined ? {} : { memoryBytes: execution.memoryBytes }),
    ...(outcome.message === undefined ? {} : { message: outcome.message }),
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: execution.exitCode,
  };
}
