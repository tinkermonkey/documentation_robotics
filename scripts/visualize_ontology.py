#!/usr/bin/env python3
"""Ontology Visualization Tool - Generate visual diagrams of ontology structure.

This script generates various visualization formats:
- matrix: Relationship matrices (markdown, CSV, HTML)
- diagram: Ontology diagrams (Mermaid, Graphviz, PlantUML)
- export: Export to graph databases (Neo4j Cypher)

Usage:
    python scripts/visualize_ontology.py --type matrix
    python scripts/visualize_ontology.py --type diagram
    python scripts/visualize_ontology.py --type export
    python scripts/visualize_ontology.py --type all
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from visualization.relationship_matrix import RelationshipMatrixGenerator
from visualization.ontology_visualizer import OntologyVisualizer


def main():
    parser = argparse.ArgumentParser(
        description="Generate visual diagrams of ontology structure",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate relationship matrices
  python scripts/visualize_ontology.py --type matrix

  # Generate ontology diagrams
  python scripts/visualize_ontology.py --type diagram

  # Export to graph database formats
  python scripts/visualize_ontology.py --type export

  # Generate all visualizations
  python scripts/visualize_ontology.py --type all

  # Custom output directory
  python scripts/visualize_ontology.py --type all --output custom/path
        """,
    )

    parser.add_argument(
        "--type",
        choices=["matrix", "diagram", "export", "all"],
        required=True,
        help="Type of visualization to generate",
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/visualization"),
        help="Output directory for reports (default: reports/visualization)",
    )

    parser.add_argument(
        "--spec-root",
        type=Path,
        help="Path to spec/ directory (auto-detected if not specified)",
    )

    args = parser.parse_args()

    # Create output directory
    args.output.mkdir(parents=True, exist_ok=True)

    print(f"Documentation Robotics - Ontology Visualizer")
    print(f"{'=' * 60}")
    print()

    try:
        if args.type in ["matrix", "all"]:
            print("Generating relationship matrices...")
            matrix_gen = RelationshipMatrixGenerator(spec_root=args.spec_root)
            matrix_files = matrix_gen.export_all_formats(args.output)

            print(f"✓ Relationship matrices generated:")
            print(f"  - Markdown: {matrix_files['markdown']}")
            print(f"  - HTML: {matrix_files['html']}")
            print(f"  - CSV files: {matrix_files['layer_csv'].parent}")
            print()

        if args.type in ["diagram", "all"]:
            print("Generating ontology diagrams...")
            visualizer = OntologyVisualizer(spec_root=args.spec_root)
            diagram_files = visualizer.export_all_formats(args.output)

            print(f"✓ Ontology diagrams generated:")
            print(f"  - Mermaid (layer deps): {diagram_files['mermaid_layer_dep']}")
            print(f"  - Mermaid (categories): {diagram_files['mermaid_categories']}")
            print(f"  - Mermaid (traceability): {diagram_files['mermaid_trace']}")
            print(f"  - Graphviz DOT: {diagram_files['graphviz']}")
            print(f"  - PlantUML: {diagram_files['plantuml']}")
            print()

        if args.type in ["export", "all"]:
            print("Generating export formats...")
            visualizer = OntologyVisualizer(spec_root=args.spec_root)
            export_files = visualizer.export_all_formats(args.output)

            print(f"✓ Export formats generated:")
            print(f"  - Neo4j Cypher: {export_files['neo4j']}")
            print()

        print("=" * 60)
        print(f"All visualizations saved to: {args.output}")
        print()
        print("Next steps:")
        print("  - View Mermaid diagrams in any markdown viewer")
        print("  - Render Graphviz: dot -Tpng ontology-dependencies.dot -o graph.png")
        print("  - Render PlantUML: plantuml ontology-layers.puml")
        print("  - Import to Neo4j: Run Cypher statements in Neo4j browser")

        return 0

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        print("Make sure you're running from the repository root.", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error generating visualizations: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
