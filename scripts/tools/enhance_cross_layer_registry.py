#!/usr/bin/env python3
"""Enhance Cross-Layer Reference Registry with semantic predicates.

This script adds predicate and inverse predicate columns to all tables
in the cross-layer reference registry document.
"""

import re
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


def enhance_registry_document(spec_root: Path) -> str:
    """Enhance the cross-layer reference registry document.

    Args:
        spec_root: Path to spec/ directory

    Returns:
        Enhanced markdown content
    """
    registry = LinkRegistry()
    registry_doc_path = spec_root / "core" / "06-cross-layer-reference-registry.md"

    if not registry_doc_path.exists():
        raise FileNotFoundError(f"Registry document not found: {registry_doc_path}")

    content = registry_doc_path.read_text(encoding="utf-8")
    lines = content.split("\n")

    enhanced_lines = []
    in_table = False
    table_has_predicate = False

    # Track which link types we've found by field path
    field_path_to_link = {}
    for link_type in registry.link_types.values():
        for field_path in link_type.field_paths:
            field_path_to_link[field_path] = link_type

    for i, line in enumerate(lines):
        # Check if this is a table header line
        if line.startswith("| Pattern ") and "| Field Path |" in line:
            # Check if predicate column already exists
            if "| Predicate |" in line:
                table_has_predicate = True
                enhanced_lines.append(line)
            else:
                # Add Predicate and Inverse Predicate columns after Pattern
                parts = line.split("|")
                new_parts = [parts[0], parts[1], " Predicate ", " Inverse Predicate "] + parts[2:]
                enhanced_lines.append("|".join(new_parts))
                table_has_predicate = False
            in_table = True

        # Check if this is the separator line
        elif in_table and line.startswith("|--"):
            if not table_has_predicate:
                # Add separator cells for new columns
                parts = line.split("|")
                new_parts = [parts[0], parts[1], "--------", "-----------------"] + parts[2:]
                enhanced_lines.append("|".join(new_parts))
            else:
                enhanced_lines.append(line)

        # Check if this is a table data row
        elif in_table and line.startswith("| "):
            if not table_has_predicate:
                # Extract field path from the row
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 6:  # Has enough columns
                    # Field path is typically in column 4 (index 4, 0-based after initial |)
                    field_path_col = None
                    for idx, part in enumerate(parts):
                        if "`" in part and ("." in part or "x-" in part):
                            field_path_col = idx
                            break

                    if field_path_col:
                        field_path_text = parts[field_path_col]
                        # Extract first field path from comma-separated list
                        field_path_match = re.search(r"`([^`]+)`", field_path_text)

                        if field_path_match:
                            field_path = field_path_match.group(1)
                            link_type = field_path_to_link.get(field_path)

                            if link_type and link_type.predicate:
                                predicate = f"`{link_type.predicate}`"
                                inverse = f"`{link_type.inverse_predicate}`" if link_type.inverse_predicate else "_N/A_"
                            else:
                                predicate = "_TBD_"
                                inverse = "_TBD_"
                        else:
                            predicate = "_TBD_"
                            inverse = "_TBD_"
                    else:
                        predicate = "_TBD_"
                        inverse = "_TBD_"

                    # Insert predicate columns after Pattern (column 1)
                    new_parts = [parts[0], parts[1], predicate, inverse] + parts[2:]
                    enhanced_lines.append("|".join(new_parts))
                else:
                    enhanced_lines.append(line)
            else:
                enhanced_lines.append(line)

        # Not in table or end of table
        else:
            if in_table and not line.startswith("|"):
                in_table = False
                table_has_predicate = False
            enhanced_lines.append(line)

    return "\n".join(enhanced_lines)


def main():
    print("Cross-Layer Reference Registry Enhancer")
    print("=" * 60)
    print()

    try:
        # Find spec root
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

        if not spec_root.exists():
            raise FileNotFoundError(f"Could not find spec directory at {spec_root}")

        print("Enhancing cross-layer reference registry...")
        print()

        # Enhance the document
        enhanced_content = enhance_registry_document(spec_root)

        # Write to new file
        output_path = spec_root / "core" / "06-cross-layer-reference-registry-enhanced.md"
        output_path.write_text(enhanced_content, encoding="utf-8")

        print(f"✓ Enhanced registry written to: {output_path}")
        print()
        print("Review the enhanced file and replace the original if satisfied:")
        print(f"  mv {output_path} {spec_root / 'core' / '06-cross-layer-reference-registry.md'}")
        print()

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
