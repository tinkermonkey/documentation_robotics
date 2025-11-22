"""
Output formatting utilities.
"""
from typing import Any, Dict, List
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import yaml
import json

console = Console()


def format_yaml(data: Dict[str, Any]) -> str:
    """Format data as YAML string."""
    return yaml.dump(data, default_flow_style=False, sort_keys=False)


def format_json(data: Dict[str, Any], indent: int = 2) -> str:
    """Format data as JSON string."""
    return json.dumps(data, indent=indent)


def print_element_table(elements: List[Any]) -> None:
    """
    Print elements in a table format.

    Args:
        elements: List of Element objects
    """
    if not elements:
        console.print("[yellow]No elements found[/yellow]")
        return

    table = Table(title="Elements")
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Name", style="white")
    table.add_column("Type", style="green")
    table.add_column("Layer", style="blue")

    for element in elements:
        table.add_row(
            element.id,
            element.name,
            element.type,
            element.layer
        )

    console.print(table)


def print_error(message: str) -> None:
    """Print error message."""
    console.print(f"[red bold]✗ Error: {message}[/red bold]")


def print_success(message: str) -> None:
    """Print success message."""
    console.print(f"[green bold]✓ {message}[/green bold]")


def print_warning(message: str) -> None:
    """Print warning message."""
    console.print(f"[yellow bold]⚠ Warning: {message}[/yellow bold]")


def print_info(message: str) -> None:
    """Print info message."""
    console.print(f"[blue]ℹ {message}[/blue]")
