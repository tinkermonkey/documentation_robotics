"""
Model serialization for visualization.

Converts the DR model objects to JSON-serializable dictionaries
for transmission to browser clients via WebSocket.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core.element import Element
from ..core.layer import Layer
from ..core.model import Model


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
        """Serialize model manifest."""
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
            layer_name: Layer name
            layer: Layer instance

        Returns:
            Layer object with metadata and elements
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
            element: Element instance

        Returns:
            Serialized element data
        """
        return {
            "id": element.id,
            "type": element.type,
            "name": element.name,
            "data": element.data,
            "file_path": str(element.file_path) if hasattr(element, "file_path") else None,
        }

    def _serialize_statistics(self) -> Dict[str, Any]:
        """Serialize model statistics."""
        return self.model.manifest.statistics.copy()

    def serialize_element_update(
        self, element_id: str
    ) -> Optional[Dict[str, Any]]:
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
        root_path: Model root path

    Returns:
        List of changeset metadata objects
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
                import yaml

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
            except Exception as e:
                # Log error but continue
                print(f"Warning: Failed to load changeset {changeset_dir.name}: {e}")

    return sorted(changesets, key=lambda x: x.get("created", ""))


def serialize_model_state(
    model: Model, root_path: Path
) -> Dict[str, Any]:
    """
    Serialize complete model state including changesets.

    Args:
        model: Model instance
        root_path: Model root path

    Returns:
        Complete model state for initial WebSocket transmission
    """
    serializer = ModelSerializer(model)

    return {
        "model": serializer.serialize_model(),
        "changesets": load_changesets(root_path),
    }
