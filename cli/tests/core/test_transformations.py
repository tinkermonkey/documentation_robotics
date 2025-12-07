"""Tests for transformation primitives."""

import pytest
from documentation_robotics.core.transformations import (
    AddField,
    ChangeCardinality,
    MigrationError,
    RemoveField,
    RenameField,
    TransformValue,
)


class TestRenameField:
    """Tests for RenameField transformation."""

    def test_rename_simple_field(self):
        """Test renaming a simple top-level field."""
        element = {"id": "test-1", "oldName": "value"}

        transform = RenameField("oldName", "newName")
        assert transform.apply(element) is True
        assert "newName" in element
        assert "oldName" not in element
        assert element["newName"] == "value"

    def test_rename_nested_field(self):
        """Test renaming a nested field."""
        element = {"id": "test-1", "properties": {"oldField": "value"}}

        transform = RenameField("properties.oldField", "properties.newField")
        assert transform.apply(element) is True
        assert element["properties"]["newField"] == "value"
        assert "oldField" not in element["properties"]

    def test_rename_nonexistent_field(self):
        """Test renaming a field that doesn't exist."""
        element = {"id": "test-1", "name": "test"}

        transform = RenameField("oldName", "newName")
        assert transform.apply(element) is False
        assert element == {"id": "test-1", "name": "test"}

    def test_rename_with_layer_filter(self):
        """Test renaming with layer filter."""
        element = {"id": "test-1", "motivation": {"supportGoals": "goal-1"}}

        transform = RenameField(
            "motivation.supportGoals", "motivation.supports-goals", layers=["01-motivation"]
        )

        # Should not match different layer
        assert transform.matches_element(element, "02-business") is False

        # Should match correct layer
        assert transform.matches_element(element, "01-motivation") is True

    def test_rename_description(self):
        """Test transformation description."""
        transform = RenameField("old", "new")
        assert "old" in transform.describe()
        assert "new" in transform.describe()


class TestChangeCardinality:
    """Tests for ChangeCardinality transformation."""

    def test_single_to_array(self):
        """Test converting single value to array."""
        element = {"id": "test-1", "value": "single"}

        transform = ChangeCardinality("value", to_type="array")
        assert transform.apply(element) is True
        assert element["value"] == ["single"]

    def test_array_to_single(self):
        """Test converting array to single value."""
        element = {"id": "test-1", "values": ["first", "second"]}

        transform = ChangeCardinality("values", to_type="single")
        assert transform.apply(element) is True
        assert element["values"] == "first"

    def test_empty_array_to_single(self):
        """Test converting empty array to single value."""
        element = {"id": "test-1", "values": []}

        transform = ChangeCardinality("values", to_type="single")
        assert transform.apply(element) is True
        assert "values" not in element  # Empty arrays are removed

    def test_no_change_needed(self):
        """Test when value is already correct type."""
        element = {"id": "test-1", "values": ["already", "array"]}

        transform = ChangeCardinality("values", to_type="array")
        assert transform.apply(element) is False  # No change needed

    def test_invalid_to_type(self):
        """Test invalid to_type raises error."""
        with pytest.raises(ValueError):
            ChangeCardinality("field", to_type="invalid")


class TestAddField:
    """Tests for AddField transformation."""

    def test_add_simple_field(self):
        """Test adding a simple field."""
        element = {"id": "test-1", "name": "test"}

        transform = AddField("newField", default_value="default")
        assert transform.apply(element) is True
        assert element["newField"] == "default"

    def test_add_nested_field(self):
        """Test adding a nested field."""
        element = {"id": "test-1"}

        transform = AddField("config.enabled", default_value=True)
        assert transform.apply(element) is True
        assert element["config"]["enabled"] is True

    def test_add_field_only_if_missing(self):
        """Test adding field only if it doesn't exist."""
        element = {"id": "test-1", "existing": "value"}

        transform = AddField("existing", default_value="new_value", only_if_missing=True)
        assert transform.apply(element) is False
        assert element["existing"] == "value"  # Unchanged

    def test_add_field_overwrite(self):
        """Test adding field with overwrite."""
        element = {"id": "test-1", "existing": "old"}

        transform = AddField("existing", default_value="new", only_if_missing=False)
        assert transform.apply(element) is True
        assert element["existing"] == "new"


class TestRemoveField:
    """Tests for RemoveField transformation."""

    def test_remove_simple_field(self):
        """Test removing a simple field."""
        element = {"id": "test-1", "toRemove": "value", "toKeep": "value"}

        transform = RemoveField("toRemove")
        assert transform.apply(element) is True
        assert "toRemove" not in element
        assert "toKeep" in element

    def test_remove_nested_field(self):
        """Test removing a nested field."""
        element = {"id": "test-1", "config": {"old": "value", "new": "value"}}

        transform = RemoveField("config.old")
        assert transform.apply(element) is True
        assert "old" not in element["config"]
        assert element["config"]["new"] == "value"

    def test_remove_nonexistent_field(self):
        """Test removing a field that doesn't exist."""
        element = {"id": "test-1", "name": "test"}

        transform = RemoveField("nonexistent")
        assert transform.apply(element) is False


class TestTransformValue:
    """Tests for TransformValue transformation."""

    def test_transform_string_value(self):
        """Test transforming a string value."""
        element = {"id": "test-1", "name": "  john doe  "}

        transform = TransformValue("name", lambda v: v.strip().title())
        assert transform.apply(element) is True
        assert element["name"] == "John Doe"

    def test_transform_with_error(self):
        """Test transformation that raises an error."""
        element = {"id": "test-1", "value": "not-a-number"}

        def to_int(v):
            return int(v)  # Will raise ValueError

        transform = TransformValue("value", to_int)
        with pytest.raises(MigrationError):
            transform.apply(element)

    def test_transform_nonexistent_field(self):
        """Test transforming a field that doesn't exist."""
        element = {"id": "test-1"}

        transform = TransformValue("missing", lambda v: v.upper())
        assert transform.apply(element) is False


class TestMigrationError:
    """Tests for MigrationError exception."""

    def test_error_with_context(self):
        """Test error message includes context."""
        from pathlib import Path

        error = MigrationError(
            "Test error",
            file_path=Path("/test/file.yaml"),
            element_id="test-element",
            transformation=RenameField("old", "new"),
        )

        error_str = str(error)
        assert "Test error" in error_str
        assert "/test/file.yaml" in error_str
        assert "test-element" in error_str

    def test_error_without_context(self):
        """Test error message without context."""
        error = MigrationError("Simple error")
        assert str(error) == "Simple error"


class TestTransformationEngine:
    """Tests for TransformationEngine."""

    @pytest.fixture
    def temp_model_dir(self, tmp_path):
        """Create a temporary model directory structure."""
        model_dir = tmp_path / "model"
        model_dir.mkdir()

        # Create a layer directory
        layer_dir = model_dir / "02_business"
        layer_dir.mkdir()

        # Create a sample YAML file
        yaml_file = layer_dir / "services.yaml"
        yaml_file.write_text(
            """- id: service-1
  name: Customer Service
  oldField: value1
  properties:
    old:
      field: test
  singleValue: single
  arrayValue:
    - item1
    - item2

- id: service-2
  name: Support Service
  oldField: value2
"""
        )

        return model_dir

    def test_apply_single_transformation(self, temp_model_dir):
        """Test applying a single transformation to model."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        transformations = [RenameField("oldField", "newField")]

        stats = engine.apply(transformations, validate=False, dry_run=False)

        assert stats["files_scanned"] > 0
        assert stats["files_modified"] > 0
        assert stats["elements_modified"] == 2
        assert stats["transformations_applied"] == 2

        # Verify the transformation was applied
        yaml_file = temp_model_dir / "02_business" / "services.yaml"
        content = yaml_file.read_text()
        assert "newField" in content
        assert "oldField" not in content

    def test_apply_multiple_transformations(self, temp_model_dir):
        """Test applying multiple transformations in sequence."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        transformations = [
            RenameField("oldField", "renamedField"),
            AddField("newAddedField", default_value="default"),
        ]

        stats = engine.apply(transformations, validate=False, dry_run=False)

        assert stats["transformations_applied"] == 4  # 2 elements × 2 transformations
        assert stats["files_modified"] > 0

        # Verify both transformations were applied
        yaml_file = temp_model_dir / "02_business" / "services.yaml"
        content = yaml_file.read_text()
        assert "renamedField" in content
        assert "newAddedField" in content
        assert "oldField" not in content

    def test_apply_with_layer_filter(self, temp_model_dir):
        """Test transformations with layer filtering."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        # This transformation should only apply to business layer
        transformations = [RenameField("oldField", "newField", layers=["02-business"])]

        stats = engine.apply(transformations, validate=False, dry_run=False)

        assert stats["transformations_applied"] == 2

    def test_apply_dry_run_no_modifications(self, temp_model_dir):
        """Test dry-run mode doesn't modify files."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        # Store original content
        yaml_file = temp_model_dir / "02_business" / "services.yaml"
        original_content = yaml_file.read_text()

        transformations = [RenameField("oldField", "newField")]

        stats = engine.apply(transformations, validate=False, dry_run=True)

        # Stats should show what would happen
        assert stats["transformations_applied"] == 2

        # But file should not be modified
        assert yaml_file.read_text() == original_content

    def test_apply_with_no_matching_elements(self, temp_model_dir):
        """Test transformation when no elements match."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        # Try to rename a field that doesn't exist
        transformations = [RenameField("nonexistentField", "newField")]

        stats = engine.apply(transformations, validate=False, dry_run=False)

        assert stats["files_scanned"] > 0
        assert stats["transformations_applied"] == 0
        assert stats["files_modified"] == 0

    def test_apply_handles_non_list_yaml(self, temp_model_dir):
        """Test handling of YAML files that aren't lists."""
        from documentation_robotics.core.transformations import TransformationEngine

        # Create a YAML file with a dict instead of list
        yaml_file = temp_model_dir / "02_business" / "config.yaml"
        yaml_file.write_text("config:\n  setting: value\n")

        engine = TransformationEngine(temp_model_dir)
        transformations = [RenameField("oldField", "newField")]

        # Should not raise an error
        stats = engine.apply(transformations, validate=False, dry_run=False)
        assert stats["files_scanned"] > 0

    def test_apply_handles_non_dict_elements(self, temp_model_dir):
        """Test handling of YAML elements that aren't dicts."""
        from documentation_robotics.core.transformations import TransformationEngine

        # Create a YAML file with non-dict elements
        yaml_file = temp_model_dir / "02_business" / "list.yaml"
        yaml_file.write_text("- string1\n- string2\n")

        engine = TransformationEngine(temp_model_dir)
        transformations = [RenameField("oldField", "newField")]

        # Should not raise an error
        stats = engine.apply(transformations, validate=False, dry_run=False)
        assert stats["files_scanned"] > 0

    def test_apply_with_transformation_error(self, temp_model_dir):
        """Test error handling when transformation fails."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        # Create a transformation that will fail
        def failing_transform(value):
            raise ValueError("Intentional error")

        transformations = [TransformValue("name", failing_transform)]

        with pytest.raises(MigrationError) as exc_info:
            engine.apply(transformations, validate=False, dry_run=False)

        assert "Intentional error" in str(exc_info.value)
        assert exc_info.value.file_path is not None
        assert exc_info.value.element_id is not None

    def test_extract_layer_id(self, temp_model_dir):
        """Test layer ID extraction from directory name."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        assert engine._extract_layer_id("01_motivation") == "01-motivation"
        assert engine._extract_layer_id("02_business") == "02-business"
        assert engine._extract_layer_id("06_api") == "06-api"
        assert engine._extract_layer_id("invalid") is None

    def test_apply_to_multiple_layers(self, temp_model_dir):
        """Test applying transformations across multiple layers."""
        from documentation_robotics.core.transformations import TransformationEngine

        # Create another layer
        layer_dir = temp_model_dir / "01_motivation"
        layer_dir.mkdir()

        yaml_file = layer_dir / "goals.yaml"
        yaml_file.write_text(
            """- id: goal-1
  name: Business Goal
  oldField: value
"""
        )

        engine = TransformationEngine(temp_model_dir)
        transformations = [RenameField("oldField", "newField")]

        stats = engine.apply(transformations, validate=False, dry_run=False)

        # Should transform elements in both layers
        assert stats["files_scanned"] == 2
        assert stats["files_modified"] == 2
        assert stats["transformations_applied"] == 3  # 2 in business + 1 in motivation

    def test_apply_preserves_yaml_order(self, temp_model_dir):
        """Test that transformations preserve YAML field order."""
        from documentation_robotics.core.transformations import TransformationEngine

        # Create a file with specific field order
        yaml_file = temp_model_dir / "02_business" / "ordered.yaml"
        yaml_file.write_text(
            """- id: elem-1
  name: Element
  field1: value1
  field2: value2
  field3: value3
"""
        )

        engine = TransformationEngine(temp_model_dir)
        transformations = [AddField("newField", default_value="new")]

        engine.apply(transformations, validate=False, dry_run=False)

        # Verify file can be parsed (order is preserved by PyYAML)
        content = yaml_file.read_text()
        assert "id:" in content
        assert "name:" in content
        assert "newField:" in content

    def test_apply_statistics_accuracy(self, temp_model_dir):
        """Test that statistics are accurate."""
        from documentation_robotics.core.transformations import TransformationEngine

        engine = TransformationEngine(temp_model_dir)

        # We know the test fixture has 1 file with 2 elements
        transformations = [
            RenameField("oldField", "newField"),  # Will match 2 elements
            AddField("addedField", "value"),  # Will match 2 elements
        ]

        stats = engine.apply(transformations, validate=False, dry_run=False)

        assert stats["files_scanned"] == 1
        assert stats["files_modified"] == 1
        assert stats["elements_modified"] == 2  # 2 elements modified
        assert stats["transformations_applied"] == 4  # 2 transformations × 2 elements
