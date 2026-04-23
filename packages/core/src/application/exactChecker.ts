import type { CheckerContext } from '../domain/judge/CheckerContext.js';
import type { CheckerOutcome } from '../domain/judge/CheckerOutcome.js';
import type { ExactCheckerSpec } from '../domain/judge/CheckerSpec.js';

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function normalizeTrailingWhitespace(value: string): string {
  const withoutLineTrailing = normalizeLineEndings(value)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+$/g, ''))
    .join('\n');

  return withoutLineTrailing.endsWith('\n')
    ? withoutLineTrailing.slice(0, -1)
    : withoutLineTrailing;
}

export function runExactChecker(
  spec: ExactCheckerSpec,
  context: CheckerContext,
): CheckerOutcome {
  const actual = spec.ignoreTrailingWhitespace
    ? normalizeTrailingWhitespace(context.execution.stdout)
    : context.execution.stdout;
  const expected = spec.ignoreTrailingWhitespace
    ? normalizeTrailingWhitespace(context.testCase.expected)
    : context.testCase.expected;

  return actual === expected
    ? { status: 'accepted' }
    : { status: 'wrong_answer' };
}
