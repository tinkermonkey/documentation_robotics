"""JSON Schema generator from layer specifications.

Converts LayerSpec objects into JSON Schema Draft 7 format.
"""

from typing import Any, Dict, List

from .markdown_parser import AttributeSpec, EntityDefinition, LayerSpec, PropertySpec


class JSONSchemaGenerator:
    """Generates JSON Schema from layer specifications."""

    # Type mappings from markdown to JSON Schema
    TYPE_MAPPINGS = {
        "string": {"type": "string"},
        "integer": {"type": "integer"},
        "number": {"type": "number"},
        "boolean": {"type": "boolean"},
        "array": {"type": "array"},
        "object": {"type": "object"},
    }

    # Format mappings
    FORMAT_MAPPINGS = {
        "uuid": "uuid",
        "date": "date",
        "date-time": "date-time",
        "time": "time",
        "email": "email",
        "uri": "uri",
    }

    def __init__(self):
        """Initialize the schema generator."""
        pass

    def generate_layer_schema(
        self, layer_spec: LayerSpec, base_url: str = "https://example.com/schemas"
    ) -> Dict[str, Any]:
        """Generate complete JSON Schema for a layer.

        Args:
            layer_spec: Layer specification
            base_url: Base URL for schema $id

        Returns:
            Complete JSON Schema dict
        """
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "$id": f"{base_url}/{layer_spec.layer_id}.schema.json",
            "title": f"{layer_spec.title} Layer Schema",
            "description": layer_spec.description or f"Schema for {layer_spec.title}",
            "type": "object",
            "properties": {},
            "definitions": {},
        }

        # Generate entity array properties at top level
        # Skip x- prefixed extension properties (they're not standalone entities)
        for entity_name, entity in layer_spec.entities.items():
            if entity_name.startswith("x-"):
                # Extension properties are only in definitions, not top-level collections
                continue

            # Convert EntityName to entity-name-array format
            array_name = self._to_array_name(entity_name)
            schema["properties"][array_name] = {
                "type": "array",
                "description": f"Collection of {entity_name} entities",
                "items": {"$ref": f"#/definitions/{entity_name}"},
            }

        # Collect all enums from all entities first (for top-level definitions)
        all_enums = {}
        for entity_name, entity in layer_spec.entities.items():
            if hasattr(entity, 'enums') and entity.enums:
                # Add entity's enums to top-level definitions
                for enum_name, enum_values in entity.enums.items():
                    if enum_name not in all_enums:
                        all_enums[enum_name] = enum_values
                    # Note: If same enum name appears in multiple entities, first one wins
                    # This is expected behavior for shared enums

        # Add collected enums to top-level definitions
        for enum_name, enum_values in all_enums.items():
            # Normalize enum values to list of strings
            normalized_values = self._normalize_enum_values(enum_values)
            schema["definitions"][enum_name] = {"type": "string", "enum": normalized_values}

        # Generate entity definitions
        for entity_name, entity in layer_spec.entities.items():
            schema["definitions"][entity_name] = self._generate_entity_schema(entity, include_enums=False)

        # Add Relationship definition if we have relationship types
        if layer_spec.relationship_types:
            schema["definitions"]["Relationship"] = self._generate_relationship_schema(
                layer_spec.relationship_types
            )
            schema["properties"]["relationships"] = {
                "type": "array",
                "description": "Collection of relationships between entities",
                "items": {"$ref": "#/definitions/Relationship"},
            }

        return schema

    def _normalize_enum_values(self, enum_values: Any) -> List[str]:
        """Normalize enum values to a list of strings.

        Handles two formats from YAML:
        1. Simple list: ["value1", "value2"]
        2. Dict list: [{"key1": val1}, {"key2": val2}] - extracts keys

        Args:
            enum_values: Enum values from YAML (list or dict)

        Returns:
            List of string enum values
        """
        if not enum_values:
            return []

        # If it's a list
        if isinstance(enum_values, list):
            normalized = []
            for item in enum_values:
                if isinstance(item, dict):
                    # Extract keys from dict items (e.g., {"UNSPECIFIED": 0} -> "UNSPECIFIED")
                    normalized.extend(item.keys())
                elif isinstance(item, str):
                    # Already a string
                    normalized.append(item)
                else:
                    # Convert to string
                    normalized.append(str(item))
            return normalized
        elif isinstance(enum_values, dict):
            # If it's a dict, use the keys as enum values
            return list(enum_values.keys())
        else:
            # Single value, wrap in list
            return [str(enum_values)]

    def _generate_entity_schema(self, entity: EntityDefinition, include_enums: bool = True) -> Dict[str, Any]:
        """Generate schema for a single entity.

        Args:
            entity: Entity definition
            include_enums: Whether to include enum definitions (deprecated, enums now at top-level)

        Returns:
            JSON Schema definition for entity
        """
        entity_schema = {
            "type": "object",
            "description": entity.description,
            "required": [],
            "properties": {},
        }

        # Add attributes
        for attr_name, attr_spec in entity.attributes.items():
            entity_schema["properties"][attr_name] = self._generate_attribute_schema(attr_spec)

            # Add to required list if not optional
            if not attr_spec.is_optional:
                entity_schema["required"].append(attr_name)

        # Always require id and name if they exist
        if "id" in entity.attributes and "id" not in entity_schema["required"]:
            entity_schema["required"].append("id")
        if "name" in entity.attributes and "name" not in entity_schema["required"]:
            entity_schema["required"].append("name")

        # Add cross-layer properties object if entity has properties
        if entity.properties:
            properties_schema = {"type": "object", "description": "Cross-layer properties"}

            # Group properties by namespace
            namespaced_props: Dict[str, List[PropertySpec]] = {}
            for prop in entity.properties:
                if "." in prop.key:
                    namespace = prop.key.split(".")[0]
                    if namespace not in namespaced_props:
                        namespaced_props[namespace] = []
                    namespaced_props[namespace].append(prop)

            # Generate nested structure for namespaced properties
            for namespace, props in namespaced_props.items():
                namespace_schema = {"type": "object", "properties": {}}
                for prop in props:
                    # Extract field name after namespace
                    field_name = ".".join(prop.key.split(".")[1:])
                    namespace_schema["properties"][field_name] = {
                        "type": "string",  # Default to string
                        "description": prop.description,
                    }
                properties_schema["properties"] = properties_schema.get("properties", {})
                properties_schema["properties"][namespace] = namespace_schema

            entity_schema["properties"]["properties"] = properties_schema

        # Add contains relationships if present
        if entity.contains:
            from .markdown_parser import ContainsSpec

            if isinstance(entity.contains, dict):
                for rel_name, rel_spec in entity.contains.items():
                    entity_schema["properties"][rel_name] = self._generate_contains_schema(rel_spec)
            elif isinstance(entity.contains, list):
                # Handle list of ContainsSpec objects
                for contains_spec in entity.contains:
                    if isinstance(contains_spec, ContainsSpec):
                        entity_schema["properties"][contains_spec.name] = (
                            self._generate_contains_property(contains_spec)
                        )
                    elif isinstance(contains_spec, dict):
                        for rel_name, rel_spec in contains_spec.items():
                            entity_schema["properties"][rel_name] = self._generate_contains_schema(
                                rel_spec
                            )

        # Add enum definitions if present (deprecated - enums now at top-level)
        # Only include if explicitly requested for backward compatibility
        if include_enums and entity.enums:
            if "definitions" not in entity_schema:
                entity_schema["definitions"] = {}
            for enum_name, enum_values in entity.enums.items():
                normalized_values = self._normalize_enum_values(enum_values)
                entity_schema["definitions"][enum_name] = {"type": "string", "enum": normalized_values}

        return entity_schema

    def _generate_attribute_schema(self, attr_spec: AttributeSpec) -> Dict[str, Any]:
        """Generate schema for a single attribute.

        Args:
            attr_spec: Attribute specification

        Returns:
            JSON Schema property definition
        """
        # Start with base type
        attr_schema = self.TYPE_MAPPINGS.get(attr_spec.type, {"type": "string"}).copy()

        # Add format if specified
        if attr_spec.format and attr_spec.format in self.FORMAT_MAPPINGS:
            attr_schema["format"] = self.FORMAT_MAPPINGS[attr_spec.format]

        # Add enum reference if specified
        if attr_spec.enum_ref:
            attr_schema = {"$ref": f"#/definitions/{attr_spec.enum_ref}"}

        # Add description if available
        if attr_spec.description:
            attr_schema["description"] = attr_spec.description

        # Add common constraints for string types
        if attr_schema.get("type") == "string" and not attr_spec.enum_ref:
            attr_schema["minLength"] = 1

        return attr_schema

    def _generate_contains_schema(self, rel_spec: Any) -> Dict[str, Any]:
        """Generate schema for contains relationships.

        Args:
            rel_spec: Relationship specification

        Returns:
            JSON Schema for the relationship
        """
        # Simple array of references
        return {
            "type": "array",
            "description": "Contains relationship",
            "items": {"type": "string"},
        }

    def _generate_contains_property(
        self, contains_spec: "ContainsSpec", include_descriptions: bool = True
    ) -> Dict[str, Any]:
        """Generate schema property for a contains relationship.

        Args:
            contains_spec: ContainsSpec object
            include_descriptions: Whether to include descriptions

        Returns:
            JSON Schema property for the contains relationship
        """

        schema = {
            "type": "array",
            "items": {"type": "string", "format": "uuid"},
        }

        if include_descriptions:
            schema["description"] = f"Array of {contains_spec.target_type} IDs"

        if contains_spec.min_items is not None and contains_spec.min_items > 0:
            schema["minItems"] = contains_spec.min_items

        if contains_spec.max_items is not None:
            schema["maxItems"] = contains_spec.max_items

        return schema

    def _generate_relationship_schema(self, relationship_types: List[str]) -> Dict[str, Any]:
        """Generate schema for Relationship definition.

        Args:
            relationship_types: List of valid relationship types

        Returns:
            JSON Schema for Relationship
        """
        return {
            "type": "object",
            "description": "Relationship between entities",
            "required": ["id", "source", "target", "type"],
            "properties": {
                "id": {"type": "string", "format": "uuid", "description": "Unique relationship ID"},
                "source": {"type": "string", "description": "Source entity ID"},
                "target": {"type": "string", "description": "Target entity ID"},
                "type": {
                    "type": "string",
                    "enum": relationship_types,
                    "description": "Relationship type",
                },
                "description": {"type": "string", "description": "Relationship description"},
            },
        }

    def _to_array_name(self, entity_name: str) -> str:
        """Convert entity name to array property name.

        Args:
            entity_name: Entity name like "BusinessActor"

        Returns:
            Array name like "business-actors"
        """
        # Convert PascalCase to kebab-case
        import re

        # Insert hyphens before uppercase letters
        s1 = re.sub("(.)([A-Z][a-z]+)", r"\1-\2", entity_name)
        # Insert hyphens before uppercase letters preceded by lowercase
        s2 = re.sub("([a-z0-9])([A-Z])", r"\1-\2", s1)
        # Convert to lowercase
        kebab = s2.lower()

        # Pluralize (simple rules)
        if kebab.endswith("y"):
            return kebab[:-1] + "ies"
        elif kebab.endswith(("s", "x", "z", "ch", "sh")):
            return kebab + "es"
        else:
            return kebab + "s"
