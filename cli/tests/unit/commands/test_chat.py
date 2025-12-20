"""Unit tests for chat command helper functions."""

from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from click.testing import CliRunner
from documentation_robotics.commands.chat import (
    _resolve_model_path,
    _show_help,
    _show_welcome,
    chat,
)


class TestModelPathResolution:
    """Tests for _resolve_model_path function."""

    def test_resolve_with_override(self, tmp_path):
        """Test model path resolution with explicit override."""
        model_dir = tmp_path / "my-model"
        model_dir.mkdir()

        result = _resolve_model_path(str(model_dir))
        assert result == model_dir

    def test_resolve_documentation_robotics_structure(self, tmp_path, monkeypatch):
        """Test finding model in documentation-robotics/model structure."""
        # Create structure
        model_dir = tmp_path / "documentation-robotics" / "model"
        model_dir.mkdir(parents=True)

        # Change to temp directory
        monkeypatch.chdir(tmp_path)

        result = _resolve_model_path(None)
        assert result == model_dir

    def test_resolve_dr_structure(self, tmp_path, monkeypatch):
        """Test finding model in .dr structure."""
        # Create .dr directory
        dr_dir = tmp_path / ".dr"
        dr_dir.mkdir()

        # Change to temp directory
        monkeypatch.chdir(tmp_path)

        result = _resolve_model_path(None)
        assert result == tmp_path

    def test_resolve_missing_model(self, tmp_path, monkeypatch):
        """Test error when model not found."""
        import click

        # Change to temp directory with no model
        monkeypatch.chdir(tmp_path)

        with pytest.raises(click.Abort):
            _resolve_model_path(None)


class TestWelcomeBanner:
    """Tests for _show_welcome function."""

    def test_show_welcome_with_manifest(self):
        """Test welcome banner with valid manifest."""
        model_path = Path("/test/model")

        # Mock orchestrator
        mock_orchestrator = Mock()
        mock_orchestrator.build_model_context.return_value = {
            "manifest": {"name": "Test Model", "version": "1.0.0"}
        }

        # Call should not raise
        _show_welcome(model_path, mock_orchestrator)

        # Verify context was requested
        mock_orchestrator.build_model_context.assert_called_once()

    def test_show_welcome_without_manifest(self):
        """Test welcome banner without manifest."""
        model_path = Path("/test/model")

        # Mock orchestrator with empty context
        mock_orchestrator = Mock()
        mock_orchestrator.build_model_context.return_value = {}

        # Call should not raise
        _show_welcome(model_path, mock_orchestrator)


class TestHelp:
    """Tests for _show_help function."""

    def test_show_help(self):
        """Test help display."""
        # Should not raise
        _show_help()


class TestChatCommand:
    """Tests for main chat command."""

    def test_chat_command_help(self):
        """Test chat command help text."""
        runner = CliRunner()
        result = runner.invoke(chat, ["--help"])

        assert result.exit_code == 0
        assert "Interactive chat with DrBot" in result.output
        assert "--model-dir" in result.output

    def test_chat_command_missing_sdk(self, tmp_path):
        """Test chat command with missing Anthropic SDK."""
        # Create model structure
        model_dir = tmp_path / "documentation-robotics" / "model"
        model_dir.mkdir(parents=True)

        # Create minimal manifest
        manifest = model_dir / "manifest.yaml"
        manifest.write_text("name: Test\nspecVersion: 0.5.0\n")

        # Mock both the API key check and find_spec to isolate SDK check
        with patch("os.getenv") as mock_getenv, patch(
            "importlib.util.find_spec", return_value=None
        ):
            # Mock API key to return a valid value
            mock_getenv.return_value = "sk-test-key"

            runner = CliRunner()
            result = runner.invoke(chat, ["--model-dir", str(model_dir.parent.parent)])

            assert result.exit_code != 0
            assert "Anthropic SDK not installed" in result.output

    def test_chat_command_invalid_model_dir(self):
        """Test chat command with invalid model directory."""
        runner = CliRunner()
        result = runner.invoke(chat, ["--model-dir", "/nonexistent/path"])

        # Should fail due to path not existing
        assert result.exit_code != 0
