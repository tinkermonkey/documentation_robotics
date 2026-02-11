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

# Create base directory
mkdir -p "$BUNDLED_DIR/base"

# Copy base schemas
if [ -d "$SPEC_SCHEMAS/base" ]; then
  base_count=$(find "$SPEC_SCHEMAS/base" -name '*.json' | wc -l)
  cp "$SPEC_SCHEMAS/base/"*.json "$BUNDLED_DIR/base/"
  echo "Copied $base_count base schema files"
fi

# Copy nodes and relationships directories if they exist
if [ -d "$SPEC_SCHEMAS/nodes" ]; then
  mkdir -p "$BUNDLED_DIR/nodes"
  cp -r "$SPEC_SCHEMAS/nodes/"* "$BUNDLED_DIR/nodes/"
  echo "Copied nodes directory"
fi

if [ -d "$SPEC_SCHEMAS/relationships" ]; then
  mkdir -p "$BUNDLED_DIR/relationships"
  cp -r "$SPEC_SCHEMAS/relationships/"* "$BUNDLED_DIR/relationships/"
  echo "Copied relationships directory"
fi

# Copy layer instances (from spec/layers, not spec/schemas/layers)
if [ -d "$REPO_ROOT/spec/layers" ]; then
  mkdir -p "$BUNDLED_DIR/layers"
  cp "$REPO_ROOT/spec/layers/"*.layer.json "$BUNDLED_DIR/layers/"
  echo "Copied layer instances"
fi

# --- Validate file count ---

bundled_count=$(find "$BUNDLED_DIR" -name '*.json' | wc -l)
# Exclude relationship-catalog.json from spec count (not bundled anymore)
total_spec=$(find "$SPEC_SCHEMAS" -name '*.json' ! -name 'relationship-catalog.json' | wc -l)

if [ "$bundled_count" -lt "$total_spec" ]; then
  echo "ERROR: bundled has $bundled_count files but spec has $total_spec" >&2
  exit 1
fi

# --- Update BUNDLED_SPEC_VERSION ---

SPEC_VERSION=$(tr -d '[:space:]' < "$SPEC_VERSION_FILE")

if [ ! -f "$SPEC_VERSION_TS" ]; then
  echo "WARNING: spec-version.ts not found at $SPEC_VERSION_TS — skipping version update" >&2
else
  # Escape special regex characters in SPEC_VERSION for safe sed replacement
  ESCAPED_VERSION=$(printf '%s\n' "$SPEC_VERSION" | sed -e 's/[\/&]/\\&/g')

  sed -i "s/const BUNDLED_SPEC_VERSION = \"[^\"]*\"/const BUNDLED_SPEC_VERSION = \"$ESCAPED_VERSION\"/" "$SPEC_VERSION_TS"

  # Verify the replacement actually occurred
  if ! grep -q "const BUNDLED_SPEC_VERSION = \"$ESCAPED_VERSION\"" "$SPEC_VERSION_TS"; then
    echo "ERROR: Failed to update BUNDLED_SPEC_VERSION in $SPEC_VERSION_TS" >&2
    echo "Expected version: $SPEC_VERSION" >&2
    exit 1
  fi

  echo "Updated BUNDLED_SPEC_VERSION to '$SPEC_VERSION'"
fi

echo "Spec schema sync complete ($bundled_count files)"
