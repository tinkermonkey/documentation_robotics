"""
Unit tests for specification loading.

Tests the loading and serialization of the Documentation Robotics specification
from the spec directory for transmission to visualization clients.
"""

import json

import pytest
from documentation_robotics.server.specification_loader import (
    SpecificationLoader,
    serialize_specification,
)

# Test constants
EXPECTED_SHARED_SCHEMA_COUNT = (
    3  # Number of shared schemas (shared-references, link-registry, federated-architecture)
)
EXPECTED_LAYER_SCHEMA_COUNT = 3  # Number of layer schemas in test fixtures
EXPECTED_REAL_SPEC_LAYER_COUNT = 12  # Total number of layers in real DR specification


@pytest.fixture
def spec_path(temp_dir):
    """Create a mock spec directory structure."""
    spec_dir = temp_dir / "spec"
    spec_dir.mkdir()

    # Create schemas directory
    schemas_dir = spec_dir / "schemas"
    schemas_dir.mkdir()

    # Create layers directory
    layers_dir = spec_dir / "layers"
    layers_dir.mkdir()

    # Create VERSION file
    version_file = spec_dir / "VERSION"
    version_file.write_text("0.5.0")

    return spec_dir


@pytest.fixture
def spec_with_schemas(spec_path):
    """Create spec directory with sample schema files."""
    schemas_dir = spec_path / "schemas"

    # Create sample layer schemas
    layer_schemas = [
        {
            "filename": "01-motivation-layer.schema.json",
            "content": {
                "title": "Motivation Layer Schema",
                "description": "Defines elements for the Motivation layer",
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "properties": {"stakeholder": {"type": "object"}, "goal": {"type": "object"}},
            },
        },
        {
            "filename": "02-business-layer.schema.json",
            "content": {
                "title": "Business Layer Schema",
                "description": "Defines elements for the Business layer",
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "properties": {
                    "business_process": {"type": "object"},
                    "business_service": {"type": "object"},
                },
            },
        },
        {
            "filename": "06-api-layer.schema.json",
            "content": {
                "title": "API Layer Schema",
                "description": "OpenAPI-based API definitions",
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "properties": {"endpoint": {"type": "object"}, "operation": {"type": "object"}},
            },
        },
    ]

    for schema in layer_schemas:
        schema_file = schemas_dir / schema["filename"]
        with open(schema_file, "w") as f:
            json.dump(schema["content"], f)

    # Create shared schema files
    shared_refs = {
        "title": "Shared References Schema",
        "description": "Common reference types",
        "definitions": {
            "element_ref": {"type": "string", "pattern": "^[a-z_]+\\.[a-z_]+\\.[a-z0-9-]+$"}
        },
    }

    with open(schemas_dir / "shared-references.schema.json", "w") as f:
        json.dump(shared_refs, f)

    return spec_path


class TestSpecificationLoader:
    """Test SpecificationLoader class."""

    def test_init(self, spec_path):
        """Test SpecificationLoader initialization."""
        loader = SpecificationLoader(spec_path)

        assert loader.spec_path == spec_path
        assert loader.schemas_path == spec_path / "schemas"
        assert loader.layers_path == spec_path / "layers"
        assert loader.version_file == spec_path / "VERSION"

    def test_load_version(self, spec_path):
        """Test loading specification version."""
        loader = SpecificationLoader(spec_path)
        version = loader._load_version()

        assert version == "0.5.0"

    def test_load_version_missing_file(self, temp_dir):
        """Test loading version when VERSION file is missing."""
        spec_dir = temp_dir / "spec_no_version"
        spec_dir.mkdir()

        loader = SpecificationLoader(spec_dir)
        version = loader._load_version()

        assert version == "unknown"

    def test_extract_layer_name(self, spec_path):
        """Test extracting layer name from schema filename."""
        loader = SpecificationLoader(spec_path)

        assert loader._extract_layer_name("01-motivation-layer.schema.json") == "motivation"
        assert loader._extract_layer_name("02-business-layer.schema.json") == "business"
        assert loader._extract_layer_name("06-api-layer.schema.json") == "api"
        assert loader._extract_layer_name("12-testing-layer.schema.json") == "testing"

    def test_extract_layer_order(self, spec_path):
        """Test extracting layer order from schema filename."""
        loader = SpecificationLoader(spec_path)

        assert loader._extract_layer_order("01-motivation-layer.schema.json") == 1
        assert loader._extract_layer_order("02-business-layer.schema.json") == 2
        assert loader._extract_layer_order("06-api-layer.schema.json") == 6
        assert loader._extract_layer_order("12-testing-layer.schema.json") == 12

    def test_extract_layer_order_no_prefix(self, spec_path):
        """Test extracting layer order when no numeric prefix exists."""
        loader = SpecificationLoader(spec_path)

        assert loader._extract_layer_order("custom-layer.schema.json") == 0

    def test_load_layer_schemas(self, spec_with_schemas):
        """Test loading all layer schemas."""
        loader = SpecificationLoader(spec_with_schemas)
        layer_schemas = loader._load_layer_schemas()

        assert len(layer_schemas) == EXPECTED_LAYER_SCHEMA_COUNT
        assert all("name" in schema for schema in layer_schemas)
        assert all("order" in schema for schema in layer_schemas)
        assert all("schema" in schema for schema in layer_schemas)

    def test_load_layer_schemas_sorted(self, spec_with_schemas):
        """Test layer schemas are sorted by order."""
        loader = SpecificationLoader(spec_with_schemas)
        layer_schemas = loader._load_layer_schemas()

        orders = [schema["order"] for schema in layer_schemas]
        assert orders == sorted(orders)

        # Verify specific ordering
        assert layer_schemas[0]["name"] == "motivation"
        assert layer_schemas[1]["name"] == "business"
        assert layer_schemas[2]["name"] == "api"

    def test_load_layer_schemas_includes_metadata(self, spec_with_schemas):
        """Test layer schemas include title and description."""
        loader = SpecificationLoader(spec_with_schemas)
        layer_schemas = loader._load_layer_schemas()

        motivation_schema = next(s for s in layer_schemas if s["name"] == "motivation")

        assert motivation_schema["title"] == "Motivation Layer Schema"
        assert motivation_schema["description"] == "Defines elements for the Motivation layer"
        assert motivation_schema["schema_file"] == "01-motivation-layer.schema.json"

    def test_load_layer_schemas_includes_full_schema(self, spec_with_schemas):
        """Test layer schemas include complete schema definition."""
        loader = SpecificationLoader(spec_with_schemas)
        layer_schemas = loader._load_layer_schemas()

        motivation_schema = next(s for s in layer_schemas if s["name"] == "motivation")

        assert "properties" in motivation_schema["schema"]
        assert "stakeholder" in motivation_schema["schema"]["properties"]
        assert "goal" in motivation_schema["schema"]["properties"]

    def test_load_shared_schemas(self, spec_with_schemas):
        """Test loading shared reference schemas."""
        loader = SpecificationLoader(spec_with_schemas)
        shared_schemas = loader._load_shared_schemas()

        assert "shared-references" in shared_schemas
        assert shared_schemas["shared-references"]["title"] == "Shared References Schema"

    def test_load_shared_schemas_missing_files(self, spec_path):
        """Test loading shared schemas when files don't exist."""
        loader = SpecificationLoader(spec_path)
        shared_schemas = loader._load_shared_schemas()

        # Should return empty dict, not crash
        assert isinstance(shared_schemas, dict)

    def test_load_specification_complete(self, spec_with_schemas):
        """Test loading complete specification."""
        loader = SpecificationLoader(spec_with_schemas)
        spec_data = loader.load_specification()

        assert "version" in spec_data
        assert "layers" in spec_data
        assert "shared_schemas" in spec_data
        assert "metadata" in spec_data

    def test_load_specification_version(self, spec_with_schemas):
        """Test specification includes correct version."""
        loader = SpecificationLoader(spec_with_schemas)
        spec_data = loader.load_specification()

        assert spec_data["version"] == "0.5.0"

    def test_load_specification_metadata(self, spec_with_schemas):
        """Test specification includes metadata."""
        loader = SpecificationLoader(spec_with_schemas)
        spec_data = loader.load_specification()

        assert "spec_path" in spec_data["metadata"]
        assert "loaded_at" in spec_data["metadata"]

        # Verify timestamp format
        timestamp = spec_data["metadata"]["loaded_at"]
        assert "T" in timestamp
        assert "Z" in timestamp

    def test_load_specification_json_serializable(self, spec_with_schemas):
        """Test that loaded specification is JSON-serializable."""
        loader = SpecificationLoader(spec_with_schemas)
        spec_data = loader.load_specification()

        # Should not raise exception
        json_str = json.dumps(spec_data)
        assert json_str is not None

        # Verify it can be parsed back
        parsed = json.loads(json_str)
        assert "version" in parsed
        assert "layers" in parsed


class TestSpecificationSerialization:
    """Test specification serialization for WebSocket transmission."""

    def test_serialize_specification_passthrough(self, spec_with_schemas):
        """Test serialize_specification returns data as-is."""
        loader = SpecificationLoader(spec_with_schemas)
        spec_data = loader.load_specification()

        serialized = serialize_specification(spec_data)

        # Currently should be identical (passthrough)
        assert serialized == spec_data

    def test_serialize_specification_preserves_structure(self, spec_with_schemas):
        """Test serialization preserves all required fields."""
        loader = SpecificationLoader(spec_with_schemas)
        spec_data = loader.load_specification()

        serialized = serialize_specification(spec_data)

        assert "version" in serialized
        assert "layers" in serialized
        assert "shared_schemas" in serialized
        assert "metadata" in serialized

    def test_serialize_specification_json_safe(self, spec_with_schemas):
        """Test serialized specification is JSON-safe."""
        loader = SpecificationLoader(spec_with_schemas)
        spec_data = loader.load_specification()

        serialized = serialize_specification(spec_data)

        # Should be JSON-serializable
        json_str = json.dumps(serialized)
        assert json_str is not None


class TestErrorHandling:
    """Test error handling in specification loading."""

    def test_load_specification_with_invalid_json(self, spec_path):
        """Test loading specification handles invalid JSON gracefully."""
        schemas_dir = spec_path / "schemas"

        # Create invalid JSON file
        invalid_file = schemas_dir / "01-broken-layer.schema.json"
        invalid_file.write_text("{ invalid json }")

        loader = SpecificationLoader(spec_path)
        layer_schemas = loader._load_layer_schemas()

        # Should skip broken file and continue
        assert isinstance(layer_schemas, list)

    def test_load_specification_with_missing_schema_fields(self, spec_path):
        """Test loading specification handles schemas with missing fields."""
        schemas_dir = spec_path / "schemas"

        # Create schema with missing fields
        minimal_schema = {"title": "Minimal Schema"}

        schema_file = schemas_dir / "01-minimal-layer.schema.json"
        with open(schema_file, "w") as f:
            json.dump(minimal_schema, f)

        loader = SpecificationLoader(spec_path)
        layer_schemas = loader._load_layer_schemas()

        assert len(layer_schemas) == 1
        assert layer_schemas[0]["title"] == "Minimal Schema"
        assert layer_schemas[0]["description"] == ""  # Should default to empty string

    def test_load_shared_schemas_with_invalid_json(self, spec_path):
        """Test loading shared schemas handles invalid JSON gracefully."""
        schemas_dir = spec_path / "schemas"

        # Create invalid JSON file
        invalid_file = schemas_dir / "shared-references.schema.json"
        invalid_file.write_text("{ invalid json }")

        loader = SpecificationLoader(spec_path)
        shared_schemas = loader._load_shared_schemas()

        # Should return empty dict for that schema
        assert isinstance(shared_schemas, dict)
