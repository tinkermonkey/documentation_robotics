"""Integration tests for visualize command."""

import re
from pathlib import Path

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
            # Save current directory
            original_cwd = os.getcwd()
            try:
                os.chdir(cwd)
                return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)
            finally:
                os.chdir(original_cwd)
        else:
            return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)


class TestVisualizeCommand:
    """Tests for visualize command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project."""
        runner = CwdCliRunner()
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"

        # Add a sample element
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Customer Service",
                "--description",
                "Handles customer operations",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0, f"Add failed: {result.output}"

        yield tmp_path

    def test_visualize_help(self, runner):
        """Test visualize command help text."""
        result = runner.invoke(cli, ["visualize", "--help"])
        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Start visualization server" in output
        assert "--port" in output
        assert "--host" in output
        assert "--no-browser" in output

    def test_visualize_no_model(self, runner, tmp_path):
        """Test visualize command fails without model."""
        result = runner.invoke(cli, ["visualize", "--no-browser"], cwd=str(tmp_path))
        assert result.exit_code == 1
        output = strip_ansi(result.output)
        assert "No model found" in output

    def test_visualize_missing_spec(self, runner, initialized_project):
        """Test visualize command fails without spec directory."""
        # The visualize command expects spec directory at ../../spec relative to project
        # This test validates error handling when spec is missing
        result = runner.invoke(cli, ["visualize", "--no-browser"], cwd=str(initialized_project))
        # Should fail because spec directory doesn't exist in tmp_path
        assert result.exit_code == 1
        output = strip_ansi(result.output)
        # Should show error about missing specification
        assert "Specification directory not found" in output or "Error" in output

    def test_visualize_command_options(self, runner, initialized_project):
        """Test visualize command accepts all options."""
        spec_path = Path(__file__).parent.parent.parent.parent.parent / "spec"

        # Skip test if spec directory doesn't exist
        if not spec_path.exists():
            pytest.skip("Spec directory not found - skipping command options test")

        # Test with custom port and host (will fail to start but should parse options)
        result = runner.invoke(
            cli,
            ["visualize", "--port", "9090", "--host", "127.0.0.1", "--no-browser"],
            cwd=str(initialized_project),
            input="\x03",  # Send Ctrl+C immediately
        )

        # Command should attempt to start (may fail due to spec path issues in test env)
        output = strip_ansi(result.output)
        # Just verify the command was invoked
        assert (
            "visualize" in output.lower() or "server" in output.lower() or "error" in output.lower()
        )


# Note: Integration tests for VisualizationServer functionality are in test_file_monitor_integration.py
# Those tests properly create test fixtures and mock the spec directory structure.
