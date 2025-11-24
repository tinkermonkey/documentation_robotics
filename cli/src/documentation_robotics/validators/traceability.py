"""
Upward traceability validation for the Documentation Robotics Specification.

This validator ensures that implementation layers properly trace back to higher-level
layers, particularly to motivation elements (goals, requirements, principles).

Spec Requirement: All layers 02-11 must trace to Layer 01 (Motivation) via:
- supports-goals: which goals this element supports
- fulfills-requirements: which requirements this element fulfills
- governed-by-principles: which principles govern this element
"""

import logging
from typing import Dict, List, Tuple

from ..core.element import Element
from ..core.model import Model
from .base import BaseValidator, ValidationError, ValidationResult, ValidationWarning

logger = logging.getLogger(__name__)


class UpwardTraceabilityValidator(BaseValidator):
    """
    Validates upward traceability chains from implementation to motivation.

    This validator checks that:
    1. Implementation elements trace to business elements
    2. Business elements trace to motivation elements
    3. All elements eventually trace to goals/requirements
    """

    # Define traceability rules: source layer.type -> expected reference layer.type
    TRACEABILITY_RULES = {
        # Business layer should trace to motivation
        "business.process": {
            "should_reference": [
                ("supports-goals", "motivation.goal"),
                ("fulfills-requirements", "motivation.requirement"),
            ],
            "severity": "warning",
        },
        "business.service": {
            "should_reference": [
                ("supports-goals", "motivation.goal"),
                ("fulfills-requirements", "motivation.requirement"),
            ],
            "severity": "warning",
        },
        # Application layer should trace to business
        "application.service": {
            "must_reference": [("realizes", "business.service")],
            "should_reference": [("supports-goals", "motivation.goal")],
            "severity": "error",
        },
        "application.component": {
            "should_reference": [("serves", "application.service")],
            "severity": "warning",
        },
        # API layer should trace to application
        "api.operation": {
            "must_reference": [("applicationServiceRef", "application.service")],
            "severity": "error",
        },
        # UX layer should trace to API
        "ux.screen": {"should_reference": [("uses-api", "api.operation")], "severity": "warning"},
        "ux.component": {"should_reference": [("calls", "api.operation")], "severity": "warning"},
        # Data Store should trace to Data Model
        "datastore.table": {
            "should_reference": [("implements", "data_model.schema")],
            "severity": "warning",
        },
        # APM should trace to implementation
        "apm.trace": {
            "should_reference": [
                ("instruments", "application.service"),
                ("instruments", "api.operation"),
            ],
            "severity": "warning",
        },
        "apm.metric": {
            "should_reference": [("measures-goal", "motivation.goal")],
            "severity": "warning",
        },
    }

    def validate(self, model: Model) -> ValidationResult:
        """
        Validate upward traceability for all elements in the model.

        Args:
            model: The model to validate

        Returns:
            ValidationResult with errors and warnings
        """
        result = ValidationResult()

        # Check each layer
        for layer_name in model.list_layers():
            layer = model.get_layer(layer_name)

            # Validate each element in the layer
            for element in layer.list_elements():
                element_type = f"{layer_name}.{element.type}"

                # Check if we have traceability rules for this element type
                if element_type in self.TRACEABILITY_RULES:
                    rule = self.TRACEABILITY_RULES[element_type]

                    # Check "must" references (errors)
                    if "must_reference" in rule:
                        self._check_references(
                            element, rule["must_reference"], model, result, severity="error"
                        )

                    # Check "should" references (warnings)
                    if "should_reference" in rule:
                        self._check_references(
                            element, rule["should_reference"], model, result, severity="warning"
                        )

        return result

    def _check_references(
        self,
        element: Element,
        reference_specs: List[Tuple[str, str]],
        model: Model,
        result: ValidationResult,
        severity: str = "warning",
    ) -> None:
        """
        Check if element has the required references.

        Args:
            element: The element to check
            reference_specs: List of (property_name, expected_type) tuples
            model: The model for looking up references
            result: ValidationResult to add errors/warnings to
            severity: "error" or "warning"
        """
        for prop_name, expected_type in reference_specs:
            # Check if element has this property
            if not self._has_reference(element, prop_name):
                message = (
                    f"Element '{element.id}' ({element.layer}.{element.type}) "
                    f"lacks traceability to {expected_type}. "
                    f"Expected property: '{prop_name}'"
                )

                if severity == "error":
                    result.add_error(
                        ValidationError(
                            message=message,
                            element_id=element.id,
                            layer=element.layer,
                            property_path=prop_name,
                            suggestion=f"Add '{prop_name}' property referencing a {expected_type} element",
                        )
                    )
                else:
                    result.add_warning(
                        ValidationWarning(
                            message=message,
                            element_id=element.id,
                            layer=element.layer,
                            property_path=prop_name,
                            suggestion=f"Consider adding '{prop_name}' property for better traceability",
                        )
                    )

    def _has_reference(self, element: Element, property_name: str) -> bool:
        """
        Check if element has a non-empty reference property.

        Args:
            element: The element to check
            property_name: Name of the property to check

        Returns:
            True if property exists and is not empty
        """
        # Check direct property
        if property_name in element.data:
            value = element.data[property_name]
            if value:  # Not None and not empty
                return True

        # Check in nested properties dict
        if "properties" in element.data and property_name in element.data["properties"]:
            value = element.data["properties"][property_name]
            if value:
                return True

        # Check for property in standard locations
        # Some elements use 'spec' or other nested structures
        if "spec" in element.data:
            spec = element.data["spec"]
            if isinstance(spec, dict) and property_name in spec:
                value = spec[property_name]
                if value:
                    return True

        return False

    def validate_traceability_path(self, element_id: str, model: Model) -> Tuple[bool, List[str]]:
        """
        Validate complete traceability path from an element to motivation layer.

        Args:
            element_id: ID of the element to trace
            model: The model

        Returns:
            Tuple of (is_traceable, path) where path is list of element IDs
        """
        visited = set()
        path = []

        def trace_upward(current_id: str) -> bool:
            """Recursively trace upward to motivation layer."""
            if current_id in visited:
                return False  # Circular reference

            visited.add(current_id)
            path.append(current_id)

            # Parse element ID to get layer and type
            parts = current_id.split(".")
            if len(parts) < 3:
                return False

            layer_name = parts[0]

            # Reached motivation layer - success!
            if layer_name == "motivation":
                return True

            # Get element
            try:
                layer = model.get_layer(layer_name)
                element = layer.get_element(current_id)
            except Exception:
                return False

            # Find upward references
            upward_refs = self._find_upward_references(element)

            # Try each upward reference
            for ref_id in upward_refs:
                if trace_upward(ref_id):
                    return True

            # No path to motivation found
            path.pop()
            return False

        is_traceable = trace_upward(element_id)
        return is_traceable, path

    def _find_upward_references(self, element: Element) -> List[str]:
        """
        Find all upward references from an element.

        Args:
            element: The element to check

        Returns:
            List of referenced element IDs
        """
        refs = []

        # Properties that indicate upward references
        upward_properties = [
            "realizes",
            "serves",
            "supports-goals",
            "fulfills-requirements",
            "governed-by-principles",
            "implements",
            "instruments",
            "applicationServiceRef",
            "uses-api",
            "calls",
            "measures-goal",
        ]

        for prop in upward_properties:
            # Check direct properties
            if prop in element.data:
                value = element.data[prop]
                if isinstance(value, str):
                    refs.append(value)
                elif isinstance(value, list):
                    refs.extend([v for v in value if isinstance(v, str)])

            # Check nested properties
            if "properties" in element.data and prop in element.data["properties"]:
                value = element.data["properties"][prop]
                if isinstance(value, str):
                    refs.append(value)
                elif isinstance(value, list):
                    refs.extend([v for v in value if isinstance(v, str)])

        return refs

    def generate_traceability_report(self, model: Model) -> Dict:
        """
        Generate a comprehensive traceability report for the model.

        Args:
            model: The model to analyze

        Returns:
            Dictionary with traceability statistics and issues
        """
        report = {
            "total_elements": 0,
            "traceable_elements": 0,
            "untraceable_elements": [],
            "orphaned_elements": [],
            "traceability_paths": {},
        }

        # Check all non-motivation elements
        for layer_name in model.list_layers():
            if layer_name == "motivation":
                continue

            layer = model.get_layer(layer_name)

            for element in layer.list_elements():
                report["total_elements"] += 1

                # Try to trace to motivation
                is_traceable, path = self.validate_traceability_path(element.id, model)

                if is_traceable:
                    report["traceable_elements"] += 1
                    report["traceability_paths"][element.id] = path
                else:
                    report["untraceable_elements"].append(element.id)

                    # Check if completely orphaned (no upward refs at all)
                    upward_refs = self._find_upward_references(element)
                    if not upward_refs:
                        report["orphaned_elements"].append(element.id)

        # Calculate percentage
        if report["total_elements"] > 0:
            report["traceability_percentage"] = (
                report["traceable_elements"] / report["total_elements"] * 100
            )
        else:
            report["traceability_percentage"] = 0.0

        return report
