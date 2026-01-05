#!/bin/bash

echo "=== Phase 4 Integration Version Checking Test ==="
echo ""

# Create temporary directory for test
TESTDIR=$(mktemp -d)
echo "Test directory: $TESTDIR"

cd "$TESTDIR"

echo ""
echo "1. Initialize a new model..."
node /workspace/cli/dist/cli.js init --name "Phase 4 Test" > /dev/null 2>&1

echo "2. Upgrade to current spec version..."
node /workspace/cli/dist/cli.js upgrade --yes > /dev/null 2>&1

echo "3. Install Claude integration..."
node /workspace/cli/dist/cli.js claude install --force > /dev/null 2>&1

echo "4. Verify upgrade check shows integrations up to date..."
echo ""
echo "Running: dr upgrade --yes"
node /workspace/cli/dist/cli.js upgrade --yes | head -20

echo ""
echo "5. Clean up test directory..."
cd /
rm -rf "$TESTDIR"

echo ""
echo "=== Test Complete ==="
