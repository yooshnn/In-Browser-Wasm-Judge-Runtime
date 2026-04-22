import type { CompileFailure } from '../execution/CompileResult.js';
import type { CompileSuccess } from '../execution/CompileResult.js';
import type { JudgeSummary } from './JudgeSummary.js';
import type { JudgeTestResult } from './JudgeTestResult.js';

export type JudgeResult =
  | { phase: 'compile'; ok: false; compile: CompileFailure }
  | { phase: 'finished'; ok: boolean; compile: CompileSuccess; summary: JudgeSummary; tests: JudgeTestResult[] };
