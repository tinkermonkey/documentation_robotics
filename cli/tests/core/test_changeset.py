"""
Tests for changeset core classes.
"""

import tempfile
from datetime import datetime, timezone
from pathlib import Path

from documentation_robotics.core.changeset import (
    Change,
    Changeset,
    ChangesetMetadata,
)


class TestChangesetMetadata:
    """Tests for ChangesetMetadata class."""

    def test_create_metadata(self):
        """Test creating changeset metadata."""
        now = datetime.now(timezone.utc)
        metadata = ChangesetMetadata(
            id="test-001",
            name="Test Changeset",
            description="Test description",
            type="feature",
            status="active",
            created_at=now,
            updated_at=now,
            workflow="direct-cli",
        )

        assert metadata.id == "test-001"
        assert metadata.name == "Test Changeset"
        assert metadata.type == "feature"
        assert metadata.status == "active"

    def test_metadata_to_dict(self):
        """Test converting metadata to dictionary."""
        now = datetime.now(timezone.utc)
        metadata = ChangesetMetadata(
            id="test-001",
            name="Test",
            description="Desc",
            type="feature",
            status="active",
            created_at=now,
            updated_at=now,
            workflow="direct-cli",
        )

        data = metadata.to_dict()

        assert data["id"] == "test-001"
        assert data["name"] == "Test"
        assert data["type"] == "feature"
        assert "created_at" in data
        assert "updated_at" in data

    def test_metadata_from_dict(self):
        """Test creating metadata from dictionary."""
        now = datetime.now(timezone.utc)
        data = {
            "id": "test-001",
            "name": "Test",
            "description": "Desc",
            "type": "feature",
            "status": "active",
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "workflow": "direct-cli",
        }

        metadata = ChangesetMetadata.from_dict(data)

        assert metadata.id == "test-001"
        assert metadata.name == "Test"
        assert metadata.type == "feature"


class TestChange:
    """Tests for Change class."""

    def test_create_add_change(self):
        """Test creating an 'add' change."""
        change = Change(
            timestamp="2024-01-01T00:00:00Z",
            operation="add",
            element_id="business.service.test",
            layer="business",
            element_type="service",
            data={"name": "Test Service"},
        )

        assert change.operation == "add"
        assert change.element_id == "business.service.test"
        assert change.data == {"name": "Test Service"}

    def test_create_update_change(self):
        """Test creating an 'update' change."""
        change = Change(
            timestamp="2024-01-01T00:00:00Z",
            operation="update",
            element_id="business.service.test",
            layer="business",
            element_type="service",
            before={"name": "Old Name"},
            after={"name": "New Name"},
        )

        assert change.operation == "update"
        assert change.before == {"name": "Old Name"}
        assert change.after == {"name": "New Name"}

    def test_change_to_dict(self):
        """Test converting change to dictionary."""
        change = Change(
            timestamp="2024-01-01T00:00:00Z",
            operation="add",
            element_id="business.service.test",
            layer="business",
            element_type="service",
            data={"name": "Test"},
        )

        data = change.to_dict()

        assert data["operation"] == "add"
        assert data["element_id"] == "business.service.test"
        assert data["data"] == {"name": "Test"}

    def test_change_from_dict(self):
        """Test creating change from dictionary."""
        data = {
            "timestamp": "2024-01-01T00:00:00Z",
            "operation": "add",
            "element_id": "business.service.test",
            "layer": "business",
            "element_type": "service",
            "data": {"name": "Test"},
        }

        change = Change.from_dict(data)

        assert change.operation == "add"
        assert change.element_id == "business.service.test"


class TestChangeset:
    """Tests for Changeset class."""

    def test_create_changeset(self):
        """Test creating a changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)
            changeset = Changeset("test-001", path)

            assert changeset.id == "test-001"
            assert changeset.path == path

    def test_add_change(self):
        """Test adding a change to changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)
            changeset = Changeset("test-001", path)

            change = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test",
                layer="business",
                element_type="service",
                data={"name": "Test"},
            )

            changeset.add_change(change)

            assert changeset.get_element_count() == 1
            assert changeset.metadata.summary["elements_added"] == 1

    def test_get_changes(self):
        """Test getting all changes."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)
            changeset = Changeset("test-001", path)

            change1 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test1",
                layer="business",
                element_type="service",
                data={},
            )

            change2 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test2",
                layer="business",
                element_type="service",
                data={},
            )

            changeset.add_change(change1)
            changeset.add_change(change2)

            changes = changeset.get_changes()

            assert len(changes) == 2

    def test_save_and_load(self):
        """Test saving and loading changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)

            # Create and save
            changeset = Changeset("test-001", path)
            changeset.metadata.name = "Test Changeset"
            changeset.metadata.description = "Test description"

            change = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test",
                layer="business",
                element_type="service",
                data={"name": "Test"},
            )
            changeset.add_change(change)
            changeset.save()

            # Load
            loaded = Changeset("test-001", path)

            assert loaded.metadata.name == "Test Changeset"
            assert loaded.metadata.description == "Test description"
            assert loaded.get_element_count() == 1

    def test_get_changes_by_element(self):
        """Test filtering changes by element ID."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)
            changeset = Changeset("test-001", path)

            change1 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test1",
                layer="business",
                element_type="service",
                data={},
            )

            change2 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="update",
                element_id="business.service.test1",
                layer="business",
                element_type="service",
                before={},
                after={"name": "Updated"},
            )

            changeset.add_change(change1)
            changeset.add_change(change2)

            changes = changeset.get_changes_by_element("business.service.test1")

            assert len(changes) == 2

    def test_get_changes_by_layer(self):
        """Test filtering changes by layer."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)
            changeset = Changeset("test-001", path)

            change1 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test1",
                layer="business",
                element_type="service",
                data={},
            )

            change2 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="application.component.test1",
                layer="application",
                element_type="component",
                data={},
            )

            changeset.add_change(change1)
            changeset.add_change(change2)

            changes = changeset.get_changes_by_layer("business")

            assert len(changes) == 1
            assert changes[0].layer == "business"

    def test_get_affected_layers(self):
        """Test getting affected layers."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)
            changeset = Changeset("test-001", path)

            change1 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test1",
                layer="business",
                element_type="service",
                data={},
            )

            change2 = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="application.component.test1",
                layer="application",
                element_type="component",
                data={},
            )

            changeset.add_change(change1)
            changeset.add_change(change2)

            layers = changeset.get_affected_layers()

            assert len(layers) == 2
            assert "business" in layers
            assert "application" in layers

    def test_clear_changes(self):
        """Test clearing all changes."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir)
            changeset = Changeset("test-001", path)

            change = Change(
                timestamp=datetime.now(timezone.utc).isoformat(),
                operation="add",
                element_id="business.service.test",
                layer="business",
                element_type="service",
                data={},
            )

            changeset.add_change(change)
            assert changeset.get_element_count() == 1

            changeset.clear_changes()

            assert changeset.get_element_count() == 0
            assert changeset.metadata.summary["elements_added"] == 0
