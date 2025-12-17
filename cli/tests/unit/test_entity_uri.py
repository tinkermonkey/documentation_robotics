"""Unit tests for utils.entity_uri module."""

from unittest.mock import MagicMock

from documentation_robotics.utils.entity_uri import EntityUriParser


class TestEntityUriParserParse:
    """Tests for EntityUriParser.parse method."""

    def test_parse_entity_only(self):
        """Test parsing URI with entity only (no attribute)."""
        element_id, attribute_path = EntityUriParser.parse("motivation.goal.deliver-value")
        assert element_id == "motivation.goal.deliver-value"
        assert attribute_path is None

    def test_parse_entity_with_attribute(self):
        """Test parsing URI with attribute path."""
        element_id, attribute_path = EntityUriParser.parse(
            "motivation.goal.deliver-value#properties.priority"
        )
        assert element_id == "motivation.goal.deliver-value"
        assert attribute_path == "properties.priority"

    def test_parse_entity_with_nested_attribute(self):
        """Test parsing URI with nested attribute path."""
        element_id, attribute_path = EntityUriParser.parse(
            "api.operation.get-users#responses.200.schema.type"
        )
        assert element_id == "api.operation.get-users"
        assert attribute_path == "responses.200.schema.type"

    def test_parse_various_layers(self):
        """Test parsing URIs from different layers."""
        # Business layer
        element_id, _ = EntityUriParser.parse("business.service.checkout")
        assert element_id == "business.service.checkout"

        # Application layer
        element_id, _ = EntityUriParser.parse("application.component.auth-service")
        assert element_id == "application.component.auth-service"

        # Data model layer
        element_id, attribute = EntityUriParser.parse("data-model.entity.user#properties.email")
        assert element_id == "data-model.entity.user"
        assert attribute == "properties.email"


class TestEntityUriParserValidate:
    """Tests for EntityUriParser.validate method."""

    def test_validate_existing_entity(self):
        """Test validating URI for existing entity."""
        # Mock model with get_element method
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"properties": {"priority": "high"}}
        mock_model.get_element.return_value = mock_element

        result = EntityUriParser.validate("motivation.goal.deliver-value", mock_model)
        assert result is True
        mock_model.get_element.assert_called_once_with("motivation.goal.deliver-value")

    def test_validate_nonexistent_entity(self):
        """Test validating URI for nonexistent entity."""
        mock_model = MagicMock()
        mock_model.get_element.return_value = None

        result = EntityUriParser.validate("nonexistent.entity.id", mock_model)
        assert result is False

    def test_validate_entity_with_valid_attribute(self):
        """Test validating URI with valid attribute path."""
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"properties": {"priority": "high", "status": "active"}}
        mock_model.get_element.return_value = mock_element

        result = EntityUriParser.validate(
            "motivation.goal.deliver-value#properties.priority", mock_model
        )
        assert result is True

    def test_validate_entity_with_invalid_attribute(self):
        """Test validating URI with invalid attribute path."""
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"properties": {"priority": "high"}}
        mock_model.get_element.return_value = mock_element

        result = EntityUriParser.validate(
            "motivation.goal.deliver-value#properties.nonexistent", mock_model
        )
        assert result is False

    def test_validate_nested_attribute_path(self):
        """Test validating URI with nested attribute path."""
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"responses": {"200": {"schema": {"type": "object"}}}}
        mock_model.get_element.return_value = mock_element

        result = EntityUriParser.validate(
            "api.operation.get-users#responses.200.schema.type", mock_model
        )
        assert result is True

    def test_validate_nested_attribute_path_invalid(self):
        """Test validating URI with invalid nested attribute path."""
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"responses": {"200": {"schema": {"type": "object"}}}}
        mock_model.get_element.return_value = mock_element

        # Invalid path - 404 doesn't exist
        result = EntityUriParser.validate(
            "api.operation.get-users#responses.404.schema.type", mock_model
        )
        assert result is False

    def test_validate_attribute_path_not_dict(self):
        """Test validating when attribute path encounters non-dict value."""
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"properties": {"priority": "high"}}  # String value, not dict
        mock_model.get_element.return_value = mock_element

        # Try to navigate deeper into string value
        result = EntityUriParser.validate(
            "motivation.goal.deliver-value#properties.priority.level", mock_model
        )
        assert result is False


class TestEntityUriParserResolveAttributePath:
    """Tests for EntityUriParser._resolve_attribute_path method."""

    def test_resolve_simple_path(self):
        """Test resolving simple attribute path."""
        data = {"properties": {"priority": "high"}}
        result = EntityUriParser._resolve_attribute_path(data, "properties.priority")
        assert result == "high"

    def test_resolve_nested_path(self):
        """Test resolving nested attribute path."""
        data = {"responses": {"200": {"schema": {"type": "object"}}}}
        result = EntityUriParser._resolve_attribute_path(data, "responses.200.schema.type")
        assert result == "object"

    def test_resolve_invalid_path(self):
        """Test resolving invalid attribute path returns None."""
        data = {"properties": {"priority": "high"}}
        result = EntityUriParser._resolve_attribute_path(data, "properties.nonexistent")
        assert result is None

    def test_resolve_path_through_non_dict(self):
        """Test resolving path through non-dict value returns None."""
        data = {"properties": {"priority": "high"}}
        result = EntityUriParser._resolve_attribute_path(data, "properties.priority.level")
        assert result is None

    def test_resolve_empty_path(self):
        """Test resolving empty path returns root data."""
        data = {"properties": {"priority": "high"}}
        result = EntityUriParser._resolve_attribute_path(data, "")
        # Empty path should return the data itself after splitting
        # Since split('') on '' gives [''], we try to look up ''
        assert result is None  # Empty string key won't exist

    def test_resolve_path_with_numeric_keys(self):
        """Test resolving path with numeric keys (as strings)."""
        data = {"responses": {"200": {"description": "OK"}, "404": {"description": "Not Found"}}}
        result = EntityUriParser._resolve_attribute_path(data, "responses.200.description")
        assert result == "OK"


class TestEntityUriParserFormatEntityUri:
    """Tests for EntityUriParser.format_entity_uri method."""

    def test_format_entity_only(self):
        """Test formatting URI without attribute path."""
        uri = EntityUriParser.format_entity_uri("motivation.goal.deliver-value")
        assert uri == "motivation.goal.deliver-value"

    def test_format_with_attribute_path(self):
        """Test formatting URI with attribute path."""
        uri = EntityUriParser.format_entity_uri(
            "motivation.goal.deliver-value", "properties.priority"
        )
        assert uri == "motivation.goal.deliver-value#properties.priority"

    def test_format_with_nested_attribute_path(self):
        """Test formatting URI with nested attribute path."""
        uri = EntityUriParser.format_entity_uri(
            "api.operation.get-users", "responses.200.schema.type"
        )
        assert uri == "api.operation.get-users#responses.200.schema.type"

    def test_format_with_none_attribute_path(self):
        """Test formatting URI with explicit None attribute path."""
        uri = EntityUriParser.format_entity_uri("motivation.goal.deliver-value", None)
        assert uri == "motivation.goal.deliver-value"

    def test_format_roundtrip(self):
        """Test formatting and parsing roundtrip."""
        original_element = "motivation.goal.deliver-value"
        original_attribute = "properties.priority"

        # Format
        uri = EntityUriParser.format_entity_uri(original_element, original_attribute)

        # Parse
        parsed_element, parsed_attribute = EntityUriParser.parse(uri)

        # Verify roundtrip
        assert parsed_element == original_element
        assert parsed_attribute == original_attribute


class TestEntityUriParserIntegration:
    """Integration tests for EntityUriParser."""

    def test_full_workflow(self):
        """Test complete workflow of parsing and validating."""
        # Create mock model
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"properties": {"priority": "high", "status": "active"}}
        mock_model.get_element.return_value = mock_element

        # Parse URI
        uri = "motivation.goal.deliver-value#properties.priority"
        element_id, attribute_path = EntityUriParser.parse(uri)

        assert element_id == "motivation.goal.deliver-value"
        assert attribute_path == "properties.priority"

        # Validate URI
        is_valid = EntityUriParser.validate(uri, mock_model)
        assert is_valid is True

    def test_format_parse_validate_workflow(self):
        """Test workflow of formatting, parsing, and validating."""
        # Create mock model
        mock_model = MagicMock()
        mock_element = MagicMock()
        mock_element.data = {"responses": {"200": {"schema": {"type": "object"}}}}
        mock_model.get_element.return_value = mock_element

        # Format URI
        element_id = "api.operation.get-users"
        attribute_path = "responses.200.schema.type"
        uri = EntityUriParser.format_entity_uri(element_id, attribute_path)

        # Parse URI
        parsed_element, parsed_attribute = EntityUriParser.parse(uri)
        assert parsed_element == element_id
        assert parsed_attribute == attribute_path

        # Validate URI
        is_valid = EntityUriParser.validate(uri, mock_model)
        assert is_valid is True
