import type { ExecutionSuccess } from '../domain/execution/ExecutionResult.js';
import type { CheckerOutcome } from '../domain/judge/CheckerOutcome.js';
import type { CheckerSpec } from '../domain/judge/CheckerSpec.js';
import type { JudgeTestCase } from '../domain/problem/JudgeTestCase.js';
import type { JudgeApplicationPorts } from './judge.js';
import { runExactChecker } from './exactChecker.js';

export async function runChecker(
  spec: CheckerSpec,
  testCase: JudgeTestCase,
  execution: ExecutionSuccess,
  ports: JudgeApplicationPorts,
): Promise<CheckerOutcome> {
  try {
    if (spec.kind === 'exact') {
      return runExactChecker(spec, { testCase, execution });
    }

    return await ports.checker.run(spec, { testCase, execution });
  } catch (error) {
    return {
      status: 'internal_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
