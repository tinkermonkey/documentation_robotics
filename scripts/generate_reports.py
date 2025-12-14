#!/usr/bin/env python3
"""Unified Report Generation Tool for Documentation Robotics.

This script consolidates all report generation capabilities:
- Cross-layer relationship documentation
- Intra-layer relationship documentation
- Traceability matrices (goal, requirement, value, constraint)
- Link instance catalog
- GraphML ontology export for visualization

Usage:
    # Generate all reports
    python scripts/generate_reports.py --all

    # Specific report types
    python scripts/generate_reports.py --cross-layer --all-layers
    python scripts/generate_reports.py --intra-layer --layer 02-business
    python scripts/generate_reports.py --traceability
    python scripts/generate_reports.py --catalog
    python scripts/generate_reports.py --graphml

    # Output control
    python scripts/generate_reports.py --all --output custom/path
    python scripts/generate_reports.py --graphml --no-entities  # Smaller GraphML
"""

import argparse
import sys
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from generators.layer_doc_generator import LayerDocGenerator  # noqa: E402
from generators.intra_layer_report_generator import IntraLayerReportGenerator  # noqa: E402
from generators.traceability_generator import TraceabilityGenerator  # noqa: E402
from generators.graphml_exporter import GraphMLExporter  # noqa: E402
from analysis.link_instance_catalog import LinkInstanceCatalog  # noqa: E402
from analysis.intra_layer_analyzer import IntraLayerAnalyzer  # noqa: E402


class UnifiedReportGenerator:
    """Orchestrates all report generation types."""

    def __init__(self, spec_root: Optional[Path] = None, output_dir: Optional[Path] = None):
        """Initialize unified report generator.

        Args:
            spec_root: Path to spec/ directory (auto-detected if None)
            output_dir: Base output directory for reports (default: reports/)
        """
        if spec_root is None:
            # Auto-detect: script is in scripts/, root is 1 level up
            spec_root = Path(__file__).parent.parent / "spec"

        if output_dir is None:
            output_dir = Path(__file__).parent.parent / "reports"

        self.spec_root = spec_root
        self.output_dir = output_dir
        self.layers_path = spec_root / "layers"
        self.schemas_path = spec_root / "schemas"

        # Initialize generators
        self.cross_layer_gen = LayerDocGenerator(spec_root)
        self.intra_layer_analyzer = IntraLayerAnalyzer()
        self.intra_layer_gen = IntraLayerReportGenerator()
        self.traceability_gen = TraceabilityGenerator(spec_root)
        self.catalog = LinkInstanceCatalog(spec_root)
        self.graphml_exporter = GraphMLExporter(
            schemas_path=str(self.schemas_path),
            output_path=str(self.output_dir / "visualization" / "spec-ontology.graphml")
        )

    def generate_all(self, include_graphml_entities: bool = True):
        """Generate all reports.

        Args:
            include_graphml_entities: Include entity types in GraphML export
        """
        print("=" * 80)
        print("DOCUMENTATION ROBOTICS - UNIFIED REPORT GENERATION")
        print("=" * 80)
        print()

        print("[1/5] Cross-Layer Relationship Documentation")
        print("-" * 80)
        self.generate_cross_layer_docs(all_layers=True)
        print()

        print("[2/5] Intra-Layer Relationship Documentation")
        print("-" * 80)
        self.generate_intra_layer_docs(all_layers=True)
        print()

        print("[3/5] Traceability Matrices")
        print("-" * 80)
        self.generate_traceability_matrices()
        print()

        print("[4/5] Link Instance Catalog")
        print("-" * 80)
        self.generate_link_catalog()
        print()

        print("[5/5] GraphML Ontology Export")
        print("-" * 80)
        self.generate_graphml(include_entities=include_graphml_entities)
        print()

        print("=" * 80)
        print("ALL REPORTS GENERATED SUCCESSFULLY")
        print("=" * 80)
        print()
        print(f"Reports saved to: {self.output_dir}")
        print()

    def generate_cross_layer_docs(self, layer_id: Optional[str] = None, all_layers: bool = False):
        """Generate cross-layer relationship documentation.

        Args:
            layer_id: Specific layer to document (e.g., "02-business")
            all_layers: Generate docs for all layers
        """
        output_path = self.output_dir / "layers"
        output_path.mkdir(parents=True, exist_ok=True)

        if all_layers:
            print("Generating cross-layer documentation for all layers...")
            layer_files = sorted(self.layers_path.glob("*-layer.md"))

            for layer_file in layer_files:
                # Extract layer ID (e.g., "02-business")
                layer_name = layer_file.stem  # e.g., "02-business-layer"
                layer_id_str = layer_name.replace("-layer", "")

                output_file = output_path / f"{layer_id_str}-cross-layer.md"
                self.cross_layer_gen.generate_layer_doc(layer_id_str, output_file)
                print(f"  ✓ Generated: {output_file.name}")

            print(f"\n✅ Generated {len(layer_files)} cross-layer documentation files")

        elif layer_id:
            print(f"Generating cross-layer documentation for {layer_id}...")
            layer_file = self.layers_path / f"{layer_id}-layer.md"

            if not layer_file.exists():
                print(f"❌ Error: Layer file not found: {layer_file}")
                return

            output_file = output_path / f"{layer_id}-cross-layer.md"
            self.cross_layer_gen.generate_layer_doc(layer_id, output_file)
            print(f"✅ Generated: {output_file}")

        else:
            print("Error: Must specify either --layer or --all-layers")

    def generate_intra_layer_docs(self, layer_id: Optional[str] = None, all_layers: bool = False):
        """Generate intra-layer relationship documentation.

        Args:
            layer_id: Specific layer to document (e.g., "02-business")
            all_layers: Generate docs for all layers
        """
        output_path = self.output_dir / "layers"
        output_path.mkdir(parents=True, exist_ok=True)

        if all_layers:
            print("Generating intra-layer documentation for all layers...")

            # Analyze all layers
            reports = self.intra_layer_analyzer.analyze_all_layers()

            for layer_id, report in sorted(reports.items()):
                # Generate report
                content = self.intra_layer_gen.generate_layer_report(report)

                # Write to file
                output_file = output_path / f"{layer_id}-intra-layer.md"
                output_file.write_text(content, encoding="utf-8")
                print(f"  ✓ Generated: {output_file.name}")

            print(f"\n✅ Generated {len(reports)} intra-layer documentation files")

        elif layer_id:
            print(f"Generating intra-layer documentation for {layer_id}...")

            # Analyze the layer
            report = self.intra_layer_analyzer.analyze_layer(layer_id)

            # Generate report
            content = self.intra_layer_gen.generate_layer_report(report)

            # Write to file
            output_file = output_path / f"{layer_id}-intra-layer.md"
            output_file.write_text(content, encoding="utf-8")
            print(f"✅ Generated: {output_file}")

        else:
            print("Error: Must specify either --layer or --all-layers")

    def generate_traceability_matrices(self):
        """Generate all traceability matrices."""
        output_path = self.output_dir / "traceability"
        output_path.mkdir(parents=True, exist_ok=True)

        print("Generating traceability matrices...")
        self.traceability_gen.generate_all(output_path)
        print(f"✅ Generated 4 traceability matrices in: {output_path}")

    def generate_link_catalog(self):
        """Generate link instance catalog."""
        output_path = self.output_dir / "catalog"
        output_path.mkdir(parents=True, exist_ok=True)

        print("Cataloging link instances...")
        catalog_data = self.catalog.catalog()

        # Generate markdown report
        markdown_path = output_path / "link-instances.md"
        markdown_report = self.catalog.generate_markdown_report(catalog_data)
        markdown_path.write_text(markdown_report, encoding="utf-8")

        # Export JSON
        json_path = output_path / "link-instances.json"
        self.catalog.export_json(catalog_data, json_path)

        print(f"✅ Generated link catalog:")
        print(f"  - Markdown: {markdown_path}")
        print(f"  - JSON: {json_path}")

    def generate_graphml(self, include_entities: bool = True):
        """Generate GraphML ontology export.

        Args:
            include_entities: Include entity type definitions in export
        """
        print(f"Exporting ontology to GraphML (include_entities={include_entities})...")
        self.graphml_exporter.export(include_entities=include_entities)
        print(f"✅ GraphML export complete")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Unified Report Generation Tool for Documentation Robotics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Report type selection
    parser.add_argument('--all', action='store_true', help='Generate all reports')
    parser.add_argument('--cross-layer', action='store_true', help='Generate cross-layer documentation')
    parser.add_argument('--intra-layer', action='store_true', help='Generate intra-layer documentation')
    parser.add_argument('--traceability', action='store_true', help='Generate traceability matrices')
    parser.add_argument('--catalog', action='store_true', help='Generate link instance catalog')
    parser.add_argument('--graphml', action='store_true', help='Generate GraphML export')

    # Filters
    parser.add_argument('--layer', help='Generate docs for specific layer (e.g., 02-business)')
    parser.add_argument('--all-layers', action='store_true', help='Generate docs for all layers')

    # GraphML options
    parser.add_argument(
        '--no-entities', action='store_true',
        help='Exclude entity types from GraphML export (smaller file)'
    )

    # Output control
    parser.add_argument(
        '--output', type=Path, default=Path('reports'),
        help='Output directory for reports (default: reports/)'
    )
    parser.add_argument(
        '--spec-root', type=Path,
        help='Path to spec/ directory (auto-detected if not specified)'
    )

    args = parser.parse_args()

    # Default to --all if no report type specified
    if not any([args.all, args.cross_layer, args.intra_layer, args.traceability, args.catalog, args.graphml]):
        args.all = True

    # Create generator
    generator = UnifiedReportGenerator(spec_root=args.spec_root, output_dir=args.output)

    try:
        # Run generation
        if args.all:
            generator.generate_all(include_graphml_entities=not args.no_entities)
        else:
            if args.cross_layer:
                generator.generate_cross_layer_docs(layer_id=args.layer, all_layers=args.all_layers)

            if args.intra_layer:
                generator.generate_intra_layer_docs(layer_id=args.layer, all_layers=args.all_layers)

            if args.traceability:
                generator.generate_traceability_matrices()

            if args.catalog:
                generator.generate_link_catalog()

            if args.graphml:
                generator.generate_graphml(include_entities=not args.no_entities)

        return 0

    except FileNotFoundError as e:
        print(f"\n❌ Error: {e}", file=sys.stderr)
        print("Make sure you're running from the repository root.", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"\n❌ Error generating reports: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
