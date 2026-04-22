import type { CheckerContext } from './CheckerContext.js';
import type { CheckerOutcome } from './CheckerOutcome.js';

export type CheckerFunction = (
  context: CheckerContext,
) => CheckerOutcome | Promise<CheckerOutcome>;
