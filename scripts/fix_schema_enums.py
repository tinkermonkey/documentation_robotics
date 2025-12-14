#!/usr/bin/env python3
"""Fix schema enum definitions by moving them from nested to root level.

This script:
1. Finds all enum definitions nested inside element definitions
2. Moves them to the root definitions object
3. Removes the nested definitions sections
"""

import json
from pathlib import Path
from typing import Any, Dict, Set


def extract_nested_enums(obj: Any, path: str = "") -> Dict[str, Any]:
    """Recursively extract all nested enum definitions."""
    enums = {}

    if isinstance(obj, dict):
        # Check if this object has nested definitions
        if "definitions" in obj and isinstance(obj["definitions"], dict):
            # Extract all enum definitions from this nested section
            for enum_name, enum_def in obj["definitions"].items():
                if isinstance(enum_def, dict):
                    enums[enum_name] = enum_def

        # Recurse into child objects (but skip the definitions we just processed)
        for key, value in obj.items():
            if key != "definitions":  # Don't recurse into definitions we just extracted
                child_enums = extract_nested_enums(value, f"{path}/{key}")
                enums.update(child_enums)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            child_enums = extract_nested_enums(item, f"{path}[{i}]")
            enums.update(child_enums)

    return enums


def remove_nested_definitions(obj: Any) -> Any:
    """Recursively remove nested definitions sections."""
    if isinstance(obj, dict):
        # Create a new dict without the nested definitions
        result = {}
        for key, value in obj.items():
            if key == "definitions":
                # Skip nested definitions (they've been moved to root)
                continue
            else:
                # Recurse into child objects
                result[key] = remove_nested_definitions(value)
        return result
    elif isinstance(obj, list):
        return [remove_nested_definitions(item) for item in obj]
    else:
        return obj


def fix_schema(schema_path: Path) -> bool:
    """Fix a single schema file.

    Args:
        schema_path: Path to schema JSON file

    Returns:
        True if changes were made, False otherwise
    """
    print(f"Processing {schema_path.name}...")

    # Load the schema
    with open(schema_path, 'r', encoding='utf-8') as f:
        schema = json.load(f)

    # Extract nested enums from element definitions
    nested_enums = {}
    if "definitions" in schema:
        for elem_name, elem_def in schema["definitions"].items():
            if isinstance(elem_def, dict):
                elem_enums = extract_nested_enums(elem_def)
                nested_enums.update(elem_enums)

    if not nested_enums:
        print(f"  No nested enums found")
        return False

    print(f"  Found {len(nested_enums)} nested enum definitions:")
    for enum_name in nested_enums.keys():
        print(f"    - {enum_name}")

    # Add extracted enums to root definitions
    if "definitions" not in schema:
        schema["definitions"] = {}

    for enum_name, enum_def in nested_enums.items():
        if enum_name in schema["definitions"] and enum_name not in ["Priority"]:
            # Already exists at root, check if it's the same
            if schema["definitions"][enum_name] != enum_def:
                print(f"  WARNING: Enum {enum_name} already exists at root with different definition!")
        else:
            schema["definitions"][enum_name] = enum_def

    # Remove nested definitions sections from element definitions
    if "definitions" in schema:
        for elem_name in list(schema["definitions"].keys()):
            if elem_name not in nested_enums:  # Don't process the enums themselves
                elem_def = schema["definitions"][elem_name]
                schema["definitions"][elem_name] = remove_nested_definitions(elem_def)

    # Write the fixed schema back
    with open(schema_path, 'w', encoding='utf-8') as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)
        f.write('\n')  # Add trailing newline

    print(f"  ✓ Fixed and saved")
    return True


def main():
    """Fix all schema files."""
    spec_root = Path(__file__).parent.parent / "spec"
    schemas_path = spec_root / "schemas"

    # Find all layer schema files
    schema_files = sorted(schemas_path.glob("*-layer.schema.json"))

    print(f"Found {len(schema_files)} schema files to process\n")

    fixed_count = 0
    for schema_file in schema_files:
        if fix_schema(schema_file):
            fixed_count += 1
        print()

    print(f"Summary: Fixed {fixed_count} out of {len(schema_files)} schema files")


if __name__ == "__main__":
    main()
