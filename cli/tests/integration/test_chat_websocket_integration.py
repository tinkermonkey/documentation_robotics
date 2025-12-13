"""Integration tests for WebSocket chat functionality."""
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from documentation_robotics.core.model import Model
from documentation_robotics.server.chat_protocol import ChatErrorCodes
from documentation_robotics.server.sdk_detector import SDKStatus
from documentation_robotics.server.visualization_server import VisualizationServer


class TestChatWebSocketIntegration(AioHTTPTestCase):
    """Integration tests for chat over WebSocket."""

    async def get_application(self):
        """Create test application."""
        # Create a minimal test model
        self.test_model = Model(Path(__file__).parent.parent / "fixtures" / "minimal_model")

        # Create server with test model
        self.server = VisualizationServer(self.test_model, "localhost", 8080)

        # Mock SDK as unavailable for most tests (to avoid requiring SDK installation)
        self.server.chat_handler._sdk_status = SDKStatus(
            available=False, error="SDK not installed for testing"
        )

        # Start the server components without actually starting the HTTP server
        await self.server.start.__wrapped__(self.server)  # Skip signal handlers

        return self.server.app

    async def tearDownAsync(self):
        """Clean up after tests."""
        if hasattr(self, "server") and self.server.runner:
            await self.server.runner.cleanup()

    @pytest.mark.asyncio
    async def test_websocket_chat_status(self):
        """Test chat.status request over WebSocket."""
        async with self.client.ws_connect(
            f"/ws?token={self.server.token}"
        ) as ws:
            # Skip welcome and initial state messages
            await ws.receive_json()  # Welcome
            await ws.receive_json()  # Initial state

            # Send chat.status request
            await ws.send_json(
                {"jsonrpc": "2.0", "method": "chat.status", "params": {}, "id": "1"}
            )

            # Receive response
            response = await ws.receive_json()

            assert response["jsonrpc"] == "2.0"
            assert response["id"] == "1"
            assert "result" in response
            assert response["result"]["sdk_available"] is False

    @pytest.mark.asyncio
    async def test_websocket_chat_send_sdk_unavailable(self):
        """Test chat.send when SDK is unavailable."""
        async with self.client.ws_connect(
            f"/ws?token={self.server.token}"
        ) as ws:
            # Skip welcome and initial state
            await ws.receive_json()
            await ws.receive_json()

            # Send chat.send request
            await ws.send_json(
                {
                    "jsonrpc": "2.0",
                    "method": "chat.send",
                    "params": {"message": "Hello DrBot"},
                    "id": "2",
                }
            )

            # Should receive SDK unavailable error
            response = await ws.receive_json()

            assert response["jsonrpc"] == "2.0"
            assert response["id"] == "2"
            assert "error" in response
            assert response["error"]["code"] == ChatErrorCodes.SDK_UNAVAILABLE

    @pytest.mark.asyncio
    async def test_websocket_chat_cancel(self):
        """Test chat.cancel request."""
        async with self.client.ws_connect(
            f"/ws?token={self.server.token}"
        ) as ws:
            # Skip welcome and initial state
            await ws.receive_json()
            await ws.receive_json()

            # Send cancel request (no active task)
            await ws.send_json(
                {
                    "jsonrpc": "2.0",
                    "method": "chat.cancel",
                    "params": {},
                    "id": "3",
                }
            )

            # Should receive result with cancelled=False
            response = await ws.receive_json()

            assert response["jsonrpc"] == "2.0"
            assert response["id"] == "3"
            assert "result" in response
            assert response["result"]["cancelled"] is False

    @pytest.mark.asyncio
    async def test_websocket_session_cleanup(self):
        """Test that sessions are cleaned up on disconnect."""
        initial_count = self.server.chat_handler.session_manager.active_session_count

        async with self.client.ws_connect(
            f"/ws?token={self.server.token}"
        ) as ws:
            # Skip welcome and initial state
            await ws.receive_json()
            await ws.receive_json()

            # Session should exist
            assert (
                self.server.chat_handler.session_manager.active_session_count
                == initial_count + 1
            )

        # After disconnect, session should be cleaned up
        await asyncio.sleep(0.1)  # Give time for cleanup
        assert (
            self.server.chat_handler.session_manager.active_session_count
            == initial_count
        )

    @pytest.mark.asyncio
    async def test_websocket_invalid_jsonrpc(self):
        """Test handling of invalid JSON-RPC messages."""
        async with self.client.ws_connect(
            f"/ws?token={self.server.token}"
        ) as ws:
            # Skip welcome and initial state
            await ws.receive_json()
            await ws.receive_json()

            # Send invalid JSON-RPC (wrong version)
            await ws.send_json(
                {"jsonrpc": "1.0", "method": "chat.send", "id": "4"}
            )

            # Should receive error
            response = await ws.receive_json()

            assert response["jsonrpc"] == "2.0"
            assert "error" in response
            assert response["error"]["code"] == ChatErrorCodes.INVALID_REQUEST

    @pytest.mark.asyncio
    async def test_websocket_empty_message(self):
        """Test handling of empty message."""
        async with self.client.ws_connect(
            f"/ws?token={self.server.token}"
        ) as ws:
            # Skip welcome and initial state
            await ws.receive_json()
            await ws.receive_json()

            # Mock SDK as available for this test
            self.server.chat_handler._sdk_status = SDKStatus(
                available=True, version="1.0.0"
            )

            # Send empty message
            await ws.send_json(
                {
                    "jsonrpc": "2.0",
                    "method": "chat.send",
                    "params": {"message": ""},
                    "id": "5",
                }
            )

            # Should receive invalid params error
            response = await ws.receive_json()

            assert "error" in response
            assert response["error"]["code"] == ChatErrorCodes.INVALID_PARAMS


class TestChatWebSocketWithSDK(AioHTTPTestCase):
    """Integration tests for chat with mocked SDK."""

    async def get_application(self):
        """Create test application with mocked SDK."""
        # Create a minimal test model
        self.test_model = Model(Path(__file__).parent.parent / "fixtures" / "minimal_model")

        # Create server
        self.server = VisualizationServer(self.test_model, "localhost", 8080)

        # Mock SDK as available
        self.server.chat_handler._sdk_status = SDKStatus(
            available=True, version="1.0.0"
        )

        await self.server.start.__wrapped__(self.server)

        return self.server.app

    async def tearDownAsync(self):
        """Clean up after tests."""
        if hasattr(self, "server") and self.server.runner:
            await self.server.runner.cleanup()

    @pytest.mark.asyncio
    async def test_websocket_chat_send_with_sdk(self):
        """Test chat.send with mocked SDK response."""

        # Mock the query function
        async def mock_query(*args, **kwargs):
            # Simulate AssistantMessage with TextBlock
            from documentation_robotics.server.chat_handler import (
                AssistantMessage,
                ResultMessage,
                TextBlock,
            )

            # Create mock objects
            text_block = MagicMock(spec=TextBlock)
            text_block.text = "Hello! I'm DrBot."

            assistant_msg = MagicMock(spec=AssistantMessage)
            assistant_msg.content = [text_block]

            result_msg = MagicMock(spec=ResultMessage)
            result_msg.total_cost_usd = 0.001

            yield assistant_msg
            yield result_msg

        with patch("documentation_robotics.server.chat_handler.query", side_effect=mock_query):
            async with self.client.ws_connect(
                f"/ws?token={self.server.token}"
            ) as ws:
                # Skip welcome and initial state
                await ws.receive_json()
                await ws.receive_json()

                # Send chat message
                await ws.send_json(
                    {
                        "jsonrpc": "2.0",
                        "method": "chat.send",
                        "params": {"message": "Hello"},
                        "id": "6",
                    }
                )

                # Collect responses
                responses = []
                while True:
                    try:
                        response = await asyncio.wait_for(ws.receive_json(), timeout=1.0)
                        responses.append(response)

                        # Check if we got the completion response
                        if "result" in response and response.get("id") == "6":
                            break
                    except asyncio.TimeoutError:
                        break

                # Should have received streaming response and completion
                assert len(responses) > 0

                # Check for response chunk
                chunks = [r for r in responses if r.get("method") == "chat.response.chunk"]
                assert len(chunks) > 0

                # Check for completion
                completions = [r for r in responses if r.get("id") == "6"]
                assert len(completions) == 1
                assert completions[0]["result"]["status"] == "complete"
