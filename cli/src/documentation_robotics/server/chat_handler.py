"""
Chat handler for DrBot WebSocket integration.

Handles JSON-RPC 2.0 chat messages and integrates with Claude Agent SDK.
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
from .sdk_detector import SDKStatus, detect_claude_agent_sdk

console = Console()


class ChatHandler:
    """Handles chat messages over WebSocket with Claude Agent SDK integration."""

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
        self._sdk_status: Optional[SDKStatus] = None

    @property
    def sdk_status(self) -> SDKStatus:
        """Get cached SDK status."""
        if self._sdk_status is None:
            self._sdk_status = detect_claude_agent_sdk()
        return self._sdk_status

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
        # Check SDK availability
        if not self.sdk_status.available:
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.SDK_UNAVAILABLE,
                    self.sdk_status.error or "Claude Agent SDK not available",
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
            self._process_chat_query(
                ws, session, user_message, request_id, conversation_id
            )
        )
        session.active_task = task

        try:
            await asyncio.wait_for(task, timeout=self.RESPONSE_TIMEOUT)
        except asyncio.TimeoutError:
            await ws.send_json(
                create_chat_error(
                    request_id, ChatErrorCodes.INTERNAL_ERROR, "Request timed out"
                )
            )
        except asyncio.CancelledError:
            await ws.send_json(
                create_chat_error(
                    request_id,
                    ChatErrorCodes.OPERATION_CANCELLED,
                    "Operation cancelled by user",
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
        from claude_agent_sdk import (
            AssistantMessage,
            ClaudeAgentOptions,
            ResultMessage,
            TextBlock,
            ToolUseBlock,
            query,
        )

        # Build model context
        model_context = {}
        if self.model_context_provider:
            try:
                model_context = self.model_context_provider()
            except Exception as e:
                console.print(
                    f"[yellow]Warning: Could not get model context: {e}[/yellow]"
                )

        # Configure SDK options (DrBot orchestrator config)
        # Claude will decide which tools to use based on the user's message
        options = ClaudeAgentOptions(
            allowed_tools=["Read", "Bash", "Glob", "Grep"],
            permission_mode="default",
            cwd=str(self.model_path) if self.model_path else None,
            max_turns=10,
        )

        accumulated_text = ""
        tool_invocations = []
        total_cost = None

        try:
            async for message in query(prompt=user_message, options=options):
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            # Stream text chunks
                            accumulated_text += block.text
                            await ws.send_json(
                                create_chat_response_chunk(
                                    conversation_id,
                                    block.text,
                                    is_final=False,
                                )
                            )
                        elif isinstance(block, ToolUseBlock):
                            # Notify about tool invocation
                            tool_invocations.append(
                                {
                                    "name": block.name,
                                    "input": block.input,
                                }
                            )
                            await ws.send_json(
                                create_chat_tool_invoke(
                                    conversation_id,
                                    block.name,
                                    block.input,
                                    status="executing",
                                )
                            )

                elif isinstance(message, ResultMessage):
                    total_cost = getattr(message, "total_cost_usd", None)

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
        await ws.send_json(
            {
                "jsonrpc": "2.0",
                "result": {
                    "sdk_available": self.sdk_status.available,
                    "sdk_version": self.sdk_status.version,
                    "error_message": self.sdk_status.error,
                },
                "id": request_id,
            }
        )
