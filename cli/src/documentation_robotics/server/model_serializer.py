"""
Model serialization for visualization.

Converts the DR model objects to JSON-serializable dictionaries
for transmission to browser clients via WebSocket.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from rich.console import Console

from ..core.changeset import Changeset
from ..core.element import Element
from ..core.layer import Layer
from ..core.model import Model

console = Console()


class ModelSerializer:
    """Serializes model data for WebSocket transmission."""

    def __init__(self, model: Model):
        """
        Initialize model serializer.

        Args:
            model: Model instance to serialize
        """
        self.model = model

    def serialize_model(self) -> Dict[str, Any]:
        """
        Serialize complete model state.

        Returns:
            Dictionary containing:
                - manifest: Model manifest data
                - layers: All enabled layers with their elements
                - statistics: Model statistics
        """
        return {
            "manifest": self._serialize_manifest(),
            "layers": self._serialize_layers(),
            "statistics": self._serialize_statistics(),
        }

    def _serialize_manifest(self) -> Dict[str, Any]:
        """
        Serialize model manifest.

        Returns:
            Dictionary containing manifest metadata:
                - version: Model version string
                - spec_version: Specification version
                - project: Project configuration dict
                - conventions: Project conventions dict
                - created: ISO timestamp of model creation
                - updated: ISO timestamp of last update
        """
        manifest = self.model.manifest

        return {
            "version": manifest.version,
            "spec_version": manifest.specification_version,
            "project": manifest.project,
            "conventions": manifest.conventions,
            "created": manifest.data.get("created"),
            "updated": manifest.data.get("updated"),
        }

    def _serialize_layers(self) -> List[Dict[str, Any]]:
        """
        Serialize all enabled layers.

        Returns:
            List of layer objects with elements
        """
        layers = []

        for layer_name, layer_config in self.model.manifest.layers.items():
            if not layer_config.get("enabled", True):
                continue

            layer = self.model.get_layer(layer_name)
            if layer:
                layers.append(self._serialize_layer(layer_name, layer))

        # Sort by layer order
        return sorted(layers, key=lambda x: x.get("order", 0))

    def _serialize_layer(self, layer_name: str, layer: Layer) -> Dict[str, Any]:
        """
        Serialize a single layer.

        Args:
            layer_name: Layer name from manifest
            layer: Layer instance containing elements

        Returns:
            Dictionary containing layer metadata and elements:
                - name: Layer identifier
                - display_name: Human-readable layer name
                - order: Layer display order (lower first)
                - path: Layer directory path
                - enabled: Whether layer is enabled
                - element_counts: Count of elements by type
                - elements: List of serialized element objects
        """
        layer_config = self.model.manifest.layers.get(layer_name, {})

        return {
            "name": layer_name,
            "display_name": layer_config.get("name", layer_name),
            "order": layer_config.get("order", 0),
            "path": str(layer_config.get("path", "")),
            "enabled": layer_config.get("enabled", True),
            "element_counts": layer_config.get("elements", {}),
            "elements": self._serialize_elements(layer),
        }

    def _serialize_elements(self, layer: Layer) -> List[Dict[str, Any]]:
        """
        Serialize all elements in a layer.

        Args:
            layer: Layer instance

        Returns:
            List of serialized elements
        """
        elements = []

        for element in layer.elements.values():
            elements.append(self._serialize_element(element))

        return elements

    def _serialize_element(self, element: Element) -> Dict[str, Any]:
        """
        Serialize a single element.

        Args:
            element: Element instance to serialize

        Returns:
            Dictionary containing element data:
                - id: Unique element identifier
                - type: Element type (e.g., 'BusinessActor', 'ApplicationComponent')
                - name: Element name
                - data: Element attributes and relationships
                - file_path: Source file path or None if not file-backed

        Example:
            {
                "id": "elem-123",
                "type": "BusinessActor",
                "name": "Customer",
                "data": {"description": "End user", "references": [...]},
                "file_path": "business/actors/customer.yaml"
            }
        """
        return {
            "id": element.id,
            "type": element.type,
            "name": element.name,
            "data": element.data,
            "file_path": str(element.file_path) if hasattr(element, "file_path") and element.file_path else None,
        }

    def _serialize_statistics(self) -> Dict[str, Any]:
        """Serialize model statistics."""
        return self.model.manifest.statistics.copy()

    def serialize_element_update(self, element_id: str) -> Optional[Dict[str, Any]]:
        """
        Serialize a single element update.

        Args:
            element_id: Element ID

        Returns:
            Serialized element data or None if not found
        """
        element = self.model.get_element(element_id)
        if not element:
            return None

        return self._serialize_element(element)


def load_changesets(root_path: Path) -> List[Dict[str, Any]]:
    """
    Load changeset metadata and changes from .dr/changesets directory.

    Args:
        root_path: Model root directory path

    Returns:
        List of changeset dictionaries, sorted by creation date.
        Each dictionary contains:
            - id: Changeset unique identifier
            - name: Display name from metadata
            - description: Changeset description
            - type: Changeset type (feature, bugfix, exploration)
            - status: Changeset status (active, applied, abandoned)
            - created_at: ISO timestamp of creation
            - updated_at: ISO timestamp of last update
            - workflow: Workflow type (direct-cli, requirements, agent-conversation)
            - summary: Summary of changes (elements_added, elements_updated, elements_deleted)
            - changes: List of Change objects with full details

    Raises:
        No exceptions raised - errors are logged and skipped

    Example:
        >>> changesets = load_changesets(Path("/workspace"))
        >>> changesets[0]
        {
            "id": "20240101-feature",
            "name": "New Feature",
            "description": "Add visualization",
            "type": "feature",
            "status": "active",
            "created_at": "2024-01-01T12:00:00Z",
            "updated_at": "2024-01-01T13:00:00Z",
            "workflow": "direct-cli",
            "summary": {"elements_added": 3, "elements_updated": 1, "elements_deleted": 0},
            "changes": [...]
        }
    """
    changesets_path = root_path / ".dr" / "changesets"

    if not changesets_path.exists():
        return []

    changesets = []

    # Find all changeset directories
    for changeset_dir in changesets_path.iterdir():
        if not changeset_dir.is_dir():
            continue

        # Load changeset using Changeset class
        try:
            changeset = Changeset(changeset_dir.name, changeset_dir)

            # Convert to dictionary with all required fields
            changeset_dict = {
                "id": changeset.metadata.id,
                "name": changeset.metadata.name,
                "description": changeset.metadata.description,
                "type": changeset.metadata.type,
                "status": changeset.metadata.status,
                "created_at": changeset.metadata.created_at.isoformat(),
                "updated_at": changeset.metadata.updated_at.isoformat(),
                "workflow": changeset.metadata.workflow,
                "summary": changeset.metadata.summary,
                "changes": [change.to_dict() for change in changeset.get_changes()],
            }

            changesets.append(changeset_dict)

        except (FileNotFoundError, yaml.YAMLError, KeyError, OSError, ValueError) as e:
            # Log error but continue - allows partial loading
            console.print(
                f"[yellow]Warning: Failed to load changeset {changeset_dir.name}: {e}[/yellow]"
            )

    # Sort by creation date
    return sorted(changesets, key=lambda x: x.get("created_at", ""))


def serialize_model_state(model: Model, root_path: Path) -> Dict[str, Any]:
    """
    Serialize complete model state including changesets.

    This is the primary function for creating the initial state
    transmitted to browser clients via WebSocket.

    Args:
        model: Model instance containing layers and elements
        root_path: Model root directory path

    Returns:
        Dictionary containing complete model state:
            - model: Serialized model with manifest, layers, and statistics
            - changesets: List of available changeset metadata

    Example:
        >>> model = Model.load(Path("/workspace"))
        >>> state = serialize_model_state(model, Path("/workspace"))
        >>> state.keys()
        dict_keys(['model', 'changesets'])
    """
    serializer = ModelSerializer(model)

    return {
        "model": serializer.serialize_model(),
        "changesets": load_changesets(root_path),
    }
