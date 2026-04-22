import type { LanguageId } from './LanguageId.js';
import type { SubmissionSource } from './SubmissionSource.js';
import type { ProblemSpec } from './ProblemSpec.js';
import type { CompileOptions } from './CompileOptions.js';
import type { JudgePolicy } from './JudgePolicy.js';

export type JudgeRequest = {
  language: LanguageId;
  submission: SubmissionSource;
  problem: ProblemSpec;
  compile: CompileOptions;
  policy: JudgePolicy;
};
