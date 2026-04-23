import type { RuntimeHealth } from '@cupya.me/wasm-judge-runtime-core';
import { createCheckerRunner } from '@cupya.me/wasm-judge-runtime-core';
import { BrowserCompilerPort } from './adapters/compiler/BrowserCompilerPort.js';
import { BrowserExecutorPort } from './adapters/executor/BrowserExecutorPort.js';
import { BrowserRuntimeHealthPort } from './adapters/health/BrowserRuntimeHealthPort.js';
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
    throw withBootstrapContext('Failed to create compiler worker', error);
  }

  const compiler = new BrowserCompilerPort(
    compilerWorker,
    resolved.sysrootUrl,
    resolved.yowaspClangBundleUrl,
  );
  const executor = new BrowserExecutorPort(resolved.createExecutionWorker);
  const checker = createCheckerRunner(resolved.checkers);

  const healthPort = new BrowserRuntimeHealthPort(artifactsState, resolved.version);
  const getHealth = (): Promise<RuntimeHealth> => healthPort.getHealth();

  const runtime = new BrowserJudgeRuntime(
    { compiler, executor, checker },
    getHealth,
    (reason) => {
      compiler.dispose(reason);
      executor.dispose(reason);
      compilerWorker.terminate();
    },
  );

  try {
    await compiler.init();
    artifactsState.compilerLoaded = true;
    artifactsState.sysrootLoaded = true;
  } catch (error) {
    const err = withBootstrapContext('Failed to bootstrap browser judge runtime', error);
    compiler.dispose(err);
    executor.dispose(err);
    compilerWorker.terminate();
    throw err;
  }

  return runtime;
}

function withBootstrapContext(context: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`${context}: ${reason}`);
}
