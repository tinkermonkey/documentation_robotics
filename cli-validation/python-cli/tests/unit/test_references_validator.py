"""Unit tests for ReferenceValidator."""

from documentation_robotics.core.element import Element
from documentation_robotics.validators.references import ReferenceValidator


class TestReferenceValidator:
    """Tests for ReferenceValidator."""

    def test_validator_creation(self, initialized_model):
        """Test creating validator with model."""
        validator = ReferenceValidator(initialized_model)

        assert validator.model == initialized_model

    def test_validate_model_with_no_references(self, initialized_model):
        """Test validating model with no cross-references."""
        # Add element without references
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "Test Service",
            },
        )
        initialized_model.add_element("business", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert result.is_valid()
        assert len(result.errors) == 0

    def test_validate_model_with_valid_reference(self, initialized_model):
        """Test validating model with valid cross-reference."""
        # Add first element
        service1 = Element(
            id="business.service.service1",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.service1",
                "name": "Service 1",
            },
        )
        initialized_model.add_element("business", service1)

        # Add second element that references first
        service2 = Element(
            id="application.service.service2",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.service2",
                "name": "Service 2",
                "realizes": "business.service.service1",
            },
        )
        initialized_model.add_element("application", service2)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert result.is_valid()
        assert len(result.errors) == 0

    def test_validate_model_with_invalid_reference(self, initialized_model):
        """Test validating model with invalid cross-reference."""
        # Add element with invalid reference
        element = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test Service",
                "realizes": "business.service.nonexistent",  # Invalid
            },
        )
        initialized_model.add_element("application", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "nonexistent" in result.errors[0].message
        assert "does not exist" in result.errors[0].message
        assert result.errors[0].layer == "application"
        assert result.errors[0].element_id == "application.service.test"

    def test_validate_provides_suggestions_for_similar_ids(self, initialized_model):
        """Test that validator suggests similar valid IDs."""
        # Add some services
        for i in range(3):
            service = Element(
                id=f"business.service.service-{i}",
                element_type="service",
                layer="business",
                data={
                    "id": f"business.service.service-{i}",
                    "name": f"Service {i}",
                },
            )
            initialized_model.add_element("business", service)

        # Add element with typo in reference
        element = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test",
                "realizes": "business.service.servise-1",  # Typo
            },
        )
        initialized_model.add_element("application", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert result.errors[0].fix_suggestion is not None
        assert "Did you mean" in result.errors[0].fix_suggestion

    def test_validate_with_list_of_references(self, initialized_model):
        """Test validating element with list of references."""
        # Add target elements
        service1 = Element(
            id="data_model.entity.customer",
            element_type="entity",
            layer="data_model",
            data={"id": "data_model.entity.customer", "name": "Customer"},
        )
        service2 = Element(
            id="data_model.entity.order",
            element_type="entity",
            layer="data_model",
            data={"id": "data_model.entity.order", "name": "Order"},
        )
        initialized_model.add_element("data_model", service1)
        initialized_model.add_element("data_model", service2)

        # Add element with list of references
        element = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test",
                "accesses": [
                    "data_model.entity.customer",
                    "data_model.entity.order",
                ],
            },
        )
        initialized_model.add_element("application", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert result.is_valid()

    def test_validate_with_list_containing_invalid_reference(self, initialized_model):
        """Test validating element with list containing invalid reference."""
        # Add one valid target
        service1 = Element(
            id="data_model.entity.customer",
            element_type="entity",
            layer="data_model",
            data={"id": "data_model.entity.customer", "name": "Customer"},
        )
        initialized_model.add_element("data_model", service1)

        # Add element with mixed valid/invalid references
        element = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test",
                "accesses": [
                    "data_model.entity.customer",  # Valid
                    "data_model.entity.nonexistent",  # Invalid
                ],
            },
        )
        initialized_model.add_element("application", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "nonexistent" in result.errors[0].message

    def test_validate_extracts_references_from_nested_data(self, initialized_model):
        """Test that validator finds references in nested structures."""
        # Add target
        target = Element(
            id="business.service.target",
            element_type="service",
            layer="business",
            data={"id": "business.service.target", "name": "Target"},
        )
        initialized_model.add_element("business", target)

        # Add element with nested reference
        element = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test",
                "details": {"realizes": "business.service.target"},
            },
        )
        initialized_model.add_element("application", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert result.is_valid()

    def test_validate_recognizes_reference_field_suffixes(self, initialized_model):
        """Test that validator recognizes _ref and _id field suffixes."""
        # Add target
        target = Element(
            id="application.component.auth",
            element_type="component",
            layer="application",
            data={"id": "application.component.auth", "name": "Auth"},
        )
        initialized_model.add_element("application", target)

        # Add element with _ref field
        element = Element(
            id="api.operation.login",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.login",
                "name": "Login",
                "component_ref": "application.component.auth",
            },
        )
        initialized_model.add_element("api", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert result.is_valid()

    def test_validate_ignores_strings_without_dots(self, initialized_model):
        """Test that validator ignores simple strings without dots."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "Test Service",
                "status": "active",  # Should not be treated as reference
                "type": "service",  # Should not be treated as reference
            },
        )
        initialized_model.add_element("business", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert result.is_valid()

    def test_validate_ignores_strings_without_known_layer(self, initialized_model):
        """Test that validator ignores IDs with unknown layers."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "Test",
                "external_ref": "external.system.api",  # Unknown layer
            },
        )
        initialized_model.add_element("business", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        # Should be valid because "external" is not a known layer
        assert result.is_valid()

    def test_validate_multiple_elements_with_errors(self, initialized_model):
        """Test validating multiple elements with reference errors."""
        # Add two elements with invalid references
        element1 = Element(
            id="application.service.service1",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.service1",
                "name": "Service 1",
                "realizes": "business.service.missing1",
            },
        )
        element2 = Element(
            id="application.service.service2",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.service2",
                "name": "Service 2",
                "realizes": "business.service.missing2",
            },
        )
        initialized_model.add_element("application", element1)
        initialized_model.add_element("application", element2)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert not result.is_valid()
        assert len(result.errors) == 2

    def test_validate_common_reference_field_names(self, initialized_model):
        """Test that common reference field names are recognized."""
        # Add target elements
        target = Element(
            id="business.service.target",
            element_type="service",
            layer="business",
            data={"id": "business.service.target", "name": "Target"},
        )
        initialized_model.add_element("business", target)

        # Test various reference field names
        reference_fields = [
            "realizes",
            "serves",
            "accesses",
            "flows_to",
            "depends_on",
            "triggers",
        ]

        for field_name in reference_fields:
            element = Element(
                id=f"application.service.test-{field_name}",
                element_type="service",
                layer="application",
                data={
                    "id": f"application.service.test-{field_name}",
                    "name": f"Test {field_name}",
                    field_name: "business.service.target",
                },
            )
            initialized_model.add_element("application", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        assert result.is_valid()

    def test_find_similar_ids_matches_layer_and_type(self, initialized_model):
        """Test that similar ID suggestions match layer and type."""
        # Add several services in same layer
        for i in range(5):
            service = Element(
                id=f"business.service.service-{i}",
                element_type="service",
                layer="business",
                data={
                    "id": f"business.service.service-{i}",
                    "name": f"Service {i}",
                },
            )
            initialized_model.add_element("business", service)

        # Add element in different layer
        other = Element(
            id="application.service.other",
            element_type="service",
            layer="application",
            data={"id": "application.service.other", "name": "Other"},
        )
        initialized_model.add_element("application", other)

        # Reference wrong service
        element = Element(
            id="application.service.test",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.test",
                "name": "Test",
                "realizes": "business.service.wrong",
            },
        )
        initialized_model.add_element("application", element)

        validator = ReferenceValidator(initialized_model)
        result = validator.validate()

        # Should suggest business.service.* but not application.service.other
        assert not result.is_valid()
        fix_msg = result.errors[0].fix_suggestion
        assert "business.service" in fix_msg
        assert "application.service.other" not in fix_msg
