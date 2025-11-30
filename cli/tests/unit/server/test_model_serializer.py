"""
Unit tests for model serialization functions.

Tests ModelSerializer class and helper functions for converting
model objects to JSON-serializable dictionaries.
"""

from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from documentation_robotics.core.element import Element
from documentation_robotics.core.layer import Layer
from documentation_robotics.core.manifest import Manifest
from documentation_robotics.core.model import Model
from documentation_robotics.server.model_serializer import (
    ModelSerializer,
    load_changesets,
    serialize_model_state,
)


class TestModelSerializer:
    """Test ModelSerializer class."""

    def test_serializer_initialization(self):
        """Test serializer initializes with model."""
        mock_model = Mock(spec=Model)
        serializer = ModelSerializer(mock_model)

        assert serializer.model == mock_model

    def test_serialize_manifest(self):
        """Test manifest serialization."""
        mock_manifest = Mock(spec=Manifest)
        mock_manifest.version = "1.0.0"
        mock_manifest.specification_version = "0.5.0"
        mock_manifest.project = {"name": "Test Project"}
        mock_manifest.conventions = {"id_separator": "."}
        mock_manifest.data = {
            "created": "2024-01-01T00:00:00Z",
            "updated": "2024-01-02T00:00:00Z",
        }

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest

        serializer = ModelSerializer(mock_model)
        result = serializer._serialize_manifest()

        assert result["version"] == "1.0.0"
        assert result["spec_version"] == "0.5.0"
        assert result["project"] == {"name": "Test Project"}
        assert result["conventions"] == {"id_separator": "."}
        assert result["created"] == "2024-01-01T00:00:00Z"
        assert result["updated"] == "2024-01-02T00:00:00Z"

    def test_serialize_element(self):
        """Test element serialization."""
        mock_element = Mock(spec=Element)
        mock_element.id = "business.service.customer"
        mock_element.type = "BusinessService"
        mock_element.name = "Customer Service"
        mock_element.data = {"description": "Customer management"}
        mock_element.file_path = Path("/model/business/customer-service.yaml")

        mock_model = Mock(spec=Model)
        serializer = ModelSerializer(mock_model)

        result = serializer._serialize_element(mock_element)

        assert result["id"] == "business.service.customer"
        assert result["type"] == "BusinessService"
        assert result["name"] == "Customer Service"
        assert result["data"] == {"description": "Customer management"}
        assert "customer-service.yaml" in result["file_path"]

    def test_serialize_element_without_file_path(self):
        """Test element serialization without file_path attribute."""
        mock_element = Mock(spec=Element)
        mock_element.id = "elem-1"
        mock_element.type = "TestElement"
        mock_element.name = "Test"
        mock_element.data = {}
        # Remove file_path attribute
        delattr(mock_element, "file_path")

        mock_model = Mock(spec=Model)
        serializer = ModelSerializer(mock_model)

        result = serializer._serialize_element(mock_element)

        assert result["file_path"] is None

    def test_serialize_elements(self):
        """Test serializing multiple elements."""
        elem1 = Mock(spec=Element)
        elem1.id = "elem-1"
        elem1.type = "Type1"
        elem1.name = "Element 1"
        elem1.data = {}

        elem2 = Mock(spec=Element)
        elem2.id = "elem-2"
        elem2.type = "Type2"
        elem2.name = "Element 2"
        elem2.data = {}

        mock_layer = Mock(spec=Layer)
        mock_layer.elements = {"elem-1": elem1, "elem-2": elem2}

        mock_model = Mock(spec=Model)
        serializer = ModelSerializer(mock_model)

        result = serializer._serialize_elements(mock_layer)

        assert len(result) == 2
        assert any(e["id"] == "elem-1" for e in result)
        assert any(e["id"] == "elem-2" for e in result)

    def test_serialize_layer(self):
        """Test layer serialization."""
        elem = Mock(spec=Element)
        elem.id = "test-elem"
        elem.type = "TestType"
        elem.name = "Test Element"
        elem.data = {}

        mock_layer = Mock(spec=Layer)
        mock_layer.elements = {"test-elem": elem}

        layer_config = {
            "name": "Business Layer",
            "order": 1,
            "path": "business",
            "enabled": True,
            "elements": {"service": 5},
        }

        mock_manifest = Mock(spec=Manifest)
        mock_manifest.layers = {"business": layer_config}

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest

        serializer = ModelSerializer(mock_model)
        result = serializer._serialize_layer("business", mock_layer)

        assert result["name"] == "business"
        assert result["display_name"] == "Business Layer"
        assert result["order"] == 1
        assert result["path"] == "business"
        assert result["enabled"] is True
        assert result["element_counts"] == {"service": 5}
        assert len(result["elements"]) == 1

    def test_serialize_layers(self):
        """Test serializing all enabled layers."""
        elem1 = Mock(spec=Element)
        elem1.id = "elem-1"
        elem1.type = "Type1"
        elem1.name = "Element 1"
        elem1.data = {}

        layer1 = Mock(spec=Layer)
        layer1.elements = {"elem-1": elem1}

        elem2 = Mock(spec=Element)
        elem2.id = "elem-2"
        elem2.type = "Type2"
        elem2.name = "Element 2"
        elem2.data = {}

        layer2 = Mock(spec=Layer)
        layer2.elements = {"elem-2": elem2}

        mock_manifest = Mock(spec=Manifest)
        mock_manifest.layers = {
            "business": {"enabled": True, "order": 1},
            "application": {"enabled": True, "order": 2},
            "disabled_layer": {"enabled": False, "order": 3},
        }

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest
        mock_model.get_layer = Mock(
            side_effect=lambda name: {
                "business": layer1,
                "application": layer2,
                "disabled_layer": None,
            }.get(name)
        )

        serializer = ModelSerializer(mock_model)
        result = serializer._serialize_layers()

        # Should only include enabled layers
        assert len(result) == 2
        assert result[0]["name"] == "business"  # order 1 first
        assert result[1]["name"] == "application"  # order 2 second

    def test_serialize_statistics(self):
        """Test statistics serialization."""
        stats = {
            "total_elements": 42,
            "layers_enabled": 12,
            "last_modified": "2024-01-01T00:00:00Z",
        }

        mock_manifest = Mock(spec=Manifest)
        mock_manifest.statistics = stats.copy()

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest

        serializer = ModelSerializer(mock_model)
        result = serializer._serialize_statistics()

        assert result == stats

    def test_serialize_model(self):
        """Test complete model serialization."""
        mock_manifest = Mock(spec=Manifest)
        mock_manifest.version = "1.0.0"
        mock_manifest.specification_version = "0.5.0"
        mock_manifest.project = {"name": "Test"}
        mock_manifest.conventions = {}
        mock_manifest.data = {}
        mock_manifest.layers = {"business": {"enabled": True, "order": 1}}
        mock_manifest.statistics = {"total_elements": 1}

        elem = Mock(spec=Element)
        elem.id = "elem-1"
        elem.type = "Type1"
        elem.name = "Element"
        elem.data = {}

        layer = Mock(spec=Layer)
        layer.elements = {"elem-1": elem}

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest
        mock_model.get_layer = Mock(return_value=layer)

        serializer = ModelSerializer(mock_model)
        result = serializer.serialize_model()

        assert "manifest" in result
        assert "layers" in result
        assert "statistics" in result
        assert result["manifest"]["version"] == "1.0.0"
        assert len(result["layers"]) == 1
        assert result["statistics"]["total_elements"] == 1

    def test_serialize_element_update_found(self):
        """Test serializing element update when element exists."""
        mock_element = Mock(spec=Element)
        mock_element.id = "test-elem"
        mock_element.type = "TestType"
        mock_element.name = "Test"
        mock_element.data = {}

        mock_model = Mock(spec=Model)
        mock_model.get_element = Mock(return_value=mock_element)

        serializer = ModelSerializer(mock_model)
        result = serializer.serialize_element_update("test-elem")

        assert result is not None
        assert result["id"] == "test-elem"
        assert result["type"] == "TestType"

    def test_serialize_element_update_not_found(self):
        """Test serializing element update when element doesn't exist."""
        mock_model = Mock(spec=Model)
        mock_model.get_element = Mock(return_value=None)

        serializer = ModelSerializer(mock_model)
        result = serializer.serialize_element_update("nonexistent")

        assert result is None


class TestLoadChangesets:
    """Test load_changesets function."""

    def test_load_changesets_empty_directory(self, tmp_path):
        """Test loading changesets from empty directory."""
        changesets_path = tmp_path / ".dr" / "changesets"
        changesets_path.mkdir(parents=True)

        result = load_changesets(tmp_path)

        assert result == []

    def test_load_changesets_no_directory(self, tmp_path):
        """Test loading changesets when directory doesn't exist."""
        result = load_changesets(tmp_path)

        assert result == []

    @patch("documentation_robotics.server.model_serializer.Changeset")
    def test_load_changesets_with_valid_changeset(self, mock_changeset_class, tmp_path):
        """Test loading valid changesets."""
        changesets_path = tmp_path / ".dr" / "changesets"
        changesets_path.mkdir(parents=True)

        # Create changeset directory
        changeset_dir = changesets_path / "test-changeset"
        changeset_dir.mkdir()

        # Mock changeset
        mock_metadata = Mock()
        mock_metadata.id = "test-changeset"
        mock_metadata.name = "Test Changeset"
        mock_metadata.description = "Test description"
        mock_metadata.type = "feature"
        mock_metadata.status = "active"
        mock_metadata.created_at = Mock()
        mock_metadata.created_at.isoformat = Mock(return_value="2024-01-01T00:00:00Z")
        mock_metadata.updated_at = Mock()
        mock_metadata.updated_at.isoformat = Mock(return_value="2024-01-01T00:00:00Z")
        mock_metadata.workflow = "direct-cli"
        mock_metadata.summary = {"elements_added": 1}

        mock_changeset = Mock()
        mock_changeset.metadata = mock_metadata
        mock_changeset.get_changes = Mock(return_value=[])

        mock_changeset_class.return_value = mock_changeset

        result = load_changesets(tmp_path)

        assert len(result) == 1
        assert result[0]["id"] == "test-changeset"
        assert result[0]["name"] == "Test Changeset"
        assert result[0]["type"] == "feature"

    @patch("documentation_robotics.server.model_serializer.Changeset")
    def test_load_changesets_handles_errors(self, mock_changeset_class, tmp_path):
        """Test loading changesets handles errors gracefully."""
        changesets_path = tmp_path / ".dr" / "changesets"
        changesets_path.mkdir(parents=True)

        # Create two changeset directories
        (changesets_path / "valid").mkdir()
        (changesets_path / "invalid").mkdir()

        def changeset_side_effect(changeset_id, path):
            if "invalid" in str(path):
                raise ValueError("Invalid changeset")
            # Return valid changeset
            mock_metadata = Mock()
            mock_metadata.id = "valid"
            mock_metadata.name = "Valid"
            mock_metadata.description = "Valid changeset"
            mock_metadata.type = "feature"
            mock_metadata.status = "active"
            mock_metadata.created_at = Mock()
            mock_metadata.created_at.isoformat = Mock(return_value="2024-01-01T00:00:00Z")
            mock_metadata.updated_at = Mock()
            mock_metadata.updated_at.isoformat = Mock(return_value="2024-01-01T00:00:00Z")
            mock_metadata.workflow = "direct-cli"
            mock_metadata.summary = {}

            mock_changeset = Mock()
            mock_changeset.metadata = mock_metadata
            mock_changeset.get_changes = Mock(return_value=[])
            return mock_changeset

        mock_changeset_class.side_effect = changeset_side_effect

        result = load_changesets(tmp_path)

        # Should only include valid changeset
        assert len(result) == 1
        assert result[0]["id"] == "valid"


class TestSerializeModelState:
    """Test serialize_model_state function."""

    def test_serialize_model_state(self, tmp_path):
        """Test serializing complete model state."""
        # Mock model
        mock_manifest = Mock(spec=Manifest)
        mock_manifest.version = "1.0.0"
        mock_manifest.specification_version = "0.5.0"
        mock_manifest.project = {}
        mock_manifest.conventions = {}
        mock_manifest.data = {}
        mock_manifest.layers = {}
        mock_manifest.statistics = {}

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest

        # Mock load_changesets
        with patch(
            "documentation_robotics.server.model_serializer.load_changesets",
            return_value=[{"id": "test"}],
        ):
            result = serialize_model_state(mock_model, tmp_path)

        assert "model" in result
        assert "changesets" in result
        assert "manifest" in result["model"]
        assert len(result["changesets"]) == 1

    def test_serialize_model_state_no_changesets(self, tmp_path):
        """Test serializing model state without changesets."""
        mock_manifest = Mock(spec=Manifest)
        mock_manifest.version = "1.0.0"
        mock_manifest.specification_version = "0.5.0"
        mock_manifest.project = {}
        mock_manifest.conventions = {}
        mock_manifest.data = {}
        mock_manifest.layers = {}
        mock_manifest.statistics = {}

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest

        # No changesets directory
        result = serialize_model_state(mock_model, tmp_path)

        assert result["changesets"] == []


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_layer(self):
        """Test serializing layer with no elements."""
        mock_layer = Mock(spec=Layer)
        mock_layer.elements = {}

        mock_manifest = Mock(spec=Manifest)
        mock_manifest.layers = {"empty": {"enabled": True}}

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest

        serializer = ModelSerializer(mock_model)
        result = serializer._serialize_layer("empty", mock_layer)

        assert result["elements"] == []

    def test_missing_optional_fields(self):
        """Test handling elements with missing optional fields."""
        mock_element = Mock(spec=Element)
        mock_element.id = "elem-1"
        mock_element.type = "Type1"
        mock_element.name = "Element"
        mock_element.data = None  # None instead of dict

        mock_model = Mock(spec=Model)
        serializer = ModelSerializer(mock_model)

        # Should not raise exception
        result = serializer._serialize_element(mock_element)
        assert result["data"] is None

    def test_layer_ordering(self):
        """Test layers are ordered correctly."""
        layer1 = Mock(spec=Layer)
        layer1.elements = {}

        layer2 = Mock(spec=Layer)
        layer2.elements = {}

        layer3 = Mock(spec=Layer)
        layer3.elements = {}

        mock_manifest = Mock(spec=Manifest)
        mock_manifest.layers = {
            "layer3": {"enabled": True, "order": 30},
            "layer1": {"enabled": True, "order": 10},
            "layer2": {"enabled": True, "order": 20},
        }

        mock_model = Mock(spec=Model)
        mock_model.manifest = mock_manifest
        mock_model.get_layer = Mock(
            side_effect=lambda name: {"layer1": layer1, "layer2": layer2, "layer3": layer3}.get(
                name
            )
        )

        serializer = ModelSerializer(mock_model)
        result = serializer._serialize_layers()

        # Should be ordered by order field
        assert result[0]["name"] == "layer1"
        assert result[1]["name"] == "layer2"
        assert result[2]["name"] == "layer3"
