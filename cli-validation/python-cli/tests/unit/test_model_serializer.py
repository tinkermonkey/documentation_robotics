"""
Unit tests for model serialization.

Tests the serialization of Model, Layer, and Element objects to JSON format
for WebSocket transmission to visualization clients.
"""

import json
from pathlib import Path

from documentation_robotics.core.element import Element
from documentation_robotics.core.model import Model
from documentation_robotics.server.model_serializer import (
    ModelSerializer,
    load_changesets,
    serialize_model_state,
)

# Test constants
EXPECTED_LAYER_COUNT = (
    12  # Total number of layer types (ArchiMate + OpenAPI + JSON Schema + Custom)
)
EXPECTED_CHANGESET_COUNT = 3  # Number of changesets in multi-changeset tests


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
            "parameters": [
                {"name": "limit", "type": "integer"},
                {"name": "offset", "type": "integer"},
            ],
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
        assert "description" in result["project"]

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
            name
            for name, config in initialized_model.manifest.layers.items()
            if config.get("enabled", True)
        ]

        serialized_layer_names = [layer["name"] for layer in result["layers"]]

        for layer_name in enabled_layers:
            assert layer_name in serialized_layer_names

    def test_serialize_element_update(self, initialized_model):
        """Test serialization of individual element update."""
        # Add an element to the model
        element = Element.create(
            layer="motivation", element_type="stakeholder", name="test-stakeholder"
        )

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
        """Test loading changesets with metadata and changes files."""
        from datetime import datetime, timezone

        from documentation_robotics.core.changeset import Change, Changeset

        # Create changeset directory structure
        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        changeset_dir = changesets_dir / "test-changeset-1"
        changeset_dir.mkdir()

        # Create changeset using Changeset class
        changeset = Changeset("test-changeset-1", changeset_dir)
        changeset.metadata.name = "Test Changeset 1"
        changeset.metadata.description = "A test changeset"
        changeset.metadata.type = "feature"
        changeset.metadata.status = "active"
        changeset.metadata.workflow = "direct-cli"

        # Add a test change
        change = Change(
            timestamp=datetime.now(timezone.utc).isoformat(),
            operation="add",
            element_id="business.service.test",
            layer="business",
            element_type="service",
            data={"name": "Test Service", "description": "Test"},
        )
        changeset.add_change(change)
        changeset.save()

        # Load changesets
        changesets = load_changesets(temp_dir)

        assert len(changesets) == 1
        assert changesets[0]["id"] == "test-changeset-1"
        assert changesets[0]["name"] == "Test Changeset 1"
        assert changesets[0]["description"] == "A test changeset"
        assert changesets[0]["type"] == "feature"
        assert changesets[0]["status"] == "active"
        assert changesets[0]["workflow"] == "direct-cli"
        assert "created_at" in changesets[0]
        assert "updated_at" in changesets[0]
        assert "summary" in changesets[0]
        assert changesets[0]["summary"]["elements_added"] == 1
        assert "changes" in changesets[0]
        assert len(changesets[0]["changes"]) == 1
        assert changesets[0]["changes"][0]["operation"] == "add"
        assert changesets[0]["changes"][0]["element_id"] == "business.service.test"

    def test_load_changesets_sorted_by_created(self, temp_dir):
        """Test changesets are sorted by creation date."""
        from datetime import datetime, timedelta, timezone

        from documentation_robotics.core.changeset import Changeset

        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        # Create multiple changesets with different dates
        base_time = datetime(2024, 1, 10, 10, 0, 0, tzinfo=timezone.utc)
        dates = [base_time, base_time + timedelta(days=5), base_time + timedelta(days=2)]

        for i, created_time in enumerate(dates):
            changeset_dir = changesets_dir / f"changeset-{i}"
            changeset_dir.mkdir()

            changeset = Changeset(f"changeset-{i}", changeset_dir)
            changeset.metadata.name = f"Changeset {i}"
            changeset.metadata.description = f"Test {i}"
            changeset.metadata.created_at = created_time
            changeset.metadata.updated_at = created_time
            changeset.save()

        changesets = load_changesets(temp_dir)

        assert len(changesets) == EXPECTED_CHANGESET_COUNT
        # Verify sorted by created_at date
        dates = [cs["created_at"] for cs in changesets]
        assert dates == sorted(dates)

    def test_load_changesets_handles_missing_metadata(self, temp_dir):
        """Test loading changesets handles missing metadata gracefully."""
        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        # Create changeset directory without metadata file
        changeset_dir = changesets_dir / "broken-changeset"
        changeset_dir.mkdir()

        # Should not crash, creates changeset with defaults
        changesets = load_changesets(temp_dir)
        assert len(changesets) == 1
        assert changesets[0]["id"] == "broken-changeset"
        assert changesets[0]["name"] == ""
        assert changesets[0]["status"] == "active"
        assert len(changesets[0]["changes"]) == 0

    def test_load_changesets_with_multiple_changes(self, temp_dir):
        """Test loading changeset with multiple changes of different types."""
        from datetime import datetime, timezone

        from documentation_robotics.core.changeset import Change, Changeset

        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        changeset_dir = changesets_dir / "multi-change-test"
        changeset_dir.mkdir()

        changeset = Changeset("multi-change-test", changeset_dir)
        changeset.metadata.name = "Multi-Change Test"
        changeset.metadata.description = "Testing multiple change types"

        # Add changes of different types
        changes = [
            Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.new-service",
                layer="business",
                element_type="service",
                data={"name": "New Service"},
            ),
            Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="update",
                element_id="business.service.existing-service",
                layer="business",
                element_type="service",
                before={"name": "Old Name"},
                after={"name": "New Name"},
            ),
            Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="delete",
                element_id="business.service.removed-service",
                layer="business",
                element_type="service",
            ),
        ]

        for change in changes:
            changeset.add_change(change)

        changeset.save()

        # Load and verify
        loaded_changesets = load_changesets(temp_dir)

        assert len(loaded_changesets) == 1
        assert len(loaded_changesets[0]["changes"]) == 3
        assert loaded_changesets[0]["summary"]["elements_added"] == 1
        assert loaded_changesets[0]["summary"]["elements_updated"] == 1
        assert loaded_changesets[0]["summary"]["elements_deleted"] == 1

        # Verify change details are preserved
        change_ops = [c["operation"] for c in loaded_changesets[0]["changes"]]
        assert "add" in change_ops
        assert "update" in change_ops
        assert "delete" in change_ops

    def test_load_changesets_preserves_change_data(self, temp_dir):
        """Test that all change data fields are preserved during loading."""
        from documentation_robotics.core.changeset import Change, Changeset

        changesets_dir = temp_dir / ".dr" / "changesets"
        changesets_dir.mkdir(parents=True, exist_ok=True)

        changeset_dir = changesets_dir / "detailed-change-test"
        changeset_dir.mkdir()

        changeset = Changeset("detailed-change-test", changeset_dir)
        changeset.metadata.name = "Detailed Change Test"

        # Add change with full data
        change = Change(
            timestamp="2024-01-15T10:30:00Z",
            operation="add",
            element_id="application.component.test",
            layer="application",
            element_type="component",
            data={
                "name": "Test Component",
                "description": "A test component",
                "properties": {"version": "1.0", "status": "active"},
            },
        )
        changeset.add_change(change)
        changeset.save()

        # Load and verify all fields
        loaded = load_changesets(temp_dir)
        loaded_change = loaded[0]["changes"][0]

        assert loaded_change["timestamp"] == "2024-01-15T10:30:00Z"
        assert loaded_change["operation"] == "add"
        assert loaded_change["element_id"] == "application.component.test"
        assert loaded_change["layer"] == "application"
        assert loaded_change["element_type"] == "component"
        assert loaded_change["data"]["name"] == "Test Component"
        assert loaded_change["data"]["properties"]["version"] == "1.0"


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


class TestEdgeCases:
    """Test edge cases and special scenarios."""

    def test_serialize_element_with_unicode_characters(self):
        """Test serialization handles Unicode and special characters."""
        element = Element(
            id="test.unicode.element",
            element_type="test",
            layer="test",
            data={
                "id": "test.unicode.element",
                "name": "Test Element 测试 🚀",
                "description": "Element with émojis 👍 and special chars: ñ, é, ü, 中文",
                "tags": ["unicode", "国际化", "emoji-✨"],
            },
        )

        serializer = ModelSerializer(model=None)
        result = serializer._serialize_element(element)

        assert result["name"] == "Test Element 测试 🚀"
        assert "émojis 👍" in result["data"]["description"]
        assert "国际化" in result["data"]["tags"]

        # Verify JSON serializability
        json_str = json.dumps(result)
        assert json_str is not None

    def test_serialize_empty_model(self, temp_dir):
        """Test serialization of empty model with no elements."""
        from documentation_robotics.commands.init import ModelInitializer

        initializer = ModelInitializer(
            root_path=temp_dir,
            project_name="empty-project",
            template="basic",
            minimal=True,
            with_examples=False,
        )
        initializer.create()

        model = Model(temp_dir)
        serializer = ModelSerializer(model)
        result = serializer.serialize_model()

        assert "manifest" in result
        assert "layers" in result
        assert isinstance(result["layers"], list)

    def test_serialize_element_with_deep_nested_data(self):
        """Test serialization handles deeply nested element data."""
        nested_data = {
            "id": "test.nested.element",
            "name": "Nested Element",
            "level1": {
                "level2": {
                    "level3": {
                        "level4": {
                            "level5": {"value": "deep", "list": [1, 2, 3, {"nested": "dict"}]}
                        }
                    }
                }
            },
        }

        element = Element(
            id="test.nested.element", element_type="test", layer="test", data=nested_data
        )

        serializer = ModelSerializer(model=None)
        result = serializer._serialize_element(element)

        # Verify deep nesting is preserved
        assert result["data"]["level1"]["level2"]["level3"]["level4"]["level5"]["value"] == "deep"
        assert (
            result["data"]["level1"]["level2"]["level3"]["level4"]["level5"]["list"][3]["nested"]
            == "dict"
        )

        # Verify JSON serializability
        json_str = json.dumps(result)
        assert json_str is not None


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
