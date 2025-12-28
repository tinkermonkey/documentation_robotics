"""Integration tests for update command."""

import re
import tempfile
from pathlib import Path

import pytest
from click.testing import CliRunner
from documentation_robotics.cli import cli
from documentation_robotics.core.model import Model


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


class TestUpdateCommand:
    """Tests for update command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def project_with_element(self, tmp_path):
        """Create project with a test element."""
        runner = CwdCliRunner()
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Add an element
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Test Service",
                "--description",
                "Original description",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        yield tmp_path

    def test_update_nonexistent_element(self, runner, tmp_path):
        """Test updating element that doesn't exist."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        result = runner.invoke(
            cli,
            ["update-element", "business.service.nonexistent", "--set", "name=Test"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "not found" in output.lower()

    def test_update_element_with_set_option(self, runner, project_with_element):
        """Test updating element with --set option."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["update-element", element_id, "--set", "description=Updated description"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "successfully updated" in output.lower()

        # Verify update
        model = Model(project_with_element)
        element = model.get_element(element_id)
        assert element.data["description"] == "Updated description"

    def test_update_element_with_multiple_set_options(self, runner, project_with_element):
        """Test updating element with multiple --set options."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            [
                "update-element",
                element_id,
                "--set",
                "description=New description",
                "--set",
                "status=active",
            ],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0

        # Verify updates
        model = Model(project_with_element)
        element = model.get_element(element_id)
        assert element.data["description"] == "New description"
        assert element.data["status"] == "active"

    def test_update_element_with_spec_file(self, runner, project_with_element):
        """Test updating element with --spec file."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        # Create spec file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("description: Updated via spec\n")
            f.write("priority: high\n")
            spec_file = f.name

        try:
            result = runner.invoke(
                cli,
                ["update-element", element_id, "--spec", spec_file],
                cwd=str(project_with_element),
            )

            assert result.exit_code == 0

            # Verify updates
            model = Model(project_with_element)
            element = model.get_element(element_id)
            assert element.data["description"] == "Updated via spec"
            assert element.data["priority"] == "high"
        finally:
            Path(spec_file).unlink()

    def test_update_element_dry_run(self, runner, project_with_element):
        """Test update with --dry-run flag."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id
        original_description = elements[0].data.get("description")

        result = runner.invoke(
            cli,
            [
                "update-element",
                element_id,
                "--set",
                "description=New description",
                "--dry-run",
            ],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "dry run" in output.lower()
        assert "not saving" in output.lower()

        # Verify element unchanged
        model = Model(project_with_element)
        element = model.get_element(element_id)
        assert element.data.get("description") == original_description

    def test_update_no_updates_specified(self, runner, project_with_element):
        """Test update with no updates specified."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["update-element", element_id],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "no updates specified" in output.lower()

    def test_update_invalid_set_format(self, runner, project_with_element):
        """Test update with invalid --set format."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["update-element", element_id, "--set", "invalid-format-without-equals"],
            cwd=str(project_with_element),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "invalid" in output.lower()
        assert "format" in output.lower()

    def test_update_shows_element_id(self, runner, project_with_element):
        """Test that update shows element ID being updated."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["update-element", element_id, "--set", "test=value", "--dry-run"],
            cwd=str(project_with_element),
        )

        output = strip_ansi(result.output)
        assert element_id in output
        assert "updating element" in output.lower()

    def test_update_shows_updates_preview(self, runner, project_with_element):
        """Test that update shows preview of updates."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            [
                "update-element",
                element_id,
                "--set",
                "description=New description",
                "--dry-run",
            ],
            cwd=str(project_with_element),
        )

        output = strip_ansi(result.output)
        assert "would set properties" in output.lower()
        assert "description" in output.lower()
        assert "New description" in output
        assert "dry run" in output.lower()

    def test_update_no_model_in_directory(self, runner, tmp_path):
        """Test update command when no model exists."""
        result = runner.invoke(
            cli,
            ["update-element", "business.service.test", "--set", "name=Test"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "no model" in output.lower()

    def test_update_with_equals_in_value(self, runner, project_with_element):
        """Test update with equals sign in value."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["update-element", element_id, "--set", "formula=x=y+z"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0

        # Verify value with equals
        model = Model(project_with_element)
        element = model.get_element(element_id)
        assert element.data["formula"] == "x=y+z"

    def test_update_spec_and_set_combined(self, runner, project_with_element):
        """Test updating with both --spec and --set (set should override)."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        # Create spec file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("description: From spec\n")
            f.write("priority: medium\n")
            spec_file = f.name

        try:
            result = runner.invoke(
                cli,
                [
                    "update-element",
                    element_id,
                    "--spec",
                    spec_file,
                    "--set",
                    "priority=high",  # This should override spec
                ],
                cwd=str(project_with_element),
            )

            assert result.exit_code == 0

            # Verify --set overrides --spec
            model = Model(project_with_element)
            element = model.get_element(element_id)
            assert element.data["description"] == "From spec"
            assert element.data["priority"] == "high"  # Overridden by --set
        finally:
            Path(spec_file).unlink()

    def test_update_numeric_value(self, runner, project_with_element):
        """Test updating with numeric value."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["update-element", element_id, "--set", "priority=1"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0

        # Note: values from --set are strings
        model = Model(project_with_element)
        element = model.get_element(element_id)
        assert element.data["priority"] == "1"

    def test_update_empty_value(self, runner, project_with_element):
        """Test updating with empty value."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["update-element", element_id, "--set", "optional="],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0

        # Empty value should be set
        model = Model(project_with_element)
        element = model.get_element(element_id)
        assert element.data["optional"] == ""

    def test_update_overwrites_existing_property(self, runner, project_with_element):
        """Test that update overwrites existing property."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id
        original_name = elements[0].data.get("name")

        result = runner.invoke(
            cli,
            ["update-element", element_id, "--set", "name=Updated Name"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0

        # Verify overwrite
        model = Model(project_with_element)
        element = model.get_element(element_id)
        assert element.data["name"] == "Updated Name"
        assert element.data["name"] != original_name
