"""
Changeset management - core data structures for tracking changes.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


@dataclass
class ChangesetMetadata:
    """Metadata for a changeset."""

    id: str
    name: str
    description: str
    type: str  # feature, bugfix, exploration
    status: str  # active, applied, abandoned
    created_at: datetime
    updated_at: datetime
    workflow: str  # direct-cli, requirements, agent-conversation
    summary: Dict[str, int] = field(
        default_factory=lambda: {"elements_added": 0, "elements_updated": 0, "elements_deleted": 0}
    )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "type": self.type,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "workflow": self.workflow,
            "summary": self.summary,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChangesetMetadata":
        """Create from dictionary."""
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            type=data.get("type", "feature"),
            status=data.get("status", "active"),
            created_at=datetime.fromisoformat(data["created_at"]),
            updated_at=datetime.fromisoformat(data["updated_at"]),
            workflow=data.get("workflow", "direct-cli"),
            summary=data.get(
                "summary", {"elements_added": 0, "elements_updated": 0, "elements_deleted": 0}
            ),
        )


@dataclass
class Change:
    """Represents a single change to an element."""

    timestamp: str
    operation: str  # 'add', 'update', 'delete'
    element_id: str
    layer: str
    element_type: str
    data: Optional[Dict[str, Any]] = None  # For 'add' operations
    before: Optional[Dict[str, Any]] = None  # For 'update' operations
    after: Optional[Dict[str, Any]] = None  # For 'update' operations

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = {
            "timestamp": self.timestamp,
            "operation": self.operation,
            "element_id": self.element_id,
            "layer": self.layer,
            "element_type": self.element_type,
        }

        if self.data is not None:
            result["data"] = self.data
        if self.before is not None:
            result["before"] = self.before
        if self.after is not None:
            result["after"] = self.after

        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Change":
        """Create from dictionary."""
        return cls(
            timestamp=data["timestamp"],
            operation=data["operation"],
            element_id=data["element_id"],
            layer=data["layer"],
            element_type=data["element_type"],
            data=data.get("data"),
            before=data.get("before"),
            after=data.get("after"),
        )


class Changeset:
    """
    Represents a changeset with metadata and tracked changes.

    A changeset tracks a series of modifications (add/update/delete operations)
    to elements in a model, allowing them to be previewed and applied atomically.
    """

    def __init__(self, changeset_id: str, path: Path):
        """
        Initialize a changeset.

        Args:
            changeset_id: Unique identifier for the changeset
            path: Path to changeset directory
        """
        self.id = changeset_id
        self.path = path
        self.metadata_path = path / "metadata.yaml"
        self.changes_path = path / "changes.yaml"

        # Load metadata and changes if they exist
        if self.metadata_path.exists():
            self.metadata = self._load_metadata()
        else:
            # Initialize with defaults (will be set by caller)
            self.metadata = ChangesetMetadata(
                id=changeset_id,
                name="",
                description="",
                type="feature",
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
                workflow="direct-cli",
            )

        if self.changes_path.exists():
            self._changes = self._load_changes()
        else:
            self._changes = []

    def _load_metadata(self) -> ChangesetMetadata:
        """Load metadata from file."""
        with open(self.metadata_path, "r") as f:
            data = yaml.safe_load(f)
        return ChangesetMetadata.from_dict(data)

    def _load_changes(self) -> List[Change]:
        """Load changes from file."""
        with open(self.changes_path, "r") as f:
            data = yaml.safe_load(f)

        if not data or "changes" not in data:
            return []

        return [Change.from_dict(change_data) for change_data in data["changes"]]

    def add_change(self, change: Change) -> None:
        """
        Add a change to the changeset.

        Args:
            change: The change to add
        """
        self._changes.append(change)

        # Update summary
        if change.operation == "add":
            self.metadata.summary["elements_added"] += 1
        elif change.operation == "update":
            self.metadata.summary["elements_updated"] += 1
        elif change.operation == "delete":
            self.metadata.summary["elements_deleted"] += 1

        # Update timestamp
        self.metadata.updated_at = datetime.now(timezone.utc)

    def get_changes(self) -> List[Change]:
        """
        Get all changes in the changeset.

        Returns:
            List of changes
        """
        return self._changes.copy()

    def get_changes_by_element(self, element_id: str) -> List[Change]:
        """
        Get all changes for a specific element.

        Args:
            element_id: The element ID to filter by

        Returns:
            List of changes for the element
        """
        return [change for change in self._changes if change.element_id == element_id]

    def get_changes_by_layer(self, layer: str) -> List[Change]:
        """
        Get all changes for a specific layer.

        Args:
            layer: The layer to filter by

        Returns:
            List of changes for the layer
        """
        return [change for change in self._changes if change.layer == layer]

    def get_changes_by_operation(self, operation: str) -> List[Change]:
        """
        Get all changes of a specific operation type.

        Args:
            operation: The operation type ('add', 'update', or 'delete')

        Returns:
            List of changes of the specified operation type
        """
        return [change for change in self._changes if change.operation == operation]

    def save(self) -> None:
        """Save metadata and changes to disk."""
        # Ensure directory exists
        self.path.mkdir(parents=True, exist_ok=True)

        # Save metadata
        with open(self.metadata_path, "w") as f:
            yaml.safe_dump(self.metadata.to_dict(), f, default_flow_style=False)

        # Save changes
        changes_data = {
            "version": "1.0",
            "changes": [change.to_dict() for change in self._changes],
        }
        with open(self.changes_path, "w") as f:
            yaml.safe_dump(changes_data, f, default_flow_style=False)

    def get_element_count(self) -> int:
        """
        Get the total number of element changes.

        Returns:
            Total number of changes
        """
        return len(self._changes)

    def get_affected_layers(self) -> List[str]:
        """
        Get list of layers affected by this changeset.

        Returns:
            List of unique layer names
        """
        layers = set(change.layer for change in self._changes)
        return sorted(layers)

    def has_changes(self) -> bool:
        """
        Check if the changeset has any changes.

        Returns:
            True if changeset has changes, False otherwise
        """
        return len(self._changes) > 0

    def clear_changes(self) -> None:
        """Clear all changes from the changeset."""
        self._changes = []
        self.metadata.summary = {
            "elements_added": 0,
            "elements_updated": 0,
            "elements_deleted": 0,
        }
        self.metadata.updated_at = datetime.now(timezone.utc)

    def get_element_ids(self) -> set:
        """
        Get set of all element IDs affected by this changeset.

        Returns:
            Set of element IDs
        """
        return {change.element_id for change in self._changes}

    def get_latest_change_for_element(self, element_id: str) -> Optional[Change]:
        """
        Get the latest change for a specific element.

        Args:
            element_id: Element ID to look up

        Returns:
            Latest change for the element, or None if not found
        """
        changes = [c for c in self._changes if c.element_id == element_id]
        return changes[-1] if changes else None

    def __repr__(self) -> str:
        """String representation."""
        return (
            f"Changeset(id='{self.id}', name='{self.metadata.name}', "
            f"status='{self.metadata.status}', changes={len(self._changes)})"
        )
