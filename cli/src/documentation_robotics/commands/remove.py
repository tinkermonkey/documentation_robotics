"""
Remove an element from the model.
"""

from pathlib import Path

import click
from rich.console import Console

from ..core.model import Model

console = Console()


@click.command()
@click.argument("element-id")
@click.option("--force", is_flag=True, help="Skip dependency checks")
@click.option("--cascade", is_flag=True, help="Remove dependent elements")
@click.option("--dry-run", is_flag=True, help="Show what would be removed")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt")
def remove(element_id: str, force: bool, cascade: bool, dry_run: bool, yes: bool):
    """Remove an element from the model."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Find element
    element = model.get_element(element_id)
    if not element:
        console.print(f"✗ Error: Element '{element_id}' not found", style="red bold")
        raise click.Abort()

    # Check dependencies
    dependencies = model.find_dependencies(element_id)

    console.print(f"\n[bold]Removing element: {element_id}[/bold]")
    console.print(f"  Layer: {element.layer}")
    console.print(f"  Type: {element.type}")
    console.print(f"  Name: {element.name}")

    if dependencies:
        console.print(
            f"\n[yellow]Warning: This element has {len(dependencies)} "
            f"dependent element(s):[/yellow]"
        )
        for dep in dependencies[:5]:
            console.print(f"  - {dep.id}")
        if len(dependencies) > 5:
            console.print(f"  ... and {len(dependencies) - 5} more")

        if not cascade and not force:
            console.print("\n[red]Cannot remove element with dependencies.[/red]")
            console.print("Use --cascade to remove all dependent elements")
            console.print("or --force to skip dependency checks")
            raise click.Abort()

    if dry_run:
        console.print("\n[yellow]Dry run - not removing[/yellow]")
        if cascade and dependencies:
            console.print(f"Would remove {len(dependencies) + 1} element(s)")
        return

    # Confirm removal
    if not yes:
        if cascade and dependencies:
            message = f"Remove {element_id} and {len(dependencies)} dependent element(s)?"
        else:
            message = f"Remove {element_id}?"

        if not click.confirm(message):
            console.print("Cancelled")
            raise click.Abort()

    # Remove element
    try:
        model.remove_element(element_id, cascade=cascade or force)
        console.print(f"\n✓ Successfully removed element: {element_id}", style="green bold")
    except ValueError as e:
        console.print(f"✗ Error: {e}", style="red bold")
        raise click.Abort()
