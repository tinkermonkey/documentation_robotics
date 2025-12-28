#!/usr/bin/env bash
set -euo pipefail

# Syncs baseline into python-cli/ and ts-cli/ for compatibility runs.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE="$ROOT_DIR/baseline"
TARGETS=("python-cli" "ts-cli")

if [ ! -d "$BASELINE" ]; then
  echo "Baseline not found at $BASELINE" >&2
  exit 1
fi

for target in "${TARGETS[@]}"; do
  DEST="$ROOT_DIR/$target"
  mkdir -p "$DEST"
  rsync -a --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "$BASELINE"/ "$DEST"/
  echo "[sync] Updated $DEST from baseline"
done

echo "Baseline sync complete."
