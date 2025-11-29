"""
Entity Type Registry - Central registry of valid entity types per layer.

Extracts entity types from JSON Schema files and provides validation.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

import inflect

# Special case entity types for layers with non-standard schema structures
API_LAYER_TYPES = ["operation", "path", "schema", "security-scheme", "server", "component"]
DATA_MODEL_LAYER_TYPES = ["schema", "entity", "attribute", "relationship"]
TESTING_LAYER_TYPES = [
    "coverage-target",
    "input-space-partition",
    "context-variation",
    "coverage-requirement",
    "test-case-sketch",
]


class EntityTypeRegistry:
    """Central registry of valid entity types per layer."""

    def __init__(self):
        """Initialize the registry."""
        self._registry: Dict[str, List[str]] = {}
        self._inflect = inflect.engine()
        self._schema_dir: Optional[Path] = None

    def build_from_schemas(self, schema_dir: Path) -> None:
        """
        Build registry by parsing all layer schemas.

        Args:
            schema_dir: Directory containing layer schema files
        """
        if not schema_dir.exists():
            print(f"Warning: Schema directory {schema_dir} does not exist")
            return

        self._schema_dir = schema_dir

        # Find all layer schema files
        schema_files = list(schema_dir.glob("*-layer.schema.json"))

        if not schema_files:
            print(f"Warning: No schema files found in {schema_dir}")
            return

        # Parse each schema
        for schema_file in schema_files:
            try:
                layer_name = self._extract_layer_name(schema_file)
                entity_types = self._extract_entity_types(schema_file)
                if entity_types:
                    self._registry[layer_name] = entity_types
            except Exception as e:
                print(f"Warning: Failed to parse schema {schema_file}: {e}")

    def _extract_layer_name(self, schema_file: Path) -> str:
        """
        Extract layer name from schema filename.

        Args:
            schema_file: Path to schema file (e.g., "02-business-layer.schema.json")

        Returns:
            Layer name (e.g., "business")
        """
        # "02-business-layer.schema.json" → "business"
        filename = schema_file.name  # "02-business-layer.schema.json"
        # Remove .json extension
        if filename.endswith(".json"):
            filename = filename[:-5]  # "02-business-layer.schema"
        # Remove .schema extension
        if filename.endswith(".schema"):
            filename = filename[:-7]  # "02-business-layer"

        parts = filename.split("-")

        # Handle different naming patterns
        if len(parts) >= 3:
            # "02-business-layer" → ["02", "business", "layer"]
            # Return the middle part(s) before "layer"
            layer_parts = []
            for part in parts[1:]:  # Skip the number prefix
                if part in ["layer", "schema"]:
                    break
                layer_parts.append(part)
            return "_".join(layer_parts) if len(layer_parts) > 1 else layer_parts[0]

        # Fallback: return everything after the number
        return "_".join(parts[1:]) if len(parts) > 1 else parts[0]

    def _extract_entity_types(self, schema_file: Path) -> List[str]:
        """
        Extract entity types from schema properties.

        Args:
            schema_file: Path to schema file

        Returns:
            List of entity types for this layer
        """
        layer_name = self._extract_layer_name(schema_file)

        # Special cases for layers with non-standard structures
        if layer_name == "api":
            return API_LAYER_TYPES
        elif layer_name == "data_model":
            return DATA_MODEL_LAYER_TYPES
        elif layer_name == "testing":
            return TESTING_LAYER_TYPES

        # Load schema
        with open(schema_file) as f:
            schema = json.load(f)

        entity_types = []
        properties = schema.get("properties", {})

        # Skip if no properties defined
        if not properties:
            return []

        for prop_name in properties.keys():
            # Skip common metadata properties
            if prop_name in ["id", "name", "description", "relationships"]:
                continue

            # Parse entity type from property name
            entity_type = self._parse_entity_type(prop_name)
            if entity_type:
                entity_types.append(entity_type)

        return sorted(set(entity_types))

    def _parse_entity_type(self, property_name: str) -> Optional[str]:
        """
        Convert schema property name to CLI entity type.

        Examples:
            businessServices → service
            applicationComponents → component
            stakeholders → stakeholder

        Args:
            property_name: Property name from schema

        Returns:
            Entity type for CLI, or None if invalid
        """
        if not property_name:
            return None

        # Strip common layer prefixes
        for prefix in ["business", "application", "technology"]:
            if property_name.startswith(prefix):
                # Remove prefix and lowercase first letter
                property_name = property_name[len(prefix) :]
                if property_name:
                    property_name = property_name[0].lower() + property_name[1:]
                break

        # Singularize (services → service)
        try:
            # inflect can be picky about input types, ensure it's a plain string
            property_name_str = str(property_name)
            singular = self._inflect.singular_noun(property_name_str)
            if singular and singular != property_name_str:
                return singular.lower()
        except Exception:
            # If inflect fails for any reason, just return the original lowercased
            pass

        return property_name.lower()

    def get_valid_types(self, layer: str) -> List[str]:
        """
        Get list of valid entity types for a layer.

        Args:
            layer: Layer name

        Returns:
            List of valid entity types, or empty list if layer not found
        """
        return self._registry.get(layer, [])

    def is_valid_type(self, layer: str, entity_type: str) -> bool:
        """
        Check if entity type is valid for layer.

        Args:
            layer: Layer name
            entity_type: Entity type to validate

        Returns:
            True if valid, False otherwise
        """
        valid_types = self.get_valid_types(layer)
        return entity_type.lower() in [t.lower() for t in valid_types]

    def get_all_layers(self) -> List[str]:
        """
        Get list of all registered layers.

        Returns:
            List of layer names
        """
        return list(self._registry.keys())

    def get_registry(self) -> Dict[str, List[str]]:
        """
        Get the complete registry.

        Returns:
            Dictionary mapping layer names to entity type lists
        """
        return self._registry.copy()
