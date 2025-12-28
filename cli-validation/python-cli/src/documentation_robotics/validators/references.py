"""
Cross-reference validation.
"""

from typing import Any, List, Optional, Set

from .base import BaseValidator, ValidationResult


class ReferenceValidator(BaseValidator):
    """Validates cross-references between elements."""

    def __init__(self, model: Any):
        """
        Initialize reference validator.

        Args:
            model: Model instance to validate
        """
        self.model = model

    def validate(self) -> ValidationResult:
        """
        Validate all cross-references in the model.

        Returns:
            ValidationResult
        """
        result = ValidationResult()

        # Collect all valid element IDs
        valid_ids: Set[str] = set()
        for layer in self.model.layers.values():
            for element_id in layer.elements.keys():
                valid_ids.add(element_id)

        # Check each element's references
        for layer in self.model.layers.values():
            for element in layer.elements.values():
                self._validate_element_references(element, valid_ids, result)

        return result

    def _validate_element_references(
        self, element: Any, valid_ids: Set[str], result: ValidationResult
    ) -> None:
        """
        Validate references in a single element.

        Args:
            element: Element to validate
            valid_ids: Set of all valid element IDs
            result: ValidationResult to append to
        """
        # Find all reference fields
        references = self._extract_references(element.data)

        for ref in references:
            if ref not in valid_ids:
                # Try to suggest similar IDs
                suggestions = self._find_similar_ids(ref, valid_ids)
                fix_msg = None
                if suggestions:
                    fix_msg = f"Did you mean: {', '.join(suggestions[:3])}?"

                result.add_error(
                    element.layer,
                    message=f"Invalid reference to '{ref}' - element does not exist",
                    element_id=element.id,
                    fix=fix_msg,
                )

    def _extract_references(self, data: Any, references: Optional[Set[str]] = None) -> Set[str]:
        """
        Extract all element ID references from data.

        Args:
            data: Data to search for references
            references: Set to collect references into

        Returns:
            Set of element ID references
        """
        if references is None:
            references = set()

        if isinstance(data, str):
            # Check if it looks like an element ID (contains dots)
            if "." in data and self._looks_like_element_id(data):
                references.add(data)

        elif isinstance(data, list):
            for item in data:
                self._extract_references(item, references)

        elif isinstance(data, dict):
            # Look for common reference field names
            reference_fields = [
                "realizes",
                "serves",
                "accesses",
                "flows_to",
                "flows_from",
                "composed_of",
                "aggregates",
                "specializes",
                "assigned_to",
                "triggers",
                "references",
                "depends_on",
            ]

            for key, value in data.items():
                if key in reference_fields or key.endswith("_ref") or key.endswith("_id"):
                    self._extract_references(value, references)
                elif isinstance(value, (dict, list)):
                    self._extract_references(value, references)

        return references

    def _looks_like_element_id(self, text: str) -> bool:
        """Check if text looks like an element ID."""
        # Element IDs have format: {layer}.{type}.{name}
        parts = text.split(".")
        if len(parts) < 3:
            return False

        # Check if first part is a known layer
        known_layers = {
            "motivation",
            "business",
            "security",
            "application",
            "technology",
            "api",
            "data_model",
            "datastore",
            "ux",
            "navigation",
            "apm",
        }

        return parts[0] in known_layers

    def _find_similar_ids(
        self, target: str, valid_ids: Set[str], max_suggestions: int = 3
    ) -> List[str]:
        """
        Find similar element IDs.

        Args:
            target: Target ID to find matches for
            valid_ids: Set of valid IDs
            max_suggestions: Maximum number of suggestions

        Returns:
            List of similar IDs
        """
        suggestions = []

        # Simple matching: same layer and type
        target_parts = target.split(".")
        if len(target_parts) >= 2:
            target_layer = target_parts[0]
            target_type = target_parts[1]

            for valid_id in valid_ids:
                valid_parts = valid_id.split(".")
                if len(valid_parts) >= 2:
                    if valid_parts[0] == target_layer and valid_parts[1] == target_type:
                        suggestions.append(valid_id)
                        if len(suggestions) >= max_suggestions:
                            break

        return suggestions
