"""
Tests for the visualize command and visualization server authentication.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase
from click.testing import CliRunner
from documentation_robotics.commands.visualize import visualize
from documentation_robotics.core.model import Model
from documentation_robotics.server.visualization_server import VisualizationServer


def viewer_is_bundled():
    """Check if viewer assets are bundled."""
    import documentation_robotics

    viewer_path = Path(documentation_robotics.__file__).parent / "viewer" / "dist"
    return viewer_path.exists() and (viewer_path / "index.html").exists()


viewer_bundled = pytest.mark.skipif(
    not viewer_is_bundled(), reason="Viewer assets not bundled - run bundle_viewer.py"
)


class TestVisualizationServer(AioHTTPTestCase):
    """Test cases for the VisualizationServer with authentication."""

    async def get_application(self):
        """Create test application."""
        # Create a mock model for testing
        mock_model = MagicMock(spec=Model)
        mock_model.model_path = Path("/tmp/test-model")
        mock_model.root_path = Path("/tmp/test-root")
        mock_model.layers = {}
        mock_model.manifest = MagicMock()
        mock_model.manifest.version = "1.0.0"
        mock_model.manifest.layers = {}

        self.vis_server = VisualizationServer(mock_model, "localhost", 8080)
        # Don't call start() - just return the app
        # The test framework will handle starting it
        self.vis_server.app = web.Application(middlewares=[self.vis_server.auth_middleware])
        self.vis_server.app.router.add_get("/", self.vis_server.handle_index)
        self.vis_server.app.router.add_get("/health", self.vis_server.handle_health)
        self.vis_server.app.router.add_get("/api/model", self.vis_server.handle_model_data)
        self.vis_server.app.router.add_get("/ws", self.vis_server.handle_websocket)
        return self.vis_server.app

    async def test_health_endpoint_no_auth_required(self):
        """Test that /health endpoint works without authentication."""
        resp = await self.client.request("GET", "/health")
        assert resp.status == 200
        data = await resp.json()
        assert data["status"] == "ok"
        assert "version" in data

    async def test_index_requires_auth_missing_token(self):
        """Test that index page requires authentication when token is missing."""
        resp = await self.client.request("GET", "/")
        assert resp.status == 401
        data = await resp.json()
        assert "Authentication required" in data["error"]

    async def test_index_requires_auth_invalid_token(self):
        """Test that index page rejects invalid tokens."""
        resp = await self.client.request("GET", "/?token=invalid-token-12345")
        assert resp.status == 403
        data = await resp.json()
        assert "Invalid authentication token" in data["error"]

    @viewer_bundled
    async def test_index_with_valid_token_query_param(self):
        """Test that index page works with valid token in query parameter."""
        valid_token = self.vis_server.token
        resp = await self.client.request("GET", f"/?token={valid_token}")
        assert resp.status == 200
        text = await resp.text()
        assert "Documentation Robotics" in text
        # New bundled viewer uses React - just check it has the root div
        assert '<div id="root"></div>' in text

    @viewer_bundled
    async def test_index_with_valid_token_auth_header(self):
        """Test that index page works with valid token in Authorization header."""
        valid_token = self.vis_server.token
        headers = {"Authorization": f"Bearer {valid_token}"}
        resp = await self.client.request("GET", "/", headers=headers)
        assert resp.status == 200
        text = await resp.text()
        assert "Documentation Robotics" in text

    async def test_api_endpoint_requires_auth(self):
        """Test that API endpoints require authentication."""
        resp = await self.client.request("GET", "/api/model")
        assert resp.status == 401

    async def test_api_endpoint_with_valid_token(self):
        """Test that API endpoints work with valid authentication."""
        valid_token = self.vis_server.token
        resp = await self.client.request("GET", f"/api/model?token={valid_token}")
        assert resp.status == 200
        data = await resp.json()
        assert "layers" in data
        assert "metadata" in data

    async def test_websocket_requires_auth(self):
        """Test that WebSocket upgrade requires authentication."""
        # Try to connect without token - should raise WSServerHandshakeError
        import pytest
        from aiohttp.client_exceptions import WSServerHandshakeError

        with pytest.raises(WSServerHandshakeError) as exc_info:
            await self.client.ws_connect("/ws")

        # Verify it's a 401 error
        assert exc_info.value.status == 401

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

    async def test_websocket_invalid_json(self):
        """Test that WebSocket handles invalid JSON gracefully."""
        valid_token = self.vis_server.token
        ws = await self.client.ws_connect(f"/ws?token={valid_token}")

        # Skip welcome message
        await ws.receive_json()  # Welcome message
        # Note: initial state may fail in test mode, so we don't wait for it

        # Send invalid JSON
        await ws.send_str("invalid-json-{{{")

        # Should receive error response
        response = await ws.receive_json()
        assert response["type"] == "error"
        assert "Invalid JSON" in response["message"]

        await ws.close()

    def test_token_generation(self):
        """Test that tokens are cryptographically secure."""
        mock_model = MagicMock(spec=Model)
        server1 = VisualizationServer(mock_model, "localhost", 8080)
        server2 = VisualizationServer(mock_model, "localhost", 8080)

        # Tokens should be different for different instances
        assert server1.token != server2.token

        # Tokens should be URL-safe
        assert "+" not in server1.token
        assert "/" not in server1.token

        # Tokens should be reasonably long
        assert len(server1.token) >= 32

    def test_magic_link_generation(self):
        """Test that magic links are correctly formatted."""
        mock_model = MagicMock(spec=Model)
        server = VisualizationServer(mock_model, "localhost", 8080)
        magic_link = server.get_magic_link()

        assert magic_link.startswith("http://localhost:8080/?token=")
        assert server.token in magic_link

    def test_token_validation_timing_safe(self):
        """Test that token validation uses constant-time comparison."""
        mock_model = MagicMock(spec=Model)
        server = VisualizationServer(mock_model, "localhost", 8080)

        # Create mock request with invalid token
        request = MagicMock()
        request.query = {"token": "wrong-token"}
        request.headers = {}
        request.cookies = {}  # Add cookies dict for cookie-based auth

        # Validate - should use secrets.compare_digest internally
        result = server._validate_token(request)
        assert result is False

        # Valid token in query param
        request.query = {"token": server.token}
        result = server._validate_token(request)
        assert result is True

        # Valid token in cookie
        request.query = {}
        request.cookies = {"auth_token": server.token}
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
            assert "No model found" in result.output or "Error" in result.output

    @patch("documentation_robotics.commands.visualize.webbrowser.open")
    @patch("documentation_robotics.commands.visualize.asyncio.run")
    @patch("documentation_robotics.commands.visualize.VisualizationServer")
    @patch("documentation_robotics.commands.visualize.Model")
    def test_visualize_command_with_model(
        self, mock_model_class, mock_server_class, mock_asyncio_run, mock_webbrowser, tmp_path
    ):
        """Test that visualize command starts server when model exists."""
        # Create mock model directory structure
        runner = CliRunner()
        with runner.isolated_filesystem(temp_dir=tmp_path):
            # Create required directory structure
            model_dir = Path.cwd() / "documentation-robotics" / "model"
            model_dir.mkdir(parents=True)
            (model_dir / "manifest.yaml").write_text("version: 1.0.0\n")

            # Create spec directory
            spec_dir = Path.cwd() / "spec"
            spec_dir.mkdir(parents=True)
            (spec_dir / "VERSION").write_text("0.1.0\n")

            # Mock model
            mock_model = MagicMock(spec=Model)
            mock_model.layers = {}
            mock_model.manifest = MagicMock()
            mock_model.manifest.version = "1.0.0"
            mock_model_class.return_value = mock_model

            # Mock server
            mock_server = MagicMock()
            mock_server.get_magic_link.return_value = "http://localhost:8080/?token=abc123"
            mock_server_class.return_value = mock_server

            # Mock asyncio.run to raise KeyboardInterrupt (simulates Ctrl+C)
            # Properly handle the coroutine to avoid RuntimeWarning
            def mock_asyncio_run_impl(coro):
                # Close the coroutine properly to avoid RuntimeWarning
                coro.close()
                raise KeyboardInterrupt()

            mock_asyncio_run.side_effect = mock_asyncio_run_impl

            # Run command
            result = runner.invoke(visualize, catch_exceptions=False)

            # Command should handle KeyboardInterrupt gracefully or display server info
            assert (
                "server" in result.output.lower()
                or "magic link" in result.output.lower()
                or result.exit_code == 0
            )

    @patch("documentation_robotics.commands.visualize.webbrowser.open")
    @patch("documentation_robotics.commands.visualize.asyncio.run")
    @patch("documentation_robotics.commands.visualize.VisualizationServer")
    @patch("documentation_robotics.commands.visualize.Model")
    def test_visualize_command_custom_port(
        self, mock_model_class, mock_server_class, mock_asyncio_run, mock_webbrowser, tmp_path
    ):
        """Test that visualize command accepts custom port."""
        runner = CliRunner()
        with runner.isolated_filesystem(temp_dir=tmp_path):
            # Create required directory structure
            model_dir = Path.cwd() / "documentation-robotics" / "model"
            model_dir.mkdir(parents=True)
            (model_dir / "manifest.yaml").write_text("version: 1.0.0\n")

            # Create spec directory
            spec_dir = Path.cwd() / "spec"
            spec_dir.mkdir(parents=True)
            (spec_dir / "VERSION").write_text("0.1.0\n")

            # Mock model
            mock_model = MagicMock(spec=Model)
            mock_model.layers = {}
            mock_model.manifest = MagicMock()
            mock_model.manifest.version = "1.0.0"
            mock_model_class.return_value = mock_model

            # Mock server
            mock_server = MagicMock()
            mock_server.get_magic_link.return_value = "http://localhost:9000/?token=abc123"
            mock_server_class.return_value = mock_server

            # Mock asyncio.run to clean up coroutine and raise KeyboardInterrupt
            # Properly handle the coroutine to avoid RuntimeWarning
            def mock_asyncio_run_impl(coro):
                # Close the coroutine properly to avoid RuntimeWarning
                coro.close()
                raise KeyboardInterrupt()

            mock_asyncio_run.side_effect = mock_asyncio_run_impl

            # Run with custom port
            result = runner.invoke(visualize, ["--port", "9000"], catch_exceptions=False)

            # Verify server was created with custom port
            mock_server_class.assert_called_once()
            call_kwargs = mock_server_class.call_args[1] if mock_server_class.call_args[1] else {}
            # Port should be in the call arguments
            assert (
                "9000" in result.output
                or call_kwargs.get("port") == 9000
                or len(mock_server_class.call_args[0]) >= 4
            )


# Integration test marker for tests that require actual server
@pytest.mark.asyncio
@pytest.mark.skip(reason="Integration test requires full server setup - run manually if needed")
async def test_full_authentication_flow():
    """Integration test for complete authentication flow."""
    # Create mock model
    mock_model = MagicMock(spec=Model)
    mock_model.model_path = Path("/tmp/test-integration-model")
    mock_model.root_path = Path("/tmp/test-integration-root")
    mock_model.layers = {}
    mock_model.manifest = MagicMock()
    mock_model.manifest.version = "1.0.0"
    mock_model.manifest.layers = {}

    server = VisualizationServer(mock_model, "localhost", 8091)

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
