## 목표

이 API는 범용 C++ 컴파일러 인터페이스가 아니라, **stdio 제출 코드를 실행하고 그 결과를 JavaScript checker에 전달해 채점하는 OJ 전용 인터페이스**를 정의한다.

현재 초안은 context에서 확정된 refinement를 반영한다.

- compile 옵션은 raw flags 중심으로 단순화한다.
- custom checker는 함수 직접 전달이 아니라 `checkerId` 참조로 모델링한다.
- checker는 실행 성공 케이스만 받는다.
- 테스트 단위 상태와 전체 채점 상태를 구분한다.
- `JudgeResult`는 `ok`와 `phase` 두 discriminant를 함께 사용한다.

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
  expected: string
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
  stdout: string
  stderr: string
  warnings: string[]
  artifact: ExecutableArtifact
  elapsedMs: number
}

export type CompileFailure = {
  success: false
  stdout: string
  stderr: string
  errors: string[]
  elapsedMs: number
}

export type ExecutableArtifact = { id: string }

export type ExecutionSuccess = {
  success: true
  stdout: string
  stderr: string
  exitCode: number
  elapsedMs: number
  memoryBytes?: number
}

export type ExecutionFailure = {
  success: false
  status: 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'output_limit_exceeded' | 'internal_error'
  stdout: string
  stderr: string
  exitCode: number | null
  elapsedMs: number
  memoryBytes?: number
  reason?: string
}
```

## Health

```ts
export type RuntimeHealth = {
  ready: boolean
  version: string
  capabilities: {
    language: 'cpp'
    stdioJudge: true
    jsChecker: true
  }
  artifacts: {
    compilerLoaded: boolean
    sysrootLoaded: boolean
  }
}
```

## Status Priority

최종 `JudgeSummary.status` 집계 우선순위는 다음을 기준으로 한다.

`compile_error > time_limit_exceeded > memory_limit_exceeded > output_limit_exceeded > runtime_error > internal_error > wrong_answer > accepted`

## Exact Checker 기본 정책

- exact checker는 `testCase.expected`와 `execution.stdout`을 비교한다.
- 필요시 trailing whitespace 무시 옵션을 적용할 수 있다.
- exact checker는 실행 실패를 직접 처리하지 않는다. 실행 실패는 application 계층이 먼저 `JudgeTestResult`로 변환한다.

## 설계 메모

### 왜 `expected`를 optional로 두지 않는가

exact checker 경로에서 `expected`가 항상 존재한다고 보면 checker 내부의 non-null assertion을 제거할 수 있다. optional을 열어 두면 타입은 단순해 보이지만 실제 구현에서는 오히려 분기와 예외 경로가 늘어난다.

### 왜 `CompileOptions`를 raw flags로 바꾸는가

`cppVersion`, `optimization`, `extraFlags`처럼 구조화된 API는 보기에는 친절하지만 preset 설계가 고정되고 언어별 분기가 커진다. 현재 범위에서는 raw flags 배열이 더 작고 운영자 친화적이다.

### 왜 custom checker를 함수 직접 전달하지 않는가

브라우저 worker 경계, 직렬화, fixture 안정성, 저장 가능성까지 고려하면 함수 객체 자체를 타입 계약의 중심에 두는 것보다 `checkerId` 참조 모델이 훨씬 안정적이다.
