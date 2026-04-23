import type {
  JudgeRequest,
  JudgeResult,
  RuntimeHealth,
} from '@cupya.me/wasm-judge-runtime-core';
import { createCheckerRunner, judge } from '@cupya.me/wasm-judge-runtime-core';
import { BrowserCompilerPort } from './adapters/compiler/BrowserCompilerPort.js';
import { BrowserExecutorPort } from './adapters/executor/BrowserExecutorPort.js';
import type { JudgeRuntime, RuntimeBootstrapOptions } from './publicTypes.js';
import { resolveBootstrapOptions } from './bootstrap/resolveBootstrapOptions.js';

export type { RuntimeBootstrapOptions } from './publicTypes.js';
export type { JudgeRuntime } from './publicTypes.js';

export async function createJudgeRuntime(
  options: RuntimeBootstrapOptions = {},
): Promise<JudgeRuntime & { terminate(): void }> {
  const resolved = resolveBootstrapOptions(options);

  let terminated = false;
  const artifactsState = { compilerLoaded: false, sysrootLoaded: false };

  let compilerWorker: Worker;
  try {
    compilerWorker = resolved.createCompilerWorker();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const compiler = new BrowserCompilerPort(
    compilerWorker,
    resolved.sysrootUrl,
    resolved.yowaspClangBundleUrl,
  );
  const executor = new BrowserExecutorPort(resolved.createExecutionWorker);
  const checker = createCheckerRunner(resolved.checkers);

  const terminate = (): void => {
    if (terminated) return;
    terminated = true;
    compilerWorker.terminate();
  };

  try {
    await compiler.init();
    artifactsState.compilerLoaded = true;
    artifactsState.sysrootLoaded = true;
  } catch (error) {
    terminate();
    throw error instanceof Error ? error : new Error(String(error));
  }

  return {
    async judge(request: JudgeRequest): Promise<JudgeResult> {
      if (terminated) throw new Error('JudgeRuntime has been terminated');
      return judge(request, { compiler, executor, checker });
    },
    async health(): Promise<RuntimeHealth> {
      if (terminated) throw new Error('JudgeRuntime has been terminated');
      return {
        ready: artifactsState.compilerLoaded && artifactsState.sysrootLoaded,
        version: resolved.version,
        capabilities: {
          languages: ['cpp'],
          stdioJudge: true,
          jsChecker: true,
        },
        artifacts: {
          compilerLoaded: artifactsState.compilerLoaded,
          sysrootLoaded: artifactsState.sysrootLoaded,
        },
      };
    },
    terminate,
  };
}

