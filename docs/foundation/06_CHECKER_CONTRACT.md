## 목적

이 문서는 JavaScript checker가 어떤 입력을 받고 어떤 결과를 반환해야 하는지 정의한다.

현재 계약은 context refinement를 반영해 **checker는 실행 성공 케이스만 받는다**는 점이 핵심이다.

## 역할

checker는 제출 프로그램의 실행 성공 결과를 받아 판정만 수행한다.

checker는 다음을 담당한다.

- `stdout`과 `expected` 비교
- 공백 정책 반영
- custom rule 기반 판정
- 필요시 오류 메시지 생성

checker는 다음을 담당하지 않는다.

- C++ 컴파일
- 제출 프로그램 실행
- worker 제어
- time limit / memory limit / output limit / runtime error 판정
- compile error 처리

## 기본 인터페이스

```ts
export type CheckerFunction = (
  context: CheckerContext,
) => CheckerOutcome | Promise<CheckerOutcome>
```

## Checker 선택 모델

```ts
export type CheckerSpec = ExactCheckerSpec | CustomCheckerSpec

export type ExactCheckerSpec = {
  kind: 'exact'
  ignoreTrailingWhitespace: boolean
}

export type CustomCheckerSpec = {
  kind: 'custom'
  checkerId: string
}
```

`checkerId`는 registry에서 실제 `CheckerFunction`으로 해석된다. 함수 객체 자체를 `ProblemSpec`에 직접 저장하지 않는다.

## 입력 모델

```ts
export type CheckerContext = {
  testCase: JudgeTestCase
  execution: ExecutionSuccess
}
```

### 의미

- `testCase`: 현재 판정 대상 테스트케이스
- `execution`: 정상 종료한 실행 결과

실행 실패(`ExecutionFailure`)는 checker로 오지 않는다. application 계층이 먼저 실패 상태를 `JudgeTestResult`로 변환한다.

## 출력 모델

```ts
export type CheckerOutcome = {
  status: 'accepted' | 'wrong_answer' | 'internal_error'
  message?: string
}
```

### 의미

- `accepted`: 정답
- `wrong_answer`: 오답
- `internal_error`: checker 자체의 실패 또는 판정 불가

## exact checker 규약

기본 exact checker는 다음 규칙을 따른다.

- `testCase.expected`와 `execution.stdout`을 비교한다.
- 필요시 trailing whitespace 무시 옵션을 적용한다.
- 실행 실패를 받아서 해석하지 않는다.

## custom checker 규약

custom checker는 다음을 따라야 한다.

- 가능한 한 pure function에 가깝게 작성한다.
- 외부 상태나 전역 mutable state 의존을 피한다.
- 같은 입력에 대해 같은 결과를 반환해야 한다.
- 판정 불가 상황은 `internal_error`로 명시한다.
- 실행 실패를 AC/WA로 바꾸는 책임을 가지지 않는다.

## 권장 구현 원칙

- checker는 빠르게 실행되어야 한다.
- 문자열 비교 외 로직이 필요해도 과도한 계산을 피한다.
- 예외를 던지기보다 `internal_error`를 반환하는 쪽을 우선한다.
- 메시지는 짧고 판정에 도움이 되게 작성한다.

## 금지 또는 비권장 사항

- checker 내부에서 네트워크 접근
- checker 내부에서 무거운 무한 반복 또는 과도한 메모리 사용
- UI, DOM, 브라우저 전역 객체 의존
- 판정과 무관한 부수효과

## 예시: exact checker

```ts
const exactChecker: CheckerFunction = ({ testCase, execution }) => {
  return execution.stdout === testCase.expected
    ? { status: 'accepted' }
    : { status: 'wrong_answer' }
}
```

## 예시: custom checker

```ts
const tokenChecker: CheckerFunction = ({ testCase, execution }) => {
  const normalize = (value: string) => value.trim().split(/\s+/).join(' ')

  return normalize(execution.stdout) === normalize(testCase.expected)
    ? { status: 'accepted' }
    : { status: 'wrong_answer', message: 'Token comparison failed.' }
}
```
