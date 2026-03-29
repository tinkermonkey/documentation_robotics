#!/usr/bin/env bash
#
# sync-spec-schemas.sh — Copy spec/dist/*.json into cli/src/schemas/bundled/
# and update BUNDLED_SPEC_VERSION in spec-version.ts.
#
# Requires spec/dist/ to already exist (run `npm run build:spec` at repo root first).
# Safe to run repeatedly (idempotent). Called automatically by `npm run build`.

set -euo pipefail

# Resolve directories relative to this script (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLI_DIR/.." && pwd)"

SPEC_DIST="$REPO_ROOT/spec/dist"
BUNDLED_DIR="$CLI_DIR/src/schemas/bundled"
SPEC_VERSION_TS="$CLI_DIR/src/utils/spec-version.ts"

# --- Pre-flight checks ---

if [ ! -d "$SPEC_DIST" ]; then
  echo "ERROR: spec/dist/ not found at $SPEC_DIST" >&2
  echo "Run 'npm run build:spec' at the repo root first to compile the spec." >&2
  exit 1
fi

if [ ! -f "$SPEC_DIST/manifest.json" ]; then
  echo "ERROR: spec/dist/manifest.json not found — spec/dist/ appears incomplete" >&2
  echo "Run 'npm run build:spec' at the repo root to rebuild the spec distribution." >&2
  exit 1
fi

# --- Sync compiled spec files ---

rm -rf "$BUNDLED_DIR"
mkdir -p "$BUNDLED_DIR"

cp "$SPEC_DIST"/*.json "$BUNDLED_DIR/"

bundled_count=$(find "$BUNDLED_DIR" -name '*.json' | wc -l | tr -d ' ')
echo "Copied $bundled_count compiled spec files to bundled/"

# --- Version is now read dynamically from bundled manifest.json at runtime ---
# Previously, we would update a hardcoded constant here, but now the version
# is read directly from the bundled manifest.json file during module initialization.
# This ensures the version is always in sync with the actual bundled spec.

echo "Spec schema sync complete ($bundled_count files)"
