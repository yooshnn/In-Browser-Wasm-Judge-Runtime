import { describe, it, expect } from 'vitest';
import type { JudgeRequest } from '@cupya.me/wasm-judge-runtime-core';
import { createJudgeRuntime } from '@cupya.me/wasm-judge-runtime-browser';

const DEFAULT_LIMITS = {
  timeLimitMs: 5000,
  memoryLimitBytes: 256 * 1024 * 1024,
} as const;

function judgeRequest(sourceCode: string): JudgeRequest {
  return {
    language: 'cpp',
    submission: { sourceCode },
    compile: { flags: [] },
    policy: {
      stopOnFirstFailure: false,
      stdoutLimitBytes: 1024 * 1024,
      stderrLimitBytes: 1024 * 1024,
    },
    problem: {
      id: 'phase6-public-runtime',
      tests: [{ id: 't1', stdin: '', expected: 'ok\n' }],
      limits: DEFAULT_LIMITS,
      checker: { kind: 'exact', ignoreTrailingWhitespace: false },
    },
  };
}

describe('createJudgeRuntime (browser public API)', () => {
  it('packaging smoke: package entry + default workers + accepted exact judge + health ready', async () => {
    const runtime = await createJudgeRuntime({ version: 'phase6-test' });
    const health = await runtime.health();
    expect(health.ready).toBe(true);
    expect(health.version).toBe('phase6-test');

    const result = await runtime.judge(
      judgeRequest([
        '#include <cstdio>',
        'int main() {',
        '  puts("ok");',
        '  return 0;',
        '}',
      ].join('\n')),
    );

    expect(result.phase).toBe('finished');
    if (result.phase !== 'finished') throw new Error('expected finished result');
    expect(result.ok).toBe(true);
    expect(result.summary.status).toBe('accepted');

    runtime.terminate();
  });

  it('bootstrap failure: missing sysrootUrl rejects', async () => {
    await expect(
      createJudgeRuntime({ sysrootUrl: '/missing-sysroot.tar.gz' }),
    ).rejects.toThrow(/Failed to bootstrap browser judge runtime: Failed to fetch sysroot artifact/i);
  });

  it('bootstrap failure: missing yowaspClangBundleUrl rejects', async () => {
    await expect(
      createJudgeRuntime({ yowaspClangBundleUrl: '/missing-yowasp-bundle.js' }),
    ).rejects.toThrow(/Failed to load yowasp clang bundle/i);
  });

  it('bootstrap failure: compiler worker creation rejects with stage context', async () => {
    await expect(
      createJudgeRuntime({
        createCompilerWorker: () => {
          throw new Error('worker constructor failed');
        },
      }),
    ).rejects.toThrow(/Failed to create compiler worker: worker constructor failed/);
  });

  it('terminate(): judge()/health() reject with a meaningful error', async () => {
    const runtime = await createJudgeRuntime();
    runtime.terminate();

    await expect(runtime.health()).rejects.toThrow(/terminated/i);
    await expect(runtime.judge(judgeRequest('int main() { return 0; }'))).rejects.toThrow(/terminated/i);
  });
});
