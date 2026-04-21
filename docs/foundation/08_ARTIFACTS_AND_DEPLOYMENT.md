## 목적

이 문서는 Wasm artifacts와 배포 전략을 정리한다.

## 대상 artifacts

- `clang.wasm`
- `runtime.wasm`
- `sysroot.data`
- `manifest.json`

## 기본 원칙

- 소스 코드와 대용량 바이너리를 느슨하게 분리한다.
- `core`는 artifacts의 실제 위치와 로딩 세부사항을 몰라야 한다.
- artifact 로딩 책임은 `runtime-browser`에 둔다.
- artifact 참조 정보와 preset은 `runtime-cpp` 패키지로 분리할 수 있어야 한다.

## 권장 구조

```text
runtime-cpp/
  src/
    presets/
    manifest/

runtime-browser/
  src/
    loader/
      loadRuntimeArtifacts.ts
      resolveArtifactManifest.ts
  artifacts/
    wasm/
    manifest.json
```

## 개발 단계 전략

초기 개발 단계에서는 로컬 개발 편의를 위해 `runtime-browser/artifacts/` 아래에 artifacts를 둘 수 있다.

`runtime-cpp`는 이 artifacts를 직접 소유하기보다, preset과 manifest 해석 규약을 제공하는 역할에 집중한다.

## 장기 전략

장기적으로는 artifacts를 패키지 바깥의 배포 자산으로 분리 가능해야 한다.

권장 예시:

- GitHub Releases asset
- CDN
- 별도 static hosting

이 경우 패키지에는 최소한의 loader와 `manifest.json`만 포함하거나, manifest조차 외부 URL에서 가져오는 구조를 고려할 수 있다.

## manifest 역할

`manifest.json`은 다음 정보를 담는 용도로 사용한다.

- 파일명
- 버전
- 해시
- 크기
- 상대 경로 또는 URL

## 로딩 정책

- 런타임 시작 시 필요한 artifacts 존재 여부를 확인한다.
- 필요 시 지연 로딩 또는 초기 preload 전략을 선택할 수 있다.
- 로딩 실패는 `RuntimeHealth.ready = false` 또는 명시적 bootstrap 실패로 드러나야 한다.
- worker와 loader는 동일한 manifest 버전을 참조해야 한다.

## 패키징 원칙

- npm 패키지에 대용량 wasm/sysroot를 직접 포함하는 것은 장기적으로 지양한다.
- 소스 배포와 바이너리 배포를 분리 가능한 구조를 유지한다.
- browser/node 구현체는 동일한 core contract를 공유하되 artifact 전략은 분리 가능해야 한다.

## 브라우저 우선 고려사항

- 네트워크 환경이 느릴 수 있으므로 캐시 전략이 필요하다.
- 버전 불일치를 막기 위해 manifest 기반 버전 관리가 필요하다.
- worker와 loader가 동일한 artifact 버전을 참조해야 한다.
