#!/bin/bash
#
# Release Checklist Script for Documentation Robotics CLI
# Usage: ./scripts/release-checklist.sh [cli-version]
# Example: ./scripts/release-checklist.sh 0.1.0
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Emoji for checks
CHECK="✓"
CROSS="✗"
WARN="⚠"
INFO="ℹ"

# Get version from argument or package.json
if [ -n "$1" ]; then
    CLI_VERSION="$1"
else
    CLI_VERSION=$(node -p "require('./cli/package.json').version")
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Documentation Robotics CLI - Release Checklist v${CLI_VERSION}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Track overall status
ALL_CHECKS_PASSED=true

# Helper function for checks
check() {
    local name="$1"
    local command="$2"
    local required="${3:-true}"
    
    printf "%-50s" "$name"
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}${CHECK}${NC}"
        return 0
    else
        if [ "$required" = "true" ]; then
            echo -e "${RED}${CROSS}${NC}"
            ALL_CHECKS_PASSED=false
            return 1
        else
            echo -e "${YELLOW}${WARN}${NC} (optional)"
            return 0
        fi
    fi
}

# Helper function for info
info() {
    local name="$1"
    local value="$2"
    printf "%-50s${BLUE}%s${NC}\n" "$name" "$value"
}

# Section header
section() {
    echo ""
    echo -e "${BLUE}▶ $1${NC}"
    echo "──────────────────────────────────────────────────────────"
}

#
# 1. Version Checks
#
section "Version Verification"

CLI_PKG_VERSION=$(node -p "require('./cli/package.json').version")
SPEC_VERSION=$(cat spec/VERSION)
BUNDLED_SPEC_VERSION=$(grep "BUNDLED_SPEC_VERSION = " cli/src/utils/spec-version.ts | cut -d"'" -f2)

info "CLI package.json version" "$CLI_PKG_VERSION"
info "Spec VERSION file" "$SPEC_VERSION"
info "CLI bundled spec version" "$BUNDLED_SPEC_VERSION"

if [ "$CLI_PKG_VERSION" = "$CLI_VERSION" ]; then
    echo -e "${GREEN}${CHECK}${NC} CLI version matches expected: ${CLI_VERSION}"
else
    echo -e "${RED}${CROSS}${NC} CLI version mismatch: expected ${CLI_VERSION}, got ${CLI_PKG_VERSION}"
    ALL_CHECKS_PASSED=false
fi

if [ "$BUNDLED_SPEC_VERSION" = "$SPEC_VERSION" ]; then
    echo -e "${GREEN}${CHECK}${NC} Bundled spec version matches spec/VERSION"
else
    echo -e "${YELLOW}${WARN}${NC} Spec version mismatch: bundled=${BUNDLED_SPEC_VERSION}, spec=${SPEC_VERSION}"
fi

#
# 2. Required Files
#
section "Required Files"

check "cli/package.json exists" "[ -f cli/package.json ]"
check "cli/README.md exists" "[ -f cli/README.md ]"
check "cli/LICENSE exists" "[ -f cli/LICENSE ]"
check "cli/CHANGELOG.md exists" "[ -f cli/CHANGELOG.md ]" "false"
check "cli/tsconfig.json exists" "[ -f cli/tsconfig.json ]"
check "cli/esbuild.config.js exists" "[ -f cli/esbuild.config.js ]"

#
# 3. Schema Synchronization
#
section "Schema Synchronization"

echo "Checking if spec schemas match CLI bundled schemas..."
SCHEMA_DIFF=$(diff -r spec/schemas/ cli/src/schemas/bundled/ 2>&1 || true)

if [ -z "$SCHEMA_DIFF" ]; then
    echo -e "${GREEN}${CHECK}${NC} Spec schemas match CLI bundled schemas"
else
    echo -e "${RED}${CROSS}${NC} Schema mismatch detected:"
    echo "$SCHEMA_DIFF" | head -20
    ALL_CHECKS_PASSED=false
fi

#
# 4. Build Test
#
section "Build System"

cd cli
echo "Running build..."

if npm run build > /tmp/build.log 2>&1; then
    echo -e "${GREEN}${CHECK}${NC} Build completed successfully"
    
    # Check for build artifacts
    check "dist/cli.js exists" "[ -f dist/cli.js ]"
    check "dist/schemas/ exists" "[ -d dist/schemas ]"
    check "dist/core/ exists" "[ -d dist/core ]"
    check "dist/commands/ exists" "[ -d dist/commands ]"
else
    echo -e "${RED}${CROSS}${NC} Build failed. See /tmp/build.log for details"
    ALL_CHECKS_PASSED=false
fi

cd ..

#
# 5. Test Suite
#
section "Test Suite"

cd cli
echo "Running tests..."

if npm test > /tmp/test.log 2>&1; then
    echo -e "${GREEN}${CHECK}${NC} All tests passed"
    
    # Extract test stats
    TEST_STATS=$(grep -E "pass|fail|skip" /tmp/test.log | tail -3)
    echo "$TEST_STATS"
else
    echo -e "${RED}${CROSS}${NC} Tests failed. See /tmp/test.log for details"
    grep -A 10 "fail" /tmp/test.log || true
    ALL_CHECKS_PASSED=false
fi

cd ..

#
# 6. Package Contents
#
section "Package Contents"

cd cli
echo "Checking package contents..."

npm pack --dry-run > /tmp/pack.log 2>&1
PACKAGE_SIZE=$(grep "package size:" /tmp/pack.log | awk '{print $4, $5}')

info "Package size" "$PACKAGE_SIZE"

# Verify critical files are included
if grep -q "LICENSE" /tmp/pack.log; then
    echo -e "${GREEN}${CHECK}${NC} LICENSE included in package"
else
    echo -e "${RED}${CROSS}${NC} LICENSE missing from package"
    ALL_CHECKS_PASSED=false
fi

if grep -q "README.md" /tmp/pack.log; then
    echo -e "${GREEN}${CHECK}${NC} README.md included in package"
else
    echo -e "${RED}${CROSS}${NC} README.md missing from package"
    ALL_CHECKS_PASSED=false
fi

if grep -q "dist/cli.js" /tmp/pack.log; then
    echo -e "${GREEN}${CHECK}${NC} dist/cli.js included in package"
else
    echo -e "${RED}${CROSS}${NC} dist/cli.js missing from package"
    ALL_CHECKS_PASSED=false
fi

cd ..

#
# 7. Git Status
#
section "Git Repository"

# Check for uncommitted changes
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${GREEN}${CHECK}${NC} Working directory clean"
else
    echo -e "${YELLOW}${WARN}${NC} Uncommitted changes detected:"
    git status --short
fi

# Check if tag exists
if git rev-parse "cli-v${CLI_VERSION}" >/dev/null 2>&1; then
    echo -e "${YELLOW}${WARN}${NC} Tag cli-v${CLI_VERSION} already exists"
else
    echo -e "${GREEN}${CHECK}${NC} Tag cli-v${CLI_VERSION} does not exist (ready to create)"
fi

# Check current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "Current branch" "$CURRENT_BRANCH"

#
# 8. Documentation Checks
#
section "Documentation"

# Check README version references
README_CLI_VERSION=$(grep -o "CLI-v[0-9]\+\.[0-9]\+\.[0-9]\+" cli/README.md | head -1 | cut -d'v' -f2)
README_SPEC_VERSION=$(grep -o "Specification-v[0-9]\+\.[0-9]\+\.[0-9]\+" README.md | head -1 | cut -d'v' -f2)

if [ "$README_CLI_VERSION" = "$CLI_VERSION" ] || [ -z "$README_CLI_VERSION" ]; then
    echo -e "${GREEN}${CHECK}${NC} README CLI version reference up to date"
else
    echo -e "${YELLOW}${WARN}${NC} README CLI version: ${README_CLI_VERSION} (expected: ${CLI_VERSION})"
fi

if [ "$README_SPEC_VERSION" = "$SPEC_VERSION" ] || [ -z "$README_SPEC_VERSION" ]; then
    echo -e "${GREEN}${CHECK}${NC} README spec version reference up to date"
else
    echo -e "${YELLOW}${WARN}${NC} README spec version: ${README_SPEC_VERSION} (expected: ${SPEC_VERSION})"
fi

#
# Final Summary
#
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$ALL_CHECKS_PASSED" = true ]; then
    echo -e "  ${GREEN}${CHECK} ALL CHECKS PASSED - READY FOR RELEASE${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Next steps to release v${CLI_VERSION}:"
    echo ""
    echo "  1. Review changes:"
    echo "     git diff"
    echo ""
    echo "  2. Commit any final changes:"
    echo "     git add -A"
    echo "     git commit -m \"Release CLI v${CLI_VERSION}\""
    echo ""
    echo "  3. Create and push the release tag:"
    echo "     git tag cli-v${CLI_VERSION}"
    echo "     git push origin main"
    echo "     git push origin cli-v${CLI_VERSION}"
    echo ""
    echo "  4. Publish to npm (if not using GitHub Actions):"
    echo "     cd cli && npm publish"
    echo ""
    echo "  5. Verify publication:"
    echo "     npm view @documentation-robotics/cli@${CLI_VERSION}"
    echo ""
    exit 0
else
    echo -e "  ${RED}${CROSS} CHECKS FAILED - DO NOT RELEASE${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Please fix the issues above before releasing."
    echo "See /tmp/build.log and /tmp/test.log for details."
    echo ""
    exit 1
fi
