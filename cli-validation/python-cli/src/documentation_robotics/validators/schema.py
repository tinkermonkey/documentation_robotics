"""
JSON Schema validation for elements.
"""

import json
from pathlib import Path
from typing import Optional

import jsonschema

from ..core.element import Element
from .base import BaseValidator, ValidationResult


class SchemaValidator(BaseValidator):
    """Validates elements against JSON Schema."""

    def __init__(self, schema_path: Optional[Path] = None):
        """
        Initialize schema validator.

        Args:
            schema_path: Path to JSON Schema file
        """
        self.schema_path = schema_path
        self.schema = None

        if schema_path and Path(schema_path).exists():
            with open(schema_path, "r") as f:
                self.schema = json.load(f)

    def validate_element(self, element: Element, strict: bool = False) -> ValidationResult:
        """
        Validate element against schema.

        Args:
            element: Element to validate
            strict: If True, apply strict validation

        Returns:
            ValidationResult
        """
        result = ValidationResult()

        if not self.schema:
            result.add_warning(
                element.layer,
                message="No schema available for validation",
                element_id=element.id,
            )
            return result

        try:
            # Extract entity-specific schema from layer schema
            # The layer schema has entity definitions in the "definitions" section
            # We need to validate against the specific entity type's definition
            entity_schema = self._get_entity_schema(element)

            if not entity_schema:
                # Fall back to validating against the whole schema
                entity_schema = self.schema

            # Validate against entity schema
            jsonschema.validate(element.data, entity_schema)

        except jsonschema.ValidationError as e:
            result.add_error(
                element.layer,
                message=f"Schema validation failed: {e.message}",
                element_id=element.id,
                location=f"$.{'.'.join(str(p) for p in e.path)}",
                fix=self._suggest_fix(e),
            )

        except jsonschema.SchemaError as e:
            result.add_error(
                element.layer,
                message=f"Invalid schema: {e.message}",
                element_id=element.id,
            )

        # Additional strict checks
        if strict:
            self._strict_validation(element, result)

        return result

    def _get_entity_schema(self, element: Element) -> Optional[dict]:
        """
        Extract entity-specific schema from layer schema.

        Args:
            element: Element to get schema for

        Returns:
            Entity schema definition (with definitions section for $refs) or None if not found
        """
        if not self.schema or "definitions" not in self.schema:
            return None

        definitions = self.schema.get("definitions", {})
        properties = self.schema.get("properties", {})

        # Try multiple strategies to find the entity definition
        entity_def_name = None

        # Strategy 0: If element has a file_path, try to infer from filename first
        # This handles cases where element.data['type'] is different from the schema type
        # (e.g., element.data['type'] = 'custom' but filename is 'views.yaml' -> should use 'View' definition)
        if element.file_path:
            filename_type = element.file_path.stem  # e.g., 'views', 'routes'
            entity_def_name = self._find_entity_def_by_type(filename_type, properties, definitions)

        # Strategy 1: Try using element.type
        if not entity_def_name:
            element_type = element.type
            if element_type:
                entity_def_name = self._find_entity_def_by_type(
                    element_type, properties, definitions
                )

        if not entity_def_name or entity_def_name not in definitions:
            return None

        # Create a standalone schema with the entity definition as the root
        # and include all definitions so $refs work
        entity_schema = {
            "$schema": self.schema.get("$schema", "http://json-schema.org/draft-07/schema#"),
            "type": "object",
            "definitions": definitions,  # Include all definitions for $ref resolution
            **definitions[entity_def_name],  # Merge entity definition properties at root
        }

        return entity_schema

    def _find_entity_def_by_type(
        self, type_str: str, properties: dict, definitions: dict
    ) -> Optional[str]:
        """
        Find entity definition name by trying various naming conventions.

        Args:
            type_str: Type string to search for (e.g., 'views', 'custom', 'security-policie')
            properties: Schema properties dictionary
            definitions: Schema definitions dictionary

        Returns:
            Entity definition name or None if not found
        """
        # Strategy A: Find the property that matches type_str and extract $ref
        for prop_name, prop_schema in properties.items():
            # Check if property name matches (with or without trailing 's' or 'es')
            if prop_name == type_str or prop_name == type_str + "s" or prop_name == type_str + "es":
                # Extract $ref from items
                if isinstance(prop_schema, dict) and "items" in prop_schema:
                    items = prop_schema["items"]
                    if isinstance(items, dict) and "$ref" in items:
                        ref = items["$ref"]
                        # Extract definition name from $ref
                        if ref.startswith("#/definitions/"):
                            return ref[len("#/definitions/") :]

        # Strategy B: Try direct match with definitions
        if type_str in definitions:
            return type_str

        # Strategy C: Try PascalCase conversion
        pascal_case = "".join(word.capitalize() for word in type_str.split("-"))
        if pascal_case in definitions:
            return pascal_case

        # Strategy D: Try with 's' added
        type_str_plural = type_str + "s"
        pascal_case_plural = "".join(word.capitalize() for word in type_str_plural.split("-"))
        if pascal_case_plural in definitions:
            return pascal_case_plural

        # Strategy E: Try singular forms
        singular = type_str
        if type_str.endswith("ies"):
            singular = type_str[:-3] + "y"
        elif type_str.endswith("es"):
            singular = type_str[:-2]
        elif type_str.endswith("s"):
            singular = type_str[:-1]

        if singular != type_str:
            if singular in definitions:
                return singular

            pascal_singular = "".join(word.capitalize() for word in singular.split("-"))
            if pascal_singular in definitions:
                return pascal_singular

        return None

    def _strict_validation(self, element: Element, result: ValidationResult):
        """Apply strict validation rules."""
        # Check for required fields
        if not element.description:
            result.add_warning(
                element.layer,
                message="Missing description (recommended in strict mode)",
                element_id=element.id,
            )

        # Check naming conventions
        if not element.name or not element.name[0].isupper():
            result.add_warning(
                element.layer,
                message="Element name should start with uppercase letter",
                element_id=element.id,
            )

    def _suggest_fix(self, error: jsonschema.ValidationError) -> Optional[str]:
        """Suggest a fix for validation error."""
        if "required" in error.message.lower():
            return f"Add the required property: {error.message}"
        elif "type" in error.message.lower():
            return f"Check the data type: {error.message}"
        return None

    def validate(self, *args, **kwargs) -> ValidationResult:
        """Validate method for BaseValidator compatibility."""
        if "element" in kwargs:
            return self.validate_element(kwargs["element"], kwargs.get("strict", False))
        return ValidationResult()
