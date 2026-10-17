#!/usr/bin/env bash
# Installs the Emscripten SDK into .emsdk/ at the version pinned in
# engine/emsdk-version.txt. If that file is absent, installs "latest" and
# writes the resolved version into it — that is how the pin is established.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="$ROOT/.emsdk"
PIN_FILE="$ROOT/engine/emsdk-version.txt"

if [ ! -d "$EMSDK_DIR" ]; then
  git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
fi

cd "$EMSDK_DIR"
git fetch --tags --quiet

if [ -f "$PIN_FILE" ]; then
  VERSION="$(tr -d '[:space:]' < "$PIN_FILE")"
else
  VERSION="latest"
fi

./emsdk install "$VERSION"
./emsdk activate "$VERSION"

# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh"

RESOLVED="$(emcc --version | head -n1 | sed -E 's/.*emcc \(.*\) ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
if [ -z "$RESOLVED" ]; then
  echo "Could not parse the emcc version — refusing to write an empty pin." >&2
  exit 1
fi

if [ ! -f "$PIN_FILE" ]; then
  echo "$RESOLVED" > "$PIN_FILE"
  echo "Pinned Emscripten to $RESOLVED in engine/emsdk-version.txt"
fi

echo "Emscripten $RESOLVED active."
echo "In a new shell, run:  source $EMSDK_DIR/emsdk_env.sh"
