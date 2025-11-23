"""
Validate the model.
"""

import json
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from ..core.model import Model

console = Console()


@click.command()
@click.option("--layer", help="Validate specific layer only")
@click.option("--element", help="Validate specific element only")
@click.option("--strict", is_flag=True, help="Strict validation mode")
@click.option("--output", type=click.Choice(["text", "json"]), default="text")
def validate(layer: str, element: str, strict: bool, output: str):
    """Validate the model."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    console.print("[bold]Validating model...[/bold]\n")

    # Perform validation
    result = model.validate(strict=strict)

    # Display results
    if output == "text":
        _display_text_results(result, model)
    elif output == "json":
        console.print(json.dumps(result.to_dict(), indent=2))

    # Update manifest
    if result.is_valid():
        model.manifest.update_validation_status("passed")
        model.manifest.save()
    else:
        model.manifest.update_validation_status("failed")
        model.manifest.save()

    # Exit with appropriate code
    if not result.is_valid():
        raise click.exceptions.Exit(1)


def _display_text_results(result, model):
    """Display validation results in text format."""

    # Summary table
    table = Table(title="Validation Summary")
    table.add_column("Layer", style="cyan")
    table.add_column("Elements", justify="right")
    table.add_column("Errors", justify="right", style="red")
    table.add_column("Warnings", justify="right", style="yellow")
    table.add_column("Status", justify="center")

    for layer_name, layer in model.layers.items():
        errors = len([e for e in result.errors if e.layer == layer_name])
        warnings = len([w for w in result.warnings if w.layer == layer_name])

        status = "✓" if errors == 0 else "✗"
        status_style = "green" if errors == 0 else "red"

        table.add_row(
            layer_name,
            str(len(layer.elements)),
            str(errors),
            str(warnings),
            f"[{status_style}]{status}[/{status_style}]",
        )

    console.print(table)

    # Show errors
    if result.errors:
        console.print("\n[bold red]Errors:[/bold red]")
        for error in result.errors:
            console.print(f"  ✗ [{error.layer}] {error.element_id}: {error.message}")
            if error.fix_suggestion:
                console.print(f"     Fix: {error.fix_suggestion}")

    # Show warnings
    if result.warnings:
        console.print("\n[bold yellow]Warnings:[/bold yellow]")
        for warning in result.warnings:
            console.print(f"  ⚠  [{warning.layer}] {warning.element_id}: {warning.message}")

    # Overall status
    console.print()
    if result.is_valid():
        console.print("✓ [green bold]Validation passed[/green bold]")
    else:
        console.print("✗ [red bold]Validation failed[/red bold]")
        console.print(f"   {len(result.errors)} error(s), {len(result.warnings)} warning(s)")
