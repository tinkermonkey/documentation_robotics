"""
GraphML exporter for graph visualization.
"""
from pathlib import Path
import networkx as nx
from .export_manager import BaseExporter


class GraphMLExporter(BaseExporter):
    """
    Exports model dependency graph to GraphML format.

    Output can be visualized in tools like yEd, Gephi, Cytoscape.
    """

    def export(self) -> Path:
        """
        Export to GraphML.

        Returns:
            Path to exported file
        """
        # Get dependency graph from reference registry
        if not hasattr(self.model, "reference_registry"):
            raise ValueError("Reference registry not available")

        graph = self.model.reference_registry.get_dependency_graph()

        # Add node attributes
        for node_id in graph.nodes():
            element = self.model.get_element(node_id)
            if element:
                graph.nodes[node_id]["name"] = element.name
                graph.nodes[node_id]["layer"] = element.layer
                graph.nodes[node_id]["type"] = element.type
                graph.nodes[node_id]["description"] = element.description or ""

        # Ensure output directory exists
        self.options.output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write to GraphML
        nx.write_graphml(graph, str(self.options.output_path))

        return self.options.output_path

    def validate_output(self, output_path: Path) -> bool:
        """Validate exported GraphML file."""
        try:
            # Try to parse the GraphML file
            graph = nx.read_graphml(str(output_path))
            # Check that it has nodes
            return len(graph.nodes()) > 0
        except Exception:
            return False
