#!/usr/bin/env python3
"""Link Instance Catalog Script - Catalogs all link instances in documentation.

This script parses all layer markdown files and catalogs every link instance,
tracking usage frequency and mapping to link-registry.json definitions.

Usage:
    python scripts/catalog_link_instances.py
    python scripts/catalog_link_instances.py --output reports/catalog
"""

import argparse
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from analysis.link_instance_catalog import LinkInstanceCatalog
from utils.link_registry import LinkRegistry


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Link Instance Cataloger for Documentation Robotics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Catalog all link instances
  python scripts/catalog_link_instances.py

  # Custom output directory
  python scripts/catalog_link_instances.py --output reports/catalog

  # Specify custom spec root
  python scripts/catalog_link_instances.py --spec-root /path/to/spec
        """
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/catalog"),
        help="Output directory for catalog (default: reports/catalog)"
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

    # Run cataloging
    print("=" * 80)
    print("LINK INSTANCE CATALOGING")
    print("=" * 80)
    print()

    try:
        cataloger = LinkInstanceCatalog(spec_root=args.spec_root)
        print("Cataloging all link instances from layer documentation...")

        catalog = cataloger.catalog()

        # Generate outputs
        markdown_path = args.output / "link-instances.md"
        json_path = args.output / "link-instances.json"

        markdown_report = cataloger.generate_markdown_report(catalog)
        markdown_path.write_text(markdown_report, encoding="utf-8")

        cataloger.export_json(catalog, json_path)

        print(f"\n✓ Cataloging complete!")
        print(f"  - Markdown report: {markdown_path}")
        print(f"  - JSON catalog: {json_path}")
        print()

        # Print summary
        print(f"SUMMARY:")
        print(f"  Total link instances: {catalog.total_instances}")
        print(f"  Unique link types used: {catalog.unique_link_types_used}")
        print(f"  XML relationships: {len(catalog.xml_relationships)}")
        print(f"  Layers analyzed: {catalog.layers_analyzed}")
        print()

        # Show top link types
        if catalog.link_stats:
            print("Top 10 most used link types:")
            top_links = sorted(
                catalog.link_stats.values(),
                key=lambda s: s.total_instances,
                reverse=True
            )[:10]

            for rank, stats in enumerate(top_links, 1):
                print(f"  {rank}. {stats.link_type_name} ({stats.link_type_id}): {stats.total_instances} instances")
            print()

    except Exception as e:
        print(f"\nError during cataloging: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
