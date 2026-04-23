import type { JudgeStatus, TestJudgeStatus } from '../domain/judge/JudgeStatus.js';
import type { JudgeSummary } from '../domain/judge/JudgeSummary.js';
import type { JudgeTestResult } from '../domain/judge/JudgeTestResult.js';

const STATUS_PRIORITY: TestJudgeStatus[] = [
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'output_limit_exceeded',
  'runtime_error',
  'internal_error',
  'wrong_answer',
  'accepted',
];

export function statusFromTests(tests: JudgeTestResult[]): JudgeStatus {
  for (const status of STATUS_PRIORITY) {
    if (tests.some((test) => test.status === status)) return status;
  }
  return 'accepted';
}

export function summarizeTests(tests: JudgeTestResult[]): JudgeSummary {
  let maxTestElapsedMs = 0;
  let slowestTestId: string | undefined;
  let memoryBytes: number | undefined;

  for (const test of tests) {
    if (test.elapsedMs > maxTestElapsedMs) {
      maxTestElapsedMs = test.elapsedMs;
      slowestTestId = test.id;
    }
    if (test.memoryBytes !== undefined) {
      memoryBytes = Math.max(memoryBytes ?? 0, test.memoryBytes);
    }
  }

  const summary: JudgeSummary = {
    status: statusFromTests(tests),
    passed: tests.filter((test) => test.status === 'accepted').length,
    failed: tests.filter((test) => test.status !== 'accepted').length,
    total: tests.length,
    totalElapsedMs: tests.reduce((sum, test) => sum + test.elapsedMs, 0),
    maxTestElapsedMs,
  };

  if (slowestTestId !== undefined) summary.slowestTestId = slowestTestId;
  if (memoryBytes !== undefined) summary.memoryBytes = memoryBytes;

  return summary;
}
