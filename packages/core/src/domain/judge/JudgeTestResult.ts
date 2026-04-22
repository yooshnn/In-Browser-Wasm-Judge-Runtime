import type { TestJudgeStatus } from './JudgeStatus.js';

export type JudgeTestResult = {
  id: string;
  status: TestJudgeStatus;
  elapsedMs: number;
  memoryBytes?: number;
  message?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
};
