#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUT_DIR="${SCRIPT_DIR}/out"
BUILD_ROOT="${SCRIPT_DIR}/build/wasi-sdk"
DOCKER_IMAGE_TAG="browser-wasm-judge/wasi-sdk-builder:32.0"

EXPECTED_WASI_LIBC_REV="2fc32bc81b9f"
EXPECTED_LLVM_REV="4434dabb6991"
EXPECTED_CONFIG_REV="f992bcc08219"
EXPECTED_LLVM_VERSION="22.1.0"
BUILD_JOBS="${BUILD_JOBS:-2}"

USE_DOCKER=0
WASI_SDK_DIR=""

usage() {
  cat <<'EOF'
Usage:
  tools/artifacts/build-wasi-sdk-sysroot.sh [--docker] /path/to/wasi-sdk

Description:
  Build wasi-sdk toolchain + sysroot and package a runtime-browser compatible
  sysroot.tar.gz from the install tree.

Options:
  --docker   Build inside the pinned Docker image defined in tools/artifacts/docker/.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

while (($# > 0)); do
  case "$1" in
    --docker)
      USE_DOCKER=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "${WASI_SDK_DIR}" ]]; then
        echo "unexpected argument: $1" >&2
        usage >&2
        exit 1
      fi
      WASI_SDK_DIR="$1"
      shift
      ;;
  esac
done

if [[ -z "${WASI_SDK_DIR}" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -d "${WASI_SDK_DIR}" ]]; then
  echo "wasi-sdk directory not found: ${WASI_SDK_DIR}" >&2
  exit 1
fi

WASI_SDK_DIR="$(cd "${WASI_SDK_DIR}" && pwd -P)"

if [[ ! -d "${WASI_SDK_DIR}/.git" ]]; then
  echo "expected a git checkout: ${WASI_SDK_DIR}" >&2
  exit 1
fi

require_cmd git
require_cmd tar

mkdir -p "${OUT_DIR}" "${BUILD_ROOT}"

submodule_rev() {
  local path="$1"
  git -C "${WASI_SDK_DIR}" rev-parse --short=12 "HEAD:${path}"
}

write_build_info() {
  local install_dir="$1"
  local output_json="${OUT_DIR}/wasi-sdk-build-info.json"
  local llvm_resource_dir
  llvm_resource_dir="$(find "${install_dir}/lib/clang" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
  local llvm_resource_version=""
  if [[ -n "${llvm_resource_dir}" ]]; then
    llvm_resource_version="$(basename "${llvm_resource_dir}")"
  fi

  cat >"${output_json}" <<EOF
{
  "wasiSdkVersion": "32.0",
  "wasiSdkRevision": "$(git -C "${WASI_SDK_DIR}" rev-parse --short=12 HEAD)",
  "wasiLibcRevision": "$(submodule_rev src/wasi-libc)",
  "llvmRevision": "$(submodule_rev src/llvm-project)",
  "configRevision": "$(submodule_rev src/config)",
  "expected": {
    "wasiLibcRevision": "${EXPECTED_WASI_LIBC_REV}",
    "llvmRevision": "${EXPECTED_LLVM_REV}",
    "configRevision": "${EXPECTED_CONFIG_REV}",
    "llvmVersion": "${EXPECTED_LLVM_VERSION}"
  },
  "installDir": "${install_dir}",
  "llvmResourceVersion": "${llvm_resource_version}"
}
EOF
}

verify_checkout() {
  local wasi_libc_rev
  local llvm_rev
  local config_rev
  wasi_libc_rev="$(submodule_rev src/wasi-libc)"
  llvm_rev="$(submodule_rev src/llvm-project)"
  config_rev="$(submodule_rev src/config)"

  echo "wasi-libc revision: ${wasi_libc_rev}"
  echo "llvm revision: ${llvm_rev}"
  echo "config revision: ${config_rev}"

  if [[ "${wasi_libc_rev}" != "${EXPECTED_WASI_LIBC_REV}" ]]; then
    echo "unexpected wasi-libc revision: expected ${EXPECTED_WASI_LIBC_REV}" >&2
    exit 1
  fi
  if [[ "${llvm_rev}" != "${EXPECTED_LLVM_REV}" ]]; then
    echo "unexpected llvm revision: expected ${EXPECTED_LLVM_REV}" >&2
    exit 1
  fi
  if [[ "${config_rev}" != "${EXPECTED_CONFIG_REV}" ]]; then
    echo "unexpected wasi-sdk config revision: expected ${EXPECTED_CONFIG_REV}" >&2
    exit 1
  fi
}

host_build() {
  require_cmd cmake
  require_cmd ninja
  require_cmd python3
  require_cmd cargo
  require_cmd clang

  local toolchain_build="${BUILD_ROOT}/toolchain"
  local sysroot_build="${BUILD_ROOT}/sysroot"
  local install_dir="${BUILD_ROOT}/install"

  rm -rf "${toolchain_build}" "${sysroot_build}" "${install_dir}"

  cmake -G Ninja -B "${toolchain_build}" -S "${WASI_SDK_DIR}" \
    -DWASI_SDK_BUILD_TOOLCHAIN=ON \
    -DCMAKE_INSTALL_PREFIX="${install_dir}"
  cmake --build "${toolchain_build}" --target install -- -j"${BUILD_JOBS}"

  cmake -G Ninja -B "${sysroot_build}" -S "${WASI_SDK_DIR}" \
    -DCMAKE_INSTALL_PREFIX="${install_dir}" \
    -DCMAKE_TOOLCHAIN_FILE="${install_dir}/share/cmake/wasi-sdk.cmake" \
    -DCMAKE_C_COMPILER_WORKS=ON \
    -DCMAKE_CXX_COMPILER_WORKS=ON \
    -DWASI_SDK_INSTALL_TO_CLANG_RESOURCE_DIR=ON
  cmake --build "${sysroot_build}" --target install -- -j"${BUILD_JOBS}"

  write_build_info "${install_dir}"
  "${SCRIPT_DIR}/package-sysroot.sh" "${install_dir}" "${OUT_DIR}/sysroot.tar.gz"
  "${SCRIPT_DIR}/verify-sysroot.sh" "${OUT_DIR}/sysroot.tar.gz"
}

docker_build() {
  require_cmd docker
  docker build -t "${DOCKER_IMAGE_TAG}" -f "${SCRIPT_DIR}/docker/wasi-sdk.Dockerfile" "${REPO_ROOT}"

  mkdir -p "${BUILD_ROOT}"
  local container_src_dir="${WASI_SDK_DIR}"
  rm -rf "${BUILD_ROOT}/toolchain" "${BUILD_ROOT}/sysroot" "${BUILD_ROOT}/install"
  docker run --rm \
    -v "${WASI_SDK_DIR}:${container_src_dir}" \
    -v "${BUILD_ROOT}:/work/build" \
    -v "${OUT_DIR}:/work/out" \
    "${DOCKER_IMAGE_TAG}" \
    /bin/bash -lc '
      set -euo pipefail
      cmake -G Ninja -B /work/build/toolchain -S "'"${container_src_dir}"'" \
        -DWASI_SDK_BUILD_TOOLCHAIN=ON \
        -DCMAKE_INSTALL_PREFIX=/work/build/install
      cmake --build /work/build/toolchain --target install -- -j'"${BUILD_JOBS}"'

      cmake -G Ninja -B /work/build/sysroot -S "'"${container_src_dir}"'" \
        -DCMAKE_INSTALL_PREFIX=/work/build/install \
        -DCMAKE_TOOLCHAIN_FILE=/work/build/install/share/cmake/wasi-sdk.cmake \
        -DCMAKE_C_COMPILER_WORKS=ON \
        -DCMAKE_CXX_COMPILER_WORKS=ON \
        -DWASI_SDK_INSTALL_TO_CLANG_RESOURCE_DIR=ON
      cmake --build /work/build/sysroot --target install -- -j'"${BUILD_JOBS}"'
    '

  write_build_info "${BUILD_ROOT}/install"
  "${SCRIPT_DIR}/package-sysroot.sh" "${BUILD_ROOT}/install" "${OUT_DIR}/sysroot.tar.gz"
  "${SCRIPT_DIR}/verify-sysroot.sh" "${OUT_DIR}/sysroot.tar.gz"
}

verify_checkout

if [[ "${USE_DOCKER}" -eq 1 ]]; then
  docker_build
else
  host_build
fi

echo "sysroot packaged at ${OUT_DIR}/sysroot.tar.gz"
