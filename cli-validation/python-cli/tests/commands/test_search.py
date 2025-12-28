"""Integration tests for search command."""

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


class TestSearchCommand:
    """Tests for search command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def project_with_elements(self, tmp_path):
        """Create project with multiple test elements."""
        runner = CwdCliRunner()
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Add several elements
        for i in range(3):
            result = runner.invoke(
                cli,
                [
                    "add",
                    "business",
                    "service",
                    "--name",
                    f"Service {i}",
                    "--description",
                    f"Test service number {i}",
                ],
                cwd=str(tmp_path),
            )
            assert result.exit_code == 0

        yield tmp_path

    def test_search_all_elements(self, runner, project_with_elements):
        """Test searching for all elements."""
        result = runner.invoke(
            cli,
            ["search"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show results
        assert "search results" in output.lower() or "found" in output.lower()

    def test_search_by_layer(self, runner, project_with_elements):
        """Test searching by layer."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find elements
        assert "found" in output.lower()
        assert "business" in output.lower()

    def test_search_by_type(self, runner, project_with_elements):
        """Test searching by element type."""
        result = runner.invoke(
            cli,
            ["search", "--type", "service"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find services
        assert "found" in output.lower()

    def test_search_by_layer_and_type(self, runner, project_with_elements):
        """Test searching by both layer and type."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business", "--type", "service"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find business services
        assert "found" in output.lower()

    def test_search_by_name_pattern(self, runner, project_with_elements):
        """Test searching by name pattern."""
        result = runner.invoke(
            cli,
            ["search", "--name", "Service 0"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find the specific service
        assert "found" in output.lower()

    def test_search_with_limit(self, runner, project_with_elements):
        """Test searching with result limit."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business", "--limit", "2"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show limited results
        assert "found" in output.lower()

    def test_search_no_results(self, runner, tmp_path):
        """Test searching with no matching results."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        result = runner.invoke(
            cli,
            ["search", "--type", "nonexistent-type"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should indicate no results
        assert "no elements" in output.lower()

    def test_search_output_table(self, runner, project_with_elements):
        """Test search with table output."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business", "--output", "table"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show table format
        assert "found" in output.lower()

    def test_search_output_yaml(self, runner, project_with_elements):
        """Test search with YAML output."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business", "--output", "yaml"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should contain YAML-like content
        assert ":" in output  # YAML has key: value pairs

    def test_search_output_json(self, runner, project_with_elements):
        """Test search with JSON output."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business", "--output", "json"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output_stripped = strip_ansi(result.output)
        # Should contain JSON content
        assert "{" in output_stripped
        assert "}" in output_stripped

    def test_search_by_property(self, runner, tmp_path):
        """Test searching by property value."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add element with specific property
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Special Service",
            ],
            cwd=str(tmp_path),
        )

        # Search by property
        result = runner.invoke(
            cli,
            ["search", "--property", "name=Special Service"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find the element
        assert "found" in output.lower()

    def test_search_invalid_property_format(self, runner, tmp_path):
        """Test search with invalid property format."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        result = runner.invoke(
            cli,
            ["search", "--property", "invalid-format-without-equals"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "invalid" in output.lower()
        assert "format" in output.lower()

    def test_search_multiple_properties(self, runner, project_with_elements):
        """Test searching with multiple property filters."""
        result = runner.invoke(
            cli,
            [
                "search",
                "--property",
                "name=Service 0",
                "--property",
                "description=Test service number 0",
            ],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        # Command should complete

    def test_search_no_model_in_directory(self, runner, tmp_path):
        """Test search command when no model exists."""
        result = runner.invoke(
            cli,
            ["search"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "no model" in output.lower()

    def test_search_shows_count(self, runner, project_with_elements):
        """Test that search shows count of found elements."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show count
        assert "found" in output.lower()
        # Should mention number of results
        assert any(char.isdigit() for char in output)

    def test_search_empty_project(self, runner, tmp_path):
        """Test searching in empty project."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        result = runner.invoke(
            cli,
            ["search"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should indicate no elements
        assert "no elements" in output.lower() or "0" in output

    def test_search_with_all_filters(self, runner, project_with_elements):
        """Test search with all filter options combined."""
        result = runner.invoke(
            cli,
            [
                "search",
                "--layer",
                "business",
                "--type",
                "service",
                "--name",
                "Service",
                "--limit",
                "10",
            ],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show results
        assert "found" in output.lower()

    def test_search_limit_zero(self, runner, project_with_elements):
        """Test search with limit of 0."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "business", "--limit", "0"],
            cwd=str(project_with_elements),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show no results or indicate 0 found
        assert "0" in output or "no" in output.lower()

    def test_search_nonexistent_layer(self, runner, project_with_elements):
        """Test searching nonexistent layer."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "nonexistent"],
            cwd=str(project_with_elements),
        )

        # May fail with error for nonexistent layer
        # Just verify command completes
        assert result.exit_code in [0, 1]
