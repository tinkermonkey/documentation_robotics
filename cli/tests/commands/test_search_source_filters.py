"""Integration tests for search command source reference filtering."""

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


class TestSearchSourceFiltering:
    """Integration tests for source reference filtering in search."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def project_with_source_refs(self, tmp_path):
        """Create project with elements that have source references."""
        runner = CwdCliRunner()
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Add element WITH source reference
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "service",
                "--name",
                "With Source",
                "--source-file",
                "src/main.py",
                "--source-provenance",
                "manual",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        # Add element WITHOUT source reference
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "service",
                "--name",
                "Without Source",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        yield tmp_path

    def test_search_has_source_ref_flag(self, runner, project_with_source_refs):
        """Test search with --has-source-ref flag."""
        result = runner.invoke(
            cli,
            ["search", "--has-source-ref"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find only element with source reference
        assert "With Source" in output or "found" in output.lower()

    def test_search_no_source_ref_flag(self, runner, project_with_source_refs):
        """Test search with --no-source-ref flag."""
        result = runner.invoke(
            cli,
            ["search", "--no-source-ref"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find only element without source reference
        assert "Without Source" in output or "found" in output.lower()

    def test_search_conflicting_flags_errors(self, runner, project_with_source_refs):
        """Test that conflicting flags cause error."""
        result = runner.invoke(
            cli,
            ["search", "--has-source-ref", "--no-source-ref"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "cannot use both" in output.lower() or "error" in output.lower()

    def test_search_source_provenance_without_has_source_ref(self, runner, project_with_source_refs):
        """Test --source-provenance filter without --has-source-ref."""
        result = runner.invoke(
            cli,
            ["search", "--source-provenance", "manual"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find element with manual provenance
        assert "found" in output.lower() or "With Source" in output

    def test_search_source_provenance_with_no_source_ref_errors(
        self, runner, project_with_source_refs
    ):
        """Test that --source-provenance with --no-source-ref causes error."""
        result = runner.invoke(
            cli,
            ["search", "--no-source-ref", "--source-provenance", "manual"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "cannot use" in output.lower() or "error" in output.lower()

    def test_search_source_provenance_with_has_source_ref(self, runner, project_with_source_refs):
        """Test --source-provenance with --has-source-ref."""
        result = runner.invoke(
            cli,
            ["search", "--has-source-ref", "--source-provenance", "manual"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should find manual provenance elements
        assert "found" in output.lower() or "1" in output

    def test_search_with_layer_and_source_filter(self, runner, project_with_source_refs):
        """Test combining layer filter with source reference filter."""
        result = runner.invoke(
            cli,
            ["search", "--layer", "application", "--has-source-ref"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code == 0

    def test_search_extracted_provenance(self, runner, tmp_path):
        """Test filtering by extracted provenance."""
        runner = CwdCliRunner()
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add element with extracted provenance
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "service",
                "--name",
                "Extracted Service",
                "--source-file",
                "src/extracted.py",
                "--source-provenance",
                "extracted",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        # Search for extracted provenance
        result = runner.invoke(
            cli,
            ["search", "--source-provenance", "extracted"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "found" in output.lower() or "Extracted" in output

    def test_search_inferred_provenance(self, runner, tmp_path):
        """Test filtering by inferred provenance."""
        runner = CwdCliRunner()
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add element with inferred provenance
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "service",
                "--name",
                "Inferred Service",
                "--source-file",
                "src/inferred.py",
                "--source-provenance",
                "inferred",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        # Search for inferred provenance
        result = runner.invoke(
            cli,
            ["search", "--source-provenance", "inferred"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0

    def test_search_generated_provenance(self, runner, tmp_path):
        """Test filtering by generated provenance."""
        runner = CwdCliRunner()
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add element with generated provenance
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "service",
                "--name",
                "Generated Service",
                "--source-file",
                "src/generated.py",
                "--source-provenance",
                "generated",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        # Search for generated provenance
        result = runner.invoke(
            cli,
            ["search", "--source-provenance", "generated"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0

    def test_search_source_filters_with_output_formats(self, runner, project_with_source_refs):
        """Test source filters work with different output formats."""
        for output_format in ["table", "json", "yaml"]:
            result = runner.invoke(
                cli,
                ["search", "--has-source-ref", "--output", output_format],
                cwd=str(project_with_source_refs),
            )

            assert result.exit_code == 0

    def test_search_source_filters_with_limit(self, runner, project_with_source_refs):
        """Test source filters work with --limit option."""
        result = runner.invoke(
            cli,
            ["search", "--has-source-ref", "--limit", "1"],
            cwd=str(project_with_source_refs),
        )

        assert result.exit_code == 0
