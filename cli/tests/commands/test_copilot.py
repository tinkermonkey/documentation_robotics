"""Integration tests for copilot command."""

import re
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml
from click.testing import CliRunner
from documentation_robotics.cli import cli


def strip_ansi(text):
    """Remove ANSI escape codes from text."""
    ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
    return ansi_escape.sub("", text)


class CwdCliRunner(CliRunner):
    """CLI runner that supports cwd parameter."""

    def invoke(
        self,
        cli_cmd,
        args=None,
        input=None,
        env=None,
        catch_exceptions=True,
        color=False,
        cwd=None,
        **extra,
    ):
        """Invoke CLI with optional cwd support."""
        import os

        if cwd is not None:
            original_cwd = os.getcwd()
            try:
                os.chdir(cwd)
                return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)
            finally:
                os.chdir(original_cwd)
        else:
            return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)


class TestCopilotCommand:
    """Tests for copilot command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def integration_source(self, tmp_path):
        """Create a dummy integration source directory."""
        source = tmp_path / "integration_source"
        source.mkdir()
        
        # Create knowledge files
        knowledge_dir = source / "knowledge"
        knowledge_dir.mkdir()
        (knowledge_dir / "test-guide.md").write_text("# Test Guide")
        
        # Create agents files
        agents_dir = source / "agents"
        agents_dir.mkdir()
        (agents_dir / "test-agent.md").write_text("# Test Agent")
        
        return source

    @pytest.fixture
    def project_dir(self, tmp_path):
        """Create a dummy project directory."""
        project = tmp_path / "test_project"
        project.mkdir()
        return project

    def test_install(self, runner, project_dir, integration_source):
        """Test copilot install command."""
        with patch("documentation_robotics.commands.copilot.INTEGRATION_ROOT", integration_source):
            result = runner.invoke(cli, ["--no-upgrade-check", "copilot", "install"], cwd=str(project_dir))

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "copilot integration installed successfully" in output.lower()
        
        # Verify files installed
        github_dir = project_dir / ".github"
        assert github_dir.exists()
        assert (github_dir / "knowledge" / "test-guide.md").exists()
        assert (github_dir / "agents" / "test-agent.md").exists()
        assert (github_dir / ".dr-copilot-version").exists()

    def test_install_specific_component(self, runner, project_dir, integration_source):
        """Test installing specific components."""
        with patch("documentation_robotics.commands.copilot.INTEGRATION_ROOT", integration_source):
            result = runner.invoke(
                cli, 
                ["--no-upgrade-check", "copilot", "install", "--knowledge-only"], 
                cwd=str(project_dir)
            )

        assert result.exit_code == 0
        
        # Verify only knowledge installed
        github_dir = project_dir / ".github"
        assert (github_dir / "knowledge" / "test-guide.md").exists()
        assert not (github_dir / "agents" / "test-agent.md").exists()

    def test_status_not_installed(self, runner, project_dir):
        """Test status when not installed."""
        result = runner.invoke(cli, ["--no-upgrade-check", "copilot", "status"], cwd=str(project_dir))
        
        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "not installed" in output.lower()

    def test_status_installed(self, runner, project_dir, integration_source):
        """Test status when installed."""
        # Install first
        with patch("documentation_robotics.commands.copilot.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "copilot", "install"], cwd=str(project_dir))
            
            # Check status
            result = runner.invoke(cli, ["--no-upgrade-check", "copilot", "status"], cwd=str(project_dir))

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "installation status" in output.lower()
        assert "knowledge" in output.lower()
        assert "agents" in output.lower()

    def test_update_no_changes(self, runner, project_dir, integration_source):
        """Test update when no changes needed."""
        # Install first
        with patch("documentation_robotics.commands.copilot.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "copilot", "install"], cwd=str(project_dir))
            
            # Update
            result = runner.invoke(cli, ["--no-upgrade-check", "copilot", "update"], cwd=str(project_dir))

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "all files are up to date" in output.lower()

    def test_update_with_changes(self, runner, project_dir, integration_source):
        """Test update when changes are available."""
        # Install first
        with patch("documentation_robotics.commands.copilot.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "copilot", "install"], cwd=str(project_dir))
            
            # Modify source file
            (integration_source / "knowledge" / "test-guide.md").write_text("# Updated Guide")
            
            # Update
            result = runner.invoke(
                cli, 
                ["--no-upgrade-check", "copilot", "update", "--force"], 
                cwd=str(project_dir)
            )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "updated test-guide.md" in output.lower()
        
        # Verify file updated
        installed_file = project_dir / ".github" / "knowledge" / "test-guide.md"
        assert installed_file.read_text() == "# Updated Guide"

    def test_remove(self, runner, project_dir, integration_source):
        """Test remove command."""
        # Install first
        with patch("documentation_robotics.commands.copilot.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "copilot", "install"], cwd=str(project_dir))
            
            # Remove
            result = runner.invoke(
                cli, 
                ["--no-upgrade-check", "copilot", "remove", "--force"], 
                cwd=str(project_dir)
            )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "removed successfully" in output.lower()
        
        # Verify files removed
        github_dir = project_dir / ".github"
        assert not (github_dir / "knowledge" / "test-guide.md").exists()
        assert not (github_dir / "agents" / "test-agent.md").exists()
        assert not (github_dir / ".dr-copilot-version").exists()

    def test_list(self, runner, project_dir):
        """Test list command."""
        result = runner.invoke(cli, ["--no-upgrade-check", "copilot", "list"], cwd=str(project_dir))
        
        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "available components" in output.lower()
        assert "knowledge" in output.lower()
        assert "agents" in output.lower()
