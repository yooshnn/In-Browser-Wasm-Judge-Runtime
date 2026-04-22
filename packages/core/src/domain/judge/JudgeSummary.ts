import type { JudgeStatus } from './JudgeStatus.js';

export type JudgeSummary = {
  status: JudgeStatus;
  passed: number;
  failed: number;
  total: number;
  totalElapsedMs: number;
  maxTestElapsedMs: number;
  slowestTestId?: string;
  memoryBytes?: number;
};
