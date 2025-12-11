#!/usr/bin/env python3
"""Link Validation Script - Validates relationships across the ontology.

This script validates that all relationships follow the registry schema, use correct formats,
and maintain consistency. Designed for spec maintainers to ensure ontology quality.

Usage:
    python scripts/validate_links.py                     # Validate all links
    python scripts/validate_links.py --layer 02          # Validate specific layer
    python scripts/validate_links.py --strict            # Treat warnings as errors
"""

import argparse
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from validation.relationship_validator import RelationshipValidator
from utils.link_registry import LinkRegistry


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Link Validation Tool for Documentation Robotics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Validate all links
  python scripts/validate_links.py

  # Validate specific layer
  python scripts/validate_links.py --layer 02

  # Strict mode (warnings = errors)
  python scripts/validate_links.py --strict

  # Custom output directory
  python scripts/validate_links.py --output reports/validation

  # Specify custom spec root
  python scripts/validate_links.py --spec-root /path/to/spec
        """
    )

    parser.add_argument(
        "--layer",
        type=str,
        default=None,
        help="Validate specific layer (e.g., 02 for business layer)"
    )

    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors (fail on warnings)"
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/validation"),
        help="Output directory for reports (default: reports/validation)"
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

    # Run validation
    print("=" * 80)
    print("RELATIONSHIP VALIDATION")
    print("=" * 80)
    print()

    if args.layer:
        print(f"Validating Layer {args.layer}...")
    else:
        print("Validating all layers...")

    try:
        validator = RelationshipValidator(spec_root=args.spec_root)
        report = validator.validate(layer_id=args.layer)

        # Generate outputs
        markdown_path = args.output / "validation-report.md"
        json_path = args.output / "validation-report.json"

        markdown_report = validator.generate_markdown_report(report)
        markdown_path.write_text(markdown_report, encoding="utf-8")

        validator.export_json(report, json_path)

        print(f"\n✓ Validation complete!")
        print(f"  - Markdown report: {markdown_path}")
        print(f"  - JSON report: {json_path}")
        print()

        # Print summary
        status = "✅ PASSED" if report.validation_passed else "❌ FAILED"
        print(f"SUMMARY: {status}")
        print(f"  Layers validated: {report.layers_validated}")
        print(f"  Links validated: {report.links_validated}")
        print(f"  Total issues: {report.total_issues}")
        print(f"    - Errors: {len(report.errors)} 🔴")
        print(f"    - Warnings: {len(report.warnings)} ⚠️")
        print(f"    - Info: {len(report.info)} ℹ️")
        print()

        # Show error samples
        if report.errors:
            print("Sample errors (showing first 5):")
            for issue in report.errors[:5]:
                print(f"  🔴 [{issue.category}] {issue.message}")
                print(f"     Location: {Path(issue.location).name}")
                if issue.field_path:
                    print(f"     Field: {issue.field_path}")
                if issue.suggestion:
                    print(f"     💡 {issue.suggestion}")
                print()

        # Show warning samples
        if report.warnings:
            print("Sample warnings (showing first 5):")
            for issue in report.warnings[:5]:
                print(f"  ⚠️  [{issue.category}] {issue.message}")
                print(f"     Location: {Path(issue.location).name}")
                if issue.field_path:
                    print(f"     Field: {issue.field_path}")
                print()

        # Exit code
        if not report.validation_passed:
            sys.exit(1)
        elif args.strict and report.warnings:
            print("❌ STRICT MODE: Failing due to warnings")
            sys.exit(1)
        else:
            sys.exit(0)

    except Exception as e:
        print(f"\nError during validation: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
