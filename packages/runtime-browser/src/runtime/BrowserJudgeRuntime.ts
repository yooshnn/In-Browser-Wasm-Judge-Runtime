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
  private terminationError: Error | null = null;
  private readonly activeRejectors = new Set<(error: Error) => void>();

  constructor(
    private readonly ports: JudgeApplicationPorts,
    private readonly getHealthImpl: () => Promise<RuntimeHealth>,
    private readonly onTerminate: (reason: Error) => void,
  ) {}

  async judge(request: JudgeRequest): Promise<JudgeResult> {
    this.assertAlive();
    return this.runUntilTerminated(coreJudge(request, this.ports));
  }

  async health(): Promise<RuntimeHealth> {
    this.assertAlive();
    return this.getHealthImpl();
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    const reason = new Error(JUDGE_RUNTIME_TERMINATED_MESSAGE);
    this.terminationError = reason;
    for (const reject of this.activeRejectors) {
      reject(reason);
    }
    this.activeRejectors.clear();
    this.onTerminate(reason);
  }

  private assertAlive(): void {
    if (!this.terminated) return;
    throw this.terminationError ?? new Error(JUDGE_RUNTIME_TERMINATED_MESSAGE);
  }

  private runUntilTerminated<T>(operation: Promise<T>): Promise<T> {
    if (this.terminationError) return Promise.reject(this.terminationError);

    return new Promise<T>((resolve, reject) => {
      const rejectOnTerminate = (error: Error): void => {
        reject(error);
      };

      this.activeRejectors.add(rejectOnTerminate);
      operation.then(
        (value) => {
          this.activeRejectors.delete(rejectOnTerminate);
          resolve(value);
        },
        (error: unknown) => {
          this.activeRejectors.delete(rejectOnTerminate);
          reject(error);
        },
      );
    });
  }
}
