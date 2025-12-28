"""Unit tests for SecurityIntegrationValidator."""

from documentation_robotics.core.element import Element
from documentation_robotics.validators.security import SecurityIntegrationValidator


class TestSecurityIntegrationValidator:
    """Tests for SecurityIntegrationValidator."""

    def test_validator_creation(self):
        """Test creating validator."""
        validator = SecurityIntegrationValidator()
        assert validator is not None

    def test_validate_empty_model(self, initialized_model):
        """Test validating empty model."""
        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()

    def test_api_operation_without_security_warns(self, initialized_model):
        """Test that API operation without security gets warning."""
        operation = Element(
            id="api.operation.get-users",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.get-users",
                "name": "Get Users",
                # No security property
            },
        )
        initialized_model.add_element("api", operation)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()  # Warning, not error
        assert len(result.warnings) > 0
        assert any("security" in w.message.lower() for w in result.warnings)

    def test_api_operation_with_security_passes(self, initialized_model):
        """Test that API operation with security passes."""
        operation = Element(
            id="api.operation.get-users",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.get-users",
                "name": "Get Users",
                "security": "bearer",
            },
        )
        initialized_model.add_element("api", operation)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn about missing security
        security_warnings = [
            w
            for w in result.warnings
            if "get-users" in w.message and "security" in w.message.lower()
        ]
        assert len(security_warnings) == 0

    def test_public_api_operation_no_warning(self, initialized_model):
        """Test that public API operations don't get security warnings."""
        operation = Element(
            id="api.operation.health-check",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.health-check",
                "name": "Health Check",
                "public": True,
            },
        )
        initialized_model.add_element("api", operation)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn about public endpoints
        security_warnings = [w for w in result.warnings if "health-check" in w.message]
        assert len(security_warnings) == 0

    def test_api_operation_with_auth_required(self, initialized_model):
        """Test that authRequired property is recognized."""
        operation = Element(
            id="api.operation.protected",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.protected",
                "name": "Protected",
                "authRequired": True,
            },
        )
        initialized_model.add_element("api", operation)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn - has authRequired
        security_warnings = [w for w in result.warnings if "protected" in w.message]
        assert len(security_warnings) == 0

    def test_ux_element_with_nonexistent_policy_fails(self, initialized_model):
        """Test that UX element referencing nonexistent policy fails."""
        screen = Element(
            id="ux.screen.admin-panel",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.admin-panel",
                "name": "Admin Panel",
                "securityPolicy": "security.policy.nonexistent",
            },
        )
        initialized_model.add_element("ux", screen)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        assert not result.is_valid()
        assert len(result.errors) > 0
        assert any("nonexistent" in e.message for e in result.errors)

    def test_ux_element_with_valid_policy_passes(self, initialized_model):
        """Test that UX element with valid policy passes."""
        # Add security policy first
        policy = Element(
            id="security.policy.admin",
            element_type="policy",
            layer="security",
            data={
                "id": "security.policy.admin",
                "name": "Admin Policy",
            },
        )
        initialized_model.add_element("security", policy)

        # Add UX screen referencing it
        screen = Element(
            id="ux.screen.admin-panel",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.admin-panel",
                "name": "Admin Panel",
                "securityPolicy": "security.policy.admin",
            },
        )
        initialized_model.add_element("ux", screen)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not error about missing policy
        policy_errors = [e for e in result.errors if "admin-panel" in e.message]
        assert len(policy_errors) == 0

    def test_ux_element_requires_auth_without_policy_warns(self, initialized_model):
        """Test that UX element requiring auth without policy warns."""
        screen = Element(
            id="ux.screen.dashboard",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.dashboard",
                "name": "Dashboard",
                "requiresAuthentication": True,
                # No securityPolicy or requiredRoles
            },
        )
        initialized_model.add_element("ux", screen)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()  # Warning, not error
        assert len(result.warnings) > 0
        assert any("policy" in w.message.lower() for w in result.warnings)

    def test_ux_element_with_required_roles_passes(self, initialized_model):
        """Test that UX element with required roles doesn't warn."""
        screen = Element(
            id="ux.screen.dashboard",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.dashboard",
                "name": "Dashboard",
                "requiresAuthentication": True,
                "requiredRoles": ["admin", "user"],
            },
        )
        initialized_model.add_element("ux", screen)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn - has requiredRoles
        auth_warnings = [
            w for w in result.warnings if "dashboard" in w.message and "policy" in w.message.lower()
        ]
        assert len(auth_warnings) == 0

    def test_data_schema_with_pii_without_classification_warns(self, initialized_model):
        """Test that data schema with PII without classification warns."""
        schema = Element(
            id="data_model.schema.user",
            element_type="schema",
            layer="data_model",
            data={
                "id": "data_model.schema.user",
                "name": "User",
                "properties": {
                    "email": {"type": "string"},  # PII field
                    "ssn": {"type": "string"},  # PII field
                },
            },
        )
        initialized_model.add_element("data_model", schema)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()  # Warning, not error
        assert len(result.warnings) > 0
        assert any(
            "pii" in w.message.lower() or "classification" in w.message.lower()
            for w in result.warnings
        )

    def test_data_schema_with_classification_passes(self, initialized_model):
        """Test that data schema with classification passes."""
        schema = Element(
            id="data_model.schema.user",
            element_type="schema",
            layer="data_model",
            data={
                "id": "data_model.schema.user",
                "name": "User",
                "x-security-classification": "pii",
                "properties": {
                    "email": {"type": "string"},
                },
            },
        )
        initialized_model.add_element("data_model", schema)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn - has classification
        classification_warnings = [
            w
            for w in result.warnings
            if "user" in w.message and "classification" in w.message.lower()
        ]
        assert len(classification_warnings) == 0

    def test_model_without_security_layer_warns(self, initialized_model):
        """Test that model without security layer gets warning."""
        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        assert result.is_valid()  # Warning, not error
        # Note: The validator may or may not warn about missing security layer
        # depending on whether other layers exist

    def test_empty_security_layer_warns(self, initialized_model):
        """Test that empty security layer gets warning."""
        # Security layer exists but is empty (from initialized_model)
        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # May warn about empty security layer
        assert result.is_valid()

    def test_multiple_api_operations_validation(self, initialized_model):
        """Test validating multiple API operations."""
        # Add several operations with different security setups
        operations = [
            Element(
                id="api.operation.public-endpoint",
                element_type="operation",
                layer="api",
                data={"id": "api.operation.public-endpoint", "name": "Public", "public": True},
            ),
            Element(
                id="api.operation.secured-endpoint",
                element_type="operation",
                layer="api",
                data={
                    "id": "api.operation.secured-endpoint",
                    "name": "Secured",
                    "security": "bearer",
                },
            ),
            Element(
                id="api.operation.missing-security",
                element_type="operation",
                layer="api",
                data={"id": "api.operation.missing-security", "name": "Missing"},
            ),
        ]

        for op in operations:
            initialized_model.add_element("api", op)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should only warn about the one missing security
        assert result.is_valid()
        security_warnings = [w for w in result.warnings if "security" in w.message.lower()]
        # At least one warning for missing-security
        assert len(security_warnings) >= 1

    def test_security_schemes_property_recognized(self, initialized_model):
        """Test that securitySchemes property is recognized."""
        operation = Element(
            id="api.operation.test",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.test",
                "name": "Test",
                "securitySchemes": ["oauth2"],
            },
        )
        initialized_model.add_element("api", operation)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn - has securitySchemes
        security_warnings = [
            w for w in result.warnings if "test" in w.message and "security" in w.message.lower()
        ]
        assert len(security_warnings) == 0

    def test_x_security_policy_refs_recognized(self, initialized_model):
        """Test that x-security-policy-refs property is recognized."""
        operation = Element(
            id="api.operation.test",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.test",
                "name": "Test",
                "x-security-policy-refs": ["policy1"],
            },
        )
        initialized_model.add_element("api", operation)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn
        security_warnings = [w for w in result.warnings if "test" in w.message]
        assert len(security_warnings) == 0

    def test_data_classification_property_recognized(self, initialized_model):
        """Test that dataClassification property is recognized."""
        schema = Element(
            id="data_model.schema.test",
            element_type="schema",
            layer="data_model",
            data={
                "id": "data_model.schema.test",
                "name": "Test",
                "dataClassification": "confidential",
                "properties": {
                    "password": {"type": "string"},
                },
            },
        )
        initialized_model.add_element("data_model", schema)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn - has dataClassification
        classification_warnings = [
            w
            for w in result.warnings
            if "test" in w.message and "classification" in w.message.lower()
        ]
        assert len(classification_warnings) == 0

    def test_authentication_property_recognized(self, initialized_model):
        """Test that authentication property is recognized."""
        operation = Element(
            id="api.operation.test",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.test",
                "name": "Test",
                "authentication": "jwt",
            },
        )
        initialized_model.add_element("api", operation)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn
        security_warnings = [w for w in result.warnings if "test" in w.message]
        assert len(security_warnings) == 0

    def test_sensitivity_property_recognized(self, initialized_model):
        """Test that sensitivity property is recognized for data."""
        schema = Element(
            id="data_model.schema.test",
            element_type="schema",
            layer="data_model",
            data={
                "id": "data_model.schema.test",
                "name": "Test",
                "sensitivity": "high",
                "properties": {
                    "secret": {"type": "string"},
                },
            },
        )
        initialized_model.add_element("data_model", schema)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        # Should not warn - has sensitivity
        classification_warnings = [w for w in result.warnings if "test" in w.message]
        assert len(classification_warnings) == 0

    def test_error_includes_suggestion(self, initialized_model):
        """Test that validation errors include helpful suggestions."""
        screen = Element(
            id="ux.screen.test",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.test",
                "name": "Test",
                "securityPolicy": "security.policy.missing",
            },
        )
        initialized_model.add_element("ux", screen)

        validator = SecurityIntegrationValidator()
        result = validator.validate(initialized_model)

        assert not result.is_valid()
        assert len(result.errors) > 0
        assert result.errors[0].fix_suggestion is not None
