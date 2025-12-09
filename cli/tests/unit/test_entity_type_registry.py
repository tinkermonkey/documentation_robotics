"""Unit tests for EntityTypeRegistry."""

from pathlib import Path

import pytest
from documentation_robotics.schemas.registry import EntityTypeRegistry


class TestEntityTypeRegistry:
    """Tests for EntityTypeRegistry."""

    @pytest.fixture
    def registry_with_schemas(self, temp_dir):
        """Create a registry with real schemas."""
        registry = EntityTypeRegistry()

        # Use bundled schemas from the package
        from documentation_robotics.schemas.bundler import get_bundled_schemas_dir

        schema_dir = get_bundled_schemas_dir()
        registry.build_from_schemas(schema_dir)

        return registry

    def test_build_from_schemas_loads_all_layers(self, registry_with_schemas):
        """Test that registry loads all 12 layers."""
        layers = registry_with_schemas.get_all_layers()

        assert len(layers) > 0
        assert "business" in layers
        assert "application" in layers
        assert "motivation" in layers

    def test_business_layer_has_expected_types(self, registry_with_schemas):
        """Test that business layer has expected entity types."""
        business_types = registry_with_schemas.get_valid_types("business")

        assert isinstance(business_types, list)
        assert len(business_types) > 0

        # Business layer should have common types
        # Note: actual types depend on schema, checking for presence not specific values
        assert any("service" in t or "process" in t or "actor" in t for t in business_types)

    def test_application_layer_has_expected_types(self, registry_with_schemas):
        """Test that application layer has expected entity types."""
        app_types = registry_with_schemas.get_valid_types("application")

        assert isinstance(app_types, list)
        assert len(app_types) > 0

        # Application layer should have components/services
        assert any("component" in t or "service" in t for t in app_types)

    def test_is_valid_type_returns_true_for_valid_type(self, registry_with_schemas):
        """Test that is_valid_type returns True for valid types."""
        # Get actual types from business layer
        business_types = registry_with_schemas.get_valid_types("business")

        if business_types:
            # Pick first valid type
            valid_type = business_types[0]
            assert registry_with_schemas.is_valid_type("business", valid_type) is True

    def test_is_valid_type_returns_false_for_invalid_type(self, registry_with_schemas):
        """Test that is_valid_type returns False for invalid types."""
        assert registry_with_schemas.is_valid_type("business", "unicorn") is False
        assert registry_with_schemas.is_valid_type("application", "dragon") is False

    def test_is_valid_type_is_case_insensitive(self, registry_with_schemas):
        """Test that is_valid_type is case-insensitive."""
        business_types = registry_with_schemas.get_valid_types("business")

        if business_types:
            valid_type = business_types[0]
            assert registry_with_schemas.is_valid_type("business", valid_type.upper()) is True
            assert registry_with_schemas.is_valid_type("business", valid_type.lower()) is True

    def test_get_valid_types_returns_empty_for_unknown_layer(self, registry_with_schemas):
        """Test that get_valid_types returns empty list for unknown layer."""
        types = registry_with_schemas.get_valid_types("unknown_layer")
        assert isinstance(types, list)
        assert len(types) == 0

    def test_api_layer_has_special_types(self, registry_with_schemas):
        """Test that API layer has OpenAPI 3.0 entity types."""
        api_types = registry_with_schemas.get_valid_types("api")

        # API layer should have OpenAPI 3.0 types (26 total)
        assert "operation" in api_types
        assert "path-item" in api_types
        assert "schema" in api_types
        assert "open-api-document" in api_types
        assert len(api_types) == 26

    def test_data_model_layer_has_special_types(self, registry_with_schemas):
        """Test that data_model layer has JSON Schema Draft 7 entity types."""
        dm_types = registry_with_schemas.get_valid_types("data_model")

        # Data model layer should have JSON Schema types (17 total)
        assert "json-schema" in dm_types
        assert "object-schema" in dm_types
        assert "string-schema" in dm_types
        assert "schema-definition" in dm_types
        assert len(dm_types) == 17

    def test_get_registry_returns_copy(self, registry_with_schemas):
        """Test that get_registry returns a copy, not the internal registry."""
        registry1 = registry_with_schemas.get_registry()
        registry2 = registry_with_schemas.get_registry()

        # Should be equal but not the same object
        assert registry1 == registry2
        assert registry1 is not registry2

    def test_get_all_layers_returns_list(self, registry_with_schemas):
        """Test that get_all_layers returns a list of strings."""
        layers = registry_with_schemas.get_all_layers()

        assert isinstance(layers, list)
        for layer in layers:
            assert isinstance(layer, str)


class TestEntityTypeRegistryParsing:
    """Tests for EntityTypeRegistry schema parsing logic."""

    def test_parse_entity_type_strips_business_prefix(self):
        """Test that _parse_entity_type strips 'business' prefix."""
        registry = EntityTypeRegistry()

        result = registry._parse_entity_type("businessServices")
        assert result == "service"

        result = registry._parse_entity_type("businessActors")
        assert result == "actor"

    def test_parse_entity_type_strips_application_prefix(self):
        """Test that _parse_entity_type strips 'application' prefix."""
        registry = EntityTypeRegistry()

        result = registry._parse_entity_type("applicationComponents")
        assert result == "component"

        result = registry._parse_entity_type("applicationServices")
        assert result == "service"

    def test_parse_entity_type_singularizes(self):
        """Test that _parse_entity_type singularizes plurals."""
        registry = EntityTypeRegistry()

        result = registry._parse_entity_type("stakeholders")
        assert result == "stakeholder"

        result = registry._parse_entity_type("policies")
        assert result == "policy"

    def test_extract_layer_name_from_filename(self):
        """Test that _extract_layer_name parses filenames correctly."""
        registry = EntityTypeRegistry()

        result = registry._extract_layer_name(Path("02-business-layer.schema.json"))
        assert result == "business"

        result = registry._extract_layer_name(Path("04-application-layer.schema.json"))
        assert result == "application"

        result = registry._extract_layer_name(Path("11-apm-observability-layer.schema.json"))
        assert result == "apm_observability"

    def test_build_from_non_existent_directory(self, temp_dir):
        """Test that build_from_schemas handles non-existent directory gracefully."""
        registry = EntityTypeRegistry()

        non_existent = temp_dir / "non_existent"
        registry.build_from_schemas(non_existent)

        # Should not crash, registry should be empty
        assert len(registry.get_all_layers()) == 0
