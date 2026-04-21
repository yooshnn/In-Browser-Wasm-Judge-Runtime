# Implementation Phase Tracker

> `docs/foundation/10_IMPLEMENTATION_PLAN.md` 기반. 작업 진행 시 업데이트.

## 현재 단계: Phase 0

| Phase | 이름 | 상태 |
|-------|------|------|
| 0 | 타입·문서 확정 + 초기 세팅 | 🔄 진행 중 |
| 1 | 최소 실행 루프 (컴파일 + 단일 테스트) | ⏳ 미착수 |
| 2 | 다중 테스트케이스 + 요약 집계 | ⏳ 미착수 |
| 3 | 기본 Exact Checker | ⏳ 미착수 |
| 4 | Custom JS Checker | ⏳ 미착수 |
| 5 | 실행 제한 & 오류 정책 (TLE/OLE/MLE/RE) | ⏳ 미착수 |
| 6 | 브라우저/런타임 마무리 (health, bootstrap) | ⏳ 미착수 |
| 7 | Node 보조 & 테스트 경화 (CI) | ⏳ 미착수 |

## Phase 0 체크리스트

- [x] 타입 계약 확정 (`docs/context/TYPES.md`)
- [x] 패키지 구조 결정 (4-패키지)
- [ ] monorepo 루트 설정 (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json 등)
- [ ] `packages/core/` 스캐폴딩 (타입 파일, port 인터페이스)
- [ ] `packages/runtime-cpp/` 스캐폴딩 (아티팩트 placeholder, manifest)
- [ ] `packages/runtime-browser/` 스캐폴딩 (stub)
- [ ] `packages/runtime-node/` 스캐폴딩 (stub)
- [ ] `pnpm install` + `pnpm turbo run typecheck` 통과

## 주요 설계 결정 (refinement 기록)

| 항목 | 원래 설계 | 변경 후 | 이유 |
|------|-----------|---------|------|
| `CompileOptions` | `{ cppVersion, optimization, extraFlags }` | `{ flags: string[] }` | 언어 중립, 운영자 친화적 raw flags |
| `CustomCheckerSpec` | `{ kind: 'custom', check: CheckerFunction }` | `{ kind: 'custom', checkerId: string }` | 직렬화·worker 경계 안정성 |
| `CheckerContext.execution` | `ExecutionSuccess \| ExecutionFailure` | `ExecutionSuccess` | 실패는 application이 처리, checker 책임 분리 |
| `JudgeTestResult.status` | `JudgeStatus` (compile_error 포함) | `TestJudgeStatus` (compile_error 없음) | 테스트 단위에서 CE 불가 |
| `JudgeResult finished` | 두 개의 union | `ok: boolean` 단일 union | 중복 제거 |
| `CompilerPort` | `compile(source, options)` | `compile(language, source, options)` | raw flags 모델에서 언어 명시 필요 |
| `JudgeTestCase.visible` | 있음 | 제거 | 라이브러리 관심사 아님 |
| 패키지 수 | 3개 | 4개 (`-cpp` 추가) | 아티팩트·preset 관심사 분리 |
