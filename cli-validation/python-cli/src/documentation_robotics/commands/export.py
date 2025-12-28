"""
Export model to various formats.
"""

import json
import sys
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table

from ..core.model import Model
from ..export.export_manager import ExportFormat, ExportManager, ExportOptions
from ..export.source_map_exporter import SourceMapExporter

console = Console()


@click.group(invoke_without_command=True)
@click.option(
    "--format",
    "format_name",
    type=click.Choice(
        ["archimate", "openapi", "schema", "plantuml", "markdown", "graphml", "navigation", "all"]
    ),
    default=None,
    help="Export format (for backward compatibility)",
)
@click.option("--layer", help="Export specific layer only")
@click.option("--output", type=click.Path(), help="Output directory")
@click.option("--filter", "element_filter", help="Filter by element type")
@click.option("--validate/--no-validate", default=True, help="Validate output")
@click.pass_context
def export(
    ctx: click.Context,
    format_name: Optional[str],
    layer: Optional[str],
    output: Optional[str],
    element_filter: Optional[str],
    validate: bool,
):
    """Export model to various formats."""
    # If a subcommand is invoked, let it handle the call
    if ctx.invoked_subcommand is not None:
        return

    # Otherwise, handle the backward-compatible export behavior
    if format_name is None:
        # No subcommand and no --format, show help
        console.print(ctx.get_help())
        return

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Initialize export manager
    export_mgr = ExportManager(model)

    console.print("[bold]Exporting model...[/bold]\n")

    # Determine output path
    output_path = Path(output) if output else None

    # Export
    try:
        if format_name == "all":
            # Export all formats
            results = export_mgr.export_all(output_dir=output_path)

            # Display results
            table = Table(title="Export Results")
            table.add_column("Format", style="cyan")
            table.add_column("Output", style="white")
            table.add_column("Status", style="green")

            for fmt, path in results.items():
                table.add_row(fmt.value, str(path), "✓")

            console.print(table)

        else:
            # Export single format
            fmt = ExportFormat(format_name)
            result_path = export_mgr.export(
                fmt,
                output_path,
                layer_filter=layer,
                element_type_filter=element_filter,
                validate_output=validate,
            )

            console.print("\n✓ [green bold]Export successful[/green bold]")
            console.print(f"   Output: {result_path}")

    except Exception as e:
        console.print(f"✗ Error during export: {e}", style="red bold")
        raise click.Abort()


@export.command(name="source-map")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["json"]),
    default="json",
    help="Output format",
)
@click.option("--output", type=click.Path(), help="Output file (defaults to stdout)")
@click.option("--layer", help="Filter by specific layer")
def source_map(output_format: str, output: Optional[str], layer: Optional[str]):
    """Export source code map for IDE integration.

    Generates a JSON file mapping source files to DR model entities,
    enabling IDE plugins to provide "jump to architecture" features.
    """

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Generate source map
    try:
        # Create exporter with options
        output_path = Path(output) if output else Path.cwd() / ".dr"
        options = ExportOptions(
            format=ExportFormat.SOURCE_MAP,
            output_path=output_path.parent,
            layer_filter=layer,
        )
        exporter = SourceMapExporter(model, options)

        if output:
            # Write to specified file
            result = exporter.export()
            console.print("[green bold]✓ Source map exported successfully[/green bold]")
            console.print(f"   Output: {result}")
        else:
            # Output to stdout
            source_map_data = exporter._generate_source_map()
            json.dump(source_map_data, sys.stdout, indent=2)

    except Exception as e:
        console.print(f"✗ Error generating source map: {e}", style="red bold")
        raise click.Abort()
