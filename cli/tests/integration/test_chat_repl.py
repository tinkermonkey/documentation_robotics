"""Integration tests for chat REPL functionality."""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from documentation_robotics.commands.chat import _process_message
from documentation_robotics.server.chat_session import ChatSession
from documentation_robotics.server.drbot_orchestrator import DrBotOrchestrator


@pytest.fixture
def test_model(tmp_path):
    """Create a minimal test model."""
    # Create model structure
    model_dir = tmp_path / "documentation-robotics" / "model"
    model_dir.mkdir(parents=True)

    # Create minimal manifest
    manifest = model_dir / "manifest.yaml"
    manifest.write_text(
        """
name: Test Model
specVersion: 0.5.0
created: 2024-01-01T00:00:00Z
updated: 2024-01-01T00:00:00Z
"""
    )

    # Create layer directories
    for layer in ["business", "api", "application", "technology"]:
        (model_dir / layer).mkdir(exist_ok=True)

    return tmp_path


@pytest.fixture
def test_orchestrator(test_model):
    """Create a test orchestrator."""
    return DrBotOrchestrator(test_model)


@pytest.fixture
def test_session():
    """Create a test session."""
    return ChatSession(session_id="test-session")


class TestChatProcessMessage:
    """Tests for _process_message function."""

    @pytest.mark.asyncio
    async def test_process_simple_message(self, test_orchestrator, test_session):
        """Test processing a simple chat message."""
        # Mock the orchestrator's handle_message to return dict-based messages
        async def mock_handle_message(*args, **kwargs):
            yield {"type": "text_delta", "text": "Hello! I'm DrBot."}
            yield {"type": "complete", "text": "Hello! I'm DrBot."}

        with patch.object(test_orchestrator, "handle_message", new=mock_handle_message):
            # Process message
            await _process_message(test_orchestrator, test_session, "Hello")

            # Verify history was updated
            assert len(test_session.conversation_history) == 2
            assert test_session.conversation_history[0].role == "user"
            assert test_session.conversation_history[0].content == "Hello"
            assert test_session.conversation_history[1].role == "assistant"
            assert "DrBot" in test_session.conversation_history[1].content

    @pytest.mark.asyncio
    async def test_process_message_with_tool_invocation(self, test_orchestrator, test_session):
        """Test processing a message that triggers tool invocation."""
        # Mock the orchestrator's handle_message with tool use (dict-based format)
        async def mock_handle_message(*args, **kwargs):
            # Tool invocation
            yield {
                "type": "tool_use",
                "name": "dr_list",
                "input": {"layer": "business", "element_type": "service"},
            }
            # Text response
            yield {"type": "text_delta", "text": "Found 5 business services"}
            # Completion
            yield {"type": "complete", "text": "Found 5 business services"}

        with patch.object(test_orchestrator, "handle_message", new=mock_handle_message):
            # Process message
            await _process_message(test_orchestrator, test_session, "List business services")

            # Verify history
            assert len(test_session.conversation_history) == 2

            # Check that tool invocation was recorded
            assistant_msg = test_session.conversation_history[1]
            assert assistant_msg.role == "assistant"
            assert len(assistant_msg.tool_invocations) == 1
            assert assistant_msg.tool_invocations[0]["name"] == "dr_list"

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not __import__("importlib").util.find_spec("claude_agent_sdk"),
        reason="claude_agent_sdk not installed",
    )
    async def test_process_message_with_error(self, test_orchestrator, test_session):
        """Test processing message when orchestrator raises error."""

        # Mock orchestrator to raise an error
        async def mock_error(*args, **kwargs):
            raise ValueError("Test error")
            yield  # Make it a generator

        with patch.object(test_orchestrator, "handle_message", new=mock_error):
            # Should not raise, error is caught and displayed
            await _process_message(test_orchestrator, test_session, "Trigger error")

            # User message should still be in history
            assert len(test_session.conversation_history) == 1
            assert test_session.conversation_history[0].content == "Trigger error"


class TestChatWithRealOrchestrator:
    """Tests that use real orchestrator without mocking (requires SDK)."""

    @pytest.mark.asyncio
    async def test_orchestrator_sdk_check_without_sdk(self, tmp_path):
        """Test that orchestrator raises clear error when SDK not available."""
        # Create a minimal model for testing
        model_dir = tmp_path / "documentation-robotics" / "model"
        model_dir.mkdir(parents=True)
        manifest = model_dir / "manifest.yaml"
        manifest.write_text("name: Test\nspecVersion: 0.5.0\n")

        # Create orchestrator
        orchestrator = DrBotOrchestrator(tmp_path)

        # Check if SDK is actually available
        try:
            from claude_agent_sdk import ClaudeAgentOptions
            has_real_sdk = True
        except ImportError:
            has_real_sdk = False

        if not has_real_sdk:
            # If SDK not installed, should get clear ImportError
            with pytest.raises(ImportError, match="Claude Agent SDK not installed"):
                async for _ in orchestrator.handle_message("test", {}, None):
                    pass

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not __import__("importlib").util.find_spec("claude_agent_sdk"),
        reason="claude_agent_sdk not installed",
    )
    async def test_process_message_with_real_orchestrator(self, test_orchestrator, test_session):
        """Test processing message with real orchestrator (not mocked).

        This test verifies that:
        1. DrBotOrchestrator.handle_message() can be called without errors
        2. The SDK is properly initialized
        3. The message processing pipeline works end-to-end

        Note: This test will actually call Claude API if ANTHROPIC_API_KEY is set.
        """
        import os

        # Skip if no API key (don't want to hit API in CI)
        if not os.getenv("ANTHROPIC_API_KEY"):
            pytest.skip("ANTHROPIC_API_KEY not set - skipping real API test")

        # Process a simple message that should trigger dr_list
        try:
            await _process_message(
                test_orchestrator,
                test_session,
                "What layers are present in this model?"
            )

            # If we got here without errors, the orchestrator is working
            assert len(test_session.conversation_history) >= 1
            assert test_session.conversation_history[0].content == "What layers are present in this model?"

        except ImportError as e:
            # Should get clear error message if SDK not installed
            assert "Claude Agent SDK" in str(e)


class TestChatSessionHistory:
    """Tests for conversation history management."""

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not __import__("importlib").util.find_spec("claude_agent_sdk"),
        reason="claude_agent_sdk not installed",
    )
    async def test_conversation_history_accumulation(self, test_orchestrator, test_session):
        """Test that conversation history accumulates correctly."""
        from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

        async def mock_handle_message(*args, **kwargs):
            yield AssistantMessage(
                content=[TextBlock(text="Response")], model="claude-sonnet-4-5-20250929"
            )
            yield ResultMessage(
                subtype="chat",
                duration_ms=100,
                duration_api_ms=50,
                is_error=False,
                num_turns=1,
                session_id="test",
                total_cost_usd=0.0001,
            )

        with patch.object(test_orchestrator, "handle_message", new=mock_handle_message):
            # Process multiple messages
            await _process_message(test_orchestrator, test_session, "First")
            await _process_message(test_orchestrator, test_session, "Second")
            await _process_message(test_orchestrator, test_session, "Third")

            # Should have 6 messages (3 user + 3 assistant)
            assert len(test_session.conversation_history) == 6

    @pytest.mark.asyncio
    async def test_get_conversation_for_sdk(self, test_orchestrator, test_session):
        """Test formatting conversation for SDK."""
        # Mock with dict-based format
        async def mock_handle_message(*args, **kwargs):
            yield {"type": "text_delta", "text": "Response"}
            yield {"type": "complete", "text": "Response"}

        with patch.object(test_orchestrator, "handle_message", new=mock_handle_message):
            # Add some messages
            await _process_message(test_orchestrator, test_session, "Hello")
            await _process_message(test_orchestrator, test_session, "How are you?")

            # Get formatted conversation
            formatted = test_session.get_conversation_for_sdk()

            # Should contain user and assistant messages
            assert "User: Hello" in formatted
            assert "User: How are you?" in formatted
            assert "DrBot: Response" in formatted
