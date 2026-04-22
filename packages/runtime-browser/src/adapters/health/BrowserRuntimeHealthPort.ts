import type { RuntimeHealthPort } from '@cupya.me/wasm-judge-runtime-core';
import type { RuntimeHealth } from '@cupya.me/wasm-judge-runtime-core';

export class BrowserRuntimeHealthPort implements RuntimeHealthPort {
  // Phase 1: compilerLoaded = artifact fetch complete (not full module init)
  constructor(private readonly state: { compilerLoaded: boolean; sysrootLoaded: boolean }) {}

  async getHealth(): Promise<RuntimeHealth> {
    return {
      ready: this.state.compilerLoaded && this.state.sysrootLoaded,
      version: 'dev',
      capabilities: {
        languages: ['cpp'],
        stdioJudge: true,
        jsChecker: true,
      },
      artifacts: {
        compilerLoaded: this.state.compilerLoaded,
        sysrootLoaded: this.state.sysrootLoaded,
      },
    };
  }
}
