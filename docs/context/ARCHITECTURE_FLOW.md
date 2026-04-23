# 프로젝트 아키텍처와 실행 흐름 설명

이 문서는 현재 코드베이스를 처음 다시 읽는 사람이

- 프로젝트가 어떤 층으로 나뉘어 있는지
- 실제 요청이 어떤 순서로 흐르는지
- 각 파일이 "실제로 무슨 책임"을 가지는지

를 빠르게 이해할 수 있도록 정리한 안내서다.

설명은 현재 구현 기준으로, 특히 `packages/core` 와 `packages/runtime-browser` 중심으로 작성한다.

---

## 1. 프로젝트를 한 문장으로 요약하면

이 프로젝트는 **브라우저 안에서 C++ 코드를 컴파일하고, 생성된 wasm을 WASI 방식으로 실행하는 judge runtime** 이다.

핵심 아이디어는 다음과 같다.

- `core`는 "무엇을 해야 하는가"를 타입과 포트 인터페이스로 정의한다.
- `runtime-browser`는 "브라우저에서 그걸 어떻게 구현하는가"를 담당한다.
- 실제 compile/execute는 브라우저 main thread가 아니라 **Worker 안에서** 수행된다.
- compiler toolchain은 raw `clang.js` 조합이 아니라 **vendored `@yowasp/clang`** 를 사용한다.
- C/C++ 표준 라이브러리와 crt/lib는 `sysroot.tar.gz`에서 읽는다.

---

## 2. 큰 구조

현재 읽을 때 가장 유용한 구조는 아래와 같다.

```text
packages/
  core/
    src/
      domain/     # 런타임이 다루는 데이터 구조
      ports/      # 구현체가 맞춰야 하는 인터페이스

  runtime-browser/
    src/
      adapters/   # 브라우저용 포트 구현체
      worker/     # Worker entry와 protocol
      internal/   # 실제 compiler/executor/toolchain 로직
    tests/
      unit/       # toolchain/adapter 레벨 테스트
      browser/    # 실제 worker + browser integration 테스트

tools/
  artifacts/      # sysroot / yowasp-clang 산출물 준비 및 검증 스크립트
```

이 구조를 역할로 다시 표현하면:

- `core`: 계약
- `runtime-browser/adapters`: 외부에서 호출하는 입구
- `runtime-browser/worker`: main thread와 worker 사이 연결
- `runtime-browser/internal`: 실제 구현
- `tools/artifacts`: 실행에 필요한 대형 산출물 준비

---

## 3. 가장 중요한 실행 흐름

현재 시스템에서 제일 중요한 흐름은 두 개다.

1. compile 흐름
2. execute 흐름

### 3.1 compile 흐름

```text
호출자
  -> BrowserCompilerPort
    -> WorkerRequest(type='init')  [최초 1회]
    -> WorkerRequest(type='compile')
      -> runtimeWorker
        -> loadSysrootEntriesFromArchive
        -> loadVendoredYowaspClang
        -> YowaspCppCompiler
          -> runClang
          -> runLLVM
      -> CompileSuccess(artifact.wasmBinary payload) 반환
```

### 3.2 execute 흐름

```text
호출자
  -> BrowserExecutorPort
    -> execution worker 생성
    -> ExecutionWorkerRequest(type='execute', artifact payload)
      -> executionWorker
        -> executeWasm
          -> WebAssembly.compile / instantiate
          -> WASI preview1 shim으로 stdin/stdout/stderr 처리
    -> timeout 시 execution worker terminate
      -> ExecutionResult 반환
```

이 두 흐름을 이해하면 현재 `runtime-browser`의 거의 전체를 읽을 수 있다.

---

## 4. `packages/core` 는 무엇을 하는가

`core`는 실행 엔진이 아니다.  
`core`는 **runtime이 따라야 하는 계약과 데이터 구조**를 정의한다.

### 4.1 진입점

파일: [packages/core/src/index.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/core/src/index.ts:1)

이 파일은 `core` 패키지의 public export 정리 역할을 한다.

여기서 크게 세 그룹을 export 한다.

- Problem domain
- Judge domain
- Execution domain
- Ports

### 4.2 ports

포트는 구현체가 맞춰야 할 인터페이스다.

파일:

- [CompilerPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/core/src/ports/CompilerPort.ts:1)
- [ExecutorPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/core/src/ports/ExecutorPort.ts:1)
- [CheckerRunnerPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/core/src/ports/CheckerRunnerPort.ts:1)
- `RuntimeHealthPort.ts`

각 포트의 의미:

- `CompilerPort`
  - 소스 코드를 받아 compile 결과를 반환한다.
- `ExecutorPort`
  - compile에서 얻은 `ExecutableArtifact` payload를 stdin/limits/policy와 함께 실행한다.
- `CheckerRunnerPort`
  - checker spec과 checker context를 받아 판정 결과를 계산한다.
- `RuntimeHealthPort`
  - 런타임 readiness와 capability를 반환한다.

즉 `core`는
"runtime은 최소한 compile, execute, check, health를 할 수 있어야 한다"
는 인터페이스를 강제한다.

### 4.3 domain 타입

`packages/core/src/domain/` 아래 파일들은 포트가 주고받는 타입들이다.

예:

- `CompileResult.ts`
- `ExecutionResult.ts`
- `ExecutableArtifact.ts`
- `RuntimeHealth.ts`
- `CompileOptions.ts`
- `ExecutionLimits.ts`
- `JudgePolicy.ts`

읽는 관점에서 보면:

- 포트는 동작의 형태를 정의하고
- domain 타입은 데이터의 형태를 정의한다.

---

## 5. `runtime-browser` 는 무엇을 하는가

`runtime-browser`는 브라우저에서 `core` 포트를 실제로 구현한 패키지다.

현재 public API는 아직 매우 얇다.  
[packages/runtime-browser/src/index.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/index.ts:1)는 사실상 비어 있다.

즉 지금은 "잘 정리된 내부 구조와 테스트된 구현"이 중심이고,
외부 패키지 소비용 API surface는 아직 크게 다듬는 중이 아니다.

읽을 때는 다음 순서가 가장 쉽다.

1. `adapters/`
2. `worker/`
3. `internal/`

---

## 6. adapters: 외부에서 직접 붙는 층

`adapters/`는 브라우저 쪽 코드가 실제로 호출하는 포트 구현체다.

### 6.1 BrowserCompilerPort

파일: [packages/runtime-browser/src/adapters/compiler/BrowserCompilerPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/adapters/compiler/BrowserCompilerPort.ts:1)

이 파일이 하는 일:

- `CompilerPort` 구현
- 최초 compile 전에 worker init 보장
- `sysroot.tar.gz` fetch
- init/compile 요청을 worker에 postMessage
- `requestId -> Promise` 매핑 관리

핵심 포인트:

- 현재는 **raw compiler wasm을 main thread가 전달하지 않는다**
- init 시 worker에 보내는 것은 `sysrootGzData`뿐이다
- compile 결과에서 성공 시 wasm binary는 `ExecutableArtifact` payload로 main thread에 온다

실제로 이 파일은 "브라우저 쪽 compile 요청 프록시"다.

### 6.2 BrowserExecutorPort

파일: [packages/runtime-browser/src/adapters/executor/BrowserExecutorPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/adapters/executor/BrowserExecutorPort.ts:1)

이 파일이 하는 일:

- `ExecutorPort` 구현
- testcase execution worker를 생성한다
- timeout 타이머를 관리한다
- artifact payload를 worker로 transfer 한다
- execute 결과를 Promise로 연결하고 worker를 정리한다

즉 compile과 execute는 worker lifecycle이 분리되어 있고,
adapter는 그 orchestration 차이를 숨긴다.

### 6.3 BrowserRuntimeHealthPort

파일: [packages/runtime-browser/src/adapters/health/BrowserRuntimeHealthPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/adapters/health/BrowserRuntimeHealthPort.ts:1)

이 파일이 하는 일:

- `RuntimeHealthPort` 구현
- 현재 Phase 1 기준의 단순 readiness 상태를 반환

현재 health 의미:

- `compilerLoaded`
- `sysrootLoaded`

아직 매우 얕은 health 모델이지만, 최소한 artifact 준비 여부는 드러낸다.

---

## 7. worker: main thread 와 실제 실행 엔진 사이의 경계

worker 층은 세 파일이 핵심이다.

- [workerProtocol.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/worker/workerProtocol.ts:1)
- [runtimeWorker.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/worker/runtimeWorker.ts:1)
- [executionWorker.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/worker/executionWorker.ts:1)

### 7.1 workerProtocol.ts

이 파일은 main thread와 worker가 주고받는 메시지 계약을 정의한다.

현재 요청 종류:

- `init`
- `compile`

현재 응답 종류:

- `init-result`
- `compile-result`
- `internal-error`

중요한 점:

- `compile failure` 같은 도메인 실패는 `compile-result` 안에 들어온다
- worker 내부 예외나 프로토콜 오류는 `internal-error`로 분리한다

즉 이 파일은 "메시지 레벨 계약"이다.

### 7.2 runtimeWorker.ts

이 파일은 compile host worker entry point다.

이 파일이 하는 일:

- init 시 sysroot archive를 파싱한다
- vendored `@yowasp/clang` bundle을 로드한다
- compile 요청이 오면 `YowaspCppCompiler`를 통해 wasm을 만든다
- compile 성공 시 `ExecutableArtifact` payload를 main thread로 돌려준다

읽는 포인트:

- worker는 browser main thread가 아니다
- compile host worker는 재사용된다
- execute는 별도 execution worker에서 수행된다
- compile host worker는 "상태를 가진 compiler host"에 가깝다

여기서 worker가 갖는 상태:

- `storedSysrootEntries`
- `yowaspCompilerModulePromise`
- `compilerWithFlags`

즉 sysroot 파싱과 compiler bundle 로딩은 한 번 하고 재사용한다.

---

## 8. internal: 실제 구현 로직

`internal/`은 제일 중요하지만, 역할별로 나눠서 보면 어렵지 않다.

```text
internal/
  wasiExecutor.ts
  toolchain/
  yowasp/
```

### 8.1 toolchain 하위 모듈

#### resolveToolchainLayout.ts

파일: [resolveToolchainLayout.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/toolchain/resolveToolchainLayout.ts:1)

이 파일이 하는 일:

- sysroot 엔트리 목록을 보고 toolchain 경로를 추론한다

추론 대상:

- target
- clang resource dir
- libc++ include dir
- sys include dir
- crt1 path
- lib dir
- builtins path

의미:

- 코드가 특정 clang 버전 경로를 하드코딩하지 않게 한다
- sysroot 구조로부터 현재 toolchain layout을 "발견"한다

#### buildToolchainArgs.ts

파일: [buildToolchainArgs.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/toolchain/buildToolchainArgs.ts:1)

이 파일이 하는 일:

- compile 인자와 link 인자를 조립한다

현재 정책의 핵심:

- `--sysroot=/sysroot`
- resource dir 명시
- libc++ / sys include 명시
- `-std=c++17`
- `-fno-exceptions`
- builtins archive 명시 링크

즉 이 파일은 "현재 runtime의 compiler policy"를 코드로 고정한 곳이다.

#### loadSysrootArchive.ts

파일: [loadSysrootArchive.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/toolchain/loadSysrootArchive.ts:1)

이 파일이 하는 일:

- `sysroot.tar.gz`를 읽어 `SysrootEntry[]`로 바꾼다
- gzip 여부를 판별한다
- tar 엔트리를 파싱한다
- archive 내부 `sysroot/` prefix를 제거한다

즉 이 파일은 "artifact 파일을 런타임에서 쓸 수 있는 메모리 구조로 변환"하는 역할이다.

### 8.2 yowasp 하위 모듈

이 디렉터리는 이번 구조에서 compiler bootstrap의 중심이다.

#### loadVendoredYowaspClang.ts

파일: [loadVendoredYowaspClang.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/yowasp/loadVendoredYowaspClang.ts:1)

이 파일이 하는 일:

- vendored `@yowasp/clang` bundle URL을 고정한다
- worker 안에서 해당 bundle을 dynamic import 한다
- module shape를 검사한다

중요한 계약:

- 현재 기대 경로는 `/yowasp-clang/bundle.js`
- module은 `runClang` 과 `runLLVM`를 export 해야 한다

즉 이 파일은 "브라우저 compiler runtime loader"다.

#### YowaspCppCompiler.ts

파일: [YowaspCppCompiler.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/yowasp/YowaspCppCompiler.ts:1)

이 파일이 하는 일:

- sysroot 엔트리와 source code를 YoWASP virtual filesystem으로 올린다
- `runClang` 호출로 object file을 만든다
- `runLLVM` 호출로 wasm을 링크한다
- `/work/output.wasm`을 읽어 compile 결과로 반환한다
- compile 산출물 크기 cap을 검사한다

여기서 중요한 내부 함수:

- `appendTreeFile()`
  - virtual filesystem tree에 파일 추가
- `readTreeFile()`
  - 결과 파일 읽기
- `buildYowaspClangInvocation()`
  - `clang++` driver 호출 인자 생성
- `buildYowaspLdInvocation()`
  - `wasm-ld` 호출 인자 생성
- `compileCpp()`
  - 최종 `CompileSuccess | CompileFailure` 형태로 변환

즉 이 파일은 "현재 browser-side C++ compiler의 실질적인 본체"다.

### 8.3 wasiExecutor.ts

파일: [packages/runtime-browser/src/internal/wasiExecutor.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/wasiExecutor.ts:1)

이 파일이 하는 일:

- execution worker 내부에서 wasm binary를 실행한다
- WASI preview1 imports를 직접 구성한다
- stdin / stdout / stderr 를 브라우저 메모리 버퍼로 처리한다
- `ExecutionResult`를 만든다

구체적으로 구현한 것:

- `fd_write`
  - stdout/stderr 분리
  - output limit 추적
- `fd_read`
  - stdin 공급
- `proc_exit`
  - exit code 처리
- wasm memory 상한 기반 MLE 판정
- `fd_seek`, `fd_fdstat_get`, `fd_filestat_get`, `fd_prestat_get`, `random_get`, `clock_time_get` 등
  - 현재 필요한 최소 preview1 surface

즉 이 파일은 "브라우저용 아주 작은 WASI 런타임"이다.

---

## 9. tests: 무엇을 어디까지 보장하는가

테스트는 두 층으로 나뉜다.

### 9.1 unit tests

위치:

- `packages/runtime-browser/tests/unit/`

핵심 파일:

- `resolveToolchainLayout.test.ts`
- `buildToolchainArgs.test.ts`
- `loadSysrootArchive.test.ts`
- `loadVendoredYowaspClang.test.ts`
- `YowaspCppCompiler.test.ts`
- `BrowserCompilerPort.test.ts`
- `BrowserExecutorPort.test.ts`

이 테스트들이 보장하는 것:

- sysroot에서 경로를 제대로 해석하는가
- compiler/linker 인자 정책이 안 깨졌는가
- vendored yowasp bundle 경로/shape가 맞는가
- BrowserCompilerPort가 init 시 raw wasm을 더 이상 요구하지 않는가
- BrowserExecutorPort가 malformed response / worker crash를 `internal_error`로 정규화하는가

즉 unit test는 "구조와 계약"을 고정한다.

### 9.2 browser integration test

파일: [packages/runtime-browser/tests/browser/compile-execute.test.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/tests/browser/compile-execute.test.ts:1)

이 테스트가 보장하는 것:

- 실제 worker가 뜨는가
- 실제 browser 환경에서 compile 되는가
- 실제 wasm execute가 되는가
- stdin/stdout/stderr 경로가 살아 있는가
- `std::getline` / `std::string`까지 통과하는가
- timeout terminate 기반 TLE가 동작하는가
- output limit 기반 OLE가 동작하는가
- wasm memory 상한 기반 MLE가 동작하는가
- invalid artifact가 `internal_error`로 정규화되는가

즉 이 테스트는 "전체 런타임이 진짜로 돌아가는가"를 확인한다.

---

## 10. artifacts: 왜 필요한가

현재 browser runtime은 코드만으로는 동작하지 않는다.

필요한 큰 산출물:

- `packages/runtime-browser/artifacts/sysroot.tar.gz`
- `packages/runtime-browser/artifacts/yowasp-clang/*`

각 artifact의 의미:

- `sysroot.tar.gz`
  - libc, libc++, crt, headers, builtins 등 compile/link에 필요한 타겟 측 자원
- `yowasp-clang/bundle.js` 및 `llvm.core*.wasm`
  - 브라우저에서 clang/LLD를 실제로 구동하는 compiler runtime

이 산출물은 git 추적 대상이 아니라 `.gitignore` 대상이다.
그래서 새 PC에서 작업할 때는 이 디렉터리를 따로 가져가야 한다.

관련 스크립트:

- [tools/artifacts/build-wasi-sdk-sysroot.sh](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/tools/artifacts/build-wasi-sdk-sysroot.sh:1)
- [tools/artifacts/package-sysroot.sh](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/tools/artifacts/package-sysroot.sh:1)
- [tools/artifacts/verify-sysroot.sh](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/tools/artifacts/verify-sysroot.sh:1)
- [tools/artifacts/vendor-yowasp-clang.sh](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/tools/artifacts/vendor-yowasp-clang.sh:1)
- [tools/artifacts/verify-yowasp-clang.sh](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/tools/artifacts/verify-yowasp-clang.sh:1)

---

## 11. 현재 코드를 읽는 추천 순서

처음 다시 읽을 때는 아래 순서를 추천한다.

1. [packages/core/src/index.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/core/src/index.ts:1)
2. [CompilerPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/core/src/ports/CompilerPort.ts:1), [ExecutorPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/core/src/ports/ExecutorPort.ts:1)
3. [BrowserCompilerPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/adapters/compiler/BrowserCompilerPort.ts:1)
4. [BrowserExecutorPort.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/adapters/executor/BrowserExecutorPort.ts:1)
5. [workerProtocol.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/worker/workerProtocol.ts:1)
6. [runtimeWorker.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/worker/runtimeWorker.ts:1)
7. [loadSysrootArchive.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/toolchain/loadSysrootArchive.ts:1)
8. [resolveToolchainLayout.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/toolchain/resolveToolchainLayout.ts:1)
9. [buildToolchainArgs.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/toolchain/buildToolchainArgs.ts:1)
10. [loadVendoredYowaspClang.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/yowasp/loadVendoredYowaspClang.ts:1)
11. [YowaspCppCompiler.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/yowasp/YowaspCppCompiler.ts:1)
12. [executionWorker.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/worker/executionWorker.ts:1)
13. [wasiExecutor.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/src/internal/wasiExecutor.ts:1)
14. 마지막으로 [compile-execute.test.ts](/Users/yooshnn/projects/In-Browser-Wasm-Judge-Runtime/packages/runtime-browser/tests/browser/compile-execute.test.ts:1)

이 순서가 좋은 이유:

- 계약
- 브라우저 입구
- worker 경계
- 내부 구현
- 실제 검증

순서로 자연스럽게 읽히기 때문이다.

---

## 12. 지금 구조를 짧게 다시 요약하면

현재 아키텍처는 아래처럼 이해하면 된다.

- `core`는 타입과 포트 계약을 정의한다
- `runtime-browser/adapters`는 브라우저 코드가 호출하는 입구다
- `workerProtocol`은 compile host worker와 main thread 사이의 메시지 계약이다
- `runtimeWorker`는 compile을 담당하는 long-lived host다
- `executionWorker`는 testcase 단위 execute를 담당하는 ephemeral worker다
- `toolchain/*`은 sysroot를 해석하고 compiler/linker 인자 정책을 만든다
- `yowasp/*`는 vendored `@yowasp/clang`를 로드하고 실제 compile/link를 수행한다
- `ExecutableArtifact`는 worker-local id가 아니라 serializable wasm payload다
- `wasiExecutor`는 wasm을 실제 실행한다
- `tests`는 이 구조가 계약대로 유지되는지 확인한다
- `tools/artifacts`는 런타임이 기대하는 대형 산출물을 준비하고 검증한다

결론적으로 현재 프로젝트는
**포트 기반 계약 위에, compile host worker + testcase execution worker + internal compiler/executor 로직이 분리된 구조**로 이해하면 가장 쉽다.
