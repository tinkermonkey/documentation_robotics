"""
Unit tests for schema bundler module.
"""

import tempfile
from pathlib import Path

import pytest
from documentation_robotics.schemas.bundler import (
    LAYER_SCHEMAS,
    copy_schemas_to_project,
    get_bundled_schema_path,
    get_bundled_schemas_dir,
)


class TestSchemaBundler:
    """Test schema bundling functionality."""

    def test_get_bundled_schemas_dir(self):
        """Test getting bundled schemas directory path."""
        schemas_dir = get_bundled_schemas_dir()

        assert schemas_dir.exists(), "Bundled schemas directory should exist"
        assert schemas_dir.is_dir(), "Should be a directory"
        assert schemas_dir.name == "bundled", "Should be named 'bundled'"

    def test_get_bundled_schema_path_valid(self):
        """Test getting path to a valid bundled schema."""
        schema_filename = "01-motivation-layer.schema.json"
        schema_path = get_bundled_schema_path(schema_filename)

        assert schema_path.exists(), f"Schema {schema_filename} should exist"
        assert schema_path.is_file(), "Should be a file"
        assert schema_path.suffix == ".json", "Should be a JSON file"

    def test_get_bundled_schema_path_invalid(self):
        """Test getting path to a non-existent schema."""
        with pytest.raises(FileNotFoundError):
            get_bundled_schema_path("nonexistent.schema.json")

    def test_all_layer_schemas_exist(self):
        """Test that all 11 layer schemas are bundled."""
        assert len(LAYER_SCHEMAS) == 11, "Should have 11 layer schemas"

        for schema_filename in LAYER_SCHEMAS:
            schema_path = get_bundled_schema_path(schema_filename)
            assert schema_path.exists(), f"Schema {schema_filename} should exist"

    def test_copy_schemas_to_project(self):
        """Test copying schemas to a project directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_schemas_dir = Path(tmpdir) / ".dr" / "schemas"

            # Copy schemas
            copied_count = copy_schemas_to_project(project_schemas_dir)

            # Verify schemas were copied
            assert copied_count > 0, "Should copy at least one schema"
            assert project_schemas_dir.exists(), "Project schemas directory should be created"

            # Verify all layer schemas were copied
            for schema_filename in LAYER_SCHEMAS:
                schema_path = project_schemas_dir / schema_filename
                assert schema_path.exists(), f"Schema {schema_filename} should be copied"

    def test_copy_schemas_no_overwrite(self):
        """Test that existing schemas are not overwritten by default."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_schemas_dir = Path(tmpdir) / ".dr" / "schemas"
            project_schemas_dir.mkdir(parents=True)

            # Create a dummy schema file
            dummy_schema = project_schemas_dir / "01-motivation-layer.schema.json"
            dummy_content = '{"test": "dummy"}'
            dummy_schema.write_text(dummy_content)

            # Copy schemas (should skip existing)
            copied_count = copy_schemas_to_project(project_schemas_dir, overwrite=False)

            # Verify dummy file was not overwritten
            assert (
                dummy_schema.read_text() == dummy_content
            ), "Existing file should not be overwritten"

            # Other schemas should still be copied
            assert copied_count >= 10, "Should copy other schemas"

    def test_copy_schemas_with_overwrite(self):
        """Test that existing schemas are overwritten when requested."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_schemas_dir = Path(tmpdir) / ".dr" / "schemas"
            project_schemas_dir.mkdir(parents=True)

            # Create a dummy schema file
            dummy_schema = project_schemas_dir / "01-motivation-layer.schema.json"
            dummy_content = '{"test": "dummy"}'
            dummy_schema.write_text(dummy_content)

            # Copy schemas with overwrite
            copied_count = copy_schemas_to_project(project_schemas_dir, overwrite=True)

            # Verify dummy file was overwritten
            assert dummy_schema.read_text() != dummy_content, "Existing file should be overwritten"
            assert copied_count >= 11, "Should copy all schemas"

    def test_bundled_schemas_are_valid_json(self):
        """Test that all bundled schemas are valid JSON."""
        import json

        for schema_filename in LAYER_SCHEMAS + ["federated-architecture.schema.json"]:
            schema_path = get_bundled_schema_path(schema_filename)

            try:
                with open(schema_path, "r") as f:
                    json.load(f)
            except json.JSONDecodeError as e:
                pytest.fail(f"Schema {schema_filename} is not valid JSON: {e}")
