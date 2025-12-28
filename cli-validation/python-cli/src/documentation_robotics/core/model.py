"""
Model abstraction - represents the entire architecture model.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

from .cache import ModelCache, make_query_key
from .dependency_tracker import DependencyTracker
from .element import Element
from .layer import Layer
from .manifest import Manifest
from .projection_engine import ProjectionEngine

# Phase 2 imports
from .reference_registry import ReferenceRegistry


class Model:
    """
    Represents a complete architecture model with 11 layers.

    Provides high-level operations for model management, validation,
    and querying across all layers.
    """

    def __init__(self, root_path: Path, enable_cache: bool = True, lazy_load: bool = False):
        """
        Initialize model from root directory.

        Args:
            root_path: Path to the model root directory
            enable_cache: Enable caching for improved performance (default: True)
            lazy_load: Enable lazy loading of layers (default: False)
        """
        self.root_path = root_path
        self.model_path = root_path / "documentation-robotics" / "model"
        self.specs_path = root_path / "documentation-robotics" / "specs"
        self.manifest = Manifest.load(self.model_path / "manifest.yaml")

        # Phase 4.3: Initialize cache
        self._cache = ModelCache() if enable_cache else None
        self._lazy_load = lazy_load

        # Load layers (lazy or eager)
        if lazy_load:
            self.layers: Dict[str, Layer] = {}
            self._lazy_layers: Dict[str, bool] = {
                name: False
                for name, config in self.manifest.layers.items()
                if config.get("enabled", True)
            }
        else:
            self.layers: Dict[str, Layer] = self._load_layers()
            self._lazy_layers = {}

        # Phase 2: Initialize reference registry
        self.reference_registry = ReferenceRegistry()
        self.reference_registry.load_reference_definitions(self.root_path / ".dr" / "schemas")

        # Build reference registry from existing elements (skip if lazy loading)
        if not lazy_load:
            for layer in self.layers.values():
                for element in layer.elements.values():
                    self.reference_registry.register_element(element)

        # Phase 2: Initialize projection engine
        projection_rules_path = self.root_path / "documentation-robotics" / "projection-rules.yaml"
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
                    name=layer_name, path=layer_path, config=layer_config, cache=self._cache
                )
        return layers

    def get_layer(self, layer_name: str) -> Optional[Layer]:
        """
        Get layer by name, loading if lazy.

        Args:
            layer_name: Name of the layer

        Returns:
            Layer if found, None otherwise
        """
        # Check if already loaded
        if layer_name in self.layers:
            return self.layers[layer_name]

        # Check if lazy loading is enabled and layer needs to be loaded
        if self._lazy_load and layer_name in self._lazy_layers:
            if not self._lazy_layers[layer_name]:
                # Load the layer
                layer_config = self.manifest.layers.get(layer_name)
                if layer_config and layer_config.get("enabled", True):
                    layer_path = self.root_path / layer_config["path"]
                    layer = Layer.load(
                        name=layer_name, path=layer_path, config=layer_config, cache=self._cache
                    )
                    self.layers[layer_name] = layer
                    self._lazy_layers[layer_name] = True

                    # Register elements in reference registry
                    for element in layer.elements.values():
                        self.reference_registry.register_element(element)

                    return layer

        return self.layers.get(layer_name)

    def list_layers(self) -> List[str]:
        """
        Get list of all layer names in the model.

        Returns:
            List of layer names
        """
        return list(self.layers.keys())

    def get_element(self, element_id: str) -> Optional[Element]:
        """
        Get element by ID across all layers (with caching).

        Args:
            element_id: Element ID in format {layer}.{type}.{name}

        Returns:
            Element if found, None otherwise
        """
        # Try cache first
        if self._cache:
            cached = self._cache.get_element(element_id)
            if cached is not None:
                return cached

        # Parse element ID to extract layer
        parts = element_id.split(".")
        if len(parts) < 3:
            return None

        layer_name = parts[0]
        layer = self.get_layer(layer_name)
        if not layer:
            return None

        element = layer.get_element(element_id)

        # Cache the result
        if element and self._cache:
            self._cache.set_element(element_id, element)

        return element

    def find_elements(
        self,
        layer: Optional[str] = None,
        element_type: Optional[str] = None,
        name_pattern: Optional[str] = None,
        **properties,
    ) -> List[Element]:
        """
        Find elements matching criteria (with caching).

        Args:
            layer: Filter by layer name
            element_type: Filter by element type
            name_pattern: Filter by name pattern (supports wildcards)
            **properties: Filter by property values

        Returns:
            List of matching elements
        """
        # Try cache first
        if self._cache:
            query_key = make_query_key(
                layer=layer, element_type=element_type, name_pattern=name_pattern, **properties
            )
            cached = self._cache.get_query(query_key)
            if cached is not None:
                return cached

        # Perform search
        results = []

        layers_to_search = [self.layers[layer]] if layer else self.layers.values()

        for layer_obj in layers_to_search:
            results.extend(
                layer_obj.find_elements(
                    element_type=element_type, name_pattern=name_pattern, **properties
                )
            )

        # Cache the results
        if self._cache:
            self._cache.set_query(query_key, results)

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
        if hasattr(self, "reference_registry"):
            self.reference_registry.register_element(element)

        # Phase 4.3: Invalidate caches
        if self._cache:
            self._cache.invalidate_queries()  # Query results may have changed

    def update_element(
        self, element_id: str, updates: Dict, mode: str = "add"
    ) -> Dict[str, List[str]]:
        """
        Update an existing element.

        Args:
            element_id: Element ID
            updates: Dictionary of updates
            mode: Update mode - "add" (default), "replace", "remove"

        Returns:
            Dictionary mapping property names to their new values (as list of strings)

        Raises:
            ValueError: If element doesn't exist
        """
        element = self.get_element(element_id)
        if not element:
            raise ValueError(f"Element '{element_id}' not found")

        results = element.update(updates, mode=mode)
        element.save()

        # Phase 4.3: Invalidate caches
        if self._cache:
            self._cache.invalidate_element(element_id)
            self._cache.invalidate_queries()

        return results

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

        # Phase 4.3: Invalidate caches
        if self._cache:
            self._cache.invalidate_element(element_id)
            self._cache.invalidate_queries()

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
        from ..validators.consistency import BidirectionalConsistencyValidator
        from ..validators.goal_metrics import GoalToMetricTraceabilityValidator
        from ..validators.security import SecurityIntegrationValidator
        from ..validators.semantic import SemanticValidator
        from ..validators.traceability import UpwardTraceabilityValidator

        result = ValidationResult()

        # Phase 1: Schema validation for each layer
        for layer_name, layer in self.layers.items():
            layer_result = layer.validate(strict=strict)
            # Don't add layer prefix - element IDs already contain layer name
            result.merge(layer_result)

        # Phase 2: Cross-layer reference validation (always)
        ref_result = self._validate_cross_references()
        result.merge(ref_result)

        # Phase 3: Semantic validation (always in strict mode, recommended otherwise)
        semantic_validator = SemanticValidator(self)
        semantic_result = semantic_validator.validate()
        result.merge(semantic_result)

        # Phase 4: Spec alignment validators (strict mode only for comprehensive validation)
        if strict:
            # Upward traceability validation
            traceability_validator = UpwardTraceabilityValidator()
            traceability_result = traceability_validator.validate(self)
            result.merge(traceability_result)

            # Security integration validation
            security_validator = SecurityIntegrationValidator()
            security_result = security_validator.validate(self)
            result.merge(security_result)

            # Bidirectional consistency validation
            consistency_validator = BidirectionalConsistencyValidator()
            consistency_result = consistency_validator.validate(self)
            result.merge(consistency_result)

            # Goal-to-metric traceability validation
            goal_metrics_validator = GoalToMetricTraceabilityValidator()
            goal_metrics_result = goal_metrics_validator.validate(self)
            result.merge(goal_metrics_result)

        return result

    def _validate_cross_references(self) -> "ValidationResult":
        """Validate all cross-layer references."""
        from ..validators.references import ReferenceValidator

        validator = ReferenceValidator(self)
        return validator.validate()

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert model to dictionary representation.

        Returns:
            Dictionary with all layers and their elements
        """
        result = {}

        for layer_name, layer in self.layers.items():
            # Use layer name as key (e.g., "01-motivation", "06-api")
            result[layer_name] = layer.to_dict()

        return result

    def get_cache_stats(self) -> Optional[Dict]:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache statistics if caching is enabled, None otherwise
        """
        if self._cache:
            return self._cache.get_stats_summary()
        return None

    def clear_cache(self) -> None:
        """Clear all caches."""
        if self._cache:
            self._cache.clear()

    def invalidate_cache(
        self, element_id: Optional[str] = None, layer: Optional[str] = None
    ) -> None:
        """
        Invalidate cache entries.

        Args:
            element_id: Invalidate specific element (optional)
            layer: Invalidate entire layer (optional)
        """
        if not self._cache:
            return

        if element_id:
            self._cache.invalidate_element(element_id)
        elif layer:
            self._cache.invalidate_layer(layer)
        else:
            # Invalidate query cache
            self._cache.invalidate_queries()

    def preload_layers(self, layer_names: Optional[List[str]] = None) -> None:
        """
        Preload layers (useful for lazy loading).

        Args:
            layer_names: Specific layers to load (default: all)
        """
        if not self._lazy_load:
            return  # Already eagerly loaded

        if layer_names is None:
            layer_names = list(self._lazy_layers.keys())

        for layer_name in layer_names:
            self.get_layer(layer_name)  # Triggers lazy load

    def add_relationship(self, source_id: str, relationship: Dict[str, Any]) -> None:
        """Add a relationship from source element.

        Args:
            source_id: ID of the source element
            relationship: Relationship dictionary with targetId, predicate, type

        Raises:
            ValueError: If element doesn't exist
        """
        element = self.get_element(source_id)
        if not element:
            raise ValueError(f"Element {source_id} not found")

        # Ensure relationships field exists
        if "relationships" not in element.data:
            element.data["relationships"] = []

        # Check for duplicates
        existing = element.data["relationships"]
        target_id = relationship.get("targetId")
        predicate = relationship.get("predicate")

        # Don't add duplicate relationships
        for rel in existing:
            if rel.get("targetId") == target_id and rel.get("predicate") == predicate:
                return  # Duplicate, skip

        # Add the relationship
        element.data["relationships"].append(relationship)
        element.save()

        # Invalidate caches
        if self._cache:
            self._cache.invalidate_element(source_id)
            self._cache.invalidate_queries()

    def remove_relationship(self, source_id: str, predicate: str, target_id: str) -> bool:
        """Remove a relationship from source element.

        Args:
            source_id: ID of the source element
            predicate: Predicate of the relationship to remove
            target_id: ID of the target element

        Returns:
            True if relationship was found and removed, False otherwise
        """
        element = self.get_element(source_id)
        if not element or "relationships" not in element.data:
            return False

        # Find and remove the relationship
        original_count = len(element.data["relationships"])
        element.data["relationships"] = [
            r
            for r in element.data["relationships"]
            if not (r.get("predicate") == predicate and r.get("targetId") == target_id)
        ]

        removed = len(element.data["relationships"]) < original_count
        if removed:
            element.save()

            # Invalidate caches
            if self._cache:
                self._cache.invalidate_element(source_id)
                self._cache.invalidate_queries()

        return removed

    def get_relationships(self, element_id: str) -> List[Dict[str, Any]]:
        """Get all outgoing relationships for an element.

        Args:
            element_id: ID of the element

        Returns:
            List of relationship dictionaries
        """
        element = self.get_element(element_id)
        if not element:
            return []
        return element.data.get("relationships", [])

    def find_incoming_relationships(self, target_id: str) -> List[Dict[str, Any]]:
        """Find all incoming relationships to an element.

        Args:
            target_id: ID of the target element

        Returns:
            List of relationship dictionaries with sourceId added
        """
        incoming = []
        for layer in self.layers.values():
            for element in layer.elements.values():
                relationships = element.data.get("relationships", [])
                for rel in relationships:
                    if rel.get("targetId") == target_id:
                        # Add source ID to the relationship for display
                        incoming_rel = rel.copy()
                        incoming_rel["sourceId"] = element.id
                        incoming.append(incoming_rel)
        return incoming

    def save(self) -> None:
        """Save all layers and manifest."""
        for layer in self.layers.values():
            layer.save()
        self.manifest.save()

    @staticmethod
    def load(root_path: Path, changeset: Optional[str] = None, **kwargs) -> "Model":
        """
        Factory method to load a model with optional changeset context.

        Args:
            root_path: Path to the model root directory
            changeset: Optional changeset ID to work in
            **kwargs: Additional arguments passed to Model constructor

        Returns:
            Model instance (or ChangesetModel if changeset specified)
        """
        if changeset:
            from .changeset_model import ChangesetModel

            return ChangesetModel(root_path, changeset, **kwargs)
        else:
            return Model(root_path, **kwargs)

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
