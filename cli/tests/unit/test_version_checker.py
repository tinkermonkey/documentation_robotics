"""Tests for the VersionChecker class."""

import json

import pytest
import yaml
from documentation_robotics.core.version_checker import (
    ComponentStatus,
    VersionChecker,
    VersionCheckResult,
)


@pytest.fixture
def temp_project(tmp_path):
    """Create a temporary project structure."""
    # Create .dr/schemas/.manifest.json
    dr_schemas = tmp_path / ".dr" / "schemas"
    dr_schemas.mkdir(parents=True)

    # Create documentation-robotics/model directory
    model_dir = tmp_path / "documentation-robotics" / "model"
    model_dir.mkdir(parents=True)

    # Create .claude directory
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir(parents=True)

    # Create .github directory
    github_dir = tmp_path / ".github"
    github_dir.mkdir(parents=True)

    return tmp_path


def test_version_checker_initialization(temp_project):
    """Test VersionChecker initialization."""
    checker = VersionChecker(root_path=temp_project)
    assert checker.root_path == temp_project
    assert checker.console is not None


def test_check_schema_version_up_to_date(temp_project):
    """Test schema version checking when up to date."""
    # Create manifest with current spec version
    manifest_path = temp_project / ".dr" / "schemas" / ".manifest.json"
    manifest_path.write_text(json.dumps({"spec_version": "0.6.0", "files": {}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_schema_version()

    assert status.component == "schema"
    assert status.display_name == "Schema version"
    assert status.installed is True
    assert status.current_version == "0.6.0"
    assert status.expected_version == "0.6.0"
    assert status.needs_update is False
    assert status.update_command is None


def test_check_schema_version_outdated(temp_project):
    """Test schema version checking when outdated."""
    # Create manifest with old spec version
    manifest_path = temp_project / ".dr" / "schemas" / ".manifest.json"
    manifest_path.write_text(json.dumps({"spec_version": "0.4.0", "files": {}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_schema_version()

    assert status.component == "schema"
    assert status.installed is True
    assert status.current_version == "0.4.0"
    assert status.expected_version == "0.6.0"
    assert status.needs_update is True
    assert "dr update" in status.update_command


def test_check_schema_version_not_installed(temp_project):
    """Test schema version checking when not installed."""
    # Don't create the manifest file
    checker = VersionChecker(root_path=temp_project)
    status = checker._check_schema_version()

    assert status.component == "schema"
    assert status.installed is False
    assert status.current_version is None
    assert status.needs_update is False
    assert status.update_command is None


def test_check_schema_version_corrupted(temp_project):
    """Test schema version checking with corrupted manifest."""
    # Create invalid JSON
    manifest_path = temp_project / ".dr" / "schemas" / ".manifest.json"
    manifest_path.write_text("invalid json {")

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_schema_version()

    assert status.component == "schema"
    assert status.installed is True
    assert status.current_version == "error"
    assert status.needs_update is True
    assert "dr update" in status.update_command


def test_check_model_version_up_to_date(temp_project):
    """Test model version checking when up to date."""
    # Create manifest with current spec version
    manifest_path = temp_project / "documentation-robotics" / "model" / "manifest.yaml"
    manifest_path.write_text(yaml.dump({"spec_version": "0.6.0", "project": {"name": "test"}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_model_version()

    assert status.component == "model"
    assert status.display_name == "Model version"
    assert status.installed is True
    assert status.current_version == "0.6.0"
    assert status.expected_version == "0.6.0"
    assert status.needs_update is False
    assert status.update_command is None


def test_check_model_version_outdated(temp_project):
    """Test model version checking when outdated."""
    # Create manifest with old spec version
    manifest_path = temp_project / "documentation-robotics" / "model" / "manifest.yaml"
    manifest_path.write_text(yaml.dump({"spec_version": "0.4.0", "project": {"name": "test"}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_model_version()

    assert status.component == "model"
    assert status.installed is True
    assert status.current_version == "0.4.0"
    assert status.expected_version == "0.6.0"
    assert status.needs_update is True
    assert "dr migrate" in status.update_command


def test_check_model_version_not_installed(temp_project):
    """Test model version checking when not installed."""
    # Don't create the manifest file
    checker = VersionChecker(root_path=temp_project)
    status = checker._check_model_version()

    assert status.component == "model"
    assert status.installed is False
    assert status.current_version is None
    assert status.needs_update is False
    assert status.update_command is None


def test_check_claude_version_up_to_date(temp_project):
    """Test Claude integration version checking when up to date."""
    # Create version file with current CLI version
    version_path = temp_project / ".claude" / ".dr-version"
    version_path.write_text(yaml.dump({"version": "0.7.3", "components": {}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_claude_version()

    assert status.component == "claude"
    assert status.display_name == "Claude integration"
    assert status.installed is True
    assert status.current_version == "0.7.3"
    assert status.expected_version == "0.7.3"
    assert status.needs_update is False
    assert status.update_command is None


def test_check_claude_version_outdated(temp_project):
    """Test Claude integration version checking when outdated."""
    # Create version file with old CLI version
    version_path = temp_project / ".claude" / ".dr-version"
    version_path.write_text(yaml.dump({"version": "0.7.2", "components": {}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_claude_version()

    assert status.component == "claude"
    assert status.installed is True
    assert status.current_version == "0.7.2"
    assert status.expected_version == "0.7.3"
    assert status.needs_update is True
    assert "dr claude update" in status.update_command


def test_check_claude_version_not_installed(temp_project):
    """Test Claude integration version checking when not installed."""
    # Don't create the version file
    checker = VersionChecker(root_path=temp_project)
    status = checker._check_claude_version()

    assert status.component == "claude"
    assert status.installed is False
    assert status.current_version is None
    assert status.needs_update is False
    assert status.update_command is None


def test_check_copilot_version_up_to_date(temp_project):
    """Test Copilot integration version checking when up to date."""
    # Create version file with current CLI version
    version_path = temp_project / ".github" / ".dr-copilot-version"
    version_path.write_text(yaml.dump({"version": "0.7.3", "components": {}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_copilot_version()

    assert status.component == "copilot"
    assert status.display_name == "Copilot integration"
    assert status.installed is True
    assert status.current_version == "0.7.3"
    assert status.expected_version == "0.7.3"
    assert status.needs_update is False
    assert status.update_command is None


def test_check_copilot_version_outdated(temp_project):
    """Test Copilot integration version checking when outdated."""
    # Create version file with old CLI version
    version_path = temp_project / ".github" / ".dr-copilot-version"
    version_path.write_text(yaml.dump({"version": "0.7.2", "components": {}}))

    checker = VersionChecker(root_path=temp_project)
    status = checker._check_copilot_version()

    assert status.component == "copilot"
    assert status.installed is True
    assert status.current_version == "0.7.2"
    assert status.expected_version == "0.7.3"
    assert status.needs_update is True
    assert "dr copilot update" in status.update_command


def test_check_copilot_version_not_installed(temp_project):
    """Test Copilot integration version checking when not installed."""
    # Don't create the version file
    checker = VersionChecker(root_path=temp_project)
    status = checker._check_copilot_version()

    assert status.component == "copilot"
    assert status.installed is False
    assert status.current_version is None
    assert status.needs_update is False
    assert status.update_command is None


def test_check_all_versions_all_up_to_date(temp_project):
    """Test checking all versions when everything is up to date."""
    # Create all version files with current versions
    schema_manifest = temp_project / ".dr" / "schemas" / ".manifest.json"
    schema_manifest.write_text(json.dumps({"spec_version": "0.6.0", "files": {}}))

    model_manifest = temp_project / "documentation-robotics" / "model" / "manifest.yaml"
    model_manifest.write_text(yaml.dump({"spec_version": "0.6.0"}))

    claude_version = temp_project / ".claude" / ".dr-version"
    claude_version.write_text(yaml.dump({"version": "0.7.3"}))

    copilot_version = temp_project / ".github" / ".dr-copilot-version"
    copilot_version.write_text(yaml.dump({"version": "0.7.3"}))

    checker = VersionChecker(root_path=temp_project)
    result = checker.check_all_versions()

    assert isinstance(result, VersionCheckResult)
    assert result.all_up_to_date is True
    assert len(result.suggestions) == 0


def test_check_all_versions_with_updates_needed(temp_project):
    """Test checking all versions when updates are needed."""
    # Create version files with mixed versions
    schema_manifest = temp_project / ".dr" / "schemas" / ".manifest.json"
    schema_manifest.write_text(json.dumps({"spec_version": "0.4.0", "files": {}}))

    model_manifest = temp_project / "documentation-robotics" / "model" / "manifest.yaml"
    model_manifest.write_text(yaml.dump({"spec_version": "0.4.0"}))

    claude_version = temp_project / ".claude" / ".dr-version"
    claude_version.write_text(yaml.dump({"version": "0.7.2"}))

    # Copilot not installed

    checker = VersionChecker(root_path=temp_project)
    result = checker.check_all_versions()

    assert result.all_up_to_date is False
    assert len(result.suggestions) == 3  # schema, model, claude need updates
    assert any("dr update" in s for s in result.suggestions)
    assert any("dr migrate" in s for s in result.suggestions)
    assert any("dr claude update" in s for s in result.suggestions)


def test_check_all_versions_integrations_not_installed(temp_project):
    """Test checking all versions when integrations are not installed."""
    # Create only schema and model, no integrations
    schema_manifest = temp_project / ".dr" / "schemas" / ".manifest.json"
    schema_manifest.write_text(json.dumps({"spec_version": "0.6.0", "files": {}}))

    model_manifest = temp_project / "documentation-robotics" / "model" / "manifest.yaml"
    model_manifest.write_text(yaml.dump({"spec_version": "0.6.0"}))

    checker = VersionChecker(root_path=temp_project)
    result = checker.check_all_versions()

    assert result.all_up_to_date is True  # Only installed components checked
    assert result.claude.installed is False
    assert result.copilot.installed is False
    assert len(result.suggestions) == 0


def test_display_version_status(temp_project, capsys):
    """Test displaying version status."""
    # Create a result with mixed statuses
    result = VersionCheckResult(
        schema=ComponentStatus(
            component="schema",
            display_name="Schema version",
            installed=True,
            current_version="0.5.0",
            expected_version="0.5.0",
            needs_update=False,
            update_command=None,
        ),
        model=ComponentStatus(
            component="model",
            display_name="Model version",
            installed=True,
            current_version="0.4.0",
            expected_version="0.5.0",
            needs_update=True,
            update_command="Run 'dr migrate' to update model to spec v0.5.0",
        ),
        claude=ComponentStatus(
            component="claude",
            display_name="Claude integration",
            installed=True,
            current_version="0.7.2",
            expected_version="0.7.3",
            needs_update=True,
            update_command="Run 'dr claude update' to sync Claude integration",
        ),
        copilot=ComponentStatus(
            component="copilot",
            display_name="Copilot integration",
            installed=False,
            current_version=None,
            expected_version="0.7.3",
            needs_update=False,
            update_command=None,
        ),
    )

    checker = VersionChecker(root_path=temp_project)
    checker.display_version_status(result)

    # Just verify it doesn't crash - Rich table output is hard to test
    # In a real scenario, you'd mock the console or check for specific output patterns


def test_component_status_dataclass():
    """Test ComponentStatus dataclass."""
    status = ComponentStatus(
        component="test",
        display_name="Test Component",
        installed=True,
        current_version="1.0.0",
        expected_version="1.0.0",
        needs_update=False,
        update_command=None,
    )

    assert status.component == "test"
    assert status.display_name == "Test Component"
    assert status.installed is True
    assert status.current_version == "1.0.0"
    assert status.expected_version == "1.0.0"
    assert status.needs_update is False
    assert status.update_command is None


def test_version_check_result_properties():
    """Test VersionCheckResult properties."""
    result = VersionCheckResult(
        schema=ComponentStatus(
            component="schema",
            display_name="Schema",
            installed=True,
            current_version="0.5.0",
            expected_version="0.5.0",
            needs_update=False,
            update_command=None,
        ),
        model=ComponentStatus(
            component="model",
            display_name="Model",
            installed=True,
            current_version="0.5.0",
            expected_version="0.5.0",
            needs_update=False,
            update_command=None,
        ),
        claude=ComponentStatus(
            component="claude",
            display_name="Claude",
            installed=False,
            current_version=None,
            expected_version="0.7.3",
            needs_update=False,
            update_command=None,
        ),
        copilot=ComponentStatus(
            component="copilot",
            display_name="Copilot",
            installed=False,
            current_version=None,
            expected_version="0.7.3",
            needs_update=False,
            update_command=None,
        ),
    )

    assert result.all_up_to_date is True
    assert len(result.suggestions) == 0
