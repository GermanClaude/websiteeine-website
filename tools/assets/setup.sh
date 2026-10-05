#!/bin/sh
# Installiert die Werkzeuge der Asset-Pipeline außerhalb des Repos (tools/out/npm, gitignored) und verlinkt
# sie als tools/assets/node_modules (ebenfalls gitignored). Einmalig ausführen: sh tools/assets/setup.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NPM_DIR="$ROOT/tools/out/npm"
mkdir -p "$NPM_DIR"
[ -f "$NPM_DIR/package.json" ] || echo '{"name":"np-asset-tools","private":true,"type":"module"}' > "$NPM_DIR/package.json"
cd "$NPM_DIR"
npm install --no-audit --no-fund \
  three@0.186.1 @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 \
  meshoptimizer sharp ktx2-encoder
ln -sfn ../out/npm/node_modules "$ROOT/tools/assets/node_modules"
echo "ok: $NPM_DIR"
