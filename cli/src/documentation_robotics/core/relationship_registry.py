"""Relationship Registry - Manages catalog of semantic relationship types.

This module provides the RelationshipRegistry class which loads, manages, and queries
the catalog of all semantic relationship types with their predicates and metadata.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set


@dataclass
class RelationshipType:
    """Represents a semantic relationship type from relationship-catalog.json."""

    id: str
    predicate: str
    inverse_predicate: str
    category: str
    archimate_alignment: Optional[str]
    description: str
    semantics: Dict[str, Any]
    applicable_layers: List[str]
    examples: List[Dict[str, Any]]

    @property
    def is_bidirectional(self) -> bool:
        """Check if this relationship is bidirectional."""
        return self.semantics.get("directionality") == "bidirectional"

    @property
    def is_transitive(self) -> bool:
        """Check if this relationship is transitive."""
        return self.semantics.get("transitivity", False)

    @property
    def is_symmetric(self) -> bool:
        """Check if this relationship is symmetric."""
        return self.semantics.get("symmetry", False)

    def applies_to_layer(self, layer: str) -> bool:
        """Check if this relationship applies to a specific layer.

        Supports both short form ("02") and full form ("02-business") layer identifiers.
        The method checks:
        1. Exact match against applicable_layers
        2. Short-form prefix match (extracts prefix before first '-')

        For example:
        - If applicable_layers contains ["02", "04"], both "02" and "02-business" will match
        - If applicable_layers contains ["02-business"], only "02-business" matches (not "02")

        Args:
            layer: Layer identifier (e.g., "06-api", "07-data-model") or short form ("06", "07")

        Returns:
            True if the relationship applies to the layer
        """
        # Handle both "06-api" and "06" formats
        layer_num = layer.split("-")[0]
        return layer_num in self.applicable_layers or layer in self.applicable_layers


class RelationshipRegistry:
    """Registry for relationship types and predicates.

    This class loads the relationship catalog and provides methods to query
    predicates, inverse relationships, and layer-specific relationships.
    """

    def __init__(self, catalog_path: Optional[Path] = None):
        """Initialize the relationship registry.

        Args:
            catalog_path: Path to relationship-catalog.json. If None, uses default location.
        """
        self.catalog_path = catalog_path or self._get_default_catalog_path()
        self.relationship_types: Dict[str, RelationshipType] = {}
        self.predicate_map: Dict[str, RelationshipType] = {}
        self.categories: Set[str] = set()
        self.metadata: Dict[str, Any] = {}
        self._load_catalog()

    def _get_default_catalog_path(self) -> Path:
        """Get the default path to the relationship catalog file."""
        # 1. Check bundled schemas directory (installed mode)
        bundled_path = (
            Path(__file__).parent.parent
            / "schemas"
            / "bundled"
            / "relationship-catalog.json"
        )
        if bundled_path.exists():
            return bundled_path

        # 2. Check package schemas directory (legacy)
        pkg_path = (
            Path(__file__).parent.parent / "schemas" / "relationship-catalog.json"
        )
        if pkg_path.exists():
            return pkg_path

        # 3. Fallback to repo root (dev mode)
        current_file = Path(__file__)
        repo_root = current_file.parent.parent.parent.parent.parent
        return repo_root / "spec" / "schemas" / "relationship-catalog.json"

    def _load_catalog(self) -> None:
        """Load relationship-catalog.json."""
        if not self.catalog_path.exists():
            raise FileNotFoundError(
                f"Relationship catalog not found at {self.catalog_path}. "
                "Run from repository root or specify catalog_path."
            )

        with open(self.catalog_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # Load metadata
        self.metadata = {
            "version": data.get("version", "unknown"),
            "generatedBy": data.get("generatedBy", "unknown"),
            "lastUpdated": data.get("lastUpdated", "unknown"),
        }

        # Load relationship types
        for rel_data in data.get("relationshipTypes", []):
            rel_type = RelationshipType(
                id=rel_data["id"],
                predicate=rel_data["predicate"],
                inverse_predicate=rel_data["inversePredicate"],
                category=rel_data["category"],
                archimate_alignment=rel_data.get("archimateAlignment"),
                description=rel_data["description"],
                semantics=rel_data.get("semantics", {}),
                applicable_layers=rel_data.get("applicableLayers", []),
                examples=rel_data.get("examples", []),
            )
            self.relationship_types[rel_type.id] = rel_type
            # Index both forward and inverse predicates
            self.predicate_map[rel_type.predicate] = rel_type
            if rel_type.inverse_predicate:
                self.predicate_map[rel_type.inverse_predicate] = rel_type
            self.categories.add(rel_type.category)

    def get_relationship_type(self, relationship_id: str) -> Optional[RelationshipType]:
        """Get relationship type by ID.

        Args:
            relationship_id: The relationship identifier (e.g., "composition", "aggregation")

        Returns:
            RelationshipType object or None if not found
        """
        return self.relationship_types.get(relationship_id)

    def get_predicate(self, predicate: str) -> Optional[RelationshipType]:
        """Get relationship type by predicate name.

        Args:
            predicate: The predicate (e.g., "composes", "aggregates", "realizes")

        Returns:
            RelationshipType object or None if not found
        """
        return self.predicate_map.get(predicate)

    def get_inverse_predicate(self, predicate: str) -> Optional[str]:
        """Get inverse predicate for bidirectional validation.

        Args:
            predicate: The forward predicate

        Returns:
            Inverse predicate string or None if not found
        """
        rel_type = self.get_predicate(predicate)
        return rel_type.inverse_predicate if rel_type else None

    def get_predicates_for_layer(self, layer: str) -> List[str]:
        """Get all valid predicates for a given layer.

        Args:
            layer: Layer identifier (e.g., "06-api", "07-data-model")

        Returns:
            List of predicate names applicable to the layer
        """
        predicates = []
        for rel_type in self.relationship_types.values():
            if rel_type.applies_to_layer(layer):
                predicates.append(rel_type.predicate)
        return sorted(predicates)

    def get_relationship_types_by_category(self, category: str) -> List[RelationshipType]:
        """Get all relationship types in a category.

        Args:
            category: Category name (e.g., "structural", "dependency", "dynamic")

        Returns:
            List of RelationshipType objects
        """
        return [
            rel
            for rel in self.relationship_types.values()
            if rel.category == category
        ]

    def list_all_predicates(self) -> List[str]:
        """List all available predicates.

        Returns:
            Sorted list of all predicate names
        """
        return sorted(self.predicate_map.keys())

    def list_all_categories(self) -> List[str]:
        """List all relationship categories.

        Returns:
            Sorted list of category names
        """
        return sorted(self.categories)

    def get_all_relationship_types(self) -> List[RelationshipType]:
        """Get all relationship types in the catalog.

        Returns:
            List of all RelationshipType objects
        """
        return list(self.relationship_types.values())

    def export_to_dict(self) -> Dict[str, Any]:
        """Export the entire catalog as a dictionary.

        Returns:
            Dictionary representation of the catalog
        """
        return {
            "metadata": self.metadata,
            "relationshipTypes": [
                {
                    "id": rel.id,
                    "predicate": rel.predicate,
                    "inversePredicate": rel.inverse_predicate,
                    "category": rel.category,
                    "archimateAlignment": rel.archimate_alignment,
                    "description": rel.description,
                    "semantics": rel.semantics,
                    "applicableLayers": rel.applicable_layers,
                    "examples": rel.examples,
                }
                for rel in self.relationship_types.values()
            ],
        }

    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about the relationship catalog.

        Returns:
            Dictionary with catalog statistics
        """
        category_counts = {}
        for rel in self.relationship_types.values():
            category_counts[rel.category] = category_counts.get(rel.category, 0) + 1

        bidirectional_count = sum(
            1 for rel in self.relationship_types.values() if rel.is_bidirectional
        )

        return {
            "total_relationship_types": len(self.relationship_types),
            "total_predicates": len(self.predicate_map),
            "total_categories": len(self.categories),
            "category_counts": category_counts,
            "bidirectional_count": bidirectional_count,
            "version": self.metadata.get("version", "unknown"),
        }

    def __repr__(self) -> str:
        """String representation of the registry."""
        return (
            f"RelationshipRegistry(relationship_types={len(self.relationship_types)}, "
            f"predicates={len(self.predicate_map)}, "
            f"categories={len(self.categories)})"
        )
