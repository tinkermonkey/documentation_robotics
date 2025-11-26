"""
Tests for changeset CLI commands.
"""

import tempfile
from pathlib import Path

from click.testing import CliRunner
from documentation_robotics.commands.changeset import (
    abandon,
    apply,
    changeset,
    clear,
    create,
    delete,
    diff,
    list_changesets,
    status,
    switch,
)
from documentation_robotics.core.changeset import Change
from documentation_robotics.core.changeset_manager import ChangesetManager


class TestCreateCommand:
    """Tests for create command."""

    def test_create_basic(self):
        """Test creating a basic changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(create, ["test-feature"])

                assert result.exit_code == 0
                assert "Created and activated changeset" in result.output

    def test_create_with_options(self):
        """Test creating changeset with options."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(
                    create,
                    [
                        "test-feature",
                        "--type",
                        "bugfix",
                        "--description",
                        "Test bug fix",
                        "--no-activate",
                    ],
                )

                assert result.exit_code == 0
                assert "Created changeset" in result.output
                assert "use 'dr changeset switch" in result.output.lower()

    def test_create_sets_active_by_default(self):
        """Test that create sets changeset as active by default."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(create, ["test-feature"])

                assert result.exit_code == 0
                # Verify it was set as active
                manager = ChangesetManager(Path.cwd())
                assert manager.get_active() is not None


class TestListCommand:
    """Tests for list command."""

    def test_list_empty(self):
        """Test listing when no changesets exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(list_changesets, [])

                assert result.exit_code == 0
                assert "No changesets found" in result.output

    def test_list_with_changesets(self):
        """Test listing existing changesets."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create a changeset
                runner.invoke(create, ["test-feature"])

                # List changesets
                result = runner.invoke(list_changesets, [])

                assert result.exit_code == 0
                assert "test-feature" in result.output

    def test_list_json_output(self):
        """Test JSON output format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create a changeset
                runner.invoke(create, ["test-feature"])

                # List as JSON
                result = runner.invoke(list_changesets, ["--json"])

                assert result.exit_code == 0
                # Output should be valid JSON
                import json

                data = json.loads(result.output)
                assert isinstance(data, list)

    def test_list_with_status_filter(self):
        """Test listing with status filter."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changesets
                runner.invoke(create, ["active-feature"])
                runner.invoke(create, ["applied-feature"])

                # Mark one as applied
                manager = ChangesetManager(Path.cwd())
                changesets = manager.list()
                manager.update_changeset_status(changesets[0]["id"], "applied")

                # List only active
                result = runner.invoke(list_changesets, ["--status", "active"])

                assert result.exit_code == 0


class TestSwitchCommand:
    """Tests for switch command."""

    def test_switch_to_existing(self):
        """Test switching to an existing changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changesets
                runner.invoke(create, ["feature-1"])
                runner.invoke(create, ["feature-2"])

                # Get changeset IDs
                manager = ChangesetManager(Path.cwd())
                changesets = manager.list()
                changeset_id = changesets[0]["id"]

                # Switch to first one
                result = runner.invoke(switch, [changeset_id])

                assert result.exit_code == 0
                assert "Switched to changeset" in result.output

    def test_switch_to_nonexistent(self):
        """Test switching to a nonexistent changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(switch, ["nonexistent-id"])

                assert result.exit_code != 0
                assert "not found" in result.output


class TestStatusCommand:
    """Tests for status command."""

    def test_status_no_active(self):
        """Test status when no active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(status, [])

                assert result.exit_code == 0
                assert "No active changeset" in result.output

    def test_status_with_active(self):
        """Test status with active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create and activate changeset
                runner.invoke(create, ["test-feature", "--description", "Test"])

                # Check status
                result = runner.invoke(status, [])

                assert result.exit_code == 0
                assert "test-feature" in result.output
                assert "Test" in result.output

    def test_status_specific_changeset(self):
        """Test status for specific changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changeset
                runner.invoke(create, ["test-feature"])

                # Get changeset ID
                manager = ChangesetManager(Path.cwd())
                changesets = manager.list()
                changeset_id = changesets[0]["id"]

                # Check status
                result = runner.invoke(status, [changeset_id])

                assert result.exit_code == 0
                assert "test-feature" in result.output

    def test_status_verbose(self):
        """Test verbose status output."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changeset
                runner.invoke(create, ["test-feature"])

                # Check verbose status
                result = runner.invoke(status, ["--verbose"])

                assert result.exit_code == 0


class TestApplyCommand:
    """Tests for apply command."""

    def test_apply_preview(self):
        """Test apply in preview mode."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changeset
                manager = ChangesetManager(Path.cwd())
                changeset_id = manager.create(name="Test Feature")

                # Add a change
                change = Change(
                    timestamp="2024-01-01T00:00:00Z",
                    operation="add",
                    element_id="business.service.test",
                    layer="business",
                    element_type="service",
                    data={"name": "Test"},
                )
                manager.track_change(changeset_id, change)

                # Preview apply
                result = runner.invoke(apply, [changeset_id, "--preview"])

                assert result.exit_code == 0
                assert "Preview mode" in result.output

    def test_apply_no_active(self):
        """Test apply when no active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(apply, [])

                assert result.exit_code == 0
                assert "No active changeset" in result.output


class TestAbandonCommand:
    """Tests for abandon command."""

    def test_abandon_existing(self):
        """Test abandoning an existing changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changeset
                runner.invoke(create, ["test-feature"])

                # Get changeset ID
                manager = ChangesetManager(Path.cwd())
                changesets = manager.list()
                changeset_id = changesets[0]["id"]

                # Abandon with --yes flag
                result = runner.invoke(abandon, [changeset_id, "--yes"])

                assert result.exit_code == 0
                assert "marked as abandoned" in result.output

    def test_abandon_nonexistent(self):
        """Test abandoning a nonexistent changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(abandon, ["nonexistent-id", "--yes"])

                assert result.exit_code != 0
                assert "not found" in result.output


class TestClearCommand:
    """Tests for clear command."""

    def test_clear_active(self):
        """Test clearing active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create and activate changeset
                runner.invoke(create, ["test-feature"])

                # Clear with --yes flag
                result = runner.invoke(clear, ["--yes"])

                assert result.exit_code == 0
                assert "Cleared active changeset" in result.output

    def test_clear_no_active(self):
        """Test clearing when no active changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(clear, ["--yes"])

                assert result.exit_code == 0
                assert "No active changeset" in result.output


class TestDeleteCommand:
    """Tests for delete command."""

    def test_delete_existing(self):
        """Test deleting an existing changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changeset
                runner.invoke(create, ["test-feature"])

                # Get changeset ID
                manager = ChangesetManager(Path.cwd())
                changesets = manager.list()
                changeset_id = changesets[0]["id"]

                # Delete with --yes flag
                result = runner.invoke(delete, [changeset_id, "--yes"])

                assert result.exit_code == 0
                assert "Deleted changeset" in result.output

    def test_delete_nonexistent(self):
        """Test deleting a nonexistent changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(delete, ["nonexistent-id", "--yes"])

                assert result.exit_code != 0
                assert "not found" in result.output


class TestDiffCommand:
    """Tests for diff command."""

    def test_diff_two_changesets(self):
        """Test diffing two changesets."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changesets
                manager = ChangesetManager(Path.cwd())
                id1 = manager.create(name="Feature A")
                id2 = manager.create(name="Feature B")

                # Add different changes
                change1 = Change(
                    timestamp="2024-01-01T00:00:00Z",
                    operation="add",
                    element_id="business.service.a",
                    layer="business",
                    element_type="service",
                    data={},
                )
                manager.track_change(id1, change1)

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
                result = runner.invoke(diff, [id1, id2])

                assert result.exit_code == 0
                assert "Comparing Changesets" in result.output

    def test_diff_with_main(self):
        """Test diffing changeset with main model."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changeset
                manager = ChangesetManager(Path.cwd())
                changeset_id = manager.create(name="Feature A")

                # Add change
                change = Change(
                    timestamp="2024-01-01T00:00:00Z",
                    operation="add",
                    element_id="business.service.a",
                    layer="business",
                    element_type="service",
                    data={},
                )
                manager.track_change(changeset_id, change)

                # Diff with main
                result = runner.invoke(diff, [changeset_id])

                assert result.exit_code == 0
                assert "Comparing Changesets" in result.output

    def test_diff_json_output(self):
        """Test diff with JSON output."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                # Create changeset
                manager = ChangesetManager(Path.cwd())
                changeset_id = manager.create(name="Feature A")

                # Diff as JSON
                result = runner.invoke(diff, [changeset_id, "--json"])

                assert result.exit_code == 0
                # Output should be valid JSON
                import json

                data = json.loads(result.output)
                assert "changeset_a" in data
                assert "changeset_b" in data

    def test_diff_nonexistent_changeset(self):
        """Test diff with nonexistent changeset."""
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            with runner.isolated_filesystem(temp_dir=tmpdir):
                result = runner.invoke(diff, ["nonexistent-id"])

                assert result.exit_code != 0
                assert "not found" in result.output


class TestChangesetGroup:
    """Tests for changeset command group."""

    def test_changeset_group_help(self):
        """Test changeset group help."""
        runner = CliRunner()
        result = runner.invoke(changeset, ["--help"])

        assert result.exit_code == 0
        assert "Manage changesets" in result.output
