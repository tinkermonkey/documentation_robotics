"""
Unit tests for FileMonitor class.

Tests file system monitoring, event detection, debouncing, and filtering logic.
"""

import asyncio
import time
from unittest.mock import Mock

import pytest
from documentation_robotics.server.file_monitor import FileMonitor, ModelFileEventHandler
from watchdog.events import FileSystemEvent


class TestModelFileEventHandler:
    """Test ModelFileEventHandler class."""

    def test_handler_initialization(self, tmp_path):
        """Test handler initializes with correct parameters."""
        callback = Mock()

        handler = ModelFileEventHandler(
            model_path=tmp_path, callback=callback, debounce_seconds=0.2
        )

        assert handler.model_path == tmp_path
        assert handler.callback == callback
        assert handler.debounce_seconds == 0.2
        assert len(handler._pending_events) == 0

    def test_is_model_file_yaml(self, tmp_path):
        """Test YAML files are recognized as model files."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        yaml_file = layer_dir / "service.yaml"
        yaml_file.touch()

        assert handler._is_model_file(str(yaml_file)) is True

    def test_is_model_file_yml(self, tmp_path):
        """Test YML files are recognized as model files."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        yml_file = layer_dir / "service.yml"
        yml_file.touch()

        assert handler._is_model_file(str(yml_file)) is True

    def test_is_model_file_rejects_non_yaml(self, tmp_path):
        """Test non-YAML files are not recognized as model files."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        # Test various non-YAML extensions
        txt_file = layer_dir / "notes.txt"
        txt_file.touch()
        assert handler._is_model_file(str(txt_file)) is False

        json_file = layer_dir / "data.json"
        json_file.touch()
        assert handler._is_model_file(str(json_file)) is False

        py_file = layer_dir / "script.py"
        py_file.touch()
        assert handler._is_model_file(str(py_file)) is False

    def test_is_model_file_rejects_manifest(self, tmp_path):
        """Test manifest.yaml is excluded from monitoring."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        manifest = model_path / "manifest.yaml"
        manifest.touch()

        assert handler._is_model_file(str(manifest)) is False

    def test_is_model_file_rejects_outside_model_path(self, tmp_path):
        """Test files outside model path are rejected."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        outside_file = tmp_path / "outside.yaml"
        outside_file.touch()

        assert handler._is_model_file(str(outside_file)) is False

    def test_extract_layer_from_path(self, tmp_path):
        """Test layer name extraction from file path."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        # Test with numbered layer directory
        business_dir = model_path / "01_business"
        business_dir.mkdir()
        business_file = business_dir / "service.yaml"
        business_file.touch()

        layer = handler._extract_layer(business_file)
        assert layer == "business"

        # Test with non-numbered layer directory
        api_dir = model_path / "api"
        api_dir.mkdir()
        api_file = api_dir / "operation.yaml"
        api_file.touch()

        layer = handler._extract_layer(api_file)
        assert layer == "api"

    def test_extract_layer_nested_path(self, tmp_path):
        """Test layer extraction from nested file path."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        # Create nested structure
        layer_dir = model_path / "02_business"
        layer_dir.mkdir()
        subdir = layer_dir / "services"
        subdir.mkdir()
        nested_file = subdir / "customer-service.yaml"
        nested_file.touch()

        layer = handler._extract_layer(nested_file)
        assert layer == "business"

    async def test_on_created_event(self, tmp_path):
        """Test file created event is scheduled."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback, debounce_seconds=0.1)

        # Create file and trigger event
        yaml_file = layer_dir / "new-service.yaml"
        yaml_file.touch()

        event = FileSystemEvent(str(yaml_file))
        event.is_directory = False
        event.src_path = str(yaml_file)

        handler.on_created(event)

        # Verify event was scheduled (check immediately after scheduling)
        assert len(handler._pending_events) > 0

        # Wait for debounce processing
        await asyncio.sleep(0.15)

        # Verify callback was invoked after debounce
        callback.assert_called_once()

    async def test_on_modified_event(self, tmp_path):
        """Test file modified event is scheduled."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback, debounce_seconds=0.1)

        yaml_file = layer_dir / "service.yaml"
        yaml_file.touch()

        event = FileSystemEvent(str(yaml_file))
        event.is_directory = False
        event.src_path = str(yaml_file)

        handler.on_modified(event)

        # Verify event was scheduled (check immediately after scheduling)
        assert len(handler._pending_events) > 0

        # Wait for debounce processing
        await asyncio.sleep(0.15)

        # Verify callback was invoked after debounce
        callback.assert_called_once()

    async def test_on_deleted_event(self, tmp_path):
        """Test file deleted event is scheduled."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback, debounce_seconds=0.1)

        yaml_file = layer_dir / "service.yaml"
        yaml_file.touch()

        event = FileSystemEvent(str(yaml_file))
        event.is_directory = False
        event.src_path = str(yaml_file)

        handler.on_deleted(event)

        # Verify event was scheduled (check immediately after scheduling)
        assert len(handler._pending_events) > 0

        # Wait for debounce processing
        await asyncio.sleep(0.15)

        # Verify callback was invoked after debounce
        callback.assert_called_once()

    def test_directory_events_ignored(self, tmp_path):
        """Test directory events are ignored."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback)

        layer_dir = model_path / "business"
        layer_dir.mkdir()

        # Create directory event
        event = FileSystemEvent(str(layer_dir))
        event.is_directory = True
        event.src_path = str(layer_dir)

        handler.on_created(event)

        # No events should be scheduled
        assert len(handler._pending_events) == 0


class TestFileMonitor:
    """Test FileMonitor class."""

    def test_monitor_initialization(self, tmp_path):
        """Test monitor initializes correctly."""
        callback = Mock()

        monitor = FileMonitor(model_path=tmp_path, callback=callback, debounce_seconds=0.2)

        assert monitor.model_path == tmp_path
        assert monitor.callback == callback
        assert monitor.debounce_seconds == 0.2
        assert monitor.observer is None
        assert monitor.event_handler is None

    def test_monitor_start(self, tmp_path):
        """Test monitor starts successfully."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        monitor = FileMonitor(model_path, callback)

        monitor.start()

        assert monitor.observer is not None
        assert monitor.event_handler is not None
        assert monitor.is_running() is True

        # Cleanup
        monitor.stop()

    def test_monitor_stop(self, tmp_path):
        """Test monitor stops successfully."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        monitor = FileMonitor(model_path, callback)

        monitor.start()
        assert monitor.is_running() is True

        monitor.stop()

        assert monitor.observer is None
        assert monitor.event_handler is None
        assert monitor.is_running() is False

    def test_monitor_already_started_raises_error(self, tmp_path):
        """Test starting an already running monitor raises error."""
        model_path = tmp_path / "model"
        model_path.mkdir()

        callback = Mock()
        monitor = FileMonitor(model_path, callback)

        monitor.start()

        with pytest.raises(RuntimeError, match="already started"):
            monitor.start()

        # Cleanup
        monitor.stop()

    def test_monitor_is_running_false_when_stopped(self, tmp_path):
        """Test is_running returns False when monitor is not started."""
        callback = Mock()
        monitor = FileMonitor(tmp_path, callback)

        assert monitor.is_running() is False


class TestDebouncing:
    """Test debouncing functionality."""

    @pytest.mark.asyncio
    async def test_debouncing_delays_callback(self, tmp_path):
        """Test debouncing delays callback execution."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback, debounce_seconds=0.2)

        yaml_file = layer_dir / "service.yaml"
        yaml_file.touch()

        event = FileSystemEvent(str(yaml_file))
        event.is_directory = False
        event.src_path = str(yaml_file)

        # Schedule event
        handler.on_created(event)

        # Callback should not be called immediately
        callback.assert_not_called()

        # Wait for debounce period
        await asyncio.sleep(0.3)

        # Callback should now be called
        assert callback.call_count > 0

    @pytest.mark.asyncio
    async def test_debouncing_merges_rapid_changes(self, tmp_path):
        """Test debouncing merges multiple rapid changes."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback, debounce_seconds=0.2)

        yaml_file = layer_dir / "service.yaml"
        yaml_file.touch()

        # Trigger multiple rapid events
        for _ in range(5):
            event = FileSystemEvent(str(yaml_file))
            event.is_directory = False
            event.src_path = str(yaml_file)
            handler.on_modified(event)
            await asyncio.sleep(0.05)  # 50ms between events

        # Wait for debounce
        await asyncio.sleep(0.3)

        # Callback should be called, but not 5 times
        # (exact count depends on timing, but should be less than 5)
        assert callback.call_count < 5


class TestEventProcessing:
    """Test event processing logic."""

    def test_sync_event_processing_fallback(self, tmp_path):
        """Test synchronous event processing when no event loop."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock()
        handler = ModelFileEventHandler(model_path, callback, debounce_seconds=0.05)

        yaml_file = layer_dir / "service.yaml"
        yaml_file.touch()

        # Schedule event
        event_key = f"created:{yaml_file}"
        handler._pending_events[event_key] = (
            time.time() - 1,  # Old timestamp to ensure processing
            "created",
            "business",
            yaml_file,
        )

        # Process synchronously
        handler._process_events_sync()

        # Callback should be called
        callback.assert_called_once()
        args = callback.call_args[0]
        assert args[0] == "created"  # event_type
        assert args[1] == "business"  # layer
        assert args[2] == yaml_file  # file_path

    def test_callback_error_handling(self, tmp_path):
        """Test callback errors are handled gracefully."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback = Mock(side_effect=ValueError("Callback error"))
        handler = ModelFileEventHandler(model_path, callback, debounce_seconds=0.05)

        yaml_file = layer_dir / "service.yaml"
        yaml_file.touch()

        # Schedule event
        event_key = f"created:{yaml_file}"
        handler._pending_events[event_key] = (
            time.time() - 1,
            "created",
            "business",
            yaml_file,
        )

        # Process should not raise exception
        handler._process_events_sync()

        # Callback was attempted
        callback.assert_called_once()


class TestIntegrationScenarios:
    """Test realistic integration scenarios."""

    @pytest.mark.asyncio
    async def test_file_creation_flow(self, tmp_path):
        """Test complete file creation detection flow."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        callback_called = asyncio.Event()
        captured_args = []

        def callback(event_type, layer, file_path):
            captured_args.append((event_type, layer, file_path))
            callback_called.set()

        monitor = FileMonitor(model_path, callback, debounce_seconds=0.1)
        monitor.start()

        try:
            # Create file
            new_file = layer_dir / "new-service.yaml"
            new_file.write_text("id: business.service.new\n")

            # Wait for detection
            await asyncio.wait_for(callback_called.wait(), timeout=1.0)

            # Verify callback was called correctly
            assert len(captured_args) > 0
            event_type, layer, file_path = captured_args[0]
            assert event_type == "created"
            assert layer == "business"
            assert file_path.name == "new-service.yaml"

        finally:
            monitor.stop()

    @pytest.mark.asyncio
    async def test_file_modification_flow(self, tmp_path):
        """Test complete file modification detection flow."""
        model_path = tmp_path / "model"
        model_path.mkdir()
        layer_dir = model_path / "business"
        layer_dir.mkdir()

        # Create file before starting monitor
        test_file = layer_dir / "existing.yaml"
        test_file.write_text("id: business.service.existing\n")

        callback_called = asyncio.Event()
        captured_args = []

        def callback(event_type, layer, file_path):
            captured_args.append((event_type, layer, file_path))
            if event_type == "modified":
                callback_called.set()

        monitor = FileMonitor(model_path, callback, debounce_seconds=0.1)
        monitor.start()

        try:
            # Wait for monitor to initialize
            await asyncio.sleep(0.1)

            # Modify file
            test_file.write_text("id: business.service.existing\nname: Updated\n")

            # Wait for detection
            await asyncio.wait_for(callback_called.wait(), timeout=1.0)

            # Verify modification was detected
            modified_events = [args for args in captured_args if args[0] == "modified"]
            assert len(modified_events) > 0

        finally:
            monitor.stop()
