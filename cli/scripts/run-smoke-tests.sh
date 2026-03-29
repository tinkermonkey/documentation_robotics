#!/bin/bash
# Run CI smoke test suite from manifest.
# Usage: bash scripts/run-smoke-tests.sh
set -e
cd "$(dirname "$0")/.."

# Extract test file list from manifest
SMOKE_TESTS=$(bun -e "
  import { SMOKE_TESTS } from './tests/ci-smoke.manifest.ts';
  console.log(SMOKE_TESTS.join(' '));
")

# Validate all manifest entries exist
MISSING=0
for test_file in $SMOKE_TESTS; do
  if [ ! -f "$test_file" ]; then
    echo "ERROR: Smoke manifest references missing file: $test_file"
    MISSING=$((MISSING + 1))
  fi
done
if [ $MISSING -gt 0 ]; then
  echo "ERROR: $MISSING smoke test file(s) not found. Update tests/ci-smoke.manifest.ts"
  exit 1
fi

FILE_COUNT=$(echo "$SMOKE_TESTS" | wc -w | tr -d ' ')
echo "Running $FILE_COUNT smoke tests..."
time bun test $SMOKE_TESTS
