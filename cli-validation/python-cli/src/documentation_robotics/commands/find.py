"""
Find and display an element.
"""

import json
from pathlib import Path

import click
import yaml
from rich.console import Console
from rich.panel import Panel

from ..core.model import Model
from ..utils.output import print_element_table

console = Console()


@click.command()
@click.argument("element-id")
@click.option("--output", type=click.Choice(["yaml", "json", "table"]), default="yaml")
@click.option("--show-refs", is_flag=True, help="Show cross-references")
@click.option("--show-deps", is_flag=True, help="Show dependencies")
def find(element_id: str, output: str, show_refs: bool, show_deps: bool):
    """Find and display an element by ID."""

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

        # Suggest similar elements
        parts = element_id.split(".")
        if len(parts) >= 1:
            layer = parts[0]
            similar = model.find_elements(layer=layer)
            if similar:
                console.print(f"\nSimilar elements in '{layer}' layer:")
                for elem in similar[:5]:
                    console.print(f"  - {elem.id}")

        raise click.Abort()

    # Display element
    if output == "yaml":
        console.print(
            Panel(
                yaml.dump(element.to_dict(), default_flow_style=False),
                title=f"Element: {element_id}",
                border_style="blue",
            )
        )

    elif output == "json":
        console.print(json.dumps(element.to_dict(), indent=2))

    elif output == "table":
        print_element_table([element])

    # Show references if requested
    if show_refs:
        console.print("\n[bold]Cross-references:[/bold]")
        console.print("[yellow]Cross-reference tracking will be added in Phase 2[/yellow]")

    # Show dependencies if requested
    if show_deps:
        console.print("\n[bold]Dependencies:[/bold]")
        deps = model.find_dependencies(element_id)
        if deps:
            for dep in deps:
                console.print(f"  - {dep.id} ({dep.layer})")
        else:
            console.print("  No dependencies found")
