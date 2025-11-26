"""
Changeset Model - extends Model to work in changeset context.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

from .changeset import Change
from .changeset_manager import ChangesetManager
from .element import Element
from .model import Model


class ChangesetModel(Model):
    """
    Model that works in changeset context.

    Loads the main model and applies changeset changes on top of it in-memory.
    All modifications are tracked in the changeset.
    """

    def __init__(self, root_path: Path, changeset_id: str, **kwargs):
        """
        Initialize model in changeset context.

        Args:
            root_path: Root path of the project
            changeset_id: ID of the changeset to work in
            **kwargs: Additional arguments passed to Model
        """
        # Load main model first
        super().__init__(root_path, **kwargs)

        # Store changeset context
        self.changeset_id = changeset_id
        self.changeset_manager = ChangesetManager(root_path)

        # Load changeset
        self.changeset = self.changeset_manager.load_changeset(changeset_id)

        # Apply changeset changes to in-memory model
        self._apply_changeset_changes()

    def _apply_changeset_changes(self) -> None:
        """Apply all changeset changes to the in-memory model."""
        for change in self.changeset.get_changes():
            try:
                if change.operation == "add":
                    self._apply_add_change(change)
                elif change.operation == "update":
                    self._apply_update_change(change)
                elif change.operation == "delete":
                    self._apply_delete_change(change)
            except Exception as e:
                # Log warning but continue applying other changes
                print(f"Warning: Failed to apply change for {change.element_id}: {e}")

    def _apply_add_change(self, change: Change) -> None:
        """Apply an 'add' change to the model."""
        layer = self.get_layer(change.layer)
        if not layer:
            print(f"Warning: Layer '{change.layer}' not found for change")
            return

        # Create element from change data
        element = Element(
            id=change.element_id,
            element_type=change.element_type,
            layer=change.layer,
            data=change.data or {},
        )

        # Add directly to layer (don't call add_element to avoid tracking)
        layer.elements[element.id] = element

    def _apply_update_change(self, change: Change) -> None:
        """Apply an 'update' change to the model."""
        layer = self.get_layer(change.layer)
        if not layer:
            print(f"Warning: Layer '{change.layer}' not found for change")
            return

        if change.element_id not in layer.elements:
            print(f"Warning: Element '{change.element_id}' not found for update")
            return

        # Update element data in place
        if change.after:
            layer.elements[change.element_id].data = change.after.copy()

    def _apply_delete_change(self, change: Change) -> None:
        """Apply a 'delete' change to the model."""
        layer = self.get_layer(change.layer)
        if not layer:
            print(f"Warning: Layer '{change.layer}' not found for change")
            return

        # Remove element if it exists
        if change.element_id in layer.elements:
            del layer.elements[change.element_id]

    def add_element(self, layer_name: str, element: Element) -> None:
        """
        Add element to a layer (tracked in changeset).

        Args:
            layer_name: Layer name
            element: Element to add

        Raises:
            ValueError: If layer doesn't exist
        """
        layer_obj = self.get_layer(layer_name)
        if not layer_obj:
            raise ValueError(f"Layer '{layer_name}' not found")

        # Add to in-memory model (don't persist to disk)
        layer_obj.elements[element.id] = element

        # Register element references
        if hasattr(self, "reference_registry"):
            self.reference_registry.register_element(element)

        # Invalidate caches
        if self._cache:
            self._cache.invalidate_queries()

        # Track change in changeset
        self._track_add(element)

    def update_element(self, element_id: str, updates: Dict) -> None:
        """
        Update an existing element (tracked in changeset).

        Args:
            element_id: Element ID
            updates: Dictionary of updates

        Raises:
            ValueError: If element doesn't exist
        """
        element = self.get_element(element_id)
        if not element:
            raise ValueError(f"Element '{element_id}' not found")

        # Capture before state
        before = element.data.copy()

        # Update element in-memory (don't persist to disk)
        element.data.update(updates)

        # Invalidate caches
        if self._cache:
            self._cache.invalidate_element(element_id)
            self._cache.invalidate_queries()

        # Track change in changeset
        self._track_update(element_id, before, element.data.copy())

    def remove_element(self, element_id: str, cascade: bool = False) -> None:
        """
        Remove element from model (tracked in changeset).

        Args:
            element_id: Element ID
            cascade: If True, remove dependent elements

        Raises:
            ValueError: If element doesn't exist or has dependencies
        """
        parts = element_id.split(".")
        layer_name = parts[0]

        layer = self.get_layer(layer_name)
        if not layer:
            raise ValueError(f"Layer '{layer_name}' not found")

        element = layer.get_element(element_id)
        if not element:
            raise ValueError(f"Element '{element_id}' not found")

        # Check for dependencies if not cascading
        if not cascade:
            dependencies = self.find_dependencies(element_id)
            if dependencies:
                dep_ids = [d.id for d in dependencies]
                raise ValueError(
                    f"Element has dependencies: {', '.join(dep_ids)}. "
                    f"Use --cascade to remove all."
                )

        # Capture element data before removal
        element_data = element.data.copy()

        # Remove from in-memory model (don't persist to disk)
        del layer.elements[element_id]

        # Invalidate caches
        if self._cache:
            self._cache.invalidate_element(element_id)
            self._cache.invalidate_queries()

        # Track change in changeset
        self._track_delete(element_id, element.type, layer_name, element_data)

    def _track_add(self, element: Element) -> None:
        """Track an 'add' operation in the changeset."""
        change = Change(
            timestamp=datetime.now(timezone.utc).isoformat(),
            operation="add",
            element_id=element.id,
            layer=element.layer,
            element_type=element.type,
            data=element.data.copy(),
        )
        self.changeset_manager.track_change(self.changeset_id, change)

    def _track_update(self, element_id: str, before: Dict, after: Dict) -> None:
        """Track an 'update' operation in the changeset."""
        # Parse element_id to get layer and type
        parts = element_id.split(".")
        layer = parts[0]
        element_type = parts[1] if len(parts) > 1 else "unknown"

        change = Change(
            timestamp=datetime.now(timezone.utc).isoformat(),
            operation="update",
            element_id=element_id,
            layer=layer,
            element_type=element_type,
            before=before,
            after=after,
        )
        self.changeset_manager.track_change(self.changeset_id, change)

    def _track_delete(
        self, element_id: str, element_type: str, layer: str, element_data: Dict
    ) -> None:
        """Track a 'delete' operation in the changeset."""
        change = Change(
            timestamp=datetime.now(timezone.utc).isoformat(),
            operation="delete",
            element_id=element_id,
            layer=layer,
            element_type=element_type,
            before=element_data,
        )
        self.changeset_manager.track_change(self.changeset_id, change)

    def save(self) -> None:
        """
        Save operation is disabled in changeset context.

        Changes are tracked in the changeset and applied when the changeset
        is applied to the main model.
        """
        # Don't save to main model - changes are tracked in changeset
        # Only save the changeset itself
        self.changeset.save()

    def get_changeset_summary(self) -> Dict:
        """
        Get summary of changes in the changeset.

        Returns:
            Dictionary with changeset summary
        """
        return self.changeset_manager.get_changeset_summary(self.changeset_id)
