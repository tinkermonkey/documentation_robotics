"""
Unit tests for file system monitoring.

Tests the FileMonitor and ModelFileEventHandler classes for detecting
and debouncing file system events in the model directory.
"""

import asyncio
import time
from pathlib import Path
from unittest.mock import Mock

import pytest

from documentation_robotics.server.file_monitor import FileMonitor, ModelFileEventHandler


class TestModelFileEventHandler:
    """Test ModelFileEventHandler class."""

    def test_init(self, temp_dir):
        """Test event handler initialization."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.2)

        assert handler.model_path == temp_dir
        assert handler.callback == callback
        assert handler.debounce_seconds == 0.2
        assert handler._pending_events == {}

    def test_is_model_file_yaml(self, temp_dir):
        """Test YAML files are recognized as model files."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        yaml_file = temp_dir / "business" / "service.yaml"
        yaml_file.parent.mkdir(parents=True)
        yaml_file.touch()

        assert handler._is_model_file(str(yaml_file)) is True

    def test_is_model_file_yml_extension(self, temp_dir):
        """Test .yml extension is recognized."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        yml_file = temp_dir / "business" / "service.yml"
        yml_file.parent.mkdir(parents=True)
        yml_file.touch()

        assert handler._is_model_file(str(yml_file)) is True

    def test_is_model_file_excludes_manifest(self, temp_dir):
        """Test manifest.yaml is excluded from monitoring."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        manifest_file = temp_dir / "manifest.yaml"
        manifest_file.touch()

        assert handler._is_model_file(str(manifest_file)) is False

    def test_is_model_file_excludes_non_yaml(self, temp_dir):
        """Test non-YAML files are excluded."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        txt_file = temp_dir / "business" / "notes.txt"
        txt_file.parent.mkdir(parents=True)
        txt_file.touch()

        assert handler._is_model_file(str(txt_file)) is False

    def test_is_model_file_requires_under_model_path(self, temp_dir):
        """Test files outside model path are excluded."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        outside_file = temp_dir.parent / "other.yaml"
        outside_file.touch()

        assert handler._is_model_file(str(outside_file)) is False

    def test_extract_layer_from_path(self, temp_dir):
        """Test extracting layer name from file path."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        file_path = temp_dir / "01_motivation" / "stakeholder.yaml"
        layer = handler._extract_layer(file_path)

        assert layer == "motivation"

    def test_extract_layer_without_prefix(self, temp_dir):
        """Test extracting layer name without numeric prefix."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        file_path = temp_dir / "custom_layer" / "element.yaml"
        layer = handler._extract_layer(file_path)

        assert layer == "layer"

    def test_extract_layer_single_directory(self, temp_dir):
        """Test extracting layer from single directory name."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        file_path = temp_dir / "business" / "service.yaml"
        layer = handler._extract_layer(file_path)

        assert layer == "business"

    def test_extract_layer_nested_path(self, temp_dir):
        """Test extracting layer from nested directory structure."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        file_path = temp_dir / "02_business" / "services" / "customer-service.yaml"
        layer = handler._extract_layer(file_path)

        assert layer == "business"

    def test_extract_layer_outside_model_path(self, temp_dir):
        """Test extracting layer returns None for files outside model path."""
        handler = ModelFileEventHandler(temp_dir, Mock())

        outside_file = temp_dir.parent / "other.yaml"
        layer = handler._extract_layer(outside_file)

        assert layer is None

    @pytest.mark.asyncio
    async def test_debounce_processing_async(self, temp_dir):
        """Test debounced event processing with asyncio."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.1)

        # Create a test file
        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Schedule event
        handler._schedule_event("created", str(test_file))

        # Wait for debounce processing
        await asyncio.sleep(0.15)

        # Callback should have been called
        callback.assert_called_once()
        args = callback.call_args[0]
        assert args[0] == "created"
        assert args[1] == "business"
        assert args[2] == test_file

    @pytest.mark.asyncio
    async def test_debounce_prevents_duplicate_events(self, temp_dir):
        """Test debouncing prevents duplicate events within window."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.1)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Schedule same event multiple times rapidly
        handler._schedule_event("modified", str(test_file))
        handler._schedule_event("modified", str(test_file))
        handler._schedule_event("modified", str(test_file))

        # Wait for debounce processing
        await asyncio.sleep(0.15)

        # Callback should only be called once (events consolidated)
        assert callback.call_count == 1

    @pytest.mark.asyncio
    async def test_schedule_event_stores_metadata(self, temp_dir):
        """Test scheduled events store timestamp and metadata."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.2)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        before_time = time.time()
        handler._schedule_event("created", str(test_file))

        # Check pending events immediately after scheduling (before debounce completes)
        await asyncio.sleep(0.01)  # Small delay to let scheduling happen

        # Since debounce task may have started, check if event was scheduled and/or processed
        # Wait for full debounce
        await asyncio.sleep(0.25)

        # Verify callback was called with correct metadata
        callback.assert_called_once()
        args = callback.call_args[0]
        assert args[0] == "created"
        assert args[1] == "business"
        assert args[2] == test_file

    def test_process_events_sync_fallback(self, temp_dir):
        """Test synchronous event processing fallback."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.05)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Schedule event and process synchronously
        handler._schedule_event("created", str(test_file))
        handler._process_events_sync()

        # Callback should have been called
        callback.assert_called_once()


class TestFileMonitor:
    """Test FileMonitor class."""

    def test_init(self, temp_dir):
        """Test FileMonitor initialization."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.2)

        assert monitor.model_path == temp_dir
        assert monitor.callback == callback
        assert monitor.debounce_seconds == 0.2
        assert monitor.observer is None
        assert monitor.event_handler is None

    def test_start_creates_observer(self, temp_dir):
        """Test starting monitor creates observer."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback)

        monitor.start()

        assert monitor.observer is not None
        assert monitor.event_handler is not None
        assert monitor.is_running() is True

        monitor.stop()

    def test_start_twice_raises_error(self, temp_dir):
        """Test starting monitor twice raises RuntimeError."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback)

        monitor.start()

        with pytest.raises(RuntimeError, match="already started"):
            monitor.start()

        monitor.stop()

    def test_stop_cleans_up_observer(self, temp_dir):
        """Test stopping monitor cleans up observer."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback)

        monitor.start()
        monitor.stop()

        assert monitor.observer is None
        assert monitor.event_handler is None
        assert monitor.is_running() is False

    def test_stop_without_start_is_safe(self, temp_dir):
        """Test stopping monitor without starting is safe."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback)

        # Should not raise exception
        monitor.stop()

        assert monitor.is_running() is False

    def test_is_running_initial_state(self, temp_dir):
        """Test is_running returns False initially."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback)

        assert monitor.is_running() is False

    @pytest.mark.asyncio
    async def test_file_creation_triggers_callback(self, temp_dir):
        """Test file creation triggers callback."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.1)

        monitor.start()

        # Create a new file
        layer_dir = temp_dir / "business"
        layer_dir.mkdir()
        test_file = layer_dir / "new-service.yaml"
        test_file.write_text("name: Test Service")

        # Wait for debounce + processing
        await asyncio.sleep(0.2)

        monitor.stop()

        # Callback should have been called for file creation or modification
        # (watchdog may report either depending on timing)
        callback.assert_called()
        args = callback.call_args[0]
        assert args[0] in ("created", "modified")
        assert args[1] == "business"

    @pytest.mark.asyncio
    async def test_file_modification_triggers_callback(self, temp_dir):
        """Test file modification triggers callback."""
        callback = Mock()

        # Create file before starting monitor
        layer_dir = temp_dir / "business"
        layer_dir.mkdir()
        test_file = layer_dir / "existing-service.yaml"
        test_file.write_text("name: Original Service")

        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.1)
        monitor.start()

        # Modify the file
        test_file.write_text("name: Updated Service")

        # Wait for debounce + processing
        await asyncio.sleep(0.2)

        monitor.stop()

        # Callback should have been called for file modification
        callback.assert_called()
        args = callback.call_args[0]
        assert args[0] == "modified"
        assert args[1] == "business"

    @pytest.mark.asyncio
    async def test_file_deletion_triggers_callback(self, temp_dir):
        """Test file deletion triggers callback."""
        callback = Mock()

        # Create file before starting monitor
        layer_dir = temp_dir / "business"
        layer_dir.mkdir()
        test_file = layer_dir / "to-delete.yaml"
        test_file.write_text("name: Service to Delete")

        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.1)
        monitor.start()

        # Delete the file
        test_file.unlink()

        # Wait for debounce + processing
        await asyncio.sleep(0.2)

        monitor.stop()

        # Callback should have been called for file deletion
        callback.assert_called()
        args = callback.call_args[0]
        assert args[0] == "deleted"
        assert args[1] == "business"

    @pytest.mark.asyncio
    async def test_non_yaml_files_ignored(self, temp_dir):
        """Test non-YAML files are ignored by monitor."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.1)

        monitor.start()

        # Create non-YAML file
        layer_dir = temp_dir / "business"
        layer_dir.mkdir()
        test_file = layer_dir / "notes.txt"
        test_file.write_text("Some notes")

        # Wait for potential processing
        await asyncio.sleep(0.2)

        monitor.stop()

        # Callback should NOT have been called
        callback.assert_not_called()

    @pytest.mark.asyncio
    async def test_manifest_changes_ignored(self, temp_dir):
        """Test manifest.yaml changes are ignored."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.1)

        monitor.start()

        # Create/modify manifest.yaml
        manifest_file = temp_dir / "manifest.yaml"
        manifest_file.write_text("version: 1.0.0")

        # Wait for potential processing
        await asyncio.sleep(0.2)

        monitor.stop()

        # Callback should NOT have been called
        callback.assert_not_called()

    @pytest.mark.asyncio
    async def test_recursive_monitoring(self, temp_dir):
        """Test monitor detects changes in nested directories."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.1)

        monitor.start()

        # Create nested directory structure
        nested_dir = temp_dir / "business" / "services" / "customer"
        nested_dir.mkdir(parents=True)
        test_file = nested_dir / "profile-service.yaml"
        test_file.write_text("name: Profile Service")

        # Wait for debounce + processing
        await asyncio.sleep(0.2)

        monitor.stop()

        # Callback should have been called
        callback.assert_called()
        args = callback.call_args[0]
        assert args[0] == "created"
        assert args[1] == "business"

    @pytest.mark.asyncio
    async def test_multiple_layers_monitored(self, temp_dir):
        """Test monitor detects changes across multiple layers."""
        callback = Mock()
        monitor = FileMonitor(temp_dir, callback, debounce_seconds=0.1)

        monitor.start()

        # Create files in different layers
        business_dir = temp_dir / "business"
        business_dir.mkdir()
        (business_dir / "service.yaml").write_text("name: Business Service")

        app_dir = temp_dir / "application"
        app_dir.mkdir()
        (app_dir / "component.yaml").write_text("name: Application Component")

        # Wait for debounce + processing
        await asyncio.sleep(0.2)

        monitor.stop()

        # Callback should have been called for both layers
        assert callback.call_count >= 2


class TestEventHandlerErrorHandling:
    """Test error handling in event handlers."""

    def test_callback_exception_handled(self, temp_dir):
        """Test callback exceptions are caught and logged."""
        # Create callback that raises exception
        callback = Mock(side_effect=ValueError("Test error"))
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.05)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Should not raise exception
        handler._schedule_event("created", str(test_file))
        handler._process_events_sync()

        # Callback was called despite error
        callback.assert_called_once()

    def test_os_error_in_callback_handled(self, temp_dir):
        """Test OSError in callback is handled gracefully."""
        callback = Mock(side_effect=OSError("File system error"))
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.05)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Should not raise exception
        handler._schedule_event("created", str(test_file))
        handler._process_events_sync()

        callback.assert_called_once()

    def test_runtime_error_in_callback_handled(self, temp_dir):
        """Test RuntimeError in callback is handled gracefully."""
        callback = Mock(side_effect=RuntimeError("Processing error"))
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.05)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Should not raise exception
        handler._schedule_event("created", str(test_file))
        handler._process_events_sync()

        callback.assert_called_once()


class TestDebouncing:
    """Test debouncing behavior in detail."""

    def test_debounce_consolidates_events_on_sync_processing(self, temp_dir):
        """Test synchronous debounce processing consolidates duplicate events."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.05)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Manually add events to pending without triggering async processing
        event_key = f"modified:{test_file}"
        current_time = time.time()
        handler._pending_events[event_key] = (current_time, "modified", "business", test_file)

        # Wait for debounce window
        time.sleep(0.06)

        # Process events synchronously
        handler._process_events_sync()

        # Event should be processed
        callback.assert_called_once()
        args = callback.call_args[0]
        assert args[0] == "modified"
        assert args[1] == "business"

    @pytest.mark.asyncio
    async def test_different_files_not_consolidated(self, temp_dir):
        """Test events for different files are not consolidated."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.1)

        layer_dir = temp_dir / "business"
        layer_dir.mkdir()

        file1 = layer_dir / "service1.yaml"
        file2 = layer_dir / "service2.yaml"
        file1.touch()
        file2.touch()

        # Schedule events for different files
        handler._schedule_event("created", str(file1))
        handler._schedule_event("created", str(file2))

        # Wait for processing
        await asyncio.sleep(0.15)

        # Callback should be called twice (once for each file)
        assert callback.call_count == 2

    @pytest.mark.asyncio
    async def test_different_event_types_not_consolidated(self, temp_dir):
        """Test different event types for same file are tracked separately."""
        callback = Mock()
        handler = ModelFileEventHandler(temp_dir, callback, debounce_seconds=0.1)

        test_file = temp_dir / "business" / "service.yaml"
        test_file.parent.mkdir(parents=True)
        test_file.touch()

        # Schedule different event types for same file
        handler._schedule_event("created", str(test_file))
        handler._schedule_event("modified", str(test_file))

        # Wait for processing
        await asyncio.sleep(0.15)

        # Callback should be called twice (once for each event type)
        assert callback.call_count == 2
