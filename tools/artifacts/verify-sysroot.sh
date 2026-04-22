#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <sysroot.tar.gz>" >&2
  exit 1
fi

SYSROOT_TAR_GZ="$1"

if [[ ! -f "${SYSROOT_TAR_GZ}" ]]; then
  echo "sysroot archive not found: ${SYSROOT_TAR_GZ}" >&2
  exit 1
fi

require_entry() {
  local entry="$1"
  if ! tar -tzf "${SYSROOT_TAR_GZ}" "${entry}" >/dev/null 2>&1; then
    echo "missing required archive entry: ${entry}" >&2
    exit 1
  fi
}

require_any_entry() {
  local found=0
  for entry in "$@"; do
    if tar -tzf "${SYSROOT_TAR_GZ}" "${entry}" >/dev/null 2>&1; then
      found=1
      break
    fi
  done
  if [[ "${found}" -ne 1 ]]; then
    echo "missing required archive entry from candidates: $*" >&2
    exit 1
  fi
}

require_entry "sysroot/include/wasm32-wasi/c++/v1/iostream"
require_entry "sysroot/lib/wasm32-wasi/crt1.o"
require_entry "sysroot/lib/wasm32-wasi/libc.a"
require_entry "sysroot/lib/wasm32-wasi/libc++.a"
require_entry "sysroot/lib/wasm32-wasi/libc++abi.a"
require_any_entry \
  "sysroot/lib/clang/22/include/stddef.h" \
  "sysroot/lib/clang/22.1.0/include/stddef.h"
require_any_entry \
  "sysroot/lib/clang/22/lib/wasm32-unknown-wasi/libclang_rt.builtins.a" \
  "sysroot/lib/clang/22/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a" \
  "sysroot/lib/clang/22.1.0/lib/wasm32-unknown-wasi/libclang_rt.builtins.a" \
  "sysroot/lib/clang/22.1.0/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a"

echo "sysroot archive verification passed: ${SYSROOT_TAR_GZ}"
