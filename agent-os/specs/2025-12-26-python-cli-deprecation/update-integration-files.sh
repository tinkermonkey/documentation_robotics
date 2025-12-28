#!/bin/bash

# Script to update all integration files to reference Bun CLI instead of Python CLI
# Part of Task Group 13: Integration Documentation Updates

set -e

REPO_ROOT="/Users/austinsand/workspace/documentation_robotics"

echo "=== Task Group 13: Integration Documentation Updates ==="
echo "Updating all integration files to reference Bun CLI..."
echo ""

# Function to update Python CLI references to Bun CLI in a file
update_file_references() {
    local file="$1"
    local backup="${file}.backup"

    if [ ! -f "$file" ]; then
        echo "Warning: File not found: $file"
        return 1
    fi

    # Create backup
    cp "$file" "$backup"

    # Update Python CLI references
    sed -i.tmp '
        s/pip install documentation-robotics/npm install -g @doc-robotics\/cli-bun/g
        s/pip install/npm install -g @doc-robotics\/cli-bun/g
        s/Python CLI/Bun CLI/g
        s/python3/node/g
        s/pytest/npm test/g
        s/\.venv\/bin\/activate/# No virtual environment needed for Bun CLI/g
        s/source \.\.\/.venv\/bin\/activate/# No activation needed for Bun CLI/g
        s/cli\//cli-bun\//g
        s/The DR CLI is now implemented in TypeScript\/Bun/The DR CLI is implemented in TypeScript\/Bun/g
        s/still supported but considered legacy/has been deprecated/g
    ' "$file"

    # Remove temp file created by sed
    rm -f "${file}.tmp"

    # Check if file was actually modified
    if diff -q "$file" "$backup" > /dev/null 2>&1; then
        # No changes, remove backup
        rm "$backup"
        return 0
    else
        echo "  ✓ Updated: $file"
        rm "$backup"
        return 0
    fi
}

# Count total files to update
total_files=0
updated_files=0

echo "Step 1: Updating Claude Code Integration Files"
echo "-----------------------------------------------"

# Update Claude Code agents
for agent in "$REPO_ROOT/integrations/claude_code/agents/"*.md; do
    if [ -f "$agent" ]; then
        total_files=$((total_files + 1))
        if update_file_references "$agent"; then
            updated_files=$((updated_files + 1))
        fi
    fi
done

# Update Claude Code commands
for command in "$REPO_ROOT/integrations/claude_code/commands/"*.md; do
    if [ -f "$command" ]; then
        total_files=$((total_files + 1))
        if update_file_references "$command"; then
            updated_files=$((updated_files + 1))
        fi
    fi
done

# Update Claude Code skills
for skill_dir in "$REPO_ROOT/integrations/claude_code/skills/"*/; do
    if [ -d "$skill_dir" ]; then
        for skill_file in "$skill_dir"SKILL.md; do
            if [ -f "$skill_file" ]; then
                total_files=$((total_files + 1))
                if update_file_references "$skill_file"; then
                    updated_files=$((updated_files + 1))
                fi
            fi
        done
    fi
done

echo ""
echo "Step 2: Updating GitHub Copilot Integration Files"
echo "--------------------------------------------------"

# Update GitHub Copilot agents
for agent in "$REPO_ROOT/integrations/github_copilot/agents/"*.md; do
    if [ -f "$agent" ]; then
        total_files=$((total_files + 1))
        if update_file_references "$agent"; then
            updated_files=$((updated_files + 1))
        fi
    fi
done

# Update GitHub Copilot skills
for skill_dir in "$REPO_ROOT/integrations/github_copilot/skills/"*/; do
    if [ -d "$skill_dir" ]; then
        for skill_file in "$skill_dir"SKILL.md; do
            if [ -f "$skill_file" ]; then
                total_files=$((total_files + 1))
                if update_file_references "$skill_file"; then
                    updated_files=$((updated_files + 1))
                fi
            fi
        done
    fi
done

echo ""
echo "=== Update Summary ==="
echo "Total files processed: $total_files"
echo "Files updated: $updated_files"
echo ""

# Verify specific files were created/updated
echo "Step 3: Verifying CI/CD Integration Guide"
echo "-------------------------------------------"

if [ -f "$REPO_ROOT/docs/ci-cd-integration.md" ]; then
    echo "  ✓ CI/CD integration guide created"
else
    echo "  ✗ CI/CD integration guide NOT found"
fi

if [ -d "$REPO_ROOT/docs/examples/ci-cd" ]; then
    echo "  ✓ CI/CD examples directory created"

    # Check for example files
    if [ -f "$REPO_ROOT/docs/examples/ci-cd/.github/workflows/dr-validate.yml" ]; then
        echo "    ✓ GitHub Actions example created"
    fi

    if [ -f "$REPO_ROOT/docs/examples/ci-cd/.gitlab-ci.yml" ]; then
        echo "    ✓ GitLab CI example created"
    fi

    if [ -f "$REPO_ROOT/docs/examples/ci-cd/Jenkinsfile" ]; then
        echo "    ✓ Jenkins example created"
    fi

    if [ -f "$REPO_ROOT/docs/examples/ci-cd/.circleci/config.yml" ]; then
        echo "    ✓ CircleCI example created"
    fi
else
    echo "  ✗ CI/CD examples directory NOT found"
fi

echo ""
echo "Step 4: Verification - Checking for Remaining Python CLI References"
echo "---------------------------------------------------------------------"

# Search for remaining Python CLI references (should be minimal)
python_refs=0

# Check Claude Code files
if grep -r "pip install" "$REPO_ROOT/integrations/claude_code/" 2>/dev/null | grep -v ".backup" | grep -v "No activation needed" ; then
    echo "  ⚠ Found 'pip install' references in Claude Code integration"
    python_refs=$((python_refs + 1))
fi

# Check GitHub Copilot files
if grep -r "pip install" "$REPO_ROOT/integrations/github_copilot/" 2>/dev/null | grep -v ".backup" | grep -v "No activation needed" ; then
    echo "  ⚠ Found 'pip install' references in GitHub Copilot integration"
    python_refs=$((python_refs + 1))
fi

if [ $python_refs -eq 0 ]; then
    echo "  ✓ No remaining Python CLI installation references found"
else
    echo "  ⚠ Found $python_refs files with potential Python CLI references"
    echo "    (Review manually to ensure these are intentional)"
fi

echo ""
echo "=== Task Group 13 Update Complete ==="
echo ""
echo "Next steps:"
echo "1. Review updated files in integrations/claude_code/"
echo "2. Review updated files in integrations/github_copilot/"
echo "3. Test CI/CD integration examples"
echo "4. Update tasks.md to mark Task Group 13 as complete"
echo ""
