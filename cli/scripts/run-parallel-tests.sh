#!/bin/bash
# Parallel test execution matching CI pipeline sharding strategy
# Runs tests across 4 shards in parallel, mimicking GitHub Actions matrix execution

set -e

# Configuration
TOTAL_SHARDS=4
COVERAGE=${1:-false}
OUTPUT_DIR="test-results-parallel"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================="
echo "Parallel Test Execution (${TOTAL_SHARDS} shards)"
echo "Coverage: ${COVERAGE}"
echo "=================================="
echo ""

# Clean up previous results
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Get all test files and sort them (same as CI)
# This includes all tests that will be distributed across shards
TEST_FILES=$(find tests -name "*.test.ts" | sort)
TEST_COUNT=$(echo "$TEST_FILES" | wc -l)

echo "Total test files: $TEST_COUNT"
echo "Tests per shard: ~$((TEST_COUNT / TOTAL_SHARDS))"
echo ""

# Array to track background PIDs
declare -a PIDS

# Function to run a single shard
run_shard() {
  local SHARD=$1
  local SHARD_TESTS=$(echo "$TEST_FILES" | awk -v shard=$SHARD -v total=$TOTAL_SHARDS 'NR % total == shard - 1 { print }' | tr '\n' ' ')
  local SHARD_COUNT=$(echo "$SHARD_TESTS" | wc -w)

  if [ -z "$SHARD_TESTS" ]; then
    echo -e "${YELLOW}[Shard $SHARD/${TOTAL_SHARDS}]${NC} No tests assigned"
    return 0
  fi

  echo -e "${GREEN}[Shard $SHARD/${TOTAL_SHARDS}]${NC} Running $SHARD_COUNT test files"

  # Build command based on coverage flag
  # Note: Using --concurrent like CI does within each shard
  if [ "$COVERAGE" = "true" ]; then
    CMD="bun test --concurrent --coverage $SHARD_TESTS"
  else
    CMD="bun test --concurrent $SHARD_TESTS"
  fi

  # Run tests and capture output
  if $CMD > "$OUTPUT_DIR/shard-$SHARD.log" 2>&1; then
    echo -e "${GREEN}[Shard $SHARD/${TOTAL_SHARDS}]${NC} ✓ Completed successfully"
    return 0
  else
    echo -e "${RED}[Shard $SHARD/${TOTAL_SHARDS}]${NC} ✗ Failed"
    return 1
  fi
}

# Launch all shards in parallel
echo "Launching $TOTAL_SHARDS test shards..."
echo ""

for SHARD in $(seq 1 $TOTAL_SHARDS); do
  run_shard $SHARD &
  PIDS[$SHARD]=$!
done

# Wait for all shards to complete and track failures
FAILED_SHARDS=()
for SHARD in $(seq 1 $TOTAL_SHARDS); do
  if ! wait ${PIDS[$SHARD]}; then
    FAILED_SHARDS+=($SHARD)
  fi
done

echo ""
echo "=================================="
echo "Test Execution Complete"
echo "=================================="

# Show summary
if [ ${#FAILED_SHARDS[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ All shards passed${NC}"
  echo ""
  echo "View detailed logs:"
  for SHARD in $(seq 1 $TOTAL_SHARDS); do
    echo "  Shard $SHARD: $OUTPUT_DIR/shard-$SHARD.log"
  done
  exit 0
else
  echo -e "${RED}✗ ${#FAILED_SHARDS[@]} shard(s) failed:${NC}"
  for SHARD in "${FAILED_SHARDS[@]}"; do
    echo -e "${RED}  - Shard $SHARD${NC}"
    echo "    Log: $OUTPUT_DIR/shard-$SHARD.log"
  done
  echo ""
  echo "To view failure details:"
  echo "  cat $OUTPUT_DIR/shard-*.log"
  exit 1
fi
