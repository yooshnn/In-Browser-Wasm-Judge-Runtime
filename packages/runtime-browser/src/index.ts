import type {
  CheckerRegistry,
  JudgeRequest,
  JudgeResult,
  RuntimeHealth,
} from '@cupya.me/wasm-judge-runtime-core';
import { createCheckerRunner, judge } from '@cupya.me/wasm-judge-runtime-core';
import { BrowserCompilerPort } from './adapters/compiler/BrowserCompilerPort.js';
import { BrowserExecutorPort } from './adapters/executor/BrowserExecutorPort.js';

export type RuntimeBootstrapOptions = {
  artifactBaseUrl?: string;
  sysrootUrl?: string;
  yowaspClangBundleUrl?: string;
  checkers?: CheckerRegistry;
  version?: string;
  createCompilerWorker?: () => Worker;
  createExecutionWorker?: () => Worker;
};

export interface JudgeRuntime {
  judge(request: JudgeRequest): Promise<JudgeResult>;
  health(): Promise<RuntimeHealth>;
}

function defaultArtifactBaseUrl(): string {
  const href = globalThis.location?.href;
  if (typeof href !== 'string') {
    throw new Error('artifactBaseUrl is required when globalThis.location is unavailable');
  }
  return new URL('/', href).href;
}

function resolveUrl(input: string, baseHref: string): string {
  try {
    return new URL(input).href;
  } catch {
    try {
      return new URL(input, baseHref).href;
    } catch {
      throw new Error(`Invalid URL: ${input}`);
    }
  }
}

export async function createJudgeRuntime(
  options: RuntimeBootstrapOptions = {},
): Promise<JudgeRuntime & { terminate(): void }> {
  const locationHref = globalThis.location?.href;
  const baseForRelative = typeof locationHref === 'string' ? locationHref : null;

  const artifactBaseUrl = (() => {
    if (!options.artifactBaseUrl) return defaultArtifactBaseUrl();
    if (baseForRelative) return resolveUrl(options.artifactBaseUrl, baseForRelative);
    try {
      return new URL(options.artifactBaseUrl).href;
    } catch {
      throw new Error('artifactBaseUrl must be an absolute URL when globalThis.location is unavailable');
    }
  })();

  const sysrootUrl = options.sysrootUrl
    ? resolveUrl(options.sysrootUrl, artifactBaseUrl)
    : new URL('sysroot.tar.gz', artifactBaseUrl).href;

  const yowaspClangBundleUrl = options.yowaspClangBundleUrl
    ? resolveUrl(options.yowaspClangBundleUrl, artifactBaseUrl)
    : new URL('yowasp-clang/bundle.js', artifactBaseUrl).href;
  const version = options.version ?? 'dev';

  let terminated = false;
  const artifactsState = { compilerLoaded: false, sysrootLoaded: false };

  let compilerWorker: Worker;
  try {
    compilerWorker =
      options.createCompilerWorker?.() ??
      new Worker(new URL('./worker/runtimeWorker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const compiler = new BrowserCompilerPort(compilerWorker, sysrootUrl, yowaspClangBundleUrl);
  const executor = new BrowserExecutorPort(
    options.createExecutionWorker ??
      (() => new Worker(new URL('./worker/executionWorker.ts', import.meta.url), { type: 'module' })),
  );
  const checker = createCheckerRunner(options.checkers ?? {});

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
        version,
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
