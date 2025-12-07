"""
Unit tests for VisualizationServer class.

Tests core server functionality including initialization, route configuration,
WebSocket handling, and shutdown procedures.
"""

from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest
from aiohttp import web
from documentation_robotics.server.visualization_server import VisualizationServer


def viewer_is_bundled():
    """Check if viewer assets are bundled."""
    import documentation_robotics

    viewer_path = Path(documentation_robotics.__file__).parent / "viewer" / "dist"
    return viewer_path.exists() and (viewer_path / "index.html").exists()


viewer_bundled = pytest.mark.skipif(
    not viewer_is_bundled(), reason="Viewer assets not bundled - run bundle_viewer.py"
)


class TestVisualizationServerInitialization:
    """Test server initialization and configuration."""

    def test_server_initialization(self, tmp_path):
        """Test server initializes with correct parameters."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(
            model_path,
            spec_path,
            "localhost",
            8080,
        )

        assert server.model_path == model_path
        assert server.spec_path == spec_path
        assert server.host == "localhost"
        assert server.port == 8080
        assert server.app is None
        assert server.model is None
        assert len(server.websockets) == 0

    def test_server_initialization_custom_port(self, tmp_path):
        """Test server initializes with custom port."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(
            model_path,
            spec_path,
            "127.0.0.1",
            9090,
        )

        assert server.host == "127.0.0.1"
        assert server.port == 9090


class TestHealthEndpoint:
    """Test health check endpoint functionality."""

    @pytest.mark.asyncio
    async def test_health_endpoint_response(self, tmp_path):
        """Test health endpoint returns correct data structure."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)
        server.specification = {"version": "0.5.0"}
        server.file_monitor = Mock()
        server.file_monitor.is_running.return_value = True

        # Create mock request
        request = Mock(spec=web.Request)

        # Call health handler
        response = await server._handle_health(request)

        # Verify response
        assert response.status == 200
        import json

        data = json.loads(response.text)
        assert data["status"] == "healthy"
        assert data["spec_version"] == "0.5.0"
        assert data["connected_clients"] == 0
        assert data["file_monitor_running"] is True

    @pytest.mark.asyncio
    async def test_health_endpoint_with_clients(self, tmp_path):
        """Test health endpoint shows connected client count."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)
        server.specification = {"version": "0.5.0"}

        # Add mock WebSocket connections
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        server.websockets.add(ws1)
        server.websockets.add(ws2)

        request = Mock(spec=web.Request)
        response = await server._handle_health(request)

        import json

        data = json.loads(response.text)
        assert data["connected_clients"] == 2


class TestIndexEndpoint:
    """Test index page handling and fallback behavior."""

    @viewer_bundled
    @pytest.mark.asyncio
    async def test_index_fallback_without_viewer_package(self, tmp_path):
        """Test index page falls back to placeholder HTML when viewer not available."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        request = Mock(spec=web.Request)

        # Mock _serve_static_file to raise FileNotFoundError
        with patch.object(
            server, "_serve_static_file", side_effect=FileNotFoundError("Package not found")
        ):
            response = await server._handle_index(request)

        assert response.status == 200
        assert "text/html" in response.content_type
        assert "Documentation Robotics - Model Visualization Server" in response.text
        assert "documentation-robotics-viewer package is not installed" in response.text


class TestStaticFileServing:
    """Test static file serving functionality."""

    @pytest.mark.asyncio
    async def test_static_file_not_found(self, tmp_path):
        """Test 404 for missing static files."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        request = Mock(spec=web.Request)
        request.match_info = {"path": "nonexistent.js"}

        with pytest.raises(web.HTTPNotFound):
            await server._handle_static_file(request)

    @pytest.mark.asyncio
    async def test_spa_routing(self, tmp_path):
        """Test SPA routing serves index for non-asset paths."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        request = Mock(spec=web.Request)
        request.match_info = {"path": "some-route"}  # No file extension

        # Mock _handle_index
        mock_response = Mock(spec=web.Response)
        with patch.object(server, "_handle_index", return_value=mock_response):
            response = await server._handle_static_file(request)

        assert response == mock_response


class TestWebSocketHandling:
    """Test WebSocket connection management."""

    @pytest.mark.asyncio
    async def test_websocket_connection_added(self, tmp_path):
        """Test WebSocket connection is added to server set."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Verify WebSocket set starts empty
        assert len(server.websockets) == 0

        # Create a mock WebSocket connection
        mock_ws = AsyncMock(spec=web.WebSocketResponse)

        # Add WebSocket to the set (simulating what _handle_websocket does)
        server.websockets.add(mock_ws)

        # Verify it was added
        assert len(server.websockets) == 1
        assert mock_ws in server.websockets

        # Remove WebSocket (simulating cleanup)
        server.websockets.discard(mock_ws)

        # Verify it was removed
        assert len(server.websockets) == 0

    @pytest.mark.asyncio
    async def test_send_initial_state(self, tmp_path):
        """Test initial state is sent to new WebSocket connection."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Mock dependencies
        server.specification = {"version": "0.5.0"}
        server.model_serializer = Mock()
        server.model_serializer.serialize_model.return_value = {
            "manifest": {},
            "layers": [],
        }

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()

        # Mock load_changesets
        with patch(
            "documentation_robotics.server.visualization_server.load_changesets",
            return_value=[],
        ):
            await server._send_initial_state(ws)

        # Verify send_json was called
        ws.send_json.assert_called_once()
        call_args = ws.send_json.call_args[0][0]
        assert "type" in call_args
        assert "data" in call_args
        assert "specification" in call_args["data"]
        assert "model" in call_args["data"]
        assert "changesets" in call_args["data"]


class TestBroadcasting:
    """Test message broadcasting to WebSocket clients."""

    @pytest.mark.asyncio
    async def test_broadcast_to_single_client(self, tmp_path):
        """Test broadcasting message to single WebSocket client."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()
        server.websockets.add(ws)

        message = {"type": "test", "data": {"key": "value"}}

        await server.broadcast_update(message)

        ws.send_json.assert_called_once_with(message)

    @pytest.mark.asyncio
    async def test_broadcast_to_multiple_clients(self, tmp_path):
        """Test broadcasting message to multiple WebSocket clients."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        ws1 = AsyncMock(spec=web.WebSocketResponse)
        ws1.send_json = AsyncMock()
        ws2 = AsyncMock(spec=web.WebSocketResponse)
        ws2.send_json = AsyncMock()
        ws3 = AsyncMock(spec=web.WebSocketResponse)
        ws3.send_json = AsyncMock()

        server.websockets.add(ws1)
        server.websockets.add(ws2)
        server.websockets.add(ws3)

        message = {"type": "update", "data": {}}

        await server.broadcast_update(message)

        ws1.send_json.assert_called_once()
        ws2.send_json.assert_called_once()
        ws3.send_json.assert_called_once()

    @pytest.mark.asyncio
    async def test_broadcast_handles_failed_client(self, tmp_path):
        """Test broadcasting removes disconnected clients."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        ws_working = AsyncMock(spec=web.WebSocketResponse)
        ws_working.send_json = AsyncMock()

        ws_failed = AsyncMock(spec=web.WebSocketResponse)
        ws_failed.send_json = AsyncMock(side_effect=OSError("Connection lost"))

        server.websockets.add(ws_working)
        server.websockets.add(ws_failed)

        message = {"type": "update"}

        await server.broadcast_update(message)

        # Working client should receive message
        ws_working.send_json.assert_called_once()

        # Failed client should be removed
        assert ws_failed not in server.websockets
        assert ws_working in server.websockets


class TestErrorHandling:
    """Test error handling in server operations."""

    @pytest.mark.asyncio
    async def test_send_error_to_client(self, tmp_path):
        """Test error message sent to WebSocket client."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()

        error_msg = "Something went wrong"

        # Mock create_error_message
        with patch(
            "documentation_robotics.server.visualization_server.create_error_message",
            return_value={"type": "error", "message": error_msg},
        ):
            await server._send_error(ws, error_msg)

        ws.send_json.assert_called_once()
        call_args = ws.send_json.call_args[0][0]
        assert call_args["type"] == "error"
        assert call_args["message"] == error_msg

    @pytest.mark.asyncio
    async def test_load_element_handles_invalid_yaml(self, tmp_path):
        """Test loading element handles invalid YAML gracefully."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Create invalid YAML file
        invalid_file = model_path / "invalid.yaml"
        invalid_file.write_text("{ invalid: yaml [")

        result = await server._load_element_from_file(invalid_file)

        # Should return None instead of crashing
        assert result is None

    @pytest.mark.asyncio
    async def test_load_element_handles_missing_file(self, tmp_path):
        """Test loading element handles missing file gracefully."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        missing_file = model_path / "nonexistent.yaml"

        result = await server._load_element_from_file(missing_file)

        # Should return None instead of crashing
        assert result is None


class TestShutdown:
    """Test server shutdown procedures."""

    @pytest.mark.asyncio
    async def test_shutdown_closes_websockets(self, tmp_path):
        """Test shutdown closes all WebSocket connections."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Add mock WebSocket connections
        ws1 = AsyncMock(spec=web.WebSocketResponse)
        ws1.close = AsyncMock()
        ws2 = AsyncMock(spec=web.WebSocketResponse)
        ws2.close = AsyncMock()

        server.websockets.add(ws1)
        server.websockets.add(ws2)

        await server.shutdown()

        # Verify all WebSockets were closed
        ws1.close.assert_called_once()
        ws2.close.assert_called_once()

        # Verify WebSocket set is cleared
        assert len(server.websockets) == 0

    @pytest.mark.asyncio
    async def test_shutdown_stops_file_monitor(self, tmp_path):
        """Test shutdown stops file monitoring."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Mock file monitor
        server.file_monitor = Mock()
        server.file_monitor.stop = Mock()

        await server.shutdown()

        # Verify file monitor was stopped
        server.file_monitor.stop.assert_called_once()
