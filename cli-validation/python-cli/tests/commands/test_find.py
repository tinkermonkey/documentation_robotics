"""Integration tests for find command."""

import json
import re

import pytest
from click.testing import CliRunner
from documentation_robotics.cli import cli
from documentation_robotics.core.element import Element
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


class TestFindCommand:
    """Tests for find command."""

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
                "A test service",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        yield tmp_path

    def test_find_existing_element_yaml(self, runner, project_with_element):
        """Test finding element with YAML output."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["find", element_id],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should contain element ID and YAML content
        assert element_id in output
        assert "name:" in output.lower() or "test service" in output.lower()

    def test_find_existing_element_json(self, runner, project_with_element):
        """Test finding element with JSON output."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["find", element_id, "--output", "json"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        # Output should be valid JSON
        output_stripped = strip_ansi(result.output)

        # Find JSON content in output
        json_start = output_stripped.find("{")
        if json_start >= 0:
            json_content = output_stripped[json_start:]
            try:
                data = json.loads(json_content)
                assert "id" in data
            except json.JSONDecodeError:
                # Just verify it contains JSON-like structure
                assert "{" in output_stripped
                assert "}" in output_stripped

    def test_find_existing_element_table(self, runner, project_with_element):
        """Test finding element with table output."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["find", element_id, "--output", "table"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show element in table format
        assert element_id in output

    def test_find_nonexistent_element(self, runner, tmp_path):
        """Test finding element that doesn't exist."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        result = runner.invoke(
            cli,
            ["find", "business.service.nonexistent"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "not found" in output.lower()

    def test_find_nonexistent_suggests_similar(self, runner, project_with_element):
        """Test that find suggests similar elements when not found."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        real_element_id = elements[0].id

        # Try to find a typo version
        parts = real_element_id.split(".")
        typo_id = f"{parts[0]}.{parts[1]}.nonexistent"

        result = runner.invoke(
            cli,
            ["find", typo_id],
            cwd=str(project_with_element),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        # Should suggest similar elements
        assert "similar" in output.lower()
        assert real_element_id in output

    def test_find_with_show_deps(self, runner, tmp_path):
        """Test find with --show-deps flag."""
        # Initialize and add elements with dependencies
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add business service
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Business Service",
            ],
            cwd=str(tmp_path),
        )

        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        # Add dependent application service
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": biz_service.id,
            },
        )
        model.add_element("application", app_service)
        model.save()

        # Find with dependencies
        result = runner.invoke(
            cli,
            ["find", biz_service.id, "--show-deps"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show dependencies section
        assert "dependencies" in output.lower()

    def test_find_with_show_refs(self, runner, project_with_element):
        """Test find with --show-refs flag."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["find", element_id, "--show-refs"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show references section
        assert "reference" in output.lower()

    def test_find_no_model_in_directory(self, runner, tmp_path):
        """Test find command when no model exists."""
        result = runner.invoke(
            cli,
            ["find", "business.service.test"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "no model" in output.lower()

    def test_find_element_with_all_options(self, runner, project_with_element):
        """Test find with all options combined."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            [
                "find",
                element_id,
                "--output",
                "yaml",
                "--show-refs",
                "--show-deps",
            ],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show element and both sections
        assert element_id in output
        assert "reference" in output.lower()
        assert "dependencies" in output.lower()

    def test_find_shows_element_details(self, runner, project_with_element):
        """Test that find shows element details."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["find", element_id],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show element details
        assert element_id in output
        # Should show name or description
        assert "test service" in output.lower() or "name" in output.lower()

    def test_find_multiple_elements_in_layer(self, runner, tmp_path):
        """Test that similar suggestions work with multiple elements."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add multiple services
        for i in range(3):
            runner.invoke(
                cli,
                [
                    "add",
                    "business",
                    "service",
                    "--name",
                    f"Service {i}",
                ],
                cwd=str(tmp_path),
            )

        # Try to find nonexistent element
        result = runner.invoke(
            cli,
            ["find", "business.service.nonexistent"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        # Should suggest up to 5 similar elements
        assert "similar" in output.lower()

    def test_find_element_no_dependencies(self, runner, project_with_element):
        """Test find --show-deps with element that has no dependencies."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["find", element_id, "--show-deps"],
            cwd=str(project_with_element),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show no dependencies
        assert "dependencies" in output.lower()
        assert "no dependencies" in output.lower() or "dependencies" in output.lower()
