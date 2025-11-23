"""
Reference registry - tracks and validates cross-layer references.
"""

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import yaml


@dataclass
class Reference:
    """Represents a reference from one element to another."""

    source_id: str  # Element making the reference
    target_id: str  # Element being referenced
    property_path: str  # Path to the reference property (e.g., "realizes", "data.schemaRef")
    reference_type: str  # Type of reference (realizes, serves, accesses, etc.)
    required: bool = True  # Whether this reference is required to exist

    def __hash__(self):
        return hash((self.source_id, self.target_id, self.property_path))

    def __eq__(self, other):
        if not isinstance(other, Reference):
            return False
        return (
            self.source_id == other.source_id
            and self.target_id == other.target_id
            and self.property_path == other.property_path
        )


@dataclass
class ReferenceDefinition:
    """Defines expected references for a layer/element type."""

    layer: str
    element_type: str
    property_path: str
    target_layer: str
    target_type: Optional[str]
    reference_type: str
    required: bool
    cardinality: str  # "1", "0..1", "1..*", "0..*"


class ReferenceRegistry:
    """
    Manages all cross-layer references in the model.

    Responsibilities:
    - Track all references between elements
    - Validate reference integrity
    - Find dependencies and dependents
    - Support impact analysis
    """

    def __init__(self):
        """Initialize the reference registry."""
        self.references: List[Reference] = []
        self.reference_definitions: List[ReferenceDefinition] = []
        self._source_index: Dict[str, List[Reference]] = defaultdict(list)
        self._target_index: Dict[str, List[Reference]] = defaultdict(list)
        self._type_index: Dict[str, List[Reference]] = defaultdict(list)

    def load_reference_definitions(self, schema_dir: Path) -> None:
        """
        Load reference definitions from schema files.

        Args:
            schema_dir: Directory containing layer schemas
        """
        # Load from federated-architecture.schema.json if it exists
        master_schema_path = schema_dir / "federated-architecture.schema.json"
        if master_schema_path.exists():
            import json

            with open(master_schema_path, "r") as f:
                schema = json.load(f)
                self._extract_reference_definitions(schema)

    def _extract_reference_definitions(self, schema: dict) -> None:
        """Extract reference definitions from master schema."""
        if "properties" not in schema:
            return

        # Extract from cross-layer references section
        cross_layer = schema.get("crossLayerReferences", [])
        for ref_def in cross_layer:
            self.reference_definitions.append(
                ReferenceDefinition(
                    layer=ref_def.get("sourceLayer"),
                    element_type=ref_def.get("sourceType"),
                    property_path=ref_def.get("propertyPath"),
                    target_layer=ref_def.get("targetLayer"),
                    target_type=ref_def.get("targetType"),
                    reference_type=ref_def.get("referenceType"),
                    required=ref_def.get("required", False),
                    cardinality=ref_def.get("cardinality", "0..*"),
                )
            )

    def register_element(self, element: Any) -> None:
        """
        Register all references in an element.

        Args:
            element: Element to scan for references
        """
        refs = self._extract_references(element)
        for ref in refs:
            self.add_reference(ref)

    def _extract_references(self, element: Any) -> List[Reference]:
        """
        Extract all references from an element's data.

        Args:
            element: Element to extract from

        Returns:
            List of Reference objects
        """
        references = []

        # Common reference property names
        ref_properties = [
            "realizes",
            "realizedBy",
            "serves",
            "servedBy",
            "accesses",
            "accessedBy",
            "uses",
            "usedBy",
            "composedOf",
            "partOf",
            "flows",
            "triggers",
            "archimateRef",
            "businessActorRef",
            "stakeholderRef",
            "motivationGoalRef",
            "dataObjectRef",
            "apiOperationRef",
            "applicationServiceRef",
            "schemaRef",
        ]

        # Scan element data for references
        for prop_name in ref_properties:
            if prop_name in element.data:
                value = element.data[prop_name]

                # Handle single reference
                if isinstance(value, str):
                    references.append(
                        Reference(
                            source_id=element.id,
                            target_id=value,
                            property_path=prop_name,
                            reference_type=self._infer_reference_type(prop_name),
                            required=True,
                        )
                    )

                # Handle list of references
                elif isinstance(value, list):
                    for target_id in value:
                        if isinstance(target_id, str):
                            references.append(
                                Reference(
                                    source_id=element.id,
                                    target_id=target_id,
                                    property_path=prop_name,
                                    reference_type=self._infer_reference_type(prop_name),
                                    required=False,
                                )
                            )

        # Scan nested structures
        references.extend(self._scan_nested_references(element, element.data))

        return references

    def _scan_nested_references(self, element: Any, data: dict, path: str = "") -> List[Reference]:
        """Recursively scan nested structures for references."""
        references = []

        if not isinstance(data, dict):
            return references

        for key, value in data.items():
            current_path = f"{path}.{key}" if path else key

            # Look for reference patterns
            if key.endswith("Ref") or key.endswith("Reference"):
                if isinstance(value, str):
                    references.append(
                        Reference(
                            source_id=element.id,
                            target_id=value,
                            property_path=current_path,
                            reference_type=self._infer_reference_type(key),
                            required=False,
                        )
                    )
                elif isinstance(value, list):
                    for target_id in value:
                        if isinstance(target_id, str):
                            references.append(
                                Reference(
                                    source_id=element.id,
                                    target_id=target_id,
                                    property_path=current_path,
                                    reference_type=self._infer_reference_type(key),
                                    required=False,
                                )
                            )

            # Recurse into nested dicts
            elif isinstance(value, dict):
                references.extend(self._scan_nested_references(element, value, current_path))

        return references

    def _infer_reference_type(self, property_name: str) -> str:
        """Infer reference type from property name."""
        type_map = {
            "realizes": "realization",
            "realizedBy": "realization",
            "serves": "serving",
            "servedBy": "serving",
            "accesses": "access",
            "accessedBy": "access",
            "uses": "usage",
            "usedBy": "usage",
            "composedOf": "composition",
            "partOf": "composition",
            "flows": "flow",
            "triggers": "triggering",
        }

        return type_map.get(property_name, "association")

    def add_reference(self, reference: Reference) -> None:
        """
        Add a reference to the registry.

        Args:
            reference: Reference to add
        """
        self.references.append(reference)

        # Update indexes
        self._source_index[reference.source_id].append(reference)
        self._target_index[reference.target_id].append(reference)
        self._type_index[reference.reference_type].append(reference)

    def remove_reference(self, source_id: str, target_id: str) -> None:
        """
        Remove a reference from the registry.

        Args:
            source_id: Source element ID
            target_id: Target element ID
        """
        # Remove from main list
        self.references = [
            r
            for r in self.references
            if not (r.source_id == source_id and r.target_id == target_id)
        ]

        # Rebuild indexes
        self._rebuild_indexes()

    def _rebuild_indexes(self) -> None:
        """Rebuild all indexes."""
        self._source_index.clear()
        self._target_index.clear()
        self._type_index.clear()

        for ref in self.references:
            self._source_index[ref.source_id].append(ref)
            self._target_index[ref.target_id].append(ref)
            self._type_index[ref.reference_type].append(ref)

    def get_references_from(self, element_id: str) -> List[Reference]:
        """
        Get all references from an element.

        Args:
            element_id: Element ID

        Returns:
            List of references originating from the element
        """
        return self._source_index.get(element_id, [])

    def get_references_to(self, element_id: str) -> List[Reference]:
        """
        Get all references to an element.

        Args:
            element_id: Element ID

        Returns:
            List of references pointing to the element
        """
        return self._target_index.get(element_id, [])

    def get_references_by_type(self, reference_type: str) -> List[Reference]:
        """
        Get all references of a specific type.

        Args:
            reference_type: Type of reference

        Returns:
            List of references of that type
        """
        return self._type_index.get(reference_type, [])

    def find_broken_references(self, valid_element_ids: Set[str]) -> List[Reference]:
        """
        Find all references pointing to non-existent elements.

        Args:
            valid_element_ids: Set of all valid element IDs

        Returns:
            List of broken references
        """
        broken = []

        for ref in self.references:
            if ref.target_id not in valid_element_ids:
                broken.append(ref)

        return broken

    def find_missing_references(self, element: Any) -> List[Tuple[ReferenceDefinition, str]]:
        """
        Find missing required references for an element.

        Args:
            element: Element to check

        Returns:
            List of (definition, reason) tuples for missing references
        """
        missing = []

        # Find applicable reference definitions
        for ref_def in self.reference_definitions:
            if ref_def.layer != element.layer:
                continue
            if ref_def.element_type and ref_def.element_type != element.type:
                continue

            # Check if reference exists
            existing = [
                r
                for r in self._source_index.get(element.id, [])
                if r.property_path == ref_def.property_path
            ]

            # Check cardinality
            if ref_def.required and len(existing) == 0:
                missing.append((ref_def, "Required reference is missing"))
            elif ref_def.cardinality == "1" and len(existing) != 1:
                missing.append((ref_def, f"Expected exactly 1 reference, found {len(existing)}"))
            elif ref_def.cardinality == "1..*" and len(existing) == 0:
                missing.append((ref_def, "Expected at least 1 reference, found 0"))

        return missing

    def get_dependency_graph(self) -> "networkx.DiGraph":
        """
        Build a dependency graph from all references.

        Returns:
            NetworkX directed graph
        """
        import networkx as nx

        graph = nx.DiGraph()

        for ref in self.references:
            graph.add_edge(
                ref.source_id, ref.target_id, type=ref.reference_type, property=ref.property_path
            )

        return graph

    def find_circular_dependencies(self) -> List[List[str]]:
        """
        Find circular dependencies in the model.

        Returns:
            List of cycles (each cycle is a list of element IDs)
        """
        import networkx as nx

        graph = self.get_dependency_graph()

        try:
            cycles = list(nx.simple_cycles(graph))
            return cycles
        except Exception:
            return []

    def get_impact_analysis(self, element_id: str, max_depth: Optional[int] = None) -> Set[str]:
        """
        Get all elements that would be impacted by changing/removing an element.

        Args:
            element_id: Element ID to analyze
            max_depth: Maximum depth to traverse (None = unlimited)

        Returns:
            Set of impacted element IDs
        """
        import networkx as nx

        graph = self.get_dependency_graph()

        # Get all elements that reference this element (directly or indirectly)
        impacted = set()

        if element_id not in graph:
            return impacted

        # Reverse graph to find dependents
        reverse_graph = graph.reverse()

        # BFS to find all dependents
        if max_depth is None:
            # Get all reachable nodes
            impacted = nx.descendants(reverse_graph, element_id)
        else:
            # Get nodes within depth
            current_level = {element_id}
            for _ in range(max_depth):
                next_level = set()
                for node in current_level:
                    if node in reverse_graph:
                        next_level.update(reverse_graph.successors(node))
                impacted.update(next_level)
                current_level = next_level
                if not current_level:
                    break

        return impacted

    def save(self, path: Path) -> None:
        """
        Save reference registry to file.

        Args:
            path: Path to save to
        """
        data = {
            "references": [
                {
                    "source": ref.source_id,
                    "target": ref.target_id,
                    "property": ref.property_path,
                    "type": ref.reference_type,
                    "required": ref.required,
                }
                for ref in self.references
            ]
        }

        with open(path, "w") as f:
            yaml.dump(data, f, default_flow_style=False)

    @classmethod
    def load(cls, path: Path) -> "ReferenceRegistry":
        """
        Load reference registry from file.

        Args:
            path: Path to load from

        Returns:
            ReferenceRegistry instance
        """
        registry = cls()

        if not path.exists():
            return registry

        with open(path, "r") as f:
            data = yaml.safe_load(f)

        if not data or "references" not in data:
            return registry

        for ref_data in data["references"]:
            registry.add_reference(
                Reference(
                    source_id=ref_data["source"],
                    target_id=ref_data["target"],
                    property_path=ref_data["property"],
                    reference_type=ref_data["type"],
                    required=ref_data.get("required", True),
                )
            )

        return registry
