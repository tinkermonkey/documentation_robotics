"""Unit tests for utils.user_identity module."""

import json
from unittest.mock import patch

from documentation_robotics.utils.user_identity import (
    STATE_FILE,
    ensure_username,
    get_username,
    prompt_for_username,
    save_username,
    validate_username,
)


class TestGetUsername:
    """Tests for get_username function."""

    def test_get_username_file_exists(self, tmp_path):
        """Test getting username when state file exists."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"annotation_user": "alice"}))

        username = get_username(tmp_path)
        assert username == "alice"

    def test_get_username_file_not_exists(self, tmp_path):
        """Test getting username when state file doesn't exist."""
        username = get_username(tmp_path)
        assert username is None

    def test_get_username_no_annotation_user_field(self, tmp_path):
        """Test getting username when state file exists but has no annotation_user."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"other_field": "value"}))

        username = get_username(tmp_path)
        assert username is None

    def test_get_username_invalid_json(self, tmp_path):
        """Test getting username when state file has invalid JSON."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text("invalid json {")

        username = get_username(tmp_path)
        assert username is None


class TestValidateUsername:
    """Tests for validate_username function."""

    def test_valid_usernames(self):
        """Test valid username formats."""
        assert validate_username("alice") is True
        assert validate_username("bob123") is True
        assert validate_username("user_name") is True
        assert validate_username("user-name") is True
        assert validate_username("User123_test-name") is True

    def test_invalid_usernames(self):
        """Test invalid username formats."""
        assert validate_username("") is False
        assert validate_username("user name") is False  # spaces not allowed
        assert validate_username("user@name") is False  # special chars not allowed
        assert validate_username("user.name") is False  # dots not allowed
        assert validate_username("user/name") is False  # slashes not allowed


class TestPromptForUsername:
    """Tests for prompt_for_username function."""

    @patch("documentation_robotics.utils.user_identity.click.prompt")
    def test_prompt_valid_username(self, mock_prompt):
        """Test prompting returns valid username."""
        mock_prompt.return_value = "alice"

        username = prompt_for_username()
        assert username == "alice"
        mock_prompt.assert_called_once()

    @patch("documentation_robotics.utils.user_identity.click.prompt")
    @patch("documentation_robotics.utils.user_identity.click.echo")
    def test_prompt_retries_on_invalid(self, mock_echo, mock_prompt):
        """Test prompting retries on invalid username."""
        # First return invalid, then valid
        mock_prompt.side_effect = ["invalid user", "alice"]

        username = prompt_for_username()
        assert username == "alice"
        assert mock_prompt.call_count == 2
        mock_echo.assert_called_once()

    @patch("documentation_robotics.utils.user_identity.click.prompt")
    @patch("documentation_robotics.utils.user_identity.click.echo")
    def test_prompt_multiple_retries(self, mock_echo, mock_prompt):
        """Test prompting retries multiple times until valid."""
        mock_prompt.side_effect = ["", "user name", "user@123", "alice"]

        username = prompt_for_username()
        assert username == "alice"
        assert mock_prompt.call_count == 4
        assert mock_echo.call_count == 3


class TestSaveUsername:
    """Tests for save_username function."""

    def test_save_username_new_file(self, tmp_path):
        """Test saving username creates new state file."""
        save_username(tmp_path, "alice")

        state_file = tmp_path / STATE_FILE
        assert state_file.exists()

        state = json.loads(state_file.read_text())
        assert state["annotation_user"] == "alice"

    def test_save_username_creates_directory(self, tmp_path):
        """Test saving username creates .dr directory if needed."""
        save_username(tmp_path, "alice")

        dr_dir = tmp_path / ".dr"
        assert dr_dir.exists()
        assert dr_dir.is_dir()

    def test_save_username_preserves_existing_fields(self, tmp_path):
        """Test saving username preserves other fields in state file."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"other_field": "value", "another_field": 123}))

        save_username(tmp_path, "alice")

        state = json.loads(state_file.read_text())
        assert state["annotation_user"] == "alice"
        assert state["other_field"] == "value"
        assert state["another_field"] == 123

    def test_save_username_updates_existing_username(self, tmp_path):
        """Test saving username updates existing annotation_user field."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"annotation_user": "bob"}))

        save_username(tmp_path, "alice")

        state = json.loads(state_file.read_text())
        assert state["annotation_user"] == "alice"

    def test_save_username_uses_atomic_write(self, tmp_path):
        """Test save uses atomic write (temp file then rename)."""
        save_username(tmp_path, "alice")

        state_file = tmp_path / STATE_FILE
        temp_file = state_file.with_suffix(".tmp")

        # Temp file should not exist after successful write
        assert not temp_file.exists()
        assert state_file.exists()

    def test_save_username_json_formatting(self, tmp_path):
        """Test saved JSON is pretty-printed."""
        save_username(tmp_path, "alice")

        state_file = tmp_path / STATE_FILE
        content = state_file.read_text()
        assert content.startswith("{\n  ")  # Indented

    def test_save_username_handles_corrupted_file(self, tmp_path):
        """Test saving username handles corrupted existing state file."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text("invalid json {")

        # Should still succeed and create new valid state
        save_username(tmp_path, "alice")

        state = json.loads(state_file.read_text())
        assert state["annotation_user"] == "alice"


class TestEnsureUsername:
    """Tests for ensure_username function."""

    def test_ensure_username_exists(self, tmp_path):
        """Test ensure_username returns existing username."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"annotation_user": "alice"}))

        username = ensure_username(tmp_path)
        assert username == "alice"

    @patch("documentation_robotics.utils.user_identity.prompt_for_username")
    def test_ensure_username_prompts_if_not_set(self, mock_prompt, tmp_path):
        """Test ensure_username prompts if username not set."""
        mock_prompt.return_value = "alice"

        username = ensure_username(tmp_path)
        assert username == "alice"
        mock_prompt.assert_called_once()

        # Verify username was saved
        state_file = tmp_path / STATE_FILE
        assert state_file.exists()
        state = json.loads(state_file.read_text())
        assert state["annotation_user"] == "alice"

    @patch("documentation_robotics.utils.user_identity.prompt_for_username")
    def test_ensure_username_does_not_prompt_if_exists(self, mock_prompt, tmp_path):
        """Test ensure_username doesn't prompt if username exists."""
        state_file = tmp_path / STATE_FILE
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps({"annotation_user": "alice"}))

        username = ensure_username(tmp_path)
        assert username == "alice"
        mock_prompt.assert_not_called()
