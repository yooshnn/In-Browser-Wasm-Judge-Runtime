# Artifact Build Tooling

이 디렉터리는 브라우저 런타임이 사용하는 대용량 artifact를 재현 가능하게 빌드하기 위한 스크립트 모음이다.

현재는 두 영역을 분리해서 다룬다.

- `sysroot/compiler-rt`: `wasi-sdk-32` 기준으로 재생성 가능
- 브라우저용 Clang/LLD runtime: `@yowasp/clang` vendoring으로 재생성 가능

## 현재 범위

이 디렉터리의 스크립트는 다음을 자동화한다.

- `wasi-sdk` checkout 검증
- `wasi-sdk` toolchain/sysroot 빌드
- `sysroot.tar.gz` 패키징
- 필수 파일 검증
- 빌드 메타데이터 기록
- `@yowasp/clang` 패키지 vendoring
- vendored `@yowasp/clang` entrypoint/해시 검증

브라우저 런타임은 더 이상 raw `clang.js` / `clang.wasm` / `wasm-ld.js` / `wasm-ld.wasm`
4파일 계약에 의존하지 않는다.

## 기준 버전

- `wasi-sdk`: `32.0`
- `wasi-libc`: `2fc32bc81b9f`
- `llvm`: `4434dabb6991`
- `llvm-version`: `22.1.0`
- `config`: `f992bcc08219`

## 빠른 시작

호스트에서 직접 빌드:

```bash
tools/artifacts/build-wasi-sdk-sysroot.sh /path/to/wasi-sdk
```

Docker로 빌드:

```bash
tools/artifacts/build-wasi-sdk-sysroot.sh --docker /path/to/wasi-sdk
```

기본 출력물:

- `tools/artifacts/out/sysroot.tar.gz`
- `tools/artifacts/out/wasi-sdk-build-info.json`
- `packages/runtime-browser/artifacts/yowasp-clang/`

검증만 다시 실행:

```bash
tools/artifacts/verify-sysroot.sh tools/artifacts/out/sysroot.tar.gz
tools/artifacts/verify-yowasp-clang.sh
```

`@yowasp/clang` vendoring:

```bash
tools/artifacts/vendor-yowasp-clang.sh
```

## 전제 조건

호스트 빌드:

- `cmake`
- `ninja`
- `python3`
- `cargo`
- `clang`
- `tar`

Docker 빌드:

- `docker`

Docker 모드는 빌드 환경의 차이를 줄이는 용도다. 단, `wasi-sdk` 소스 checkout 자체는 사용자가 미리 준비해야 한다.

## 출력물 계약

현재 런타임은 `sysroot.tar.gz` 내부에 최소한 다음 파일들이 있어야 동작한다.

- `sysroot/include/wasm32-wasi/c++/v1/iostream`
- `sysroot/lib/wasm32-wasi/crt1.o`
- `sysroot/lib/wasm32-wasi/libc.a`
- `sysroot/lib/wasm32-wasi/libc++.a`
- `sysroot/lib/wasm32-wasi/libc++abi.a`
- `sysroot/lib/clang/22/include/stddef.h`
- `sysroot/lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a`

추가로 vendored `@yowasp/clang` artifact 디렉터리에는 최소한 다음 파일이 있어야 한다.

- `bundle.js`
- `llvm-resources.tar`
- `llvm.core.wasm`
- `llvm.core2.wasm`
- `llvm.core3.wasm`
- `llvm.core4.wasm`
- `metadata.json`

`metadata.json`에는 package version, source tarball sha256, entrypoint, 파일별 sha256/size를 기록한다.
