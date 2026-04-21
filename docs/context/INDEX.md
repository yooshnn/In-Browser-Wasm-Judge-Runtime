# browser-wasm-judge — Project Context

> LLM이 대화 시작 시 가장 먼저 읽을 진입점.

## 한 줄 정의

브라우저에서 C++ stdio 제출을 컴파일·실행하고, JavaScript 체커로 채점하는 라이브러리.

## 패키지 구조

| npm 패키지 | 경로 | 책임 |
|-----------|------|------|
| `@cupya.me/wasm-judge-runtime-core` | `packages/core/` | 타입, 도메인, 포트 인터페이스. 플랫폼 의존 없음. |
| `@cupya.me/wasm-judge-runtime-cpp` | `packages/runtime-cpp/` | Wasm 아티팩트 참조, C++ preset 설정, clang 에러 파싱. |
| `@cupya.me/wasm-judge-runtime-browser` | `packages/runtime-browser/` | CompilerPort + ExecutorPort 브라우저 구현, Worker, 로더. |
| `@cupya.me/wasm-judge-runtime-node` | `packages/runtime-node/` | CompilerPort + ExecutorPort Node 구현. CI/테스트용. |

`cpp`는 아티팩트와 preset만 제공. `browser`/`node`가 각자 CompilerPort를 구현.

## 핵심 설계 결정

1. **stdio 전용** — 함수형 문제 없음
2. **실행과 채점 분리** — ExecutorPort / CheckerRunnerPort 독립
3. **JavaScript 체커** — C++ 체커 없음
4. **출력 초과 = 명시적 실패** — 잘라내기 없음
5. **Port/Adapter 패턴** — core는 구현체를 모름

## 불변 제약

- `core` tsconfig에 `"DOM"` 없음 → `window`, `Worker`, `fetch` import 시 타입 에러
- `core` package.json에 runtime dep 없음
- 패키지 간 import는 반드시 `.js` 확장자 명시 (`"moduleResolution": "NodeNext"`)
- `JudgeResult`는 `ok: boolean` + `phase` 두 discriminant 사용

## 문서 지도

| 파일 | 내용 |
|------|------|
| `docs/context/INDEX.md` | 이 파일. LLM 진입점. |
| `docs/context/TYPES.md` | 핵심 TypeScript 타입 빠른 참조 |
| `docs/context/PHASE.md` | 구현 단계 진행 현황 |
| `docs/foundation/01_PROJECT_BRIEF.md` | 프로젝트 배경·목표·비목표 |
| `docs/foundation/02_REQUIREMENTS.md` | 기능/비기능 요구사항 |
| `docs/foundation/03_API_DRAFT.md` | TypeScript API 전체 명세 (타입 원본) |
| `docs/foundation/04_DESIGN_DECISIONS.md` | 설계 결정 근거 |
| `docs/foundation/05_ARCHITECTURE.md` | 레이어드 아키텍처 상세 |
| `docs/foundation/06_CHECKER_CONTRACT.md` | 체커 인터페이스 계약 |
| `docs/foundation/07_EXECUTION_AND_ERROR_POLICY.md` | 오류 분류·상태 결정 정책 |
| `docs/foundation/08_ARTIFACTS_AND_DEPLOYMENT.md` | Wasm 아티팩트 전략 |
| `docs/foundation/09_TEST_STRATEGY.md` | 테스트 레벨·시나리오 |
| `docs/foundation/10_IMPLEMENTATION_PLAN.md` | 단계별 구현 계획 |
