import type { CheckerRegistry } from '@cupya.me/wasm-judge-runtime-core';
import type { RuntimeBootstrapOptions } from '../publicTypes.js';

export type ResolvedBootstrapOptions = {
  artifactBaseUrl: string;
  sysrootUrl: string;
  yowaspClangBundleUrl: string;
  checkers: CheckerRegistry;
  version: string;
  createCompilerWorker: () => Worker;
  createExecutionWorker: () => Worker;
};

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

function defaultArtifactBaseUrl(): string {
  const href = globalThis.location?.href;
  if (typeof href !== 'string') {
    throw new Error('artifactBaseUrl is required when globalThis.location is unavailable');
  }
  return new URL('/', href).href;
}

export function resolveBootstrapOptions(
  options: RuntimeBootstrapOptions = {},
): ResolvedBootstrapOptions {
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

  return {
    artifactBaseUrl,
    sysrootUrl,
    yowaspClangBundleUrl,
    checkers: options.checkers ?? {},
    version: options.version ?? 'dev',
    createCompilerWorker:
      options.createCompilerWorker ??
      (() => new Worker(new URL('../worker/runtimeWorker.js', import.meta.url), { type: 'module' })),
    createExecutionWorker:
      options.createExecutionWorker ??
      (() => new Worker(new URL('../worker/executionWorker.js', import.meta.url), { type: 'module' })),
  };
}
