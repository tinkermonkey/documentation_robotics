"""Ontology Query Engine - Query relationships across layers.

This module provides a powerful query engine for traversing and analyzing
relationships in the Documentation Robotics ontology.

Supports:
- Direct queries (find_links_from, find_links_to)
- Transitive queries (find_all_dependencies, trace_to_goals)
- Pattern matching (find_elements_with_predicate)
- Graph traversal (shortest_path, all_paths)
- Simple query DSL for complex queries
"""

import re
import sys
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


@dataclass
class QueryResult:
    """Result of a query operation."""

    query: str
    result_type: str  # "elements", "links", "paths", "count"
    results: List[Any]
    count: int
    metadata: Dict[str, Any]


@dataclass
class GraphPath:
    """A path through the relationship graph."""

    elements: List[str]
    relationships: List[str]
    length: int


class OntologyQueryEngine:
    """Query engine for ontology relationships."""

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize the query engine.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.registry = LinkRegistry()

        # Build relationship graph
        self.graph = self._build_graph()

    def _find_spec_root(self) -> Path:
        """Auto-detect spec root directory."""
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

        if not spec_root.exists() or not (spec_root / "layers").exists():
            raise FileNotFoundError(
                f"Could not find spec/layers directory at {spec_root}. "
                "Run from repository root."
            )

        return spec_root

    def _build_graph(self) -> Dict[str, Dict[str, List[str]]]:
        """Build relationship graph from link registry.

        Returns:
            Dictionary mapping source_layer -> {target_layer: [link_type_ids]}
        """
        graph = defaultdict(lambda: defaultdict(list))

        for link_type in self.registry.link_types.values():
            for source_layer in link_type.source_layers:
                target_layer = link_type.target_layer
                graph[source_layer][target_layer].append(link_type.id)

        return dict(graph)

    # Direct query methods

    def find_links_from_layer(self, source_layer: str, predicate: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find all links originating from a layer.

        Args:
            source_layer: Source layer ID (e.g., "02-business")
            predicate: Optional predicate filter

        Returns:
            List of link type dictionaries
        """
        links = self.registry.get_links_by_source_layer(source_layer)

        if predicate:
            links = [lt for lt in links if lt.predicate == predicate]

        return [
            {
                "id": lt.id,
                "name": lt.name,
                "predicate": lt.predicate,
                "source_layers": lt.source_layers,
                "target_layer": lt.target_layer,
                "field_paths": lt.field_paths,
            }
            for lt in links
        ]

    def find_links_to_layer(self, target_layer: str, predicate: Optional[str] = None) -> List[Dict[str, Any]]:
        """Find all links targeting a layer.

        Args:
            target_layer: Target layer ID (e.g., "01-motivation")
            predicate: Optional predicate filter

        Returns:
            List of link type dictionaries
        """
        links = self.registry.get_links_by_target_layer(target_layer)

        if predicate:
            links = [lt for lt in links if lt.predicate == predicate]

        return [
            {
                "id": lt.id,
                "name": lt.name,
                "predicate": lt.predicate,
                "source_layers": lt.source_layers,
                "target_layer": lt.target_layer,
                "field_paths": lt.field_paths,
            }
            for lt in links
        ]

    def find_links_between(
        self, source_layer: str, target_layer: str, predicate: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find links between two specific layers.

        Args:
            source_layer: Source layer ID
            target_layer: Target layer ID
            predicate: Optional predicate filter

        Returns:
            List of link type dictionaries
        """
        links = self.registry.find_links_between(source_layer, target_layer)

        if predicate:
            links = [lt for lt in links if lt.predicate == predicate]

        return [
            {
                "id": lt.id,
                "name": lt.name,
                "predicate": lt.predicate,
                "field_paths": lt.field_paths,
            }
            for lt in links
        ]

    def find_elements_with_predicate(
        self, predicate: str, source_layer: Optional[str] = None, target_layer: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Find all elements that use a specific predicate.

        Args:
            predicate: Predicate to search for
            source_layer: Optional source layer filter
            target_layer: Optional target layer filter

        Returns:
            List of link types matching criteria
        """
        links = self.registry.find_links_by_predicate(predicate)

        if source_layer:
            links = [lt for lt in links if source_layer in lt.source_layers]

        if target_layer:
            links = [lt for lt in links if lt.target_layer == target_layer]

        return [
            {
                "id": lt.id,
                "name": lt.name,
                "predicate": lt.predicate,
                "inverse_predicate": lt.inverse_predicate,
                "source_layers": lt.source_layers,
                "target_layer": lt.target_layer,
            }
            for lt in links
        ]

    # Transitive query methods

    def trace_to_goals(self, source_layer: str) -> List[GraphPath]:
        """Trace from a layer to motivation goals.

        Args:
            source_layer: Starting layer

        Returns:
            All paths from source layer to motivation goals
        """
        return self.find_all_paths(source_layer, "01-motivation", predicate="supports-goals")

    def trace_to_requirements(self, source_layer: str) -> List[GraphPath]:
        """Trace from a layer to motivation requirements.

        Args:
            source_layer: Starting layer

        Returns:
            All paths from source layer to motivation requirements
        """
        return self.find_all_paths(source_layer, "01-motivation", predicate="fulfills-requirements")

    def find_all_dependencies(self, source_layer: str, max_depth: int = 5) -> Dict[str, List[str]]:
        """Find all transitive dependencies from a layer.

        Args:
            source_layer: Starting layer
            max_depth: Maximum traversal depth

        Returns:
            Dictionary mapping depth -> list of dependent layers
        """
        visited = set()
        dependencies = defaultdict(list)

        queue = deque([(source_layer, 0)])
        visited.add(source_layer)

        while queue:
            current, depth = queue.popleft()

            if depth >= max_depth:
                continue

            # Find all layers this layer links to
            if current in self.graph:
                for target_layer in self.graph[current].keys():
                    if target_layer not in visited:
                        visited.add(target_layer)
                        dependencies[depth + 1].append(target_layer)
                        queue.append((target_layer, depth + 1))

        return dict(dependencies)

    # Graph traversal methods

    def shortest_path(self, source_layer: str, target_layer: str, predicate: Optional[str] = None) -> Optional[GraphPath]:
        """Find shortest path between two layers.

        Args:
            source_layer: Starting layer
            target_layer: Destination layer
            predicate: Optional predicate filter

        Returns:
            Shortest path or None if no path exists
        """
        if source_layer == target_layer:
            return GraphPath(elements=[source_layer], relationships=[], length=0)

        visited = set()
        queue = deque([(source_layer, [source_layer], [])])
        visited.add(source_layer)

        while queue:
            current, path, relationships = queue.popleft()

            if current in self.graph:
                for next_layer, link_ids in self.graph[current].items():
                    if next_layer in visited:
                        continue

                    # Filter by predicate if specified
                    valid_links = link_ids
                    if predicate:
                        valid_links = [
                            lid for lid in link_ids
                            if self.registry.link_types[lid].predicate == predicate
                        ]

                    if not valid_links:
                        continue

                    new_path = path + [next_layer]
                    new_relationships = relationships + [valid_links[0]]

                    if next_layer == target_layer:
                        return GraphPath(
                            elements=new_path,
                            relationships=new_relationships,
                            length=len(new_path) - 1
                        )

                    visited.add(next_layer)
                    queue.append((next_layer, new_path, new_relationships))

        return None

    def find_all_paths(
        self, source_layer: str, target_layer: str, predicate: Optional[str] = None, max_length: int = 5
    ) -> List[GraphPath]:
        """Find all paths between two layers.

        Args:
            source_layer: Starting layer
            target_layer: Destination layer
            predicate: Optional predicate filter
            max_length: Maximum path length

        Returns:
            List of all paths found
        """
        if source_layer == target_layer:
            return [GraphPath(elements=[source_layer], relationships=[], length=0)]

        paths = []

        def dfs(current: str, path: List[str], relationships: List[str], visited: Set[str]):
            if len(path) > max_length:
                return

            if current == target_layer:
                paths.append(GraphPath(
                    elements=path.copy(),
                    relationships=relationships.copy(),
                    length=len(path) - 1
                ))
                return

            if current not in self.graph:
                return

            for next_layer, link_ids in self.graph[current].items():
                if next_layer in visited:
                    continue

                # Filter by predicate if specified
                valid_links = link_ids
                if predicate:
                    valid_links = [
                        lid for lid in link_ids
                        if self.registry.link_types[lid].predicate == predicate
                    ]

                if not valid_links:
                    continue

                visited.add(next_layer)
                path.append(next_layer)
                relationships.append(valid_links[0])

                dfs(next_layer, path, relationships, visited)

                path.pop()
                relationships.pop()
                visited.remove(next_layer)

        visited_set = {source_layer}
        dfs(source_layer, [source_layer], [], visited_set)

        return paths

    # Query DSL methods

    def execute_query(self, query_string: str) -> QueryResult:
        """Execute a query using simple DSL.

        Query Format Examples:
        - FIND Goals SUPPORTED-BY ApplicationService
        - TRACE Requirement FULFILLED-BY * TO Operation
        - PATH FROM Goal TO APIOperation
        - COUNT links FROM layer='06-api' TO layer='01-motivation'

        Args:
            query_string: Query string in DSL format

        Returns:
            QueryResult with results
        """
        query_string = query_string.strip()

        # Parse FIND queries
        find_match = re.match(
            r'FIND\s+(\w+)\s+(\w+(?:-\w+)*)\s+(\w+)(?:\s+WHERE\s+layer=[\'"]([\w-]+)[\'"])?',
            query_string,
            re.IGNORECASE
        )
        if find_match:
            target_type, predicate, source_type, layer_filter = find_match.groups()
            predicate = predicate.lower().replace("_", "-")

            results = self.find_elements_with_predicate(
                predicate,
                source_layer=layer_filter
            )

            return QueryResult(
                query=query_string,
                result_type="elements",
                results=results,
                count=len(results),
                metadata={"predicate": predicate}
            )

        # Parse PATH queries
        path_match = re.match(
            r'PATH\s+FROM\s+([\w-]+)\s+TO\s+([\w-]+)',
            query_string,
            re.IGNORECASE
        )
        if path_match:
            source, target = path_match.groups()
            path = self.shortest_path(source, target)

            return QueryResult(
                query=query_string,
                result_type="paths",
                results=[path] if path else [],
                count=1 if path else 0,
                metadata={"source": source, "target": target}
            )

        # Parse COUNT queries
        count_match = re.match(
            r'COUNT\s+links\s+FROM\s+layer=[\'"]([\w-]+)[\'"]\s+TO\s+layer=[\'"]([\w-]+)[\'"]',
            query_string,
            re.IGNORECASE
        )
        if count_match:
            source, target = count_match.groups()
            links = self.find_links_between(source, target)

            return QueryResult(
                query=query_string,
                result_type="count",
                results=links,
                count=len(links),
                metadata={"source_layer": source, "target_layer": target}
            )

        # Unknown query format
        return QueryResult(
            query=query_string,
            result_type="error",
            results=[],
            count=0,
            metadata={"error": "Unknown query format"}
        )

    # Statistics methods

    def get_connectivity_stats(self) -> Dict[str, Any]:
        """Get connectivity statistics for the ontology graph.

        Returns:
            Dictionary with connectivity metrics
        """
        total_layers = len(set(self.graph.keys()) | set(
            target for targets in self.graph.values() for target in targets.keys()
        ))

        total_edges = sum(
            len(targets) for targets in self.graph.values()
        )

        # Calculate connectivity matrix
        connectivity_matrix = {}
        for source in self.graph:
            for target in self.graph[source]:
                connectivity_matrix[(source, target)] = len(self.graph[source][target])

        # Most connected layers
        outgoing_connections = defaultdict(int)
        incoming_connections = defaultdict(int)

        for source, targets in self.graph.items():
            outgoing_connections[source] = len(targets)
            for target in targets:
                incoming_connections[target] += 1

        return {
            "total_layers": total_layers,
            "total_layer_connections": total_edges,
            "total_link_types": len(self.registry.link_types),
            "most_connected_outgoing": sorted(
                outgoing_connections.items(),
                key=lambda x: x[1],
                reverse=True
            )[:5],
            "most_connected_incoming": sorted(
                incoming_connections.items(),
                key=lambda x: x[1],
                reverse=True
            )[:5],
            "connectivity_matrix": connectivity_matrix,
        }
