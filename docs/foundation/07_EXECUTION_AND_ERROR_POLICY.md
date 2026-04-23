## 목적

이 문서는 실행 제한과 오류 상태를 어떤 기준으로 판정할지 정리한다.

## 상태 분류

### 전체 채점 상태

- `compile_error`
- `runtime_error`
- `time_limit_exceeded`
- `memory_limit_exceeded`
- `output_limit_exceeded`
- `accepted`
- `wrong_answer`
- `internal_error`

### 테스트 단위 상태

- `runtime_error`
- `time_limit_exceeded`
- `memory_limit_exceeded`
- `output_limit_exceeded`
- `accepted`
- `wrong_answer`
- `internal_error`

테스트 단위 상태에는 `compile_error`가 없다. compile error는 테스트 반복 전에 결정되기 때문이다.

## 판정 책임 분리

- 컴파일 단계: `compile_error`
- 실행 엔진: `runtime_error`, `time_limit_exceeded`, `memory_limit_exceeded`, `output_limit_exceeded`
- checker: `accepted`, `wrong_answer`, `internal_error`
- application: execution/checker 결과를 `JudgeTestResult`와 `JudgeSummary`로 변환 및 집계

## compile_error

다음 경우 컴파일 실패로 본다.

- 소스 문법 오류
- 링크 실패
- 필수 컴파일 단계 실패

이 경우 실행 단계는 수행하지 않는다.

## runtime_error

다음 경우 런타임 에러로 본다.

- 비정상 종료
- 예기치 않은 trap
- 실행 중 치명적 오류
- 정상 종료 코드를 돌려주지 못한 경우

## time_limit_exceeded

다음 경우 TLE로 본다.

- 테스트케이스 실행 시간이 `timeLimitMs`를 초과한 경우
- worker 강제 종료가 시간 제한에 의해 발생한 경우

현재 browser runtime 구현 메모:

- testcase execution은 전용 worker에서 수행한다.
- timeout 타이머는 executor 쪽이 가진다.
- timeout 시 execution worker를 terminate 하고 `time_limit_exceeded`를 반환한다.

## memory_limit_exceeded

다음 경우 MLE로 본다.

- 실행 환경의 메모리 상한 도달이 감지된 경우
- Wasm 메모리 상한 기반 정책상 메모리 초과로 판단된 경우

주의: 브라우저 환경에서는 전통적 서버형 OJ 수준의 정밀 메모리 측정이 어렵다. 따라서 본 프로젝트의 MLE는 상한 기반 실패로 정의한다.

현재 browser runtime 구현 메모:

- `memoryLimitBytes`는 정밀 계측값이 아니라 wasm memory upper bound 판정 기준이다.
- instantiate 실패나 실행 중 memory 상한 초과가 정책상 명확하면 `memory_limit_exceeded`로 반환한다.
- 브라우저 엔진이 모호한 OOM/worker crash만 남기는 경우는 보수적으로 `internal_error` 또는 `runtime_error`로 남길 수 있다.

## output_limit_exceeded

다음 경우 OLE로 본다.

- `stdout`이 `stdoutLimitBytes`를 초과한 경우
- `stderr`가 `stderrLimitBytes`를 초과한 경우

정책:

- 출력은 truncate하지 않는다.
- OLE는 명시적 실행 실패로 처리한다.

현재 browser runtime 구현 메모:

- `fd_write`에서 stdout/stderr 누적 바이트 수를 추적한다.
- limit 초과 시 `output_limit_exceeded`로 실패 처리한다.

## accepted / wrong_answer

다음 경우 checker가 판정한다.

- 실행이 정상 종료했고
- checker가 `ExecutionSuccess`를 해석할 수 있으며
- 정답 조건을 만족하면 `accepted`
- 정답 조건을 만족하지 않으면 `wrong_answer`

## internal_error

다음 경우 checker 또는 시스템 내부 오류로 본다.

- checker 자체가 예외를 던진 경우
- checker가 판정 불가 상태를 반환한 경우
- registry에서 `checkerId`를 해석하지 못한 경우
- 시스템 내부 결과 변환 과정에서 회복 불가능한 오류가 발생한 경우

## stopOnFirstFailure

`stopOnFirstFailure`가 `true`이면 첫 실패 테스트에서 반복을 중단할 수 있다.

실패의 범위는 다음을 포함한다.

- `runtime_error`
- `time_limit_exceeded`
- `memory_limit_exceeded`
- `output_limit_exceeded`
- `wrong_answer`
- `internal_error`

compile error는 테스트 반복 이전에 종료된다.

## 시간 집계 규칙

- `JudgeTestResult.elapsedMs`: 테스트케이스별 실행 시간
- `JudgeSummary.totalElapsedMs`: 전체 채점 소요 시간
- `JudgeSummary.maxTestElapsedMs`: 테스트케이스별 실행 시간 중 최댓값
- `JudgeSummary.slowestTestId`: 최장 실행 테스트케이스 식별자

## 최종 상태 집계 원칙

최종 `JudgeSummary.status`는 테스트별 상태를 집계해서 만든다. 일반적으로 심각도 높은 실패가 우선한다.

우선순위:

1. `compile_error`
2. `time_limit_exceeded`
3. `memory_limit_exceeded`
4. `output_limit_exceeded`
5. `runtime_error`
6. `internal_error`
7. `wrong_answer`
8. `accepted`
