"""Unit tests for chat session management."""

import asyncio

import pytest
from documentation_robotics.server.chat_session import ChatMessage, ChatSession, SessionManager


class TestChatMessage:
    """Tests for ChatMessage dataclass."""

    def test_create_message(self):
        """Test creating a chat message."""
        msg = ChatMessage(role="user", content="Hello")

        assert msg.role == "user"
        assert msg.content == "Hello"
        assert msg.timestamp is not None
        assert msg.tool_invocations == []

    def test_message_with_tools(self):
        """Test creating a message with tool invocations."""
        tools = [{"name": "dr list", "input": {}}]
        msg = ChatMessage(role="assistant", content="Results", tool_invocations=tools)

        assert msg.role == "assistant"
        assert msg.content == "Results"
        assert len(msg.tool_invocations) == 1


class TestChatSession:
    """Tests for ChatSession."""

    def test_create_session(self):
        """Test creating a chat session."""
        session = ChatSession(session_id="test-123")

        assert session.session_id == "test-123"
        assert len(session.conversation_history) == 0
        assert session.active_task is None
        assert session.model_context is None

    def test_add_user_message(self):
        """Test adding a user message to history."""
        session = ChatSession(session_id="test-123")
        msg = session.add_user_message("Hello")

        assert msg.role == "user"
        assert msg.content == "Hello"
        assert len(session.conversation_history) == 1
        assert session.conversation_history[0] == msg

    def test_add_assistant_message(self):
        """Test adding an assistant message to history."""
        session = ChatSession(session_id="test-123")
        tools = [{"name": "dr list", "input": {}}]
        msg = session.add_assistant_message("Response", tool_invocations=tools)

        assert msg.role == "assistant"
        assert msg.content == "Response"
        assert len(msg.tool_invocations) == 1
        assert len(session.conversation_history) == 1

    def test_history_limit(self):
        """Test that history is limited to MAX_HISTORY_MESSAGES."""
        session = ChatSession(session_id="test-123")

        # Add more than max messages
        for i in range(ChatSession.MAX_HISTORY_MESSAGES + 10):
            session.add_user_message(f"Message {i}")

        # Should only keep the last MAX_HISTORY_MESSAGES
        assert len(session.conversation_history) == ChatSession.MAX_HISTORY_MESSAGES
        # Verify we kept the most recent ones
        assert (
            session.conversation_history[-1].content
            == f"Message {ChatSession.MAX_HISTORY_MESSAGES + 9}"
        )

    def test_get_conversation_for_sdk(self):
        """Test formatting conversation for SDK context."""
        session = ChatSession(session_id="test-123")
        session.add_user_message("What are the APIs?")
        session.add_assistant_message("Here are the APIs...")
        session.add_user_message("Show me the database layer")

        context = session.get_conversation_for_sdk()

        assert "User: What are the APIs?" in context
        assert "DrBot: Here are the APIs..." in context
        assert "User: Show me the database layer" in context

    def test_get_conversation_limits_to_10(self):
        """Test that SDK context only includes last 10 messages."""
        session = ChatSession(session_id="test-123")

        # Add 20 messages
        for i in range(20):
            session.add_user_message(f"Message {i}")

        context = session.get_conversation_for_sdk()
        lines = context.split("\n")

        # Should only have last 10
        assert len(lines) == 10
        assert "Message 19" in context
        assert "Message 9" not in context

    @pytest.mark.asyncio
    async def test_cancel_active_task(self):
        """Test cancelling an active task."""
        session = ChatSession(session_id="test-123")

        # Create a long-running task
        async def long_task():
            await asyncio.sleep(10)

        session.active_task = asyncio.create_task(long_task())

        # Cancel it
        cancelled = await session.cancel_active_task()

        assert cancelled is True
        assert session.active_task.cancelled()

    @pytest.mark.asyncio
    async def test_cancel_no_active_task(self):
        """Test cancelling when no task is active."""
        session = ChatSession(session_id="test-123")

        cancelled = await session.cancel_active_task()

        assert cancelled is False

    @pytest.mark.asyncio
    async def test_cancel_completed_task(self):
        """Test cancelling a completed task."""
        session = ChatSession(session_id="test-123")

        # Create a task that completes immediately
        async def quick_task():
            return "done"

        session.active_task = asyncio.create_task(quick_task())
        await session.active_task  # Wait for completion

        cancelled = await session.cancel_active_task()

        assert cancelled is False


class TestSessionManager:
    """Tests for SessionManager."""

    def test_create_session(self):
        """Test creating a new session."""
        manager = SessionManager()
        session = manager.create_session()

        assert session.session_id is not None
        assert manager.active_session_count == 1

    def test_get_session(self):
        """Test retrieving a session by ID."""
        manager = SessionManager()
        session = manager.create_session()

        retrieved = manager.get_session(session.session_id)

        assert retrieved is session

    def test_get_nonexistent_session(self):
        """Test retrieving a session that doesn't exist."""
        manager = SessionManager()

        retrieved = manager.get_session("nonexistent")

        assert retrieved is None

    @pytest.mark.asyncio
    async def test_remove_session(self):
        """Test removing a session."""
        manager = SessionManager()
        session = manager.create_session()

        await manager.remove_session(session.session_id)

        assert manager.active_session_count == 0
        assert manager.get_session(session.session_id) is None

    @pytest.mark.asyncio
    async def test_remove_session_cancels_task(self):
        """Test that removing a session cancels its active task."""
        manager = SessionManager()
        session = manager.create_session()

        # Create a long-running task
        async def long_task():
            await asyncio.sleep(10)

        session.active_task = asyncio.create_task(long_task())
        task_ref = session.active_task  # Keep reference before removal

        # Remove session (this should await the cancellation)
        await manager.remove_session(session.session_id)

        # Task should be cancelled
        assert task_ref.cancelled()

    def test_max_concurrent_sessions(self):
        """Test that old sessions are removed when max is reached."""
        manager = SessionManager()

        # Create max sessions
        sessions = []
        for _ in range(SessionManager.MAX_CONCURRENT_SESSIONS):
            sessions.append(manager.create_session())

        assert manager.active_session_count == SessionManager.MAX_CONCURRENT_SESSIONS

        # Create one more - should remove oldest
        new_session = manager.create_session()

        assert manager.active_session_count == SessionManager.MAX_CONCURRENT_SESSIONS
        # First session should be gone
        assert manager.get_session(sessions[0].session_id) is None
        # New session should exist
        assert manager.get_session(new_session.session_id) is new_session
