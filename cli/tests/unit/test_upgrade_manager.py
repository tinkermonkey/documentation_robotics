"""Unit tests for UpgradeManager."""

import pytest
import yaml
from documentation_robotics import __version__
from documentation_robotics.core.manifest import Manifest
from documentation_robotics.core.upgrade_manager import UpgradeManager
from documentation_robotics.versions import SPEC_VERSION


class TestUpgradeManager:
    """Tests for UpgradeManager."""

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project."""
        from documentation_robotics.commands.init import ModelInitializer

        initializer = ModelInitializer(
            root_path=tmp_path,
            project_name="test-project",
            template="basic",
            minimal=False,
            with_examples=False,
        )
        initializer.create()
        return tmp_path

    def test_upgrade_manager_creation(self, initialized_project):
        """Test creating upgrade manager."""
        manager = UpgradeManager(initialized_project)
        assert manager.root_path == initialized_project
        assert (
            manager.manifest_path
            == initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        )

    def test_get_version_info_current_project(self, initialized_project):
        """Test getting version info from current project."""
        manager = UpgradeManager(initialized_project)
        info = manager.get_version_info()

        assert info["cli_version"] == __version__
        assert info["manifest_version"] == __version__
        assert info["claude_version"] is None

    def test_get_version_info_no_project(self, tmp_path):
        """Test getting version info when no project exists."""
        manager = UpgradeManager(tmp_path)
        info = manager.get_version_info()

        assert info["cli_version"] == __version__
        assert info["manifest_version"] is None
        assert info["claude_version"] is None

    def test_check_upgrade_not_needed(self, initialized_project):
        """Test that no upgrade is needed for current version."""
        manager = UpgradeManager(initialized_project)
        upgraded = manager.check_and_upgrade(auto=True, force=False)

        assert upgraded is False

    def test_check_upgrade_needed_old_version(self, initialized_project):
        """Test that upgrade is detected for old version."""
        # Modify manifest to have old version
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        with open(manifest_path, "r") as f:
            data = yaml.safe_load(f)

        data["cli_version"] = "0.1.0"

        with open(manifest_path, "w") as f:
            yaml.dump(data, f)

        manager = UpgradeManager(initialized_project)
        upgraded = manager.check_and_upgrade(auto=True, force=False)

        assert upgraded is True

        # Verify version was updated
        with open(manifest_path, "r") as f:
            data = yaml.safe_load(f)

        assert data["cli_version"] == __version__
        assert "upgraded_at" in data
        assert "upgrade_history" in data
        assert len(data["upgrade_history"]) > 0

    def test_upgrade_history_recorded(self, initialized_project):
        """Test that upgrade history is recorded."""
        # Set old version
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        with open(manifest_path, "r") as f:
            data = yaml.safe_load(f)

        old_version = "0.2.0"
        data["cli_version"] = old_version

        with open(manifest_path, "w") as f:
            yaml.dump(data, f)

        # Perform upgrade
        manager = UpgradeManager(initialized_project)
        manager.check_and_upgrade(auto=True, force=False)

        # Check history
        with open(manifest_path, "r") as f:
            data = yaml.safe_load(f)

        history = data["upgrade_history"]
        assert len(history) > 0
        assert history[-1]["from_version"] == old_version  # Original CLI version before upgrade
        assert history[-1]["to_version"] == __version__
        assert "upgraded_at" in history[-1]

    def test_manifest_needs_update_missing_version(self, initialized_project):
        """Test that manifest needs update when version is missing."""
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        manifest = Manifest.load(manifest_path)

        # Remove version
        del manifest.data["cli_version"]

        manager = UpgradeManager(initialized_project)
        needs_update = manager._manifest_needs_update(manifest)

        assert needs_update is True

    def test_manifest_needs_update_old_version(self, initialized_project):
        """Test that manifest needs update when version is old."""
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        manifest = Manifest.load(manifest_path)

        # Set old version
        manifest.data["cli_version"] = "0.1.0"

        manager = UpgradeManager(initialized_project)
        needs_update = manager._manifest_needs_update(manifest)

        assert needs_update is True

    def test_manifest_up_to_date(self, initialized_project):
        """Test that manifest doesn't need update when current."""
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        manifest = Manifest.load(manifest_path)

        manager = UpgradeManager(initialized_project)
        needs_update = manager._manifest_needs_update(manifest)

        assert needs_update is False

    def test_schemas_need_update_missing_schemas(self, tmp_path):
        """Test that schemas need update when missing."""
        # Create minimal project structure
        (tmp_path / "documentation-robotics" / "model").mkdir(parents=True)
        manifest_path = tmp_path / "documentation-robotics" / "model" / "manifest.yaml"
        Manifest.create(manifest_path, "test-project")

        manager = UpgradeManager(tmp_path)
        needs_update = manager._schemas_need_update()

        assert needs_update is True

    def test_schemas_exist(self, initialized_project):
        """Test schemas detection when they exist."""
        manager = UpgradeManager(initialized_project)
        needs_update = manager._schemas_need_update()

        # Schemas should exist after init
        assert needs_update is False

    def test_schemas_need_update_version_mismatch(self, initialized_project):
        """Test that schemas need update when spec_version doesn't match."""
        import json

        # Modify .manifest.json to have old spec version
        manifest_path = initialized_project / ".dr" / "schemas" / ".manifest.json"
        with open(manifest_path) as f:
            data = json.load(f)

        data["spec_version"] = "0.5.0"

        with open(manifest_path, "w") as f:
            json.dump(data, f)

        manager = UpgradeManager(initialized_project)
        needs_update = manager._schemas_need_update()

        assert needs_update is True

    def test_check_upgrade_detects_schema_version_mismatch(self, initialized_project):
        """Test that check_and_upgrade detects schema version mismatches even when CLI version matches."""
        import json

        # Set old spec version
        manifest_path = initialized_project / ".dr" / "schemas" / ".manifest.json"
        with open(manifest_path) as f:
            data = json.load(f)

        data["spec_version"] = "0.5.0"

        with open(manifest_path, "w") as f:
            json.dump(data, f)

        manager = UpgradeManager(initialized_project)
        upgraded = manager.check_and_upgrade(auto=True, force=False)

        # Should detect schema update needed
        assert upgraded is True

        # Verify schema version was updated
        with open(manifest_path) as f:
            updated_data = json.load(f)

        assert updated_data["spec_version"] == SPEC_VERSION

    def test_claude_not_installed(self, initialized_project):
        """Test Claude integration not installed."""
        manager = UpgradeManager(initialized_project)
        needs_update = manager._claude_needs_update()

        assert needs_update is False

    def test_claude_needs_update(self, initialized_project):
        """Test Claude integration needs update."""
        # Install Claude integration with old version
        claude_dir = initialized_project / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)

        version_file = claude_dir / ".dr-version"
        version_data = {
            "version": "0.1.0",
            "installed_at": "2024-01-01T00:00:00Z",
            "components": {},
        }

        with open(version_file, "w") as f:
            yaml.dump(version_data, f)

        manager = UpgradeManager(initialized_project)
        needs_update = manager._claude_needs_update()

        assert needs_update is True

    def test_docs_need_update_missing(self, tmp_path):
        """Test documentation needs update when missing."""
        # Create minimal structure without docs
        (tmp_path / "documentation-robotics" / "model").mkdir(parents=True)
        manifest_path = tmp_path / "documentation-robotics" / "model" / "manifest.yaml"
        Manifest.create(manifest_path, "test-project")

        manager = UpgradeManager(tmp_path)
        needs_update = manager._docs_need_update()

        assert needs_update is True

    def test_docs_exist(self, initialized_project):
        """Test documentation exists check."""
        manager = UpgradeManager(initialized_project)
        needs_update = manager._docs_need_update()

        assert needs_update is False

    def test_force_upgrade_always_runs(self, initialized_project):
        """Test force upgrade runs even when up to date."""
        manager = UpgradeManager(initialized_project)

        # Force upgrade should return True even though version matches
        upgraded = manager.check_and_upgrade(auto=True, force=True)

        # With force=True, upgrade should run schemas update
        assert upgraded is True

    def test_force_upgrade_updates_schemas(self, initialized_project):
        """Test that force upgrade updates schemas even when files exist."""
        # Modify a schema file
        schema_path = initialized_project / ".dr" / "schemas" / "01-motivation-layer.schema.json"
        original_content = schema_path.read_text()
        schema_path.write_text(original_content + "\n// Modified")

        manager = UpgradeManager(initialized_project)

        # Force upgrade should restore the schema
        upgraded = manager.check_and_upgrade(auto=True, force=True)
        assert upgraded is True

        # Verify schema was restored
        new_content = schema_path.read_text()
        assert "// Modified" not in new_content
        assert new_content == original_content

    def test_upgrade_preserves_project_data(self, initialized_project):
        """Test that upgrade preserves existing project data."""
        # Add custom data to manifest
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        with open(manifest_path, "r") as f:
            data = yaml.safe_load(f)

        data["custom_field"] = "custom_value"
        data["cli_version"] = "0.1.0"

        with open(manifest_path, "w") as f:
            yaml.dump(data, f)

        # Perform upgrade
        manager = UpgradeManager(initialized_project)
        manager.check_and_upgrade(auto=True, force=False)

        # Verify custom data preserved
        with open(manifest_path, "r") as f:
            updated_data = yaml.safe_load(f)

        assert updated_data["custom_field"] == "custom_value"
        assert updated_data["cli_version"] == __version__

    def test_upgrade_adds_missing_fields(self, initialized_project):
        """Test that upgrade adds missing required fields."""
        # Remove required fields
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        with open(manifest_path, "r") as f:
            data = yaml.safe_load(f)

        del data["spec_version"]
        del data["cli_version"]

        with open(manifest_path, "w") as f:
            yaml.dump(data, f)

        # Perform upgrade
        manager = UpgradeManager(initialized_project)
        manager.check_and_upgrade(auto=True, force=True)

        # Verify fields added
        with open(manifest_path, "r") as f:
            updated_data = yaml.safe_load(f)

        assert "spec_version" in updated_data
        assert "cli_version" in updated_data
        assert updated_data["cli_version"] == __version__

    def test_determine_upgrades_returns_items(self, initialized_project):
        """Test that _determine_upgrades returns upgrade items."""
        # Set old version
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        manifest = Manifest.load(manifest_path)
        manifest.data["cli_version"] = "0.1.0"

        manager = UpgradeManager(initialized_project)
        items = manager._determine_upgrades(manifest, "0.1.0")

        # Should have at least manifest upgrade
        assert len(items) > 0
        assert any(item["type"] == "manifest" for item in items)

    def test_determine_upgrades_with_force(self, initialized_project):
        """Test that _determine_upgrades includes schemas when force=True."""
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        manifest = Manifest.load(manifest_path)

        manager = UpgradeManager(initialized_project)

        # Without force, schemas should not be included if they exist
        items_no_force = manager._determine_upgrades(manifest, __version__, force=False)
        schema_items_no_force = [item for item in items_no_force if item["type"] == "schemas"]
        assert len(schema_items_no_force) == 0

        # With force, schemas should be included even if they exist
        items_with_force = manager._determine_upgrades(manifest, __version__, force=True)
        schema_items_with_force = [item for item in items_with_force if item["type"] == "schemas"]
        assert len(schema_items_with_force) == 1

    def test_upgrade_manifest_structure(self, initialized_project):
        """Test upgrading manifest structure."""
        manifest_path = initialized_project / "documentation-robotics" / "model" / "manifest.yaml"
        manifest = Manifest.load(manifest_path)

        # Remove some fields
        del manifest.data["cli_version"]

        manager = UpgradeManager(initialized_project)
        manager._upgrade_manifest(manifest)

        # Verify fields added
        assert "cli_version" in manifest.data
        assert manifest.data["cli_version"] == __version__
        assert "upgrade_history" in manifest.data
