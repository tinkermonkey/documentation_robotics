"""Integration tests for claude command."""

import re
from unittest.mock import patch

import pytest
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


class TestClaudeCommand:
    """Tests for claude command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def integration_source(self, tmp_path):
        """Create a dummy integration source directory."""
        source = tmp_path / "integration_source"
        source.mkdir()

        # Create component directories
        (source / "reference_sheets").mkdir()
        (source / "reference_sheets" / "test-sheet.md").write_text("# Test Sheet")

        (source / "commands").mkdir()
        (source / "commands" / "test-cmd.md").write_text("# Test Command")

        (source / "agents").mkdir()
        (source / "agents" / "test-agent.md").write_text("# Test Agent")

        (source / "skills").mkdir()
        (source / "skills" / "test-skill").mkdir()
        (source / "skills" / "test-skill" / "SKILL.md").write_text("# Test Skill")

        (source / "templates").mkdir()
        (source / "templates" / "test-template.md").write_text("# Test Template")

        return source

    @pytest.fixture
    def project_dir(self, tmp_path):
        """Create a dummy project directory."""
        project = tmp_path / "test_project"
        project.mkdir()
        return project

    def test_install(self, runner, project_dir, integration_source):
        """Test claude install command."""
        with patch("documentation_robotics.commands.claude.INTEGRATION_ROOT", integration_source):
            result = runner.invoke(
                cli, ["--no-upgrade-check", "claude", "install"], cwd=str(project_dir)
            )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "claude integration installed successfully" in output.lower()

        # Verify files installed
        claude_dir = project_dir / ".claude"
        assert claude_dir.exists()
        assert (claude_dir / "knowledge" / "dr-test-sheet.md").exists()
        assert (claude_dir / "commands" / "test-cmd.md").exists()
        assert (claude_dir / "agents" / "test-agent.md").exists()
        assert (claude_dir / "skills" / "test-skill" / "SKILL.md").exists()
        assert (claude_dir / "templates" / "test-template.md").exists()
        assert (claude_dir / ".dr-version").exists()

    def test_install_missing_source(self, runner, project_dir, tmp_path):
        """Test install fails when source is missing."""
        empty_source = tmp_path / "empty_source"
        empty_source.mkdir()

        with patch("documentation_robotics.commands.claude.INTEGRATION_ROOT", empty_source):
            result = runner.invoke(
                cli, ["--no-upgrade-check", "claude", "install"], cwd=str(project_dir)
            )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "installation failed" in output.lower()
        assert "no files were installed" in output.lower()

    def test_status_not_installed(self, runner, project_dir):
        """Test status when not installed."""
        result = runner.invoke(
            cli, ["--no-upgrade-check", "claude", "status"], cwd=str(project_dir)
        )
        assert result.exit_code == 0
        assert "not installed" in strip_ansi(result.output).lower()

    def test_status_installed(self, runner, project_dir, integration_source):
        """Test status when installed."""
        with patch("documentation_robotics.commands.claude.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "claude", "install"], cwd=str(project_dir))
            result = runner.invoke(
                cli, ["--no-upgrade-check", "claude", "status"], cwd=str(project_dir)
            )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "installation status" in output.lower()
        assert "reference_sheets" in output
        assert "commands" in output

    def test_update_no_changes(self, runner, project_dir, integration_source):
        """Test update with no changes."""
        with patch("documentation_robotics.commands.claude.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "claude", "install"], cwd=str(project_dir))
            result = runner.invoke(
                cli, ["--no-upgrade-check", "claude", "update"], cwd=str(project_dir)
            )

        assert result.exit_code == 0
        assert "all files are up to date" in strip_ansi(result.output).lower()

    def test_update_with_changes(self, runner, project_dir, integration_source):
        """Test update with changes."""
        with patch("documentation_robotics.commands.claude.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "claude", "install"], cwd=str(project_dir))

            # Modify source file
            (integration_source / "commands" / "test-cmd.md").write_text("# Modified Command")

            # Run update
            result = runner.invoke(
                cli,
                ["--no-upgrade-check", "claude", "update", "--force"],
                cwd=str(project_dir),
            )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "updating test-cmd.md" in output.lower()

        # Verify file updated
        installed_file = project_dir / ".claude" / "commands" / "test-cmd.md"
        assert installed_file.read_text() == "# Modified Command"

    def test_remove(self, runner, project_dir, integration_source):
        """Test remove command."""
        with patch("documentation_robotics.commands.claude.INTEGRATION_ROOT", integration_source):
            runner.invoke(cli, ["--no-upgrade-check", "claude", "install"], cwd=str(project_dir))
            result = runner.invoke(
                cli,
                ["--no-upgrade-check", "claude", "remove", "--force"],
                cwd=str(project_dir),
            )

        assert result.exit_code == 0
        assert "removed successfully" in strip_ansi(result.output).lower()
        assert not (project_dir / ".claude" / ".dr-version").exists()

    def test_list(self, runner, project_dir):
        """Test list command."""
        result = runner.invoke(cli, ["--no-upgrade-check", "claude", "list"], cwd=str(project_dir))
        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "available components" in output.lower()
        assert "reference_sheets" in output
        assert "agents" in output
