#!/usr/bin/env python3
"""Layer Documentation Generator - Generate relationship sections for layers.

Usage:
    python scripts/generate_layer_docs.py --layer 02-business
    python scripts/generate_layer_docs.py --layer 02-business --output-dir docs/generated
    python scripts/generate_layer_docs.py --all
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from generators.layer_doc_generator import LayerDocGenerator


def main():
    parser = argparse.ArgumentParser(
        description="Generate relationship documentation sections for layer files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate cross-layer section for business layer
  python scripts/generate_layer_docs.py --layer 02-business

  # Generate for all layers
  python scripts/generate_layer_docs.py --all

  # Specify output directory
  python scripts/generate_layer_docs.py --layer 04-application --output-dir reports/layer-docs
        """
    )

    parser.add_argument(
        "--layer",
        help="Layer ID to generate documentation for (e.g., 02-business)"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Generate documentation for all layers"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("reports/layer-docs"),
        help="Output directory for generated documentation (default: reports/layer-docs)"
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Preview output without writing files"
    )

    args = parser.parse_args()

    if not args.layer and not args.all:
        parser.print_help()
        return 1

    print("Documentation Robotics - Layer Documentation Generator")
    print("=" * 60)
    print()

    try:
        generator = LayerDocGenerator()

        # Get list of layers to process
        if args.all:
            layers = sorted(generator.layer_names.keys())
            print(f"Generating documentation for {len(layers)} layers...")
        else:
            layers = [args.layer]
            print(f"Generating documentation for layer: {args.layer}")

        print()

        # Process each layer
        for layer_id in layers:
            layer_name = generator.layer_names.get(layer_id, layer_id)
            print(f"Processing {layer_id}: {layer_name}...")

            # Generate content
            content = generator.generate_complete_cross_layer_section(layer_id)

            if args.preview:
                print()
                print("=" * 60)
                print(content)
                print("=" * 60)
                print()
            else:
                # Write to file
                output_file = args.output_dir / f"{layer_id}-cross-layer-relationships.md"
                output_file.parent.mkdir(parents=True, exist_ok=True)
                output_file.write_text(content, encoding="utf-8")
                print(f"  → {output_file}")

        print()
        print("✓ Documentation generation complete!")

        if not args.preview:
            print()
            print(f"Output directory: {args.output_dir}")
            print(f"Files generated: {len(layers)}")

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
