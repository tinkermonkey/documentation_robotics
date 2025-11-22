"""Unit tests for SemanticValidator."""
import pytest
from documentation_robotics.validators.semantic import (
    SemanticValidator,
    BusinessServiceRealizationRule,
    APIOperationApplicationServiceRule,
    UXScreenAPIOperationRule,
    SecurityResourceApplicationElementRule
)
from documentation_robotics.core.element import Element


class TestBusinessServiceRealizationRule:
    """Tests for BusinessServiceRealizationRule."""

    def test_business_service_with_realization(self, initialized_model):
        """Test business service with proper realization."""
        # Add business service
        biz_service = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"}
        )
        initialized_model.add_element("business", biz_service)

        # Add application service that realizes it
        app_service = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "name": "Test App Service",
                "realizes": "business.service.test"
            }
        )
        initialized_model.add_element("application", app_service)

        rule = BusinessServiceRealizationRule()
        result = rule.validate(initialized_model, biz_service)

        assert result.is_valid()
        assert len(result.warnings) == 0

    def test_business_service_without_realization(self, initialized_model):
        """Test business service without realization."""
        biz_service = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"}
        )
        initialized_model.add_element("business", biz_service)

        rule = BusinessServiceRealizationRule()
        result = rule.validate(initialized_model, biz_service)

        # Should have warning
        assert len(result.warnings) == 1
        assert "not realized" in result.warnings[0].message.lower()

    def test_non_service_element(self, initialized_model):
        """Test rule on non-service element."""
        element = Element(
            id="business.actor.test",
            element_type="actor",
            layer="business",
            data={"name": "Test Actor"}
        )

        rule = BusinessServiceRealizationRule()
        result = rule.validate(initialized_model, element)

        # Should not apply to non-service
        assert len(result.warnings) == 0


class TestAPIOperationApplicationServiceRule:
    """Tests for APIOperationApplicationServiceRule."""

    def test_api_operation_with_service_ref(self, initialized_model):
        """Test API operation with service reference."""
        api_op = Element(
            id="api.operation.test",
            element_type="operation",
            layer="api",
            data={
                "name": "Test Operation",
                "applicationServiceRef": "application.service.test"
            }
        )

        rule = APIOperationApplicationServiceRule()
        result = rule.validate(initialized_model, api_op)

        assert result.is_valid()
        assert len(result.warnings) == 0

    def test_api_operation_without_service_ref(self, initialized_model):
        """Test API operation without service reference."""
        api_op = Element(
            id="api.operation.test",
            element_type="operation",
            layer="api",
            data={"name": "Test Operation"}
        )

        rule = APIOperationApplicationServiceRule()
        result = rule.validate(initialized_model, api_op)

        # Should have warning
        assert len(result.warnings) == 1
        assert "does not reference" in result.warnings[0].message.lower()


class TestUXScreenAPIOperationRule:
    """Tests for UXScreenAPIOperationRule."""

    def test_ux_screen_with_api_refs(self, initialized_model):
        """Test UX screen with API operation references."""
        ux_screen = Element(
            id="ux.screen.test",
            element_type="screen",
            layer="ux",
            data={
                "name": "Test Screen",
                "states": [{
                    "name": "loading",
                    "actions": [
                        {"operationId": "api.operation.get-data"}
                    ]
                }]
            }
        )

        rule = UXScreenAPIOperationRule()
        result = rule.validate(initialized_model, ux_screen)

        assert result.is_valid()
        assert len(result.warnings) == 0

    def test_ux_screen_without_api_refs(self, initialized_model):
        """Test UX screen without API operation references."""
        ux_screen = Element(
            id="ux.screen.test",
            element_type="screen",
            layer="ux",
            data={
                "name": "Test Screen",
                "states": []
            }
        )

        rule = UXScreenAPIOperationRule()
        result = rule.validate(initialized_model, ux_screen)

        # Should have warning
        assert len(result.warnings) == 1


class TestSecurityResourceApplicationElementRule:
    """Tests for SecurityResourceApplicationElementRule."""

    def test_security_resource_with_ref(self, initialized_model):
        """Test security resource with archimate reference."""
        security_res = Element(
            id="security.resource.test",
            element_type="resource",
            layer="security",
            data={
                "name": "Test Resource",
                "archimateRef": "application.service.test"
            }
        )

        rule = SecurityResourceApplicationElementRule()
        result = rule.validate(initialized_model, security_res)

        assert result.is_valid()
        assert len(result.warnings) == 0

    def test_security_resource_without_ref(self, initialized_model):
        """Test security resource without reference."""
        security_res = Element(
            id="security.resource.test",
            element_type="resource",
            layer="security",
            data={"name": "Test Resource"}
        )

        rule = SecurityResourceApplicationElementRule()
        result = rule.validate(initialized_model, security_res)

        # Should have warning
        assert len(result.warnings) == 1


class TestSemanticValidator:
    """Tests for SemanticValidator."""

    def test_validator_creation(self, initialized_model):
        """Test creating semantic validator."""
        validator = SemanticValidator(initialized_model)

        assert validator.model == initialized_model
        assert len(validator.rules) == 4

    def test_validate_empty_model(self, initialized_model):
        """Test validating empty model."""
        validator = SemanticValidator(initialized_model)
        result = validator.validate()

        # Empty model should pass
        assert result.is_valid()

    def test_validate_model_with_issues(self, initialized_model):
        """Test validating model with semantic issues."""
        # Add business service without realization
        biz_service = Element(
            id="business.service.orphan",
            element_type="service",
            layer="business",
            data={"name": "Orphan Service"}
        )
        initialized_model.add_element("business", biz_service)

        validator = SemanticValidator(initialized_model)
        result = validator.validate()

        # Should have warnings
        assert len(result.warnings) > 0

    def test_validate_applies_all_rules(self, initialized_model):
        """Test that all rules are applied."""
        # Add elements that trigger multiple rules

        # Business service without realization
        biz_service = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"}
        )
        initialized_model.add_element("business", biz_service)

        # API operation without service ref
        api_op = Element(
            id="api.operation.test",
            element_type="operation",
            layer="api",
            data={"name": "Test Operation"}
        )
        initialized_model.add_element("api", api_op)

        validator = SemanticValidator(initialized_model)
        result = validator.validate()

        # Should have multiple warnings
        assert len(result.warnings) >= 2
