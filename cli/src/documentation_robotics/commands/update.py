"""
Update an existing element.
"""

from pathlib import Path

import click
import yaml
from rich.console import Console

console = Console()


@click.command()
@click.argument("element-id")
@click.option("--spec", type=click.File("r"), help="YAML/JSON spec file with updates")
@click.option("--set", "-s", multiple=True, help="Set property (key=value)")
@click.option("--dry-run", is_flag=True, help="Show what would be updated")
def update(element_id: str, spec: click.File, set: tuple, dry_run: bool):
    """Update an existing element."""

    # Load model (with changeset context if active)
    try:
        from .utils import load_model_with_changeset_context

        model = load_model_with_changeset_context(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Find element
    element = model.get_element(element_id)
    if not element:
        console.print(f"✗ Error: Element '{element_id}' not found", style="red bold")
        raise click.Abort()

    # Prepare updates
    updates = {}

    # Load from spec file if provided
    if spec:
        updates = yaml.safe_load(spec)

    # Apply individual property updates
    for prop in set:
        if "=" not in prop:
            console.print(f"✗ Error: Invalid property format: {prop}", style="red bold")
            console.print("   Expected format: key=value")
            raise click.Abort()

        key, value = prop.split("=", 1)
        updates[key] = value

    if not updates:
        console.print("[yellow]No updates specified[/yellow]")
        console.print("Use --spec or --set to specify updates")
        return

    # Show what will be updated
    console.print(f"\n[bold]Updating element: {element_id}[/bold]")
    console.print("\nUpdates:")
    console.print(yaml.dump(updates, default_flow_style=False))

    if dry_run:
        console.print("\n[yellow]Dry run - not saving[/yellow]")
        return

    # Apply updates
    try:
        model.update_element(element_id, updates)
        console.print(f"\n✓ Successfully updated element: {element_id}", style="green bold")
    except ValueError as e:
        console.print(f"✗ Error: {e}", style="red bold")
        raise click.Abort()
