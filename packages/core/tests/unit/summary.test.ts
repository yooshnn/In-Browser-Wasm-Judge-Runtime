import { describe, expect, it } from 'vitest';
import type { JudgeTestResult } from '../../src/index.js';
import { summarizeTests } from '../../src/application/summary.js';

function testResult(
  id: string,
  status: JudgeTestResult['status'],
  elapsedMs: number,
  memoryBytes?: number,
): JudgeTestResult {
  return {
    id,
    status,
    elapsedMs,
    ...(memoryBytes === undefined ? {} : { memoryBytes }),
  };
}

describe('summarizeTests', () => {
  it('uses status priority instead of result order', () => {
    const summary = summarizeTests([
      testResult('wa', 'wrong_answer', 3),
      testResult('tle', 'time_limit_exceeded', 2),
      testResult('ac', 'accepted', 1),
    ]);

    expect(summary.status).toBe('time_limit_exceeded');
    expect(summary).toMatchObject({
      passed: 1,
      failed: 2,
      total: 3,
      totalElapsedMs: 6,
      maxTestElapsedMs: 3,
      slowestTestId: 'wa',
    });
  });

  it.each([
    [['accepted', 'wrong_answer'], 'wrong_answer'],
    [['wrong_answer', 'internal_error'], 'internal_error'],
    [['internal_error', 'runtime_error'], 'runtime_error'],
    [['runtime_error', 'output_limit_exceeded'], 'output_limit_exceeded'],
    [['output_limit_exceeded', 'memory_limit_exceeded'], 'memory_limit_exceeded'],
    [['memory_limit_exceeded', 'time_limit_exceeded'], 'time_limit_exceeded'],
  ] satisfies Array<[JudgeTestResult['status'][], JudgeTestResult['status']]>)(
    'selects %s according to full status priority',
    (statuses, expected) => {
      const summary = summarizeTests(statuses.map((status, index) => testResult(`${status}-${index}`, status, index + 1)));

      expect(summary.status).toBe(expected);
    },
  );

  it('keeps max memory when available', () => {
    const summary = summarizeTests([
      testResult('a', 'accepted', 1, 128),
      testResult('b', 'accepted', 2, 256),
      testResult('c', 'accepted', 3),
    ]);

    expect(summary.memoryBytes).toBe(256);
  });
});
