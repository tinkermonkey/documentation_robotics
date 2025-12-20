"""
Chat command - self-contained interactive CLI for DrBot.

This provides a command-line interface for chatting with DrBot without requiring
a separate server. It directly invokes the DrBotOrchestrator in-process.
"""

import asyncio
import importlib.util
import signal
import sys
import traceback
import uuid
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from ..server.chat_session import ChatSession
from ..server.drbot_orchestrator import DrBotOrchestrator

console = Console()


def _setup_signal_handler() -> None:
    """Set up graceful Ctrl+C handling."""

    def handler(signum, frame):
        console.print("\n[dim]Chat ended[/dim]")
        sys.exit(0)

    signal.signal(signal.SIGINT, handler)


def _resolve_model_path(model_dir: Optional[str]) -> Path:
    """
    Find and validate model directory.

    Args:
        model_dir: Override model directory path

    Returns:
        Path to model directory

    Raises:
        click.Abort: If model not found
    """
    if model_dir:
        model_path = Path(model_dir)
    else:
        # Look for documentation-robotics/model in current directory
        model_path = Path.cwd() / "documentation-robotics" / "model"

        # Fallback: look for .dr structure
        if not model_path.exists():
            dr_dir = Path.cwd() / ".dr"
            if dr_dir.exists():
                model_path = Path.cwd()

    # Validate model exists
    if not model_path.exists():
        console.print("[red]Error: No DR model found[/red]")
        console.print(f"[dim]Searched: {model_path}[/dim]")
        console.print("\n[yellow]Run 'dr init' to create a model[/yellow]")
        raise click.Abort()

    return model_path


def _show_welcome(model_path: Path, orchestrator: DrBotOrchestrator) -> None:
    """
    Display welcome banner with model info.

    Args:
        model_path: Path to model directory
        orchestrator: DrBot orchestrator instance
    """
    context = orchestrator.build_model_context()
    manifest = context.get("manifest", {})

    console.print(
        Panel.fit(
            "[bold]DrBot - Documentation Robotics Chat[/bold]\n\n"
            f"Model: {manifest.get('name', 'Unknown')}\n"
            f"Path: {model_path}\n\n"
            "[dim]Commands: 'help', 'clear', 'exit'[/dim]",
            border_style="cyan",
        )
    )


def _show_help() -> None:
    """Show help information."""
    help_text = """
**Commands**
- `help` - Show this help
- `clear` - Clear screen
- `exit` or `quit` - Exit chat

**Capabilities**
DrBot can help you explore your DR model:
- List elements: "Show me all API operations"
- Find elements: "What is business.service.orders?"
- Search: "Find anything related to payments"
- Trace dependencies: "What depends on the Order API?"
- Modify model: "Add a REST endpoint for user login"

**Example Questions**
- "List all business services"
- "Find all elements related to authentication"
- "What are the dependencies for api.operation.create-order?"
"""
    console.print(Panel(Markdown(help_text), title="Help", border_style="cyan"))


async def _get_user_input() -> str:
    """
    Get user input asynchronously.

    Returns:
        User input string

    Note:
        Returns "exit" on EOFError or KeyboardInterrupt
    """
    loop = asyncio.get_event_loop()
    try:
        user_input = await loop.run_in_executor(None, input, "\nYou: ")
        return user_input.strip()
    except (EOFError, KeyboardInterrupt):
        return "exit"


async def _process_message(
    orchestrator: DrBotOrchestrator, session: ChatSession, user_message: str
) -> None:
    """
    Process one user message and stream the response.

    Args:
        orchestrator: DrBot orchestrator instance
        session: Chat session for conversation history
        user_message: User's message
    """
    # Add to history
    session.add_user_message(user_message)

    # Get model context
    context = orchestrator.build_model_context()
    conversation_history = session.get_conversation_for_sdk()

    # Stream response
    accumulated_text = ""
    tool_invocations = []

    console.print("\n[bold cyan]DrBot:[/bold cyan] ", end="")

    try:
        async for message in orchestrator.handle_message(
            user_message, context, conversation_history
        ):
            # Handle dictionary-based messages
            if isinstance(message, dict):
                msg_type = message.get("type")

                if msg_type == "text_delta":
                    # Stream text chunks
                    text = message.get("text", "")
                    accumulated_text += text
                    console.print(text, end="")

                elif msg_type == "tool_use":
                    # Show tool invocation
                    tool_name = message.get("name")
                    tool_input = message.get("input", {})
                    tool_invocations.append({"name": tool_name, "input": tool_input})
                    console.print(f"\n[dim]🔧 {tool_name}[/dim]", end="")

                elif msg_type == "complete":
                    # Final completion
                    if not accumulated_text and message.get("text"):
                        accumulated_text = message["text"]
                        console.print(message["text"], end="")

        console.print()  # Final newline

        # Add to session history
        session.add_assistant_message(accumulated_text, tool_invocations)

    except Exception as e:
        console.print(f"\n[red]Error: {e}[/red]")
        console.print(f"[dim]{traceback.format_exc()}[/dim]")


async def _run_chat_session(model_dir: Optional[str]) -> None:
    """
    Run the main chat session REPL.

    Args:
        model_dir: Override model directory path
    """
    # Set up signal handler
    _setup_signal_handler()

    # Check for Anthropic SDK availability early
    if importlib.util.find_spec("anthropic") is None:
        console.print("[red]Anthropic SDK not installed[/red]")
        console.print("\n[yellow]Install with:[/yellow]")
        console.print("  pip install anthropic")
        console.print()
        raise click.Abort()

    # Validate API key is configured
    import os
    if not os.getenv("ANTHROPIC_API_KEY"):
        console.print("[red]Error: ANTHROPIC_API_KEY environment variable not set[/red]")
        console.print("\n[yellow]Set it with:[/yellow]")
        console.print("  export ANTHROPIC_API_KEY=sk-...")
        console.print()
        raise click.Abort()

    # Resolve and validate model path
    model_path = _resolve_model_path(model_dir)

    # Initialize components
    try:
        orchestrator = DrBotOrchestrator(model_path)
    except Exception as e:
        console.print(f"[red]Error initializing DrBot: {e}[/red]")
        console.print(f"[dim]{traceback.format_exc()}[/dim]")
        raise click.Abort()

    session = ChatSession(session_id=str(uuid.uuid4()))

    # Show welcome banner
    _show_welcome(model_path, orchestrator)

    # Run REPL loop
    while True:
        user_input = await _get_user_input()

        if not user_input:
            continue

        # Handle commands
        if user_input.lower() in ["exit", "quit"]:
            console.print("\n[dim]Chat ended[/dim]")
            break
        elif user_input.lower() == "help":
            _show_help()
            continue
        elif user_input.lower() == "clear":
            console.clear()
            continue

        # Process message
        await _process_message(orchestrator, session, user_input)


@click.command()
@click.option(
    "--model-dir",
    type=click.Path(exists=True),
    help="Override model directory path",
)
def chat(model_dir: Optional[str]) -> None:
    """
    Interactive chat with DrBot.

    This command provides a self-contained chat interface with DrBot,
    the AI assistant for Documentation Robotics. No separate server
    is required - it runs entirely in-process.

    DrBot can help you explore and modify your DR model:
    - List elements in any layer
    - Find specific elements by ID
    - Search for elements by pattern
    - Trace dependencies between elements
    - Delegate to dr-architect for model modifications

    Examples:

        # Start chat in current directory
        dr chat

        # Use a specific model directory
        dr chat --model-dir /path/to/model

    Once in the chat, try these questions:
    - "List all business services"
    - "Find all elements related to authentication"
    - "What are the dependencies for api.operation.create-order?"
    """
    try:
        asyncio.run(_run_chat_session(model_dir))
    except KeyboardInterrupt:
        console.print("\n[dim]Chat ended[/dim]")
