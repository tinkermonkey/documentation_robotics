"""
Export model to various formats.
"""

from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table

from ..core.model import Model
from ..export.export_manager import ExportFormat, ExportManager

console = Console()


@click.command()
@click.option(
    "--format",
    "format_name",
    type=click.Choice(["archimate", "openapi", "schema", "plantuml", "markdown", "graphml", "all"]),
    default="all",
    help="Export format",
)
@click.option("--layer", help="Export specific layer only")
@click.option("--output", type=click.Path(), help="Output directory")
@click.option("--filter", "element_filter", help="Filter by element type")
@click.option("--validate/--no-validate", default=True, help="Validate output")
def export(
    format_name: str,
    layer: Optional[str],
    output: Optional[str],
    element_filter: Optional[str],
    validate: bool,
):
    """Export model to various formats."""

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
