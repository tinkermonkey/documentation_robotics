"""Chat session management for DrBot conversations."""
import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class ChatMessage:
    """Represents a single message in a conversation."""

    role: str  # "user" or "assistant"
    content: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    tool_invocations: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ChatSession:
    """
    Manages a single chat session with conversation history.

    Each WebSocket connection maintains its own session.
    """

    session_id: str
    conversation_history: List[ChatMessage] = field(default_factory=list)
    active_task: Optional[asyncio.Task] = None
    model_context: Optional[Dict[str, Any]] = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    # Resource limits
    MAX_HISTORY_MESSAGES = 50

    def add_user_message(self, content: str) -> ChatMessage:
        """
        Add a user message to history.

        Args:
            content: Message content

        Returns:
            The created ChatMessage
        """
        msg = ChatMessage(role="user", content=content)
        self._add_message(msg)
        return msg

    def add_assistant_message(
        self, content: str, tool_invocations: Optional[List[Dict]] = None
    ) -> ChatMessage:
        """
        Add an assistant message to history.

        Args:
            content: Message content
            tool_invocations: List of tool invocations made during this message

        Returns:
            The created ChatMessage
        """
        msg = ChatMessage(
            role="assistant", content=content, tool_invocations=tool_invocations or []
        )
        self._add_message(msg)
        return msg

    def _add_message(self, msg: ChatMessage) -> None:
        """
        Add message with history limit enforcement.

        Args:
            msg: Message to add
        """
        self.conversation_history.append(msg)
        # Trim to max history
        if len(self.conversation_history) > self.MAX_HISTORY_MESSAGES:
            self.conversation_history = self.conversation_history[
                -self.MAX_HISTORY_MESSAGES :
            ]

    def get_conversation_for_sdk(self) -> str:
        """
        Format conversation history for SDK context.

        Returns:
            Formatted conversation history (last 10 messages)
        """
        lines = []
        for msg in self.conversation_history[-10:]:  # Last 10 for context
            prefix = "User:" if msg.role == "user" else "DrBot:"
            lines.append(f"{prefix} {msg.content}")
        return "\n".join(lines)

    async def cancel_active_task(self) -> bool:
        """
        Cancel any active task and return whether one was cancelled.

        Returns:
            True if a task was cancelled, False otherwise
        """
        if self.active_task and not self.active_task.done():
            self.active_task.cancel()
            try:
                await self.active_task
            except asyncio.CancelledError:
                pass
            return True
        return False


class SessionManager:
    """Manages chat sessions across WebSocket connections."""

    MAX_CONCURRENT_SESSIONS = 5

    def __init__(self):
        """Initialize the session manager."""
        self._sessions: Dict[str, ChatSession] = {}

    def create_session(self) -> ChatSession:
        """
        Create a new chat session.

        If the maximum number of concurrent sessions is reached,
        the oldest inactive session is removed.

        Returns:
            Newly created ChatSession
        """
        if len(self._sessions) >= self.MAX_CONCURRENT_SESSIONS:
            # Find and remove oldest inactive session
            oldest_id = min(
                self._sessions.keys(), key=lambda k: self._sessions[k].created_at
            )
            self.remove_session(oldest_id)

        session_id = str(uuid.uuid4())
        session = ChatSession(session_id=session_id)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[ChatSession]:
        """
        Get an existing session by ID.

        Args:
            session_id: Session identifier

        Returns:
            ChatSession if found, None otherwise
        """
        return self._sessions.get(session_id)

    def remove_session(self, session_id: str) -> None:
        """
        Remove a session.

        Cancels any active tasks before removing.

        Args:
            session_id: Session identifier
        """
        if session_id in self._sessions:
            session = self._sessions[session_id]
            if session.active_task and not session.active_task.done():
                session.active_task.cancel()
            del self._sessions[session_id]

    @property
    def active_session_count(self) -> int:
        """Get the number of active sessions."""
        return len(self._sessions)
