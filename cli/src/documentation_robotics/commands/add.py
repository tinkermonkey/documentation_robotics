"""
Add an element to the model.
"""
import click
from pathlib import Path
from rich.console import Console
from typing import Optional
import yaml
from ..core.model import Model
from ..core.element import Element
from ..utils.id_generator import generate_element_id

console = Console()


@click.command()
@click.argument("layer")
@click.argument("element-type")
@click.option("--name", required=True, help="Element name")
@click.option("--spec", type=click.File("r"), help="YAML/JSON spec file")
@click.option("--id", "custom_id", help="Custom element ID")
@click.option("--description", help="Element description")
@click.option("--property", "-p", multiple=True, help="Additional properties (key=value)")
@click.option("--project-to", help="Comma-separated list of layers to project to")
@click.option("--dry-run", is_flag=True, help="Show what would be created")
def add(
    layer: str,
    element_type: str,
    name: str,
    spec: Optional[click.File],
    custom_id: Optional[str],
    description: Optional[str],
    property: tuple,
    project_to: Optional[str],
    dry_run: bool
):
    """Add an element to a layer."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        console.print("   Run 'dr init <project-name>' first")
        raise click.Abort()

    # Validate layer exists
    if not model.get_layer(layer):
        console.print(f"✗ Error: Layer '{layer}' not found", style="red bold")
        available = ", ".join(model.layers.keys())
        console.print(f"   Available layers: {available}")
        raise click.Abort()

    # Parse spec if provided
    element_data = {}
    if spec:
        element_data = yaml.safe_load(spec)

    # Add basic attributes
    element_data["name"] = name
    if description:
        element_data["description"] = description

    # Parse additional properties
    for prop in property:
        if "=" not in prop:
            console.print(f"✗ Error: Invalid property format: {prop}", style="red bold")
            console.print("   Expected format: key=value")
            raise click.Abort()

        key, value = prop.split("=", 1)
        element_data[key] = value

    # Generate or use custom ID
    element_id = custom_id or generate_element_id(layer, element_type, name)
    element_data["id"] = element_id

    # Create element
    element = Element(
        id=element_id,
        element_type=element_type,
        layer=layer,
        data=element_data
    )

    # Show what will be created
    console.print(f"\n[bold]Creating element:[/bold]")
    console.print(f"  Layer: {layer}")
    console.print(f"  Type: {element_type}")
    console.print(f"  Name: {name}")
    console.print(f"  ID: {element_id}")

    if dry_run:
        console.print("\n[yellow]Dry run - not saving[/yellow]")
        console.print("\nElement data:")
        console.print(yaml.dump(element_data, default_flow_style=False))
        return

    # Add to model
    try:
        model.add_element(layer, element)
        console.print(f"\n✓ Successfully added element: {element_id}", style="green bold")

        # Handle projection if requested
        if project_to:
            console.print(f"\n[yellow]Note: Projection to {project_to} requested[/yellow]")
            console.print("       Projection is not available in Phase 1")
            console.print("       This feature will be added in Phase 2")

    except ValueError as e:
        console.print(f"✗ Error: {e}", style="red bold")
        raise click.Abort()
    except Exception as e:
        console.print(f"✗ Unexpected error: {e}", style="red bold")
        raise
