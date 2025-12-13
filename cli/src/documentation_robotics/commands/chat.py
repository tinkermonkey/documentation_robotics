"""
Chat command - interactive CLI for testing DrBot chat capabilities.

This provides a command-line interface for testing the DrBot chat system
without requiring a web UI. It connects to the visualization server's
WebSocket chat endpoint and provides an interactive REPL.
"""

import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Optional

import aiohttp
import click
from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel

console = Console()


async def chat_session(
    host: str,
    port: int,
    token: str,
    conversation_id: Optional[str] = None,
) -> None:
    """
    Run an interactive chat session with DrBot.

    Args:
        host: Server host
        port: Server port
        token: Authentication token
        conversation_id: Optional conversation ID to resume
    """
    if not conversation_id:
        conversation_id = str(uuid.uuid4())

    url = f"ws://{host}:{port}/ws?token={token}"

    console.print("[bold]DrBot Chat Test Harness[/bold]\n")
    console.print(f"[dim]Connecting to {host}:{port}...[/dim]")
    console.print(f"[dim]Conversation ID: {conversation_id}[/dim]\n")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(url) as ws:
                console.print("[green]✓ Connected to DrBot[/green]\n")
                console.print("[yellow]Type your message and press Enter.[/yellow]")
                console.print("[yellow]Type 'exit' or 'quit' to end the session.[/yellow]")
                console.print("[yellow]Type 'help' for available commands.[/yellow]\n")

                # Run message handler in background
                receive_task = asyncio.create_task(receive_messages(ws))

                try:
                    # Interactive input loop
                    while True:
                        # Get user input
                        try:
                            user_input = await asyncio.get_event_loop().run_in_executor(
                                None, input, "You: "
                            )
                        except EOFError:
                            break

                        if not user_input.strip():
                            continue

                        # Handle commands
                        if user_input.lower() in ["exit", "quit"]:
                            console.print("\n[dim]Ending chat session...[/dim]")
                            break
                        elif user_input.lower() == "help":
                            show_help()
                            continue
                        elif user_input.lower() == "clear":
                            console.clear()
                            continue

                        # Send chat message
                        request_id = str(uuid.uuid4())
                        message = {
                            "jsonrpc": "2.0",
                            "method": "chat/request",
                            "params": {
                                "message": user_input,
                                "conversationId": conversation_id,
                                "requestId": request_id,
                            },
                            "id": request_id,
                        }

                        await ws.send_json(message)

                except KeyboardInterrupt:
                    console.print("\n[dim]Interrupted by user[/dim]")
                finally:
                    # Cancel background task
                    receive_task.cancel()
                    try:
                        await receive_task
                    except asyncio.CancelledError:
                        pass

    except aiohttp.ClientConnectorError:
        console.print(
            f"[red]✗ Could not connect to server at {host}:{port}[/red]",
            style="bold",
        )
        console.print("[dim]Make sure the visualization server is running:[/dim]")
        console.print(f"[dim]  dr visualize --port {port}[/dim]\n")
        sys.exit(1)
    except aiohttp.ClientResponseError as e:
        if e.status == 403:
            console.print(
                "[red]✗ Authentication failed (403 Forbidden)[/red]",
                style="bold",
            )
            console.print()
            console.print("[yellow]The server requires a valid authentication token.[/yellow]")
            console.print()
            console.print("[bold]To get the token:[/bold]")
            console.print("1. Look at the 'dr visualize' output")
            console.print("2. Find the URL that looks like:")
            console.print("   [cyan]http://localhost:8080?token=abc123xyz...[/cyan]")
            console.print("3. Copy the token (the part after 'token=')")
            console.print()
            console.print("[bold]Then run:[/bold]")
            console.print(f"   [cyan]dr chat --port {port} --token <your-token>[/cyan]")
            console.print()
        else:
            console.print(f"[red]✗ Server error ({e.status}): {e.message}[/red]", style="bold")
        sys.exit(1)
    except Exception as e:
        console.print(f"[red]✗ Error: {e}[/red]", style="bold")
        sys.exit(1)


async def receive_messages(ws: aiohttp.ClientWebSocketResponse) -> None:
    """
    Receive and display messages from the WebSocket.

    Args:
        ws: WebSocket connection
    """
    current_response = []

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)

                # Handle different message types
                if "method" in data:
                    method = data["method"]

                    if method == "chat/response":
                        # Accumulate response chunks
                        params = data.get("params", {})
                        text = params.get("text", "")
                        is_final = params.get("isFinal", False)

                        if text:
                            current_response.append(text)
                            # Print chunk without newline
                            if not current_response or len(current_response) == 1:
                                console.print("\n[bold cyan]DrBot:[/bold cyan] ", end="")
                            console.print(text, end="")

                        if is_final:
                            console.print("\n")  # End the response
                            current_response = []

                    elif method == "chat/tool_invoke":
                        # Show tool invocation
                        params = data.get("params", {})
                        tool_name = params.get("toolName", "unknown")
                        console.print(
                            f"\n[dim]🔧 Tool invoked: {tool_name}[/dim]",
                        )

                    elif method == "chat/status":
                        # Show status updates
                        params = data.get("params", {})
                        status = params.get("status", "")
                        message = params.get("message", "")

                        if status == "processing":
                            console.print(f"[dim]⏳ {message}[/dim]")
                        elif status == "error":
                            console.print(f"[red]✗ Error: {message}[/red]")
                        elif status == "completed":
                            cost = params.get("totalCost")
                            if cost:
                                console.print(
                                    f"[dim]✓ Completed (cost: ${cost:.4f})[/dim]"
                                )

                elif "error" in data:
                    # Handle JSON-RPC errors
                    error = data["error"]
                    console.print(
                        f"\n[red]Error {error.get('code')}: {error.get('message')}[/red]"
                    )
                    current_response = []

            except json.JSONDecodeError:
                console.print(f"[yellow]⚠ Received non-JSON message: {msg.data}[/yellow]")

        elif msg.type == aiohttp.WSMsgType.ERROR:
            console.print(f"[red]WebSocket error: {ws.exception()}[/red]")
            break


def show_help() -> None:
    """Display help information."""
    help_text = """
    **DrBot Chat Commands**

    - Type any message to chat with DrBot
    - `help` - Show this help message
    - `clear` - Clear the screen
    - `exit` or `quit` - End the chat session

    **DrBot Capabilities**

    DrBot is an AI assistant that can help you explore and modify your
    Documentation Robotics model. It has expertise in the 12-layer DR
    architecture and can:

    - List elements in any layer (`dr_list`)
    - Find specific elements by ID (`dr_find`)
    - Search for elements by pattern (`dr_search`)
    - Trace dependencies between elements (`dr_trace`)
    - Delegate to dr-architect for model modifications

    **Examples**

    - "List all services in the business layer"
    - "Find the element business-service-orders"
    - "Search for elements related to authentication"
    - "Trace dependencies for api-endpoint-create-order"
    """
    console.print(Panel(Markdown(help_text), title="Help", border_style="cyan"))


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
    "--token",
    type=str,
    required=True,
    help="Authentication token from 'dr visualize' output (required)",
)
@click.option(
    "--conversation-id",
    type=str,
    help="Resume a previous conversation by ID",
)
def chat(
    port: int,
    host: str,
    token: Optional[str],
    conversation_id: Optional[str],
) -> None:
    """
    Interactive chat with DrBot (test harness).

    This command provides a command-line interface for testing DrBot's
    chat capabilities without requiring a web UI. It connects to the
    visualization server's WebSocket endpoint.

    Before using this command, start the visualization server:

        dr visualize --port 8080

    The server will display a URL with an authentication token like:
        http://localhost:8080?token=abc123xyz...

    Copy the token and use it to connect:

        dr chat --port 8080 --token abc123xyz...

    Examples:

        dr chat --port 8080 --token abc123xyz
        dr chat --port 3000 --token xyz789
        dr chat --port 8080 --token abc123 --conversation-id 550e8400...
    """
    try:
        asyncio.run(chat_session(host, port, token, conversation_id))
    except KeyboardInterrupt:
        console.print("\n[dim]Chat session ended[/dim]")
