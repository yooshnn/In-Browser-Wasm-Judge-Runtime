#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <wasi-sdk-install-dir> <output-tar-gz>" >&2
  exit 1
fi

INSTALL_DIR="$(cd "$1" && pwd)"
OUTPUT_TAR_GZ="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="${SCRIPT_DIR}/build/package-sysroot"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  echo "install directory not found: ${INSTALL_DIR}" >&2
  exit 1
fi

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/sysroot"

copy_tree() {
  local src="$1"
  local dest="$2"
  if [[ ! -e "${src}" ]]; then
    echo "missing required path: ${src}" >&2
    exit 1
  fi
  mkdir -p "${dest}"
  cp -R "${src}/." "${dest}/"
}

copy_tree "${INSTALL_DIR}/share/wasi-sysroot/include" "${STAGE_DIR}/sysroot/include"
copy_tree "${INSTALL_DIR}/share/wasi-sysroot/lib" "${STAGE_DIR}/sysroot/lib"

if [[ -d "${INSTALL_DIR}/lib/clang" ]]; then
  mkdir -p "${STAGE_DIR}/sysroot/lib/clang"
  cp -R "${INSTALL_DIR}/lib/clang/." "${STAGE_DIR}/sysroot/lib/clang/"
fi

mkdir -p "$(dirname "${OUTPUT_TAR_GZ}")"
tar -C "${STAGE_DIR}" -czf "${OUTPUT_TAR_GZ}" sysroot

echo "packaged ${OUTPUT_TAR_GZ}"
