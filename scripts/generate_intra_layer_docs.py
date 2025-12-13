#!/usr/bin/env python3
"""Intra-Layer Documentation Generator - Generate intra-layer relationship reports.

This tool analyzes relationships between entities WITHIN each layer and generates
detailed reports showing internal structure, coverage metrics, and gaps.

Usage:
    python scripts/generate_intra_layer_docs.py --layer 01-motivation
    python scripts/generate_intra_layer_docs.py --all
    python scripts/generate_intra_layer_docs.py --all --with-gap-summary
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from analysis.intra_layer_analyzer import IntraLayerAnalyzer
from generators.intra_layer_report_generator import IntraLayerReportGenerator


def main():
    parser = argparse.ArgumentParser(
        description="Generate intra-layer relationship documentation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate intra-layer report for motivation layer
  python scripts/generate_intra_layer_docs.py --layer 01-motivation

  # Generate for all layers
  python scripts/generate_intra_layer_docs.py --all

  # Generate with gap analysis summary
  python scripts/generate_intra_layer_docs.py --all --with-gap-summary

  # Specify output directory
  python scripts/generate_intra_layer_docs.py --all --output-dir reports/layer-docs
        """,
    )

    parser.add_argument(
        "--layer", help="Layer ID to generate documentation for (e.g., 01-motivation)"
    )
    parser.add_argument(
        "--all", action="store_true", help="Generate documentation for all layers"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("reports/layer-docs"),
        help="Output directory for generated documentation (default: reports/layer-docs)",
    )
    parser.add_argument(
        "--with-gap-summary",
        action="store_true",
        help="Generate aggregate gap analysis report",
    )
    parser.add_argument(
        "--preview", action="store_true", help="Preview output without writing files"
    )

    args = parser.parse_args()

    if not args.layer and not args.all:
        parser.print_help()
        return 1

    print("Documentation Robotics - Intra-Layer Relationship Analyzer")
    print("=" * 70)
    print()

    try:
        analyzer = IntraLayerAnalyzer()
        generator = IntraLayerReportGenerator()

        # Analyze layers
        if args.all:
            print("Analyzing all layers...")
            print()
            reports = analyzer.analyze_all_layers()

            if not reports:
                print("Error: No layers found to analyze", file=sys.stderr)
                return 1

            layers = sorted(reports.keys())
            print(f"✓ Analyzed {len(layers)} layers")
            print()

        else:
            print(f"Analyzing layer: {args.layer}...")
            print()

            try:
                report = analyzer.analyze_layer(args.layer)
                reports = {args.layer: report}
                layers = [args.layer]
                print(f"✓ Analysis complete")
                print()
            except FileNotFoundError as e:
                print(f"Error: {e}", file=sys.stderr)
                return 1

        # Generate reports for each layer
        print("Generating reports...")
        print()

        # Get coverage target
        coverage_target = next(iter(reports.values())).COVERAGE_TARGET if reports else 2

        for layer_id in layers:
            report = reports[layer_id]
            layer_name = report.layer_spec.title

            print(f"  {layer_id}: {layer_name}")
            print(f"    - Entities: {report.total_entities}")
            print(f"    - Meeting Target ({coverage_target}+): {report.entities_meeting_target}")
            print(f"    - Coverage: {report.entity_coverage_percentage:.1f}%")
            print(f"    - Total Relationships: {report.total_relationships}")

            # Generate report
            content = generator.generate_layer_report(report)

            if args.preview:
                print()
                print("=" * 70)
                print(content[:500])  # Preview first 500 chars
                print("...")
                print("=" * 70)
                print()
            else:
                # Write to file
                output_file = args.output_dir / f"{layer_id}-intra-layer-relationships.md"
                output_file.parent.mkdir(parents=True, exist_ok=True)
                output_file.write_text(content, encoding="utf-8")
                print(f"    → {output_file}")

            print()

        # Generate gap summary if requested
        if args.with_gap_summary and args.all:
            print("Generating gap analysis summary...")

            gap_summary = generator.generate_gap_summary_report(reports)

            if args.preview:
                print()
                print("=" * 70)
                print(gap_summary[:500])
                print("...")
                print("=" * 70)
                print()
            else:
                gap_output = args.output_dir.parent / "gap-analysis" / "intra-layer-coverage.md"
                gap_output.parent.mkdir(parents=True, exist_ok=True)
                gap_output.write_text(gap_summary, encoding="utf-8")
                print(f"  → {gap_output}")
                print()

        print("✓ Documentation generation complete!")

        if not args.preview:
            print()
            print(f"Output directory: {args.output_dir}")
            print(f"Files generated: {len(layers)}")

            if args.with_gap_summary:
                print(f"Gap analysis: {gap_output}")

        # Print summary statistics
        print()
        print("Summary Statistics:")
        print("-" * 70)

        total_entities = sum(r.total_entities for r in reports.values())
        total_meeting_target = sum(r.entities_meeting_target for r in reports.values())
        total_relationships = sum(r.total_relationships for r in reports.values())

        coverage_pct = (
            (total_meeting_target / total_entities * 100) if total_entities > 0 else 0
        )

        avg_relationships = total_relationships / total_entities if total_entities > 0 else 0

        print(f"Coverage Target:                  {coverage_target}+ relationships per entity")
        print(f"Total Entities Analyzed:          {total_entities}")
        print(f"Entities Meeting Target:          {total_meeting_target} ({coverage_pct:.1f}%)")
        print(f"Entities Below Target:            {total_entities - total_meeting_target}")
        print(f"Total Intra-Layer Relationships:  {total_relationships}")
        print(f"Average Relationships per Entity: {avg_relationships:.1f}")
        print()

        # Highlight critical gaps
        entities_needing_work = total_entities - total_meeting_target
        if entities_needing_work > 0:
            print("⚠ Action Required:")
            print(f"  {entities_needing_work} entities need more relationships to reach the target")
            print(f"  Current coverage: {coverage_pct:.1f}% (target: 100%)")
            print()

            if args.with_gap_summary:
                print(f"  See {gap_output} for detailed gap analysis")
                print()

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
