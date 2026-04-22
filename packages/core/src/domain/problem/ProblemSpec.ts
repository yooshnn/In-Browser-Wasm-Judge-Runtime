import type { JudgeTestCase } from './JudgeTestCase.js';
import type { ExecutionLimits } from './ExecutionLimits.js';
import type { CheckerSpec } from '../judge/CheckerSpec.js';

export type ProblemSpec = {
  id: string;
  tests: JudgeTestCase[];
  limits: ExecutionLimits;
  checker: CheckerSpec;
};
