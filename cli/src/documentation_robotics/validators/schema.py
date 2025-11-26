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
            # Validate against schema
            jsonschema.validate(element.data, self.schema)

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
