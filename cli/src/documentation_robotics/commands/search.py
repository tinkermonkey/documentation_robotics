"""
Search for elements across layers.
"""

from pathlib import Path

import click
from rich.console import Console

from ..core.model import Model
from ..utils.output import print_element_table

console = Console()


@click.command()
@click.option("--layer", help="Filter by layer")
@click.option("--type", "element_type", help="Filter by element type")
@click.option("--name", "name_pattern", help="Filter by name pattern (supports wildcards)")
@click.option("--property", "-p", multiple=True, help="Filter by property (key=value)")
@click.option("--output", type=click.Choice(["table", "yaml", "json"]), default="table")
@click.option("--limit", type=int, help="Limit number of results")
def search(
    layer: str, element_type: str, name_pattern: str, property: tuple, output: str, limit: int
):
    """Search for elements across layers."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Parse properties
    properties = {}
    for prop in property:
        if "=" not in prop:
            console.print(f"✗ Error: Invalid property format: {prop}", style="red bold")
            console.print("   Expected format: key=value")
            raise click.Abort()

        key, value = prop.split("=", 1)
        properties[key] = value

    # Search
    elements = model.find_elements(
        layer=layer, element_type=element_type, name_pattern=name_pattern, **properties
    )

    # Apply limit
    if limit:
        elements = elements[:limit]

    # Display results
    if not elements:
        console.print("[yellow]No elements found matching criteria[/yellow]")
        return

    console.print(f"\n[bold]Search Results[/bold] - {len(elements)} element(s) found\n")

    if output == "table":
        print_element_table(elements)
    elif output == "yaml":
        import yaml

        for element in elements:
            console.print(yaml.dump({element.id: element.to_dict()}, default_flow_style=False))
    elif output == "json":
        import json

        data = {e.id: e.to_dict() for e in elements}
        console.print(json.dumps(data, indent=2))
