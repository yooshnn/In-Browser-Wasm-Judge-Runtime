import { describe, expect, it } from 'vitest';
import {
  loadVendoredYowaspClang,
  resolveVendoredYowaspClangBundleUrl,
} from '../../src/internal/yowasp/loadVendoredYowaspClang.js';

describe('resolveVendoredYowaspClangBundleUrl', () => {
  it('returns the fixed vendored bundle path', () => {
    expect(resolveVendoredYowaspClangBundleUrl('https://example.test/')).toBe(
      'https://example.test/yowasp-clang/bundle.js',
    );
  });
});

describe('loadVendoredYowaspClang', () => {
  it('throws an explicit missing-bundle error when import fails', async () => {
    await expect(
      loadVendoredYowaspClang('https://example.test/', async () => {
        throw new Error('404 Not Found');
      }),
    ).rejects.toThrow(
      'Missing vendored @yowasp/clang bundle at https://example.test/yowasp-clang/bundle.js: 404 Not Found',
    );
  });

  it('accepts a module exposing runClang and runLLVM', async () => {
    const loaded = await loadVendoredYowaspClang(
      'https://example.test/',
      async () => ({
        runClang: () => ({}),
        runLLVM: () => ({}),
      }),
    );

    expect(typeof loaded.runClang).toBe('function');
    expect(typeof loaded.runLLVM).toBe('function');
  });
});
