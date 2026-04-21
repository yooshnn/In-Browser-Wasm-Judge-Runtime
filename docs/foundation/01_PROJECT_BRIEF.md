## 명칭

프로젝트명: browser-wasm-judge
GitHub repo: https://github.com/yooshnn/In-Browser-Wasm-Judge-Runtime
npm packages:
- `@cupya.me/wasm-judge-runtime-core`
- `@cupya.me/wasm-judge-runtime-cpp`
- `@cupya.me/wasm-judge-runtime-browser`
- `@cupya.me/wasm-judge-runtime-node`

## 한 줄 정의

브라우저에서 C++ stdio 제출을 컴파일·실행하고, JavaScript checker로 채점하는 라이브러리.

## 배경

기존 온라인 저지에 출제했던 문제들을 별도 채점 서버 운영 없이 다시 공유하고 싶다. 단순 문제 아카이브를 넘어, 사용자가 로컬 개발 환경을 따로 구축하지 않아도 브라우저에서 직접 코드를 실행하고 결과를 확인할 수 있어야 한다. 이를 위해 브라우저 내에서 동작하는 C++ 컴파일·실행 런타임과, 그 실행 결과를 판정하는 가벼운 채점 인터페이스가 필요하다.

또한 초기 구상은 단일 패키지에 모든 책임을 넣는 형태였지만, 실제 구현 단계에서는 타입/도메인, C++ preset 및 artifact 참조, 브라우저 런타임, Node 보조 런타임의 관심사가 분명히 갈린다. 따라서 현재 프로젝트는 4-패키지 monorepo 구조를 전제로 한다.

## 목표

- 브라우저에서 C++ stdio 제출 코드를 컴파일할 수 있다.
- 문제별 입력으로 제출 코드를 실행할 수 있다.
- 실행 결과(stdout, stderr, exit code, elapsed time, optional memory)를 수집할 수 있다.
- JavaScript checker를 통해 exact judge 및 custom special judge를 지원할 수 있다.
- 문제별 time limit, memory limit를 적용할 수 있다.
- 메인 스레드를 막지 않고 worker 기반으로 실행할 수 있다.
- 라이브러리 형태로 외부 애플리케이션에서 사용할 수 있다.
- core가 browser/node 구현과 분리된 상태로 유지될 수 있다.

## 비목표

이 프로젝트는 다음을 목표로 하지 않는다.

- 함수 구현형 문제 지원
- 범용 C++ IDE
- 범용 C++ 툴체인 배포 플랫폼
- 멀티파일 프로젝트 지원
- 외부 패키지 설치 및 패키지 매니저 지원
- 디버거, 브레이크포인트, 프로파일러 제공
- 서버형 채점 큐 및 채점 서버 구축
- 사용자 계정, 제출 저장, 랭킹, 통계 기능 제공
- 전통적 서버형 OJ 수준의 정밀한 프로세스 메모리 측정

## 대상 사용자

- 자신의 알고리즘 문제를 웹에서 쉽게 공유하고 싶은 출제자
- 별도 개발 환경 없이 stdio 문제를 직접 실행해보고 싶은 풀이자
- 브라우저 기반 C++ 실행/채점 기술을 활용하고 싶은 개발자

## 핵심 제약

- 지원 언어는 현재 `cpp` 하나로 한정한다.
- 문제 형식은 stdio형으로 한정한다.
- 채점은 JavaScript checker 기반으로 수행한다.
- 브라우저 런타임을 우선 지원하며, Node 런타임은 테스트/CI 보조 용도로 둔다.
- custom checker는 함수 직접 전달이 아니라 `checkerId` 기반 참조 모델을 사용한다.
- compile 옵션은 구조화된 preset보다 raw flags 배열을 우선한다.

## 시스템 경계

이 라이브러리는 제출 코드를 받아 컴파일·실행하고, checker를 호출해 결과를 반환하는 역할까지만 담당한다.

이 라이브러리를 사용하는 상위 웹 서비스는 다음을 담당한다.

- 문제 저장
- 제출 저장
- 채점 결과 이력 저장
- 사용자 계정 및 인증
- 랭킹, 통계, 관리 UI
- custom checker registry 구성 및 `checkerId` 해석 전략

## 성공 기준

- C++ stdio 제출 코드를 브라우저에서 컴파일할 수 있다.
- 문제별 stdin으로 제출 코드를 실행할 수 있다.
- exact checker와 custom checker 각각에 대해 채점 결과를 반환할 수 있다.
- 문제마다 서로 다른 time limit, memory limit를 적용할 수 있다.
- worker 기반 격리 실행으로 UI 블로킹 없이 동작한다.
- core가 browser/node 구현체에 직접 의존하지 않는 구조를 유지한다.
- monorepo 4-패키지 구조에서 타입 계약이 일관되게 유지된다.
