export type YowaspTree = {
  [name: string]: YowaspTree | string | Uint8Array;
};

export type YowaspRunOptions = {
  stdin?: ((byteLength: number) => Uint8Array | null) | null;
  stdout?: ((bytes: Uint8Array | null) => void) | null;
  stderr?: ((bytes: Uint8Array | null) => void) | null;
  decodeASCII?: boolean;
  synchronously?: boolean;
  fetchProgress?: ((event: { source: object; totalLength: number; doneLength: number }) => void) | void;
};

export type YowaspCommand = (
  args?: string[],
  files?: YowaspTree,
  options?: YowaspRunOptions,
) => Promise<YowaspTree> | YowaspTree | undefined;

export type YowaspCompilerModule = {
  runClang: YowaspCommand;
  runLLVM: YowaspCommand;
};

export const YOWASP_CLANG_ARTIFACT_DIR = '/yowasp-clang';
export const YOWASP_CLANG_BUNDLE_ENTRY = 'bundle.js';
export const YOWASP_CLANG_METADATA_ENTRY = 'metadata.json';

export function resolveVendoredYowaspClangBundleUrl(origin: string): string {
  return new URL(`${YOWASP_CLANG_ARTIFACT_DIR}/${YOWASP_CLANG_BUNDLE_ENTRY}`, origin).href;
}

type ModuleImporter = (url: string) => Promise<unknown>;

async function importVendoredModule(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

function isCompilerModule(value: unknown): value is YowaspCompilerModule {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.runClang === 'function' && typeof record.runLLVM === 'function';
}

export async function loadVendoredYowaspClangFromBundleUrl(
  bundleUrl: string,
  importer: ModuleImporter = importVendoredModule,
): Promise<YowaspCompilerModule> {
  let loaded: unknown;
  try {
    loaded = await importer(bundleUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing vendored @yowasp/clang bundle at ${bundleUrl}: ${reason}`);
  }

  if (!isCompilerModule(loaded)) {
    throw new Error(`Invalid vendored @yowasp/clang bundle at ${bundleUrl}`);
  }

  return loaded;
}

export async function loadVendoredYowaspClang(
  origin: string,
  importer: ModuleImporter = importVendoredModule,
): Promise<YowaspCompilerModule> {
  const bundleUrl = resolveVendoredYowaspClangBundleUrl(origin);
  return loadVendoredYowaspClangFromBundleUrl(bundleUrl, importer);
}
