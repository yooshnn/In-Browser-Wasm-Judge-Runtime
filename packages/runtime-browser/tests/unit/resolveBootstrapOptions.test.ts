import { describe, expect, it, vi } from 'vitest';
import { resolveBootstrapOptions } from '../../src/bootstrap/resolveBootstrapOptions.js';

describe('resolveBootstrapOptions', () => {
  it('defaults artifactBaseUrl/sysrootUrl/yowaspClangBundleUrl from location.href', () => {
    vi.stubGlobal('location', { href: 'https://example.test/app/page' } as any);

    const resolved = resolveBootstrapOptions({ version: 'v1' });
    expect(resolved.artifactBaseUrl).toBe('https://example.test/');
    expect(resolved.sysrootUrl).toBe('https://example.test/sysroot.tar.gz');
    expect(resolved.yowaspClangBundleUrl).toBe('https://example.test/yowasp-clang/bundle.js');
    expect(resolved.version).toBe('v1');

    vi.unstubAllGlobals();
  });

  it('resolves relative artifactBaseUrl against location.href', () => {
    vi.stubGlobal('location', { href: 'https://example.test/app/page' } as any);

    const resolved = resolveBootstrapOptions({ artifactBaseUrl: '/sub/' });
    expect(resolved.artifactBaseUrl).toBe('https://example.test/sub/');
    expect(resolved.sysrootUrl).toBe('https://example.test/sub/sysroot.tar.gz');
    expect(resolved.yowaspClangBundleUrl).toBe('https://example.test/sub/yowasp-clang/bundle.js');

    vi.unstubAllGlobals();
  });

  it('resolves sysrootUrl and yowaspClangBundleUrl overrides against artifactBaseUrl', () => {
    vi.stubGlobal('location', { href: 'https://example.test/app/page' } as any);

    const resolved = resolveBootstrapOptions({
      artifactBaseUrl: 'https://cdn.example.test/base/',
      sysrootUrl: 'assets/sysroot.tar.gz',
      yowaspClangBundleUrl: 'assets/yowasp/bundle.js',
    });

    expect(resolved.sysrootUrl).toBe('https://cdn.example.test/base/assets/sysroot.tar.gz');
    expect(resolved.yowaspClangBundleUrl).toBe('https://cdn.example.test/base/assets/yowasp/bundle.js');

    vi.unstubAllGlobals();
  });

  it('throws when location is unavailable and artifactBaseUrl is missing', () => {
    const saved = (globalThis as any).location;
    // Ensure location is truly missing regardless of previous stubs.
    try {
      delete (globalThis as any).location;
    } catch {
      (globalThis as any).location = undefined;
    }

    expect(() => resolveBootstrapOptions({})).toThrow(/artifactBaseUrl is required/i);

    (globalThis as any).location = saved;
  });

  it('accepts an absolute artifactBaseUrl when location is unavailable', () => {
    const saved = (globalThis as any).location;
    try {
      delete (globalThis as any).location;
    } catch {
      (globalThis as any).location = undefined;
    }

    const resolved = resolveBootstrapOptions({ artifactBaseUrl: 'https://cdn.example.test/app/' });
    expect(resolved.artifactBaseUrl).toBe('https://cdn.example.test/app/');

    (globalThis as any).location = saved;
  });
});

