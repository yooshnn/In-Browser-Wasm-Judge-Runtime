#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_SPEC="${1:-@yowasp/clang@22.0.0-git20542-10}"
OUTPUT_DIR="${2:-$ROOT_DIR/packages/runtime-browser/artifacts/yowasp-clang}"

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

pushd "$WORK_DIR" >/dev/null
if [[ -f "$PACKAGE_SPEC" ]]; then
  TARBALL_BASENAME="$(basename "$PACKAGE_SPEC")"
  cp "$PACKAGE_SPEC" "$WORK_DIR/$TARBALL_BASENAME"
  TARBALL="$TARBALL_BASENAME"
else
  TARBALL="$(npm pack --silent "$PACKAGE_SPEC")"
fi
TARBALL_SHA256="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
tar -xzf "$TARBALL"
popd >/dev/null

PACKAGE_DIR="$WORK_DIR/package"
if [[ ! -d "$PACKAGE_DIR/gen" ]]; then
  echo "expected extracted package at $PACKAGE_DIR/gen" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

required_files=(
  "bundle.js"
  "llvm-resources.tar"
  "llvm.core.wasm"
  "llvm.core2.wasm"
  "llvm.core3.wasm"
  "llvm.core4.wasm"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$PACKAGE_DIR/gen/$file" ]]; then
    echo "missing required vendored file: $PACKAGE_DIR/gen/$file" >&2
    exit 1
  fi
  cp "$PACKAGE_DIR/gen/$file" "$OUTPUT_DIR/$file"
done

python3 - "$PACKAGE_DIR/package.json" "$PACKAGE_SPEC" "$TARBALL_SHA256" "$OUTPUT_DIR" <<'PY'
import hashlib
import json
import pathlib
import sys
from datetime import datetime, timezone

package_json_path = pathlib.Path(sys.argv[1])
package_spec = sys.argv[2]
tarball_sha256 = sys.argv[3]
output_dir = pathlib.Path(sys.argv[4])

package_json = json.loads(package_json_path.read_text())
required = [
    "bundle.js",
    "llvm-resources.tar",
    "llvm.core.wasm",
    "llvm.core2.wasm",
    "llvm.core3.wasm",
    "llvm.core4.wasm",
]

files = {}
for name in required:
    data = (output_dir / name).read_bytes()
    files[name] = {
        "sha256": hashlib.sha256(data).hexdigest(),
        "sizeBytes": len(data),
    }

metadata = {
    "packageName": package_json["name"],
    "packageVersion": package_json["version"],
    "packageSpec": package_spec,
    "entrypoint": "bundle.js",
    "sourceTarballSha256": tarball_sha256,
    "vendoredAt": datetime.now(timezone.utc).isoformat(),
    "files": files,
}

(output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
PY

echo "Vendored $PACKAGE_SPEC into $OUTPUT_DIR"
