import type { RuntimeHealth } from '@cupya.me/wasm-judge-runtime-core';
import { createCheckerRunner } from '@cupya.me/wasm-judge-runtime-core';
import { BrowserCompilerPort } from './adapters/compiler/BrowserCompilerPort.js';
import { BrowserExecutorPort } from './adapters/executor/BrowserExecutorPort.js';
import type { JudgeRuntime, RuntimeBootstrapOptions } from './publicTypes.js';
import { resolveBootstrapOptions } from './bootstrap/resolveBootstrapOptions.js';
import { BrowserJudgeRuntime } from './runtime/BrowserJudgeRuntime.js';

export type { RuntimeBootstrapOptions } from './publicTypes.js';
export type { JudgeRuntime } from './publicTypes.js';

export async function createJudgeRuntime(
  options: RuntimeBootstrapOptions = {},
): Promise<JudgeRuntime & { terminate(): void }> {
  const resolved = resolveBootstrapOptions(options);

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

  const getHealth = async (): Promise<RuntimeHealth> => ({
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
  });

  const runtime = new BrowserJudgeRuntime(
    { compiler, executor, checker },
    getHealth,
    (reason) => {
      compiler.dispose(reason);
      compilerWorker.terminate();
    },
  );

  try {
    await compiler.init();
    artifactsState.compilerLoaded = true;
    artifactsState.sysrootLoaded = true;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    compiler.dispose(err);
    compilerWorker.terminate();
    throw err;
  }

  return runtime;
}
