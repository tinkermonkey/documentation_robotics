"""Validate Enhanced JSON Schemas.

This script validates that:
1. All layer schemas are valid JSON Schema Draft 7
2. Common schemas are properly structured
3. $ref references resolve correctly
4. Relationship properties are correctly defined
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    import jsonschema
    from jsonschema import Draft7Validator, RefResolver
except ImportError:
    print("Error: jsonschema package not installed")
    print("Install with: pip install jsonschema")
    sys.exit(1)


class SchemaValidator:
    """Validates enhanced layer schemas."""

    def __init__(self, spec_root: Path):
        """Initialize validator.

        Args:
            spec_root: Path to spec/ directory
        """
        self.spec_root = spec_root
        self.schemas_path = spec_root / "schemas"
        self.common_path = self.schemas_path / "common"
        self.errors: List[Tuple[str, str]] = []
        self.warnings: List[Tuple[str, str]] = []

    def _load_json(self, path: Path) -> Dict[str, Any]:
        """Load and validate JSON file."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            self.errors.append((str(path), f"Invalid JSON: {e}"))
            return {}

    def validate_json_schema_syntax(
        self, schema: Dict[str, Any], schema_name: str
    ) -> bool:
        """Validate that schema is valid JSON Schema Draft 7.

        Args:
            schema: Schema to validate
            schema_name: Name for error reporting

        Returns:
            True if valid, False otherwise
        """
        try:
            # Check it's a valid JSON Schema by creating a validator
            Draft7Validator.check_schema(schema)
            return True
        except jsonschema.SchemaError as e:
            self.errors.append((schema_name, f"Invalid JSON Schema: {e.message}"))
            return False

    def validate_references(self, schema: Dict[str, Any], schema_path: Path) -> bool:
        """Validate that all $ref references can be resolved.

        Args:
            schema: Schema to validate
            schema_path: Path to schema file

        Returns:
            True if all references resolve, False otherwise
        """
        # Build a resolver with schema base URI
        base_uri = schema_path.as_uri()
        resolver = RefResolver(base_uri, schema)

        def check_refs(obj: Any, path: str = "") -> None:
            """Recursively check all $ref in object."""
            if isinstance(obj, dict):
                if "$ref" in obj:
                    ref = obj["$ref"]
                    try:
                        # Try to resolve the reference
                        url, resolved = resolver.resolve(ref)
                    except Exception as e:
                        self.errors.append(
                            (
                                schema_path.name,
                                f"Cannot resolve $ref at {path}: {ref} - {e}",
                            )
                        )
                else:
                    for key, value in obj.items():
                        check_refs(value, f"{path}/{key}")
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    check_refs(item, f"{path}[{i}]")

        check_refs(schema)
        return len(self.errors) == 0

    def validate_relationship_properties(
        self, schema: Dict[str, Any], schema_name: str
    ) -> None:
        """Validate relationship property definitions.

        Args:
            schema: Schema to validate
            schema_name: Name for error reporting
        """
        definitions = schema.get("definitions", {})

        for entity_name, entity_def in definitions.items():
            if not isinstance(entity_def, dict):
                continue

            props = entity_def.get("properties", {})
            if "properties" not in props:
                continue

            # Check cross-layer properties structure
            cross_layer = props["properties"]
            if not isinstance(cross_layer, dict):
                continue

            cl_props = cross_layer.get("properties", {})
            if not cl_props:
                continue

            # Check for relationship property groups
            for group_name in [
                "motivation",
                "business",
                "security",
                "application",
                "technology",
                "api",
                "data",
                "datastore",
                "ux",
                "navigation",
                "apm",
                "testing",
            ]:
                if group_name not in cl_props:
                    continue

                group = cl_props[group_name]
                if not isinstance(group, dict):
                    continue

                group_props = group.get("properties", {})
                if not group_props:
                    continue

                # Check each relationship property
                for prop_name, prop_def in group_props.items():
                    # Should have allOf with $ref
                    if "allOf" in prop_def:
                        all_of = prop_def["allOf"]
                        if not isinstance(all_of, list) or len(all_of) == 0:
                            self.warnings.append(
                                (
                                    schema_name,
                                    f"{entity_name}.properties.{group_name}.{prop_name}: "
                                    f"allOf should be non-empty list",
                                )
                            )
                            continue

                        # Check first item has $ref
                        first = all_of[0]
                        if "$ref" not in first:
                            self.warnings.append(
                                (
                                    schema_name,
                                    f"{entity_name}.properties.{group_name}.{prop_name}: "
                                    f"allOf[0] should contain $ref",
                                )
                            )

    def validate_common_schemas(self) -> bool:
        """Validate common schema files.

        Returns:
            True if all valid, False otherwise
        """
        print("Validating common schemas...")

        common_schemas = [
            "relationships.schema.json",
            "predicates.schema.json",
        ]

        all_valid = True

        for schema_name in common_schemas:
            schema_path = self.common_path / schema_name
            if not schema_path.exists():
                self.errors.append((schema_name, "File not found"))
                all_valid = False
                continue

            print(f"  Checking {schema_name}...")

            # Load and validate syntax
            schema = self._load_json(schema_path)
            if not schema:
                all_valid = False
                continue

            if not self.validate_json_schema_syntax(schema, schema_name):
                all_valid = False
                continue

            print(f"    ✓ Valid JSON Schema")

        return all_valid

    def validate_layer_schema(self, schema_path: Path) -> bool:
        """Validate a single layer schema.

        Args:
            schema_path: Path to schema file

        Returns:
            True if valid, False otherwise
        """
        print(f"  Checking {schema_path.name}...")

        # Load schema
        schema = self._load_json(schema_path)
        if not schema:
            return False

        # Validate JSON Schema syntax
        if not self.validate_json_schema_syntax(schema, schema_path.name):
            return False

        print(f"    ✓ Valid JSON Schema syntax")

        # Validate references (note: this will show errors for missing common schemas if run before they exist)
        # We'll check but not fail on reference errors since they may reference external schemas
        initial_error_count = len(self.errors)
        self.validate_references(schema, schema_path)
        has_ref_errors = len(self.errors) > initial_error_count

        if not has_ref_errors:
            print(f"    ✓ All $ref references resolve")
        else:
            print(f"    ⚠ Some $ref references could not be resolved (may be expected)")

        # Validate relationship properties
        initial_warning_count = len(self.warnings)
        self.validate_relationship_properties(schema, schema_path.name)
        has_warnings = len(self.warnings) > initial_warning_count

        if not has_warnings:
            print(f"    ✓ Relationship properties correctly defined")

        # Count definitions
        def_count = len(schema.get("definitions", {}))
        print(f"    ℹ {def_count} entity definitions")

        return True

    def validate_all_schemas(self) -> bool:
        """Validate all schemas.

        Returns:
            True if all valid, False otherwise
        """
        print("Enhanced Schema Validation")
        print("=" * 60)
        print()

        # Validate common schemas first
        common_valid = self.validate_common_schemas()
        print()

        # Find and validate layer schemas
        print("Validating layer schemas...")
        layer_schemas = sorted(self.schemas_path.glob("*-layer.schema.json"))

        if not layer_schemas:
            print("  ✗ No layer schemas found!")
            return False

        all_valid = common_valid

        for schema_path in layer_schemas:
            if not self.validate_layer_schema(schema_path):
                all_valid = False
            print()

        return all_valid

    def print_summary(self) -> None:
        """Print validation summary."""
        print("=" * 60)
        print("Validation Summary")
        print("=" * 60)

        if self.errors:
            print(f"\n❌ Errors: {len(self.errors)}")
            for schema_name, error in self.errors:
                print(f"  • {schema_name}: {error}")

        if self.warnings:
            print(f"\n⚠️  Warnings: {len(self.warnings)}")
            for schema_name, warning in self.warnings:
                print(f"  • {schema_name}: {warning}")

        if not self.errors and not self.warnings:
            print("\n✅ All schemas are valid!")
        elif not self.errors:
            print(f"\n✅ All schemas are valid (with {len(self.warnings)} warnings)")
        else:
            print(f"\n❌ Validation failed with {len(self.errors)} errors")


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Validate enhanced JSON schemas")
    parser.add_argument(
        "--spec-root",
        type=Path,
        help="Path to spec/ directory (auto-detects if not provided)",
    )

    args = parser.parse_args()

    # Auto-detect spec root
    if args.spec_root:
        spec_root = args.spec_root
    else:
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

    if not spec_root.exists():
        print(f"Error: Spec directory not found: {spec_root}")
        return 1

    # Run validation
    validator = SchemaValidator(spec_root)
    validator.validate_all_schemas()
    validator.print_summary()

    # Exit with error code if there are errors
    return 1 if validator.errors else 0


if __name__ == "__main__":
    sys.exit(main())
