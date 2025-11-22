"""
JSON Schema validation for elements.
"""
from pathlib import Path
from typing import Optional
import json
import jsonschema
from .base import BaseValidator, ValidationResult
from ..core.element import Element


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

    def validate_element(
        self,
        element: Element,
        strict: bool = False
    ) -> ValidationResult:
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
                layer=element.layer,
                element_id=element.id,
                message="No schema available for validation"
            )
            return result

        try:
            # Validate against schema
            jsonschema.validate(element.data, self.schema)

        except jsonschema.ValidationError as e:
            result.add_error(
                layer=element.layer,
                element_id=element.id,
                message=f"Schema validation failed: {e.message}",
                location=f"$.{'.'.join(str(p) for p in e.path)}",
                fix=self._suggest_fix(e)
            )

        except jsonschema.SchemaError as e:
            result.add_error(
                layer=element.layer,
                element_id=element.id,
                message=f"Invalid schema: {e.message}"
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
                layer=element.layer,
                element_id=element.id,
                message="Missing description (recommended in strict mode)"
            )

        # Check naming conventions
        if not element.name or not element.name[0].isupper():
            result.add_warning(
                layer=element.layer,
                element_id=element.id,
                message="Element name should start with uppercase letter"
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
