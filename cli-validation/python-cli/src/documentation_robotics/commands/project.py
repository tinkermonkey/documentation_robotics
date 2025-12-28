"""
Project an element to other layers.
"""

from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table

from ..core.model import Model

console = Console()


@click.command()
@click.argument("element-id")
@click.option("--to", "to_layers", required=True, help="Comma-separated target layers")
@click.option("--rule", help="Specific projection rule to use")
@click.option("--dry-run", is_flag=True, help="Show what would be created")
@click.option("--force", is_flag=True, help="Overwrite existing elements")
def project(element_id: str, to_layers: str, rule: Optional[str], dry_run: bool, force: bool):
    """Project an element to other layers."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Get source element
    source = model.get_element(element_id)
    if not source:
        console.print(f"✗ Error: Element '{element_id}' not found", style="red bold")
        raise click.Abort()

    # Initialize projection engine (already initialized in model)
    engine = model.projection_engine

    # Parse target layers
    target_layers = [layer.strip() for layer in to_layers.split(",")]

    console.print(f"\n[bold]Projecting element:[/bold] {element_id}")
    console.print(f"[bold]Target layers:[/bold] {', '.join(target_layers)}")

    # Project to each layer
    results = []

    for target_layer in target_layers:
        # Validate target layer
        if not model.get_layer(target_layer):
            console.print(f"⚠  Warning: Layer '{target_layer}' not found, skipping", style="yellow")
            continue

        try:
            # Find applicable rule
            applicable_rules = engine.find_applicable_rules(source, target_layer)

            if not applicable_rules:
                console.print(
                    f"⚠  Warning: No projection rule found for {source.layer} -> {target_layer}",
                    style="yellow",
                )
                continue

            projection_rule = applicable_rules[0]

            # Perform projection
            projected = engine.project_element(
                source, target_layer, rule=projection_rule, dry_run=dry_run
            )

            if projected:
                results.append((target_layer, projected))

        except Exception as e:
            console.print(f"✗ Error projecting to {target_layer}: {e}", style="red")

    # Display results
    if results:
        console.print("\n[bold green]✓ Projection successful[/bold green]\n")

        table = Table(title="Projected Elements")
        table.add_column("Target Layer", style="cyan")
        table.add_column("Element ID", style="white")
        table.add_column("Name", style="green")

        for target_layer, element in results:
            table.add_row(target_layer, element.id, element.name)

        console.print(table)

        if dry_run:
            console.print("\n[yellow]Dry run - elements not saved[/yellow]")
        else:
            # Save model
            model.save()
            console.print("\n[green]Model saved successfully[/green]")
    else:
        console.print("\n[yellow]No elements were projected[/yellow]")


@click.command()
@click.option("--from", "from_layer", help="Source layer filter")
@click.option("--to", "to_layer", help="Target layer filter")
@click.option("--dry-run", is_flag=True, help="Show what would be created")
def project_all(from_layer: Optional[str], to_layer: Optional[str], dry_run: bool):
    """Project all applicable elements."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Initialize projection engine
    engine = model.projection_engine

    console.print("[bold]Projecting all applicable elements...[/bold]\n")

    if from_layer:
        console.print(f"From layer: {from_layer}")
    if to_layer:
        console.print(f"To layer: {to_layer}")

    # Perform projections
    projected = engine.project_all(from_layer, to_layer, dry_run)

    # Display results
    if projected:
        console.print(f"\n[bold green]✓ Projected {len(projected)} element(s)[/bold green]\n")

        # Group by layer
        by_layer = {}
        for element in projected:
            if element.layer not in by_layer:
                by_layer[element.layer] = []
            by_layer[element.layer].append(element)

        for layer, elements in sorted(by_layer.items()):
            console.print(f"[bold]{layer}:[/bold]")
            for element in elements:
                console.print(f"  • {element.id} ({element.name})")

        if dry_run:
            console.print("\n[yellow]Dry run - elements not saved[/yellow]")
        else:
            # Save model
            model.save()
            console.print("\n[green]Model saved successfully[/green]")
    else:
        console.print("\n[yellow]No elements were projected[/yellow]")
