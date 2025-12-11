#!/usr/bin/env python3
"""Registry Management Tool - Manage link-registry.json entries.

This script provides commands to add, update, and deprecate link types
in the link registry.

Usage:
    python scripts/manage_registry.py stats
    python scripts/manage_registry.py validate
    python scripts/manage_registry.py check-coverage
"""

import argparse
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils.link_registry import LinkRegistry


def show_statistics(registry: LinkRegistry) -> None:
    """Show comprehensive registry statistics."""
    stats = registry.get_statistics()

    print("Link Registry Statistics")
    print("=" * 60)
    print()
    print(f"Total Link Types: {stats['total_link_types']}")
    print(f"With Predicates: {stats['with_predicates']} ({stats['predicate_coverage']})")
    print(f"Bidirectional: {stats['bidirectional']}")
    print(f"With Examples: {stats['with_examples']}")
    print(f"Without Examples: {stats['without_examples']}")
    print(f"ArchiMate Aligned: {stats['archimate_aligned']}")
    print()

    print("Category Distribution:")
    for cat, count in sorted(stats['category_counts'].items()):
        print(f"  {cat}: {count}")
    print()

    if stats['relationship_category_counts']:
        print("Relationship Category Distribution:")
        for rel_cat, count in sorted(stats['relationship_category_counts'].items()):
            print(f"  {rel_cat}: {count}")
        print()

    if any(stats['strength_counts'].values()):
        print("Strength Distribution:")
        for strength, count in sorted(stats['strength_counts'].items()):
            if count > 0:
                print(f"  {strength}: {count}")
        print()


def validate_registry(registry_path: Path) -> bool:
    """Validate registry against schema."""
    print("Validating registry against schema...")
    print()

    # Load schema
    schema_path = registry_path.parent / "link-registry.schema.json"
    if not schema_path.exists():
        print(f"Error: Schema not found at {schema_path}")
        return False

    # Load registry
    with open(registry_path, "r", encoding="utf-8") as f:
        registry_data = json.load(f)

    with open(schema_path, "r", encoding="utf-8") as f:
        schema = json.load(f)

    # Validate using jsonschema
    try:
        import jsonschema
        jsonschema.validate(registry_data, schema)
        print("✓ Registry is valid!")
        return True
    except ImportError:
        print("Warning: jsonschema not installed, skipping validation")
        print("Install with: pip install jsonschema")
        return True
    except jsonschema.ValidationError as e:
        print(f"✗ Validation error: {e.message}")
        print(f"  Path: {' → '.join(str(p) for p in e.path)}")
        return False


def check_coverage(registry: LinkRegistry) -> None:
    """Check coverage and identify gaps."""
    print("Coverage Analysis")
    print("=" * 60)
    print()

    # Links without examples
    no_examples = registry.get_links_without_examples()
    print(f"Links Without Examples: {len(no_examples)}")
    if no_examples:
        print("  Top 10:")
        for lt in no_examples[:10]:
            print(f"    - {lt.id}")
    print()

    # Links without predicates
    no_predicates = [lt for lt in registry.link_types.values() if not lt.has_predicate]
    print(f"Links Without Predicates: {len(no_predicates)}")
    if no_predicates:
        print("  Top 10:")
        for lt in no_predicates[:10]:
            print(f"    - {lt.id}")
    print()

    # Links without source element types
    no_source_types = [lt for lt in registry.link_types.values() if not lt.source_element_types]
    print(f"Links Without Source Element Types: {len(no_source_types)}")
    if no_source_types:
        print(f"  Top 10:")
        for lt in no_source_types[:10]:
            print(f"    - {lt.id}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Manage link-registry.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  stats           Show comprehensive statistics
  validate        Validate registry against schema
  check-coverage  Check coverage and identify gaps

Examples:
  python scripts/manage_registry.py stats
  python scripts/manage_registry.py validate
  python scripts/manage_registry.py check-coverage
        """
    )

    parser.add_argument(
        "command",
        choices=["stats", "validate", "check-coverage"],
        help="Command to execute"
    )

    parser.add_argument(
        "--registry",
        type=Path,
        default=Path("spec/schemas/link-registry.json"),
        help="Path to link registry (default: spec/schemas/link-registry.json)"
    )

    args = parser.parse_args()

    print("Link Registry Manager")
    print("=" * 60)
    print()

    try:
        if args.command == "validate":
            success = validate_registry(args.registry)
            return 0 if success else 1

        # Load registry for other commands
        registry = LinkRegistry(args.registry)

        if args.command == "stats":
            show_statistics(registry)
        elif args.command == "check-coverage":
            check_coverage(registry)

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
