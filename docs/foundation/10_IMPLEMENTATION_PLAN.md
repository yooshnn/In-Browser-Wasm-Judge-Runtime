## 목적

이 문서는 현재 설계를 최소 기능 단위로 어떻게 구현할지 정리한다.

현재 계획은 `docs/context/PHASE.md`에 반영된 refinement를 기준으로 다시 맞춘다.

## Phase 0. 타입·문서 확정 + 초기 세팅

- stdio 전용 타입 모델 확정
- checker 계약 확정
- 오류 상태 모델 확정
- 문서와 실제 타입 초안 일치시키기
- monorepo 루트 설정
- 4-패키지 스캐폴딩

완료 기준:

- `docs/context/TYPES.md`와 `docs/foundation/03_API_DRAFT.md`가 일치한다.
- `packages/core`, `packages/runtime-cpp`, `packages/runtime-browser`, `packages/runtime-node` 골격이 존재한다.
- `pnpm turbo run typecheck`가 통과한다.

## Phase 1. 최소 실행 루프 (컴파일 + 단일 테스트)

- 단일 C++ 소스 컴파일
- 단일 테스트케이스 stdin 실행
- stdout/stderr/exitCode/elapsedMs 수집
- compile success/failure 반환
- compile 결과를 `ExecutableArtifact` payload로 반환

완료 기준:

- `judge()` 내부에서 compile + single execute가 동작한다.
- compile failure 시 `phase: 'compile'` 결과를 반환한다.

## Phase 2. 다중 테스트케이스 + 요약 집계

- 테스트케이스 배열 반복
- 테스트별 실행 결과 수집
- `stopOnFirstFailure` 적용
- `JudgeSummary` 집계
- `TestJudgeStatus` 기반 결과 배열 생성

완료 기준:

- 여러 테스트케이스에 대해 결과 배열과 summary를 만들 수 있다.
- 최종 상태 우선순위가 정책과 일치한다.

## Phase 3. 기본 Exact Checker

- exact checker 구현
- trailing whitespace 옵션 반영
- AC/WA 판정 연결
- execution failure를 checker에 넘기지 않는 흐름 정리

완료 기준:

- stdio exact judge 기본 경로가 동작한다.

## Phase 4. Custom JS Checker

- `checkerId` 기반 registry 또는 resolver 경로 구현
- checker internal_error 처리
- exact/custom checker 공통 오케스트레이션 정리

완료 기준:

- 사용자 정의 checker로 테스트 판정이 가능하다.
- checker 미등록 상황이 명시적으로 드러난다.

## Phase 5. 실행 제한 & 오류 정책

- testcase execution worker 분리
- timeout terminate 기반 TLE 처리
- `fd_write` 누적 바이트 기반 OLE 처리
- wasm memory upper bound 기반 MLE 근사 정책 반영
- RE / internal_error 정리
- 출력 제한 초과 시 truncate하지 않는 정책 반영

완료 기준:

- browser runtime에서 `runtime_error`, `time_limit_exceeded`, `memory_limit_exceeded`, `output_limit_exceeded`, `internal_error`를 모두 재현 가능하다.
- execution worker terminate 이후 다음 testcase 실행이 정상 복구된다.
- 주요 실패 상태가 타입, 흐름, 테스트에서 모두 일치한다.

## Phase 6. 브라우저/런타임 마무리

- artifact loader 정리
- worker protocol 정리
- compile host worker / execution worker 경계 정리
- health() 구현
- bootstrap 실패 경로 정리

완료 기준:

- 브라우저에서 안정적으로 bootstrap 및 health 조회가 가능하다.
- compile payload artifact와 testcase execution worker 경계가 고정된다.

## Phase 7. Node 보조 & 테스트 경화 (CI)

- Node 어댑터 정리
- CI용 테스트 경로 구성
- browser/node 공통 contract 검증
- 회귀 시나리오 고정

완료 기준:

- CI에서 주요 채점 흐름을 자동 검증할 수 있다.

## 구현 우선순위 원칙

- 먼저 실행기를 안정화한다.
- 그 위에 checker를 얹는다.
- 그 다음 제한/오류 정책을 정교화한다.
- 마지막에 배포/운영 편의성을 다듬는다.

## 현재 구현 메모

- browser runtime은 long-lived compile host worker와 testcase execution worker를 분리했다.
- `ExecutableArtifact`는 opaque id가 아니라 serializable wasm payload다.
- TLE는 execution worker terminate 기반으로 동작한다.
- OLE는 `fd_write` 누적 byte 추적으로 동작한다.
- MLE는 정밀 측정이 아니라 wasm memory 상한 기반 실패 의미를 가진다.
