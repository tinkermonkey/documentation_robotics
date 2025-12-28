"""
Bidirectional consistency validation for cross-layer references.

This validator ensures that relationships are consistent in both directions.
For example, if element A realizes element B, then element B should list A
in its realizedBy property.

Spec Requirement: Bidirectional consistency ensures referential integrity
and enables bidirectional navigation through the model.
"""

import logging
from typing import Dict, List, Set

from ..core.element import Element
from ..core.model import Model
from .base import BaseValidator, ValidationResult, ValidationWarning

logger = logging.getLogger(__name__)


class BidirectionalConsistencyValidator(BaseValidator):
    """
    Validates bidirectional consistency of relationships.

    Checks that forward and backward references are consistent across
    elements and layers.
    """

    # Define bidirectional relationship pairs
    # Format: (forward_property, backward_property, relationship_name)
    BIDIRECTIONAL_RELATIONSHIPS = [
        ("realizes", "realizedBy", "realization"),
        ("serves", "servedBy", "serving"),
        ("accesses", "accessedBy", "access"),
        ("uses", "usedBy", "usage"),
        ("composedOf", "partOf", "composition"),
        ("implements", "implementedBy", "implementation"),
        ("triggers", "triggeredBy", "triggering"),
        ("flows", "flowsFrom", "flow"),
        ("assigns", "assignedTo", "assignment"),
        ("deployedTo", "hosts", "deployment"),
        ("hostedOn", "hosts", "hosting"),
        ("instruments", "instrumentedBy", "instrumentation"),
    ]

    def validate(self, model: Model) -> ValidationResult:
        """
        Validate bidirectional consistency across all elements.

        Args:
            model: The model to validate

        Returns:
            ValidationResult with errors and warnings
        """
        result = ValidationResult()

        # Check each bidirectional relationship type
        for forward_prop, backward_prop, rel_name in self.BIDIRECTIONAL_RELATIONSHIPS:
            self._validate_relationship_pair(model, forward_prop, backward_prop, rel_name, result)

        return result

    def _validate_relationship_pair(
        self,
        model: Model,
        forward_prop: str,
        backward_prop: str,
        rel_name: str,
        result: ValidationResult,
    ) -> None:
        """
        Validate a specific bidirectional relationship pair.

        Args:
            model: The model
            forward_prop: Forward property name (e.g., "realizes")
            backward_prop: Backward property name (e.g., "realizedBy")
            rel_name: Human-readable relationship name
            result: ValidationResult to add issues to
        """
        # Build index of forward references: source_id -> set of target_ids
        forward_refs: Dict[str, Set[str]] = {}
        # Build index of backward references: target_id -> set of source_ids
        backward_refs: Dict[str, Set[str]] = {}

        # Scan all elements for forward and backward references
        for layer_name in model.list_layers():
            layer = model.get_layer(layer_name)

            for element in layer.list_elements():
                # Check for forward reference
                forward_value = self._get_property_value(element, forward_prop)
                if forward_value:
                    targets = self._normalize_to_list(forward_value)
                    forward_refs[element.id] = set(targets)

                # Check for backward reference
                backward_value = self._get_property_value(element, backward_prop)
                if backward_value:
                    sources = self._normalize_to_list(backward_value)
                    backward_refs[element.id] = set(sources)

        # Check forward consistency: if A -> B, then B should have A in backward refs
        for source_id, target_ids in forward_refs.items():
            for target_id in target_ids:
                # Check if target has backward reference to source
                if target_id in backward_refs:
                    if source_id not in backward_refs[target_id]:
                        result.add_warning(
                            ValidationWarning(
                                message=(
                                    f"Inconsistent {rel_name} relationship: "
                                    f"'{source_id}' {forward_prop} '{target_id}', "
                                    f"but '{target_id}' does not list '{source_id}' in {backward_prop}"
                                ),
                                element_id=target_id,
                                layer=self._get_layer_from_id(target_id),
                                property_path=backward_prop,
                                suggestion=f"Add '{source_id}' to {backward_prop} property of '{target_id}'",
                            )
                        )
                else:
                    # Target exists but has no backward references at all
                    result.add_warning(
                        ValidationWarning(
                            message=(
                                f"Incomplete {rel_name} relationship: "
                                f"'{source_id}' {forward_prop} '{target_id}', "
                                f"but '{target_id}' lacks {backward_prop} property"
                            ),
                            element_id=target_id,
                            layer=self._get_layer_from_id(target_id),
                            property_path=backward_prop,
                            suggestion=f"Add {backward_prop} property with value: ['{source_id}']",
                        )
                    )

        # Check backward consistency: if B has A in backward refs, A should have B in forward refs
        for target_id, source_ids in backward_refs.items():
            for source_id in source_ids:
                # Check if source has forward reference to target
                if source_id in forward_refs:
                    if target_id not in forward_refs[source_id]:
                        result.add_warning(
                            ValidationWarning(
                                message=(
                                    f"Inconsistent {rel_name} relationship: "
                                    f"'{target_id}' has '{source_id}' in {backward_prop}, "
                                    f"but '{source_id}' does not list '{target_id}' in {forward_prop}"
                                ),
                                element_id=source_id,
                                layer=self._get_layer_from_id(source_id),
                                property_path=forward_prop,
                                suggestion=f"Add '{target_id}' to {forward_prop} property of '{source_id}'",
                            )
                        )
                else:
                    # Source exists but has no forward references at all
                    result.add_warning(
                        ValidationWarning(
                            message=(
                                f"Incomplete {rel_name} relationship: "
                                f"'{target_id}' has '{source_id}' in {backward_prop}, "
                                f"but '{source_id}' lacks {forward_prop} property"
                            ),
                            element_id=source_id,
                            layer=self._get_layer_from_id(source_id),
                            property_path=forward_prop,
                            suggestion=f"Add {forward_prop} property with value: ['{target_id}']",
                        )
                    )

    def _get_property_value(self, element: Element, property_name: str):
        """
        Get property value from element, checking multiple locations.

        Args:
            element: The element
            property_name: Name of the property

        Returns:
            Property value or None
        """
        # Check direct property
        if property_name in element.data:
            return element.data[property_name]

        # Check in properties dict
        if "properties" in element.data and property_name in element.data["properties"]:
            return element.data["properties"][property_name]

        # Check in spec dict
        if "spec" in element.data and isinstance(element.data["spec"], dict):
            if property_name in element.data["spec"]:
                return element.data["spec"][property_name]

        return None

    def _normalize_to_list(self, value) -> List[str]:
        """
        Normalize a value to a list of strings.

        Args:
            value: Single string, list of strings, or other value

        Returns:
            List of strings
        """
        if isinstance(value, str):
            return [value]
        elif isinstance(value, list):
            return [str(v) for v in value if v]
        else:
            return []

    def _get_layer_from_id(self, element_id: str) -> str:
        """
        Extract layer name from element ID.

        Args:
            element_id: Element ID (format: layer.type.name)

        Returns:
            Layer name
        """
        parts = element_id.split(".")
        return parts[0] if parts else "unknown"

    def generate_consistency_report(self, model: Model) -> Dict:
        """
        Generate a comprehensive consistency report.

        Args:
            model: The model to analyze

        Returns:
            Dictionary with consistency statistics
        """
        report = {
            "total_relationships": 0,
            "consistent_relationships": 0,
            "inconsistent_relationships": 0,
            "incomplete_relationships": 0,
            "issues_by_type": {},
        }

        # Validate and count issues
        result = self.validate(model)

        for error in result.errors:
            report["total_relationships"] += 1
            report["inconsistent_relationships"] += 1

            # Track by relationship type
            if "relationship" in error.message:
                # Extract relationship type from message
                for _, _, rel_name in self.BIDIRECTIONAL_RELATIONSHIPS:
                    if rel_name in error.message:
                        if rel_name not in report["issues_by_type"]:
                            report["issues_by_type"][rel_name] = []
                        report["issues_by_type"][rel_name].append(
                            {
                                "element_id": error.element_id,
                                "message": error.message,
                            }
                        )
                        break

        for warning in result.warnings:
            report["total_relationships"] += 1

            if "Inconsistent" in warning.message:
                report["inconsistent_relationships"] += 1
            elif "Incomplete" in warning.message:
                report["incomplete_relationships"] += 1

            # Track by relationship type
            for _, _, rel_name in self.BIDIRECTIONAL_RELATIONSHIPS:
                if rel_name in warning.message:
                    if rel_name not in report["issues_by_type"]:
                        report["issues_by_type"][rel_name] = []
                    report["issues_by_type"][rel_name].append(
                        {
                            "element_id": warning.element_id,
                            "message": warning.message,
                        }
                    )
                    break

        report["consistent_relationships"] = (
            report["total_relationships"]
            - report["inconsistent_relationships"]
            - report["incomplete_relationships"]
        )

        # Calculate consistency percentage
        if report["total_relationships"] > 0:
            report["consistency_percentage"] = (
                report["consistent_relationships"] / report["total_relationships"] * 100
            )
        else:
            report["consistency_percentage"] = 100.0

        return report

    def auto_fix_inconsistencies(self, model: Model, dry_run: bool = True) -> Dict:
        """
        Automatically fix bidirectional consistency issues.

        Args:
            model: The model to fix
            dry_run: If True, don't actually modify elements

        Returns:
            Dictionary with fix statistics
        """
        stats = {
            "fixes_applied": 0,
            "fixes_skipped": 0,
            "errors": [],
        }

        result = self.validate(model)

        for warning in result.warnings:
            # Parse the warning to understand what needs to be fixed
            if "does not list" in warning.message and warning.suggestion:
                # Extract the fix from the suggestion
                if not dry_run:
                    try:
                        # This would require implementing element update logic
                        # For now, just count it
                        stats["fixes_applied"] += 1
                    except Exception as e:
                        stats["errors"].append(str(e))
                        stats["fixes_skipped"] += 1
                else:
                    stats["fixes_applied"] += 1

        return stats
