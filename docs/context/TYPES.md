# Core Types — Quick Reference

> 원본: `docs/foundation/03_API_DRAFT.md` + 설계 refinement

## Public API

```ts
export interface JudgeRuntime {
  judge(request: JudgeRequest): Promise<JudgeResult>
  health(): Promise<RuntimeHealth>
}

export async function createJudgeRuntime(
  options?: RuntimeBootstrapOptions,
): Promise<JudgeRuntime>
```

## Request

```ts
export type LanguageId = 'cpp'

export type JudgeRequest = {
  language: LanguageId
  submission: SubmissionSource
  problem: ProblemSpec
  compile: CompileOptions
  policy: JudgePolicy
}

export type SubmissionSource = { sourceCode: string }

export type ProblemSpec = {
  id: string
  tests: JudgeTestCase[]
  limits: ExecutionLimits
  checker: CheckerSpec
}

export type JudgeTestCase = {
  id: string
  stdin: string
  expected: string    // 항상 string. optional 제거로 checker 내 non-null assertion 방지.
}

export type ExecutionLimits = {
  timeLimitMs: number
  memoryLimitBytes: number
}

// raw flags 직접 전달. 예: ['-O2', '-std=gnu++17', '-DONLINE_JUDGE']
export type CompileOptions = {
  flags: string[]
}

export type JudgePolicy = {
  stopOnFirstFailure: boolean
  stdoutLimitBytes: number
  stderrLimitBytes: number
}
```

## Checker

```ts
export type CheckerSpec = ExactCheckerSpec | CustomCheckerSpec

export type ExactCheckerSpec = {
  kind: 'exact'
  ignoreTrailingWhitespace: boolean
}

// 함수 직접 보관 대신 id 참조 → 직렬화, worker 경계, 테스트 fixture 안정성
export type CustomCheckerSpec = {
  kind: 'custom'
  checkerId: string
}

export type CheckerFunction = (
  context: CheckerContext,
) => CheckerOutcome | Promise<CheckerOutcome>

// execution 실패는 application이 직접 JudgeTestResult로 변환.
// checker는 성공 케이스만 받음.
export type CheckerContext = {
  testCase: JudgeTestCase
  execution: ExecutionSuccess
}

export type CheckerOutcome = {
  status: 'accepted' | 'wrong_answer' | 'internal_error'
  message?: string
}
```

## Result

```ts
export type JudgeResult =
  | { phase: 'compile'; ok: false; compile: CompileFailure }
  | { phase: 'finished'; ok: boolean; compile: CompileSuccess; summary: JudgeSummary; tests: JudgeTestResult[] }

// 전체 채점 결과 상태 (compile_error 포함)
export type JudgeStatus =
  | 'accepted' | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'output_limit_exceeded'
  | 'internal_error'

// 개별 테스트 상태 (테스트 하나가 compile_error일 수는 없음)
export type TestJudgeStatus =
  | 'accepted' | 'wrong_answer'
  | 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'output_limit_exceeded'
  | 'internal_error'

export type JudgeSummary = {
  status: JudgeStatus
  passed: number
  failed: number
  total: number
  totalElapsedMs: number
  maxTestElapsedMs: number
  slowestTestId?: string
  memoryBytes?: number
}

export type JudgeTestResult = {
  id: string
  status: TestJudgeStatus
  elapsedMs: number
  memoryBytes?: number
  message?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
}
```

## Compile / Execute

```ts
export type CompileSuccess = {
  success: true
  stdout: string; stderr: string; warnings: string[]
  artifact: ExecutableArtifact
  elapsedMs: number
}

export type CompileFailure = {
  success: false
  stdout: string; stderr: string; errors: string[]
  elapsedMs: number
}

// compile 산출물은 worker-local handle이 아니라
// testcase execution worker로 직접 넘길 수 있는 직렬화 가능한 payload다.
export type ExecutableArtifact = {
  wasmBinary: Uint8Array
}

export type ExecutionSuccess = {
  success: true
  stdout: string; stderr: string
  exitCode: number; elapsedMs: number; memoryBytes?: number
}

export type ExecutionFailure = {
  success: false
  status: 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'output_limit_exceeded' | 'internal_error'
  stdout: string; stderr: string
  exitCode: number | null; elapsedMs: number; memoryBytes?: number
  reason?: string
}
```

메모:

- browser runtime은 compile용 worker와 testcase execution worker를 분리한다.
- `time_limit_exceeded`는 execution worker terminate 기반으로 판정할 수 있다.
- `memory_limit_exceeded`는 정밀 측정이 아니라 wasm memory 상한 기반 실패 의미를 가진다.

## Status Priority (집계 우선순위)

`compile_error > time_limit_exceeded > memory_limit_exceeded > output_limit_exceeded > runtime_error > internal_error > wrong_answer > accepted`

## Health

```ts
export type RuntimeHealth = {
  ready: boolean
  version: string
  capabilities: {
    languages: LanguageId[]
    stdioJudge: true
    jsChecker: true
  }
  artifacts: {
    compilerLoaded: boolean
    sysrootLoaded: boolean
  }
}
```

## Ports

```ts
// language를 명시 — CompileOptions가 raw flags 모델이므로 구현체가 언어를 알아야 함
export interface CompilerPort {
  compile(
    language: LanguageId,
    source: SubmissionSource,
    options: CompileOptions,
  ): Promise<CompileSuccess | CompileFailure>
}

export interface ExecutorPort {
  execute(
    artifact: ExecutableArtifact,
    stdin: string,
    limits: ExecutionLimits,
    policy: Pick<JudgePolicy, 'stdoutLimitBytes' | 'stderrLimitBytes'>,
  ): Promise<ExecutionSuccess | ExecutionFailure>
}

export interface CheckerRunnerPort {
  run(spec: CheckerSpec, context: CheckerContext): Promise<CheckerOutcome>
}

export interface RuntimeHealthPort {
  getHealth(): Promise<RuntimeHealth>
}
```
