import type { CheckerContext } from '../domain/judge/CheckerContext.js';
import type { CheckerFunction } from '../domain/judge/CheckerFunction.js';
import type { CheckerOutcome } from '../domain/judge/CheckerOutcome.js';
import type { CheckerSpec } from '../domain/judge/CheckerSpec.js';
import type { CheckerRunnerPort } from '../ports/CheckerRunnerPort.js';
import { runExactChecker } from './exactChecker.js';

export type CheckerRegistry = Record<string, CheckerFunction>;

function internalError(message: string): CheckerOutcome {
  return { status: 'internal_error', message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCheckerRunner(checkers: CheckerRegistry): CheckerRunnerPort {
  return {
    async run(spec: CheckerSpec, context: CheckerContext): Promise<CheckerOutcome> {
      try {
        if (spec.kind === 'exact') {
          return runExactChecker(spec, context);
        }

        const checker = checkers[spec.checkerId];
        if (!checker) {
          return internalError(`custom checker is not registered: ${spec.checkerId}`);
        }

        return await checker(context);
      } catch (error) {
        return internalError(errorMessage(error));
      }
    },
  };
}
