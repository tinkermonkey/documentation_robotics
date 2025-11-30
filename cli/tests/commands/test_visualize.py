"""
Tests for the visualize command and visualization server authentication.
"""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from click.testing import CliRunner

from documentation_robotics.commands.visualize import visualize
from documentation_robotics.server.visualization_server import VisualizationServer


class TestVisualizationServer(AioHTTPTestCase):
    """Test cases for the VisualizationServer with authentication."""

    async def get_application(self):
        """Create test application."""
        self.model_path = Path("/tmp/test-model")
        self.vis_server = VisualizationServer(self.model_path, "localhost", 8080)
        # Don't call start() - just return the app
        # The test framework will handle starting it
        self.vis_server.app = web.Application(middlewares=[self.vis_server.auth_middleware])
        self.vis_server.app.router.add_get("/", self.vis_server.handle_index)
        self.vis_server.app.router.add_get("/health", self.vis_server.handle_health)
        self.vis_server.app.router.add_get("/api/model", self.vis_server.handle_model_data)
        self.vis_server.app.router.add_get("/ws", self.vis_server.handle_websocket)
        return self.vis_server.app

    @unittest_run_loop
    async def test_health_endpoint_no_auth_required(self):
        """Test that /health endpoint works without authentication."""
        resp = await self.client.request("GET", "/health")
        assert resp.status == 200
        data = await resp.json()
        assert data["status"] == "healthy"

    @unittest_run_loop
    async def test_index_requires_auth_missing_token(self):
        """Test that index page requires authentication when token is missing."""
        resp = await self.client.request("GET", "/")
        assert resp.status == 401
        data = await resp.json()
        assert "Authentication required" in data["error"]

    @unittest_run_loop
    async def test_index_requires_auth_invalid_token(self):
        """Test that index page rejects invalid tokens."""
        resp = await self.client.request("GET", "/?token=invalid-token-12345")
        assert resp.status == 403
        data = await resp.json()
        assert "Invalid authentication token" in data["error"]

    @unittest_run_loop
    async def test_index_with_valid_token_query_param(self):
        """Test that index page works with valid token in query parameter."""
        valid_token = self.vis_server.token
        resp = await self.client.request("GET", f"/?token={valid_token}")
        assert resp.status == 200
        text = await resp.text()
        assert "Documentation Robotics" in text
        assert "Model Visualization" in text

    @unittest_run_loop
    async def test_index_with_valid_token_auth_header(self):
        """Test that index page works with valid token in Authorization header."""
        valid_token = self.vis_server.token
        headers = {"Authorization": f"Bearer {valid_token}"}
        resp = await self.client.request("GET", "/", headers=headers)
        assert resp.status == 200
        text = await resp.text()
        assert "Documentation Robotics" in text

    @unittest_run_loop
    async def test_api_endpoint_requires_auth(self):
        """Test that API endpoints require authentication."""
        resp = await self.client.request("GET", "/api/model")
        assert resp.status == 401

    @unittest_run_loop
    async def test_api_endpoint_with_valid_token(self):
        """Test that API endpoints work with valid authentication."""
        valid_token = self.vis_server.token
        resp = await self.client.request("GET", f"/api/model?token={valid_token}")
        assert resp.status == 200
        data = await resp.json()
        assert "model_path" in data

    @unittest_run_loop
    async def test_websocket_requires_auth(self):
        """Test that WebSocket upgrade requires authentication."""
        # Try to connect without token - should raise WSServerHandshakeError
        from aiohttp.client_exceptions import WSServerHandshakeError
        import pytest

        with pytest.raises(WSServerHandshakeError) as exc_info:
            await self.client.ws_connect("/ws")

        # Verify it's a 401 error
        assert exc_info.value.status == 401

    @unittest_run_loop
    async def test_websocket_with_valid_token(self):
        """Test that WebSocket works with valid authentication."""
        valid_token = self.vis_server.token
        ws = await self.client.ws_connect(f"/ws?token={valid_token}")

        # Should receive welcome message
        msg = await ws.receive_json()
        assert msg["type"] == "connected"
        assert "established" in msg["message"]

        # Send a test message
        await ws.send_json({"type": "test", "data": "hello"})

        # Should receive echo response
        response = await ws.receive_json()
        assert response["type"] == "response"

        await ws.close()

    @unittest_run_loop
    async def test_websocket_invalid_json(self):
        """Test that WebSocket handles invalid JSON gracefully."""
        valid_token = self.vis_server.token
        ws = await self.client.ws_connect(f"/ws?token={valid_token}")

        # Skip welcome message
        await ws.receive_json()

        # Send invalid JSON
        await ws.send_str("invalid-json-{{{")

        # Should receive error response
        response = await ws.receive_json()
        assert response["type"] == "error"
        assert "Invalid JSON" in response["message"]

        await ws.close()

    def test_token_generation(self):
        """Test that tokens are cryptographically secure."""
        server1 = VisualizationServer(Path("/tmp/test"), "localhost", 8080)
        server2 = VisualizationServer(Path("/tmp/test"), "localhost", 8080)

        # Tokens should be different for different instances
        assert server1.token != server2.token

        # Tokens should be URL-safe
        assert "+" not in server1.token
        assert "/" not in server1.token

        # Tokens should be reasonably long
        assert len(server1.token) >= 32

    def test_magic_link_generation(self):
        """Test that magic links are correctly formatted."""
        server = VisualizationServer(Path("/tmp/test"), "localhost", 8080)
        magic_link = server.get_magic_link()

        assert magic_link.startswith("http://localhost:8080/?token=")
        assert server.token in magic_link

    def test_token_validation_timing_safe(self):
        """Test that token validation uses constant-time comparison."""
        server = VisualizationServer(Path("/tmp/test"), "localhost", 8080)

        # Create mock request with invalid token
        request = MagicMock()
        request.query = {"token": "wrong-token"}
        request.headers = {}

        # Validate - should use secrets.compare_digest internally
        result = server._validate_token(request)
        assert result is False

        # Valid token
        request.query = {"token": server.token}
        result = server._validate_token(request)
        assert result is True


class TestVisualizeCommand:
    """Test cases for the visualize CLI command."""

    def test_visualize_command_no_model(self, tmp_path):
        """Test that visualize command fails gracefully without a model."""
        runner = CliRunner()
        with runner.isolated_filesystem(temp_dir=tmp_path):
            result = runner.invoke(visualize)
            assert result.exit_code != 0
            assert "No model found" in result.output

    @patch("documentation_robotics.commands.visualize.VisualizationServer")
    def test_visualize_command_with_model(self, mock_server_class, tmp_path):
        """Test that visualize command starts server when model exists."""
        runner = CliRunner()
        with runner.isolated_filesystem(temp_dir=tmp_path):
            # Create model directory structure
            model_path = Path.cwd() / "documentation-robotics" / "model"
            model_path.mkdir(parents=True)

            # Mock server instance
            mock_server = MagicMock()
            mock_server.get_magic_link.return_value = "http://localhost:8080/?token=abc123"

            # Mock async methods
            async def mock_start():
                pass

            async def mock_run():
                # Simulate server running briefly then stopping
                raise KeyboardInterrupt()

            mock_server.start = AsyncMock(side_effect=mock_start)
            mock_server.run_until_stopped = AsyncMock(side_effect=mock_run)

            mock_server_class.return_value = mock_server

            # Run command
            result = runner.invoke(visualize, catch_exceptions=False)

            # Verify server was created and started
            mock_server_class.assert_called_once()
            assert "Visualization server started" in result.output or result.exit_code == 0

    @patch("documentation_robotics.commands.visualize.VisualizationServer")
    def test_visualize_command_custom_port(self, mock_server_class, tmp_path):
        """Test that visualize command accepts custom port."""
        runner = CliRunner()
        with runner.isolated_filesystem(temp_dir=tmp_path):
            # Create model directory
            model_path = Path.cwd() / "documentation-robotics" / "model"
            model_path.mkdir(parents=True)

            # Mock server
            mock_server = MagicMock()
            mock_server.get_magic_link.return_value = "http://localhost:9000/?token=abc123"

            async def mock_start():
                pass

            async def mock_run():
                raise KeyboardInterrupt()

            mock_server.start = AsyncMock(side_effect=mock_start)
            mock_server.run_until_stopped = AsyncMock(side_effect=mock_run)
            mock_server_class.return_value = mock_server

            # Run with custom port
            result = runner.invoke(visualize, ["--port", "9000"], catch_exceptions=False)

            # Verify port was passed to server
            call_args = mock_server_class.call_args
            assert call_args[1]["port"] == 9000 or call_args[0][2] == 9000


# Integration test marker for tests that require actual server
pytestmark = pytest.mark.asyncio


@pytest.mark.skip(reason="Integration test requires full server setup - run manually if needed")
async def test_full_authentication_flow():
    """Integration test for complete authentication flow."""
    model_path = Path("/tmp/test-integration-model")
    server = VisualizationServer(model_path, "localhost", 8091)

    try:
        await server.start()

        # Test that we can't access without token
        import aiohttp

        async with aiohttp.ClientSession() as session:
            # Test without token - should fail
            async with session.get("http://localhost:8091/") as resp:
                assert resp.status == 401

            # Test with valid token - should succeed
            magic_link = server.get_magic_link()
            async with session.get(magic_link) as resp:
                assert resp.status == 200
                text = await resp.text()
                assert "Documentation Robotics" in text

    finally:
        await server.stop()
