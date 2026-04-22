import type { JudgeTestCase } from '../problem/JudgeTestCase.js';
import type { ExecutionSuccess } from '../execution/ExecutionResult.js';

export type CheckerContext = {
  testCase: JudgeTestCase;
  execution: ExecutionSuccess;
};
