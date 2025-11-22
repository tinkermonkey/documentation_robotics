"""
Naming convention validation.
"""
import re
from .base import BaseValidator, ValidationResult
from ..core.element import Element


class NamingValidator(BaseValidator):
    """Validates naming conventions for elements."""

    def __init__(self, id_format: str = "{layer}.{type}.{kebab-case-name}"):
        """
        Initialize naming validator.

        Args:
            id_format: Expected ID format pattern
        """
        self.id_format = id_format

    def validate_element(self, element: Element) -> ValidationResult:
        """
        Validate element naming conventions.

        Args:
            element: Element to validate

        Returns:
            ValidationResult
        """
        result = ValidationResult()

        # Validate ID format
        if not self._validate_id_format(element.id):
            result.add_error(
                layer=element.layer,
                element_id=element.id,
                message=f"Element ID doesn't match expected format: {self.id_format}",
                fix="Ensure ID follows pattern: {layer}.{type}.{kebab-case-name}"
            )

        # Validate name is not empty
        if not element.name:
            result.add_error(
                layer=element.layer,
                element_id=element.id,
                message="Element name is required"
            )

        # Validate name doesn't contain special characters
        if element.name and not re.match(r'^[a-zA-Z0-9\s\-_]+$', element.name):
            result.add_warning(
                layer=element.layer,
                element_id=element.id,
                message="Element name contains special characters"
            )

        return result

    def _validate_id_format(self, element_id: str) -> bool:
        """Validate ID matches expected format."""
        # Expected format: {layer}.{type}.{kebab-case-name}
        parts = element_id.split(".")

        if len(parts) < 3:
            return False

        # Check that name part is kebab-case
        name_part = parts[2]
        if not re.match(r'^[a-z0-9]+(-[a-z0-9]+)*$', name_part):
            return False

        return True

    def validate(self, *args, **kwargs) -> ValidationResult:
        """Validate method for BaseValidator compatibility."""
        if "element" in kwargs:
            return self.validate_element(kwargs["element"])
        return ValidationResult()
