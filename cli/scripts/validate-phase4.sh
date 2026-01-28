#!/bin/bash

##
## Phase 4 Validation Script
##
## Verifies that parallel test execution is properly configured.
## Run this script to validate the Phase 4 implementation.
##

set -e

echo "=================================="
echo "Phase 4: Parallel Test Execution"
echo "Validation Script"
echo "=================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check counter
CHECKS_PASSED=0
CHECKS_FAILED=0

# Helper function for checks
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((CHECKS_PASSED++))
    else
        echo -e "${RED}✗${NC} $1"
        ((CHECKS_FAILED++))
    fi
}

echo "Checking Phase 4 Configuration..."
echo ""

# 1. Check bunfig.toml exists and has parallel config
echo "1. Bun Configuration (bunfig.toml)"
test -f "bunfig.toml" && grep -q "workers = " "bunfig.toml"
check "bunfig.toml has workers configuration"

grep -q "batchSize = " "bunfig.toml"
check "bunfig.toml has batchSize configuration"

grep -q "preload = " "bunfig.toml"
check "bunfig.toml has preload configuration"

grep -q "fileTimeoutMs = " "bunfig.toml"
check "bunfig.toml has fileTimeoutMs configuration"

echo ""

# 2. Check test scripts exist
echo "2. Test Scripts (package.json)"
grep -q "\"test:parallel\":" "package.json"
check "npm test:parallel script exists"

grep -q "\"test:parallel:fast\":" "package.json"
check "npm test:parallel:fast script exists"

grep -q "\"test:parallel:ci\":" "package.json"
check "npm test:parallel:ci script exists"

grep -q "\"test:perf\":" "package.json"
check "npm test:perf script exists"

echo ""

# 3. Check test infrastructure files
echo "3. Test Infrastructure Files"
test -f "tests/setup.ts"
check "tests/setup.ts exists"

test -f "tests/test-categories.ts"
check "tests/test-categories.ts exists"

test -f "tests/metrics.ts"
check "tests/metrics.ts exists"

echo ""

# 4. Check documentation
echo "4. Documentation"
test -f "PHASE4_PARALLEL_TESTS.md"
check "PHASE4_PARALLEL_TESTS.md exists"

echo ""

# 5. Check CI/CD workflow
echo "5. CI/CD Workflow (.github/workflows/cli-tests.yml)"
WORKFLOW_PATH="../../.github/workflows/cli-tests.yml"
[ -f "$WORKFLOW_PATH" ] && grep -q "test-fast-track:" "$WORKFLOW_PATH"
check "CI/CD has test-fast-track job"

[ -f "$WORKFLOW_PATH" ] && grep -q "test-full:" "$WORKFLOW_PATH"
check "CI/CD has test-full job"

[ -f "$WORKFLOW_PATH" ] && grep -q "matrix:" "$WORKFLOW_PATH"
check "CI/CD has matrix strategy"

[ -f "$WORKFLOW_PATH" ] && grep -q "shard:" "$WORKFLOW_PATH"
check "CI/CD has shard configuration"

echo ""

# 6. Check test categorization module
echo "6. Test Categories Module"
grep -q "export const TEST_CATEGORIES" "tests/test-categories.ts"
check "Test categories exported"

grep -q "critical" "tests/test-categories.ts"
check "Critical test category defined"

grep -q "high" "tests/test-categories.ts"
check "High test category defined"

grep -q "FAST_TRACK_PATTERNS" "tests/test-categories.ts"
check "Fast-track patterns defined"

echo ""

# 7. Check metrics module
echo "7. Metrics Collection Module"
grep -q "class MetricsCollector" "tests/metrics.ts"
check "MetricsCollector class defined"

grep -q "recordTest" "tests/metrics.ts"
check "Test recording function exists"

grep -q "getAggregated" "tests/metrics.ts"
check "Metrics aggregation function exists"

grep -q "generateReport" "tests/metrics.ts"
check "Report generation function exists"

echo ""

# 8. Summary
echo "=================================="
echo "Validation Results"
echo "=================================="
echo -e "Checks Passed: ${GREEN}${CHECKS_PASSED}${NC}"
echo -e "Checks Failed: ${RED}${CHECKS_FAILED}${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ Phase 4 configuration is valid!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run fast-track tests:"
    echo "     npm run test:parallel:fast"
    echo ""
    echo "  2. Run full test suite:"
    echo "     npm run test:coverage"
    echo ""
    echo "  3. Check metrics:"
    echo "     ls coverage/metrics/"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Phase 4 configuration has issues!${NC}"
    echo "Please check the failed items above."
    echo ""
    exit 1
fi
