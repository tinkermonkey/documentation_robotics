"""
Visualization server for Documentation Robotics models.

Provides HTTP server for static assets and WebSocket server
for real-time model updates.
"""

import asyncio
import json
import signal
from pathlib import Path
from typing import Any, Dict, Optional, Set

import aiohttp
import yaml
from aiohttp import web
from rich.console import Console

from ..core.model import Model
from .file_monitor import FileMonitor
from .model_serializer import ModelSerializer, load_changesets
from .specification_loader import SpecificationLoader
from .websocket_protocol import (
    create_element_update_message,
    create_error_message,
    create_initial_state_message,
)

console = Console()


class VisualizationServer:
    """
    HTTP/WebSocket server for model visualization.

    Serves static visualization assets and maintains WebSocket connections
    for real-time model updates.
    """

    def __init__(
        self,
        model_path: Path,
        spec_path: Path,
        host: str = "localhost",
        port: int = 8080,
    ):
        """
        Initialize visualization server.

        Args:
            model_path: Path to model root directory
            spec_path: Path to specification directory
            host: Server host address
            port: Server port
        """
        self.model_path = model_path
        self.spec_path = spec_path
        self.host = host
        self.port = port

        # Server components
        self.app: Optional[web.Application] = None
        self.runner: Optional[web.AppRunner] = None
        self.model: Optional[Model] = None
        self.file_monitor: Optional[FileMonitor] = None

        # WebSocket connections
        self.websockets: Set[web.WebSocketResponse] = set()

        # Loaded data
        self.specification: Optional[Dict[str, Any]] = None
        self.model_serializer: Optional[ModelSerializer] = None

        # Shutdown flag
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        """
        Start the visualization server.

        Loads model and specification, configures routes, starts HTTP server,
        and begins file monitoring.
        """
        # Load specification
        spec_loader = SpecificationLoader(self.spec_path)
        self.specification = spec_loader.load_specification()

        # Load model
        self.model = Model(self.model_path, enable_cache=True, lazy_load=False)
        self.model_serializer = ModelSerializer(self.model)

        # Create aiohttp application
        self.app = web.Application()
        self._configure_routes()

        # Start HTTP server
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()

        site = web.TCPSite(self.runner, self.host, self.port)
        await site.start()

        console.print(f"[green]Server started at http://{self.host}:{self.port}[/green]")

        # Start file monitoring using model's actual model_path
        self.file_monitor = FileMonitor(
            self.model.model_path, self._handle_file_change, debounce_seconds=0.2
        )
        self.file_monitor.start()

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    def _configure_routes(self) -> None:
        """Configure HTTP and WebSocket routes."""
        # Health check endpoint
        self.app.router.add_get("/health", self._handle_health)

        # WebSocket endpoint
        self.app.router.add_get("/ws", self._handle_websocket)

        # Static file serving (placeholder - will be implemented in Phase 5)
        # For now, we just serve a simple index page
        self.app.router.add_get("/", self._handle_index)

    async def _handle_health(self, request: web.Request) -> web.Response:
        """
        Handle health check requests.

        Args:
            request: HTTP request

        Returns:
            Health check response
        """
        health_data = {
            "status": "healthy",
            "model_path": str(self.model_path),
            "spec_version": self.specification.get("version") if self.specification else None,
            "connected_clients": len(self.websockets),
            "file_monitor_running": (
                self.file_monitor.is_running() if self.file_monitor else False
            ),
        }

        return web.json_response(health_data)

    async def _handle_index(self, request: web.Request) -> web.Response:
        """
        Handle index page requests.

        Args:
            request: HTTP request

        Returns:
            HTML response
        """
        # Placeholder HTML - will be replaced with actual viewer in Phase 5
        html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Documentation Robotics Visualization</title>
        </head>
        <body>
            <h1>Documentation Robotics Visualization Server</h1>
            <p>Server is running. WebSocket endpoint: ws://{host}:{port}/ws</p>
            <p>Visualization UI will be integrated in Phase 5.</p>
        </body>
        </html>
        """.format(
            host=self.host, port=self.port
        )

        return web.Response(text=html, content_type="text/html")

    async def _handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        """
        Handle WebSocket connection requests.

        Args:
            request: WebSocket upgrade request

        Returns:
            WebSocket response
        """
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        # Add to active connections
        self.websockets.add(ws)

        try:
            # Send initial state
            await self._send_initial_state(ws)

            # Process incoming messages
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    await self._handle_websocket_message(ws, msg.data)
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    console.print(f"[red]WebSocket error: {ws.exception()}[/red]")
                    break

        except (OSError, RuntimeError, ValueError) as e:
            console.print(f"[red]WebSocket handler error: {e}[/red]")
            await self._send_error(ws, str(e))

        finally:
            # Remove from active connections
            self.websockets.discard(ws)

        return ws

    async def _send_initial_state(self, ws: web.WebSocketResponse) -> None:
        """
        Send initial model state to newly connected client.

        Args:
            ws: WebSocket connection
        """
        try:
            # Serialize model state
            model_data = self.model_serializer.serialize_model()
            changesets = load_changesets(self.model_path)

            # Create initial state message
            message = create_initial_state_message(
                specification=self.specification,
                model=model_data,
                changesets=changesets,
            )

            # Send to client
            await ws.send_json(message)

        except (OSError, RuntimeError, ValueError, KeyError) as e:
            console.print(f"[red]Error sending initial state: {e}[/red]")
            await self._send_error(ws, f"Failed to send initial state: {e}")

    async def _handle_websocket_message(self, ws: web.WebSocketResponse, message: str) -> None:
        """
        Handle incoming WebSocket message from client.

        Args:
            ws: WebSocket connection
            message: Message text
        """
        try:
            data = json.loads(message)
            message_type = data.get("type")

            # Future: Handle client commands (changeset switching, etc.)
            console.print(f"[dim]Received message type: {message_type}[/dim]")

        except json.JSONDecodeError as e:
            console.print(f"[red]Invalid JSON from WebSocket client: {e}[/red]")
            await self._send_error(ws, "Invalid JSON")
        except (KeyError, ValueError) as e:
            console.print(f"[red]Error processing WebSocket message: {e}[/red]")
            await self._send_error(ws, str(e))

    async def _send_error(self, ws: web.WebSocketResponse, error: str) -> None:
        """
        Send error message to client.

        Args:
            ws: WebSocket connection
            error: Error message
        """
        try:
            message = create_error_message(error)
            await ws.send_json(message)
        except (OSError, RuntimeError) as e:
            console.print(f"[red]Failed to send error message: {e}[/red]")

    def _handle_file_change(self, event_type: str, layer: str, file_path: Path) -> None:
        """
        Handle file system change event.

        Args:
            event_type: Type of change (created, modified, deleted)
            layer: Layer name
            file_path: Changed file path
        """
        # Schedule async broadcast
        asyncio.create_task(self._broadcast_file_change(event_type, layer, file_path))

    async def _broadcast_file_change(self, event_type: str, layer: str, file_path: Path) -> None:
        """
        Broadcast file change to all connected clients.

        Args:
            event_type: Type of change (created, modified, deleted)
            layer: Layer name
            file_path: Changed file path
        """
        try:
            # Determine change type and load element data
            if event_type == "deleted":
                change_type = "removed"
                element_data = None
                # For deletions, try to extract ID from filename as fallback
                element_id = file_path.stem
            elif event_type == "created":
                change_type = "added"
                element_data = await self._load_element_from_file(file_path)
                # Extract ID from loaded data
                element_id = element_data.get("id") if element_data else file_path.stem
            else:  # modified
                change_type = "updated"
                element_data = await self._load_element_from_file(file_path)
                # Extract ID from loaded data
                element_id = element_data.get("id") if element_data else file_path.stem

            if element_id:
                # Create update message
                message = create_element_update_message(
                    change_type, layer, element_id, element_data
                )

                # Broadcast to all connected clients
                await self.broadcast_update(message)

        except (OSError, ValueError, RuntimeError) as e:
            console.print(f"[red]Error broadcasting file change: {e}[/red]")

    async def _load_element_from_file(self, file_path: Path) -> Optional[Dict[str, Any]]:
        """
        Load element data from file.

        Args:
            file_path: Path to element file

        Returns:
            Element data or None if load fails
        """
        try:
            with open(file_path, "r") as f:
                data = yaml.safe_load(f)
            return data
        except (FileNotFoundError, yaml.YAMLError, OSError) as e:
            console.print(f"[yellow]Error loading element from {file_path}: {e}[/yellow]")
            return None

    def _extract_element_id(self, file_path: Path) -> Optional[str]:
        """
        Extract element ID from file content.

        Args:
            file_path: Element file path

        Returns:
            Element ID or None if not determinable
        """
        try:
            # Try to read ID from file content
            if file_path.exists():
                with open(file_path, "r") as f:
                    data = yaml.safe_load(f)
                    if data and isinstance(data, dict):
                        return data.get("id")
        except (FileNotFoundError, yaml.YAMLError, OSError) as e:
            console.print(f"[yellow]Error extracting element ID from {file_path}: {e}[/yellow]")

        # Fallback: return filename without extension
        return file_path.stem

    async def broadcast_update(self, message: Dict[str, Any]) -> None:
        """
        Broadcast update message to all connected clients.

        Args:
            message: Update message to broadcast
        """
        # Remove disconnected clients
        disconnected = set()

        for ws in self.websockets:
            try:
                await ws.send_json(message)
            except (OSError, RuntimeError) as e:
                console.print(f"[yellow]Error sending to client: {e}[/yellow]")
                disconnected.add(ws)

        # Clean up disconnected clients
        self.websockets -= disconnected

    def _setup_signal_handlers(self) -> None:
        """Setup signal handlers for graceful shutdown."""
        loop = asyncio.get_event_loop()

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(self.shutdown()))

    async def shutdown(self) -> None:
        """Gracefully shutdown the server."""
        console.print("\n[yellow]Shutting down server...[/yellow]")

        # Stop file monitoring
        if self.file_monitor:
            self.file_monitor.stop()

        # Close all WebSocket connections
        for ws in self.websockets:
            await ws.close()

        self.websockets.clear()

        # Stop HTTP server
        if self.runner:
            await self.runner.cleanup()

        # Signal shutdown complete
        self._shutdown_event.set()

        console.print("[green]Server shutdown complete[/green]")
