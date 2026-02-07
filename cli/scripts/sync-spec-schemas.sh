#!/usr/bin/env bash
#
# sync-spec-schemas.sh — Copy spec schemas into cli/src/schemas/bundled/
# and update BUNDLED_SPEC_VERSION in spec-version.ts.
#
# Safe to run repeatedly (idempotent). Called automatically by `npm run build`.

set -euo pipefail

# Resolve directories relative to this script (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLI_DIR/.." && pwd)"

SPEC_SCHEMAS="$REPO_ROOT/spec/schemas"
BUNDLED_DIR="$CLI_DIR/src/schemas/bundled"
SPEC_VERSION_FILE="$REPO_ROOT/spec/VERSION"
SPEC_VERSION_TS="$CLI_DIR/src/utils/spec-version.ts"

# --- Pre-flight checks ---

if [ ! -d "$SPEC_SCHEMAS" ]; then
  echo "ERROR: spec/schemas/ not found at $SPEC_SCHEMAS" >&2
  echo "This script must run inside the monorepo." >&2
  exit 1
fi

if [ ! -f "$SPEC_VERSION_FILE" ]; then
  echo "ERROR: spec/VERSION not found at $SPEC_VERSION_FILE" >&2
  exit 1
fi

# --- Copy schemas ---

mkdir -p "$BUNDLED_DIR/common"

spec_count=$(find "$SPEC_SCHEMAS" -name '*.json' -not -path '*/common/*' | wc -l)

# Root-level JSON files
cp "$SPEC_SCHEMAS"/*.json "$BUNDLED_DIR/"
echo "Copied $spec_count root schema files"

# Common subdirectory
if [ -d "$SPEC_SCHEMAS/common" ]; then
  common_count=$(find "$SPEC_SCHEMAS/common" -name '*.json' | wc -l)
  cp "$SPEC_SCHEMAS/common/"*.json "$BUNDLED_DIR/common/"
  echo "Copied $common_count common schema files"
fi

# --- Validate file count ---

bundled_count=$(find "$BUNDLED_DIR" -name '*.json' | wc -l)
total_spec=$(find "$SPEC_SCHEMAS" -name '*.json' | wc -l)

if [ "$bundled_count" -lt "$total_spec" ]; then
  echo "ERROR: bundled has $bundled_count files but spec has $total_spec" >&2
  exit 1
fi

# --- Update BUNDLED_SPEC_VERSION ---

SPEC_VERSION=$(tr -d '[:space:]' < "$SPEC_VERSION_FILE")

if [ ! -f "$SPEC_VERSION_TS" ]; then
  echo "WARNING: spec-version.ts not found at $SPEC_VERSION_TS — skipping version update" >&2
else
  sed -i "s/const BUNDLED_SPEC_VERSION = '.*'/const BUNDLED_SPEC_VERSION = '$SPEC_VERSION'/" "$SPEC_VERSION_TS"
  echo "Updated BUNDLED_SPEC_VERSION to '$SPEC_VERSION'"
fi

echo "Spec schema sync complete ($bundled_count files)"
