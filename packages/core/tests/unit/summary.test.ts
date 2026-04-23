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

  it('keeps max memory when available', () => {
    const summary = summarizeTests([
      testResult('a', 'accepted', 1, 128),
      testResult('b', 'accepted', 2, 256),
      testResult('c', 'accepted', 3),
    ]);

    expect(summary.memoryBytes).toBe(256);
  });
});
