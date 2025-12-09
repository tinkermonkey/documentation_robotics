"""
Entity Type Registry - Central registry of valid entity types per layer.

Extracts entity types from JSON Schema files and provides validation.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

import inflect

# Special case entity types for layers with non-standard schema structures
# These are explicitly defined to ensure complete coverage of all schema entities

# API Layer types (OpenAPI 3.0 specification entities)
# Organized by: Document structure, Operations, Data, Components, Security
API_LAYER_TYPES = [
    # Document structure
    "open-api-document",
    "info",
    "contact",
    "license",
    "server",
    "server-variable",
    "tag",
    "external-documentation",
    # Paths and operations
    "paths",
    "path-item",
    "operation",
    "parameter",
    "request-body",
    "responses",
    "response",
    "callback",
    # Data representation
    "media-type",
    "schema",
    "example",
    "encoding",
    "header",
    "link",
    # Components container
    "components",
    # Security
    "security-scheme",
    "oauth-flows",
    "oauth-flow",
]

# Data Model Layer types (JSON Schema Draft 7 entities)
# Organized by: Core schemas, Type-specific schemas, Composition, Metadata
DATA_MODEL_LAYER_TYPES = [
    # Core schema entities
    "json-schema",
    "json-type",
    "schema-definition",
    "schema-property",
    "reference",
    # Type-specific schemas
    "string-schema",
    "numeric-schema",
    "array-schema",
    "object-schema",
    # Schema composition
    "schema-composition",
    # Data governance and quality
    "data-governance",
    "data-quality-metrics",
    "database-mapping",
    # Cross-layer reference extensions
    "x-business-object-ref",
    "x-data-governance",
    "x-apm-data-quality-metrics",
    "x-database",
]

# Testing Layer types (Input Space Partitioning and Coverage)
# Organized by: Model, Targets, Partitions, Context, Coverage, Results
TESTING_LAYER_TYPES = [
    # Coverage model container
    "test-coverage-model",
    # Test targets
    "test-coverage-target",
    "target-input-field",
    # Input space partitioning
    "input-space-partition",
    "partition-value",
    "partition-dependency",
    # Context and environment
    "context-variation",
    "environment-factor",
    "outcome-category",
    # Coverage requirements
    "coverage-requirement",
    "input-partition-selection",
    "coverage-exclusion",
    # Test case generation
    "test-case-sketch",
    "input-selection",
    # Coverage reporting
    "coverage-summary",
    "target-coverage-summary",
    "coverage-gap",
]
# UX Layer types for spec v0.5.0 Three-Tier Architecture
# Tier 1: Library (reusable design system components)
# Tier 2: Application (application-level organization)
# Tier 3: Experience (experience-specific configuration)
UX_LAYER_TYPES = [
    # Tier 1: Library
    "ux-library",
    "library-component",
    "library-sub-view",
    "state-pattern",
    "action-pattern",
    # Tier 2: Application
    "ux-application",
    # Tier 3: Experience
    "ux-spec",
    "experience-state",
    "state-action",
    "state-transition",
    "condition",
    "view",
    "sub-view",
    "component-instance",
    "action-component",
    # Supporting entities
    "validation-rule",
    "layout-config",
    "error-config",
    "api-config",
    "data-config",
    "performance-targets",
    "component-reference",
    "transition-template",
    "state-action-template",
    "table-column",
    "chart-series",
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
        elif layer_name == "ux":
            return UX_LAYER_TYPES

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
            business-services → service
            applicationComponents → component
            stakeholders → stakeholder

        Args:
            property_name: Property name from schema

        Returns:
            Entity type for CLI, or None if invalid
        """
        if not property_name:
            return None

        # Strip common layer prefixes (handles both kebab-case and camelCase)
        for prefix in [
            "business-",
            "application-",
            "technology-",
            "business",
            "application",
            "technology",
        ]:
            if property_name.startswith(prefix):
                # Remove prefix
                property_name = property_name[len(prefix) :]
                # If next char is uppercase (camelCase), lowercase it
                if property_name and property_name[0].isupper():
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
