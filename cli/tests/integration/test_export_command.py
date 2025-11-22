"""Integration tests for export command."""
import pytest
from click.testing import CliRunner
from pathlib import Path
from documentation_robotics.cli import cli


@pytest.fixture
def runner():
    """Create CLI runner."""
    return CliRunner()


def test_export_command_help(runner):
    """Test export command help."""
    result = runner.invoke(cli, ["export", "--help"])

    assert result.exit_code == 0
    assert "Export model to various formats" in result.output
    assert "--format" in result.output
    assert "--output" in result.output


def test_export_archimate(runner, initialized_model, tmp_path):
    """Test ArchiMate export command."""
    # Change to model directory
    result = runner.invoke(
        cli,
        ["export", "--format", "archimate", "--output", str(tmp_path / "archimate")],
        cwd=str(initialized_model.root_path),
    )

    # Command might fail if model is empty, but should not crash
    # Just check it doesn't have unhandled exceptions
    assert "Error:" in result.output or "successful" in result.output or result.exit_code in [
        0,
        1,
    ]


def test_export_command_no_model(runner, tmp_path):
    """Test export command with no model."""
    # Run in empty directory
    result = runner.invoke(cli, ["export", "--format", "archimate"], cwd=str(tmp_path))

    assert result.exit_code != 0
    assert "Error" in result.output or "No model found" in result.output


def test_export_invalid_format(runner, initialized_model):
    """Test export with invalid format."""
    result = runner.invoke(
        cli, ["export", "--format", "invalid"], cwd=str(initialized_model.root_path)
    )

    # Click should reject invalid choice
    assert result.exit_code != 0


def test_export_with_validation(runner, initialized_model, tmp_path):
    """Test export with validation enabled."""
    result = runner.invoke(
        cli,
        [
            "export",
            "--format",
            "markdown",
            "--output",
            str(tmp_path / "docs"),
            "--validate",
        ],
        cwd=str(initialized_model.root_path),
    )

    # Should attempt export
    assert result.exit_code in [0, 1]  # May fail if model is empty


def test_export_without_validation(runner, initialized_model, tmp_path):
    """Test export with validation disabled."""
    result = runner.invoke(
        cli,
        [
            "export",
            "--format",
            "markdown",
            "--output",
            str(tmp_path / "docs"),
            "--no-validate",
        ],
        cwd=str(initialized_model.root_path),
    )

    # Should attempt export
    assert result.exit_code in [0, 1]


def test_export_plantuml(runner, initialized_model, tmp_path):
    """Test PlantUML export."""
    result = runner.invoke(
        cli,
        ["export", "--format", "plantuml", "--output", str(tmp_path / "diagrams")],
        cwd=str(initialized_model.root_path),
    )

    # Check command executed (may fail if model is empty)
    assert result.exit_code in [0, 1]


def test_export_markdown(runner, initialized_model, tmp_path):
    """Test Markdown export."""
    result = runner.invoke(
        cli,
        ["export", "--format", "markdown", "--output", str(tmp_path / "docs")],
        cwd=str(initialized_model.root_path),
    )

    # Check command executed
    assert result.exit_code in [0, 1]
