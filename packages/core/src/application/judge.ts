import type { CheckerRunnerPort } from '../ports/CheckerRunnerPort.js';
import type { CompilerPort } from '../ports/CompilerPort.js';
import type { ExecutorPort } from '../ports/ExecutorPort.js';
import type { CompileSuccess } from '../domain/execution/CompileResult.js';
import type { ExecutionResult, ExecutionSuccess } from '../domain/execution/ExecutionResult.js';
import type { JudgeResult } from '../domain/judge/JudgeResult.js';
import type { JudgeTestResult } from '../domain/judge/JudgeTestResult.js';
import type { JudgeRequest } from '../domain/problem/JudgeRequest.js';
import type { JudgeTestCase } from '../domain/problem/JudgeTestCase.js';
import { runChecker } from './checkerRunner.js';
import { resultFromCheckerOutcome, resultFromExecutionFailure } from './resultMapping.js';
import { summarizeTests } from './summary.js';

export type JudgeApplicationPorts = {
  compiler: CompilerPort;
  executor: ExecutorPort;
  checker: CheckerRunnerPort;
};

function isExecutionSuccess(result: ExecutionResult): result is ExecutionSuccess {
  return result.success;
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
