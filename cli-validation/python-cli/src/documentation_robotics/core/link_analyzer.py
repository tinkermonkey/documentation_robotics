"""Link Analyzer - Discovers and analyzes cross-layer links in the model.

This module provides the LinkAnalyzer class which scans loaded models,
discovers link instances, builds a graph of inter-layer connections,
and provides path-finding capabilities.
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from .link_registry import LinkRegistry, LinkType


@dataclass
class LinkInstance:
    """Represents a single discovered link instance in the model."""

    link_type: LinkType
    source_id: str
    source_layer: str
    source_element_type: str
    target_ids: List[str]  # Can be multiple for array links
    field_path: str
    source_file: Optional[str] = None

    @property
    def is_valid_format(self) -> bool:
        """Check if the link follows the expected format."""
        if self.link_type.cardinality == "array" and not isinstance(self.target_ids, list):
            return False
        if self.link_type.cardinality == "single" and len(self.target_ids) != 1:
            return False
        return True


@dataclass
class LinkPath:
    """Represents a path between two elements through links."""

    source_id: str
    target_id: str
    hops: List[LinkInstance]
    total_distance: int = field(init=False)

    def __post_init__(self):
        self.total_distance = len(self.hops)

    def get_path_description(self) -> str:
        """Get a human-readable description of the path."""
        if not self.hops:
            return f"{self.source_id} (no path to) {self.target_id}"

        parts = [self.source_id]
        for hop in self.hops:
            parts.append(f" --[{hop.link_type.name}]--> ")
            parts.append(hop.target_ids[0] if hop.target_ids else "?")

        return "".join(parts)


class LinkAnalyzer:
    """Analyzes cross-layer links in the loaded model.

    This class scans the model data structure, discovers all link instances,
    builds a multi-graph of connections, and provides analysis capabilities.
    """

    def __init__(self, link_registry: LinkRegistry):
        """Initialize the link analyzer.

        Args:
            link_registry: LinkRegistry instance with link definitions
        """
        self.registry = link_registry
        self.links: List[LinkInstance] = []
        self.links_by_source: Dict[str, List[LinkInstance]] = defaultdict(list)
        self.links_by_target: Dict[str, List[LinkInstance]] = defaultdict(list)
        self.links_by_type: Dict[str, List[LinkInstance]] = defaultdict(list)
        self.element_types: Dict[str, str] = {}  # element_id -> element_type

    def analyze_model(self, model_data: Dict[str, Any]) -> None:
        """Analyze a loaded model and discover all link instances.

        Args:
            model_data: Dictionary representation of the loaded model
        """
        self.links.clear()
        self.links_by_source.clear()
        self.links_by_target.clear()
        self.links_by_type.clear()
        self.element_types.clear()

        # Scan each layer in the model
        for layer_key, layer_data in model_data.items():
            if not isinstance(layer_data, dict):
                continue

            layer_id = self._extract_layer_id(layer_key)
            if layer_id:
                self._scan_layer(layer_id, layer_data)

    def _extract_layer_id(self, layer_key: str) -> Optional[str]:
        """Extract layer ID from layer key.

        Args:
            layer_key: Key like "01-motivation", "06-api", etc.

        Returns:
            Layer ID or None
        """
        # Match patterns like "01-motivation-layer", "06-api-layer", etc.
        if "-" in layer_key:
            parts = layer_key.split("-")
            if len(parts) >= 2 and parts[0].isdigit():
                # Reconstruct as "01-motivation", "06-api", etc.
                return f"{parts[0]}-{parts[1]}"
        return None

    def _scan_layer(self, layer_id: str, layer_data: Dict[str, Any]) -> None:
        """Scan a layer for link instances.

        Args:
            layer_id: Layer identifier (e.g., "06-api")
            layer_data: Layer data dictionary
        """
        # Get link types that can originate from this layer
        possible_links = self.registry.get_link_types_by_source_layer(layer_id)

        # Scan elements in the layer (track all elements, not just those with outgoing links)
        for element_collection_key, elements in layer_data.items():
            if not isinstance(elements, list):
                continue

            for element in elements:
                if not isinstance(element, dict):
                    continue

                element_id = element.get("id")
                if not element_id:
                    continue

                # Track element type (track all elements for validation)
                element_type = self._infer_element_type(element_collection_key)
                self.element_types[element_id] = element_type

                # Scan for links in this element only if this layer has outgoing links
                if not possible_links:
                    continue
                self._scan_element(
                    element_id=element_id,
                    element_type=element_type,
                    source_layer=layer_id,
                    element_data=element,
                    possible_links=possible_links,
                )

    def _infer_element_type(self, collection_key: str) -> str:
        """Infer element type from collection key.

        Args:
            collection_key: Key like "goals", "businessServices", "routes"

        Returns:
            Element type string
        """
        # Convert plural to singular and PascalCase
        # This is a simplification - real implementation might need mapping
        type_name = collection_key.rstrip("s")
        return type_name[0].upper() + type_name[1:] if type_name else "Unknown"

    def _scan_element(
        self,
        element_id: str,
        element_type: str,
        source_layer: str,
        element_data: Dict[str, Any],
        possible_links: List[LinkType],
    ) -> None:
        """Scan an element for link instances.

        Args:
            element_id: Element identifier
            element_type: Element type
            source_layer: Source layer ID
            element_data: Element data dictionary
            possible_links: List of possible link types from this layer
        """
        for link_type in possible_links:
            for field_path in link_type.field_paths:
                targets = self._extract_link_targets(element_data, field_path)
                # Create link instance for empty arrays too (validator will flag them)
                if targets is not None:
                    link_instance = LinkInstance(
                        link_type=link_type,
                        source_id=element_id,
                        source_layer=source_layer,
                        source_element_type=element_type,
                        target_ids=targets if isinstance(targets, list) else [targets],
                        field_path=field_path,
                    )
                    self._register_link(link_instance)

    def _extract_link_targets(self, data: Dict[str, Any], field_path: str) -> Optional[Any]:
        """Extract link target value(s) from element data.

        Args:
            data: Element data dictionary
            field_path: Field path (supports dot notation)

        Returns:
            Target ID(s) or None if not found
        """
        # Handle dot notation (e.g., "motivation.supports-goals")
        parts = field_path.split(".")
        current = data

        for part in parts:
            if not isinstance(current, dict):
                return None
            current = current.get(part)
            if current is None:
                return None

        return current

    def _register_link(self, link: LinkInstance) -> None:
        """Register a discovered link instance.

        Args:
            link: LinkInstance to register
        """
        self.links.append(link)
        self.links_by_source[link.source_id].append(link)
        self.links_by_type[link.link_type.id].append(link)

        # Register reverse lookups for each target
        for target_id in link.target_ids:
            self.links_by_target[target_id].append(link)

    def get_links_from(
        self, element_id: str, link_type: Optional[str] = None
    ) -> List[LinkInstance]:
        """Get all links originating from an element.

        Args:
            element_id: Source element ID
            link_type: Optional link type ID to filter by

        Returns:
            List of LinkInstance objects
        """
        links = self.links_by_source.get(element_id, [])
        if link_type:
            links = [link for link in links if link.link_type.id == link_type]
        return links

    def get_links_to(self, element_id: str, link_type: Optional[str] = None) -> List[LinkInstance]:
        """Get all links targeting an element.

        Args:
            element_id: Target element ID
            link_type: Optional link type ID to filter by

        Returns:
            List of LinkInstance objects
        """
        links = self.links_by_target.get(element_id, [])
        if link_type:
            links = [link for link in links if link.link_type.id == link_type]
        return links

    def get_links_by_type(self, link_type_id: str) -> List[LinkInstance]:
        """Get all links of a specific type.

        Args:
            link_type_id: Link type identifier

        Returns:
            List of LinkInstance objects
        """
        return self.links_by_type.get(link_type_id, [])

    def get_connected_elements(self, element_id: str, direction: str = "both") -> Set[str]:
        """Get all element IDs connected to an element.

        Args:
            element_id: Element to find connections for
            direction: "up" (incoming), "down" (outgoing), or "both"

        Returns:
            Set of connected element IDs
        """
        connected = set()

        if direction in ("down", "both"):
            for link in self.links_by_source.get(element_id, []):
                connected.update(link.target_ids)

        if direction in ("up", "both"):
            for link in self.links_by_target.get(element_id, []):
                connected.add(link.source_id)

        return connected

    def find_path(self, source_id: str, target_id: str, max_hops: int = 10) -> Optional[LinkPath]:
        """Find a path between two elements through links.

        Args:
            source_id: Source element ID
            target_id: Target element ID
            max_hops: Maximum number of hops to search

        Returns:
            LinkPath object or None if no path found
        """
        if source_id == target_id:
            return LinkPath(source_id=source_id, target_id=target_id, hops=[])

        # BFS to find shortest path
        queue = deque([(source_id, [])])
        visited = {source_id}

        while queue:
            current_id, path = queue.popleft()

            if len(path) >= max_hops:
                continue

            # Explore outgoing links
            for link in self.links_by_source.get(current_id, []):
                for next_id in link.target_ids:
                    if next_id == target_id:
                        # Found path!
                        return LinkPath(
                            source_id=source_id, target_id=target_id, hops=path + [link]
                        )

                    if next_id not in visited:
                        visited.add(next_id)
                        queue.append((next_id, path + [link]))

        return None  # No path found

    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about discovered links.

        Returns:
            Dictionary with link statistics
        """
        stats = {
            "total_links": len(self.links),
            "total_elements": len(self.element_types),
            "elements_with_outgoing_links": len(self.links_by_source),
            "elements_with_incoming_links": len(self.links_by_target),
            "links_by_type": {
                link_type_id: len(links) for link_type_id, links in self.links_by_type.items()
            },
            "links_by_category": defaultdict(int),
        }

        # Count by category
        for link in self.links:
            stats["links_by_category"][link.link_type.category] += 1

        stats["links_by_category"] = dict(stats["links_by_category"])

        return stats

    def find_broken_links(self) -> List[Tuple[LinkInstance, List[str]]]:
        """Find links that reference non-existent elements.

        Returns:
            List of (LinkInstance, missing_target_ids) tuples
        """
        broken = []

        for link in self.links:
            missing = [
                target_id for target_id in link.target_ids if target_id not in self.element_types
            ]
            if missing:
                broken.append((link, missing))

        return broken

    def get_orphaned_elements(self) -> List[str]:
        """Find elements with no incoming or outgoing links.

        Returns:
            List of element IDs that are orphaned
        """
        linked_elements = set(self.links_by_source.keys()) | set(self.links_by_target.keys())
        all_elements = set(self.element_types.keys())
        return list(all_elements - linked_elements)

    def __repr__(self) -> str:
        """String representation of the analyzer."""
        return f"LinkAnalyzer(links={len(self.links)}, " f"elements={len(self.element_types)})"
