#!/bin/bash
set -e

# Create a temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

cd $TEMP_DIR

# Run init
node ../../dist/cli.js init --name "Test Project" > /dev/null 2>&1

# Install copilot
node ../../dist/cli.js copilot install --force > /dev/null 2>&1

# Modify version file to add phantom component
VERSION_FILE=".github/.dr-copilot-version"
python3 << 'PYTHON'
import yaml

with open('.github/.dr-copilot-version', 'r') as f:
    data = yaml.safe_load(f)

data['components']['phantom_component'] = {}

with open('.github/.dr-copilot-version', 'w') as f:
    yaml.safe_dump(data, f)
PYTHON

# Run upgrade and capture output
echo "=== RUNNING UPGRADE ==="
node ../../dist/cli.js copilot upgrade --force > /tmp/upgrade-output.txt 2>&1
EXIT_CODE=$?

echo "Exit code: $EXIT_CODE"
echo ""
echo "=== RAW OUTPUT ==="
cat /tmp/upgrade-output.txt
echo ""
echo "=== CLEANED OUTPUT (ANSI stripped) ==="
sed 's/\x1b\[[0-9;]*m//g' /tmp/upgrade-output.txt
