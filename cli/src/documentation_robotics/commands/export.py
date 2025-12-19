"""
Export model to various formats.
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table

from ..core.model import Model
from ..export.export_manager import ExportFormat, ExportManager

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
        source_map_data = _generate_source_map(model, layer_filter=layer)

        if output:
            # Write to file
            output_path = Path(output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "w") as f:
                json.dump(source_map_data, f, indent=2)
            console.print("[green bold]✓ Source map exported successfully[/green bold]")
            console.print(f"   Output: {output_path}")
        else:
            # Output to stdout
            json.dump(source_map_data, sys.stdout, indent=2)

    except Exception as e:
        console.print(f"✗ Error generating source map: {e}", style="red bold")
        raise click.Abort()


def _generate_source_map(model: Model, layer_filter: Optional[str] = None) -> dict:
    """Generate source map from model.

    Args:
        model: The architecture model
        layer_filter: Optional layer name to filter by

    Returns:
        Source map dictionary with version, timestamp, and mappings
    """
    source_map = {
        "version": model.manifest.version,
        "generated": datetime.utcnow().isoformat() + "Z",
        "sourceMap": [],
    }

    # Iterate through all layers
    for layer_name, layer in model.layers.items():
        # Skip if filtering by layer
        if layer_filter and layer_name != layer_filter:
            continue

        # Process all elements in the layer
        for element_id, element in layer.elements.items():
            # Extract source references
            source_entries = _extract_source_references(element, layer_name)
            source_map["sourceMap"].extend(source_entries)

    return source_map


def _extract_source_references(element, layer_name: str) -> list:
    """Extract source references from an element.

    Args:
        element: The architecture element
        layer_name: Name of the layer containing the element

    Returns:
        List of source map entries for this element
    """
    entries = []

    # Check for source reference in properties
    source_ref = element.data.get("properties", {}).get("source", {}).get("reference")

    # Fall back to x-source-reference (OpenAPI-style)
    if not source_ref:
        source_ref = element.data.get("x-source-reference")

    if not source_ref:
        return entries

    # Process each location in the source reference
    locations = source_ref.get("locations", [])
    for location in locations:
        entry = {
            "file": location.get("file"),
            "symbol": location.get("symbol"),
            "entity": {
                "id": element.id,
                "layer": layer_name,
                "type": element.type,
                "name": element.data.get("name"),
            },
            "provenance": source_ref.get("provenance"),
        }

        # Add commit hash if available
        repository = source_ref.get("repository", {})
        if repository.get("commit"):
            entry["commit"] = repository["commit"]

        entries.append(entry)

    return entries
