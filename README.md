# In-Browser Wasm Judge Runtime

Browser-first runtime for compiling C++ submissions to WebAssembly, executing them in isolated workers, and judging stdout with exact or JavaScript custom checkers.

This project is still alpha-quality. The browser runtime is the primary target. The node runtime package is intentionally not implemented yet.

## Packages

- `@cupya.me/wasm-judge-runtime-core`: shared types, ports, checker runner, and judge orchestration.
- `@cupya.me/wasm-judge-runtime-browser`: browser runtime implementation.
- `@cupya.me/wasm-judge-runtime-cpp`: C++ package placeholder for language-specific concerns.
- `@cupya.me/wasm-judge-runtime-node`: explicit not-implemented package.

## What Works

- C++ compile in the browser through a long-lived compiler worker.
- Testcase execution in short-lived execution workers.
- stdin/stdout/stderr based judge flow.
- Exact checker and `checkerId` based custom JS checker.
- Compile error, wrong answer, runtime error, time limit, memory limit, output limit, and internal error mapping.
- Serializable `ExecutableArtifact` with wasm payload.
- `terminate()` cleanup for compiler and execution workers.

## Browser Runtime Quick Start

Artifacts must be hosted where the browser can fetch them:

- `sysroot.tar.gz`
- `yowasp-clang/bundle.js`
- `yowasp-clang/llvm-resources.tar`
- `yowasp-clang/llvm.core.wasm`
- `yowasp-clang/llvm.core2.wasm`
- `yowasp-clang/llvm.core3.wasm`
- `yowasp-clang/llvm.core4.wasm`

```ts
import { createJudgeRuntime } from '@cupya.me/wasm-judge-runtime-browser';

const runtime = await createJudgeRuntime({
  artifactBaseUrl: '/',
  checkers: {
    'contains-ok': ({ execution }) =>
      execution.stdout.includes('ok')
        ? { status: 'accepted' }
        : { status: 'wrong_answer', message: 'stdout does not contain ok' },
  },
});

const result = await runtime.judge({
  language: 'cpp',
  submission: {
    sourceCode: `
      #include <cstdio>
      int main() {
        int a = 0, b = 0;
        if (scanf("%d %d", &a, &b) == 2) printf("%d\\n", a + b);
        return 0;
      }
    `,
  },
  compile: { flags: [] },
  policy: {
    stopOnFirstFailure: false,
    stdoutLimitBytes: 1024 * 1024,
    stderrLimitBytes: 1024 * 1024,
  },
  problem: {
    id: 'sum',
    limits: {
      timeLimitMs: 5000,
      memoryLimitBytes: 256 * 1024 * 1024,
    },
    checker: {
      kind: 'exact',
      ignoreTrailingWhitespace: false,
    },
    tests: [
      { id: 'sample-1', stdin: '2 3\n', expected: '5\n' },
    ],
  },
});

console.log(result);
runtime.terminate();
```

## Bootstrap Options

```ts
type RuntimeBootstrapOptions = {
  artifactBaseUrl?: string;
  sysrootUrl?: string;
  yowaspClangBundleUrl?: string;
  checkers?: CheckerRegistry;
  version?: string;
  createCompilerWorker?: () => Worker;
  createExecutionWorker?: () => Worker;
};
```

URL priority:

1. Explicit `sysrootUrl` and `yowaspClangBundleUrl`.
2. URLs derived from `artifactBaseUrl`.
3. Defaults derived from `globalThis.location`.

If `globalThis.location` is unavailable, `artifactBaseUrl` must be an absolute URL.

## Local Development

Install dependencies:

```bash
pnpm install
```

Build all packages:

```bash
pnpm build
```

Run type checks:

```bash
pnpm typecheck
```

Run unit tests:

```bash
pnpm test:unit
```

Run browser integration tests:

```bash
pnpm test:browser
```

Run the browser sample app:

```bash
pnpm --filter @cupya.me/wasm-judge-runtime-browser sample
```

Then open:

```text
http://127.0.0.1:5173/
```

The sample app expects browser artifacts under `packages/runtime-browser/artifacts`.

## Artifact Tooling

Verify an existing sysroot artifact:

```bash
pnpm artifacts:verify-sysroot
```

Vendor `@yowasp/clang` browser artifacts:

```bash
pnpm artifacts:vendor-yowasp-clang
pnpm artifacts:verify-yowasp-clang
```

See `tools/artifacts/README.md` for artifact build details.

## Known Issues

- Request validation: invalid limits, empty or huge source, and invalid policy values are not rejected up front.
- Size limits: source size, stdin size, testcase count, and output policy upper bounds are not centrally enforced.
- Checker timeout/cancellation: custom checkers can hang or block without a runtime-managed timeout.
- Node runtime implementation: `@cupya.me/wasm-judge-runtime-node` is an explicit not-implemented package.

## Improvements

- Progress hooks for artifact fetch/load, compile, and execute lifecycle events.
- Structured public error classes beyond the node runtime `NotImplementedError`.
- Node runtime adapter and node/browser common contracts.
- More explicit runtime compatibility matrix for browser APIs such as module workers, `DecompressionStream`, transferable `ArrayBuffer`, and WebAssembly.
