"""
Add an element to the model.
"""

from pathlib import Path
from typing import Optional

import click
import yaml
from rich.console import Console

from ..core.element import Element
from ..schemas.bundler import get_bundled_schemas_dir
from ..schemas.registry import EntityTypeRegistry
from ..utils.id_generator import generate_element_id

console = Console()


@click.command()
@click.argument("layer", required=False)
@click.argument("element-type", required=False)
@click.option("--name", help="Element name")
@click.option("--spec", type=click.File("r"), help="YAML/JSON spec file")
@click.option("--id", "custom_id", help="Custom element ID")
@click.option("--description", help="Element description")
@click.option("--property", "-p", multiple=True, help="Additional properties (key=value)")
@click.option("--project-to", help="Comma-separated list of layers to project to")
@click.option("--dry-run", is_flag=True, help="Show what would be created")
@click.option("--interactive", "-i", is_flag=True, help="Use interactive wizard")
def add(
    layer: Optional[str],
    element_type: Optional[str],
    name: Optional[str],
    spec: Optional[click.File],
    custom_id: Optional[str],
    description: Optional[str],
    property: tuple,
    project_to: Optional[str],
    dry_run: bool,
    interactive: bool,
):
    """Add an element to a layer."""

    # Load model (with changeset context if active)
    try:
        from .utils import load_model_with_changeset_context

        model = load_model_with_changeset_context(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        console.print("   Run 'dr init <project-name>' first")
        raise click.Abort()

    # Interactive mode
    if interactive:
        from ..interactive.wizard import ElementWizard

        wizard = ElementWizard(model)
        result = wizard.run()

        if result is None:
            return

        layer = result["layer"]
        element_type = result["element_type"]
        element_data = result["data"]
        name = element_data.get("name")
        custom_id = element_data.get("id")
    else:
        # Validate required arguments in non-interactive mode
        if not layer or not element_type:
            console.print("✗ Error: layer and element-type are required", style="red bold")
            console.print("   Use --interactive/-i for guided creation")
            raise click.Abort()

        if not name:
            console.print("✗ Error: --name is required", style="red bold")
            raise click.Abort()

    # Validate layer exists
    if not model.get_layer(layer):
        console.print(f"✗ Error: Layer '{layer}' not found", style="red bold")
        available = ", ".join(model.layers.keys())
        console.print(f"   Available layers: {available}")
        raise click.Abort()

    # Validate entity type is valid for this layer
    registry = EntityTypeRegistry()
    schema_dir = get_bundled_schemas_dir()
    registry.build_from_schemas(schema_dir)

    if not registry.is_valid_type(layer, element_type):
        console.print(
            f"✗ Error: Invalid entity type '{element_type}' for layer '{layer}'",
            style="red bold",
        )
        valid_types = registry.get_valid_types(layer)
        if valid_types:
            console.print(f"\n   Valid entity types for '{layer}' layer:")
            for vtype in sorted(valid_types):
                console.print(f"     • {vtype}")
        else:
            console.print(f"\n   No entity types found for layer '{layer}'")
        raise click.Abort()

    # Parse spec if provided (only in non-interactive mode)
    if not interactive:
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
    else:
        element_id = element_data.get("id")

    # Create element
    element = Element(id=element_id, element_type=element_type, layer=layer, data=element_data)

    # Show what will be created
    console.print("\n[bold]Creating element:[/bold]")
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
