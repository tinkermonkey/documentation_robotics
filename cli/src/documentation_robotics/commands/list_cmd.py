"""
List elements in a layer.
"""

from pathlib import Path

import click
from rich.console import Console

from ..core.model import Model
from ..utils.output import print_element_table

console = Console()


@click.command(name="list")
@click.argument("layer")
@click.argument("element-type", required=False)
@click.option("--output", type=click.Choice(["table", "yaml", "json"]), default="table")
@click.option("--sort", default="name", help="Sort by field (name, id, type)")
@click.option("--limit", type=int, help="Limit number of results")
def list_elements(layer: str, element_type: str, output: str, sort: str, limit: int):
    """List elements in a layer."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Validate layer exists
    layer_obj = model.get_layer(layer)
    if not layer_obj:
        console.print(f"✗ Error: Layer '{layer}' not found", style="red bold")
        available = ", ".join(model.layers.keys())
        console.print(f"   Available layers: {available}")
        raise click.Abort()

    # Find elements
    elements = layer_obj.find_elements(element_type=element_type)

    # Sort elements
    if sort == "name":
        elements.sort(key=lambda e: e.name)
    elif sort == "id":
        elements.sort(key=lambda e: e.id)
    elif sort == "type":
        elements.sort(key=lambda e: e.type)

    # Apply limit
    if limit:
        elements = elements[:limit]

    # Display
    if not elements:
        console.print(f"[yellow]No elements found in '{layer}' layer[/yellow]")
        return

    console.print(f"\n[bold]{layer.capitalize()} Layer[/bold] - {len(elements)} element(s)\n")

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
