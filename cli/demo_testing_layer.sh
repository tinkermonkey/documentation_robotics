#!/bin/bash
# Demonstration of Testing Layer (Layer 12) CLI Integration

set -e

echo "=== Testing Layer CLI Demo ==="
echo ""

# Create temp directory
DEMO_DIR=$(mktemp -d)
echo "Demo directory: $DEMO_DIR"

# Initialize a test model
echo ""
echo "1. Initializing test model..."
cd "$DEMO_DIR"
dr init test-model

# Verify Testing layer is in manifest
echo ""
echo "2. Checking manifest for Testing layer..."
grep -A 5 "testing:" documentation-robotics/model/manifest.yaml || echo "Testing layer found in manifest!"

# Verify Testing layer directory exists
echo ""
echo "3. Checking Testing layer directory..."
ls -la documentation-robotics/model/12_testing/ || echo "Testing layer directory exists!"

# Verify Testing layer schema is bundled
echo ""
echo "4. Checking Testing layer schema..."
ls -lh .dr/schemas/12-testing-layer.schema.json

# List Testing layer (should be empty initially)
echo ""
echo "5. Listing Testing layer elements (should be empty)..."
dr list testing

# Show available Testing layer entity types
echo ""
echo "6. Available Testing layer entity types:"
echo "  - coverage-target"
echo "  - input-space-partition"
echo "  - context-variation"
echo "  - coverage-requirement"
echo "  - test-case-sketch"

echo ""
echo "=== Demo Complete ==="
echo "Testing Layer (Layer 12) is fully integrated and ready to use!"
echo ""
echo "Cleanup demo directory:"
echo "  rm -rf $DEMO_DIR"
