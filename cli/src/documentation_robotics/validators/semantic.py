"""
Semantic validator - validates semantic correctness of model.
"""
from typing import List, Dict, Set, Any
from .base import BaseValidator, ValidationResult


class SemanticRule:
    """Base class for semantic validation rules."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        """Validate element. Must be implemented by subclasses."""
        raise NotImplementedError


class BusinessServiceRealizationRule(SemanticRule):
    """Business services should be realized by application services."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "business" or element.type != "service":
            return result

        # Find application services that realize this business service
        app_layer = model.get_layer("application")
        if not app_layer:
            return result

        realizing_services = []
        for app_element in app_layer.elements.values():
            realizes = app_element.get("realizes")
            if realizes == element.id or (isinstance(realizes, list) and element.id in realizes):
                realizing_services.append(app_element)

        if not realizing_services:
            result.add_warning(
                layer=element.layer,
                element_id=element.id,
                message="Business service is not realized by any application service"
            )

        return result


class APIOperationApplicationServiceRule(SemanticRule):
    """API operations should reference application services."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "api" or element.type != "operation":
            return result

        # Check for application service reference
        app_service_ref = element.get("x-application-service") or element.get("applicationServiceRef")

        if not app_service_ref:
            result.add_warning(
                layer=element.layer,
                element_id=element.id,
                message="API operation does not reference an application service"
            )

        return result


class UXScreenAPIOperationRule(SemanticRule):
    """UX screens should reference API operations."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "ux" or element.type not in ["screen", "state"]:
            return result

        # Check for API operation references in actions
        has_api_refs = False

        states = element.get("states", [])
        for state in states:
            if isinstance(state, dict):
                actions = state.get("actions", [])
                for action in actions:
                    if isinstance(action, dict) and "operationId" in action:
                        has_api_refs = True
                        break

        if not has_api_refs:
            result.add_warning(
                layer=element.layer,
                element_id=element.id,
                message="UX screen does not reference any API operations"
            )

        return result


class SecurityResourceApplicationElementRule(SemanticRule):
    """Security resources should reference application elements."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "security" or element.type != "resource":
            return result

        # Check for archimateRef
        archimate_ref = element.get("archimateRef")

        if not archimate_ref:
            result.add_warning(
                layer=element.layer,
                element_id=element.id,
                message="Security resource does not reference any application element"
            )

        return result


class SemanticValidator(BaseValidator):
    """
    Validates semantic correctness of the model.

    Checks that relationships between layers make sense semantically.
    """

    def __init__(self, model: Any):
        """
        Initialize semantic validator.

        Args:
            model: The architecture model
        """
        self.model = model
        self.rules: List[SemanticRule] = [
            BusinessServiceRealizationRule(),
            APIOperationApplicationServiceRule(),
            UXScreenAPIOperationRule(),
            SecurityResourceApplicationElementRule(),
        ]

    def validate(self) -> ValidationResult:
        """
        Validate semantic correctness.

        Returns:
            ValidationResult
        """
        result = ValidationResult()

        # Apply all rules to all elements
        for layer in self.model.layers.values():
            for element in layer.elements.values():
                for rule in self.rules:
                    rule_result = rule.validate(self.model, element)
                    result.merge(rule_result)

        return result
