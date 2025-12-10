"""
Element abstraction - represents a single architecture element.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional, Set


class Element:
    """
    Represents a single architecture element in any layer.

    Elements are the fundamental building blocks of the model.
    Each element has an ID, type, name, and layer-specific attributes.
    """

    # Well-known array properties from Documentation Robotics spec
    KNOWN_ARRAY_PROPERTIES: Set[str] = {
        "deployedOn",
        "realizes",
        "serves",
        "uses",
        "depends-on",
        "dependsOn",
        "assigned-to",
        "assignedTo",
        "implements",
        "supports",
        "connects-to",
        "connectsTo",
        "triggers",
        "includes",
        "extends",
        "provides",
        "composed-of",
        "composedOf",
        "contains",
        "exposes",
        "consumes",
        "produces",
        "stores",
        "retrieves",
        "validates",
        "transforms",
    }

    def __init__(
        self,
        id: str,
        element_type: str,
        layer: str,
        data: Dict[str, Any],
        file_path: Optional[Path] = None,
        schema: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize element.

        Args:
            id: Element ID (format: {layer}.{type}.{name})
            element_type: Type of element (e.g., 'service', 'component')
            layer: Layer name
            data: Element data dictionary
            file_path: Path to source file (optional)
            schema: Optional schema definition for this element type
        """
        self.id = id
        self.type = element_type
        self.layer = layer
        self.data = data
        self.file_path = file_path
        self.schema = schema

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

    def _is_array_property(self, key: str) -> bool:
        """
        Detect if property should be an array based on schema, current value, and conventions.

        Args:
            key: Property name

        Returns:
            True if property should be treated as an array
        """
        # 1. Check current value - if it's already an array, keep it as array
        if key in self.data:
            if isinstance(self.data[key], list):
                return True

        # 2. Check schema definition (if available)
        if self.schema:
            prop_def = self.schema.get("properties", {}).get(key, {})
            if prop_def.get("type") == "array":
                return True

        # 3. Check well-known array properties from spec
        return key in self.KNOWN_ARRAY_PROPERTIES

    def update(self, updates: Dict[str, Any], mode: str = "add") -> Dict[str, List[str]]:
        """
        Update element data with smart array handling.

        Args:
            updates: Dictionary of updates to apply
            mode: Update mode - "add" (default), "replace", "remove"

        Returns:
            Dictionary mapping property names to their new values (as list of strings for display)

        Raises:
            ValueError: If mode is invalid or operation fails
        """
        if mode not in ("add", "replace", "remove"):
            raise ValueError(f"Invalid update mode: {mode}. Must be 'add', 'replace', or 'remove'")

        results = {}

        for key, value in updates.items():
            is_array = self._is_array_property(key)

            if mode == "replace":
                # Complete replacement
                self.data[key] = value
                results[key] = (
                    [str(value)] if not isinstance(value, list) else [str(v) for v in value]
                )

            elif mode == "add":
                if is_array:
                    # Array property - append value(s)
                    if key not in self.data or self.data[key] is None:
                        # Initialize as array
                        self.data[key] = [value] if not isinstance(value, list) else value
                    elif isinstance(self.data[key], list):
                        # Append to existing array
                        if isinstance(value, list):
                            self.data[key].extend(value)
                        else:
                            if value not in self.data[key]:  # Avoid duplicates
                                self.data[key].append(value)
                    else:
                        # Convert scalar to array
                        self.data[key] = [self.data[key], value]
                    results[key] = [str(v) for v in self.data[key]]
                else:
                    # Scalar property - replace
                    self.data[key] = value
                    results[key] = [str(value)]

            elif mode == "remove":
                if is_array and isinstance(self.data.get(key), list):
                    # Remove specific value from array
                    if value in self.data[key]:
                        self.data[key].remove(value)
                        results[key] = (
                            [str(v) for v in self.data[key]] if self.data[key] else ["(empty)"]
                        )
                    else:
                        raise ValueError(f"Value '{value}' not found in {key}")
                elif key in self.data:
                    # Remove entire property if trying to remove non-array or exact match
                    if self.data[key] == value or not is_array:
                        del self.data[key]
                        results[key] = ["(removed)"]
                    else:
                        raise ValueError(f"Cannot remove '{value}' from scalar property {key}")
                else:
                    raise ValueError(f"Property '{key}' not found")

        return results

    def unset(self, keys: List[str]) -> Dict[str, str]:
        """
        Remove properties entirely from element.

        Args:
            keys: List of property names to remove

        Returns:
            Dictionary mapping removed property names to their old values (as strings)

        Raises:
            ValueError: If property doesn't exist
        """
        results = {}
        for key in keys:
            if key not in self.data:
                raise ValueError(f"Property '{key}' not found")
            old_value = self.data[key]
            del self.data[key]
            results[key] = str(old_value)
        return results

    def to_dict(self) -> Dict[str, Any]:
        """Convert element to dictionary."""
        return {"id": self.id, "type": self.type, "layer": self.layer, **self.data}

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
    def create(cls, layer: str, element_type: str, name: str, **attributes) -> "Element":
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

        data = {"id": element_id, "name": name, **attributes}

        return cls(id=element_id, element_type=element_type, layer=layer, data=data)

    def __repr__(self) -> str:
        return f"Element(id='{self.id}', type='{self.type}', name='{self.name}')"
