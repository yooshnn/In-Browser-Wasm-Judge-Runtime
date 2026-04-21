## 목적

이 문서는 어떤 수준에서 무엇을 검증할지 정리한다.

## 테스트 목표

- 컴파일/실행 엔진이 안정적으로 동작하는지 검증한다.
- checker 인터페이스가 의도대로 동작하는지 검증한다.
- 브라우저와 Node 보조 런타임 모두에서 재현 가능성을 확보한다.
- 오류 상태 분류가 정책대로 작동하는지 검증한다.
- context에 확정된 타입 계약이 실제 코드와 어긋나지 않는지 검증한다.

## 테스트 구분

### 1. Unit Test

대상:

- domain model
- summary 집계 로직
- 상태 우선순위 계산
- exact checker
- request/result 변환
- `JudgeStatus` ↔ `TestJudgeStatus` 경계

목표:

- 작은 단위 규칙을 빠르게 검증

### 2. Application / Integration Test

대상:

- compile -> execute -> checker -> result 집계 흐름
- stopOnFirstFailure 적용
- OLE/TLE/MLE/RE/CE 분기
- execution failure를 checker에 넘기지 않는 규칙
- `checkerId` registry 해석 경로

목표:

- 유스케이스 전체 흐름이 맞는지 검증

### 3. Browser Test

대상:

- worker 통신
- wasm artifact 로딩
- 브라우저 런타임에서 실제 컴파일/실행 가능 여부

목표:

- 핵심 목표인 브라우저 동작 보장

### 4. Node Runtime Test

대상:

- 보조 런타임 어댑터
- CI 환경 재현

목표:

- 브라우저 없이도 일부 통합 테스트 재현 가능하게 유지

## 필수 시나리오

- 정상 컴파일, 정상 실행, exact checker AC
- 정상 컴파일, 정상 실행, exact checker WA
- custom checker AC/WA
- `checkerId` 미해결 → internal_error
- 컴파일 실패
- runtime error
- time limit exceeded
- memory limit exceeded
- output limit exceeded
- checker internal_error
- stopOnFirstFailure true/false 차이

## 회귀 테스트 대상

다음은 회귀 테스트로 반드시 남긴다.

- 특수한 STL 사용 사례
- 이전에 실패했던 파싱/실행 케이스
- 출력 누적 관련 문제
- worker 종료 관련 문제
- checker registry 경계 문제

## 테스트 원칙

- 브라우저 전용 문제는 browser test에서 검증한다.
- 순수 규칙은 unit test로 내린다.
- 실행기와 checker는 가능한 한 분리 테스트한다.
- flaky test를 줄이기 위해 시간 관련 허용 오차를 둔다.
- context 문서와 foundation 문서의 타입 차이가 생기지 않도록 타입 스냅샷 또는 contract test를 고려한다.
