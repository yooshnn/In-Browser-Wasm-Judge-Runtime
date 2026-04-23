import type { RuntimeHealthPort } from '@cupya.me/wasm-judge-runtime-core';
import type { RuntimeHealth } from '@cupya.me/wasm-judge-runtime-core';

export class BrowserRuntimeHealthPort implements RuntimeHealthPort {
  constructor(
    private readonly state: { compilerLoaded: boolean; sysrootLoaded: boolean },
    private readonly version: string = 'dev',
  ) {}

  async getHealth(): Promise<RuntimeHealth> {
    return {
      ready: this.state.compilerLoaded && this.state.sysrootLoaded,
      version: this.version,
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
