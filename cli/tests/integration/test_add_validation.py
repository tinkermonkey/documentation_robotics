"""Integration tests for entity type validation in add command."""

import os
import re

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
        cli,
        args=None,
        input=None,
        env=None,
        catch_exceptions=True,
        color=False,
        cwd=None,
        **extra,
    ):
        """Invoke CLI with optional cwd support."""
        if cwd is not None:
            # Save current directory
            original_cwd = os.getcwd()
            try:
                os.chdir(cwd)
                return super().invoke(cli, args, input, env, catch_exceptions, color, **extra)
            finally:
                os.chdir(original_cwd)
        else:
            return super().invoke(cli, args, input, env, catch_exceptions, color, **extra)


class TestAddEntityTypeValidation:
    """Tests for entity type validation in dr add command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project."""
        runner = CwdCliRunner()
        # Initialize project - init creates project at the path location
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"
        # Return the tmp_path since init creates the project there
        yield tmp_path

    def test_add_with_valid_entity_type_succeeds(self, runner, initialized_project):
        """Test that add command succeeds with valid entity type."""
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Customer Management",
                "--description",
                "Handles customer operations",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_with_invalid_entity_type_fails(self, runner, initialized_project):
        """Test that add command fails with invalid entity type."""
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "unicorn",  # Invalid type
                "--name",
                "Magic Service",
            ],
            cwd=str(initialized_project),
        )

        # Should fail
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "Invalid entity type 'unicorn'" in output
        assert "business" in output

    def test_add_error_shows_valid_types(self, runner, initialized_project):
        """Test that error message shows list of valid entity types."""
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "dragon",  # Invalid type
                "--name",
                "Fire Service",
            ],
            cwd=str(initialized_project),
        )

        # Should show valid types
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "Valid entity types for 'business' layer:" in output
        # Business layer should have these types from schema
        assert any(t in output for t in ["service", "process", "actor", "role", "event", "object"])

    def test_add_application_component_succeeds(self, runner, initialized_project):
        """Test that add command works for application layer."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "User Interface",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_invalid_application_type_fails(self, runner, initialized_project):
        """Test that invalid application type fails."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "widget",  # Invalid type
                "--name",
                "Test Widget",
            ],
            cwd=str(initialized_project),
        )

        # Should fail with helpful message
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "Invalid entity type 'widget'" in output
        assert "application" in output

    def test_add_validation_is_case_insensitive(self, runner, initialized_project):
        """Test that entity type validation is case-insensitive."""
        # Try uppercase version of valid type
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "SERVICE",  # Valid type in uppercase
                "--name",
                "Test Service",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed (validation is case-insensitive)
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_api_layer_special_types(self, runner, initialized_project):
        """Test that API layer accepts its special entity types."""
        result = runner.invoke(
            cli,
            [
                "add",
                "api",
                "operation",  # Special API layer type
                "--name",
                "Get Users",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_data_model_layer_special_types(self, runner, initialized_project):
        """Test that data_model layer accepts its special entity types."""
        result = runner.invoke(
            cli,
            [
                "add",
                "data_model",
                "entity",  # Special data_model layer type
                "--name",
                "User",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output
