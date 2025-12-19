"""
Semantic validator - validates semantic correctness of model.
"""

from pathlib import Path
from typing import Any, List, Optional

from .base import BaseValidator, ValidationResult
from .relationship_validator import RelationshipValidator


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
                element.layer,
                message="Business service is not realized by any application service",
                element_id=element.id,
            )

        return result


class APIOperationApplicationServiceRule(SemanticRule):
    """API operations should reference application services."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "api" or element.type != "operation":
            return result

        # Check for application service reference
        app_service_ref = element.get("x-application-service") or element.get(
            "applicationServiceRef"
        )

        if not app_service_ref:
            result.add_warning(
                element.layer,
                message="API operation does not reference an application service",
                element_id=element.id,
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
                element.layer,
                message="UX screen does not reference any API operations",
                element_id=element.id,
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
                element.layer,
                message="Security resource does not reference any application element",
                element_id=element.id,
            )

        return result


class DataFlowConsistencyRule(SemanticRule):
    """Data model entities should be accessed by services that use them."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "data_model" or element.type not in ["schema", "entity"]:
            return result

        # Check if any datastore tables implement this schema
        datastore_layer = model.get_layer("datastore")
        if datastore_layer:
            implementing_tables = []
            for db_element in datastore_layer.elements.values():
                if db_element.type == "table":
                    schema_ref = db_element.get("x-json-schema") or db_element.get("implements")
                    if schema_ref == element.id:
                        implementing_tables.append(db_element)

            if not implementing_tables:
                result.add_warning(
                    element.layer,
                    message="Data model schema is not implemented by any datastore table",
                    element_id=element.id,
                )

        return result


class TechnologyStackAlignmentRule(SemanticRule):
    """Technology nodes should host application components."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "technology" or element.type not in ["node", "device"]:
            return result

        # Check if any application components are deployed to this node
        app_layer = model.get_layer("application")
        if app_layer:
            hosted_components = []
            for app_element in app_layer.elements.values():
                if app_element.type == "component":
                    deployed_to = app_element.get("deployedTo") or app_element.get("hostedOn")
                    if deployed_to == element.id or (
                        isinstance(deployed_to, list) and element.id in deployed_to
                    ):
                        hosted_components.append(app_element)

            if not hosted_components:
                result.add_warning(
                    element.layer,
                    message="Technology node does not host any application components",
                    element_id=element.id,
                )

        return result


class NavigationCompletenessRule(SemanticRule):
    """All UX screens should have corresponding navigation routes."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "ux" or element.type not in ["screen", "view", "component"]:
            return result

        # Check if navigation layer has a route for this screen
        nav_layer = model.get_layer("navigation")
        if nav_layer:
            has_route = False
            for nav_element in nav_layer.elements.values():
                if nav_element.type == "route":
                    ux_ref = nav_element.get("uxRef") or nav_element.get("component")
                    if ux_ref == element.id:
                        has_route = True
                        break

            if not has_route and element.type in ["screen", "view"]:
                result.add_warning(
                    element.layer,
                    message="UX screen lacks corresponding navigation route",
                    element_id=element.id,
                )

        return result


class APMCoverageRule(SemanticRule):
    """Critical services should have observability traces."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        # Check application services marked as critical
        if element.layer == "application" and element.type == "service":
            is_critical = element.get("critical", False) or element.get("importance") == "high"

            if is_critical:
                # Check if APM layer has traces for this service
                apm_layer = model.get_layer("apm")
                if apm_layer:
                    has_traces = False
                    for apm_element in apm_layer.elements.values():
                        if apm_element.type in ["trace", "span"]:
                            service_ref = apm_element.get("serviceRef") or apm_element.get(
                                "instruments"
                            )
                            if service_ref == element.id or (
                                isinstance(service_ref, list) and element.id in service_ref
                            ):
                                has_traces = True
                                break

                    if not has_traces:
                        result.add_warning(
                            element.layer,
                            message="Critical service lacks APM observability traces",
                            element_id=element.id,
                        )

        return result


class StakeholderCoverageRule(SemanticRule):
    """Business goals should have assigned stakeholders."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "motivation" or element.type != "goal":
            return result

        # Check if goal has stakeholder reference
        stakeholder_ref = (
            element.get("stakeholder") or element.get("owner") or element.get("stakeholders")
        )

        if not stakeholder_ref:
            result.add_warning(
                element.layer,
                message="Goal lacks assigned stakeholder or owner",
                element_id=element.id,
            )

        return result


class DeploymentMappingRule(SemanticRule):
    """Application components should be deployed to technology nodes."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "application" or element.type != "component":
            return result

        # Check if component has deployment mapping
        deployed_to = element.get("deployedTo") or element.get("hostedOn") or element.get("runsOn")

        if not deployed_to:
            result.add_warning(
                element.layer,
                message="Application component lacks deployment mapping to technology layer",
                element_id=element.id,
            )

        return result


class DataStoreIntegrityRule(SemanticRule):
    """Database tables should have primary keys and proper relationships."""

    def validate(self, model: Any, element: Any) -> ValidationResult:
        result = ValidationResult()

        if element.layer != "datastore" or element.type != "table":
            return result

        # Check for primary key
        columns = element.get("columns", [])
        has_primary_key = False

        for column in columns:
            if isinstance(column, dict):
                if column.get("primaryKey") or column.get("isPrimaryKey"):
                    has_primary_key = True
                    break

        # Also check constraints
        constraints = element.get("constraints", [])
        for constraint in constraints:
            if isinstance(constraint, dict) and constraint.get("type") == "PRIMARY KEY":
                has_primary_key = True
                break

        if not has_primary_key:
            result.add_warning(
                element.layer,
                message="Database table lacks primary key definition",
                element_id=element.id,
            )

        return result


class SemanticValidator(BaseValidator):
    """
    Validates semantic correctness of the model.

    Checks that relationships between layers make sense semantically.
    """

    def __init__(self, model: Any, schema_dir: Optional[Path] = None):
        """
        Initialize semantic validator.

        Args:
            model: The architecture model
            schema_dir: Optional directory containing layer schemas
        """
        self.model = model
        self.schema_dir = schema_dir
        self.relationship_validator = RelationshipValidator(schema_dir) if schema_dir else None
        self.rules: List[SemanticRule] = [
            # Original 4 rules
            BusinessServiceRealizationRule(),
            APIOperationApplicationServiceRule(),
            UXScreenAPIOperationRule(),
            SecurityResourceApplicationElementRule(),
            # New rules (Phase 2.3)
            DataFlowConsistencyRule(),
            TechnologyStackAlignmentRule(),
            NavigationCompletenessRule(),
            APMCoverageRule(),
            StakeholderCoverageRule(),
            DeploymentMappingRule(),
            DataStoreIntegrityRule(),
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

        # Validate relationships if schema_dir is provided
        if self.relationship_validator and self.schema_dir:
            relationship_result = self._validate_relationships()
            result.merge(relationship_result)

        return result

    def _validate_relationships(self) -> ValidationResult:
        """Validate intra-layer and cross-layer relationships.

        Returns:
            ValidationResult with relationship validation errors
        """
        result = ValidationResult()

        # This is a placeholder for now - full implementation would:
        # 1. Iterate through all elements
        # 2. Extract relationship properties
        # 3. Validate against layer schema using relationship_validator
        # 4. Add errors/warnings to result

        return result
