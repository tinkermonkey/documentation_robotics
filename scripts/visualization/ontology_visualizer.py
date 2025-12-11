"""Ontology Visualizer - Generates visual diagrams of ontology structure.

This module creates various diagram types including layer dependency diagrams,
predicate taxonomy trees, entity relationship diagrams, and traceability diagrams
in multiple formats (Mermaid, Graphviz DOT, PlantUML, Neo4j Cypher).
"""

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


class OntologyVisualizer:
    """Generates visual diagrams of the ontology structure."""

    def __init__(self, spec_root: Optional[Path] = None, registry: Optional[LinkRegistry] = None):
        """Initialize the ontology visualizer.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
            registry: LinkRegistry instance. If None, creates new instance.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.registry = registry or LinkRegistry()

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

    def generate_layer_dependency_diagram_mermaid(self) -> str:
        """Generate Mermaid flowchart showing layer dependencies."""
        lines = [
            "```mermaid",
            "graph TD",
            "  %% Layer Dependency Diagram",
            "",
        ]

        # Define layer nodes with styling
        layer_names = {
            "01": "Motivation",
            "02": "Business",
            "03": "Security",
            "04": "Application",
            "05": "Technology",
            "06": "API",
            "07": "Data Model",
            "08": "Datastore",
            "09": "UX",
            "10": "Navigation",
            "11": "APM",
            "12": "Testing",
        }

        for layer_id, name in sorted(layer_names.items()):
            lines.append(f"  L{layer_id}[\"{layer_id}: {name}\"]")

        lines.append("")

        # Add relationships
        relationships = set()
        for link_type in self.registry.link_types.values():
            for source in link_type.source_layers:
                target = link_type.target_layer
                relationships.add((source, target))

        for source, target in sorted(relationships):
            lines.append(f"  L{source} --> L{target}")

        lines.append("")

        # Styling
        lines.extend([
            "  %% Styling",
            "  classDef strategic fill:#FFD700,stroke:#333,stroke-width:2px",
            "  classDef implementation fill:#4ECDC4,stroke:#333,stroke-width:2px",
            "  classDef crosscutting fill:#FF6B6B,stroke:#333,stroke-width:2px",
            "",
            "  class L01 strategic",
            "  class L02,L04,L05,L06,L07,L08,L09,L10,L12 implementation",
            "  class L03,L11 crosscutting",
            "```",
        ])

        return "\n".join(lines)

    def generate_category_diagram_mermaid(self) -> str:
        """Generate Mermaid diagram showing link categories."""
        lines = [
            "```mermaid",
            "graph LR",
            "  %% Link Category Diagram",
            "",
        ]

        # Group links by category
        category_links = defaultdict(list)
        for link_type in self.registry.link_types.values():
            category_links[link_type.category].append(link_type.name)

        # Create category nodes
        for idx, (category, links) in enumerate(sorted(category_links.items())):
            cat_id = f"CAT{idx}"
            count = len(links)
            lines.append(f"  {cat_id}[\"{category}<br/>({count} link types)\"]")

        lines.append("```")
        return "\n".join(lines)

    def generate_traceability_chain_mermaid(self) -> str:
        """Generate Mermaid diagram showing traceability chains."""
        lines = [
            "```mermaid",
            "graph TD",
            "  %% Traceability Chain Diagram",
            "",
            "  Goal[\"🎯 Goal (01)\"]",
            "  Req[\"📋 Requirement (01)\"]",
            "  BizSvc[\"💼 Business Service (02)\"]",
            "  AppSvc[\"⚙️ Application Service (04)\"]",
            "  API[\"🔌 API Operation (06)\"]",
            "  Test[\"✅ Test (12)\"]",
            "",
            "  Goal -->|supports| BizSvc",
            "  Req -->|fulfills| AppSvc",
            "  BizSvc -->|realizes| AppSvc",
            "  AppSvc -->|references| API",
            "  API -->|tests| Test",
            "",
            "  style Goal fill:#FFD700",
            "  style Req fill:#FFE5B4",
            "  style BizSvc fill:#FF6B6B",
            "  style AppSvc fill:#4ECDC4",
            "  style API fill:#45B7D1",
            "  style Test fill:#96CEB4",
            "```",
        ]

        return "\n".join(lines)

    def generate_graphviz_dot(self) -> str:
        """Generate Graphviz DOT format for high-quality rendering."""
        lines = [
            "digraph OntologyDependencies {",
            '  graph [rankdir=TB, splines=ortho, nodesep=1, ranksep=1.5];',
            '  node [shape=box, style="rounded,filled", fontname="Helvetica"];',
            '  edge [fontname="Helvetica", fontsize=10];',
            "",
        ]

        # Define layer nodes
        layer_info = {
            "01": ("Motivation Layer", "#FFD700"),
            "02": ("Business Layer", "#FF6B6B"),
            "03": ("Security Layer", "#FF4757"),
            "04": ("Application Layer", "#4ECDC4"),
            "05": ("Technology Layer", "#95E1D3"),
            "06": ("API Layer", "#45B7D1"),
            "07": ("Data Model Layer", "#96CEB4"),
            "08": ("Datastore Layer", "#88D8B0"),
            "09": ("UX Layer", "#FFEAA7"),
            "10": ("Navigation Layer", "#DFE6E9"),
            "11": ("APM/Observability Layer", "#A29BFE"),
            "12": ("Testing Layer", "#74B9FF"),
        }

        for layer_id, (name, color) in sorted(layer_info.items()):
            lines.append(f'  L{layer_id} [label="{layer_id}\\n{name}", fillcolor="{color}"];')

        lines.append("")

        # Add relationships with labels
        relationship_counts = defaultdict(int)
        for link_type in self.registry.link_types.values():
            for source in link_type.source_layers:
                target = link_type.target_layer
                key = (source, target)
                relationship_counts[key] += 1

        for (source, target), count in sorted(relationship_counts.items()):
            label = f"{count} link type{'s' if count > 1 else ''}"
            lines.append(f'  L{source} -> L{target} [label="{label}"];')

        lines.append("}")
        return "\n".join(lines)

    def generate_plantuml(self) -> str:
        """Generate PlantUML diagram for ArchiMate-style visualization."""
        lines = [
            "@startuml",
            "!theme plain",
            "skinparam packageStyle rectangle",
            "",
            "package \"Strategic Layers\" {",
            "  [01: Motivation Layer] as L01 #FFD700",
            "  [02: Business Layer] as L02 #FF6B6B",
            "}",
            "",
            "package \"Security Layer\" {",
            "  [03: Security Layer] as L03 #FF4757",
            "}",
            "",
            "package \"Implementation Layers\" {",
            "  [04: Application Layer] as L04 #4ECDC4",
            "  [05: Technology Layer] as L05 #95E1D3",
            "  [06: API Layer] as L06 #45B7D1",
            "  [07: Data Model Layer] as L07 #96CEB4",
            "  [08: Datastore Layer] as L08 #88D8B0",
            "  [09: UX Layer] as L09 #FFEAA7",
            "  [10: Navigation Layer] as L10 #DFE6E9",
            "  [12: Testing Layer] as L12 #74B9FF",
            "}",
            "",
            "package \"Observability\" {",
            "  [11: APM/Observability Layer] as L11 #A29BFE",
            "}",
            "",
        ]

        # Add relationships
        relationships = set()
        for link_type in self.registry.link_types.values():
            for source in link_type.source_layers:
                target = link_type.target_layer
                relationships.add((source, target))

        for source, target in sorted(relationships):
            lines.append(f"L{source} --> L{target}")

        lines.append("@enduml")
        return "\n".join(lines)

    def generate_neo4j_cypher(self) -> str:
        """Generate Neo4j Cypher statements for graph database import."""
        lines = [
            "// Documentation Robotics Ontology - Neo4j Import",
            "// Run these statements in Neo4j to import the ontology structure",
            "",
            "// Clear existing data (optional - remove if you want to keep existing data)",
            "// MATCH (n) DETACH DELETE n;",
            "",
            "// Create Layer nodes",
        ]

        layer_names = {
            "01": "Motivation Layer",
            "02": "Business Layer",
            "03": "Security Layer",
            "04": "Application Layer",
            "05": "Technology Layer",
            "06": "API Layer",
            "07": "Data Model Layer",
            "08": "Datastore Layer",
            "09": "UX Layer",
            "10": "Navigation Layer",
            "11": "APM/Observability Layer",
            "12": "Testing Layer",
        }

        for layer_id, name in sorted(layer_names.items()):
            lines.append(f"CREATE (l{layer_id}:Layer {{id: '{layer_id}', name: '{name}'}});")

        lines.extend([
            "",
            "// Create LinkType nodes and relationships",
        ])

        for link_type in self.registry.link_types.values():
            # Create link type node
            lines.append(
                f"CREATE (lt_{link_type.id.replace('-', '_')}:LinkType {{"
                f"id: '{link_type.id}', "
                f"name: '{link_type.name}', "
                f"category: '{link_type.category}', "
                f"cardinality: '{link_type.cardinality}'"
                f"}});"
            )

            # Create relationships
            for source in link_type.source_layers:
                target = link_type.target_layer
                lines.append(
                    f"MATCH (s:Layer {{id: '{source}'}}), "
                    f"(t:Layer {{id: '{target}'}}), "
                    f"(lt:LinkType {{id: '{link_type.id}'}}) "
                    f"CREATE (s)-[:LINKS_TO {{via: lt.id}}]->(t);"
                )

        lines.extend([
            "",
            "// Query examples:",
            "// 1. Find all layers that link to Motivation layer",
            "// MATCH (s:Layer)-[:LINKS_TO]->(t:Layer {id: '01'}) RETURN s.name;",
            "",
            "// 2. Find all link types from Business layer",
            "// MATCH (s:Layer {id: '02'})-[r:LINKS_TO]->(t:Layer) RETURN s.name, t.name, r.via;",
            "",
            "// 3. Find shortest path between any two layers",
            "// MATCH path=shortestPath((s:Layer {id: '02'})-[:LINKS_TO*]->( t:Layer {id: '06'})) RETURN path;",
        ])

        return "\n".join(lines)

    def export_all_formats(self, output_dir: Path) -> Dict[str, Path]:
        """Export diagrams in all formats.

        Returns:
            Dictionary mapping format names to output file paths.
        """
        output_files = {}

        # Mermaid diagrams
        mermaid_dir = output_dir / "mermaid"
        mermaid_dir.mkdir(exist_ok=True)

        layer_dep_path = mermaid_dir / "layer-dependencies.md"
        layer_dep_path.write_text(self.generate_layer_dependency_diagram_mermaid(), encoding="utf-8")
        output_files["mermaid_layer_dep"] = layer_dep_path

        category_path = mermaid_dir / "categories.md"
        category_path.write_text(self.generate_category_diagram_mermaid(), encoding="utf-8")
        output_files["mermaid_categories"] = category_path

        trace_path = mermaid_dir / "traceability-chain.md"
        trace_path.write_text(self.generate_traceability_chain_mermaid(), encoding="utf-8")
        output_files["mermaid_trace"] = trace_path

        # Graphviz DOT
        dot_path = output_dir / "ontology-dependencies.dot"
        dot_path.write_text(self.generate_graphviz_dot(), encoding="utf-8")
        output_files["graphviz"] = dot_path

        # PlantUML
        plantuml_path = output_dir / "ontology-layers.puml"
        plantuml_path.write_text(self.generate_plantuml(), encoding="utf-8")
        output_files["plantuml"] = plantuml_path

        # Neo4j Cypher
        neo4j_path = output_dir / "neo4j-import.cypher"
        neo4j_path.write_text(self.generate_neo4j_cypher(), encoding="utf-8")
        output_files["neo4j"] = neo4j_path

        return output_files
