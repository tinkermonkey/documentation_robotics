"""
File system monitoring for model changes.

Uses watchdog library to detect file changes in the model directory
and notify the server for broadcasting to connected clients.
"""

import gc
import threading
import time
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple

from rich.console import Console
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver

console = Console()


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
        self._pending_events: Dict[str, Tuple[float, str, str, Path]] = {}
        self._debounce_timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()

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
        with self._lock:
            self._pending_events[event_key] = (time.time(), event_type, layer, path)

        # Schedule debounce processing
        self._schedule_debounce()

    def _schedule_debounce(self) -> None:
        """Schedule debounce processing using a timer."""
        with self._lock:
            # Cancel existing timer if any
            if self._debounce_timer is not None and self._debounce_timer.is_alive():
                self._debounce_timer.cancel()

            # Schedule new timer - only process events after debounce window
            self._debounce_timer = threading.Timer(
                self.debounce_seconds, self._process_debounced_events
            )
            self._debounce_timer.daemon = True
            self._debounce_timer.start()

    def _process_debounced_events(self) -> None:
        """Process debounced events."""
        with self._lock:
            # Process all pending events (they're already debounced by the timer)
            events_to_process = list(self._pending_events.values())
            self._pending_events.clear()

        # Process collected events outside the lock
        for timestamp, event_type, layer, path in events_to_process:
            try:
                self.callback(event_type, layer, path)
            except (OSError, ValueError, RuntimeError) as e:
                console.print(f"[red]Error processing file event: {e}[/red]")

    def _process_events_sync(self) -> None:
        """
        Process events synchronously (for testing or non-async contexts).

        This method processes all pending events immediately without waiting
        for the debounce timer. Useful for testing and synchronous contexts.
        """
        with self._lock:
            # Collect all pending events
            events_to_process = list(self._pending_events.values())
            self._pending_events.clear()

            # Cancel any pending timer since we're processing now
            if self._debounce_timer is not None and self._debounce_timer.is_alive():
                self._debounce_timer.cancel()
                self._debounce_timer = None

        # Process collected events outside the lock
        for timestamp, event_type, layer, path in events_to_process:
            try:
                self.callback(event_type, layer, path)
            except (OSError, ValueError, RuntimeError) as e:
                console.print(f"[red]Error processing file event: {e}[/red]")

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
        use_polling: bool = False,
    ):
        """
        Initialize file monitor.

        Args:
            model_path: Path to model directory to monitor
            callback: Callback function for file events (event_type, layer, file_path)
            debounce_seconds: Debounce time for file events
            use_polling: Use PollingObserver instead of platform-specific observer (more reliable for tests)
        """
        self.model_path = model_path
        self.callback = callback
        self.debounce_seconds = debounce_seconds
        self.use_polling = use_polling
        self.observer: Optional[Observer] = None
        self.event_handler: Optional[ModelFileEventHandler] = None

    def start(self) -> None:
        """Start monitoring file system."""
        if self.observer is not None:
            raise RuntimeError("FileMonitor already started")

        self.event_handler = ModelFileEventHandler(
            self.model_path, self.callback, self.debounce_seconds
        )

        # Use polling observer for tests (more reliable but slower)
        if self.use_polling:
            self.observer = PollingObserver()
        else:
            self.observer = Observer()

        self.observer.schedule(self.event_handler, str(self.model_path), recursive=True)
        self.observer.start()

    def stop(self) -> None:
        """Stop monitoring file system.

        Note: This may trigger PytestUnraisableExceptionWarning in test environments
        due to watchdog's PollingObserver subprocess cleanup timing with asyncio event
        loops. This is a known watchdog issue and is filtered in pytest configuration.
        """
        # Cancel any pending debounce timers first
        if self.event_handler is not None:
            with self.event_handler._lock:
                if self.event_handler._debounce_timer is not None:
                    if self.event_handler._debounce_timer.is_alive():
                        self.event_handler._debounce_timer.cancel()
                    # Wait for timer to finish
                    self.event_handler._debounce_timer.join(timeout=0.5)
                    self.event_handler._debounce_timer = None

        # Stop and cleanup observer
        if self.observer is not None:
            try:
                self.observer.stop()
                # Wait for observer to finish with a reasonable timeout
                self.observer.join(timeout=2.0)

                # Force cleanup if observer is still alive
                if self.observer.is_alive():
                    console.print("[yellow]Warning: Observer did not stop cleanly[/yellow]")
            except (RuntimeError, AttributeError) as e:
                # Handle potential cleanup errors gracefully
                console.print(f"[yellow]Observer cleanup warning: {e}[/yellow]")
            finally:
                # Clear observer reference and allow garbage collection
                # This ensures any pending asyncio/subprocess resources are cleaned up
                # even if watchdog's internal cleanup hasn't completed yet
                self.observer = None
                # Force immediate garbage collection to clean up subprocess transports
                # before event loops close (reduces but doesn't eliminate the warning)
                gc.collect()

        self.event_handler = None

    def is_running(self) -> bool:
        """Check if monitor is running."""
        return self.observer is not None and self.observer.is_alive()
