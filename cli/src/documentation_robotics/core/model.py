"""
Model abstraction - represents the entire architecture model.
"""
from pathlib import Path
from typing import Dict, List, Optional
from .manifest import Manifest
from .layer import Layer
from .element import Element
# Phase 2 imports
from .reference_registry import ReferenceRegistry
from .projection_engine import ProjectionEngine
from .dependency_tracker import DependencyTracker


class Model:
    """
    Represents a complete architecture model with 11 layers.

    Provides high-level operations for model management, validation,
    and querying across all layers.
    """

    def __init__(self, root_path: Path):
        """
        Initialize model from root directory.

        Args:
            root_path: Path to the model root directory
        """
        self.root_path = root_path
        self.model_path = root_path / "model"
        self.specs_path = root_path / "specs"
        self.manifest = Manifest.load(self.model_path / "manifest.yaml")
        self.layers: Dict[str, Layer] = self._load_layers()

        # Phase 2: Initialize reference registry
        self.reference_registry = ReferenceRegistry()
        self.reference_registry.load_reference_definitions(
            self.root_path / ".dr" / "schemas"
        )

        # Build reference registry from existing elements
        for layer in self.layers.values():
            for element in layer.elements.values():
                self.reference_registry.register_element(element)

        # Phase 2: Initialize projection engine
        projection_rules_path = self.root_path / "projection-rules.yaml"
        self.projection_engine = ProjectionEngine(self, projection_rules_path)

        # Phase 2: Initialize dependency tracker
        self.dependency_tracker = DependencyTracker(self)

    def _load_layers(self) -> Dict[str, Layer]:
        """Load all enabled layers from manifest."""
        layers = {}
        for layer_name, layer_config in self.manifest.layers.items():
            if layer_config.get("enabled", True):
                layer_path = self.root_path / layer_config["path"]
                layers[layer_name] = Layer.load(
                    name=layer_name,
                    path=layer_path,
                    config=layer_config
                )
        return layers

    def get_layer(self, layer_name: str) -> Optional[Layer]:
        """Get layer by name."""
        return self.layers.get(layer_name)

    def get_element(self, element_id: str) -> Optional[Element]:
        """
        Get element by ID across all layers.

        Args:
            element_id: Element ID in format {layer}.{type}.{name}

        Returns:
            Element if found, None otherwise
        """
        # Parse element ID to extract layer
        parts = element_id.split(".")
        if len(parts) < 3:
            return None

        layer_name = parts[0]
        layer = self.get_layer(layer_name)
        if not layer:
            return None

        return layer.get_element(element_id)

    def find_elements(
        self,
        layer: Optional[str] = None,
        element_type: Optional[str] = None,
        name_pattern: Optional[str] = None,
        **properties
    ) -> List[Element]:
        """
        Find elements matching criteria.

        Args:
            layer: Filter by layer name
            element_type: Filter by element type
            name_pattern: Filter by name pattern (supports wildcards)
            **properties: Filter by property values

        Returns:
            List of matching elements
        """
        results = []

        layers_to_search = [self.layers[layer]] if layer else self.layers.values()

        for layer_obj in layers_to_search:
            results.extend(
                layer_obj.find_elements(
                    element_type=element_type,
                    name_pattern=name_pattern,
                    **properties
                )
            )

        return results

    def add_element(self, layer: str, element: Element) -> None:
        """
        Add element to a layer.

        Args:
            layer: Layer name
            element: Element to add

        Raises:
            ValueError: If layer doesn't exist
        """
        layer_obj = self.get_layer(layer)
        if not layer_obj:
            raise ValueError(f"Layer '{layer}' not found")

        layer_obj.add_element(element)
        self.manifest.increment_element_count(layer, element.type)
        self.manifest.save()

        # Phase 2: Register element references
        if hasattr(self, 'reference_registry'):
            self.reference_registry.register_element(element)

    def update_element(self, element_id: str, updates: Dict) -> None:
        """
        Update an existing element.

        Args:
            element_id: Element ID
            updates: Dictionary of updates

        Raises:
            ValueError: If element doesn't exist
        """
        element = self.get_element(element_id)
        if not element:
            raise ValueError(f"Element '{element_id}' not found")

        element.update(updates)
        element.save()

    def remove_element(self, element_id: str, cascade: bool = False) -> None:
        """
        Remove element from model.

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

        layer.remove_element(element_id)
        self.manifest.decrement_element_count(layer_name, element.type)
        self.manifest.save()

    def find_dependencies(self, element_id: str) -> List[Element]:
        """
        Find elements that depend on the given element.

        Args:
            element_id: Element ID to check

        Returns:
            List of dependent elements
        """
        dependencies = []

        for layer in self.layers.values():
            for element in layer.elements.values():
                if self._references_element(element, element_id):
                    dependencies.append(element)

        return dependencies

    def _references_element(self, element: Element, target_id: str) -> bool:
        """Check if element references target element."""
        # Check all reference fields in element
        for key, value in element.data.items():
            if isinstance(value, str) and value == target_id:
                return True
            elif isinstance(value, list) and target_id in value:
                return True
            elif isinstance(value, dict):
                if self._dict_contains_reference(value, target_id):
                    return True
        return False

    def _dict_contains_reference(self, data: dict, target_id: str) -> bool:
        """Recursively check if dict contains reference to target."""
        for value in data.values():
            if isinstance(value, str) and value == target_id:
                return True
            elif isinstance(value, list) and target_id in value:
                return True
            elif isinstance(value, dict):
                if self._dict_contains_reference(value, target_id):
                    return True
        return False

    def validate(self, strict: bool = False) -> "ValidationResult":
        """
        Validate entire model.

        Args:
            strict: If True, apply strict validation rules

        Returns:
            ValidationResult with all errors and warnings
        """
        from ..validators.base import ValidationResult
        from ..validators.semantic import SemanticValidator

        result = ValidationResult()

        # Phase 1: Validate each layer (schema validation)
        for layer_name, layer in self.layers.items():
            layer_result = layer.validate(strict=strict)
            result.merge(layer_result, prefix=layer_name)

        # Phase 1: Validate cross-layer references
        ref_result = self._validate_cross_references()
        result.merge(ref_result)

        # Phase 2: Semantic validation
        if strict:
            semantic_validator = SemanticValidator(self)
            semantic_result = semantic_validator.validate()
            result.merge(semantic_result)

        return result

    def _validate_cross_references(self) -> "ValidationResult":
        """Validate all cross-layer references."""
        from ..validators.references import ReferenceValidator

        validator = ReferenceValidator(self)
        return validator.validate()

    def save(self) -> None:
        """Save all layers and manifest."""
        for layer in self.layers.values():
            layer.save()
        self.manifest.save()

    @classmethod
    def create(cls, root_path: Path, project_name: str, **options) -> "Model":
        """
        Create a new model structure.

        Args:
            root_path: Path to create model in
            project_name: Name of the project
            **options: Additional options (template, minimal, etc.)

        Returns:
            New Model instance
        """
        from ..commands.init import ModelInitializer

        initializer = ModelInitializer(root_path, project_name, **options)
        initializer.create()

        return cls(root_path)
