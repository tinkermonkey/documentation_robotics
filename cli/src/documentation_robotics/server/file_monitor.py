"""
File system monitoring for model changes.

Uses watchdog library to detect file changes in the model directory
and notify the server for broadcasting to connected clients.
"""

import asyncio
import time
from pathlib import Path
from typing import Callable, Optional, Set

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer


class ModelFileEventHandler(FileSystemEventHandler):
    """Handles file system events for model files."""

    def __init__(
        self,
        model_path: Path,
        callback: Callable[[str, str, Path], None],
        debounce_seconds: float = 0.2,
    ):
        """
        Initialize event handler.

        Args:
            model_path: Path to model directory
            callback: Callback function (event_type, layer, file_path)
            debounce_seconds: Debounce time for file events
        """
        super().__init__()
        self.model_path = model_path
        self.callback = callback
        self.debounce_seconds = debounce_seconds
        self._pending_events: dict[str, tuple[float, str, str, Path]] = {}
        self._debounce_task: Optional[asyncio.Task] = None

    def on_created(self, event: FileSystemEvent) -> None:
        """Handle file created event."""
        if not event.is_directory and self._is_model_file(event.src_path):
            self._schedule_event("created", event.src_path)

    def on_modified(self, event: FileSystemEvent) -> None:
        """Handle file modified event."""
        if not event.is_directory and self._is_model_file(event.src_path):
            self._schedule_event("modified", event.src_path)

    def on_deleted(self, event: FileSystemEvent) -> None:
        """Handle file deleted event."""
        if not event.is_directory and self._is_model_file(event.src_path):
            self._schedule_event("deleted", event.src_path)

    def _is_model_file(self, file_path: str) -> bool:
        """
        Check if file is a model file that should trigger updates.

        Args:
            file_path: File path

        Returns:
            True if file is a model file
        """
        path = Path(file_path)

        # Only monitor YAML files in model directory
        if path.suffix not in [".yaml", ".yml"]:
            return False

        # Exclude manifest.yaml (changes handled separately)
        if path.name == "manifest.yaml":
            return False

        # Must be under model path
        try:
            path.relative_to(self.model_path)
            return True
        except ValueError:
            return False

    def _schedule_event(self, event_type: str, file_path: str) -> None:
        """
        Schedule event with debouncing.

        Args:
            event_type: Type of event (created, modified, deleted)
            file_path: File path
        """
        path = Path(file_path)
        layer = self._extract_layer(path)

        if not layer:
            return

        # Store event with timestamp
        event_key = f"{event_type}:{file_path}"
        self._pending_events[event_key] = (time.time(), event_type, layer, path)

        # Schedule debounce processing
        self._schedule_debounce()

    def _schedule_debounce(self) -> None:
        """Schedule debounce processing task."""
        # Create event loop task if not already scheduled
        try:
            loop = asyncio.get_event_loop()
            if self._debounce_task is None or self._debounce_task.done():
                self._debounce_task = loop.create_task(self._process_debounced_events())
        except RuntimeError:
            # No event loop available, process synchronously
            self._process_events_sync()

    async def _process_debounced_events(self) -> None:
        """Process debounced events asynchronously."""
        await asyncio.sleep(self.debounce_seconds)

        current_time = time.time()
        events_to_process = []

        # Collect events older than debounce window
        for event_key, (timestamp, event_type, layer, path) in list(
            self._pending_events.items()
        ):
            if current_time - timestamp >= self.debounce_seconds:
                events_to_process.append((event_type, layer, path))
                del self._pending_events[event_key]

        # Process collected events
        for event_type, layer, path in events_to_process:
            try:
                self.callback(event_type, layer, path)
            except Exception as e:
                print(f"Error processing file event: {e}")

    def _process_events_sync(self) -> None:
        """Process events synchronously (fallback)."""
        time.sleep(self.debounce_seconds)

        current_time = time.time()
        events_to_process = []

        # Collect events older than debounce window
        for event_key, (timestamp, event_type, layer, path) in list(
            self._pending_events.items()
        ):
            if current_time - timestamp >= self.debounce_seconds:
                events_to_process.append((event_type, layer, path))
                del self._pending_events[event_key]

        # Process collected events
        for event_type, layer, path in events_to_process:
            try:
                self.callback(event_type, layer, path)
            except Exception as e:
                print(f"Error processing file event: {e}")

    def _extract_layer(self, file_path: Path) -> Optional[str]:
        """
        Extract layer name from file path.

        Args:
            file_path: File path

        Returns:
            Layer name or None if not determinable
        """
        try:
            relative = file_path.relative_to(self.model_path)
            parts = relative.parts

            if len(parts) > 0:
                # Layer is the top-level directory
                layer_dir = parts[0]
                # Extract layer name from directory (e.g., "01_motivation" -> "motivation")
                layer_parts = layer_dir.split("_", 1)
                if len(layer_parts) > 1:
                    return layer_parts[1]
                return layer_dir

        except ValueError:
            pass

        return None


class FileMonitor:
    """Monitors file system for model changes."""

    def __init__(
        self,
        model_path: Path,
        callback: Callable[[str, str, Path], None],
        debounce_seconds: float = 0.2,
    ):
        """
        Initialize file monitor.

        Args:
            model_path: Path to model directory to monitor
            callback: Callback function for file events (event_type, layer, file_path)
            debounce_seconds: Debounce time for file events
        """
        self.model_path = model_path
        self.callback = callback
        self.debounce_seconds = debounce_seconds
        self.observer: Optional[Observer] = None
        self.event_handler: Optional[ModelFileEventHandler] = None

    def start(self) -> None:
        """Start monitoring file system."""
        if self.observer is not None:
            raise RuntimeError("FileMonitor already started")

        self.event_handler = ModelFileEventHandler(
            self.model_path, self.callback, self.debounce_seconds
        )

        self.observer = Observer()
        self.observer.schedule(
            self.event_handler, str(self.model_path), recursive=True
        )
        self.observer.start()

    def stop(self) -> None:
        """Stop monitoring file system."""
        if self.observer is not None:
            self.observer.stop()
            self.observer.join()
            self.observer = None
            self.event_handler = None

    def is_running(self) -> bool:
        """Check if monitor is running."""
        return self.observer is not None and self.observer.is_alive()
