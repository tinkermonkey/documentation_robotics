#!/usr/bin/env python3
"""Unified Documentation Generation Tool.

Centralizes all documentation generation capabilities:
- Relationship sections for layers
- Relationship diagrams
- Pattern catalog
- Structure validation
"""

import argparse
import sys
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from generators.layer_doc_generator import LayerDocGenerator
from tools.validate_layer_structure import LayerStructureValidator


def generate_relationships(layer_id: str, output_dir: Path, preview: bool = False) -> int:
    """Generate relationship section for a layer.

    Args:
        layer_id: Layer identifier
        output_dir: Output directory
        preview: If True, print to console instead of file

    Returns:
        Exit code
    """
    print(f"Generating relationship section for {layer_id}...")
    print()

    generator = LayerDocGenerator()
    content = generator.generate_complete_cross_layer_section(layer_id)

    if preview:
        print(content)
    else:
        output_file = output_dir / f"{layer_id}-cross-layer-relationships.md"
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(content, encoding="utf-8")
        print(f"✓ Generated: {output_file}")

    return 0


def generate_diagram(layer_id: str, output_dir: Path) -> int:
    """Generate relationship diagram for a layer.

    Args:
        layer_id: Layer identifier
        output_dir: Output directory

    Returns:
        Exit code
    """
    print(f"Generating relationship diagram for {layer_id}...")
    print()

    generator = LayerDocGenerator()
    diagram = generator.generate_cross_layer_diagram(layer_id)

    output_file = output_dir / f"{layer_id}-relationship-diagram.md"
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(diagram, encoding="utf-8")

    print(f"✓ Generated: {output_file}")
    return 0


def validate_structure(layer_id: Optional[str], output_dir: Path, strict: bool = False) -> int:
    """Validate layer documentation structure.

    Args:
        layer_id: Optional layer ID (if None, validates all)
        output_dir: Output directory for report
        strict: Treat warnings as errors

    Returns:
        Exit code
    """
    print("Validating layer documentation structure...")
    print()

    validator = LayerStructureValidator()

    if layer_id:
        reports = [validator.validate_layer(layer_id)]
    else:
        reports = validator.validate_all_layers()

    # Generate report
    report_text = validator.generate_report(reports)

    # Write report
    output_file = output_dir / "structure-validation.md"
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(report_text, encoding="utf-8")

    # Console summary
    total_errors = sum(len(r.errors) for r in reports)
    total_warnings = sum(len(r.warnings) for r in reports)

    print(f"Validated {len(reports)} layers")
    print(f"  🔴 Errors: {total_errors}")
    print(f"  ⚠️  Warnings: {total_warnings}")
    print(f"  ✓ Report: {output_file}")
    print()

    if total_errors > 0:
        return 1
    if strict and total_warnings > 0:
        return 1

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Documentation Robotics - Documentation Generation Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate relationship section for business layer
  python scripts/docs_generate.py --type relationships --layer 02-business

  # Generate relationship diagram
  python scripts/docs_generate.py --type diagram --layer 02-business

  # Validate all layer documentation structure
  python scripts/docs_generate.py --type validate-structure

  # Validate specific layer
  python scripts/docs_generate.py --type validate-structure --layer 02-business
        """
    )

    parser.add_argument(
        "--type",
        required=True,
        choices=["relationships", "diagram", "validate-structure"],
        help="Type of documentation to generate/validate"
    )
    parser.add_argument(
        "--layer",
        help="Layer ID (e.g., 02-business). Required for relationships/diagram."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/docs"),
        help="Output directory (default: reports/docs)"
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Preview output without writing files (relationships only)"
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors (validate-structure only)"
    )

    args = parser.parse_args()

    # Validate required arguments
    if args.type in ["relationships", "diagram"] and not args.layer:
        print("Error: --layer is required for relationships/diagram generation", file=sys.stderr)
        return 1

    print("Documentation Robotics - Documentation Generator")
    print("=" * 60)
    print()

    try:
        if args.type == "relationships":
            return generate_relationships(args.layer, args.output, args.preview)
        elif args.type == "diagram":
            return generate_diagram(args.layer, args.output)
        elif args.type == "validate-structure":
            return validate_structure(args.layer, args.output, args.strict)
        else:
            print(f"Unknown type: {args.type}", file=sys.stderr)
            return 1

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
