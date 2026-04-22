#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="${1:-$ROOT_DIR/packages/runtime-browser/artifacts/yowasp-clang}"

python3 - "$ARTIFACT_DIR" <<'PY'
import hashlib
import json
import pathlib
import sys

artifact_dir = pathlib.Path(sys.argv[1])
metadata_path = artifact_dir / "metadata.json"

if not artifact_dir.is_dir():
    raise SystemExit(f"artifact directory not found: {artifact_dir}")
if not metadata_path.is_file():
    raise SystemExit(f"metadata file not found: {metadata_path}")

metadata = json.loads(metadata_path.read_text())
required = [
    "bundle.js",
    "llvm-resources.tar",
    "llvm.core.wasm",
    "llvm.core2.wasm",
    "llvm.core3.wasm",
    "llvm.core4.wasm",
]

if metadata.get("packageName") != "@yowasp/clang":
    raise SystemExit("metadata.packageName must be @yowasp/clang")
if metadata.get("entrypoint") != "bundle.js":
    raise SystemExit("metadata.entrypoint must be bundle.js")

files_metadata = metadata.get("files")
if not isinstance(files_metadata, dict):
    raise SystemExit("metadata.files must be an object")

for name in required:
    file_path = artifact_dir / name
    if not file_path.is_file():
      raise SystemExit(f"required file missing: {file_path}")
    if name not in files_metadata:
      raise SystemExit(f"metadata.files missing entry for {name}")
    data = file_path.read_bytes()
    sha256 = hashlib.sha256(data).hexdigest()
    expected_sha256 = files_metadata[name].get("sha256")
    if sha256 != expected_sha256:
      raise SystemExit(f"sha256 mismatch for {name}: {sha256} != {expected_sha256}")

print(f"verified vendored @yowasp/clang at {artifact_dir}")
PY
