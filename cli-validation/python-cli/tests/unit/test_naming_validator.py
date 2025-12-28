"""Unit tests for NamingValidator."""

from documentation_robotics.core.element import Element
from documentation_robotics.validators.naming import NamingValidator


class TestNamingValidator:
    """Tests for NamingValidator."""

    def test_validator_creation_default(self):
        """Test creating validator with default format."""
        validator = NamingValidator()

        assert validator.id_format == "{layer}.{type}.{kebab-case-name}"

    def test_validator_creation_custom_format(self):
        """Test creating validator with custom format."""
        custom_format = "{layer}.{type}.{custom-format}"
        validator = NamingValidator(id_format=custom_format)

        assert validator.id_format == custom_format

    def test_validate_element_with_valid_id_and_name(self):
        """Test validating element with valid ID and name."""
        element = Element(
            id="business.service.customer-management",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.customer-management",
                "name": "Customer Management",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert result.is_valid()
        assert len(result.errors) == 0
        assert len(result.warnings) == 0

    def test_validate_element_with_invalid_id_format(self):
        """Test validating element with invalid ID format."""
        element = Element(
            id="InvalidID",  # Wrong format
            element_type="service",
            layer="business",
            data={
                "id": "InvalidID",
                "name": "Test Service",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "doesn't match expected format" in result.errors[0].message
        assert result.errors[0].layer == element.layer
        assert result.errors[0].element_id == element.id
        assert result.errors[0].fix_suggestion is not None

    def test_validate_element_with_uppercase_in_name_part(self):
        """Test validating element with uppercase letters in ID name part."""
        element = Element(
            id="business.service.CustomerManagement",  # Should be kebab-case
            element_type="service",
            layer="business",
            data={
                "id": "business.service.CustomerManagement",
                "name": "Customer Management",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "doesn't match expected format" in result.errors[0].message

    def test_validate_element_with_missing_name(self):
        """Test validating element with missing name."""
        element = Element(
            id="business.service.test-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-service",
                # No name field
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "name is required" in result.errors[0].message
        assert result.errors[0].layer == element.layer
        assert result.errors[0].element_id == element.id

    def test_validate_element_with_empty_name(self):
        """Test validating element with empty name."""
        element = Element(
            id="business.service.test-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-service",
                "name": "",  # Empty name
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "name is required" in result.errors[0].message

    def test_validate_element_with_special_characters_in_name(self):
        """Test validating element with special characters in name."""
        element = Element(
            id="business.service.test-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-service",
                "name": "Test@Service!",  # Contains special characters
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        # Should pass but with warning
        assert result.is_valid()
        assert len(result.warnings) == 1
        assert "special characters" in result.warnings[0].message.lower()
        assert result.warnings[0].layer == element.layer
        assert result.warnings[0].element_id == element.id

    def test_validate_element_with_valid_special_characters(self):
        """Test that hyphens, underscores, and spaces are allowed in names."""
        element = Element(
            id="business.service.test-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-service",
                "name": "Test Service-Name_123",  # Valid characters
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert result.is_valid()
        assert len(result.warnings) == 0

    def test_validate_id_format_with_too_few_parts(self):
        """Test validating ID with too few parts."""
        element = Element(
            id="business.service",  # Missing name part
            element_type="service",
            layer="business",
            data={
                "id": "business.service",
                "name": "Test Service",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "doesn't match expected format" in result.errors[0].message

    def test_validate_id_format_with_underscores(self):
        """Test that underscores in name part are invalid (should be kebab-case)."""
        element = Element(
            id="business.service.test_service",  # Underscores not allowed
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test_service",
                "name": "Test Service",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
        assert len(result.errors) == 1

    def test_validate_id_format_with_multiple_hyphens(self):
        """Test that multiple hyphens are valid in kebab-case."""
        element = Element(
            id="business.service.customer-account-management",  # Valid
            element_type="service",
            layer="business",
            data={
                "id": "business.service.customer-account-management",
                "name": "Customer Account Management",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert result.is_valid()

    def test_validate_id_format_with_numbers(self):
        """Test that numbers are valid in kebab-case names."""
        element = Element(
            id="business.service.test-service-v2",  # Valid with numbers
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-service-v2",
                "name": "Test Service V2",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert result.is_valid()

    def test_validate_id_format_with_extra_dots(self):
        """Test ID with more than 3 parts (extra dots are allowed)."""
        element = Element(
            id="business.service.sub.test-service",  # 4 parts
            element_type="service",
            layer="business",
            data={
                "id": "business.service.sub.test-service",
                "name": "Test Service",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        # Should be valid (third part onwards is considered the name)
        assert result.is_valid()

    def test_validate_element_with_multiple_errors(self):
        """Test element with multiple validation errors."""
        element = Element(
            id="InvalidID",  # Bad format
            element_type="service",
            layer="business",
            data={
                "id": "InvalidID",
                # Missing name
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
        assert len(result.errors) == 2
        # Should have both ID format error and missing name error

    def test_validate_element_with_error_and_warning(self):
        """Test element with both error and warning."""
        element = Element(
            id="business.service.test-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-service",
                "name": "Test@Service!",  # Special characters (warning)
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        # Valid because no errors, but has warning
        assert result.is_valid()
        assert len(result.errors) == 0
        assert len(result.warnings) == 1

    def test_validate_method_compatibility(self):
        """Test validate method for BaseValidator compatibility."""
        element = Element(
            id="business.service.test-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-service",
                "name": "Test Service",
            },
        )

        validator = NamingValidator()
        result = validator.validate(element=element)

        assert result.is_valid()

    def test_validate_method_without_element(self):
        """Test validate method without element returns empty result."""
        validator = NamingValidator()
        result = validator.validate()

        assert result.is_valid()
        assert len(result.errors) == 0
        assert len(result.warnings) == 0

    def test_id_validation_preserves_layer_info(self):
        """Test that layer information is preserved in validation results."""
        element = Element(
            id="application.component.test-component",
            element_type="component",
            layer="application",
            data={
                "id": "application.component.test-component",
                "name": "Test Component!",  # Has special chars
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert result.warnings[0].layer == "application"
        assert result.warnings[0].element_id == "application.component.test-component"

    def test_id_format_starting_with_hyphen_invalid(self):
        """Test that IDs starting with hyphen are invalid."""
        element = Element(
            id="business.service.-test",  # Starts with hyphen
            element_type="service",
            layer="business",
            data={
                "id": "business.service.-test",
                "name": "Test",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()

    def test_id_format_ending_with_hyphen_invalid(self):
        """Test that IDs ending with hyphen are invalid."""
        element = Element(
            id="business.service.test-",  # Ends with hyphen
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test-",
                "name": "Test",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()

    def test_id_format_with_consecutive_hyphens_invalid(self):
        """Test that consecutive hyphens are invalid."""
        element = Element(
            id="business.service.test--service",  # Consecutive hyphens
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test--service",
                "name": "Test Service",
            },
        )

        validator = NamingValidator()
        result = validator.validate_element(element)

        assert not result.is_valid()
