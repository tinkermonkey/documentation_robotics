#!/usr/bin/env python3
"""
Script to update TypeScript test files to use Python-compatible element ID format.

This script updates test files to:
1. Change runDr('add', layer, type, 'old-id', '--name', 'Name') to runDr('add', layer, type, 'Name')
2. Update getElement('old-id') calls to use new format: layer.type.kebab-name
3. Update show/update/delete commands to use new IDs
"""

import re
import sys
from pathlib import Path


def to_kebab_case(text: str) -> str:
    """Convert text to kebab-case matching Python CLI implementation."""
    # Replace spaces and underscores with hyphens
    text = re.sub(r'[\s_]+', '-', text)
    # Insert hyphen before capital letters (for camelCase/PascalCase)
    text = re.sub(r'([a-z])([A-Z])', r'\1-\2', text)
    # Convert to lowercase
    text = text.lower()
    # Remove multiple consecutive hyphens
    text = re.sub(r'-+', '-', text)
    # Remove leading/trailing hyphens
    text = text.strip('-')
    return text


def generate_element_id(layer: str, element_type: str, name: str) -> str:
    """Generate element ID in Python CLI format: {layer}.{type}.{kebab-name}"""
    kebab_name = to_kebab_case(name)
    return f"{layer}.{element_type}.{kebab_name}"


def update_test_file(filepath: Path):
    """Update a test file to use Python-compatible IDs."""
    content = filepath.read_text()
    original_content = content

    # Pattern 1: Update runDr('add', ...) calls
    # Match: runDr('add', 'layer', 'type', 'old-id', '--name', 'Name')
    # Replace with: runDr('add', 'layer', 'type', 'Name')

    def replace_add_command(match):
        layer = match.group(1)
        element_type = match.group(2)
        old_id = match.group(3)
        name = match.group(4)
        rest = match.group(5) if match.lastindex >= 5 else ''

        # Generate new ID for tracking
        new_id = generate_element_id(layer, element_type, name)
        print(f"  Add: {old_id} -> {new_id} (from name: {name})")

        # Return updated command without the old ID and --name
        if rest:
            return f"runDr('add', '{layer}', '{element_type}', '{name}'{rest}"
        return f"runDr('add', '{layer}', '{element_type}', '{name}')"

    # Match add commands with --name option
    pattern_add = r"runDr\('add',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'--name',\s*'([^']+)'(.*?)\)"
    content = re.sub(pattern_add, replace_add_command, content)

    # Pattern 2: Update getElement calls - we need more context to determine the correct new ID
    # This is tricky without knowing what the element was called
    # For now, print these so we can handle manually
    get_element_pattern = r"getElement\('([^']+)'\)"
    matches = list(re.finditer(get_element_pattern, content))
    if matches:
        print(f"\n  Found {len(matches)} getElement calls to review in {filepath.name}")
        for match in matches:
            old_id = match.group(1)
            if '.' not in old_id:  # Old format
                print(f"    - getElement('{old_id}') needs updating")

    if content != original_content:
        filepath.write_text(content)
        print(f"✓ Updated {filepath}")
        return True
    else:
        print(f"- No changes needed for {filepath}")
        return False


def main():
    test_dir = Path(__file__).parent.parent / "tests" / "integration"

    if not test_dir.exists():
        print(f"Error: Test directory not found: {test_dir}")
        sys.exit(1)

    print(f"Updating test files in: {test_dir}\n")

    updated_count = 0
    for test_file in test_dir.glob("*.test.ts"):
        print(f"\nProcessing: {test_file.name}")
        if update_test_file(test_file):
            updated_count += 1

    print(f"\n{'='*60}")
    print(f"Updated {updated_count} test files")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
