## 목적

이 문서는 현재 설계에서 중요한 결정을 왜 그렇게 내렸는지 기록한다.

## 1. 함수 구현형 대신 stdio 전용으로 범위를 좁힌 이유

초기에는 함수 구현형 문제 지원도 고려했다. 하지만 함수 구현형은 하네스가 함수 호출과 비교를 직접 담당해야 해서, 실행과 판정이 같은 런타임 내부에 강하게 결합된다. 이로 인해 반환값 비교 방식, special judge 시간 분리, 타입 유지, 직렬화 여부 같은 복잡성이 커진다.

반면 stdio형 문제는 제출 프로그램의 관측 가능한 결과를 `stdout` 중심으로 다룰 수 있고, 채점기를 실행기와 분리하기 쉽다. 이 프로젝트의 핵심 목적은 브라우저에서 C++ 코드를 컴파일·실행 가능한 Wasm 런타임을 만드는 것이다. 따라서 범위는 stdio 전용으로 고정한다.

### 현재 결정

- 문제 형식은 stdio 전용으로 제한한다.
- 채점은 실행 결과를 기준으로 수행한다.

## 2. checker를 실행 엔진과 분리한 이유

채점 로직과 실행 로직을 함께 두면 exact judge는 간단해 보여도, custom judge가 들어오는 순간 실행 환경과 판정 환경이 서로 강하게 묶인다. 그렇게 되면 실행기 교체, 브라우저/Node 분리, 테스트 전략 수립이 모두 어려워진다.

### 현재 결정

- 실행은 `ExecutorPort`가 담당한다.
- 판정은 checker가 담당한다.
- application 계층이 두 결과를 조합해 `JudgeTestResult`를 만든다.

## 3. custom checker를 함수 직접 전달 대신 `checkerId` 참조로 둔 이유

초기 초안에서는 `CustomCheckerSpec = { kind: 'custom', check: CheckerFunction }` 형태를 고려했다. 하지만 브라우저 worker 경계와 테스트 fixture를 생각하면 함수 객체 자체를 타입의 일부로 두는 것은 안정적이지 않다. 직렬화가 어렵고, 저장도 어렵고, 테스트용 fixture도 매번 실행 환경에 종속된다.

### 현재 결정

- custom checker는 `{ kind: 'custom', checkerId: string }` 형태로 둔다.
- 실제 함수 해석은 상위 애플리케이션 또는 registry 계층이 맡는다.

### 기대 효과

- 타입 계약이 직렬화 가능해진다.
- worker 경계와 저장 경계가 단순해진다.
- 테스트 fixture를 문자열 기반으로 안정적으로 만들 수 있다.

## 4. checker는 실행 성공 케이스만 받도록 한 이유

초안에서 `CheckerContext.execution`은 `ExecutionSuccess | ExecutionFailure`였다. 하지만 이 경우 checker가 실행 실패를 해석하는 책임까지 떠안게 된다. 그러면 checker가 RE/TLE/MLE/OLE를 다시 분기하게 되고, exact checker조차 실행 엔진 정책을 알아야 한다.

### 현재 결정

- `CheckerContext.execution`은 `ExecutionSuccess`만 받는다.
- 실행 실패는 application 계층이 직접 `JudgeTestResult`로 변환한다.

### 기대 효과

- checker의 책임이 순수 판정으로 좁아진다.
- exact/custom checker 구현이 단순해진다.
- 실행 실패 정책 변경이 checker에 전파되지 않는다.

## 5. `CompileOptions`를 raw flags로 단순화한 이유

초기 초안의 `cppVersion`, `optimization`, `extraFlags` 구조는 읽기에는 편하지만, 실제로는 preset 설계와 언어별 분기까지 API가 떠안게 된다. 현재 프로젝트는 범용 컴파일러 제품이 아니라 OJ 런타임이므로, 컴파일 정책은 더 낮은 레벨의 flags 배열로 두는 편이 작고 유연하다.

### 현재 결정

- `CompileOptions`는 `{ flags: string[] }`로 둔다.
- `CompilerPort`는 `compile(language, source, options)` 형태를 전제로 한다.

## 6. `JudgeTestCase.expected`를 항상 string으로 둔 이유

`expected`를 optional로 두면 custom checker에는 맞아 보일 수 있다. 하지만 exact checker가 기본 경로인 이상, optional은 대부분의 구현에서 non-null assertion이나 런타임 예외 분기를 추가한다.

### 현재 결정

- `JudgeTestCase.expected`는 항상 `string`이다.
- exact checker는 별도 방어 코드 없이 바로 비교할 수 있다.

## 7. `JudgeStatus`와 `TestJudgeStatus`를 분리한 이유

초안에서는 `JudgeTestResult.status`가 전체 상태와 같은 `JudgeStatus`를 사용했다. 하지만 테스트 하나가 `compile_error`일 수는 없다. compile error는 테스트 반복 전에 결정되기 때문이다.

### 현재 결정

- 전체 채점 상태는 `JudgeStatus`를 사용한다.
- 테스트 단위 상태는 `TestJudgeStatus`를 사용한다.
- `TestJudgeStatus`에는 `compile_error`가 없다.

## 8. `JudgeResult`의 finished union을 하나로 합친 이유

초기 초안은 `phase: 'finished'`에서 `ok: true`와 `ok: false`를 별도 union으로 나눴다. 하지만 구조는 완전히 같고 `ok` 값만 다르다. 이 경우 타입 중복만 늘고 실질적인 정보는 늘지 않는다.

### 현재 결정

- `JudgeResult`는 다음 두 갈래만 둔다.
  - `phase: 'compile', ok: false`
  - `phase: 'finished', ok: boolean`

## 9. 출력 초과를 truncate 대신 명시적 실패로 두는 이유

사용자 코드가 과도한 `stdout` 또는 `stderr`를 생성할 수 있다. 출력을 잘라서 계속 처리하면 실제 프로그램 동작을 왜곡할 수 있고, 채점 결과 의미도 모호해진다. 특히 브라우저 환경에서는 출력 버퍼가 과도하게 커지면 메모리와 UI 안정성에 직접 영향이 간다.

### 현재 결정

- 출력 크기가 `stdoutLimitBytes` 또는 `stderrLimitBytes`를 초과하면 `output_limit_exceeded`로 처리한다.
- 출력은 truncate하지 않는다.

## 10. 패키지를 4개로 분리한 이유

초기에는 core + browser + node 정도의 3-패키지 구성이 자연스러워 보였다. 하지만 실제로는 C++ preset과 artifact 참조 정보가 browser/node 어느 한쪽 구현 디테일로만 보기 어려운 독립 관심사다.

### 현재 결정

- `@cupya.me/wasm-judge-runtime-core`
- `@cupya.me/wasm-judge-runtime-cpp`
- `@cupya.me/wasm-judge-runtime-browser`
- `@cupya.me/wasm-judge-runtime-node`

로 패키지를 분리한다.

## 11. 브라우저 런타임을 주 대상으로 둔 이유

이 프로젝트의 출발점은 브라우저 안에서 C++ 코드를 컴파일·실행 가능한 Wasm 런타임을 만들 수 있는가를 증명하는 것이었다. Node 환경도 테스트, CI, 일부 로컬 검증에는 유용하지만, 프로젝트의 본질은 브라우저 우선 런타임이다.

### 현재 결정

- 브라우저 런타임을 주 대상 환경으로 둔다.
- Node 런타임은 테스트 및 보조 실행 환경으로 둔다.
