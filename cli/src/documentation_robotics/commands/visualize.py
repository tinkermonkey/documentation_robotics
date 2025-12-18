"""
Visualize model command - starts interactive visualization server.
"""

import asyncio
import os
import webbrowser
from pathlib import Path

import aiohttp
import click
from rich.console import Console
from rich.panel import Panel

from ..core.model import Model
from ..server.drbot_orchestrator import HAS_ANTHROPIC
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

    # Resolve spec path for visualization
    # The spec defines the metamodel structure (layer schemas, relationship types, etc.)
    # Priority:
    #   1. DR_SPEC_PATH environment variable (explicit override)
    #   2. Workspace spec/ directory (development mode)
    #   3. Bundled schemas package directory (production, pending implementation)
    spec_path_env = os.getenv("DR_SPEC_PATH")
    if spec_path_env:
        spec_path = Path(spec_path_env)
    else:
        # Check for .dr directory (installed project mode)
        dot_dr_spec = root_path / ".dr"

        # Check for workspace spec/ directory (typical in development)
        workspace_spec = root_path / "spec"

        if dot_dr_spec.exists() and (dot_dr_spec / "schemas").exists():
            spec_path = dot_dr_spec
        else:
            # Fallback to workspace spec/ directory search
            if not workspace_spec.exists():
                current = root_path.parent
                for _ in range(3):
                    candidate = current / "spec"
                    if candidate.exists() and (candidate / "VERSION").exists():
                        workspace_spec = candidate
                        break
                    current = current.parent

            spec_path = workspace_spec

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
        console.print("✗ Error: Specification directory not found", style="red bold")
        console.print(f"   Expected: {spec_path}", style="dim")
        console.print("   The visualization requires the DR specification files", style="dim")
        if not spec_path_env:
            console.print(
                "   Hint: Set DR_SPEC_PATH environment variable to specify spec location",
                style="dim",
            )
        raise click.Abort()

    # Display startup message
    console.print("[bold]Starting visualization server...[/bold]\n")

    # Load model to validate it before starting server
    try:
        model = Model(root_path)
        console.print(f"✓ [green]Model loaded successfully[/green] ({len(model.layers)} layers)")
    except FileNotFoundError as e:
        console.print(f"✗ Error loading model: {e}", style="red bold")
        raise click.Abort()
    except Exception as e:
        console.print(f"✗ Error loading model: {e}", style="red bold")
        raise click.Abort()

    # Check Anthropic SDK availability
    if not HAS_ANTHROPIC:
        console.print()
        console.print(
            "[yellow]⚠ Warning: Anthropic SDK not installed[/yellow]",
            style="bold",
        )
        console.print(
            "   Chat functionality (DrBot) will not be available.",
            style="dim",
        )
        console.print(
            "   To enable chat, install the SDK:",
            style="dim",
        )
        console.print(
            "   [cyan]pip install anthropic[/cyan]",
        )
        console.print()
    else:
        # Get Anthropic SDK version
        sdk_version = "unknown"
        try:
            import anthropic

            sdk_version = getattr(anthropic, "__version__", "unknown")
        except Exception:
            pass

        console.print(f"✓ [green]Anthropic SDK available[/green] (v{sdk_version})")
        console.print("   Chat functionality (DrBot) is enabled")

    # Initialize server
    try:
        server = VisualizationServer(
            root_path,
            spec_path,
            host,
            port,
        )
    except Exception as e:
        console.print(f"✗ Error initializing server: {e}", style="red bold")
        raise click.Abort()

    # Display magic link with authentication token
    magic_link = server.get_magic_link()
    console.print()
    console.print("[green bold]✓[/] Visualization server started")
    console.print()

    # Display magic link in a panel
    link_panel = Panel(
        f"[bold cyan]{magic_link}[/]\n\n"
        "[dim]This link includes a secure authentication token[/]",
        title="[bold]Open in browser[/]",
        border_style="green",
    )
    console.print(link_panel)
    console.print()
    console.print(f"[dim]Server: {host}:{port}[/]")
    console.print(f"[dim]Model:  {model_path}[/]")
    console.print()
    console.print("[yellow]Press Ctrl+C to stop the server[/]")
    console.print()

    # Start server (blocks until Ctrl+C)
    # We start the server first, then open the browser after it's ready
    try:
        # Create async task to handle server startup and browser launch
        async def start_server_and_browser():
            # Start server in background
            server_task = asyncio.create_task(server.start())

            # Wait for server to be ready by polling health endpoint
            max_retries = 20
            retry_delay = 0.25
            server_ready = False

            for attempt in range(max_retries):
                await asyncio.sleep(retry_delay)
                try:
                    async with aiohttp.ClientSession() as session:
                        async with session.get(f"http://{host}:{port}/health", timeout=aiohttp.ClientTimeout(total=1)) as resp:
                            if resp.status == 200:
                                server_ready = True
                                console.print(f"[dim]Server is ready (attempt {attempt + 1}/{max_retries})[/dim]")
                                break
                except (aiohttp.ClientError, asyncio.TimeoutError):
                    # Server not ready yet, continue waiting
                    pass

            if not server_ready:
                console.print(f"[yellow]⚠ Warning: Could not confirm server is ready after {max_retries} attempts[/yellow]")

            # Open browser if requested, now that server is ready
            if not no_browser:
                try:
                    console.print("[dim]Opening browser with authentication...[/dim]")
                    webbrowser.open(magic_link)
                except Exception as e:
                    console.print(f"[yellow]⚠ Could not open browser automatically: {e}[/yellow]")
                    console.print("[dim]Please open the link above manually[/dim]")

            # Wait for server to complete
            await server_task

        asyncio.run(start_server_and_browser())
    except KeyboardInterrupt:
        console.print("\n[dim]Received shutdown signal[/dim]")
    except OSError as e:
        if "Address already in use" in str(e) or "address already in use" in str(e):
            console.print(f"\n✗ Error: Port {port} is already in use", style="red bold")
            console.print(
                f"   Try a different port with: dr visualize --port {port + 1}", style="dim"
            )
            console.print("   Or find the process using this port:", style="dim")
            console.print(f"     macOS/Linux: lsof -i :{port}", style="dim")
            console.print(f"     Windows: netstat -ano | findstr :{port}", style="dim")
        else:
            console.print(f"\n✗ Error: Server error: {e}", style="red bold")
        raise click.Abort()
    except Exception as e:
        console.print(f"\n✗ Error: Server error: {e}", style="red bold")
        raise click.Abort()
