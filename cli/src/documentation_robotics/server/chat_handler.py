"""
Chat handler for DrBot WebSocket integration.

Handles JSON-RPC 2.0 chat messages and integrates with Anthropic SDK.
"""

import asyncio
import json
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from aiohttp import web
from rich.console import Console

from .chat_protocol import (
    ChatErrorCodes,
    create_chat_complete,
    create_chat_error,
    create_chat_response_chunk,
    create_chat_tool_invoke,
)
from .chat_session import ChatSession, SessionManager
from .drbot_orchestrator import HAS_ANTHROPIC, DrBotOrchestrator

console = Console()


class ChatHandler:
    """Handles chat messages over WebSocket with Anthropic SDK integration."""

    RESPONSE_TIMEOUT = 120  # seconds

    def __init__(
        self,
        model_path: Optional[Path] = None,
        model_context_provider: Optional[Callable[[], Dict[str, Any]]] = None,
    ):
        """
        Initialize the chat handler.

        Args:
            model_path: Path to the model directory
            model_context_provider: Callable that returns model context dict
        """
        self.model_path = model_path
        self.model_context_provider = model_context_provider
        self.session_manager = SessionManager()
        self.orchestrator: Optional[DrBotOrchestrator] = None

        # Initialize DrBot orchestrator if model path is provided
        if model_path:
            self.orchestrator = DrBotOrchestrator(model_path)

    async def handle_message(
        self,
        ws: web.WebSocketResponse,
        message: str,
        session: ChatSession,
    ) -> None:
        """
        Handle incoming JSON-RPC chat message.

        Args:
            ws: WebSocket response object
            message: Raw message string
            session: Chat session for this WebSocket
        """
        try:
            data = json.loads(message)
        except json.JSONDecodeError as e:
            await ws.send_json(
                create_chat_error(None, ChatErrorCodes.PARSE_ERROR, f"Invalid JSON: {e}")
            )
            return

        # Validate JSON-RPC structure
        if data.get("jsonrpc") != "2.0":
            await ws.send_json(
                create_chat_error(
                    data.get("id"),
                    ChatErrorCodes.INVALID_REQUEST,
                    "Invalid JSON-RPC version",
                )
            )
            return

        method = data.get("method")
        params = data.get("params", {})
        request_id = data.get("id")

        if method == "chat.send":
            await self._handle_chat_send(ws, session, params, request_id)
        elif method == "chat.cancel":
            await self._handle_chat_cancel(ws, session, params, request_id)
        elif method == "chat.status":
            await self._handle_chat_status(ws, request_id)
        else:
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.METHOD_NOT_FOUND,
                    f"Unknown method: {method}",
                )
            )

    async def _handle_chat_send(
        self,
        ws: web.WebSocketResponse,
        session: ChatSession,
        params: Dict[str, Any],
        request_id: str,
    ) -> None:
        """
        Handle chat.send request.

        Args:
            ws: WebSocket response object
            session: Chat session
            params: Request parameters
            request_id: Request ID for response
        """
        # Check Anthropic SDK availability
        if not HAS_ANTHROPIC:
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.SDK_UNAVAILABLE,
                    "Anthropic SDK not available. Install with: pip install anthropic",
                )
            )
            return

        user_message = params.get("message", "").strip()
        if not user_message:
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.INVALID_PARAMS,
                    "Message cannot be empty",
                )
            )
            return

        # Cancel any existing task
        await session.cancel_active_task()

        # Add user message to history
        session.add_user_message(user_message)
        conversation_id = session.session_id

        # Create and store the task
        task = asyncio.create_task(
            self._process_chat_query(ws, session, user_message, request_id, conversation_id)
        )
        session.active_task = task

        try:
            await asyncio.wait_for(task, timeout=self.RESPONSE_TIMEOUT)
        except asyncio.TimeoutError:
            console.print(
                f"[red]Chat request {request_id} timed out after {self.RESPONSE_TIMEOUT}s[/red]"
            )
            await ws.send_json(
                create_chat_error(request_id, ChatErrorCodes.INTERNAL_ERROR, "Request timed out")
            )
        except asyncio.CancelledError:
            console.print(f"[yellow]Chat request {request_id} cancelled by user[/yellow]")
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.OPERATION_CANCELLED,
                    "Operation cancelled by user",
                )
            )
        except Exception as e:
            # Catch any unhandled exceptions from the task
            console.print(f"[red]Unhandled error in chat request {request_id}: {e}[/red]")
            import traceback

            traceback.print_exc()
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.INTERNAL_ERROR,
                    f"Internal error: {str(e)}",
                )
            )

    async def _process_chat_query(
        self,
        ws: web.WebSocketResponse,
        session: ChatSession,
        user_message: str,
        request_id: str,
        conversation_id: str,
    ) -> None:
        """
        Process a chat query using the Claude Agent SDK.

        Args:
            ws: WebSocket response object
            session: Chat session
            user_message: User's message
            request_id: Request ID for response
            conversation_id: Conversation ID
        """
        # Use DrBotOrchestrator
        if not self.orchestrator:
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.INTERNAL_ERROR,
                    "DrBot orchestrator not initialized",
                )
            )
            return

        # Get model context
        context = {}
        if self.model_context_provider:
            try:
                context = self.model_context_provider()
            except Exception as e:
                console.print(f"[yellow]Warning: Could not get model context: {e}[/yellow]")

        # Get conversation history for context
        conversation_history = session.get_conversation_for_sdk()

        accumulated_text = ""
        tool_invocations = []
        total_cost = None

        try:
            async for message in self.orchestrator.handle_message(
                user_message, context, conversation_history
            ):
                msg_type = message.get("type")

                if msg_type == "text_delta":
                    # Stream text chunks
                    text = message.get("text", "")
                    accumulated_text += text
                    await ws.send_json(
                        create_chat_response_chunk(
                            conversation_id,
                            text,
                            is_final=False,
                        )
                    )
                elif msg_type == "tool_use":
                    # Notify about tool invocation
                    tool_name = message.get("name")
                    tool_input = message.get("input", {})
                    tool_invocations.append(
                        {
                            "name": tool_name,
                            "input": tool_input,
                        }
                    )
                    await ws.send_json(
                        create_chat_tool_invoke(
                            conversation_id,
                            tool_name,
                            tool_input,
                            status="executing",
                        )
                    )
                elif msg_type == "complete":
                    # Completion message may include cost
                    total_cost = message.get("cost")

            # Add complete response to session history
            session.add_assistant_message(accumulated_text, tool_invocations)

            # Send completion
            await ws.send_json(
                create_chat_complete(
                    conversation_id,
                    request_id,
                    total_cost,
                )
            )

        except Exception as e:
            console.print(f"[red]Chat query error: {e}[/red]")
            import traceback

            traceback.print_exc()
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.INTERNAL_ERROR,
                    f"Query failed: {str(e)}",
                )
            )

    async def _handle_chat_cancel(
        self,
        ws: web.WebSocketResponse,
        session: ChatSession,
        params: Dict[str, Any],
        request_id: str,
    ) -> None:
        """
        Handle chat.cancel request.

        Args:
            ws: WebSocket response object
            session: Chat session
            params: Request parameters (included for API consistency, currently unused)
            request_id: Request ID for response
        """
        cancelled = await session.cancel_active_task()
        await ws.send_json(
            {
                "jsonrpc": "2.0",
                "result": {
                    "cancelled": cancelled,
                    "conversation_id": session.session_id,
                },
                "id": request_id,
            }
        )

    async def _handle_chat_status(
        self,
        ws: web.WebSocketResponse,
        request_id: str,
    ) -> None:
        """
        Handle chat.status request.

        Args:
            ws: WebSocket response object
            request_id: Request ID for response
        """
        # Get Anthropic SDK version if available
        sdk_version = "unknown"
        if HAS_ANTHROPIC:
            try:
                import anthropic

                sdk_version = getattr(anthropic, "__version__", "unknown")
            except Exception:
                pass

        await ws.send_json(
            {
                "jsonrpc": "2.0",
                "result": {
                    "sdk_available": HAS_ANTHROPIC,
                    "sdk_version": sdk_version if HAS_ANTHROPIC else None,
                    "error_message": None if HAS_ANTHROPIC else "Anthropic SDK not installed",
                },
                "id": request_id,
            }
        )
