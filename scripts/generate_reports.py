#!/usr/bin/env python3
"""Report Generation Tool - Generate comprehensive ontology reports.

This script generates comprehensive assessment reports combining insights
from coverage analysis, predicate extraction, gap analysis, and usage statistics.

Usage:
    python scripts/generate_reports.py --report assessment
    python scripts/generate_reports.py --report all
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from reports.ontology_assessment import OntologyAssessmentReporter


def main():
    parser = argparse.ArgumentParser(
        description="Generate comprehensive ontology assessment reports",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate comprehensive assessment report
  python scripts/generate_reports.py --report assessment

  # Generate all reports
  python scripts/generate_reports.py --report all

  # Custom output directory
  python scripts/generate_reports.py --report assessment --output custom/path
        """,
    )

    parser.add_argument(
        "--report",
        choices=["assessment", "all"],
        required=True,
        help="Type of report to generate",
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/assessment"),
        help="Output directory for reports (default: reports/assessment)",
    )

    parser.add_argument(
        "--spec-root",
        type=Path,
        help="Path to spec/ directory (auto-detected if not specified)",
    )

    args = parser.parse_args()

    # Create output directory
    args.output.mkdir(parents=True, exist_ok=True)

    print(f"Documentation Robotics - Assessment Report Generator")
    print(f"{'=' * 60}")
    print()

    try:
        if args.report in ["assessment", "all"]:
            print("Generating comprehensive ontology assessment...")
            print()

            reporter = OntologyAssessmentReporter(spec_root=args.spec_root)
            assessment = reporter.generate_assessment()

            # Generate markdown report
            markdown_path = args.output / "ontology-assessment.md"
            markdown_report = reporter.generate_markdown_report(assessment)
            markdown_path.write_text(markdown_report, encoding="utf-8")

            # Generate JSON report
            json_path = args.output / "ontology-assessment.json"
            reporter.export_json(assessment, json_path)

            print()
            print("=" * 60)
            print("Assessment Report Summary")
            print("=" * 60)
            print()
            print(f"Overall Maturity Score: {assessment.overall_maturity:.1f}/5.0")
            print()
            print("Coverage:")
            print(f"  - Link Coverage: {assessment.coverage_percentage:.1f}%")
            print(f"  - Link Types Used: {assessment.link_types_used}/{assessment.total_link_types}")
            print(f"  - Unused Link Types: {assessment.unused_link_types}")
            print()
            print("Predicates:")
            print(f"  - Total Predicates: {assessment.total_predicates}")
            print(f"  - Categorized: {assessment.categorized_predicates}")
            print(f"  - Uncategorized: {assessment.uncategorized_predicates}")
            print()
            print("Gaps:")
            print(f"  - Total Gaps: {assessment.total_gaps}")
            print(f"  - Critical Priority: {assessment.critical_gaps}")
            print(f"  - High Priority: {assessment.high_priority_gaps}")
            print()
            print("Top Layer Maturity Scores:")
            top_layers = sorted(assessment.layer_maturity, key=lambda m: m.score, reverse=True)[:5]
            for maturity in top_layers:
                stars = "⭐" * maturity.score
                print(f"  - {maturity.layer_id}: {maturity.layer_name} - {stars} ({maturity.score}/5)")
            print()
            print("Top Recommendations:")
            for idx, rec in enumerate(assessment.recommendations[:5], 1):
                # Strip markdown bold for console output
                clean_rec = rec.replace("**", "")
                print(f"  {idx}. {clean_rec}")
            print()
            print("=" * 60)
            print(f"Reports saved to:")
            print(f"  - Markdown: {markdown_path}")
            print(f"  - JSON: {json_path}")
            print()
            print("For detailed analysis, see also:")
            print("  - reports/ontology/link-coverage-report.md")
            print("  - reports/ontology/predicate-catalog.md")
            print("  - reports/ontology/gap-analysis-report.md")
            print("  - reports/catalog/link-instances.md")

        return 0

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        print("Make sure you're running from the repository root.", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error generating reports: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
