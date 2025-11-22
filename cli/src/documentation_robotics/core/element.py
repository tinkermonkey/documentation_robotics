"""
Element abstraction - represents a single architecture element.
"""
from typing import Dict, Any, Optional
from pathlib import Path


class Element:
    """
    Represents a single architecture element in any layer.

    Elements are the fundamental building blocks of the model.
    Each element has an ID, type, name, and layer-specific attributes.
    """

    def __init__(
        self,
        id: str,
        element_type: str,
        layer: str,
        data: Dict[str, Any],
        file_path: Optional[Path] = None
    ):
        """
        Initialize element.

        Args:
            id: Element ID (format: {layer}.{type}.{name})
            element_type: Type of element (e.g., 'service', 'component')
            layer: Layer name
            data: Element data dictionary
            file_path: Path to source file (optional)
        """
        self.id = id
        self.type = element_type
        self.layer = layer
        self.data = data
        self.file_path = file_path

    @property
    def name(self) -> str:
        """Get element name."""
        return self.data.get("name", "")

    @property
    def description(self) -> Optional[str]:
        """Get element description."""
        return self.data.get("description")

    def get(self, key: str, default: Any = None) -> Any:
        """Get data value by key."""
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """Set data value."""
        self.data[key] = value

    def update(self, updates: Dict[str, Any]) -> None:
        """Update element data."""
        self.data.update(updates)

    def to_dict(self) -> Dict[str, Any]:
        """Convert element to dictionary."""
        return {
            "id": self.id,
            "type": self.type,
            "layer": self.layer,
            **self.data
        }

    def save(self) -> None:
        """Save element to its source file."""
        if not self.file_path:
            raise ValueError("Cannot save element without file_path")

        # This is a simplified version - actual implementation
        # needs to handle updating the specific element in the YAML file
        # while preserving other elements
        from ..utils.file_io import update_yaml_element

        update_yaml_element(self.file_path, self.id, self.data)

    @classmethod
    def create(
        cls,
        layer: str,
        element_type: str,
        name: str,
        **attributes
    ) -> "Element":
        """
        Create a new element.

        Args:
            layer: Layer name
            element_type: Element type
            name: Element name
            **attributes: Additional element attributes

        Returns:
            New Element instance
        """
        from ..utils.id_generator import generate_element_id

        element_id = generate_element_id(layer, element_type, name)

        data = {
            "id": element_id,
            "name": name,
            **attributes
        }

        return cls(
            id=element_id,
            element_type=element_type,
            layer=layer,
            data=data
        )

    def __repr__(self) -> str:
        return f"Element(id='{self.id}', type='{self.type}', name='{self.name}')"
