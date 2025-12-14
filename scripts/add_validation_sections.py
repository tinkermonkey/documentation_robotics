#!/usr/bin/env python3
"""Add missing Validation Rules sections to layer files."""

from pathlib import Path
import re

VALIDATION_RULES_TEMPLATE = """
## Validation Rules

### Entity Validation

- **Required Fields**: `id`, `name`, `description`
- **ID Format**: UUID v4 or kebab-case string
- **Name**: Non-empty string, max 200 characters
- **Description**: Non-empty string, max 1000 characters

### Relationship Validation

#### Intra-Layer Relationships

- **Valid Types**: Composition, Aggregation, Specialization, Triggering, Flow, Access, Serving, Assignment
- **Source Validation**: Must reference existing entity in this layer
- **Target Validation**: Must reference existing entity in this layer
- **Cardinality**: Enforced based on relationship type

#### Cross-Layer Relationships

- **Target Existence**: Referenced entities must exist in target layer
- **Target Type**: Must match allowed target element types
- **Cardinality**:
  - Array fields: Multiple references allowed
  - Single fields: One reference only
- **Format Validation**:
  - UUID fields: Valid UUID v4 format
  - ID fields: Valid identifier format
  - Enum fields: Must match allowed values

### Schema Validation

All entities must validate against the layer schema file in `spec/schemas/`.

---
"""

def add_validation_section(layer_file: Path, layer_num: str) -> bool:
    """Add Validation Rules section to a layer file.

    Args:
        layer_file: Path to layer markdown file
        layer_num: Layer number (e.g., "03")

    Returns:
        True if section was added, False if it already exists
    """
    content = layer_file.read_text(encoding='utf-8')

    # Check if Validation Rules section already exists
    if re.search(r'^##\s+Validation\s+Rules', content, re.MULTILINE | re.IGNORECASE):
        return False

    # Find a good insertion point
    # Try to insert before "Best Practices" or "Additional Resources" or at the end
    insertion_markers = [
        (r'\n##\s+Best\s+Practices', 0),
        (r'\n##\s+Additional\s+Resources', 0),
        (r'\n##\s+References', 0),
        (r'\n##\s+Changelog', 0),
    ]

    insertion_point = None
    for pattern, offset in insertion_markers:
        match = re.search(pattern, content)
        if match:
            insertion_point = match.start() + offset
            break

    # If no marker found, insert before the last "---" or at the end
    if insertion_point is None:
        last_hr = content.rfind('\n---\n')
        if last_hr > 0:
            insertion_point = last_hr
        else:
            insertion_point = len(content)

    # Insert the section
    updated_content = (
        content[:insertion_point] +
        VALIDATION_RULES_TEMPLATE +
        content[insertion_point:]
    )

    # Write back
    layer_file.write_text(updated_content, encoding='utf-8')
    return True


def main():
    spec_root = Path(__file__).parent.parent / "spec"
    layers_path = spec_root / "layers"

    # Layers missing Validation Rules section (from validation report)
    missing_layers = [
        "03-security",
        "06-api",
        "07-data-model",
        "08-datastore",
        "09-ux",
        "10-navigation",
        "11-apm-observability",
        "12-testing"
    ]

    print("Adding Validation Rules sections to layer files...\n")

    added_count = 0
    for layer_id in missing_layers:
        layer_file = layers_path / f"{layer_id}-layer.md"

        if not layer_file.exists():
            print(f"⚠️  {layer_id}: File not found")
            continue

        layer_num = layer_id.split('-')[0]
        if add_validation_section(layer_file, layer_num):
            print(f"✓ {layer_id}: Added Validation Rules section")
            added_count += 1
        else:
            print(f"  {layer_id}: Section already exists")

    print(f"\n✓ Added Validation Rules section to {added_count} layer files")


if __name__ == "__main__":
    main()
