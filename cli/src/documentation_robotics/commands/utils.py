"""
Command utilities for changeset-aware operations.
"""

from pathlib import Path

from rich.console import Console

from ..core.changeset_manager import ChangesetManager
from ..core.model import Model

console = Console()


def load_model_with_changeset_context(root_path: Path, **kwargs) -> Model:
    """
    Load model with active changeset context if present.

    This function automatically detects if there's an active changeset
    and loads the model in that context, displaying a subtle indicator
    to the user.

    Args:
        root_path: Root path of the project
        **kwargs: Additional arguments passed to Model.load()

    Returns:
        Model instance (ChangesetModel if active changeset exists)
    """
    try:
        manager = ChangesetManager(root_path)
        active = manager.get_active()

        if active:
            # Load changeset metadata to show name
            changeset = manager.load_changeset(active)

            # Show subtle indicator that we're working in a changeset
            console.print(f"[dim]Working in changeset: {active} ({changeset.metadata.name})[/dim]")

            # Load model in changeset context
            return Model.load(root_path, changeset=active, **kwargs)
        else:
            # No active changeset - load normal model
            return Model.load(root_path, **kwargs)

    except FileNotFoundError:
        # No changesets directory exists yet - just load normal model
        return Model.load(root_path, **kwargs)
    except Exception as e:
        # If there's any error with changeset loading, fall back to normal model
        console.print(f"[yellow]Warning: Failed to load changeset context: {e}[/yellow]")
        console.print("[dim]Falling back to main model[/dim]")
        return Model.load(root_path, **kwargs)


def get_active_changeset(root_path: Path) -> str | None:
    """
    Get the active changeset ID if one exists.

    Args:
        root_path: Root path of the project

    Returns:
        Active changeset ID or None
    """
    try:
        manager = ChangesetManager(root_path)
        return manager.get_active()
    except Exception:
        return None


def show_changeset_indicator(root_path: Path) -> None:
    """
    Show a subtle indicator if working in a changeset.

    Args:
        root_path: Root path of the project
    """
    active = get_active_changeset(root_path)
    if active:
        try:
            manager = ChangesetManager(root_path)
            changeset = manager.load_changeset(active)
            console.print(f"[dim]Working in changeset: {active} ({changeset.metadata.name})[/dim]")
        except Exception:
            console.print(f"[dim]Working in changeset: {active}[/dim]")
