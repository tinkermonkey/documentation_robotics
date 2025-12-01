"""
Integration tests for file monitoring and WebSocket broadcasting.

Tests the end-to-end flow of:
1. File system changes detected by FileMonitor
2. Changes processed by VisualizationServer
3. Updates broadcast to WebSocket clients
"""

import asyncio
from unittest.mock import AsyncMock, Mock

import pytest
from aiohttp import web
from documentation_robotics.server.file_monitor import FileMonitor
from documentation_robotics.server.visualization_server import VisualizationServer


@pytest.fixture
def mock_ws():
    """Create a mock WebSocket connection."""
    ws = AsyncMock(spec=web.WebSocketResponse)
    ws.send_json = AsyncMock()
    ws.close = AsyncMock()
    ws.exception = Mock(return_value=None)
    return ws


@pytest.fixture
def initialized_server(initialized_model, temp_dir):
    """Create and initialize a VisualizationServer for testing."""
    spec_path = temp_dir / ".dr" / "specification"
    spec_path.mkdir(parents=True, exist_ok=True)

    # Create VERSION file
    (spec_path / "VERSION").write_text("0.5.0")

    # Create schemas directory
    (spec_path / "schemas").mkdir(exist_ok=True)

    server = VisualizationServer(
        temp_dir / "documentation-robotics",
        spec_path,
        "localhost",
        8080,
    )

    # Load model and spec manually instead of calling start()
    from documentation_robotics.server.model_serializer import ModelSerializer
    from documentation_robotics.server.specification_loader import SpecificationLoader

    spec_loader = SpecificationLoader(spec_path)
    server.specification = spec_loader.load_specification()
    server.model = initialized_model
    server.model_serializer = ModelSerializer(initialized_model)

    yield server

    # Cleanup
    if server.file_monitor and server.file_monitor.is_running():
        server.file_monitor.stop()


class TestFileChangeDetection:
    """Test file change detection and event handling."""

    @pytest.mark.asyncio
    async def test_file_creation_detected(self, initialized_server, temp_dir):
        """Test file creation is detected and triggers callback."""
        callback_called = asyncio.Event()
        received_args = []

        def callback(event_type, layer, file_path):
            received_args.append((event_type, layer, file_path))
            callback_called.set()

        # Start file monitor
        model_path = initialized_server.model.model_path
        monitor = FileMonitor(model_path, callback, debounce_seconds=0.1)
        monitor.start()

        try:
            # Create a new file
            layer_dir = model_path / "business"
            layer_dir.mkdir(parents=True, exist_ok=True)
            new_file = layer_dir / "new-service.yaml"
            new_file.write_text("id: business.service.new\nname: New Service\n")

            # Wait for callback
            await asyncio.wait_for(callback_called.wait(), timeout=1.0)

            # Verify callback was called with correct arguments
            assert len(received_args) > 0
            event_type, layer, file_path = received_args[0]
            assert event_type == "created"
            assert layer == "business"
            assert file_path.name == "new-service.yaml"

        finally:
            monitor.stop()

    @pytest.mark.asyncio
    async def test_file_modification_detected(self, initialized_server, temp_dir):
        """Test file modification is detected and triggers callback."""
        callback_called = asyncio.Event()
        received_args = []

        def callback(event_type, layer, file_path):
            received_args.append((event_type, layer, file_path))
            if event_type == "modified":
                callback_called.set()

        # Create file before starting monitor
        model_path = initialized_server.model.model_path
        layer_dir = model_path / "business"
        layer_dir.mkdir(parents=True, exist_ok=True)
        test_file = layer_dir / "existing-service.yaml"
        test_file.write_text("id: business.service.existing\nname: Original\n")

        # Start file monitor
        monitor = FileMonitor(model_path, callback, debounce_seconds=0.1)
        monitor.start()

        try:
            # Give monitor time to initialize
            await asyncio.sleep(0.1)

            # Modify the file
            test_file.write_text("id: business.service.existing\nname: Updated\n")

            # Wait for callback
            await asyncio.wait_for(callback_called.wait(), timeout=1.0)

            # Verify callback was called for modification
            modified_events = [args for args in received_args if args[0] == "modified"]
            assert len(modified_events) > 0
            event_type, layer, file_path = modified_events[0]
            assert event_type == "modified"
            assert layer == "business"

        finally:
            monitor.stop()

    @pytest.mark.asyncio
    async def test_file_deletion_detected(self, initialized_server, temp_dir):
        """Test file deletion is detected and triggers callback."""
        callback_called = asyncio.Event()
        received_args = []

        def callback(event_type, layer, file_path):
            received_args.append((event_type, layer, file_path))
            if event_type == "deleted":
                callback_called.set()

        # Create file before starting monitor
        model_path = initialized_server.model.model_path
        layer_dir = model_path / "business"
        layer_dir.mkdir(parents=True, exist_ok=True)
        test_file = layer_dir / "to-delete.yaml"
        test_file.write_text("id: business.service.to-delete\nname: To Delete\n")

        # Start file monitor
        monitor = FileMonitor(model_path, callback, debounce_seconds=0.1)
        monitor.start()

        try:
            # Give monitor time to initialize
            await asyncio.sleep(0.1)

            # Delete the file
            test_file.unlink()

            # Wait for callback
            await asyncio.wait_for(callback_called.wait(), timeout=1.0)

            # Verify callback was called for deletion
            deleted_events = [args for args in received_args if args[0] == "deleted"]
            assert len(deleted_events) > 0
            event_type, layer, file_path = deleted_events[0]
            assert event_type == "deleted"
            assert layer == "business"

        finally:
            monitor.stop()


class TestWebSocketBroadcasting:
    """Test broadcasting file changes to WebSocket clients."""

    @pytest.mark.asyncio
    async def test_broadcast_element_added(self, initialized_server, mock_ws):
        """Test broadcasting element added message."""
        # Add WebSocket to server
        initialized_server.websockets.add(mock_ws)

        # Create update message
        update_message = {
            "type": "element_added",
            "data": {
                "layer": "business",
                "element_id": "business.service.new",
                "element": {"id": "business.service.new", "name": "New Service"},
            },
        }

        # Broadcast update
        await initialized_server.broadcast_update(update_message)

        # Verify WebSocket received message
        mock_ws.send_json.assert_called_once()
        sent_message = mock_ws.send_json.call_args[0][0]
        assert sent_message["type"] == "element_added"
        assert sent_message["data"]["element_id"] == "business.service.new"

    @pytest.mark.asyncio
    async def test_broadcast_element_updated(self, initialized_server, mock_ws):
        """Test broadcasting element updated message."""
        initialized_server.websockets.add(mock_ws)

        update_message = {
            "type": "element_updated",
            "data": {
                "layer": "business",
                "element_id": "business.service.existing",
                "element": {"id": "business.service.existing", "name": "Updated Service"},
            },
        }

        await initialized_server.broadcast_update(update_message)

        mock_ws.send_json.assert_called_once()
        sent_message = mock_ws.send_json.call_args[0][0]
        assert sent_message["type"] == "element_updated"

    @pytest.mark.asyncio
    async def test_broadcast_element_removed(self, initialized_server, mock_ws):
        """Test broadcasting element removed message."""
        initialized_server.websockets.add(mock_ws)

        update_message = {
            "type": "element_removed",
            "data": {"layer": "business", "element_id": "business.service.deleted"},
        }

        await initialized_server.broadcast_update(update_message)

        mock_ws.send_json.assert_called_once()
        sent_message = mock_ws.send_json.call_args[0][0]
        assert sent_message["type"] == "element_removed"
        assert sent_message["data"]["element_id"] == "business.service.deleted"

    @pytest.mark.asyncio
    async def test_broadcast_to_multiple_clients(self, initialized_server):
        """Test broadcasting to multiple WebSocket clients."""
        # Create multiple mock WebSocket connections
        ws1 = AsyncMock(spec=web.WebSocketResponse)
        ws1.send_json = AsyncMock()

        ws2 = AsyncMock(spec=web.WebSocketResponse)
        ws2.send_json = AsyncMock()

        ws3 = AsyncMock(spec=web.WebSocketResponse)
        ws3.send_json = AsyncMock()

        initialized_server.websockets.add(ws1)
        initialized_server.websockets.add(ws2)
        initialized_server.websockets.add(ws3)

        update_message = {
            "type": "element_updated",
            "data": {"layer": "business", "element_id": "business.service.test"},
        }

        await initialized_server.broadcast_update(update_message)

        # All clients should receive the message
        ws1.send_json.assert_called_once()
        ws2.send_json.assert_called_once()
        ws3.send_json.assert_called_once()

    @pytest.mark.asyncio
    async def test_broadcast_handles_disconnected_client(self, initialized_server):
        """Test broadcasting handles disconnected clients gracefully."""
        # Create one working and one failing WebSocket
        ws_working = AsyncMock(spec=web.WebSocketResponse)
        ws_working.send_json = AsyncMock()

        ws_failed = AsyncMock(spec=web.WebSocketResponse)
        ws_failed.send_json = AsyncMock(side_effect=OSError("Connection lost"))

        initialized_server.websockets.add(ws_working)
        initialized_server.websockets.add(ws_failed)

        update_message = {"type": "element_updated", "data": {"layer": "business"}}

        # Should not raise exception
        await initialized_server.broadcast_update(update_message)

        # Working client should still receive message
        ws_working.send_json.assert_called_once()

        # Failed client should be removed from websockets set
        assert ws_failed not in initialized_server.websockets


class TestErrorHandling:
    """Test error handling in file monitoring and broadcasting."""

    @pytest.mark.asyncio
    async def test_invalid_yaml_handled_gracefully(self, initialized_server, temp_dir):
        """Test invalid YAML file doesn't crash the server."""
        mock_ws = AsyncMock(spec=web.WebSocketResponse)
        mock_ws.send_json = AsyncMock()
        initialized_server.websockets.add(mock_ws)

        initialized_server.file_monitor = FileMonitor(
            initialized_server.model.model_path,
            initialized_server._handle_file_change,
            debounce_seconds=0.1,
        )
        initialized_server.file_monitor.start()

        try:
            # Create invalid YAML file
            model_path = initialized_server.model.model_path
            layer_dir = model_path / "business"
            layer_dir.mkdir(parents=True, exist_ok=True)
            invalid_file = layer_dir / "invalid.yaml"
            invalid_file.write_text("{ invalid yaml content: [")

            # Wait for processing
            await asyncio.sleep(0.3)

            # Server should still be running (no crash)
            # WebSocket may or may not have been called depending on error handling
            # The important thing is no exception was raised

        finally:
            initialized_server.file_monitor.stop()

    @pytest.mark.asyncio
    async def test_broadcast_error_doesnt_stop_other_broadcasts(self, initialized_server):
        """Test error broadcasting to one client doesn't affect others."""
        # Create one failing and two working clients
        ws_failed = AsyncMock(spec=web.WebSocketResponse)
        ws_failed.send_json = AsyncMock(side_effect=RuntimeError("Connection error"))

        ws1 = AsyncMock(spec=web.WebSocketResponse)
        ws1.send_json = AsyncMock()

        ws2 = AsyncMock(spec=web.WebSocketResponse)
        ws2.send_json = AsyncMock()

        initialized_server.websockets.add(ws_failed)
        initialized_server.websockets.add(ws1)
        initialized_server.websockets.add(ws2)

        update_message = {"type": "element_updated", "data": {"layer": "business"}}

        # Should not raise exception
        await initialized_server.broadcast_update(update_message)

        # Working clients should still receive message
        ws1.send_json.assert_called_once()
        ws2.send_json.assert_called_once()

        # Failed client removed
        assert ws_failed not in initialized_server.websockets
        assert ws1 in initialized_server.websockets
        assert ws2 in initialized_server.websockets


class TestMonitoringScope:
    """Test file monitoring scope and filtering."""

    @pytest.mark.asyncio
    async def test_spec_directory_not_monitored(self, initialized_server, temp_dir):
        """Test .dr/ directory is not monitored."""
        callback = Mock()
        spec_path = temp_dir / ".dr" / "specification"

        monitor = FileMonitor(initialized_server.model.model_path, callback, debounce_seconds=0.1)
        monitor.start()

        try:
            # Create file in spec directory
            spec_file = spec_path / "test.yaml"
            spec_file.write_text("test: data")

            # Wait
            await asyncio.sleep(0.2)

            # Callback should not be called (file outside model path)
            callback.assert_not_called()

        finally:
            monitor.stop()

    @pytest.mark.asyncio
    async def test_only_yaml_files_monitored(self, initialized_server, temp_dir):
        """Test only .yaml and .yml files trigger events."""
        callback = Mock()
        model_path = initialized_server.model.model_path

        monitor = FileMonitor(model_path, callback, debounce_seconds=0.1)
        monitor.start()

        try:
            layer_dir = model_path / "business"
            layer_dir.mkdir(parents=True, exist_ok=True)

            # Create non-YAML files
            (layer_dir / "notes.txt").write_text("notes")
            (layer_dir / "data.json").write_text("{}")
            (layer_dir / "README.md").write_text("# README")

            # Wait
            await asyncio.sleep(0.2)

            # Callback should not be called
            callback.assert_not_called()

        finally:
            monitor.stop()
