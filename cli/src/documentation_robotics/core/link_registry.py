"""Link Registry - Manages catalog of all cross-layer reference patterns.

This module provides the LinkRegistry class which loads, manages, and queries
the catalog of all cross-layer reference patterns defined in the specification.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set


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
    format: str  # "uuid", "string", "path", "duration", "percentage"
    description: str
    examples: List[str]
    validation_rules: Dict[str, Any]

    @property
    def is_array(self) -> bool:
        """Check if this link type expects an array."""
        return self.cardinality == "array"

    @property
    def requires_uuid_format(self) -> bool:
        """Check if this link type requires UUID format."""
        return self.format == "uuid"

    def matches_field_path(self, field_path: str) -> bool:
        """Check if a field path matches this link type."""
        return field_path in self.field_paths


class LinkRegistry:
    """Registry of all cross-layer reference patterns.

    This class loads the link registry from the JSON file and provides
    methods to query, filter, and export link definitions.
    """

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
        # 1. Check package directory (installed mode)
        pkg_path = Path(__file__).parent.parent / "schemas" / "link-registry.json"
        if pkg_path.exists():
            return pkg_path

        # 2. Fallback to repo root (dev mode)
        current_file = Path(__file__)
        repo_root = current_file.parent.parent.parent.parent.parent
        return repo_root / "spec" / "schemas" / "link-registry.json"

    def _load_registry(self) -> None:
        """Load the link registry from JSON file."""
        if not self.registry_path.exists():
            raise FileNotFoundError(
                f"Link registry not found at {self.registry_path}. "
                "Run from repository root or specify registry_path."
            )

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
            )
            self.link_types[link_type.id] = link_type

        # Load categories
        self.categories = data.get("categories", {})

        # Load metadata
        self.metadata = data.get("metadata", {})

    def get_link_type(self, link_id: str) -> Optional[LinkType]:
        """Get a link type by ID.

        Args:
            link_id: The link type identifier

        Returns:
            LinkType object or None if not found
        """
        return self.link_types.get(link_id)

    def get_link_types_by_category(self, category: str) -> List[LinkType]:
        """Get all link types in a category.

        Args:
            category: Category name (e.g., "motivation", "business", "security")

        Returns:
            List of LinkType objects
        """
        return [link for link in self.link_types.values() if link.category == category]

    def get_link_types_by_source_layer(self, layer: str) -> List[LinkType]:
        """Get all link types that can originate from a layer.

        Args:
            layer: Layer identifier (e.g., "06-api", "09-ux")

        Returns:
            List of LinkType objects
        """
        return [link for link in self.link_types.values() if layer in link.source_layers]

    def get_link_types_by_target_layer(self, layer: str) -> List[LinkType]:
        """Get all link types that target a layer.

        Args:
            layer: Layer identifier (e.g., "01-motivation", "02-business")

        Returns:
            List of LinkType objects
        """
        return [link for link in self.link_types.values() if link.target_layer == layer]

    def find_link_type_by_field_path(self, field_path: str) -> Optional[LinkType]:
        """Find a link type by its field path.

        Args:
            field_path: Field path (e.g., "motivation.supports-goals", "x-archimate-ref")

        Returns:
            LinkType object or None if not found
        """
        for link in self.link_types.values():
            if link.matches_field_path(field_path):
                return link
        return None

    def get_all_link_types(self) -> List[LinkType]:
        """Get all link types in the registry.

        Returns:
            List of all LinkType objects
        """
        return list(self.link_types.values())

    def get_all_categories(self) -> Dict[str, Dict[str, Any]]:
        """Get all category definitions.

        Returns:
            Dictionary of category metadata
        """
        return self.categories

    def get_source_layers(self) -> Set[str]:
        """Get all unique source layers that have links.

        Returns:
            Set of layer identifiers
        """
        layers = set()
        for link in self.link_types.values():
            layers.update(link.source_layers)
        return layers

    def get_target_layers(self) -> Set[str]:
        """Get all unique target layers that can be referenced.

        Returns:
            Set of layer identifiers
        """
        return {link.target_layer for link in self.link_types.values()}

    def export_to_dict(self) -> Dict[str, Any]:
        """Export the entire registry as a dictionary.

        Returns:
            Dictionary representation of the registry
        """
        return {
            "linkTypes": [
                {
                    "id": link.id,
                    "name": link.name,
                    "category": link.category,
                    "sourceLayers": link.source_layers,
                    "targetLayer": link.target_layer,
                    "targetElementTypes": link.target_element_types,
                    "fieldPaths": link.field_paths,
                    "cardinality": link.cardinality,
                    "format": link.format,
                    "description": link.description,
                    "examples": link.examples,
                    "validationRules": link.validation_rules,
                }
                for link in self.link_types.values()
            ],
            "categories": self.categories,
            "metadata": self.metadata,
        }

    def export_to_json(self, indent: int = 2) -> str:
        """Export the registry as formatted JSON.

        Args:
            indent: Number of spaces for JSON indentation

        Returns:
            JSON string
        """
        return json.dumps(self.export_to_dict(), indent=indent)

    def export_to_markdown_table(self, category: Optional[str] = None) -> str:
        """Export link types as a markdown table.

        Args:
            category: Optional category to filter by

        Returns:
            Markdown formatted table
        """
        links = self.link_types.values()
        if category:
            links = [link for link in links if link.category == category]

        # Sort by category then name
        links = sorted(links, key=lambda x: (x.category, x.name))

        if not links:
            return "No link types found."

        lines = [
            "| ID | Name | Category | Source Layers | Target Layer | Format |",
            "|---|---|---|---|---|---|",
        ]

        for link in links:
            sources = ", ".join(link.source_layers)
            lines.append(
                f"| {link.id} | {link.name} | {link.category} | "
                f"{sources} | {link.target_layer} | {link.format} |"
            )

        return "\n".join(lines)

    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about the link registry.

        Returns:
            Dictionary with registry statistics
        """
        category_counts = {}
        for link in self.link_types.values():
            category_counts[link.category] = category_counts.get(link.category, 0) + 1

        format_counts = {}
        for link in self.link_types.values():
            format_counts[link.format] = format_counts.get(link.format, 0) + 1

        return {
            "total_link_types": len(self.link_types),
            "total_categories": len(self.categories),
            "category_counts": category_counts,
            "format_counts": format_counts,
            "source_layers": sorted(self.get_source_layers()),
            "target_layers": sorted(self.get_target_layers()),
            "version": self.metadata.get("version", "unknown"),
        }

    def __repr__(self) -> str:
        """String representation of the registry."""
        return (
            f"LinkRegistry(link_types={len(self.link_types)}, "
            f"categories={len(self.categories)})"
        )
