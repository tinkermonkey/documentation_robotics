"""Link Registry Helper - Simplified loader for maintainer scripts."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class LinkType:
    """Represents a single cross-layer link type."""

    id: str
    name: str
    category: str
    source_layers: List[str]
    target_layer: str
    target_element_types: List[str]
    field_paths: List[str]
    cardinality: str  # "single" or "array"
    format: str
    description: str
    examples: List[Any]
    validation_rules: Dict[str, Any]

    # Enhanced fields (may not exist in current registry)
    predicate: Optional[str] = None
    inverse_predicate: Optional[str] = None
    relationship_category: Optional[str] = None
    source_element_types: Optional[List[str]] = None
    source_element_types_by_layer: Optional[Dict[str, List[str]]] = None
    strength: Optional[str] = None
    is_required: Optional[bool] = None
    bidirectional: Optional[bool] = None
    archimate_alignment: Optional[str] = None

    @property
    def is_array(self) -> bool:
        """Check if this link type expects an array."""
        return self.cardinality == "array"

    @property
    def has_predicate(self) -> bool:
        """Check if this link type has a semantic predicate defined."""
        return self.predicate is not None

    @property
    def is_bidirectional(self) -> bool:
        """Check if this link supports bidirectional navigation."""
        return self.bidirectional is True and self.inverse_predicate is not None

    def matches_field_path(self, field_path: str) -> bool:
        """Check if a field path matches this link type."""
        return field_path in self.field_paths

    def matches_predicate(self, predicate: str) -> bool:
        """Check if this link type matches a predicate (forward or inverse)."""
        return predicate == self.predicate or predicate == self.inverse_predicate


class LinkRegistry:
    """Simplified registry loader for maintainer scripts."""

    def __init__(self, registry_path: Optional[Path] = None):
        """Initialize the link registry.

        Args:
            registry_path: Path to link-registry.json. If None, uses default location.
        """
        self.registry_path = registry_path or self._get_default_registry_path()
        self.link_types: Dict[str, LinkType] = {}
        self.categories: Dict[str, Dict[str, Any]] = {}
        self.metadata: Dict[str, Any] = {}
        self._load_registry()

    def _get_default_registry_path(self) -> Path:
        """Get the default path to the link registry file."""
        # From scripts/ directory, spec is ../spec/
        script_dir = Path(__file__).parent.parent
        registry_path = script_dir.parent / "spec" / "schemas" / "link-registry.json"

        if not registry_path.exists():
            raise FileNotFoundError(
                f"Link registry not found at {registry_path}. "
                "Run from repository root."
            )

        return registry_path

    def _load_registry(self) -> None:
        """Load the link registry from JSON file."""
        with open(self.registry_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Load link types
        for link_data in data.get("linkTypes", []):
            link_type = LinkType(
                id=link_data["id"],
                name=link_data["name"],
                category=link_data["category"],
                source_layers=link_data["sourceLayers"],
                target_layer=link_data["targetLayer"],
                target_element_types=link_data["targetElementTypes"],
                field_paths=link_data["fieldPaths"],
                cardinality=link_data["cardinality"],
                format=link_data["format"],
                description=link_data["description"],
                examples=link_data.get("examples", []),
                validation_rules=link_data.get("validationRules", {}),
                # Enhanced fields (optional)
                predicate=link_data.get("predicate"),
                inverse_predicate=link_data.get("inversePredicate"),
                relationship_category=link_data.get("relationshipCategory"),
                source_element_types=link_data.get("sourceElementTypes"),
                source_element_types_by_layer=link_data.get("sourceElementTypesByLayer"),
                strength=link_data.get("strength"),
                is_required=link_data.get("isRequired"),
                bidirectional=link_data.get("bidirectional"),
                archimate_alignment=link_data.get("archimateAlignment"),
            )
            self.link_types[link_type.id] = link_type

        # Load categories
        self.categories = data.get("categories", {})

        # Load metadata
        self.metadata = data.get("metadata", {})

    def find_links_between(self, source_layer: str, target_layer: str) -> List[LinkType]:
        """Find all links between two layers."""
        return [
            lt for lt in self.link_types.values()
            if source_layer in lt.source_layers and lt.target_layer == target_layer
        ]

    def find_links_by_field_path(self, field_path: str) -> List[LinkType]:
        """Find link types that use a specific field path."""
        return [
            lt for lt in self.link_types.values()
            if field_path in lt.field_paths
        ]

    def get_links_by_category(self, category: str) -> List[LinkType]:
        """Get all links in a category."""
        return [
            lt for lt in self.link_types.values()
            if lt.category == category
        ]

    def get_links_by_source_layer(self, layer_id: str) -> List[LinkType]:
        """Get all links originating from a layer."""
        return [
            lt for lt in self.link_types.values()
            if layer_id in lt.source_layers
        ]

    def get_links_by_target_layer(self, layer_id: str) -> List[LinkType]:
        """Get all links targeting a layer."""
        return [
            lt for lt in self.link_types.values()
            if lt.target_layer == layer_id
        ]

    # Enhanced v2.0 query methods

    def find_links_by_predicate(self, predicate: str, include_inverse: bool = True) -> List[LinkType]:
        """Find links by semantic predicate.

        Args:
            predicate: Semantic predicate to search for (e.g., "supports-goals")
            include_inverse: If True, also match inverse predicates

        Returns:
            List of link types matching the predicate
        """
        if include_inverse:
            return [
                lt for lt in self.link_types.values()
                if lt.predicate == predicate or lt.inverse_predicate == predicate
            ]
        else:
            return [
                lt for lt in self.link_types.values()
                if lt.predicate == predicate
            ]

    def find_inverse_link(self, link_id: str) -> Optional[LinkType]:
        """Find the inverse of a link type.

        Args:
            link_id: ID of the link type to find inverse for

        Returns:
            Link type with inverse predicate, or None if not found
        """
        link = self.link_types.get(link_id)
        if not link or not link.inverse_predicate:
            return None

        # Find link with forward predicate matching our inverse predicate
        for lt in self.link_types.values():
            if lt.predicate == link.inverse_predicate:
                return lt

        return None

    def get_links_by_relationship_category(self, category: str) -> List[LinkType]:
        """Get all links in a relationship category.

        Args:
            category: Relationship category (e.g., "traceability", "structural")

        Returns:
            List of link types in that category
        """
        return [
            lt for lt in self.link_types.values()
            if lt.relationship_category == category
        ]

    def get_links_by_strength(self, *strengths: str) -> List[LinkType]:
        """Get links by strength level(s).

        Args:
            *strengths: One or more strength levels ("critical", "high", "medium", "low")

        Returns:
            List of link types matching any of the specified strengths
        """
        strength_set = set(strengths)
        return [
            lt for lt in self.link_types.values()
            if lt.strength in strength_set
        ]

    def get_required_links(self) -> List[LinkType]:
        """Get all links that are marked as required.

        Returns:
            List of link types where isRequired=true
        """
        return [
            lt for lt in self.link_types.values()
            if lt.is_required is True
        ]

    def get_bidirectional_links(self) -> List[LinkType]:
        """Get all links that support bidirectional navigation.

        Returns:
            List of link types with bidirectional support
        """
        return [
            lt for lt in self.link_types.values()
            if lt.is_bidirectional
        ]

    def get_archimate_aligned_links(self, relationship_type: Optional[str] = None) -> List[LinkType]:
        """Get links aligned with ArchiMate.

        Args:
            relationship_type: Specific ArchiMate type (e.g., "Realization"), or None for all

        Returns:
            List of ArchiMate-aligned link types
        """
        if relationship_type:
            return [
                lt for lt in self.link_types.values()
                if lt.archimate_alignment == relationship_type
            ]
        else:
            return [
                lt for lt in self.link_types.values()
                if lt.archimate_alignment is not None
            ]

    def get_links_with_examples(self) -> List[LinkType]:
        """Get all links that have examples defined.

        Returns:
            List of link types with non-empty examples
        """
        return [
            lt for lt in self.link_types.values()
            if lt.examples and len(lt.examples) > 0
        ]

    def get_links_without_examples(self) -> List[LinkType]:
        """Get all links that are missing examples.

        Returns:
            List of link types with empty examples
        """
        return [
            lt for lt in self.link_types.values()
            if not lt.examples or len(lt.examples) == 0
        ]

    def find_links_by_source_element_type(self, element_type: str) -> List[LinkType]:
        """Find links that can originate from a specific element type.

        Args:
            element_type: Source element type (e.g., "ApplicationService")

        Returns:
            List of link types applicable to that element type
        """
        return [
            lt for lt in self.link_types.values()
            if lt.source_element_types and element_type in lt.source_element_types
        ]

    def find_links_by_target_element_type(self, element_type: str) -> List[LinkType]:
        """Find links that target a specific element type.

        Args:
            element_type: Target element type (e.g., "Goal")

        Returns:
            List of link types targeting that element type
        """
        return [
            lt for lt in self.link_types.values()
            if element_type in lt.target_element_types
        ]

    # Statistics methods

    def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive statistics about the link registry.

        Returns:
            Dictionary with various statistics
        """
        total = len(self.link_types)
        with_predicates = len([lt for lt in self.link_types.values() if lt.has_predicate])
        bidirectional = len(self.get_bidirectional_links())
        with_examples = len(self.get_links_with_examples())
        archimate_aligned = len(self.get_archimate_aligned_links())

        category_counts = {}
        for category in set(lt.category for lt in self.link_types.values()):
            category_counts[category] = len(self.get_links_by_category(category))

        relationship_category_counts = {}
        for rel_cat in set(lt.relationship_category for lt in self.link_types.values() if lt.relationship_category):
            relationship_category_counts[rel_cat] = len(self.get_links_by_relationship_category(rel_cat))

        strength_counts = {}
        for strength in ["critical", "high", "medium", "low"]:
            strength_counts[strength] = len(self.get_links_by_strength(strength))

        return {
            "total_link_types": total,
            "with_predicates": with_predicates,
            "predicate_coverage": f"{(with_predicates / total * 100):.1f}%" if total > 0 else "0%",
            "bidirectional": bidirectional,
            "with_examples": with_examples,
            "without_examples": total - with_examples,
            "archimate_aligned": archimate_aligned,
            "category_counts": category_counts,
            "relationship_category_counts": relationship_category_counts,
            "strength_counts": strength_counts,
        }
