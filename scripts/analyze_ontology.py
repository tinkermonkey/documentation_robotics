#!/usr/bin/env python3
"""Ontology Analysis Script - Main entry point for ontology analysis tools.

This script coordinates all ontology analysis tools: link coverage, predicate extraction,
and gap analysis. It's designed for spec maintainers to assess the ontology state.

Usage:
    python scripts/analyze_ontology.py --mode coverage     # Link coverage analysis
    python scripts/analyze_ontology.py --mode predicates   # Predicate catalog
    python scripts/analyze_ontology.py --mode gaps         # Gap analysis
    python scripts/analyze_ontology.py --mode all          # All analyses
"""

import argparse
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from analysis.link_coverage_analyzer import LinkCoverageAnalyzer
from analysis.predicate_extractor import PredicateExtractor
from analysis.gap_analyzer import GapAnalyzer
from utils.link_registry import LinkRegistry


def run_coverage_analysis(output_dir: Path, spec_root: Path):
    """Run link coverage analysis."""
    print("=" * 80)
    print("LINK COVERAGE ANALYSIS")
    print("=" * 80)
    print()

    analyzer = LinkCoverageAnalyzer(spec_root=spec_root)
    print("Analyzing link coverage across all layers...")

    report = analyzer.analyze()

    # Generate outputs
    markdown_path = output_dir / "link-coverage-report.md"
    json_path = output_dir / "link-coverage-report.json"

    markdown_report = analyzer.generate_markdown_report(report)
    markdown_path.write_text(markdown_report, encoding="utf-8")

    analyzer.export_json(report, json_path)

    print(f"\n✓ Analysis complete!")
    print(f"  - Markdown report: {markdown_path}")
    print(f"  - JSON report: {json_path}")
    print()

    # Print summary
    coverage_pct = (report.link_types_found_in_docs / report.total_link_types_in_registry * 100)
    print(f"SUMMARY:")
    print(f"  Layers analyzed: {report.layers_analyzed}")
    print(f"  Link coverage: {coverage_pct:.1f}% ({report.link_types_found_in_docs}/{report.total_link_types_in_registry})")
    print(f"  Unused link types: {len(report.link_types_unused)}")
    print(f"  Links not in registry: {len(report.links_in_docs_not_in_registry)}")
    print()


def run_predicate_extraction(output_dir: Path, spec_root: Path):
    """Run predicate extraction."""
    print("=" * 80)
    print("PREDICATE CATALOG EXTRACTION")
    print("=" * 80)
    print()

    extractor = PredicateExtractor(spec_root=spec_root)
    print("Extracting predicates from all layers...")

    catalog = extractor.extract()

    # Generate outputs
    markdown_path = output_dir / "predicate-catalog.md"
    json_path = output_dir / "predicate-catalog.json"

    markdown_report = extractor.generate_markdown_report(catalog)
    markdown_path.write_text(markdown_report, encoding="utf-8")

    extractor.export_json(catalog, json_path)

    print(f"\n✓ Extraction complete!")
    print(f"  - Markdown report: {markdown_path}")
    print(f"  - JSON catalog: {json_path}")
    print()

    # Print summary
    print(f"SUMMARY:")
    print(f"  Unique predicates: {len(catalog.predicates)}")
    print(f"  Total usages: {catalog.total_predicate_usages}")
    print(f"  XML relationship types: {len(catalog.xml_relationship_types)}")
    print(f"  Property patterns: {len(catalog.property_patterns)}")
    print(f"  x- extensions: {len(catalog.x_extensions)}")
    print()

    # Show top categories
    print("Top categories:")
    for category in sorted(catalog.categories.keys(), key=lambda c: catalog.categories[c], reverse=True)[:5]:
        count = catalog.categories[category]
        pct = (count / catalog.total_predicate_usages * 100)
        print(f"  - {category}: {count} ({pct:.1f}%)")
    print()


def run_gap_analysis(output_dir: Path, spec_root: Path):
    """Run gap analysis."""
    print("=" * 80)
    print("ONTOLOGY GAP ANALYSIS")
    print("=" * 80)
    print()

    analyzer = GapAnalyzer(spec_root=spec_root)
    print("Analyzing ontology for gaps and inconsistencies...")

    report = analyzer.analyze()

    # Generate outputs
    markdown_path = output_dir / "gap-analysis-report.md"
    json_path = output_dir / "gap-analysis-report.json"

    markdown_report = analyzer.generate_markdown_report(report)
    markdown_path.write_text(markdown_report, encoding="utf-8")

    analyzer.export_json(report, json_path)

    print(f"\n✓ Analysis complete!")
    print(f"  - Markdown report: {markdown_path}")
    print(f"  - JSON report: {json_path}")
    print()

    # Print summary
    print(f"SUMMARY:")
    print(f"  Total gaps: {report.total_gaps}")
    print(f"  Critical priority: {report.critical_gaps}")
    print(f"  High priority: {report.high_priority_gaps}")
    print(f"  Inter-layer gaps: {len(report.inter_layer_gaps)}")
    print(f"  Intra-layer gaps: {len(report.intra_layer_gaps)}")
    print(f"  Semantic gaps: {len(report.semantic_gaps)}")
    print(f"  Bidirectional gaps: {len(report.bidirectional_gaps)}")
    print(f"  Element coverage gaps: {len(report.element_coverage_gaps)}")
    print()


def run_all_analyses(output_dir: Path, spec_root: Path):
    """Run all analyses and generate combined report."""
    print("=" * 80)
    print("COMPREHENSIVE ONTOLOGY ANALYSIS")
    print("=" * 80)
    print()

    # Run all three analyses
    run_coverage_analysis(output_dir, spec_root)
    run_predicate_extraction(output_dir, spec_root)
    run_gap_analysis(output_dir, spec_root)

    # Generate combined summary
    print("=" * 80)
    print("COMBINED ANALYSIS COMPLETE")
    print("=" * 80)
    print()
    print(f"All reports generated in: {output_dir}")
    print()
    print("Reports generated:")
    print("  1. link-coverage-report.md")
    print("  2. predicate-catalog.md")
    print("  3. gap-analysis-report.md")
    print()
    print("Next steps:")
    print("  1. Review the gap analysis report for priority action items")
    print("  2. Check link coverage for missing registry entries")
    print("  3. Review predicate catalog for standardization opportunities")
    print()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Ontology Analysis Tool for Documentation Robotics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run link coverage analysis
  python scripts/analyze_ontology.py --mode coverage

  # Run predicate extraction
  python scripts/analyze_ontology.py --mode predicates

  # Run gap analysis
  python scripts/analyze_ontology.py --mode gaps

  # Run all analyses
  python scripts/analyze_ontology.py --mode all

  # Specify custom output directory
  python scripts/analyze_ontology.py --mode all --output reports/ontology

  # Specify custom spec root
  python scripts/analyze_ontology.py --mode all --spec-root /path/to/spec
        """
    )

    parser.add_argument(
        "--mode",
        required=True,
        choices=["coverage", "predicates", "gaps", "all"],
        help="Analysis mode to run"
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/ontology"),
        help="Output directory for reports (default: reports/ontology)"
    )

    parser.add_argument(
        "--spec-root",
        type=Path,
        default=None,
        help="Path to spec/ directory (default: auto-detect)"
    )

    args = parser.parse_args()

    # Create output directory
    args.output.mkdir(parents=True, exist_ok=True)

    # Validate spec root if provided
    if args.spec_root:
        if not args.spec_root.exists() or not (args.spec_root / "layers").exists():
            print(f"Error: Invalid spec root: {args.spec_root}", file=sys.stderr)
            print("  Must contain a 'layers' subdirectory", file=sys.stderr)
            sys.exit(1)

    # Run requested analysis
    try:
        if args.mode == "coverage":
            run_coverage_analysis(args.output, args.spec_root)
        elif args.mode == "predicates":
            run_predicate_extraction(args.output, args.spec_root)
        elif args.mode == "gaps":
            run_gap_analysis(args.output, args.spec_root)
        elif args.mode == "all":
            run_all_analyses(args.output, args.spec_root)

    except Exception as e:
        print(f"\nError during analysis: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
