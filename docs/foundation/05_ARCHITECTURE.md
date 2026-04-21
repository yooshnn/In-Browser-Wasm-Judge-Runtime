## 목적

이 문서는 현재 런타임을 어떤 패키지, 레이어, 포트로 나누어 설계할지 정리한다.

## 최상위 패키지 구조

```text
packages/
  core/
    src/
      domain/
      application/
      ports/
      index.ts

  runtime-cpp/
    src/
      presets/
      manifest/
      index.ts

  runtime-browser/
    src/
      adapters/
      worker/
      loader/
      index.ts

  runtime-node/
    src/
      adapters/
      index.ts
```

## 패키지별 책임

### `@cupya.me/wasm-judge-runtime-core`

- 타입, 도메인 규칙, 포트 인터페이스
- 플랫폼 의존 없는 application orchestration
- summary 집계, 상태 변환, checker 계약

### `@cupya.me/wasm-judge-runtime-cpp`

- C++ preset 설정
- Wasm artifact 참조 정보
- manifest 해석 보조
- clang 관련 진단 파싱 규약

`runtime-cpp`는 실제 컴파일/실행을 수행하지 않는다. artifact와 preset을 제공하는 지원 패키지다.

### `@cupya.me/wasm-judge-runtime-browser`

- browser용 `CompilerPort`, `ExecutorPort`, `RuntimeHealthPort` 구현
- worker 생성 및 메시지 통신
- artifact loader
- bootstrap 구현

### `@cupya.me/wasm-judge-runtime-node`

- Node용 `CompilerPort`, `ExecutorPort`, `RuntimeHealthPort` 구현
- CI/테스트 환경에서의 보조 런타임 제공

## 레이어 개요

### domain

`domain`은 브라우저, worker, Wasm, Node 같은 구현 세부사항을 모른다.

핵심 개념:

- `ProblemSpec`
- `JudgeTestCase`
- `ExecutionLimits`
- `JudgeStatus`
- `TestJudgeStatus`
- `JudgeSummary`
- `JudgeTestResult`
- `CompileSuccess`, `CompileFailure`
- `ExecutionSuccess`, `ExecutionFailure`
- `RuntimeHealth`
- `CheckerSpec`

### application

`application`은 요청을 받아 채점 유스케이스를 수행한다.

책임:

- `JudgeRequest`를 해석한다.
- 컴파일 포트를 호출한다.
- 테스트케이스 반복 실행을 조정한다.
- 실행 성공 결과만 checker에 전달한다.
- 실행 실패는 즉시 `JudgeTestResult`로 변환한다.
- 테스트별 결과를 집계해 최종 `JudgeResult`를 만든다.

### ports

`application`은 포트를 통해 외부 구현을 호출한다.

주요 포트 예시:

- `CompilerPort`
- `ExecutorPort`
- `RuntimeHealthPort`
- `CheckerRegistryPort` 또는 `CheckerRunnerPort`

#### 포트 시그니처 방향

```ts
interface CompilerPort {
  compile(language: LanguageId, source: SubmissionSource, options: CompileOptions): Promise<CompileSuccess | CompileFailure>
}

interface ExecutorPort {
  execute(artifact: ExecutableArtifact, testCase: JudgeTestCase, limits: ExecutionLimits, policy: JudgePolicy): Promise<ExecutionSuccess | ExecutionFailure>
}
```

`CompilerPort`가 language를 인자로 받는 이유는 compile options가 raw flags 모델로 단순화되었기 때문이다.

## runtime-browser 상세

책임:

- Wasm artifact 로드
- worker 생성 및 메시지 통신
- 브라우저 메모리/시간 제한 대응
- stdout/stderr 수집
- health 정보 노출

권장 구조:

```text
runtime-browser/
  src/
    adapters/
      compiler/
      executor/
      health/
    worker/
    loader/
```

## runtime-node 상세

책임:

- Node 환경에서 compile/execute 포트 구현
- 브라우저 없이도 integration test 가능하게 지원
- core contract 회귀 검증용 환경 제공

## 경계 원칙

- `core`는 browser/node에 직접 의존하지 않는다.
- `core` tsconfig에는 `DOM` lib를 넣지 않는다.
- `core` package.json에는 runtime dependency를 두지 않는다.
- 패키지 간 import는 `.js` 확장자를 명시한다. (`moduleResolution: NodeNext`)
- `application`은 포트만 알고 구현체는 모른다.
- checker 실행은 실행 엔진과 분리한다.
- 상위 웹 서비스의 저장 책임은 라이브러리 바깥에 둔다.

## 데이터 흐름

1. `JudgeRequest` 수신
2. application이 `CompilerPort` 호출
3. compile 실패 시 `phase: 'compile'` 결과 반환
4. compile 성공 시 테스트케이스 반복 실행
5. 각 테스트에서 execution success면 checker 호출
6. execution failure면 application이 직접 `JudgeTestResult` 생성
7. 전체 결과를 집계해 `phase: 'finished'` 결과 반환

## 설계 원칙

- 런타임은 C++ 실행기에 집중한다.
- 판정은 JS checker에 집중한다.
- 저장, 사용자 관리, 랭킹은 상위 서비스 책임으로 둔다.
- 브라우저 우선 설계를 유지하되 Node 보조 런타임으로 테스트 가능성을 확보한다.
