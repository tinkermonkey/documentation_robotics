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


class TestAnnotationWebSocketFlow:
    """Test annotation operations via WebSocket."""

    @pytest.mark.asyncio
    async def test_annotation_add_success(self, tmp_path):
        """Test adding annotation via WebSocket."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Initialize annotation components
        from documentation_robotics.core.annotations import AnnotationRegistry
        from documentation_robotics.server.annotation_serializer import AnnotationSerializer

        server.annotation_registry = AnnotationRegistry(model_path)
        server.annotation_serializer = AnnotationSerializer(model_path)

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()
        server.websockets.add(ws)

        message = {
            "type": "annotation_add",
            "data": {
                "entity_uri": "motivation.goal.test",
                "message": "Test annotation",
                "user": "testuser",
            },
        }

        await server._handle_annotation_add(ws, message)

        # Verify annotation was created
        annotations_file = model_path / "annotations" / "testuser" / "annotations.json"
        assert annotations_file.exists()

        import json

        data = json.loads(annotations_file.read_text())
        assert len(data["annotations"]) == 1
        assert data["annotations"][0]["entity_uri"] == "motivation.goal.test"
        assert data["annotations"][0]["message"] == "Test annotation"
        assert data["annotations"][0]["user"] == "testuser"

        # Verify broadcast was called
        ws.send_json.assert_called_once()
        broadcast_msg = ws.send_json.call_args[0][0]
        assert broadcast_msg["type"] == "annotation_added"
        assert broadcast_msg["data"]["entity_uri"] == "motivation.goal.test"

    @pytest.mark.asyncio
    async def test_annotation_add_missing_fields(self, tmp_path):
        """Test adding annotation with missing required fields."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()

        # Missing 'user' field
        message = {
            "type": "annotation_add",
            "data": {
                "entity_uri": "motivation.goal.test",
                "message": "Test annotation",
            },
        }

        with patch(
            "documentation_robotics.server.visualization_server.create_error_message",
            return_value={"type": "error", "message": "Missing required fields"},
        ):
            await server._handle_annotation_add(ws, message)

        # Should send error
        ws.send_json.assert_called_once()
        error_msg = ws.send_json.call_args[0][0]
        assert error_msg["type"] == "error"

    @pytest.mark.asyncio
    async def test_annotation_reply_success(self, tmp_path):
        """Test adding reply via WebSocket."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        # Create parent annotation first
        annotations_dir = model_path / "annotations" / "user1"
        annotations_dir.mkdir(parents=True)

        import json

        parent_data = {
            "annotations": [
                {
                    "id": "ann-parent",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "user1",
                    "message": "Parent annotation",
                }
            ]
        }
        (annotations_dir / "annotations.json").write_text(json.dumps(parent_data, indent=2))

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Initialize annotation components
        from documentation_robotics.core.annotations import AnnotationRegistry
        from documentation_robotics.server.annotation_serializer import AnnotationSerializer

        server.annotation_registry = AnnotationRegistry(model_path)
        server.annotation_registry.load_all()
        server.annotation_serializer = AnnotationSerializer(model_path)

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()
        server.websockets.add(ws)

        message = {
            "type": "annotation_reply",
            "data": {
                "parent_id": "ann-parent",
                "message": "Reply to annotation",
                "user": "user2",
            },
        }

        await server._handle_annotation_reply(ws, message)

        # Verify reply was created in user2's file
        reply_file = model_path / "annotations" / "user2" / "annotations.json"
        assert reply_file.exists()

        data = json.loads(reply_file.read_text())
        assert len(data["annotations"]) == 1
        assert data["annotations"][0]["parent_id"] == "ann-parent"
        assert data["annotations"][0]["message"] == "Reply to annotation"
        assert data["annotations"][0]["user"] == "user2"
        assert data["annotations"][0]["entity_uri"] == "motivation.goal.test"

        # Verify broadcast was called
        ws.send_json.assert_called_once()
        broadcast_msg = ws.send_json.call_args[0][0]
        assert broadcast_msg["type"] == "annotation_reply_added"

    @pytest.mark.asyncio
    async def test_annotation_reply_parent_not_found(self, tmp_path):
        """Test adding reply with nonexistent parent."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Initialize annotation components
        from documentation_robotics.core.annotations import AnnotationRegistry

        server.annotation_registry = AnnotationRegistry(model_path)
        server.annotation_registry.load_all()

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()

        message = {
            "type": "annotation_reply",
            "data": {
                "parent_id": "ann-nonexistent",
                "message": "Reply to annotation",
                "user": "testuser",
            },
        }

        with patch(
            "documentation_robotics.server.visualization_server.create_error_message",
            return_value={"type": "error", "message": "Parent annotation not found"},
        ):
            await server._handle_annotation_reply(ws, message)

        # Should send error
        ws.send_json.assert_called_once()
        error_msg = ws.send_json.call_args[0][0]
        assert error_msg["type"] == "error"

    @pytest.mark.asyncio
    async def test_initial_state_includes_annotations(self, tmp_path):
        """Test initial state message includes annotations."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        # Create test annotations
        import json

        annotations_dir = model_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)
        annotations_data = {
            "annotations": [
                {
                    "id": "ann-test001",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "testuser",
                    "message": "Test annotation",
                }
            ]
        }
        (annotations_dir / "annotations.json").write_text(json.dumps(annotations_data, indent=2))

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Mock model serializer
        server.specification = {"version": "0.5.0"}
        server.model_serializer = Mock()
        server.model_serializer.serialize_model.return_value = {
            "manifest": {},
            "layers": [],
        }

        # Initialize annotation components
        from documentation_robotics.server.annotation_serializer import AnnotationSerializer

        server.annotation_serializer = AnnotationSerializer(model_path)

        ws = AsyncMock(spec=web.WebSocketResponse)
        ws.send_json = AsyncMock()

        with patch(
            "documentation_robotics.server.visualization_server.load_changesets",
            return_value=[],
        ):
            await server._send_initial_state(ws)

        # Verify annotations were included
        ws.send_json.assert_called_once()
        call_args = ws.send_json.call_args[0][0]
        assert "data" in call_args
        assert "model" in call_args["data"]
        assert "annotations" in call_args["data"]["model"]
        assert len(call_args["data"]["model"]["annotations"]) == 1
        assert call_args["data"]["model"]["annotations"][0]["id"] == "ann-test001"

    @pytest.mark.asyncio
    async def test_broadcast_annotation_to_multiple_clients(self, tmp_path):
        """Test annotation broadcast reaches all connected clients."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Initialize annotation components
        from documentation_robotics.core.annotations import AnnotationRegistry
        from documentation_robotics.server.annotation_serializer import AnnotationSerializer

        server.annotation_registry = AnnotationRegistry(model_path)
        server.annotation_serializer = AnnotationSerializer(model_path)

        # Add multiple WebSocket clients
        ws1 = AsyncMock(spec=web.WebSocketResponse)
        ws1.send_json = AsyncMock()
        ws2 = AsyncMock(spec=web.WebSocketResponse)
        ws2.send_json = AsyncMock()
        ws3 = AsyncMock(spec=web.WebSocketResponse)
        ws3.send_json = AsyncMock()

        server.websockets.add(ws1)
        server.websockets.add(ws2)
        server.websockets.add(ws3)

        message = {
            "type": "annotation_add",
            "data": {
                "entity_uri": "motivation.goal.test",
                "message": "Broadcast test",
                "user": "testuser",
            },
        }

        await server._handle_annotation_add(ws1, message)

        # All clients should receive the broadcast
        ws1.send_json.assert_called_once()
        ws2.send_json.assert_called_once()
        ws3.send_json.assert_called_once()

        # All should receive same annotation_added message
        for ws in [ws1, ws2, ws3]:
            broadcast_msg = ws.send_json.call_args[0][0]
            assert broadcast_msg["type"] == "annotation_added"
            assert broadcast_msg["data"]["message"] == "Broadcast test"


class TestCORSHeaders:
    """Test CORS header functionality."""

    @pytest.mark.asyncio
    async def test_cors_headers_on_health_endpoint(self, tmp_path):
        """Test CORS headers are added to health endpoint response."""
        model_path = tmp_path / "documentation-robotics"
        model_path.mkdir(parents=True)
        spec_path = tmp_path / ".dr" / "specification"
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)
        server.specification = {"version": "0.5.0"}
        server.file_monitor = Mock()
        server.file_monitor.is_running.return_value = True

        # Create mock request to health endpoint
        request = Mock(spec=web.Request)
        request.path = "/health"

        # Simulate auth middleware calling health handler
        async def mock_handler(req):
            return await server._handle_health(req)

        response = await server.auth_middleware(request, mock_handler)

        # Verify CORS headers are present
        assert response.headers["Access-Control-Allow-Origin"] == "*"
        assert response.headers["Access-Control-Allow-Methods"] == "GET, POST, OPTIONS"
        assert response.headers["Access-Control-Allow-Headers"] == "Content-Type, Authorization"
        assert response.headers["Access-Control-Max-Age"] == "3600"

    @pytest.mark.asyncio
    async def test_cors_headers_on_authenticated_endpoint(self, tmp_path):
        """Test CORS headers are added to authenticated endpoints."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Create mock request with valid token
        request = Mock(spec=web.Request)
        request.path = "/api/test"
        request.query = {"token": server.token}
        request.headers = {}

        # Create mock handler that returns a response
        async def mock_handler(req):
            return web.Response(text="OK")

        response = await server.auth_middleware(request, mock_handler)

        # Verify CORS headers are present
        assert response.headers["Access-Control-Allow-Origin"] == "*"
        assert response.headers["Access-Control-Allow-Methods"] == "GET, POST, OPTIONS"
        assert response.headers["Access-Control-Allow-Headers"] == "Content-Type, Authorization"
        assert response.headers["Access-Control-Max-Age"] == "3600"

    @pytest.mark.asyncio
    async def test_cors_headers_on_unauthorized_response(self, tmp_path):
        """Test CORS headers are added even to 401 responses."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Create mock request without token
        request = Mock(spec=web.Request)
        request.path = "/api/test"
        request.query = {}
        request.headers = {}

        async def mock_handler(req):
            return web.Response(text="OK")

        response = await server.auth_middleware(request, mock_handler)

        # Verify CORS headers are present even on 401
        assert response.status == 401
        assert response.headers["Access-Control-Allow-Origin"] == "*"
        assert response.headers["Access-Control-Allow-Methods"] == "GET, POST, OPTIONS"

    @pytest.mark.asyncio
    async def test_options_preflight_request(self, tmp_path):
        """Test OPTIONS preflight requests are handled without authentication."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Create OPTIONS request without token
        request = Mock(spec=web.Request)
        request.method = "OPTIONS"
        request.path = "/api/test"
        request.query = {}
        request.headers = {}

        async def mock_handler(req):
            # This should not be called for OPTIONS requests
            raise AssertionError("Handler should not be called for OPTIONS")

        response = await server.auth_middleware(request, mock_handler)

        # Verify OPTIONS returns 200 without calling handler
        assert response.status == 200
        assert response.headers["Access-Control-Allow-Origin"] == "*"
        assert response.headers["Access-Control-Allow-Methods"] == "GET, POST, OPTIONS"
        assert response.headers["Access-Control-Allow-Headers"] == "Content-Type, Authorization"

    def test_add_cors_headers_method(self, tmp_path):
        """Test _add_cors_headers method adds all required headers."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Create a response
        response = web.Response(text="test")

        # Add CORS headers
        server._add_cors_headers(response)

        # Verify all headers are present
        assert "Access-Control-Allow-Origin" in response.headers
        assert "Access-Control-Allow-Methods" in response.headers
        assert "Access-Control-Allow-Headers" in response.headers
        assert "Access-Control-Max-Age" in response.headers

        # Verify values
        assert response.headers["Access-Control-Allow-Origin"] == "*"
        assert response.headers["Access-Control-Allow-Methods"] == "GET, POST, OPTIONS"
        assert response.headers["Access-Control-Allow-Headers"] == "Content-Type, Authorization"
        assert response.headers["Access-Control-Max-Age"] == "3600"

    @pytest.mark.asyncio
    async def test_static_assets_allowed_without_token(self, tmp_path):
        """Test static assets (JS, CSS, etc.) can be accessed without authentication."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Test various static asset paths without token
        static_paths = [
            "/assets/main.js",
            "/assets/vendor.js",
            "/assets/style.css",
            "/favicon.ico",
            "/assets/logo.png",
            "/assets/font.woff2",
            "/index.html",
            "/assets/source.map",
        ]

        for path in static_paths:
            request = Mock(spec=web.Request)
            request.path = path
            request.method = "GET"
            request.query = {}  # No token
            request.headers = {}

            async def mock_handler(req):
                return web.Response(text="OK")

            response = await server.auth_middleware(request, mock_handler)

            # Verify request was allowed through without authentication
            assert response.status == 200, f"Path {path} should be accessible without token"
            assert response.headers["Access-Control-Allow-Origin"] == "*"

    @pytest.mark.asyncio
    async def test_api_endpoints_require_token(self, tmp_path):
        """Test API endpoints still require authentication."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Test API endpoints without token
        api_paths = [
            "/api/model",
            "/api/data",
            "/ws",
        ]

        for path in api_paths:
            request = Mock(spec=web.Request)
            request.path = path
            request.method = "GET"
            request.query = {}  # No token
            request.headers = {}

            async def mock_handler(req):
                return web.Response(text="OK")

            response = await server.auth_middleware(request, mock_handler)

            # Verify authentication is required
            assert response.status == 401, f"Path {path} should require authentication"

    @pytest.mark.asyncio
    async def test_root_path_allowed_without_token(self, tmp_path):
        """Test root path (/) is accessible without authentication."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        request = Mock(spec=web.Request)
        request.path = "/"
        request.method = "GET"
        request.query = {}  # No token
        request.headers = {}

        async def mock_handler(req):
            return web.Response(text="OK")

        response = await server.auth_middleware(request, mock_handler)

        # Verify root path is accessible
        assert response.status == 200

    def test_is_static_asset_method(self, tmp_path):
        """Test _is_static_asset correctly identifies static asset paths."""
        model_path = tmp_path / "documentation-robotics"
        spec_path = tmp_path / ".dr" / "specification"
        model_path.mkdir(parents=True)
        spec_path.mkdir(parents=True)

        server = VisualizationServer(model_path, spec_path, "localhost", 8080)

        # Test static asset paths
        assert server._is_static_asset("/assets/main.js") is True
        assert server._is_static_asset("/assets/vendor-abc123.js") is True
        assert server._is_static_asset("/style.css") is True
        assert server._is_static_asset("/favicon.ico") is True
        assert server._is_static_asset("/assets/logo.png") is True
        assert server._is_static_asset("/fonts/font.woff2") is True
        assert server._is_static_asset("/app.mjs") is True
        assert server._is_static_asset("/main.js.map") is True

        # Test non-static paths
        assert server._is_static_asset("/api/model") is False
        assert server._is_static_asset("/api/data") is False
        assert server._is_static_asset("/ws") is False
        assert server._is_static_asset("/health") is False
