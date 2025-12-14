"""
End-to-end integration tests for chat functionality.

Tests the complete chat flow without starting a real server:
1. Chat handler with orchestrator
2. JSON-RPC message handling
3. DrBot tool invocations
4. Error handling and edge cases
"""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web
from documentation_robotics.core.model import Model
from documentation_robotics.server.chat_handler import ChatHandler
from documentation_robotics.server.chat_protocol import ChatErrorCodes
from documentation_robotics.server.chat_session import ChatSession
from documentation_robotics.server.visualization_server import VisualizationServer


@pytest.fixture
def test_model(tmp_path):
    """Create a test model with minimal structure."""
    # Create minimal model structure
    model_dir = tmp_path / "documentation-robotics" / "model"
    model_dir.mkdir(parents=True, exist_ok=True)

    # Create a minimal manifest
    manifest_file = model_dir / "manifest.yaml"
    manifest_file.write_text("""
name: Test Model
specVersion: 0.5.0
created: 2024-01-01T00:00:00Z
updated: 2024-01-01T00:00:00Z
""")

    # Create layer directories
    for layer in ["business", "api", "application", "technology"]:
        (model_dir / layer).mkdir(exist_ok=True)

    # Create a sample element file for testing
    business_dir = model_dir / "business"
    service_file = business_dir / "customer-service.yaml"
    service_file.write_text("""
id: business.service.customer-service
type: service
name: Customer Service
description: Handles customer operations
""")

    # Load the model
    model = Model(tmp_path, enable_cache=False, lazy_load=True)

    return model


@pytest.fixture
def chat_handler(test_model):
    """Create a chat handler with test model."""
    handler = ChatHandler(
        model_path=test_model.root_path,
        model_context_provider=lambda: {"test": "context"},
    )
    return handler


@pytest.fixture
def mock_ws():
    """Create a mock WebSocket."""
    ws = AsyncMock(spec=web.WebSocketResponse)
    ws.send_json = AsyncMock()
    return ws


@pytest.fixture
def test_session():
    """Create a test session."""
    return ChatSession(session_id="test-session-123")


class TestChatHandlerIntegration:
    """Integration tests for chat handler."""

    @pytest.mark.asyncio
    async def test_handler_initialization_with_model_path(self, test_model):
        """Test handler initializes orchestrator with model path."""
        handler = ChatHandler(
            model_path=test_model.root_path,
            model_context_provider=lambda: {},
        )

        assert handler.model_path == test_model.root_path
        assert handler.orchestrator is not None
        assert handler.session_manager is not None

    @pytest.mark.asyncio
    async def test_handler_without_model_path(self):
        """Test handler without model path."""
        handler = ChatHandler(
            model_path=None,
            model_context_provider=lambda: {},
        )

        assert handler.model_path is None
        assert handler.orchestrator is None  # Not initialized without path

    @pytest.mark.asyncio
    async def test_invalid_json_message(self, chat_handler, mock_ws, test_session):
        """Test handling invalid JSON."""
        await chat_handler.handle_message(mock_ws, "not json", test_session)

        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.PARSE_ERROR

    @pytest.mark.asyncio
    async def test_invalid_jsonrpc_version(self, chat_handler, mock_ws, test_session):
        """Test handling invalid JSON-RPC version."""
        message = json.dumps({"jsonrpc": "1.0", "method": "chat.send", "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.INVALID_REQUEST

    @pytest.mark.asyncio
    async def test_unknown_method(self, chat_handler, mock_ws, test_session):
        """Test calling unknown method."""
        message = json.dumps({"jsonrpc": "2.0", "method": "unknown.method", "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.METHOD_NOT_FOUND

    @pytest.mark.asyncio
    async def test_empty_chat_message(self, chat_handler, mock_ws, test_session):
        """Test sending empty chat message."""
        from documentation_robotics.server.sdk_detector import SDKStatus

        chat_handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        message = json.dumps(
            {"jsonrpc": "2.0", "method": "chat.send", "params": {"message": ""}, "id": "1"}
        )

        await chat_handler.handle_message(mock_ws, message, test_session)

        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.INVALID_PARAMS

    @pytest.mark.asyncio
    async def test_chat_status_request(self, chat_handler, mock_ws, test_session):
        """Test chat.status request."""
        from documentation_robotics.server.sdk_detector import SDKStatus

        chat_handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        message = json.dumps({"jsonrpc": "2.0", "method": "chat.status", "params": {}, "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["jsonrpc"] == "2.0"
        assert call_args["id"] == "1"
        assert "result" in call_args
        assert "sdk_available" in call_args["result"]

    @pytest.mark.asyncio
    async def test_chat_cancel_request(self, chat_handler, mock_ws, test_session):
        """Test chat.cancel request."""
        # Create a dummy active task
        async def dummy_task():
            await asyncio.sleep(10)

        test_session.active_task = asyncio.create_task(dummy_task())

        message = json.dumps({"jsonrpc": "2.0", "method": "chat.cancel", "params": {}, "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        call_args = mock_ws.send_json.call_args[0][0]
        assert "result" in call_args
        assert "cancelled" in call_args["result"]

    @pytest.mark.asyncio
    async def test_sdk_unavailable_error(self, chat_handler, mock_ws, test_session):
        """Test error when SDK is not available."""
        from documentation_robotics.server.sdk_detector import SDKStatus

        chat_handler._sdk_status = SDKStatus(
            available=False, error="Claude Agent SDK not installed"
        )

        message = json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "chat.send",
                "params": {"message": "Hello"},
                "id": "1",
            }
        )

        await chat_handler.handle_message(mock_ws, message, test_session)

        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.SDK_UNAVAILABLE

    @pytest.mark.asyncio
    async def test_orchestrator_not_initialized_error(self, mock_ws, test_session):
        """Test error when orchestrator is not initialized."""
        from documentation_robotics.server.sdk_detector import SDKStatus

        # Create handler without model_path (no orchestrator)
        handler = ChatHandler(model_path=None, model_context_provider=lambda: {})
        handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        message = json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "chat.send",
                "params": {"message": "Hello"},
                "id": "1",
            }
        )

        await handler.handle_message(mock_ws, message, test_session)

        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.INTERNAL_ERROR
        # Error message will contain either "orchestrator" or SDK import error
        error_msg = call_args["error"]["message"].lower()
        assert "orchestrator" in error_msg or "claude_agent_sdk" in error_msg


class TestVisualizationServerChatIntegration:
    """Integration tests for visualization server with chat."""

    def test_server_extracts_model_path_from_model(self, test_model):
        """Test that server extracts root_path from model for chat handler."""
        server = VisualizationServer(test_model, "localhost", 8765)

        # Should extract root_path from model
        assert server.model_path == test_model.root_path
        assert server.model == test_model

    def test_server_with_path_arguments(self, tmp_path):
        """Test server initialization with path arguments."""
        model_path = tmp_path / "model"
        spec_path = tmp_path / "spec"
        model_path.mkdir()
        spec_path.mkdir()

        server = VisualizationServer(model_path, spec_path, "localhost", 8765)

        assert server.model_path == model_path
        assert server.spec_path == spec_path


class TestChatSessionManagement:
    """Tests for chat session management."""

    def test_session_creation(self):
        """Test session creation."""
        session = ChatSession(session_id="test-123")

        assert session.session_id == "test-123"
        assert len(session.conversation_history) == 0
        assert session.active_task is None

    def test_add_user_message(self):
        """Test adding user message."""
        session = ChatSession(session_id="test-123")
        msg = session.add_user_message("Hello")

        assert msg.role == "user"
        assert msg.content == "Hello"
        assert len(session.conversation_history) == 1

    def test_add_assistant_message(self):
        """Test adding assistant message."""
        session = ChatSession(session_id="test-123")
        msg = session.add_assistant_message("Hi there", tool_invocations=[])

        assert msg.role == "assistant"
        assert msg.content == "Hi there"
        assert len(session.conversation_history) == 1

    def test_conversation_history_limit(self):
        """Test that conversation history is limited."""
        session = ChatSession(session_id="test-123")

        # Add more than MAX_HISTORY_MESSAGES
        for i in range(session.MAX_HISTORY_MESSAGES + 10):
            session.add_user_message(f"Message {i}")

        # Should be trimmed to MAX_HISTORY_MESSAGES
        assert len(session.conversation_history) == session.MAX_HISTORY_MESSAGES

    def test_get_conversation_for_sdk(self):
        """Test formatting conversation for SDK."""
        session = ChatSession(session_id="test-123")

        session.add_user_message("Hello")
        session.add_assistant_message("Hi there")
        session.add_user_message("How are you?")

        formatted = session.get_conversation_for_sdk()

        assert "User: Hello" in formatted
        assert "DrBot: Hi there" in formatted
        assert "User: How are you?" in formatted

    @pytest.mark.asyncio
    async def test_cancel_active_task(self):
        """Test cancelling active task."""
        session = ChatSession(session_id="test-123")

        # Create a long-running task
        async def long_task():
            await asyncio.sleep(10)

        session.active_task = asyncio.create_task(long_task())

        # Cancel it
        cancelled = await session.cancel_active_task()

        assert cancelled is True
        assert session.active_task.cancelled()


class TestChatProtocolMessages:
    """Tests for chat protocol message creation."""

    def test_chat_request_message(self):
        """Test creating chat request message."""
        from documentation_robotics.server.chat_protocol import create_chat_request

        msg = create_chat_request("Hello", "conv-123", "req-456")

        assert msg["jsonrpc"] == "2.0"
        assert msg["method"] == "chat.send"
        assert msg["params"]["message"] == "Hello"
        assert msg["id"] == "req-456"

    def test_chat_response_chunk(self):
        """Test creating response chunk."""
        from documentation_robotics.server.chat_protocol import create_chat_response_chunk

        msg = create_chat_response_chunk("conv-123", "Hello", is_final=False)

        assert msg["jsonrpc"] == "2.0"
        assert msg["method"] == "chat.response.chunk"
        assert msg["params"]["content"] == "Hello"
        assert msg["params"]["is_final"] is False

    def test_chat_error_message(self):
        """Test creating error message."""
        from documentation_robotics.server.chat_protocol import create_chat_error

        msg = create_chat_error("req-123", ChatErrorCodes.INVALID_REQUEST, "Invalid request")

        assert msg["jsonrpc"] == "2.0"
        assert msg["error"]["code"] == ChatErrorCodes.INVALID_REQUEST
        assert msg["error"]["message"] == "Invalid request"
        assert msg["id"] == "req-123"

    def test_chat_complete_message(self):
        """Test creating completion message."""
        from documentation_robotics.server.chat_protocol import create_chat_complete

        msg = create_chat_complete("conv-123", "req-456", total_cost_usd=0.0001)

        assert msg["jsonrpc"] == "2.0"
        assert msg["result"]["status"] == "complete"
        assert msg["result"]["total_cost_usd"] == 0.0001
        assert msg["id"] == "req-456"


@pytest.mark.skipif(
    not __import__("importlib").util.find_spec("claude_agent_sdk"),
    reason="claude_agent_sdk not installed",
)
class TestChatWithSDK:
    """Tests requiring Claude Agent SDK."""

    @pytest.mark.asyncio
    async def test_simple_chat_with_mock_sdk(self, chat_handler, mock_ws, test_session):
        """Test chat with mocked SDK response."""
        from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock
        from documentation_robotics.server.sdk_detector import SDKStatus

        chat_handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        # Mock orchestrator to return a simple response
        async def mock_handle_message(*args, **kwargs):
            # Yield an AssistantMessage with TextBlock
            text_block = TextBlock(text="Hello!")
            assistant_msg = AssistantMessage(
                content=[text_block],
                model="claude-sonnet-4-5-20250929"
            )
            yield assistant_msg

            # Yield a ResultMessage
            result_msg = ResultMessage(
                subtype="chat",
                duration_ms=100,
                duration_api_ms=50,
                is_error=False,
                num_turns=1,
                session_id="test-session",
                total_cost_usd=0.0001
            )
            yield result_msg

        # Patch at the right place - the orchestrator's handle_message
        with patch.object(
            chat_handler.orchestrator, "handle_message", new=mock_handle_message
        ):
            message = json.dumps(
                {
                    "jsonrpc": "2.0",
                    "method": "chat.send",
                    "params": {"message": "Hello"},
                    "id": "1",
                }
            )

            await chat_handler.handle_message(mock_ws, message, test_session)

            # Should have sent response chunks and completion
            calls = [call[0][0] for call in mock_ws.send_json.call_args_list]

            # Check for response chunks
            response_chunks = [c for c in calls if c.get("method") == "chat.response.chunk"]
            assert len(response_chunks) > 0, f"No response chunks found. Calls: {calls}"

            # Check for completion
            completions = [c for c in calls if "result" in c and c.get("result", {}).get("status") == "complete"]
            assert len(completions) > 0, f"No completions found. Calls: {calls}"
