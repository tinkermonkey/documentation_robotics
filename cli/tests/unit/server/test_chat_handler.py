"""Unit tests for chat handler."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web
from documentation_robotics.server.chat_handler import ChatHandler
from documentation_robotics.server.chat_protocol import ChatErrorCodes
from documentation_robotics.server.chat_session import ChatSession
from documentation_robotics.server.sdk_detector import SDKStatus


class TestChatHandler:
    """Tests for ChatHandler."""

    @pytest.fixture
    def chat_handler(self):
        """Create a chat handler for testing."""
        return ChatHandler(
            model_path=Path("/test/model"),
            model_context_provider=lambda: {"test": "context"},
        )

    @pytest.fixture
    def mock_ws(self):
        """Create a mock WebSocket."""
        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()
        return ws

    @pytest.fixture
    def test_session(self):
        """Create a test session."""
        return ChatSession(session_id="test-123")

    def test_init(self, chat_handler):
        """Test handler initialization."""
        assert chat_handler.model_path == Path("/test/model")
        assert chat_handler.model_context_provider is not None
        assert chat_handler.session_manager is not None

    def test_sdk_status_cached(self, chat_handler):
        """Test that SDK status is cached."""
        with patch(
            "documentation_robotics.server.chat_handler.detect_claude_agent_sdk"
        ) as mock_detect:
            mock_detect.return_value = SDKStatus(available=True, version="1.0.0")

            # First call
            status1 = chat_handler.sdk_status
            # Second call
            status2 = chat_handler.sdk_status

            # Should only detect once
            mock_detect.assert_called_once()
            assert status1 is status2

    @pytest.mark.asyncio
    async def test_handle_invalid_json(self, chat_handler, mock_ws, test_session):
        """Test handling invalid JSON."""
        await chat_handler.handle_message(mock_ws, "not json", test_session)

        # Should send parse error
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.PARSE_ERROR

    @pytest.mark.asyncio
    async def test_handle_invalid_jsonrpc_version(self, chat_handler, mock_ws, test_session):
        """Test handling invalid JSON-RPC version."""
        message = json.dumps({"jsonrpc": "1.0", "method": "chat.send", "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        # Should send invalid request error
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.INVALID_REQUEST

    @pytest.mark.asyncio
    async def test_handle_unknown_method(self, chat_handler, mock_ws, test_session):
        """Test handling unknown method."""
        message = json.dumps({"jsonrpc": "2.0", "method": "unknown.method", "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        # Should send method not found error
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.METHOD_NOT_FOUND

    @pytest.mark.asyncio
    async def test_handle_chat_send_sdk_unavailable(self, chat_handler, mock_ws, test_session):
        """Test chat.send when SDK is unavailable."""
        # Mock SDK as unavailable
        chat_handler._sdk_status = SDKStatus(available=False, error="SDK not installed")

        message = json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "chat.send",
                "params": {"message": "Hello"},
                "id": "1",
            }
        )

        await chat_handler.handle_message(mock_ws, message, test_session)

        # Should send SDK unavailable error
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.SDK_UNAVAILABLE

    @pytest.mark.asyncio
    async def test_handle_chat_send_empty_message(self, chat_handler, mock_ws, test_session):
        """Test chat.send with empty message."""
        # Mock SDK as available
        chat_handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        message = json.dumps(
            {"jsonrpc": "2.0", "method": "chat.send", "params": {"message": ""}, "id": "1"}
        )

        await chat_handler.handle_message(mock_ws, message, test_session)

        # Should send invalid params error
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["error"]["code"] == ChatErrorCodes.INVALID_PARAMS

    @pytest.mark.asyncio
    async def test_handle_chat_cancel(self, chat_handler, mock_ws, test_session):
        """Test chat.cancel method."""

        # Setup an active task
        async def dummy_task():
            await asyncio.sleep(10)

        test_session.active_task = asyncio.create_task(dummy_task())

        message = json.dumps({"jsonrpc": "2.0", "method": "chat.cancel", "params": {}, "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        # Should send result with cancelled=True
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["result"]["cancelled"] is True

    @pytest.mark.asyncio
    async def test_handle_chat_status(self, chat_handler, mock_ws, test_session):
        """Test chat.status method."""
        chat_handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        message = json.dumps({"jsonrpc": "2.0", "method": "chat.status", "params": {}, "id": "1"})

        await chat_handler.handle_message(mock_ws, message, test_session)

        # Should send status response as JSON-RPC result
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["jsonrpc"] == "2.0"
        assert call_args["id"] == "1"
        assert call_args["result"]["sdk_available"] is True
        assert call_args["result"]["sdk_version"] == "1.0.0"

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not __import__("importlib").util.find_spec("claude_agent_sdk"),
        reason="claude_agent_sdk not installed",
    )
    async def test_process_chat_query_timeout(self, chat_handler, mock_ws, test_session):
        """Test that long queries timeout correctly."""
        # Reduce timeout for testing
        chat_handler.RESPONSE_TIMEOUT = 0.1

        # Mock SDK as available
        chat_handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        # Mock query to take longer than timeout
        async def slow_query(*args, **kwargs):
            await asyncio.sleep(1)
            yield None

        with patch("claude_agent_sdk.query", side_effect=slow_query):
            message = json.dumps(
                {
                    "jsonrpc": "2.0",
                    "method": "chat.send",
                    "params": {"message": "Hello"},
                    "id": "1",
                }
            )

            await chat_handler.handle_message(mock_ws, message, test_session)

            # Should send timeout error
            error_calls = [
                call for call in mock_ws.send_json.call_args_list if "error" in call[0][0]
            ]
            assert len(error_calls) > 0
            assert error_calls[-1][0][0]["error"]["code"] == ChatErrorCodes.INTERNAL_ERROR

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not __import__("importlib").util.find_spec("claude_agent_sdk"),
        reason="claude_agent_sdk not installed",
    )
    async def test_cancels_previous_task(self, chat_handler, mock_ws, test_session):
        """Test that new requests cancel previous tasks."""
        # Mock SDK as available
        chat_handler._sdk_status = SDKStatus(available=True, version="1.0.0")

        # Create a long-running task
        async def long_task():
            await asyncio.sleep(10)

        test_session.active_task = asyncio.create_task(long_task())
        old_task = test_session.active_task

        # Send a new message (which should cancel the old task)
        # Mock query to return quickly
        async def quick_query(*args, **kwargs):
            yield MagicMock()  # Quick result

        with patch("claude_agent_sdk.query", side_effect=quick_query):
            message = json.dumps(
                {
                    "jsonrpc": "2.0",
                    "method": "chat.send",
                    "params": {"message": "New query"},
                    "id": "2",
                }
            )

            await chat_handler.handle_message(mock_ws, message, test_session)

            # Give time for cancellation
            await asyncio.sleep(0.1)

            # Old task should be cancelled
            assert old_task.cancelled()
