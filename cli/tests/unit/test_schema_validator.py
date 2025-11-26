"""Unit tests for SchemaValidator."""

import json
from pathlib import Path

import pytest
from documentation_robotics.core.element import Element
from documentation_robotics.validators.schema import SchemaValidator


class TestSchemaValidator:
    """Tests for SchemaValidator."""

    @pytest.fixture
    def valid_schema(self, temp_dir):
        """Create a valid JSON schema for testing."""
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "required": ["id", "name"],
            "properties": {
                "id": {"type": "string"},
                "name": {"type": "string", "minLength": 1},
                "description": {"type": "string"},
            },
        }
        schema_path = temp_dir / "test-schema.json"
        with open(schema_path, "w") as f:
            json.dump(schema, f)
        return schema_path

    @pytest.fixture
    def invalid_schema(self, temp_dir):
        """Create an invalid JSON schema for testing."""
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "invalid-type",  # Invalid schema
        }
        schema_path = temp_dir / "invalid-schema.json"
        with open(schema_path, "w") as f:
            json.dump(schema, f)
        return schema_path

    def test_validator_creation_with_no_schema(self):
        """Test creating validator without schema."""
        validator = SchemaValidator()

        assert validator.schema is None
        assert validator.schema_path is None

    def test_validator_creation_with_schema(self, valid_schema):
        """Test creating validator with valid schema."""
        validator = SchemaValidator(valid_schema)

        assert validator.schema is not None
        assert validator.schema_path == valid_schema

    def test_validator_creation_with_nonexistent_schema(self):
        """Test creating validator with nonexistent schema file."""
        validator = SchemaValidator(Path("/nonexistent/schema.json"))

        # Should create validator but schema is None
        assert validator.schema is None

    def test_validate_element_without_schema(self, sample_element):
        """Test validating element when no schema is available."""
        validator = SchemaValidator()
        result = validator.validate_element(sample_element)

        # Should return warning about no schema
        assert result.is_valid()  # No errors, just warning
        assert len(result.warnings) == 1
        assert "no schema available" in result.warnings[0].message.lower()
        assert result.warnings[0].layer == sample_element.layer
        assert result.warnings[0].element_id == sample_element.id

    def test_validate_element_with_valid_data(self, valid_schema, sample_element):
        """Test validating element with valid data."""
        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(sample_element)

        # Should pass validation
        assert result.is_valid()
        assert len(result.errors) == 0
        assert len(result.warnings) == 0

    def test_validate_element_with_missing_required_field(self, valid_schema):
        """Test validating element missing required field."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                # Missing 'name' field (required by schema)
                "description": "Test description",
            },
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element)

        # Should have validation error
        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "schema validation failed" in result.errors[0].message.lower()
        assert "'name' is a required property" in result.errors[0].message
        assert result.errors[0].layer == element.layer
        assert result.errors[0].element_id == element.id
        assert result.errors[0].location is not None
        assert result.errors[0].fix_suggestion is not None

    def test_validate_element_with_wrong_type(self, valid_schema):
        """Test validating element with wrong data type."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": 123,  # Should be string, not number
                "name": "Test Service",
            },
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element)

        # Should have validation error
        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "schema validation failed" in result.errors[0].message.lower()
        assert result.errors[0].layer == element.layer
        assert result.errors[0].element_id == element.id

    def test_validate_element_with_invalid_schema(self, invalid_schema, sample_element):
        """Test validating element with invalid schema."""
        validator = SchemaValidator(invalid_schema)
        result = validator.validate_element(sample_element)

        # Should have schema error
        assert not result.is_valid()
        assert len(result.errors) == 1
        assert "invalid schema" in result.errors[0].message.lower()
        assert result.errors[0].layer == sample_element.layer
        assert result.errors[0].element_id == sample_element.id

    def test_validate_element_strict_mode_missing_description(self, valid_schema):
        """Test strict validation flags missing description."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "Test Service",
                # No description
            },
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element, strict=True)

        # Should pass but have warning about missing description
        assert result.is_valid()
        assert len(result.warnings) == 1
        assert "missing description" in result.warnings[0].message.lower()
        assert result.warnings[0].layer == element.layer
        assert result.warnings[0].element_id == element.id

    def test_validate_element_strict_mode_invalid_name_casing(self, valid_schema):
        """Test strict validation flags improper name casing."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "lowercase name",  # Should start with uppercase
                "description": "Test description",
            },
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element, strict=True)

        # Should pass but have warning about name casing
        assert result.is_valid()
        assert len(result.warnings) == 1
        assert "uppercase letter" in result.warnings[0].message.lower()
        assert result.warnings[0].layer == element.layer
        assert result.warnings[0].element_id == element.id

    def test_validate_element_strict_mode_valid_element(self, valid_schema):
        """Test strict validation passes for fully valid element."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.test",
                "name": "Test Service",
                "description": "A test service",
            },
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element, strict=True)

        # Should pass with no warnings
        assert result.is_valid()
        assert len(result.warnings) == 0

    def test_validate_method_compatibility(self, valid_schema, sample_element):
        """Test validate method for BaseValidator compatibility."""
        validator = SchemaValidator(valid_schema)
        result = validator.validate(element=sample_element, strict=False)

        # Should work via validate method
        assert result.is_valid()

    def test_validate_method_without_element(self, valid_schema):
        """Test validate method without element returns empty result."""
        validator = SchemaValidator(valid_schema)
        result = validator.validate()

        # Should return empty result
        assert result.is_valid()
        assert len(result.errors) == 0
        assert len(result.warnings) == 0

    def test_suggest_fix_for_required_field(self, valid_schema):
        """Test fix suggestion for missing required field."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"id": "business.service.test"},  # Missing name
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element)

        # Should suggest adding the required property
        assert not result.is_valid()
        assert result.errors[0].fix_suggestion is not None
        assert "required property" in result.errors[0].fix_suggestion.lower()

    def test_suggest_fix_for_type_error(self, valid_schema):
        """Test fix suggestion for type error."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"id": 123, "name": "Test"},  # Wrong type for id
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element)

        # Should suggest checking the data type
        assert not result.is_valid()
        assert result.errors[0].fix_suggestion is not None
        assert "data type" in result.errors[0].fix_suggestion.lower()

    def test_location_path_in_error(self, valid_schema):
        """Test that error includes location path."""
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"id": "business.service.test"},  # Missing name
        )

        validator = SchemaValidator(valid_schema)
        result = validator.validate_element(element)

        # Should include location path
        assert not result.is_valid()
        assert result.errors[0].location is not None
        assert result.errors[0].location.startswith("$")
