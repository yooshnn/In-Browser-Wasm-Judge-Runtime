import type {
  JudgeApplicationPorts,
  JudgeRequest,
  JudgeResult,
  RuntimeHealth,
} from '@cupya.me/wasm-judge-runtime-core';
import { judge as coreJudge } from '@cupya.me/wasm-judge-runtime-core';
import type { JudgeRuntime } from '../publicTypes.js';

export const JUDGE_RUNTIME_TERMINATED_MESSAGE = 'JudgeRuntime has been terminated';

export class BrowserJudgeRuntime implements JudgeRuntime {
  private terminated = false;

  constructor(
    private readonly ports: JudgeApplicationPorts,
    private readonly getHealthImpl: () => Promise<RuntimeHealth>,
    private readonly onTerminate: (reason: Error) => void,
  ) {}

  async judge(request: JudgeRequest): Promise<JudgeResult> {
    this.assertAlive();
    return coreJudge(request, this.ports);
  }

  async health(): Promise<RuntimeHealth> {
    this.assertAlive();
    return this.getHealthImpl();
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.onTerminate(new Error(JUDGE_RUNTIME_TERMINATED_MESSAGE));
  }

  private assertAlive(): void {
    if (!this.terminated) return;
    throw new Error(JUDGE_RUNTIME_TERMINATED_MESSAGE);
  }
}

