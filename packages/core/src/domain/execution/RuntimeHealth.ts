import type { LanguageId } from '../problem/LanguageId.js';

export type RuntimeHealth = {
  ready: boolean;
  version: string;
  capabilities: {
    languages: LanguageId[];
    stdioJudge: true;
    jsChecker: true;
  };
  artifacts: {
    compilerLoaded: boolean;
    sysrootLoaded: boolean;
  };
};
