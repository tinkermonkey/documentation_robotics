#!/usr/bin/env python3
"""Add Cross-Layer and Intra-Layer Relationships sections to all layer files."""

from pathlib import Path
import re

INTRA_LAYER_TEMPLATE = """
## Intra-Layer Relationships

**Purpose**: Define structural and behavioral relationships between entities within this layer.

### Structural Relationships

Relationships that define the composition, aggregation, and specialization of entities within this layer.

| Relationship   | Source Element | Target Element | Predicate     | Inverse Predicate | Cardinality | Description |
| -------------- | -------------- | -------------- | ------------- | ----------------- | ----------- | ----------- |
| Composition    | (TBD)          | (TBD)          | `composes`    | `composed-of`     | 1:N         | (TBD)       |
| Aggregation    | (TBD)          | (TBD)          | `aggregates`  | `aggregated-by`   | 1:N         | (TBD)       |
| Specialization | (TBD)          | (TBD)          | `specializes` | `generalized-by`  | N:1         | (TBD)       |

### Behavioral Relationships

Relationships that define interactions, flows, and dependencies between entities within this layer.

| Relationship | Source Element | Target Element | Predicate  | Inverse Predicate | Cardinality | Description |
| ------------ | -------------- | -------------- | ---------- | ----------------- | ----------- | ----------- |
| (TBD)        | (TBD)          | (TBD)          | (TBD)      | (TBD)             | (TBD)       | (TBD)       |

---
"""

CROSS_LAYER_TEMPLATE = """
## Cross-Layer Relationships

**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.

### Outgoing Relationships (This Layer → Other Layers)

Links from entities in this layer to entities in other layers.

#### To Motivation Layer (01)

Links to strategic goals, requirements, principles, and constraints.

| Predicate                | Source Element | Target Element | Field Path                          | Strength | Required | Examples |
| ------------------------ | -------------- | -------------- | ----------------------------------- | -------- | -------- | -------- |
| `supports-goals`         | (TBD)          | Goal           | `motivation.supports-goals`         | High     | No       | (TBD)    |
| `fulfills-requirements`  | (TBD)          | Requirement    | `motivation.fulfills-requirements`  | High     | No       | (TBD)    |
| `governed-by-principles` | (TBD)          | Principle      | `motivation.governed-by-principles` | High     | No       | (TBD)    |
| `constrained-by`         | (TBD)          | Constraint     | `motivation.constrained-by`         | Medium   | No       | (TBD)    |

### Incoming Relationships (Other Layers → This Layer)

Links from entities in other layers to entities in this layer.

(To be documented based on actual usage patterns)

---
"""


def section_exists(content: str, section_title: str) -> bool:
    """Check if a section already exists in content."""
    pattern = r'^##\s+' + re.escape(section_title)
    return bool(re.search(pattern, content, re.MULTILINE | re.IGNORECASE))


def add_sections_to_layer(layer_file: Path) -> tuple[bool, bool]:
    """Add relationship sections to a layer file.

    Args:
        layer_file: Path to layer markdown file

    Returns:
        Tuple of (added_intra, added_cross) indicating which sections were added
    """
    content = layer_file.read_text(encoding='utf-8')

    added_intra = False
    added_cross = False

    # Check what's missing
    has_intra = section_exists(content, "Intra-Layer Relationships")
    has_cross = section_exists(content, "Cross-Layer Relationships")

    if has_intra and has_cross:
        return False, False

    # Find insertion point - after Example Model section or before Validation Rules
    insertion_markers = [
        (r'\n##\s+Validation\s+Rules', 0, 'before'),
        (r'\n##\s+Example\s+Model.*?\n##\s+', lambda m: content.find('\n##', m.start() + 1), 'at'),
        (r'\n##\s+Integration\s+Points', 0, 'before'),
    ]

    insertion_point = None
    for pattern, offset, mode in insertion_markers:
        match = re.search(pattern, content, re.DOTALL)
        if match:
            if callable(offset):
                insertion_point = offset(match)
            elif mode == 'before':
                insertion_point = match.start() + offset
            else:
                insertion_point = match.end() + offset
            break

    # Fallback: insert before last section
    if insertion_point is None:
        # Find the last ## heading
        last_heading = None
        for match in re.finditer(r'\n##\s+', content):
            last_heading = match.start()
        if last_heading:
            insertion_point = last_heading
        else:
            insertion_point = len(content)

    # Build sections to insert
    sections_to_add = ""
    if not has_intra:
        sections_to_add += INTRA_LAYER_TEMPLATE
        added_intra = True

    if not has_cross:
        sections_to_add += CROSS_LAYER_TEMPLATE
        added_cross = True

    if sections_to_add:
        # Insert the sections
        updated_content = (
            content[:insertion_point] +
            sections_to_add +
            content[insertion_point:]
        )

        # Write back
        layer_file.write_text(updated_content, encoding='utf-8')

    return added_intra, added_cross


def main():
    spec_root = Path(__file__).parent.parent / "spec"
    layers_path = spec_root / "layers"

    # All layer files
    layer_files = sorted(layers_path.glob("*-layer.md"))

    print("Adding Cross-Layer and Intra-Layer Relationships sections...\n")

    total_intra = 0
    total_cross = 0

    for layer_file in layer_files:
        layer_id = layer_file.stem.replace('-layer', '')

        added_intra, added_cross = add_sections_to_layer(layer_file)

        status = []
        if added_intra:
            status.append("Intra-Layer")
            total_intra += 1
        if added_cross:
            status.append("Cross-Layer")
            total_cross += 1

        if status:
            print(f"✓ {layer_id}: Added {' and '.join(status)} Relationships sections")
        else:
            print(f"  {layer_id}: Sections already exist")

    print(f"\nSummary:")
    print(f"  Intra-Layer sections added: {total_intra}")
    print(f"  Cross-Layer sections added: {total_cross}")


if __name__ == "__main__":
    main()
