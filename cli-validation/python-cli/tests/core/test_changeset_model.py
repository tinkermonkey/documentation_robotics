"""
Integration tests for ChangesetModel class.
"""

import tempfile
from pathlib import Path

import pytest
from documentation_robotics.core.changeset import Change
from documentation_robotics.core.changeset_manager import ChangesetManager
from documentation_robotics.core.element import Element
from documentation_robotics.core.model import Model


class TestChangesetModel:
    """Integration tests for ChangesetModel class."""

    @pytest.fixture
    def temp_model(self):
        """Create a temporary model for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # Initialize a minimal model structure
            model_path = root / "documentation-robotics" / "model"
            model_path.mkdir(parents=True)

            # Create a simple manifest
            manifest_path = model_path / "manifest.yaml"
            manifest_content = """
version: "0.1.0"
project:
  name: Test Project
layers:
  business:
    enabled: true
    path: documentation-robotics/model/02_business
    schema: .dr/schemas/02-business-layer.schema.json
"""
            manifest_path.write_text(manifest_content)

            # Create business layer directory
            business_path = model_path / "02_business"
            business_path.mkdir(parents=True)

            # Create an empty services file
            services_file = business_path / "services.yaml"
            services_file.write_text("")

            yield root

    def test_load_model_in_changeset_context(self, temp_model):
        """Test loading model in changeset context."""
        # Create changeset
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")

        # Load model in changeset context
        model = Model.load(temp_model, changeset=changeset_id)

        assert hasattr(model, "changeset_id")
        assert model.changeset_id == changeset_id

    def test_add_element_tracks_change(self, temp_model):
        """Test that adding an element tracks the change."""
        # Create changeset
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")

        # Load model in changeset context
        model = Model.load(temp_model, changeset=changeset_id)

        # Add element
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )

        model.add_element("business", element)

        # Verify change was tracked
        changeset = manager.load_changeset(changeset_id)
        assert changeset.get_element_count() == 1

        changes = changeset.get_changes()
        assert changes[0].operation == "add"
        assert changes[0].element_id == "business.service.test"

    def test_update_element_tracks_change(self, temp_model):
        """Test that updating an element tracks the change."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # First add element in changeset
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Original Name"},
        )
        model.add_element("business", element)

        # Then update it
        model.update_element("business.service.test", {"name": "Updated Name"})

        # Verify both changes were tracked
        changeset = manager.load_changeset(changeset_id)
        changes = changeset.get_changes()

        assert len(changes) == 2
        assert changes[0].operation == "add"
        assert changes[1].operation == "update"
        assert changes[1].before["name"] == "Original Name"
        assert changes[1].after["name"] == "Updated Name"

    def test_remove_element_tracks_change(self, temp_model):
        """Test that removing an element tracks the change."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # First add an element
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )
        model.add_element("business", element)

        # Then remove it
        model.remove_element("business.service.test")

        # Verify both changes were tracked
        changeset = manager.load_changeset(changeset_id)
        changes = changeset.get_changes()

        assert len(changes) == 2
        assert changes[0].operation == "add"
        assert changes[1].operation == "delete"
        assert changes[1].element_id == "business.service.test"

    def test_element_visible_after_add(self, temp_model):
        """Test that element is visible after adding in changeset."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Add element
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )
        model.add_element("business", element)

        # Element should be visible in this changeset
        found = model.get_element("business.service.test")
        assert found is not None
        assert found.data["name"] == "Test Service"

    def test_element_not_in_main_model(self, temp_model):
        """Test that changeset element is not in main model."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        changeset_model = Model.load(temp_model, changeset=changeset_id)

        # Add element in changeset
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )
        changeset_model.add_element("business", element)

        # Element should NOT be in main model
        main_model = Model.load(temp_model)
        found = main_model.get_element("business.service.test")
        assert found is None

    def test_save_does_not_persist_to_main(self, temp_model):
        """Test that save doesn't persist to main model."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Add element and save
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )
        model.add_element("business", element)
        model.save()

        # Element should still not be in main model
        main_model = Model.load(temp_model)
        found = main_model.get_element("business.service.test")
        assert found is None

    def test_multiple_changes_tracked(self, temp_model):
        """Test that multiple changes are tracked correctly."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Add multiple elements
        for i in range(3):
            element = Element(
                id=f"business.service.test{i}",
                element_type="service",
                layer="business",
                data={"name": f"Test Service {i}"},
            )
            model.add_element("business", element)

        # Verify all changes were tracked
        changeset = manager.load_changeset(changeset_id)
        assert changeset.get_element_count() == 3

        changes = changeset.get_changes()
        assert len(changes) == 3
        assert all(c.operation == "add" for c in changes)

    def test_add_element_invalid_layer(self, temp_model):
        """Test adding element to non-existent layer raises error."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Try to add element to non-existent layer
        element = Element(
            id="invalid.service.test",
            element_type="service",
            layer="invalid",
            data={"name": "Test"},
        )

        with pytest.raises(ValueError, match="Layer 'invalid' not found"):
            model.add_element("invalid", element)

    def test_update_element_not_found(self, temp_model):
        """Test updating non-existent element raises error."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Try to update non-existent element
        with pytest.raises(ValueError, match="Element .* not found"):
            model.update_element("business.service.nonexistent", {"name": "Updated"})

    def test_remove_element_not_found(self, temp_model):
        """Test removing non-existent element raises error."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Try to remove non-existent element
        with pytest.raises(ValueError, match="Element .* not found"):
            model.remove_element("business.service.nonexistent")

    def test_remove_element_invalid_layer(self, temp_model):
        """Test removing element from non-existent layer raises error."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Try to remove from non-existent layer
        with pytest.raises(ValueError, match="Layer 'invalid' not found"):
            model.remove_element("invalid.service.test")

    def test_get_changeset_summary(self, temp_model):
        """Test getting changeset summary."""
        # Create changeset and load model
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")
        model = Model.load(temp_model, changeset=changeset_id)

        # Add some changes
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )
        model.add_element("business", element)

        # Get summary
        summary = model.get_changeset_summary()

        assert summary["id"] == changeset_id
        assert summary["name"] == "Test Feature"
        assert summary["total_changes"] == 1

    def test_apply_changes_with_errors(self, temp_model):
        """Test applying changeset changes with some errors (should continue)."""
        # Create changeset manually with invalid changes
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")

        # Add an invalid change (wrong layer)
        change = Change(
            timestamp="2024-01-01T00:00:00Z",
            operation="add",
            element_id="invalidlayer.service.test",
            layer="invalidlayer",
            element_type="service",
            data={"name": "Test"},
        )
        manager.track_change(changeset_id, change)

        # Add a valid change
        change2 = Change(
            timestamp="2024-01-01T00:00:00Z",
            operation="add",
            element_id="business.service.test",
            layer="business",
            element_type="service",
            data={"name": "Test"},
        )
        manager.track_change(changeset_id, change2)

        # Load model - should apply valid change and warn about invalid
        import io
        import sys

        captured_output = io.StringIO()
        sys.stdout = captured_output

        model = Model.load(temp_model, changeset=changeset_id)

        sys.stdout = sys.__stdout__

        # Valid change should be applied
        found = model.get_element("business.service.test")
        assert found is not None

        # Warning should have been printed
        output = captured_output.getvalue()
        assert "Warning" in output

    def test_apply_update_change_element_not_found(self, temp_model):
        """Test applying update change for non-existent element (should warn)."""
        # Create changeset with update to non-existent element
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")

        # Add update change for non-existent element
        change = Change(
            timestamp="2024-01-01T00:00:00Z",
            operation="update",
            element_id="business.service.nonexistent",
            layer="business",
            element_type="service",
            before={"name": "Old"},
            after={"name": "New"},
        )
        manager.track_change(changeset_id, change)

        # Load model - should warn about missing element
        import io
        import sys

        captured_output = io.StringIO()
        sys.stdout = captured_output

        _model = Model.load(temp_model, changeset=changeset_id)

        sys.stdout = sys.__stdout__

        # Warning should have been printed
        output = captured_output.getvalue()
        assert "Warning" in output
        assert "not found" in output

    def test_apply_delete_change(self, temp_model):
        """Test applying delete change."""
        # First create an element in main model
        from documentation_robotics.core.model import Model as BaseModel

        main_model = BaseModel(temp_model)
        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )
        main_model.add_element("business", element)
        main_model.save()

        # Now create changeset with delete change
        manager = ChangesetManager(temp_model)
        changeset_id = manager.create(name="Test Feature")

        # Add delete change
        change = Change(
            timestamp="2024-01-01T00:00:00Z",
            operation="delete",
            element_id="business.service.test",
            layer="business",
            element_type="service",
            before={"name": "Test Service"},
        )
        manager.track_change(changeset_id, change)

        # Load model in changeset context - element should not be visible
        model = Model.load(temp_model, changeset=changeset_id)
        found = model.get_element("business.service.test")

        assert found is None
