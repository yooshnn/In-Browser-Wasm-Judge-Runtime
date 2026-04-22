import type { CheckerSpec } from '../domain/judge/CheckerSpec.js';
import type { CheckerContext } from '../domain/judge/CheckerContext.js';
import type { CheckerOutcome } from '../domain/judge/CheckerOutcome.js';

export interface CheckerRunnerPort {
  run(spec: CheckerSpec, context: CheckerContext): Promise<CheckerOutcome>;
}
