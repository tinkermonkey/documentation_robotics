#!/usr/bin/env python3
"""Ontology Query Tool - Query and navigate ontology relationships.

Usage:
    python scripts/query_ontology.py --trace 02-business
    python scripts/query_ontology.py --path 02-business 01-motivation
    python scripts/query_ontology.py --matrix goal-traceability
    python scripts/query_ontology.py --query "FIND Goals SUPPORTED-BY ApplicationService"
    python scripts/query_ontology.py --stats
"""

import argparse
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from query.ontology_query_engine import OntologyQueryEngine
from query.traceability_matrix import TraceabilityMatrixGenerator


def show_connectivity_stats(engine: OntologyQueryEngine) -> None:
    """Show connectivity statistics."""
    stats = engine.get_connectivity_stats()

    print("Ontology Connectivity Statistics")
    print("=" * 60)
    print()
    print(f"Total Layers: {stats['total_layers']}")
    print(f"Total Layer Connections: {stats['total_layer_connections']}")
    print(f"Total Link Types: {stats['total_link_types']}")
    print()

    print("Most Connected Layers (Outgoing):")
    for layer, count in stats['most_connected_outgoing']:
        print(f"  {layer}: {count} connections")
    print()

    print("Most Connected Layers (Incoming):")
    for layer, count in stats['most_connected_incoming']:
        print(f"  {layer}: {count} connections")
    print()


def trace_layer(engine: OntologyQueryEngine, layer: str) -> None:
    """Trace dependencies from a layer."""
    print(f"Tracing dependencies from {layer}")
    print("=" * 60)
    print()

    # Find all dependencies
    deps = engine.find_all_dependencies(layer, max_depth=3)

    if not deps:
        print(f"No dependencies found from {layer}")
        return

    for depth, layers in sorted(deps.items()):
        print(f"Depth {depth}:")
        for dep_layer in layers:
            links = engine.find_links_between(layer if depth == 1 else "various", dep_layer)
            link_count = len(links)
            print(f"  → {dep_layer} ({link_count} link type{'s' if link_count != 1 else ''})")
        print()


def show_path(engine: OntologyQueryEngine, source: str, target: str) -> None:
    """Show path between two layers."""
    print(f"Finding path: {source} → {target}")
    print("=" * 60)
    print()

    path = engine.shortest_path(source, target)

    if not path:
        print(f"No path found from {source} to {target}")
        return

    print(f"Shortest Path (length: {path.length}):")
    print()

    for i, element in enumerate(path.elements):
        print(f"  {i + 1}. {element}")
        if i < len(path.relationships):
            link_type = engine.registry.link_types[path.relationships[i]]
            print(f"     ↓ via {link_type.name} ({link_type.predicate})")

    print()


def execute_query(engine: OntologyQueryEngine, query_string: str) -> None:
    """Execute a query string."""
    print(f"Executing query: {query_string}")
    print("=" * 60)
    print()

    result = engine.execute_query(query_string)

    if result.result_type == "error":
        print(f"Error: {result.metadata.get('error')}")
        print()
        print("Supported query formats:")
        print("  FIND <target> <PREDICATE> <source> [WHERE layer='xx-layer']")
        print("  PATH FROM <source-layer> TO <target-layer>")
        print("  COUNT links FROM layer='xx-layer' TO layer='yy-layer'")
        return

    print(f"Results: {result.count} found")
    print()

    if result.result_type == "elements":
        if result.results:
            for item in result.results[:10]:  # Show first 10
                print(f"  - {item['id']}: {item['name']}")
                print(f"    Predicate: {item['predicate']} / {item.get('inverse_predicate', 'N/A')}")
                print(f"    {' → '.join(item['source_layers'])} → {item['target_layer']}")
            if len(result.results) > 10:
                print(f"  ... and {len(result.results) - 10} more")
        else:
            print("  (No results)")

    elif result.result_type == "paths":
        if result.results:
            path = result.results[0]
            print(f"  Path length: {path.length}")
            print(f"  Elements: {' → '.join(path.elements)}")
        else:
            print("  (No path found)")

    elif result.result_type == "count":
        print(f"  {result.count} link types found")
        for link in result.results[:5]:
            print(f"    - {link['id']}: {link['name']}")

    print()


def generate_matrix(matrix_type: str, output_dir: Path) -> None:
    """Generate traceability matrix."""
    print(f"Generating {matrix_type} matrix...")
    print("=" * 60)
    print()

    generator = TraceabilityMatrixGenerator()

    if matrix_type == "all":
        output_files = generator.generate_all_matrices(output_dir)
        print(f"Generated {len(output_files)} matrices:")
        for name, path in output_files.items():
            print(f"  - {name}: {path}")
    else:
        if matrix_type == "goal-traceability":
            content = generator.generate_goal_traceability_matrix()
            filename = "goal-traceability-matrix.md"
        elif matrix_type == "requirement-coverage":
            content = generator.generate_requirement_coverage_matrix()
            filename = "requirement-coverage-matrix.md"
        elif matrix_type == "value-realization":
            content = generator.generate_value_realization_matrix()
            filename = "value-realization-matrix.md"
        elif matrix_type == "constraint-compliance":
            content = generator.generate_constraint_compliance_matrix()
            filename = "constraint-compliance-matrix.md"
        else:
            print(f"Unknown matrix type: {matrix_type}")
            return

        output_path = output_dir / filename
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(content, encoding="utf-8")
        print(f"Matrix saved to: {output_path}")

    print()


def main():
    parser = argparse.ArgumentParser(
        description="Query and navigate Documentation Robotics ontology",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Show connectivity statistics
  python scripts/query_ontology.py --stats

  # Trace dependencies from a layer
  python scripts/query_ontology.py --trace 02-business

  # Find path between layers
  python scripts/query_ontology.py --path 02-business 01-motivation

  # Execute query
  python scripts/query_ontology.py --query "PATH FROM 02-business TO 01-motivation"

  # Generate traceability matrix
  python scripts/query_ontology.py --matrix goal-traceability
  python scripts/query_ontology.py --matrix all
        """
    )

    parser.add_argument("--stats", action="store_true", help="Show connectivity statistics")
    parser.add_argument("--trace", metavar="LAYER", help="Trace dependencies from layer")
    parser.add_argument("--path", nargs=2, metavar=("SOURCE", "TARGET"), help="Find path between layers")
    parser.add_argument("--query", metavar="QUERY", help="Execute query string")
    parser.add_argument(
        "--matrix",
        choices=["goal-traceability", "requirement-coverage", "value-realization", "constraint-compliance", "all"],
        help="Generate traceability matrix"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/traceability"),
        help="Output directory for matrices (default: reports/traceability)"
    )

    args = parser.parse_args()

    # At least one action required
    if not any([args.stats, args.trace, args.path, args.query, args.matrix]):
        parser.print_help()
        return 1

    print("Documentation Robotics - Ontology Query Tool")
    print("=" * 60)
    print()

    try:
        if args.stats or args.trace or args.path or args.query:
            engine = OntologyQueryEngine()

            if args.stats:
                show_connectivity_stats(engine)

            if args.trace:
                trace_layer(engine, args.trace)

            if args.path:
                show_path(engine, args.path[0], args.path[1])

            if args.query:
                execute_query(engine, args.query)

        if args.matrix:
            generate_matrix(args.matrix, args.output)

        return 0

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
