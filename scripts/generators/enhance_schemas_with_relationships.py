"""Enhance Layer Schemas with Relationship Properties.

This script enhances JSON Schema layer definitions with:
1. Relationship metadata from common/relationships.schema.json
2. Proper UUID array validation for relationship fields
3. Conditional requirements based on criticality
4. Field path format validators
"""

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


class SchemaEnhancer:
    """Enhances layer schemas with relationship properties."""

    def __init__(self, spec_root: Path):
        """Initialize the enhancer.

        Args:
            spec_root: Path to spec/ directory
        """
        self.spec_root = spec_root
        self.schemas_path = spec_root / "schemas"
        self.common_path = self.schemas_path / "common"

        # Load common relationship schemas
        self.relationships_schema = self._load_json(
            self.common_path / "relationships.schema.json"
        )

    def _load_json(self, path: Path) -> Dict[str, Any]:
        """Load JSON file."""
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save_json(self, data: Dict[str, Any], path: Path) -> None:
        """Save JSON file with formatting."""
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")  # Add trailing newline

    def enhance_property_field(
        self, property_def: Dict[str, Any], property_name: str
    ) -> Dict[str, Any]:
        """Enhance a single property field with relationship metadata.

        Args:
            property_def: Current property definition
            property_name: Name of the property (e.g., "supports-goals")

        Returns:
            Enhanced property definition
        """
        # Map property names to relationship definitions
        relationship_map = {
            "supports-goals": "MotivationProperties/properties/supports-goals",
            "realizes-outcomes": "MotivationProperties/properties/realizes-outcomes",
            "fulfills-requirements": "MotivationProperties/properties/fulfills-requirements",
            "delivers-value": "MotivationProperties/properties/delivers-value",
            "constrained-by": "MotivationProperties/properties/constrained-by",
            "governed-by": "MotivationProperties/properties/governed-by",
            "governed-by-principles": "MotivationProperties/properties/governed-by",
            "owned-by-actor": "BusinessProperties/properties/owned-by-actor",
            "performed-by-role": "BusinessProperties/properties/performed-by-role",
            "provides-service": "BusinessProperties/properties/provides-service",
            "consumes-service": "BusinessProperties/properties/consumes-service",
            "requires-permission": "SecurityProperties/properties/requires-permission",
            "assigned-role": "SecurityProperties/properties/assigned-role",
            "protected-by-control": "SecurityProperties/properties/protected-by-control",
            "mitigates-threat": "SecurityProperties/properties/mitigates-threat",
            "accesses-resource": "SecurityProperties/properties/accesses-resource",
            "realizes-service": "ApplicationProperties/properties/realizes-service",
            "provides-app-service": "ApplicationProperties/properties/provides-app-service",
            "uses-component": "ApplicationProperties/properties/uses-component",
            "deployed-on": "TechnologyProperties/properties/deployed-on",
            "runs-on-platform": "TechnologyProperties/properties/runs-on-platform",
            "exposes-operation": "ApiProperties/properties/exposes-operation",
            "implements-endpoint": "ApiProperties/properties/implements-endpoint",
            "uses-schema": "DataProperties/properties/uses-schema",
            "references-entity": "DataProperties/properties/references-entity",
            "persists-to-database": "DatastoreProperties/properties/persists-to-database",
            "maps-to-table": "DatastoreProperties/properties/maps-to-table",
            "supports-experience": "UxProperties/properties/supports-experience",
            "renders-component": "UxProperties/properties/renders-component",
            "navigates-to-route": "NavigationProperties/properties/navigates-to-route",
            "protected-by-guard": "NavigationProperties/properties/protected-by-guard",
            "monitored-by-metric": "ApmProperties/properties/monitored-by-metric",
            "has-sla": "ApmProperties/properties/has-sla",
            "traced-by": "ApmProperties/properties/traced-by",
            "tested-by": "TestingProperties/properties/tested-by",
            "covered-by-suite": "TestingProperties/properties/covered-by-suite",
        }

        # Check if this property should be enhanced
        relationship_path = relationship_map.get(property_name)
        if not relationship_path:
            return property_def

        # Build enhanced property using $ref to common schema
        parts = relationship_path.split("/")
        enhanced = {
            "allOf": [
                {
                    "$ref": f"common/relationships.schema.json#/definitions/{parts[0]}/{'/'.join(parts[1:])}"
                }
            ]
        }

        return enhanced

    def enhance_entity_definition(
        self, entity_def: Dict[str, Any], entity_name: str
    ) -> Dict[str, Any]:
        """Enhance an entity definition with relationship properties.

        Args:
            entity_def: Entity definition from schema
            entity_name: Name of the entity

        Returns:
            Enhanced entity definition
        """
        if "properties" not in entity_def:
            return entity_def

        # Check if entity has a "properties" property for cross-layer refs
        if "properties" in entity_def["properties"]:
            props_def = entity_def["properties"]["properties"]

            # Ensure it's an object
            if props_def.get("type") != "object":
                return entity_def

            # Check for nested property groups (motivation, security, etc.)
            if "properties" in props_def:
                for group_name, group_def in props_def["properties"].items():
                    if not isinstance(group_def, dict) or "properties" not in group_def:
                        continue

                    # Enhance each property in the group
                    for prop_name, prop_def in group_def["properties"].items():
                        enhanced = self.enhance_property_field(prop_def, prop_name)
                        if enhanced != prop_def:
                            group_def["properties"][prop_name] = enhanced

        # Add conditional criticality requirements for certain entities
        critical_entities = [
            "BusinessService",
            "ApplicationService",
            "ApplicationComponent",
            "ApiEndpoint",
            "ApiOperation",
        ]

        if entity_name in critical_entities:
            if "allOf" not in entity_def:
                entity_def["allOf"] = []

            # Add criticality-based requirements
            entity_def["allOf"].append({
                "$ref": "common/relationships.schema.json#/definitions/ConditionalCriticalityRequirements"
            })

        return entity_def

    def enhance_layer_schema(self, schema_path: Path) -> None:
        """Enhance a single layer schema file.

        Args:
            schema_path: Path to layer schema JSON file
        """
        print(f"Enhancing: {schema_path.name}")

        # Load schema
        schema = self._load_json(schema_path)

        # Add $ref to common schemas at top level
        if "$ref" not in schema:
            schema["$defs"] = {
                "relationships": {
                    "$ref": "common/relationships.schema.json#/definitions"
                },
                "predicates": {
                    "$ref": "common/predicates.schema.json#/definitions"
                }
            }

        # Enhance entity definitions
        if "definitions" in schema:
            for entity_name, entity_def in schema["definitions"].items():
                enhanced = self.enhance_entity_definition(entity_def, entity_name)
                schema["definitions"][entity_name] = enhanced

        # Save enhanced schema
        self._save_json(schema, schema_path)
        print(f"  ✓ Enhanced {len(schema.get('definitions', {}))} entity definitions")

    def enhance_all_layer_schemas(self) -> None:
        """Enhance all layer schema files."""
        print("Enhancing Layer Schemas with Relationship Properties")
        print("=" * 60)
        print()

        # Find all layer schema files
        layer_schemas = sorted(self.schemas_path.glob("*-layer.schema.json"))

        if not layer_schemas:
            print("No layer schema files found!")
            return

        print(f"Found {len(layer_schemas)} layer schemas\n")

        for schema_path in layer_schemas:
            try:
                self.enhance_layer_schema(schema_path)
                print()
            except Exception as e:
                print(f"  ✗ Error: {e}")
                print()

        print("=" * 60)
        print("Enhancement complete!")


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Enhance layer schemas with relationship properties"
    )
    parser.add_argument(
        "--spec-root",
        type=Path,
        help="Path to spec/ directory (auto-detects if not provided)",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        help="Enhance only a specific schema file",
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

    # Initialize enhancer
    enhancer = SchemaEnhancer(spec_root)

    # Enhance schemas
    if args.schema:
        enhancer.enhance_layer_schema(args.schema)
    else:
        enhancer.enhance_all_layer_schemas()

    return 0


if __name__ == "__main__":
    sys.exit(main())
