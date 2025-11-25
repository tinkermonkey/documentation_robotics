"""
Layer abstraction - represents a single architecture layer.
"""

import fnmatch
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from .element import Element


class Layer:
    """
    Represents a single architecture layer (e.g., Business, Application).

    Manages elements within the layer, including loading, saving,
    querying, and validation.
    """

    def __init__(self, name: str, path: Path, config: Dict[str, Any], cache=None):
        """
        Initialize layer.

        Args:
            name: Layer name (e.g., 'business', 'application')
            path: Path to layer directory
            config: Layer configuration from manifest
            cache: Optional ModelCache instance for caching
        """
        self.name = name
        self.path = path
        self.config = config
        self.schema_path = config.get("schema")
        self._cache = cache
        self.elements: Dict[str, Element] = {}
        self._load_elements()

    def _load_elements(self) -> None:
        """Load all elements from layer files."""
        if not self.path.exists():
            return

        # Get file pattern from config (default to *.yaml)
        pattern = self.config.get("file_pattern", "*.yaml")

        for file_path in self.path.glob(pattern):
            if file_path.is_file():
                self._load_elements_from_file(file_path)

    def _load_elements_from_file(self, file_path: Path) -> None:
        """Load elements from a single YAML file."""
        try:
            with open(file_path, "r") as f:
                data = yaml.safe_load(f)

            if not data:
                return

            # Each file contains a dictionary of elements
            # The key is the element type or name
            for key, element_data in data.items():
                if isinstance(element_data, dict):
                    element = self._create_element_from_data(key, element_data, file_path)
                    if element:
                        self.elements[element.id] = element

        except Exception as e:
            # Log warning but continue
            print(f"Warning: Failed to load {file_path}: {e}")

    def _create_element_from_data(
        self, key: str, data: Dict[str, Any], file_path: Path
    ) -> Optional[Element]:
        """Create Element from data dictionary."""
        # Element should have 'id' and 'type'
        element_id = data.get("id")
        if not element_id:
            # Try to infer from key and layer
            element_id = f"{self.name}.{key}"

        # Try to determine element type
        element_type = data.get("type") or self._infer_type_from_file(file_path)

        return Element(
            id=element_id,
            element_type=element_type,
            layer=self.name,
            data=data,
            file_path=file_path,
        )

    def _infer_type_from_file(self, file_path: Path) -> str:
        """Infer element type from filename."""
        # e.g., 'services.yaml' -> 'service'
        name = file_path.stem
        if name.endswith("s"):
            return name[:-1]  # Remove plural 's'
        return name

    def get_element(self, element_id: str) -> Optional[Element]:
        """Get element by ID."""
        return self.elements.get(element_id)

    def list_elements(self) -> List[Element]:
        """
        Get list of all elements in this layer.

        Returns:
            List of all elements
        """
        return list(self.elements.values())

    def find_elements(
        self, element_type: Optional[str] = None, name_pattern: Optional[str] = None, **properties
    ) -> List[Element]:
        """
        Find elements matching criteria.

        Args:
            element_type: Filter by element type
            name_pattern: Filter by name pattern (supports wildcards)
            **properties: Filter by property values

        Returns:
            List of matching elements
        """
        results = []

        for element in self.elements.values():
            # Filter by type
            if element_type and element.type != element_type:
                continue

            # Filter by name pattern
            if name_pattern and not fnmatch.fnmatch(element.name, name_pattern):
                continue

            # Filter by properties
            match = True
            for key, value in properties.items():
                if element.get(key) != value:
                    match = False
                    break

            if match:
                results.append(element)

        return results

    def add_element(self, element: Element) -> None:
        """
        Add element to layer.

        Args:
            element: Element to add

        Raises:
            ValueError: If element already exists
        """
        if element.id in self.elements:
            raise ValueError(f"Element '{element.id}' already exists")

        self.elements[element.id] = element

        # Determine target file based on element type
        file_name = f"{element.type}s.yaml"  # Pluralize type
        file_path = self.path / file_name

        # Load existing data or create new
        if file_path.exists():
            with open(file_path, "r") as f:
                data = yaml.safe_load(f) or {}
        else:
            data = {}

        # Add element (use name as key)
        data[element.name] = element.data

        # Ensure directory exists
        file_path.parent.mkdir(parents=True, exist_ok=True)

        # Save file
        with open(file_path, "w") as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)

        element.file_path = file_path

    def remove_element(self, element_id: str) -> None:
        """
        Remove element from layer.

        Args:
            element_id: Element ID to remove

        Raises:
            ValueError: If element doesn't exist
        """
        if element_id not in self.elements:
            raise ValueError(f"Element '{element_id}' not found")

        element = self.elements[element_id]

        # Remove from file
        if element.file_path and element.file_path.exists():
            with open(element.file_path, "r") as f:
                data = yaml.safe_load(f) or {}

            # Find and remove element (search by id or name)
            key_to_remove = None
            for key, value in data.items():
                if isinstance(value, dict) and value.get("id") == element_id:
                    key_to_remove = key
                    break

            if key_to_remove:
                del data[key_to_remove]

                # Save updated file
                with open(element.file_path, "w") as f:
                    yaml.dump(data, f, default_flow_style=False, sort_keys=False)

        # Remove from memory
        del self.elements[element_id]

    def validate(self, strict: bool = False) -> "ValidationResult":
        """
        Validate all elements in layer.

        Args:
            strict: If True, apply strict validation

        Returns:
            ValidationResult
        """
        from ..validators.base import ValidationResult
        from ..validators.schema import SchemaValidator

        result = ValidationResult()

        # Validate each element against schema
        if self.schema_path:
            validator = SchemaValidator(self.schema_path)

            for element in self.elements.values():
                element_result = validator.validate_element(element, strict=strict)
                result.merge(element_result, prefix=element.id)

        return result

    def save(self) -> None:
        """Save all elements in layer."""
        # Group elements by file
        files: Dict[Path, Dict[str, Any]] = {}

        for element in self.elements.values():
            if element.file_path:
                if element.file_path not in files:
                    files[element.file_path] = {}

                files[element.file_path][element.name] = element.data

        # Save each file
        for file_path, data in files.items():
            with open(file_path, "w") as f:
                yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    @classmethod
    def load(cls, name: str, path: Path, config: Dict[str, Any], cache=None) -> "Layer":
        """
        Load layer from directory.

        Args:
            name: Layer name
            path: Path to layer directory
            config: Layer configuration
            cache: Optional ModelCache instance

        Returns:
            Loaded Layer instance
        """
        return cls(name, path, config, cache=cache)

    def __repr__(self) -> str:
        return f"Layer(name='{self.name}', elements={len(self.elements)})"
