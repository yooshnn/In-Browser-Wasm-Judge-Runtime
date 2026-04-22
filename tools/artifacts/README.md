# Artifact Build Tooling

이 디렉터리는 브라우저 런타임이 사용하는 대용량 artifact를 재현 가능하게 빌드하기 위한 스크립트 모음이다.

현재는 두 영역을 분리해서 다룬다.

- `sysroot/compiler-rt`: `wasi-sdk-32` 기준으로 재생성 가능
- 브라우저용 `clang.js/.wasm`, `wasm-ld.js/.wasm`: 별도 toolchain 작업 필요

## 현재 범위

이 디렉터리의 스크립트는 다음을 자동화한다.

- `wasi-sdk` checkout 검증
- `wasi-sdk` toolchain/sysroot 빌드
- `sysroot.tar.gz` 패키징
- 필수 파일 검증
- 빌드 메타데이터 기록

아직 자동화하지 않은 항목:

- `clang.js`
- `clang.wasm`
- `wasm-ld.js`
- `wasm-ld.wasm`

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

검증만 다시 실행:

```bash
tools/artifacts/verify-sysroot.sh tools/artifacts/out/sysroot.tar.gz
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
- `sysroot/include/wasm32-wasi/__header_sysroot.h`
- `sysroot/lib/wasm32-wasi/crt1.o`
- `sysroot/lib/wasm32-wasi/libc.a`
- `sysroot/lib/wasm32-wasi/libc++.a`
- `sysroot/lib/wasm32-wasi/libc++abi.a`
- `sysroot/lib/clang/22/include/stddef.h`

추가로, 전체 C++ STL 지원과 `__multi3` 해결을 위해 다음 파일도 포함시키는 것을 목표로 한다.

- `sysroot/lib/clang/22/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a`

주의:
현재 `packages/runtime-browser/src/internal/cppCompiler.ts` 는 `wasm-ld` 호출 시
`libclang_rt.builtins-wasm32.a` 를 아직 명시적으로 링크하지 않는다.
즉 이 파일을 sysroot에 포함하는 것만으로는 충분하지 않을 수 있으며, 이후 링크 인자 보강이 필요하다.
