"""
Security integration validation for cross-layer security enforcement.

This validator ensures that security policies defined in Layer 03 (Security)
are properly integrated and enforced across other layers:
- API operations reference security schemes (Layer 06)
- UX components enforce security policies (Layer 09)
- Data schemas have security classifications (Layer 07)
- Resources are properly protected

Spec Requirement: Security must be a cross-cutting concern integrated
across API, Data, and UX layers.
"""

import logging
from typing import Dict, Set

from ..core.element import Element
from ..core.model import Model
from .base import BaseValidator, ValidationError, ValidationResult, ValidationWarning

logger = logging.getLogger(__name__)


class SecurityIntegrationValidator(BaseValidator):
    """
    Validates security integration across layers.

    Checks that:
    1. Public API operations have authentication schemes
    2. Protected resources reference security policies
    3. Sensitive data has security classifications
    4. Security controls map to threats
    """

    def validate(self, model: Model) -> ValidationResult:
        """
        Validate security integration across all layers.

        Args:
            model: The model to validate

        Returns:
            ValidationResult with errors and warnings
        """
        result = ValidationResult()

        # Get security layer elements
        security_policies = self._get_security_policies(model)
        # security_roles = self._get_security_roles(model)

        # Validate API layer security
        if "api" in model.list_layers():
            self._validate_api_security(model, security_policies, result)

        # Validate UX layer security
        if "ux" in model.list_layers():
            self._validate_ux_security(model, security_policies, result)

        # Validate data model security
        if "data_model" in model.list_layers():
            self._validate_data_security(model, result)

        # Validate security layer completeness
        self._validate_security_layer(model, result)

        return result

    def _get_security_policies(self, model: Model) -> Set[str]:
        """Get all security policy IDs from the security layer."""
        policies = set()

        if "security" not in model.list_layers():
            return policies

        security_layer = model.get_layer("security")

        for element in security_layer.list_elements():
            if element.type in ["policy", "security-policy"]:
                policies.add(element.id)

        return policies

    def _get_security_roles(self, model: Model) -> Set[str]:
        """Get all security role IDs from the security layer."""
        roles = set()

        if "security" not in model.list_layers():
            return roles

        security_layer = model.get_layer("security")

        for element in security_layer.list_elements():
            if element.type == "role":
                roles.add(element.id)

        return roles

    def _validate_api_security(
        self, model: Model, security_policies: Set[str], result: ValidationResult
    ) -> None:
        """
        Validate that API operations have proper security.

        Args:
            model: The model
            security_policies: Set of security policy IDs
            result: ValidationResult to add issues to
        """
        api_layer = model.get_layer("api")

        for element in api_layer.list_elements():
            if element.type not in ["operation", "endpoint"]:
                continue

            # Check for security scheme reference
            has_security = False
            security_props = [
                "security",
                "securitySchemes",
                "x-security-policy-refs",
                "authRequired",
                "authentication",
            ]

            for prop in security_props:
                if self._has_property(element, prop):
                    has_security = True
                    break

            if not has_security:
                # Check if this is a public endpoint
                is_public = (
                    self._has_property(element, "public") and element.data.get("public") is True
                )

                if not is_public:
                    result.add_warning(
                        ValidationWarning(
                            message=(
                                f"API operation '{element.id}' lacks security scheme. "
                                "Public API operations should define authentication requirements."
                            ),
                            element_id=element.id,
                            layer="api",
                            property_path="security",
                            suggestion="Add 'security' or 'x-security-policy-refs' property",
                        )
                    )

    def _validate_ux_security(
        self, model: Model, security_policies: Set[str], result: ValidationResult
    ) -> None:
        """
        Validate that UX components enforce security policies.

        Args:
            model: The model
            security_policies: Set of security policy IDs
            result: ValidationResult to add issues to
        """
        ux_layer = model.get_layer("ux")

        for element in ux_layer.list_elements():
            # Check for authenticated/protected screens
            is_protected = False
            requires_auth = False

            # Check various indicators of protected content
            if self._has_property(element, "requiresAuthentication"):
                requires_auth = element.data.get("requiresAuthentication", False)

            if self._has_property(element, "requiredRoles"):
                is_protected = True

            if self._has_property(element, "securityPolicy"):
                is_protected = True
                # Verify the policy exists
                policy_ref = element.data.get("securityPolicy")
                if policy_ref and policy_ref not in security_policies:
                    result.add_error(
                        ValidationError(
                            message=(
                                f"UX element '{element.id}' references non-existent security policy: {policy_ref}"
                            ),
                            element_id=element.id,
                            layer="ux",
                            property_path="securityPolicy",
                            suggestion=f"Ensure security policy '{policy_ref}' exists in security layer",
                        )
                    )

            # Warn if requires auth but no specific policy
            if requires_auth and not is_protected:
                result.add_warning(
                    ValidationWarning(
                        message=(
                            f"UX element '{element.id}' requires authentication but lacks specific security policy. "
                            "Consider adding role or policy requirements."
                        ),
                        element_id=element.id,
                        layer="ux",
                        property_path="securityPolicy",
                        suggestion="Add 'requiredRoles' or 'securityPolicy' property",
                    )
                )

    def _validate_data_security(self, model: Model, result: ValidationResult) -> None:
        """
        Validate that data schemas have security classifications.

        Args:
            model: The model
            result: ValidationResult to add issues to
        """
        data_layer = model.get_layer("data_model")

        for element in data_layer.list_elements():
            if element.type not in ["schema", "entity"]:
                continue

            # Check for security classification
            has_classification = False
            classification_props = [
                "x-security-classification",
                "securityClassification",
                "dataClassification",
                "sensitivity",
            ]

            for prop in classification_props:
                if self._has_property(element, prop):
                    has_classification = True
                    break

            # Check if contains PII or sensitive data markers
            has_pii_fields = self._check_for_pii_fields(element)

            if has_pii_fields and not has_classification:
                result.add_warning(
                    ValidationWarning(
                        message=(
                            f"Data schema '{element.id}' appears to contain PII/sensitive fields "
                            "but lacks security classification."
                        ),
                        element_id=element.id,
                        layer="data_model",
                        property_path="x-security-classification",
                        suggestion="Add 'x-security-classification' with value like 'pii', 'confidential', 'public'",
                    )
                )

    def _validate_security_layer(self, model: Model, result: ValidationResult) -> None:
        """
        Validate the security layer itself for completeness.

        Args:
            model: The model
            result: ValidationResult to add issues to
        """
        if "security" not in model.list_layers():
            result.add_warning(
                ValidationWarning(
                    message="No security layer found. Security layer (Layer 03) is required for full conformance.",
                    element_id=None,
                    layer="security",
                    suggestion="Create security layer with security policies, roles, and controls",
                )
            )
            return

        security_layer = model.get_layer("security")
        elements = list(security_layer.list_elements())

        if not elements:
            result.add_warning(
                ValidationWarning(
                    message="Security layer is empty. Define security policies, roles, and controls.",
                    element_id=None,
                    layer="security",
                    suggestion="Add security policies, roles, and access controls",
                )
            )

    def _has_property(self, element: Element, property_name: str) -> bool:
        """Check if element has a property (in data or nested properties)."""
        if property_name in element.data:
            return True

        if "properties" in element.data and property_name in element.data["properties"]:
            return True

        if "spec" in element.data and isinstance(element.data["spec"], dict):
            if property_name in element.data["spec"]:
                return True

        return False

    def _check_for_pii_fields(self, element: Element) -> bool:
        """
        Check if a data schema contains fields that might be PII.

        Args:
            element: The data schema element

        Returns:
            True if PII fields detected
        """
        pii_keywords = [
            "email",
            "ssn",
            "social_security",
            "phone",
            "address",
            "credit_card",
            "password",
            "dob",
            "date_of_birth",
            "first_name",
            "last_name",
            "name",
        ]

        # Check properties/fields
        if "properties" in element.data:
            props = element.data["properties"]
            if isinstance(props, dict):
                for field_name in props.keys():
                    field_lower = field_name.lower()
                    if any(keyword in field_lower for keyword in pii_keywords):
                        return True

        # Check if element mentions PII in description
        description = element.data.get("description", "").lower()
        if any(keyword in description for keyword in pii_keywords):
            return True

        return False

    def generate_security_coverage_report(self, model: Model) -> Dict:
        """
        Generate a security coverage report for the model.

        Args:
            model: The model to analyze

        Returns:
            Dictionary with security coverage statistics
        """
        report = {
            "api_operations": {"total": 0, "secured": 0, "unsecured": []},
            "ux_elements": {"total": 0, "protected": 0, "unprotected": []},
            "data_schemas": {"total": 0, "classified": 0, "unclassified": []},
            "security_policies": 0,
            "security_roles": 0,
        }

        # Count security layer elements
        if "security" in model.list_layers():
            security_layer = model.get_layer("security")
            for element in security_layer.list_elements():
                if element.type in ["policy", "security-policy"]:
                    report["security_policies"] += 1
                elif element.type == "role":
                    report["security_roles"] += 1

        # Analyze API operations
        if "api" in model.list_layers():
            api_layer = model.get_layer("api")
            for element in api_layer.list_elements():
                if element.type in ["operation", "endpoint"]:
                    report["api_operations"]["total"] += 1
                    if self._has_property(element, "security") or self._has_property(
                        element, "x-security-policy-refs"
                    ):
                        report["api_operations"]["secured"] += 1
                    else:
                        report["api_operations"]["unsecured"].append(element.id)

        # Analyze UX elements
        if "ux" in model.list_layers():
            ux_layer = model.get_layer("ux")
            for element in ux_layer.list_elements():
                report["ux_elements"]["total"] += 1
                if self._has_property(element, "securityPolicy") or self._has_property(
                    element, "requiredRoles"
                ):
                    report["ux_elements"]["protected"] += 1
                else:
                    report["ux_elements"]["unprotected"].append(element.id)

        # Analyze data schemas
        if "data_model" in model.list_layers():
            data_layer = model.get_layer("data_model")
            for element in data_layer.list_elements():
                report["data_schemas"]["total"] += 1
                if self._has_property(element, "x-security-classification"):
                    report["data_schemas"]["classified"] += 1
                else:
                    report["data_schemas"]["unclassified"].append(element.id)

        # Calculate percentages
        for category in ["api_operations", "ux_elements", "data_schemas"]:
            total = report[category]["total"]
            if total > 0:
                secured_key = (
                    "secured"
                    if category == "api_operations"
                    else ("protected" if category == "ux_elements" else "classified")
                )
                secured = report[category][secured_key]
                report[category]["percentage"] = (secured / total) * 100
            else:
                report[category]["percentage"] = 0.0

        return report
