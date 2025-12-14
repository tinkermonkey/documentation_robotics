#!/usr/bin/env python3
"""Update template version references from 2.0.0 to 0.6.0."""

from pathlib import Path
import re


def update_template_file(file_path: Path) -> bool:
    """Update the layer template file."""
    content = file_path.read_text(encoding='utf-8')

    # Update the Version field in the header
    updated = re.sub(
        r'\*\*Version\*\*:\s*2\.0\.0',
        '**Version**: 0.6.0',
        content
    )

    # Update the changelog entry
    updated = re.sub(
        r'\|\s*2\.0\.0\s*\|',
        '| 0.6.0   |',
        updated
    )

    if updated != content:
        file_path.write_text(updated, encoding='utf-8')
        return True
    return False


def update_structure_validator(file_path: Path) -> bool:
    """Update structure validator references."""
    content = file_path.read_text(encoding='utf-8')

    # Update comments and messages
    updated = re.sub(
        r'v2\.0\.0 template',
        'v0.6.0 template',
        content
    )

    updated = re.sub(
        r'2\.0\.0 template',
        '0.6.0 template',
        updated
    )

    if updated != content:
        file_path.write_text(updated, encoding='utf-8')
        return True
    return False


def update_layer_file(file_path: Path) -> bool:
    """Update layer file if it has template version in metadata."""
    content = file_path.read_text(encoding='utf-8')
    original = content

    # Only update if this is in a version metadata field at the top
    # Look for lines like: version: "2.0.0" # Enhanced with...
    # But NOT lines in examples or data
    lines = content.split('\n')
    updated_lines = []
    in_frontmatter = False

    for i, line in enumerate(lines):
        # Check if we're in the first 20 lines (metadata area)
        if i < 20:
            # Update version metadata that references template enhancements
            if re.match(r'version:\s*"2\.0\.0"\s*#.*Enhanced', line):
                updated_lines.append(re.sub(r'2\.0\.0', '0.6.0', line))
                continue

        updated_lines.append(line)

    updated = '\n'.join(updated_lines)

    if updated != original:
        file_path.write_text(updated, encoding='utf-8')
        return True
    return False


def main():
    repo_root = Path(__file__).parent.parent

    print("Updating template version references from 2.0.0 to 0.6.0...\n")

    changes = []

    # Update layer template
    template_path = repo_root / "spec" / "templates" / "layer-template.md"
    if template_path.exists():
        if update_template_file(template_path):
            print(f"✓ Updated {template_path.relative_to(repo_root)}")
            changes.append(str(template_path.relative_to(repo_root)))
        else:
            print(f"  No changes needed in {template_path.relative_to(repo_root)}")

    # Update structure validator
    validator_path = repo_root / "scripts" / "validation" / "structure_validator.py"
    if validator_path.exists():
        if update_structure_validator(validator_path):
            print(f"✓ Updated {validator_path.relative_to(repo_root)}")
            changes.append(str(validator_path.relative_to(repo_root)))
        else:
            print(f"  No changes needed in {validator_path.relative_to(repo_root)}")

    # Update layer files (only metadata, not example data)
    layers_path = repo_root / "spec" / "layers"
    if layers_path.exists():
        for layer_file in sorted(layers_path.glob("*-layer.md")):
            if update_layer_file(layer_file):
                print(f"✓ Updated {layer_file.relative_to(repo_root)}")
                changes.append(str(layer_file.relative_to(repo_root)))

    print(f"\n✓ Updated {len(changes)} files")

    if changes:
        print("\nFiles updated:")
        for change in changes:
            print(f"  - {change}")


if __name__ == "__main__":
    main()
