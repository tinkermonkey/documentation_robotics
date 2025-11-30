"""
Unit tests for model serialization.

Tests the serialization of Model, Layer, and Element objects to JSON format
for WebSocket transmission to visualization clients.
"""

import json
from pathlib import Path

import pytest
from documentation_robotics.core.element import Element
from documentation_robotics.core.layer import Layer
from documentation_robotics.core.model import Model
from documentation_robotics.server.model_serializer import (
    ModelSerializer,
    load_changesets,
    serialize_model_state,
)


class TestElementSerialization:
    """Test serialization of individual elements."""

    def test_serialize_element_basic(self, sample_element):
        """Test basic element serialization."""
        serializer = ModelSerializer(model=None)
        result = serializer._serialize_element(sample_element)

        assert result["id"] == "business.service.test-service"
        assert result["type"] == "service"
        assert result["name"] == "Test Service"
        assert "data" in result
        assert result["data"]["description"] == "A test service"

    def test_serialize_element_with_references(self, sample_element_with_refs):
        """Test serialization of element with references."""
        serializer = ModelSerializer(model=None)
        result = serializer._serialize_element(sample_element_with_refs)

        assert result["id"] == "application.service.test-app-service"
        assert result["data"]["realizes"] == "business.service.test-service"
        assert "data_model.entity.customer" in result["data"]["uses"]
        assert "data_model.entity.order" in result["data"]["uses"]

    def test_serialize_element_with_file_path(self):
        """Test serialization includes file path."""
        element = Element(
            id="test.element.foo",
            element_type="test",
            layer="test",
            data={"id": "test.element.foo", "name": "Foo"},
            file_path=Path("/path/to/file.yaml"),
        )

        serializer = ModelSerializer(model=None)
        result = serializer._serialize_element(element)

        assert result["file_path"] == "/path/to/file.yaml"

    def test_serialize_element_without_file_path(self):
        """Test serialization handles missing file path."""
        element = Element(
            id="test.element.bar",
            element_type="test",
            layer="test",
            data={"id": "test.element.bar", "name": "Bar"},
        )

        serializer = ModelSerializer(model=None)
        result = serializer._serialize_element(element)

        assert result["file_path"] is None

    def test_serialize_element_preserves_all_data(self):
        """Test that all element data is preserved in serialization."""
        complex_data = {
            "id": "api.endpoint.get-users",
            "name": "Get Users",
            "type": "endpoint",
            "method": "GET",
            "path": "/api/users",
            "description": "Retrieve all users",
            "parameters": [{"name": "limit", "type": "integer"}, {"name": "offset", "type": "integer"}],
            "responses": {"200": {"description": "Success", "schema": "UserList"}},
            "security": ["bearer"],
            "tags": ["users", "read"],
        }

        element = Element(
            id="api.endpoint.get-users",
            element_type="endpoint",
            layer="api",
            data=complex_data,
        )

        serializer = ModelSerializer(model=None)
        result = serializer._serialize_element(element)

        # Verify all complex data is preserved
        assert result["data"]["method"] == "GET"
        assert result["data"]["path"] == "/api/users"
        assert len(result["data"]["parameters"]) == 2
        assert result["data"]["responses"]["200"]["schema"] == "UserList"
        assert "bearer" in result["data"]["security"]
        assert "users" in result["data"]["tags"]


class TestLayerSerialization:
    """Test serialization of layers."""

    def test_serialize_layer_with_elements(self, initialized_model):
        """Test layer serialization includes all elements."""
        serializer = ModelSerializer(initialized_model)

        # Get a layer that should have configuration
        layer_name = "motivation"
        layer = initialized_model.get_layer(layer_name)

        result = serializer._serialize_layer(layer_name, layer)

        assert result["name"] == layer_name
        assert "display_name" in result
        assert "order" in result
        assert "path" in result
        assert "enabled" in result
        assert isinstance(result["elements"], list)

    def test_serialize_layer_order(self, initialized_model):
        """Test layer serialization preserves order."""
        serializer = ModelSerializer(initialized_model)
        layers = serializer._serialize_layers()

        # Verify layers are sorted by order
        orders = [layer["order"] for layer in layers]
        assert orders == sorted(orders)

        # Verify order values match expected layer hierarchy
        layer_map = {layer["name"]: layer["order"] for layer in layers}
        assert layer_map.get("motivation", 0) < layer_map.get("business", 999)
        assert layer_map.get("business", 0) < layer_map.get("application", 999)

    def test_serialize_layer_element_counts(self, initialized_model):
        """Test layer serialization includes element counts."""
        serializer = ModelSerializer(initialized_model)

        layer_name = "motivation"
        layer = initialized_model.get_layer(layer_name)
        result = serializer._serialize_layer(layer_name, layer)

        assert "element_counts" in result
        assert isinstance(result["element_counts"], dict)

    def test_serialize_disabled_layers_excluded(self, initialized_model):
        """Test that disabled layers are not serialized."""
        # Disable a layer
        initialized_model.manifest.layers["testing"]["enabled"] = False

        serializer = ModelSerializer(initialized_model)
        layers = serializer._serialize_layers()

        layer_names = [layer["name"] for layer in layers]
        assert "testing" not in layer_names


class TestModelSerialization:
    """Test serialization of complete model."""

    def test_serialize_model_structure(self, initialized_model):
        """Test model serialization has correct structure."""
        serializer = ModelSerializer(initialized_model)
        result = serializer.serialize_model()

        assert "manifest" in result
        assert "layers" in result
        assert "statistics" in result

    def test_serialize_manifest(self, initialized_model):
        """Test manifest serialization includes all required fields."""
        serializer = ModelSerializer(initialized_model)
        result = serializer._serialize_manifest()

        assert "version" in result
        assert "spec_version" in result
        assert "project" in result
        assert "conventions" in result
        assert "created" in result
        assert "updated" in result

    def test_serialize_manifest_project_info(self, initialized_model):
        """Test manifest includes project information."""
        serializer = ModelSerializer(initialized_model)
        result = serializer._serialize_manifest()

        assert result["project"]["name"] == "test-project"
        assert "version" in result["project"]

    def test_serialize_statistics(self, initialized_model):
        """Test statistics serialization."""
        serializer = ModelSerializer(initialized_model)
        result = serializer._serialize_statistics()

        assert "total_elements" in result
        assert "total_relationships" in result
        assert isinstance(result["total_elements"], int)

    def test_serialize_all_enabled_layers(self, initialized_model):
        """Test that all enabled layers are serialized."""
        serializer = ModelSerializer(initialized_model)
        result = serializer.serialize_model()

        enabled_layers = [
            name for name, config in initialized_model.manifest.layers.items() if config.get("enabled", True)
        ]

        serialized_layer_names = [layer["name"] for layer in result["layers"]]

        for layer_name in enabled_layers:
            assert layer_name in serialized_layer_names

    def test_serialize_element_update(self, initialized_model):
        """Test serialization of individual element update."""
        # Add an element to the model
        element = Element.create(layer="motivation", element_type="stakeholder", name="test-stakeholder")

        initialized_model.add_element("motivation", element)

        serializer = ModelSerializer(initialized_model)
        result = serializer.serialize_element_update(element.id)

        assert result is not None
        assert result["id"] == element.id
        assert result["type"] == "stakeholder"
        assert result["name"] == "test-stakeholder"

    def test_serialize_nonexistent_element_update(self, initialized_model):
        """Test serialization returns None for nonexistent element."""
        serializer = ModelSerializer(initialized_model)
        result = serializer.serialize_element_update("nonexistent.element.id")

        assert result is None


class TestChangesetSerialization:
    """Test changeset loading and serialization."""

    def test_load_changesets_empty(self, temp_dir):
        """Test loading changesets when none exist."""
        changesets = load_changesets(temp_dir)
        assert changesets == []

    def test_load_changesets_with_metadata(self, temp_dir, initialized_model):
        """Test loading changesets with metadata files."""
        # Create changeset directory structure
        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        changeset_dir = changesets_dir / "test-changeset-1"
        changeset_dir.mkdir()

        # Create changeset metadata
        import yaml

        metadata = {
            "name": "Test Changeset 1",
            "description": "A test changeset",
            "created": "2024-01-15T10:30:00Z",
            "author": "test@example.com",
            "status": "active",
        }

        with open(changeset_dir / "changeset.yaml", "w") as f:
            yaml.dump(metadata, f)

        # Load changesets
        changesets = load_changesets(temp_dir)

        assert len(changesets) == 1
        assert changesets[0]["id"] == "test-changeset-1"
        assert changesets[0]["name"] == "Test Changeset 1"
        assert changesets[0]["description"] == "A test changeset"
        assert changesets[0]["author"] == "test@example.com"
        assert changesets[0]["status"] == "active"

    def test_load_changesets_sorted_by_created(self, temp_dir):
        """Test changesets are sorted by creation date."""
        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        import yaml

        # Create multiple changesets with different dates
        for i, date in enumerate(["2024-01-10T10:00:00Z", "2024-01-15T10:00:00Z", "2024-01-12T10:00:00Z"]):
            changeset_dir = changesets_dir / f"changeset-{i}"
            changeset_dir.mkdir()

            metadata = {
                "name": f"Changeset {i}",
                "description": f"Test {i}",
                "created": date,
                "status": "active",
            }

            with open(changeset_dir / "changeset.yaml", "w") as f:
                yaml.dump(metadata, f)

        changesets = load_changesets(temp_dir)

        assert len(changesets) == 3
        # Verify sorted by created date
        dates = [cs["created"] for cs in changesets]
        assert dates == sorted(dates)

    def test_load_changesets_handles_missing_metadata(self, temp_dir):
        """Test loading changesets handles missing metadata gracefully."""
        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        # Create changeset directory without metadata file
        changeset_dir = changesets_dir / "broken-changeset"
        changeset_dir.mkdir()

        # Should not crash, just skip the broken changeset
        changesets = load_changesets(temp_dir)
        assert changesets == []


class TestModelStateSerialization:
    """Test complete model state serialization."""

    def test_serialize_model_state_structure(self, initialized_model, temp_dir):
        """Test complete model state has correct structure."""
        result = serialize_model_state(initialized_model, temp_dir)

        assert "model" in result
        assert "changesets" in result

    def test_serialize_model_state_includes_all_data(self, initialized_model, temp_dir):
        """Test complete model state includes all required data."""
        result = serialize_model_state(initialized_model, temp_dir)

        # Verify model data
        assert "manifest" in result["model"]
        assert "layers" in result["model"]
        assert "statistics" in result["model"]

        # Verify changeset data
        assert isinstance(result["changesets"], list)

    def test_serialize_model_state_json_serializable(self, initialized_model, temp_dir):
        """Test that serialized model state is JSON-serializable."""
        result = serialize_model_state(initialized_model, temp_dir)

        # Should not raise exception
        json_str = json.dumps(result)
        assert json_str is not None

        # Verify it can be parsed back
        parsed = json.loads(json_str)
        assert "model" in parsed
        assert "changesets" in parsed


class TestLayerTypeSupport:
    """Test serialization supports all layer types."""

    def test_serialize_archimate_layer(self, initialized_model):
        """Test serialization of ArchiMate layers (business, application, etc.)."""
        serializer = ModelSerializer(initialized_model)

        # Test business layer (ArchiMate-based)
        layer = initialized_model.get_layer("business")
        result = serializer._serialize_layer("business", layer)

        assert result["name"] == "business"
        assert isinstance(result["elements"], list)

    def test_serialize_openapi_layer(self, initialized_model):
        """Test serialization of OpenAPI layer (API layer)."""
        serializer = ModelSerializer(initialized_model)

        # API layer uses OpenAPI-style elements
        layer = initialized_model.get_layer("api")
        result = serializer._serialize_layer("api", layer)

        assert result["name"] == "api"
        assert isinstance(result["elements"], list)

    def test_serialize_json_schema_layer(self, initialized_model):
        """Test serialization of JSON Schema layer (Data Model layer)."""
        serializer = ModelSerializer(initialized_model)

        # Data Model layer uses JSON Schema
        layer = initialized_model.get_layer("data_model")
        result = serializer._serialize_layer("data_model", layer)

        assert result["name"] == "data_model"
        assert isinstance(result["elements"], list)

    def test_serialize_custom_layer(self, initialized_model):
        """Test serialization of custom layers (UX, Navigation, Testing, etc.)."""
        serializer = ModelSerializer(initialized_model)

        # Test UX layer (custom layer type)
        layer = initialized_model.get_layer("ux")
        result = serializer._serialize_layer("ux", layer)

        assert result["name"] == "ux"
        assert isinstance(result["elements"], list)

        # Test Testing layer (custom layer type)
        layer = initialized_model.get_layer("testing")
        result = serializer._serialize_layer("testing", layer)

        assert result["name"] == "testing"
        assert isinstance(result["elements"], list)

    def test_serialize_all_layer_types_in_model(self, initialized_model):
        """Test that serialization handles all layer types in a complete model."""
        serializer = ModelSerializer(initialized_model)
        result = serializer.serialize_model()

        # Verify we can serialize all standard layers
        expected_layers = [
            "motivation",
            "business",
            "security",
            "application",
            "technology",
            "api",
            "data_model",
            "datastore",
            "ux",
            "navigation",
            "apm",
            "testing",
        ]

        serialized_names = [layer["name"] for layer in result["layers"]]

        for layer_name in expected_layers:
            assert layer_name in serialized_names
