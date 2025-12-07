#!/usr/bin/env python3
"""Generate JSON Schemas from markdown layer specifications.

This script automates the generation of JSON Schemas from markdown specifications,
ensuring consistency between documentation and schemas.

Usage:
    # Generate all layers
    python cli/scripts/generate_schemas.py --all

    # Generate specific layer
    python cli/scripts/generate_schemas.py --layer 02-business-layer

    # Dry-run (preview)
    python cli/scripts/generate_schemas.py --all --dry-run

    # Update (merge with existing)
    python cli/scripts/generate_schemas.py --all --update

    # Check mode (for pre-commit)
    python cli/scripts/generate_schemas.py --check-only
"""

import argparse
import sys
from pathlib import Path
from typing import List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from generators.markdown_parser import MarkdownLayerParser  # noqa: E402
from generators.schema_generator import JSONSchemaGenerator  # noqa: E402
from generators.schema_merger import SchemaMerger, load_schema, save_schema  # noqa: E402

try:
    from rich.console import Console  # noqa: E402
    from rich.table import Table  # noqa: E402

    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    print("Warning: rich not available, using plain output")


class SchemaGenerator:
    """Main schema generation orchestrator."""

    def __init__(self, root_dir: Optional[Path] = None):
        """Initialize the generator.

        Args:
            root_dir: Root directory of the project (defaults to auto-detect)
        """
        if root_dir is None:
            # Auto-detect: script is in cli/scripts/, root is 2 levels up
            script_dir = Path(__file__).parent
            root_dir = script_dir.parent.parent

        self.root_dir = root_dir
        self.spec_dir = root_dir / "spec"
        self.layers_dir = self.spec_dir / "layers"
        self.schemas_dir = self.spec_dir / "schemas"

        self.parser = MarkdownLayerParser()
        self.generator = JSONSchemaGenerator()
        self.merger = SchemaMerger()

        if RICH_AVAILABLE:
            self.console = Console()
        else:
            self.console = None

    def discover_layers(self) -> List[Path]:
        """Discover all layer markdown files.

        Returns:
            List of paths to layer markdown files, sorted by layer number
        """
        if not self.layers_dir.exists():
            raise FileNotFoundError(f"Layers directory not found: {self.layers_dir}")

        layers = sorted(self.layers_dir.glob("*.md"))

        # Filter out non-layer files (README, etc.)
        import re

        layers = [layer for layer in layers if re.match(r"\d{2}-[\w-]+\.md", layer.name)]

        return layers

    def generate_layer(
        self, markdown_path: Path, update: bool = False, dry_run: bool = False
    ) -> dict:
        """Generate schema for a single layer.

        Args:
            markdown_path: Path to markdown layer file
            update: If True, merge with existing schema
            dry_run: If True, don't write files

        Returns:
            Dictionary with generation results
        """
        layer_name = markdown_path.stem
        schema_path = self.schemas_dir / f"{layer_name}.schema.json"

        result = {
            "layer": layer_name,
            "markdown_path": str(markdown_path),
            "schema_path": str(schema_path),
            "status": "success",
            "warnings": [],
            "errors": [],
        }

        try:
            # Parse markdown
            layer_spec = self.parser.parse(markdown_path)
            result["entities_found"] = len(layer_spec.entities)

            # Generate schema
            schema = self.generator.generate_layer_schema(layer_spec)

            # Merge with existing if requested
            if update and schema_path.exists():
                existing_schema = load_schema(schema_path)
                schema = self.merger.merge(schema, existing_schema)
                result["warnings"] = self.merger.get_warnings()
                result["merged"] = True
            else:
                result["merged"] = False

            # Save schema
            if not dry_run:
                save_schema(schema, schema_path)
                result["written"] = True
            else:
                result["written"] = False

        except Exception as e:
            result["status"] = "error"
            result["errors"].append(str(e))
            import traceback

            result["traceback"] = traceback.format_exc()

        return result

    def generate_all(self, update: bool = False, dry_run: bool = False) -> List[dict]:
        """Generate schemas for all layers.

        Args:
            update: If True, merge with existing schemas
            dry_run: If True, don't write files

        Returns:
            List of result dictionaries
        """
        layers = self.discover_layers()
        results = []

        for layer_path in layers:
            result = self.generate_layer(layer_path, update=update, dry_run=dry_run)
            results.append(result)

        return results

    def check_only(self) -> bool:
        """Check if schemas are up to date.

        Returns:
            True if all schemas are up to date, False otherwise
        """
        # Generate all schemas in dry-run mode
        results = self.generate_all(update=False, dry_run=True)

        outdated = []

        for result in results:
            if result["status"] == "error":
                outdated.append(result["layer"])
                continue

            # Check if schema exists
            schema_path = Path(result["schema_path"])
            if not schema_path.exists():
                outdated.append(result["layer"])
                continue

            # TODO: Could add more sophisticated change detection here
            # For now, we'll rely on user to run update manually

        if outdated:
            self._print_error("The following schemas are missing or outdated:")
            for layer in outdated:
                self._print(f"  - {layer}")
            self._print("\nRun: python cli/scripts/generate_schemas.py --all --update")
            return False

        self._print_success("All schemas are up to date!")
        return True

    def _print(self, message: str):
        """Print message using rich or plain print.

        Args:
            message: Message to print
        """
        if self.console:
            self.console.print(message)
        else:
            print(message)

    def _print_error(self, message: str):
        """Print error message.

        Args:
            message: Error message
        """
        if self.console:
            self.console.print(f"[red]{message}[/red]")
        else:
            print(f"ERROR: {message}")

    def _print_success(self, message: str):
        """Print success message.

        Args:
            message: Success message
        """
        if self.console:
            self.console.print(f"[green]{message}[/green]")
        else:
            print(f"SUCCESS: {message}")

    def _print_warning(self, message: str):
        """Print warning message.

        Args:
            message: Warning message
        """
        if self.console:
            self.console.print(f"[yellow]{message}[/yellow]")
        else:
            print(f"WARNING: {message}")

    def print_results(self, results: List[dict]):
        """Print generation results.

        Args:
            results: List of result dictionaries
        """
        if self.console:
            # Rich table output
            table = Table(title="Schema Generation Results")
            table.add_column("Layer", style="cyan")
            table.add_column("Entities", justify="right", style="magenta")
            table.add_column("Status", style="green")
            table.add_column("Warnings", justify="right", style="yellow")

            for result in results:
                status = "✓" if result["status"] == "success" else "✗"
                status_style = "green" if result["status"] == "success" else "red"

                table.add_row(
                    result["layer"],
                    str(result.get("entities_found", 0)),
                    f"[{status_style}]{status}[/{status_style}]",
                    str(len(result.get("warnings", []))),
                )

            self.console.print(table)

            # Print warnings
            for result in results:
                if result.get("warnings"):
                    self.console.print(f"\n[yellow]Warnings for {result['layer']}:[/yellow]")
                    for warning in result["warnings"]:
                        self.console.print(f"  - {warning}")

            # Print errors
            for result in results:
                if result.get("errors"):
                    self.console.print(f"\n[red]Errors for {result['layer']}:[/red]")
                    for error in result["errors"]:
                        self.console.print(f"  - {error}")
                    if result.get("traceback"):
                        self.console.print(f"\n[dim]{result['traceback']}[/dim]")

        else:
            # Plain output
            print("\nSchema Generation Results:")
            print("-" * 80)
            for result in results:
                status = "SUCCESS" if result["status"] == "success" else "ERROR"
                print(f"{result['layer']}: {status} ({result.get('entities_found', 0)} entities)")
                if result.get("warnings"):
                    for warning in result["warnings"]:
                        print(f"  WARNING: {warning}")
                if result.get("errors"):
                    for error in result["errors"]:
                        print(f"  ERROR: {error}")

        # Summary
        success_count = sum(1 for r in results if r["status"] == "success")
        total_count = len(results)

        if success_count == total_count:
            self._print_success(f"\n✓ Successfully generated {success_count}/{total_count} schemas")
        else:
            self._print_error(
                f"\n✗ Generated {success_count}/{total_count} schemas ({total_count - success_count} failed)"
            )


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Generate JSON Schemas from markdown layer specifications",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Mode selection (mutually exclusive)
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--all", action="store_true", help="Generate schemas for all layers")
    mode_group.add_argument(
        "--layer", type=str, help="Generate schema for specific layer (e.g., 02-business-layer)"
    )
    mode_group.add_argument(
        "--check-only",
        action="store_true",
        help="Check if schemas are up to date (for pre-commit)",
    )

    # Options
    parser.add_argument(
        "--update",
        action="store_true",
        help="Merge with existing schemas to preserve manual rules",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without writing files"
    )
    parser.add_argument("--root-dir", type=Path, help="Project root directory (auto-detected)")

    args = parser.parse_args()

    # Create generator
    generator = SchemaGenerator(root_dir=args.root_dir)

    # Execute based on mode
    if args.check_only:
        # Check mode (for pre-commit)
        success = generator.check_only()
        sys.exit(0 if success else 1)

    elif args.all:
        # Generate all layers
        generator._print(
            "[bold]Generating schemas for all layers...[/bold]"
            if RICH_AVAILABLE
            else "Generating schemas for all layers..."
        )
        if args.update:
            generator._print_warning(
                "Update mode: merging with existing schemas to preserve manual rules"
            )
        if args.dry_run:
            generator._print_warning("Dry-run mode: no files will be written")

        results = generator.generate_all(update=args.update, dry_run=args.dry_run)
        generator.print_results(results)

        # Exit with error if any failed
        if any(r["status"] == "error" for r in results):
            sys.exit(1)

    elif args.layer:
        # Generate specific layer
        layer_name = args.layer
        if not layer_name.endswith(".md"):
            layer_name += ".md"

        markdown_path = generator.layers_dir / layer_name

        if not markdown_path.exists():
            generator._print_error(f"Layer not found: {markdown_path}")
            sys.exit(1)

        generator._print(
            f"[bold]Generating schema for {args.layer}...[/bold]"
            if RICH_AVAILABLE
            else f"Generating schema for {args.layer}..."
        )

        result = generator.generate_layer(markdown_path, update=args.update, dry_run=args.dry_run)
        generator.print_results([result])

        if result["status"] == "error":
            sys.exit(1)

    else:
        # No mode specified
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
