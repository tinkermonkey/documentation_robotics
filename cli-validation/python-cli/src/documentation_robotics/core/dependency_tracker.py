"""
Dependency tracker - analyzes dependencies between elements.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Set

import networkx as nx

from .reference_registry import ReferenceRegistry


class TraceDirection(Enum):
    """Direction to trace dependencies."""

    UP = "up"  # Find what this depends on
    DOWN = "down"  # Find what depends on this
    BOTH = "both"  # Both directions


@dataclass
class DependencyPath:
    """Represents a dependency path between two elements."""

    source: str
    target: str
    path: List[str]
    depth: int
    relationship_types: List[str]


class DependencyTracker:
    """
    Tracks and analyzes dependencies between elements.

    Uses reference registry and graph algorithms to provide
    dependency analysis and impact assessment.
    """

    def __init__(self, model: Any):
        """
        Initialize dependency tracker.

        Args:
            model: The architecture model
        """
        self.model = model
        self.registry = ReferenceRegistry()
        self._build_registry()

    def _build_registry(self) -> None:
        """Build reference registry from model."""
        for layer in self.model.layers.values():
            for element in layer.elements.values():
                self.registry.register_element(element)

    def trace_dependencies(
        self,
        element_id: str,
        direction: TraceDirection = TraceDirection.BOTH,
        max_depth: Optional[int] = None,
    ) -> List[Any]:
        """
        Trace dependencies from an element.

        Args:
            element_id: Element ID to start from
            direction: Direction to trace (up, down, both)
            max_depth: Maximum depth to trace

        Returns:
            List of dependent elements
        """
        graph = self.registry.get_dependency_graph()

        if element_id not in graph:
            return []

        dependencies = set()

        # Trace upward (what this element depends on)
        if direction in [TraceDirection.UP, TraceDirection.BOTH]:
            dependencies.update(self._trace_up(graph, element_id, max_depth))

        # Trace downward (what depends on this element)
        if direction in [TraceDirection.DOWN, TraceDirection.BOTH]:
            dependencies.update(self._trace_down(graph, element_id, max_depth))

        # Convert IDs to Elements
        elements = []
        for dep_id in dependencies:
            element = self.model.get_element(dep_id)
            if element:
                elements.append(element)

        return elements

    def _trace_up(self, graph: nx.DiGraph, element_id: str, max_depth: Optional[int]) -> Set[str]:
        """Trace upward dependencies (what element depends on)."""
        if max_depth is None:
            # Get all descendants (what this points to / depends on)
            return nx.descendants(graph, element_id)
        else:
            # Get descendants within depth
            descendants = set()
            current_level = {element_id}

            for _ in range(max_depth):
                next_level = set()
                for node in current_level:
                    if node in graph:
                        next_level.update(graph.successors(node))
                descendants.update(next_level)
                current_level = next_level
                if not current_level:
                    break

            return descendants

    def _trace_down(self, graph: nx.DiGraph, element_id: str, max_depth: Optional[int]) -> Set[str]:
        """Trace downward dependencies (what depends on element)."""
        if max_depth is None:
            # Get all ancestors (what points to this / depends on this)
            return nx.ancestors(graph, element_id)
        else:
            # Get ancestors within depth
            ancestors = set()
            current_level = {element_id}

            for _ in range(max_depth):
                next_level = set()
                for node in current_level:
                    if node in graph:
                        next_level.update(graph.predecessors(node))
                ancestors.update(next_level)
                current_level = next_level
                if not current_level:
                    break

            return ancestors

    def find_dependency_paths(
        self, source_id: str, target_id: str, max_paths: int = 10
    ) -> List[DependencyPath]:
        """
        Find all dependency paths between two elements.

        Args:
            source_id: Source element ID
            target_id: Target element ID
            max_paths: Maximum number of paths to return

        Returns:
            List of dependency paths
        """
        graph = self.registry.get_dependency_graph()

        if source_id not in graph or target_id not in graph:
            return []

        try:
            # Find all simple paths
            paths = list(nx.all_simple_paths(graph, source_id, target_id, cutoff=max_paths))

            # Convert to DependencyPath objects
            dependency_paths = []
            for path in paths[:max_paths]:
                # Get relationship types along path
                rel_types = []
                for i in range(len(path) - 1):
                    edge_data = graph.get_edge_data(path[i], path[i + 1])
                    rel_types.append(edge_data.get("type", "unknown") if edge_data else "unknown")

                dependency_paths.append(
                    DependencyPath(
                        source=source_id,
                        target=target_id,
                        path=path,
                        depth=len(path) - 1,
                        relationship_types=rel_types,
                    )
                )

            return dependency_paths

        except nx.NetworkXNoPath:
            return []

    def get_dependency_layers(self, element_id: str) -> Dict[str, List[str]]:
        """
        Get dependencies organized by layer.

        Args:
            element_id: Element ID

        Returns:
            Dictionary mapping layer name to list of dependent element IDs
        """
        dependencies = self.trace_dependencies(element_id, TraceDirection.BOTH)

        by_layer: Dict[str, List[str]] = {}

        for dep in dependencies:
            if dep.layer not in by_layer:
                by_layer[dep.layer] = []
            by_layer[dep.layer].append(dep.id)

        return by_layer

    def get_orphaned_elements(self) -> List[Any]:
        """
        Find elements with no references (incoming or outgoing).

        Returns:
            List of orphaned elements
        """
        graph = self.registry.get_dependency_graph()
        orphaned = []

        for layer in self.model.layers.values():
            for element in layer.elements.values():
                if element.id not in graph:
                    orphaned.append(element)
                elif graph.degree(element.id) == 0:
                    orphaned.append(element)

        return orphaned

    def get_hub_elements(self, threshold: int = 10) -> List[tuple]:
        """
        Find hub elements (elements with many connections).

        Args:
            threshold: Minimum number of connections to be considered a hub

        Returns:
            List of (element_id, connection_count) tuples
        """
        graph = self.registry.get_dependency_graph()
        hubs = []

        for node in graph.nodes():
            degree = graph.degree(node)
            if degree >= threshold:
                hubs.append((node, degree))

        # Sort by degree descending
        hubs.sort(key=lambda x: x[1], reverse=True)

        return hubs
