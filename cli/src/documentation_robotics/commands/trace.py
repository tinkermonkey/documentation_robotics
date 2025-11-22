"""
Trace dependencies between elements.
"""
import click
from pathlib import Path
from rich.console import Console
from rich.tree import Tree
from rich.table import Table
from typing import Optional
from ..core.model import Model
from ..core.dependency_tracker import DependencyTracker, TraceDirection

console = Console()


@click.command()
@click.argument("element-id")
@click.option(
    "--direction",
    type=click.Choice(["up", "down", "both"]),
    default="both",
    help="Direction to trace"
)
@click.option("--max-depth", type=int, help="Maximum depth to trace")
@click.option("--output", type=click.Choice(["tree", "table", "list"]), default="tree")
@click.option("--group-by-layer", is_flag=True, help="Group results by layer")
def trace(
    element_id: str,
    direction: str,
    max_depth: Optional[int],
    output: str,
    group_by_layer: bool
):
    """Trace dependencies for an element."""

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Get element
    element = model.get_element(element_id)
    if not element:
        console.print(f"✗ Error: Element '{element_id}' not found", style="red bold")
        raise click.Abort()

    # Initialize dependency tracker (already in model)
    tracker = model.dependency_tracker

    # Trace dependencies
    trace_dir = TraceDirection(direction)
    dependencies = tracker.trace_dependencies(element_id, trace_dir, max_depth)

    # Display results
    console.print(f"\n[bold]Tracing dependencies for:[/bold] {element_id}")
    console.print(f"[bold]Direction:[/bold] {direction}")
    if max_depth:
        console.print(f"[bold]Max depth:[/bold] {max_depth}")
    console.print()

    if not dependencies:
        console.print("[yellow]No dependencies found[/yellow]")
        return

    if group_by_layer:
        by_layer = tracker.get_dependency_layers(element_id)
        _display_grouped(by_layer, model)
    elif output == "tree":
        _display_tree(element, dependencies, tracker, direction)
    elif output == "table":
        _display_table(dependencies)
    else:  # list
        _display_list(dependencies)


def _display_grouped(by_layer: dict, model: Model):
    """Display dependencies grouped by layer."""
    for layer_name in sorted(by_layer.keys()):
        console.print(f"\n[bold cyan]{layer_name}:[/bold cyan] ({len(by_layer[layer_name])} elements)")

        for elem_id in sorted(by_layer[layer_name]):
            element = model.get_element(elem_id)
            if element:
                console.print(f"  • {elem_id}")
                console.print(f"    {element.name}", style="dim")


def _display_tree(source, dependencies, tracker, direction):
    """Display dependencies as a tree."""
    tree = Tree(f"[bold]{source.id}[/bold] ({source.name})")

    # Build tree structure
    graph = tracker.registry.get_dependency_graph()

    if direction == "up" or direction == "both":
        up_branch = tree.add("[cyan]Dependencies (what this uses)[/cyan]")
        if source.id in graph:
            for predecessor in graph.predecessors(source.id):
                element = tracker.model.get_element(predecessor)
                if element:
                    up_branch.add(f"{element.id} ({element.name})")

    if direction == "down" or direction == "both":
        down_branch = tree.add("[green]Dependents (what uses this)[/green]")
        if source.id in graph:
            for successor in graph.successors(source.id):
                element = tracker.model.get_element(successor)
                if element:
                    down_branch.add(f"{element.id} ({element.name})")

    console.print(tree)


def _display_table(dependencies):
    """Display dependencies as a table."""
    table = Table(title="Dependencies")
    table.add_column("Element ID", style="cyan")
    table.add_column("Layer", style="yellow")
    table.add_column("Type", style="magenta")
    table.add_column("Name", style="white")

    for dep in sorted(dependencies, key=lambda x: (x.layer, x.id)):
        table.add_row(dep.id, dep.layer, dep.type, dep.name)

    console.print(table)


def _display_list(dependencies):
    """Display dependencies as a simple list."""
    for dep in sorted(dependencies, key=lambda x: x.id):
        console.print(f"  • {dep.id}")
        console.print(f"    [{dep.layer}] {dep.name}", style="dim")
