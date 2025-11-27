#!/bin/bash
# Example pre-tool-use validation hook for DR projects
#
# This hook validates JSON files before they're written to prevent
# syntax errors from breaking the DR model.
#
# To use this hook:
# 1. Copy to .claude/hooks/:
#    cp .claude/templates/example-validation-hook.sh .claude/hooks/validate-json.sh
# 2. Make executable:
#    chmod +x .claude/hooks/validate-json.sh
# 3. Add to .claude/settings.json (see example-settings.json for configuration)
#
# The hook receives tool input as JSON on stdin and must output:
# - {"approved": true} to allow the operation
# - {"blocked": true, "reason": "..."} to block with explanation

# Read stdin (tool input as JSON)
input=$(cat)

# Extract file path and content from tool input
file_path=$(echo "$input" | jq -r '.tool_input.path // .tool_input.file_path // ""')
content=$(echo "$input" | jq -r '.tool_input.content // ""')

# Check if this is a JSON file operation
if [[ "$file_path" == *.json ]]; then
    # Validate JSON syntax using jq
    if ! echo "$content" | jq empty 2>/dev/null; then
        # Block the operation with clear error message
        echo '{"blocked": true, "reason": "Invalid JSON syntax. Please fix syntax errors before writing."}'
        exit 2
    fi

    # Additional DR-specific validation for model files
    if [[ "$file_path" == *.dr/* ]]; then
        # Check if it's an element file (should have id, type, description)
        if echo "$file_path" | grep -qE '\.dr/(motivation|business|application|api|data|implementation|technology|physical)'; then
            # Verify required fields exist
            if ! echo "$content" | jq -e '.id' > /dev/null 2>&1; then
                echo '{"blocked": true, "reason": "DR element missing required field: id"}'
                exit 2
            fi

            if ! echo "$content" | jq -e '.type' > /dev/null 2>&1; then
                echo '{"blocked": true, "reason": "DR element missing required field: type"}'
                exit 2
            fi

            if ! echo "$content" | jq -e '.description' > /dev/null 2>&1; then
                echo '{"blocked": true, "reason": "DR element missing required field: description"}'
                exit 2
            fi
        fi

        # Check if it's metadata.json
        if [[ "$file_path" == *.dr/metadata.json ]]; then
            # Verify spec version exists
            if ! echo "$content" | jq -e '.spec_version' > /dev/null 2>&1; then
                echo '{"blocked": true, "reason": "metadata.json missing required field: spec_version"}'
                exit 2
            fi
        fi
    fi
fi

# Approve the operation
echo '{"approved": true}'
exit 0
