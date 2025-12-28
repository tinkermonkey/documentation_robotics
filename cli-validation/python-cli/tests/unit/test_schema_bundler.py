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
        """Test that all 12 layer schemas are bundled."""
        assert len(LAYER_SCHEMAS) == 12, "Should have 12 layer schemas"

        for schema_filename in LAYER_SCHEMAS:
            schema_path = get_bundled_schema_path(schema_filename)
            assert schema_path.exists(), f"Schema {schema_filename} should exist"

    def test_copy_schemas_to_project(self):
        """Test copying schemas to a project directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_schemas_dir = Path(tmpdir) / ".dr" / "schemas"

            # Copy schemas
            copied_count = copy_schemas_to_project(project_schemas_dir)

            # Verify schemas were copied (12 layer schemas + additional files)
            assert copied_count >= 13, "Should copy all 12 layer schemas + additional files"
            assert project_schemas_dir.exists(), "Project schemas directory should be created"

            # Verify all layer schemas were copied
            for schema_filename in LAYER_SCHEMAS:
                schema_path = project_schemas_dir / schema_filename
                assert schema_path.exists(), f"Schema {schema_filename} should be copied"

            # Verify link-registry.json was copied
            link_registry = project_schemas_dir / "link-registry.json"
            assert link_registry.exists(), "link-registry.json should be copied"

    def test_copy_schemas_always_overwrites(self):
        """Test that schemas are always overwritten (CLI owns .dr/)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_schemas_dir = Path(tmpdir) / ".dr" / "schemas"
            project_schemas_dir.mkdir(parents=True)

            # Create a dummy schema file
            dummy_schema = project_schemas_dir / "01-motivation-layer.schema.json"
            dummy_content = '{"test": "dummy"}'
            dummy_schema.write_text(dummy_content)

            # Copy schemas - should always overwrite
            copied_count = copy_schemas_to_project(project_schemas_dir)

            # Verify dummy file was overwritten
            assert dummy_schema.read_text() != dummy_content, "CLI should overwrite existing files"
            assert copied_count >= 12, "Should copy all schemas"

    def test_copy_schemas_cleans_obsolete_files(self):
        """Test that obsolete files are removed (CLI owns .dr/)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_schemas_dir = Path(tmpdir) / ".dr" / "schemas"
            project_schemas_dir.mkdir(parents=True)

            # Create an obsolete schema file
            obsolete_schema = project_schemas_dir / "99-obsolete-layer.schema.json"
            obsolete_schema.write_text('{"test": "obsolete"}')

            # Copy schemas - should clean obsolete files
            copy_schemas_to_project(project_schemas_dir)

            # Verify obsolete file was removed
            assert not obsolete_schema.exists(), "CLI should remove obsolete files"

            # Verify all current schemas exist
            for schema_filename in LAYER_SCHEMAS:
                schema_path = project_schemas_dir / schema_filename
                assert schema_path.exists(), f"Schema {schema_filename} should exist"

    def test_bundled_schemas_are_valid_json(self):
        """Test that all bundled schemas are valid JSON."""
        import json

        for schema_filename in LAYER_SCHEMAS:
            schema_path = get_bundled_schema_path(schema_filename)

            try:
                with open(schema_path, "r") as f:
                    json.load(f)
            except json.JSONDecodeError as e:
                pytest.fail(f"Schema {schema_filename} is not valid JSON: {e}")
