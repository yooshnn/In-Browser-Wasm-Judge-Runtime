import type { CheckerRunnerPort } from '../ports/CheckerRunnerPort.js';
import type { CompilerPort } from '../ports/CompilerPort.js';
import type { ExecutorPort } from '../ports/ExecutorPort.js';
import type { CompileSuccess } from '../domain/execution/CompileResult.js';
import type { ExecutionFailure, ExecutionResult, ExecutionSuccess } from '../domain/execution/ExecutionResult.js';
import type { CheckerOutcome } from '../domain/judge/CheckerOutcome.js';
import type { CheckerSpec } from '../domain/judge/CheckerSpec.js';
import type { JudgeResult } from '../domain/judge/JudgeResult.js';
import type { JudgeStatus, TestJudgeStatus } from '../domain/judge/JudgeStatus.js';
import type { JudgeSummary } from '../domain/judge/JudgeSummary.js';
import type { JudgeTestResult } from '../domain/judge/JudgeTestResult.js';
import type { JudgeRequest } from '../domain/problem/JudgeRequest.js';
import type { JudgeTestCase } from '../domain/problem/JudgeTestCase.js';
import { runExactChecker } from './exactChecker.js';

export type JudgeApplicationPorts = {
  compiler: CompilerPort;
  executor: ExecutorPort;
  checker: CheckerRunnerPort;
};

const STATUS_PRIORITY: TestJudgeStatus[] = [
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'output_limit_exceeded',
  'runtime_error',
  'internal_error',
  'wrong_answer',
  'accepted',
];

function isExecutionSuccess(result: ExecutionResult): result is ExecutionSuccess {
  return result.success;
}

function resultFromExecutionFailure(testCase: JudgeTestCase, execution: ExecutionFailure): JudgeTestResult {
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

function resultFromCheckerOutcome(
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

function statusFromTests(tests: JudgeTestResult[]): JudgeStatus {
  for (const status of STATUS_PRIORITY) {
    if (tests.some((test) => test.status === status)) return status;
  }
  return 'accepted';
}

function summarizeTests(tests: JudgeTestResult[]): JudgeSummary {
  let maxTestElapsedMs = 0;
  let slowestTestId: string | undefined;
  let memoryBytes: number | undefined;

  for (const test of tests) {
    if (test.elapsedMs > maxTestElapsedMs) {
      maxTestElapsedMs = test.elapsedMs;
      slowestTestId = test.id;
    }
    if (test.memoryBytes !== undefined) {
      memoryBytes = Math.max(memoryBytes ?? 0, test.memoryBytes);
    }
  }

  const summary: JudgeSummary = {
    status: statusFromTests(tests),
    passed: tests.filter((test) => test.status === 'accepted').length,
    failed: tests.filter((test) => test.status !== 'accepted').length,
    total: tests.length,
    totalElapsedMs: tests.reduce((sum, test) => sum + test.elapsedMs, 0),
    maxTestElapsedMs,
  };

  if (slowestTestId !== undefined) summary.slowestTestId = slowestTestId;
  if (memoryBytes !== undefined) summary.memoryBytes = memoryBytes;

  return summary;
}

async function runChecker(
  spec: CheckerSpec,
  testCase: JudgeTestCase,
  execution: ExecutionSuccess,
  ports: JudgeApplicationPorts,
): Promise<CheckerOutcome> {
  try {
    if (spec.kind === 'exact') {
      return runExactChecker(spec, { testCase, execution });
    }

    void ports.checker;
    return {
      status: 'internal_error',
      message: `custom checker is not implemented yet: ${spec.checkerId}`,
    };
  } catch (error) {
    return {
      status: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeAndCheckTest(
  compile: CompileSuccess,
  request: JudgeRequest,
  testCase: JudgeTestCase,
  ports: JudgeApplicationPorts,
): Promise<JudgeTestResult> {
  const execution = await ports.executor.execute(
    compile.artifact,
    testCase.stdin,
    request.problem.limits,
    {
      stdoutLimitBytes: request.policy.stdoutLimitBytes,
      stderrLimitBytes: request.policy.stderrLimitBytes,
    },
  );

  if (!isExecutionSuccess(execution)) {
    return resultFromExecutionFailure(testCase, execution);
  }

  const outcome = await runChecker(request.problem.checker, testCase, execution, ports);
  return resultFromCheckerOutcome(testCase, execution, outcome);
}

export async function judge(
  request: JudgeRequest,
  ports: JudgeApplicationPorts,
): Promise<JudgeResult> {
  const compile = await ports.compiler.compile(
    request.language,
    request.submission,
    request.compile,
  );

  if (!compile.success) {
    return { phase: 'compile', ok: false, compile };
  }

  const tests: JudgeTestResult[] = [];
  for (const testCase of request.problem.tests) {
    const result = await executeAndCheckTest(compile, request, testCase, ports);
    tests.push(result);

    if (request.policy.stopOnFirstFailure && result.status !== 'accepted') {
      break;
    }
  }

  const summary = summarizeTests(tests);
  return {
    phase: 'finished',
    ok: summary.status === 'accepted',
    compile,
    summary,
    tests,
  };
}
