"""
Model serialization for visualization.

Converts the DR model objects to JSON-serializable dictionaries
for transmission to browser clients via WebSocket.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from rich.console import Console

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
    Load changeset metadata from .dr/changesets directory.

    Args:
        root_path: Model root directory path

    Returns:
        List of changeset metadata dictionaries, sorted by creation date.
        Each dictionary contains:
            - id: Changeset directory name
            - name: Display name from metadata
            - description: Changeset description
            - created: ISO timestamp
            - author: Author name/email
            - status: Changeset status (active, merged, etc.)

    Raises:
        No exceptions raised - errors are logged and skipped

    Example:
        >>> changesets = load_changesets(Path("/workspace"))
        >>> changesets[0]
        {
            "id": "20240101-feature",
            "name": "New Feature",
            "description": "Add visualization",
            "created": "2024-01-01T12:00:00Z",
            "author": "user@example.com",
            "status": "active"
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

        # Load changeset metadata
        metadata_file = changeset_dir / "changeset.yaml"
        if metadata_file.exists():
            try:
                with open(metadata_file, "r") as f:
                    metadata = yaml.safe_load(f)

                changesets.append(
                    {
                        "id": changeset_dir.name,
                        "name": metadata.get("name", changeset_dir.name),
                        "description": metadata.get("description", ""),
                        "created": metadata.get("created"),
                        "author": metadata.get("author"),
                        "status": metadata.get("status", "active"),
                    }
                )
            except (FileNotFoundError, yaml.YAMLError, KeyError, OSError) as e:
                # Log error but continue
                console.print(
                    f"[yellow]Warning: Failed to load changeset {changeset_dir.name}: {e}[/yellow]"
                )

    return sorted(changesets, key=lambda x: x.get("created", ""))


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
