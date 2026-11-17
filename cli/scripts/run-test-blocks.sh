#!/usr/bin/env bash
# Run several test commands ("blocks") in order and fail if any of them failed.
#
# Usage (from cli/, as the package.json test scripts call it):
#   bash scripts/run-test-blocks.sh bun test ./tests/a/ :: bun test ./tests/b/ :: bun test ./tests/c/
#
# Blocks are separated by a lone `::` argument. Every block runs, even after an earlier one fails,
# so each block's full pass/fail counts are still printed. The exit code is 0 when every block
# passed and 1 when any block failed; a summary of the failed blocks goes to stderr.
#
# Why: the test scripts used to join their blocks with `;`, so the script's exit code was the last
# block's alone and a failure in an earlier block (such as the `--concurrent` unit block) never failed
# `npm test`, the release workflow's gate. `&&` would fail the run but skip the later blocks.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "run-test-blocks: no command given" >&2
  exit 2
fi

failed=()
block=()
count=0

run_block() {
  count=$((count + 1))
  if [ "${#block[@]}" -eq 0 ]; then
    echo "run-test-blocks: block $count is empty (two '::' in a row, or one at either end)" >&2
    exit 2
  fi
  "${block[@]}"
  local status=$?
  if [ "$status" -ne 0 ]; then
    failed+=("block $count (exit $status): ${block[*]:0:6}...")
  fi
  block=()
}

for arg in "$@"; do
  if [ "$arg" = "::" ]; then
    run_block
  else
    block+=("$arg")
  fi
done
run_block

if [ "${#failed[@]}" -gt 0 ]; then
  echo "" >&2
  echo "run-test-blocks: ${#failed[@]} of $count test blocks failed:" >&2
  for f in "${failed[@]}"; do
    echo "  - $f" >&2
  done
  exit 1
fi
echo "run-test-blocks: all $count test blocks passed"
