"""
Tests for ChangesetManager class.
"""

import tempfile
from pathlib import Path

import pytest
from documentation_robotics.core.changeset import Change
from documentation_robotics.core.changeset_manager import ChangesetManager


class TestChangesetManager:
    """Tests for ChangesetManager class."""

    def test_create_manager(self):
        """Test creating changeset manager."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            assert manager.root_path == root
            assert manager.changesets_dir.exists()

    def test_create_changeset(self):
        """Test creating a new changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(
                name="Test Feature",
                changeset_type="feature",
                description="Test description",
                set_active=False,
            )

            assert changeset_id is not None
            assert changeset_id.startswith("feature-test-feature")
            assert manager.changeset_exists(changeset_id)

    def test_set_active_changeset(self):
        """Test setting active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test", changeset_type="feature", set_active=False)

            manager.set_active(changeset_id)
            active = manager.get_active()

            assert active == changeset_id

    def test_get_active_no_changeset(self):
        """Test getting active when none exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            active = manager.get_active()

            assert active is None

    def test_clear_active(self):
        """Test clearing active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test", set_active=True)
            assert manager.get_active() == changeset_id

            manager.clear_active()
            assert manager.get_active() is None

    def test_list_changesets(self):
        """Test listing changesets."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            manager.create(name="Feature A", changeset_type="feature")
            manager.create(name="Feature B", changeset_type="feature")

            changesets = manager.list()

            assert len(changesets) == 2

    def test_list_changesets_with_filter(self):
        """Test listing changesets with status filter."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            id1 = manager.create(name="Feature A")
            _id2 = manager.create(name="Feature B")

            # Mark one as applied
            manager.update_changeset_status(id1, "applied")

            active_changesets = manager.list(status_filter="active")
            applied_changesets = manager.list(status_filter="applied")

            assert len(active_changesets) == 1
            assert len(applied_changesets) == 1

    def test_load_changeset(self):
        """Test loading a changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test Feature")
            changeset = manager.load_changeset(changeset_id)

            assert changeset.id == changeset_id
            assert changeset.metadata.name == "Test Feature"

    def test_load_nonexistent_changeset(self):
        """Test loading a changeset that doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            with pytest.raises(ValueError, match="does not exist"):
                manager.load_changeset("nonexistent-id")

    def test_track_change(self):
        """Test tracking a change."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test")

            change = Change(
                timestamp="2024-01-01T00:00:00Z",
                operation="add",
                element_id="business.service.test",
                layer="business",
                element_type="service",
                data={"name": "Test"},
            )

            manager.track_change(changeset_id, change)

            changeset = manager.load_changeset(changeset_id)
            assert changeset.get_element_count() == 1

    def test_update_changeset_status(self):
        """Test updating changeset status."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test")

            manager.update_changeset_status(changeset_id, "applied")

            changeset = manager.load_changeset(changeset_id)
            assert changeset.metadata.status == "applied"

    def test_delete_changeset(self):
        """Test deleting a changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test")
            assert manager.changeset_exists(changeset_id)

            manager.delete_changeset(changeset_id)
            assert not manager.changeset_exists(changeset_id)

    def test_delete_active_changeset(self):
        """Test deleting the active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test", set_active=True)
            assert manager.get_active() == changeset_id

            manager.delete_changeset(changeset_id)
            assert manager.get_active() is None

    def test_get_changeset_summary(self):
        """Test getting changeset summary."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            changeset_id = manager.create(name="Test Feature", description="Test description")

            summary = manager.get_changeset_summary(changeset_id)

            assert summary["id"] == changeset_id
            assert summary["name"] == "Test Feature"
            assert summary["description"] == "Test description"
            assert "total_changes" in summary

    def test_get_statistics(self):
        """Test getting changeset statistics."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            id1 = manager.create(name="Feature A")
            _id2 = manager.create(name="Feature B")
            manager.update_changeset_status(id1, "applied")

            stats = manager.get_statistics()

            assert stats["total_changesets"] == 2
            assert stats["active"] == 1
            assert stats["applied"] == 1

    def test_diff_changesets(self):
        """Test diffing two changesets."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            # Create first changeset with a change
            id1 = manager.create(name="Feature A")
            change1 = Change(
                timestamp="2024-01-01T00:00:00Z",
                operation="add",
                element_id="business.service.a",
                layer="business",
                element_type="service",
                data={},
            )
            manager.track_change(id1, change1)

            # Create second changeset with different change
            id2 = manager.create(name="Feature B")
            change2 = Change(
                timestamp="2024-01-01T00:00:00Z",
                operation="add",
                element_id="business.service.b",
                layer="business",
                element_type="service",
                data={},
            )
            manager.track_change(id2, change2)

            # Diff
            diff = manager.diff_changesets(id1, id2)

            assert len(diff["only_in_a"]) == 1
            assert len(diff["only_in_b"]) == 1
            assert diff["has_conflicts"] is False

    def test_diff_changeset_with_main(self):
        """Test diffing changeset with main model."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            # Create changeset with a change
            changeset_id = manager.create(name="Feature A")
            change = Change(
                timestamp="2024-01-01T00:00:00Z",
                operation="add",
                element_id="business.service.a",
                layer="business",
                element_type="service",
                data={},
            )
            manager.track_change(changeset_id, change)

            # Diff with main (no changes in main)
            diff = manager.diff_changesets(changeset_id, None)

            assert diff["changeset_b"]["id"] == "main"
            assert len(diff["only_in_a"]) == 1
            assert len(diff["only_in_b"]) == 0

    def test_diff_conflicts(self):
        """Test detecting conflicts in diff."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            manager = ChangesetManager(root)

            # Create first changeset
            id1 = manager.create(name="Feature A")
            change1 = Change(
                timestamp="2024-01-01T00:00:00Z",
                operation="add",
                element_id="business.service.test",
                layer="business",
                element_type="service",
                data={"name": "Version A"},
            )
            manager.track_change(id1, change1)

            # Create second changeset with conflicting change
            id2 = manager.create(name="Feature B")
            change2 = Change(
                timestamp="2024-01-01T00:00:00Z",
                operation="add",
                element_id="business.service.test",
                layer="business",
                element_type="service",
                data={"name": "Version B"},
            )
            manager.track_change(id2, change2)

            # Diff should detect conflict
            diff = manager.diff_changesets(id1, id2)

            assert diff["has_conflicts"] is True
            assert len(diff["modified_in_both"]) == 1
