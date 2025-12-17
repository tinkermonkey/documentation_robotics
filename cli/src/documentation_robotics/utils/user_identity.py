"""User identity management for annotations.

This module handles storing and retrieving the user identity for
annotations. The username is stored in .dr/state.json and prompted
once on first use.
"""

import json
import re
from pathlib import Path
from typing import Optional

import click

STATE_FILE = ".dr/state.json"


def get_username(base_path: Path) -> Optional[str]:
    """Get stored username from .dr/state.json.

    Args:
        base_path: Base path of the documentation robotics project

    Returns:
        Username if stored, None otherwise
    """
    state_file = base_path / STATE_FILE
    if not state_file.exists():
        return None

    try:
        state = json.loads(state_file.read_text())
        return state.get("annotation_user")
    except (json.JSONDecodeError, KeyError):
        return None


def validate_username(username: str) -> bool:
    """Validate username format.

    Usernames must be non-empty and contain only alphanumeric characters,
    hyphens, and underscores.

    Args:
        username: Username to validate

    Returns:
        True if valid, False otherwise
    """
    if not username:
        return False
    return bool(re.match(r"^[a-zA-Z0-9_-]+$", username))


def prompt_for_username() -> str:
    """Prompt user to enter their username.

    Continues prompting until a valid username is provided.

    Returns:
        Valid username
    """
    while True:
        username = click.prompt("Enter your username for annotations", type=str)
        if validate_username(username):
            return username
        click.echo(
            "Invalid username. Use only alphanumeric characters, hyphens, and underscores.",
            err=True,
        )


def save_username(base_path: Path, username: str) -> None:
    """Save username to .dr/state.json.

    Creates or updates the state file with the annotation_user field.
    Preserves other fields if the state file already exists.

    Args:
        base_path: Base path of the documentation robotics project
        username: Username to save
    """
    state_file = base_path / STATE_FILE
    state_file.parent.mkdir(parents=True, exist_ok=True)

    # Load existing state if present
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text())
        except json.JSONDecodeError:
            # Start fresh if state file is corrupted
            state = {}

    state["annotation_user"] = username

    # Atomic write
    temp_file = state_file.with_suffix(".tmp")
    temp_file.write_text(json.dumps(state, indent=2))
    temp_file.rename(state_file)


def ensure_username(base_path: Path) -> str:
    """Get username, prompting if not set.

    This is the main entry point for getting the current user's username.
    It will prompt for username on first use and cache it for future use.

    Args:
        base_path: Base path of the documentation robotics project

    Returns:
        Username (guaranteed to be valid)
    """
    username = get_username(base_path)
    if not username:
        username = prompt_for_username()
        save_username(base_path, username)
    return username
