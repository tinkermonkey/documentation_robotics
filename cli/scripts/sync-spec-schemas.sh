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

# --- Update BUNDLED_SPEC_VERSION ---

SPEC_VERSION=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$SPEC_DIST/manifest.json','utf-8')).specVersion)}catch(e){}" 2>/dev/null || echo "")

if [ -z "$SPEC_VERSION" ]; then
  echo "WARNING: Could not read specVersion from manifest.json — skipping version update" >&2
elif [ ! -f "$SPEC_VERSION_TS" ]; then
  echo "WARNING: spec-version.ts not found at $SPEC_VERSION_TS — skipping version update" >&2
else
  # Escape special regex characters in SPEC_VERSION for safe sed replacement
  ESCAPED_VERSION=$(printf '%s\n' "$SPEC_VERSION" | sed -e 's/[\/&]/\\&/g')

  # macOS (BSD sed) requires empty backup extension, Linux (GNU sed) does not
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/const BUNDLED_SPEC_VERSION = \"[^\"]*\"/const BUNDLED_SPEC_VERSION = \"$ESCAPED_VERSION\"/" "$SPEC_VERSION_TS"
  else
    sed -i "s/const BUNDLED_SPEC_VERSION = \"[^\"]*\"/const BUNDLED_SPEC_VERSION = \"$ESCAPED_VERSION\"/" "$SPEC_VERSION_TS"
  fi

  # Verify the replacement actually occurred
  if ! grep -q "const BUNDLED_SPEC_VERSION = \"$ESCAPED_VERSION\"" "$SPEC_VERSION_TS"; then
    echo "ERROR: Failed to update BUNDLED_SPEC_VERSION in $SPEC_VERSION_TS" >&2
    echo "Expected version: $SPEC_VERSION" >&2
    exit 1
  fi

  echo "Updated BUNDLED_SPEC_VERSION to '$SPEC_VERSION'"
fi

echo "Spec schema sync complete ($bundled_count files)"
