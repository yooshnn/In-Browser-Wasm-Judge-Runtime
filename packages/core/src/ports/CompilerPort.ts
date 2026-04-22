import type { LanguageId } from '../domain/problem/LanguageId.js';
import type { SubmissionSource } from '../domain/problem/SubmissionSource.js';
import type { CompileOptions } from '../domain/problem/CompileOptions.js';
import type { CompileResult } from '../domain/execution/CompileResult.js';

export interface CompilerPort {
  compile(
    language: LanguageId,
    source: SubmissionSource,
    options: CompileOptions,
  ): Promise<CompileResult>;
}
