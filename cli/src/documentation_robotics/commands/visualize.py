"""
Visualize model command - starts interactive visualization server.
"""

import asyncio
import webbrowser
from pathlib import Path
from typing import Optional

import click
from rich.console import Console

from ..core.model import Model
from ..server.visualization_server import VisualizationServer

console = Console()


@click.command()
@click.option(
    "--port",
    type=int,
    default=8080,
    help="Server port (default: 8080)",
)
@click.option(
    "--host",
    type=str,
    default="localhost",
    help="Server host (default: localhost)",
)
@click.option(
    "--no-browser",
    is_flag=True,
    help="Don't automatically open browser",
)
def visualize(port: int, host: str, no_browser: bool) -> None:
    """Start visualization server for model exploration.

    Launches an interactive web server that provides real-time visualization
    of your architecture model. The server monitors file changes and updates
    the visualization automatically.

    Examples:
        dr visualize                    # Start on default port 8080
        dr visualize --port 3000        # Use custom port
        dr visualize --no-browser       # Don't open browser automatically
    """
    # Validate model directory exists
    root_path = Path.cwd()
    model_path = root_path / "documentation-robotics" / "model"
    spec_path = root_path.parent.parent / "spec"  # Assuming workspace structure

    if not model_path.exists():
        console.print("✗ Error: No model found in current directory", style="red bold")
        console.print("   Run 'dr init' to create a new model", style="dim")
        raise click.Abort()

    # Validate manifest exists
    manifest_path = model_path / "manifest.yaml"
    if not manifest_path.exists():
        console.print("✗ Error: manifest.yaml not found", style="red bold")
        console.print(f"   Expected: {manifest_path}", style="dim")
        raise click.Abort()

    # Validate spec directory exists
    if not spec_path.exists():
        console.print(
            "✗ Error: Specification directory not found", style="red bold"
        )
        console.print(f"   Expected: {spec_path}", style="dim")
        console.print(
            "   The visualization requires the DR specification files", style="dim"
        )
        raise click.Abort()

    # Display startup message
    console.print("[bold]Starting visualization server...[/bold]\n")

    # Load model to validate it before starting server
    try:
        model = Model(root_path)
        console.print(
            f"✓ [green]Model loaded successfully[/green] ({len(model.layers)} layers)"
        )
    except FileNotFoundError as e:
        console.print(f"✗ Error loading model: {e}", style="red bold")
        raise click.Abort()
    except Exception as e:
        console.print(f"✗ Error loading model: {e}", style="red bold")
        raise click.Abort()

    # Initialize server
    try:
        server = VisualizationServer(
            model_path=root_path,
            spec_path=spec_path,
            host=host,
            port=port,
        )
    except Exception as e:
        console.print(f"✗ Error initializing server: {e}", style="red bold")
        raise click.Abort()

    # Display server URL
    server_url = f"http://{host}:{port}"
    console.print(f"\n[bold cyan]Server URL:[/bold cyan] {server_url}")
    console.print("[dim]Press Ctrl+C to stop the server[/dim]\n")

    # Open browser if requested
    if not no_browser:
        try:
            console.print("[dim]Opening browser...[/dim]")
            webbrowser.open(server_url)
        except Exception as e:
            console.print(
                f"[yellow]⚠ Could not open browser automatically: {e}[/yellow]"
            )
            console.print(f"[dim]Please open {server_url} manually[/dim]")

    # Start server (blocks until Ctrl+C)
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        console.print("\n[dim]Received shutdown signal[/dim]")
    except Exception as e:
        console.print(f"\n✗ Server error: {e}", style="red bold")
        raise click.Abort()
