"""
Changeset Manager - manages changeset operations and registry.
"""

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from .changeset import Change, Changeset, ChangesetMetadata


class ChangesetManager:
    """
    Manages all changeset operations including creation, listing,
    switching, and registry management.
    """

    def __init__(self, root_path: Path):
        """
        Initialize changeset manager.

        Args:
            root_path: Root path of the project
        """
        self.root_path = root_path
        self.changesets_dir = root_path / ".dr" / "changesets"
        self.active_file = self.changesets_dir / "active"
        self.registry_file = self.changesets_dir / "registry.yaml"

        # Ensure changesets directory exists
        self.changesets_dir.mkdir(parents=True, exist_ok=True)

        # Load registry
        self.registry = self._load_registry()

    def _load_registry(self) -> Dict[str, Any]:
        """Load the changeset registry."""
        if not self.registry_file.exists():
            return {"version": "1.0", "changesets": {}}

        with open(self.registry_file, "r") as f:
            return yaml.safe_load(f) or {"version": "1.0", "changesets": {}}

    def _save_registry(self) -> None:
        """Save the changeset registry."""
        with open(self.registry_file, "w") as f:
            yaml.safe_dump(self.registry, f, default_flow_style=False)

    def _generate_id(self, name: str, changeset_type: str) -> str:
        """
        Generate a unique changeset ID.

        Args:
            name: Changeset name
            changeset_type: Type of changeset

        Returns:
            Generated changeset ID
        """
        # Create slug from name
        slug = re.sub(r"[^\w\s-]", "", name.lower())
        slug = re.sub(r"[-\s]+", "-", slug).strip("-")

        # Get date
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Find counter for this date
        counter = 1
        base_id = f"{changeset_type}-{slug}-{date}"
        while True:
            changeset_id = f"{base_id}-{counter:03d}"
            if not (self.changesets_dir / changeset_id).exists():
                break
            counter += 1

        return changeset_id

    def create(
        self,
        name: str,
        changeset_type: str = "feature",
        description: str = "",
        set_active: bool = True,
        workflow: str = "direct-cli",
    ) -> str:
        """
        Create a new changeset.

        Args:
            name: Name of the changeset
            changeset_type: Type (feature, bugfix, exploration)
            description: Description of the changeset
            set_active: Whether to set as active changeset
            workflow: Workflow type (direct-cli, requirements, agent-conversation)

        Returns:
            Changeset ID
        """
        # Generate unique ID
        changeset_id = self._generate_id(name, changeset_type)

        # Create changeset directory
        changeset_path = self.changesets_dir / changeset_id
        changeset_path.mkdir(parents=True, exist_ok=True)

        # Create changeset with metadata
        changeset = Changeset(changeset_id, changeset_path)
        changeset.metadata = ChangesetMetadata(
            id=changeset_id,
            name=name,
            description=description,
            type=changeset_type,
            status="active",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            workflow=workflow,
        )

        # Save changeset
        changeset.save()

        # Add to registry
        self.registry["changesets"][changeset_id] = {
            "name": name,
            "status": "active",
            "type": changeset_type,
            "created_at": changeset.metadata.created_at.isoformat(),
            "elements_count": 0,
        }
        self._save_registry()

        # Set as active if requested
        if set_active:
            self.set_active(changeset_id)

        return changeset_id

    def list(self, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        List all changesets.

        Args:
            status_filter: Optional status to filter by

        Returns:
            List of changeset summaries
        """
        result = []

        for changeset_id, info in self.registry.get("changesets", {}).items():
            if status_filter and info.get("status") != status_filter:
                continue

            result.append(
                {
                    "id": changeset_id,
                    "name": info.get("name", changeset_id),
                    "status": info.get("status", "unknown"),
                    "type": info.get("type", "feature"),
                    "created_at": info.get("created_at", ""),
                    "elements_count": info.get("elements_count", 0),
                }
            )

        # Sort by creation date (newest first)
        result.sort(key=lambda x: x["created_at"], reverse=True)

        return result

    def get_active(self) -> Optional[str]:
        """
        Get the currently active changeset ID.

        Returns:
            Active changeset ID or None if no active changeset
        """
        if not self.active_file.exists():
            return None

        with open(self.active_file, "r") as f:
            changeset_id = f.read().strip()

        # Validate that changeset still exists
        if changeset_id and (self.changesets_dir / changeset_id).exists():
            return changeset_id

        return None

    def set_active(self, changeset_id: str) -> None:
        """
        Set the active changeset.

        Args:
            changeset_id: ID of changeset to set as active

        Raises:
            ValueError: If changeset doesn't exist
        """
        # Validate changeset exists
        if not self.changeset_exists(changeset_id):
            raise ValueError(f"Changeset '{changeset_id}' does not exist")

        # Write active file
        with open(self.active_file, "w") as f:
            f.write(changeset_id)

    def clear_active(self) -> None:
        """Clear the active changeset."""
        if self.active_file.exists():
            self.active_file.unlink()

    def changeset_exists(self, changeset_id: str) -> bool:
        """
        Check if a changeset exists.

        Args:
            changeset_id: ID of changeset to check

        Returns:
            True if changeset exists, False otherwise
        """
        return (self.changesets_dir / changeset_id).exists()

    def load_changeset(self, changeset_id: str) -> Changeset:
        """
        Load a changeset.

        Args:
            changeset_id: ID of changeset to load

        Returns:
            Loaded changeset

        Raises:
            ValueError: If changeset doesn't exist
        """
        if not self.changeset_exists(changeset_id):
            raise ValueError(f"Changeset '{changeset_id}' does not exist")

        changeset_path = self.changesets_dir / changeset_id
        return Changeset(changeset_id, changeset_path)

    def track_change(self, changeset_id: str, change: Change) -> None:
        """
        Track a change in a changeset.

        Args:
            changeset_id: ID of changeset
            change: Change to track

        Raises:
            ValueError: If changeset doesn't exist
        """
        changeset = self.load_changeset(changeset_id)
        changeset.add_change(change)
        changeset.save()

        # Update registry element count
        if changeset_id in self.registry.get("changesets", {}):
            self.registry["changesets"][changeset_id][
                "elements_count"
            ] = changeset.get_element_count()
            self._save_registry()

    def update_changeset_status(self, changeset_id: str, status: str) -> None:
        """
        Update the status of a changeset.

        Args:
            changeset_id: ID of changeset
            status: New status (active, applied, abandoned)

        Raises:
            ValueError: If changeset doesn't exist
        """
        changeset = self.load_changeset(changeset_id)
        changeset.metadata.status = status
        changeset.metadata.updated_at = datetime.now(timezone.utc)
        changeset.save()

        # Update registry
        if changeset_id in self.registry.get("changesets", {}):
            self.registry["changesets"][changeset_id]["status"] = status
            self._save_registry()

    def delete_changeset(self, changeset_id: str) -> None:
        """
        Delete a changeset.

        Args:
            changeset_id: ID of changeset to delete

        Raises:
            ValueError: If changeset doesn't exist
        """
        if not self.changeset_exists(changeset_id):
            raise ValueError(f"Changeset '{changeset_id}' does not exist")

        # Remove from registry
        if changeset_id in self.registry.get("changesets", {}):
            del self.registry["changesets"][changeset_id]
            self._save_registry()

        # Clear active if this was active
        if self.get_active() == changeset_id:
            self.clear_active()

        # Delete changeset directory
        import shutil

        changeset_path = self.changesets_dir / changeset_id
        shutil.rmtree(changeset_path)

    def get_changeset_summary(self, changeset_id: str) -> Dict[str, Any]:
        """
        Get a summary of a changeset.

        Args:
            changeset_id: ID of changeset

        Returns:
            Dictionary with changeset summary

        Raises:
            ValueError: If changeset doesn't exist
        """
        changeset = self.load_changeset(changeset_id)

        return {
            "id": changeset.id,
            "name": changeset.metadata.name,
            "description": changeset.metadata.description,
            "type": changeset.metadata.type,
            "status": changeset.metadata.status,
            "workflow": changeset.metadata.workflow,
            "created_at": changeset.metadata.created_at.isoformat(),
            "updated_at": changeset.metadata.updated_at.isoformat(),
            "summary": changeset.metadata.summary,
            "total_changes": changeset.get_element_count(),
            "affected_layers": changeset.get_affected_layers(),
            "has_changes": changeset.has_changes(),
        }

    def get_all_changesets(self) -> List[str]:
        """
        Get list of all changeset IDs.

        Returns:
            List of changeset IDs
        """
        return list(self.registry.get("changesets", {}).keys())

    def get_changesets_by_status(self, status: str) -> List[str]:
        """
        Get list of changeset IDs with a specific status.

        Args:
            status: Status to filter by

        Returns:
            List of changeset IDs
        """
        return [
            changeset_id
            for changeset_id, info in self.registry.get("changesets", {}).items()
            if info.get("status") == status
        ]

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get statistics about all changesets.

        Returns:
            Dictionary with statistics
        """
        total = len(self.registry.get("changesets", {}))
        active = len(self.get_changesets_by_status("active"))
        applied = len(self.get_changesets_by_status("applied"))
        abandoned = len(self.get_changesets_by_status("abandoned"))

        return {
            "total_changesets": total,
            "active": active,
            "applied": applied,
            "abandoned": abandoned,
            "current_active": self.get_active(),
        }

    def diff_changesets(
        self, changeset_a_id: str, changeset_b_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Compare two changesets or a changeset with main model.

        Args:
            changeset_a_id: First changeset ID
            changeset_b_id: Second changeset ID (None for main model)

        Returns:
            Dictionary with diff information

        Raises:
            ValueError: If changeset doesn't exist
        """
        # Load changesets
        changeset_a = self.load_changeset(changeset_a_id)

        if changeset_b_id:
            changeset_b = self.load_changeset(changeset_b_id)
            changeset_b_name = changeset_b.metadata.name
            changeset_b_changes = changeset_b.get_changes()
        else:
            changeset_b_name = "main model"
            changeset_b_changes = []

        # Get all affected element IDs
        a_elements = changeset_a.get_element_ids()
        b_elements = (
            set(change.element_id for change in changeset_b_changes) if changeset_b_id else set()
        )

        all_elements = a_elements | b_elements

        # Categorize changes
        only_in_a = []
        only_in_b = []
        modified_in_both = []
        same_in_both = []

        for element_id in all_elements:
            change_a = changeset_a.get_latest_change_for_element(element_id)
            change_b = (
                changeset_b.get_latest_change_for_element(element_id) if changeset_b_id else None
            )

            if change_a and not change_b:
                only_in_a.append(
                    {
                        "element_id": element_id,
                        "operation": change_a.operation,
                        "layer": change_a.layer,
                        "type": change_a.element_type,
                    }
                )
            elif change_b and not change_a:
                only_in_b.append(
                    {
                        "element_id": element_id,
                        "operation": change_b.operation,
                        "layer": change_b.layer,
                        "type": change_b.element_type,
                    }
                )
            elif change_a and change_b:
                # Both have changes - check if they conflict
                if self._changes_conflict(change_a, change_b):
                    modified_in_both.append(
                        {
                            "element_id": element_id,
                            "operation_a": change_a.operation,
                            "operation_b": change_b.operation,
                            "layer": change_a.layer,
                            "type": change_a.element_type,
                        }
                    )
                else:
                    same_in_both.append(
                        {
                            "element_id": element_id,
                            "operation": change_a.operation,
                            "layer": change_a.layer,
                            "type": change_a.element_type,
                        }
                    )

        return {
            "changeset_a": {
                "id": changeset_a_id,
                "name": changeset_a.metadata.name,
            },
            "changeset_b": {
                "id": changeset_b_id or "main",
                "name": changeset_b_name,
            },
            "only_in_a": only_in_a,
            "only_in_b": only_in_b,
            "modified_in_both": modified_in_both,
            "same_in_both": same_in_both,
            "has_conflicts": len(modified_in_both) > 0,
        }

    def _changes_conflict(self, change_a: Change, change_b: Change) -> bool:
        """
        Check if two changes conflict.

        Args:
            change_a: First change
            change_b: Second change

        Returns:
            True if changes conflict, False otherwise
        """
        # Different operations are a conflict
        if change_a.operation != change_b.operation:
            return True

        # For updates, check if the data differs
        if change_a.operation == "update":
            return change_a.after != change_b.after

        # For adds with same data, no conflict
        if change_a.operation == "add":
            return change_a.data != change_b.data

        # Deletes don't conflict (same element being deleted)
        return False
