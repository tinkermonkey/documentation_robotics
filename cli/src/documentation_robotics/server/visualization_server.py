"""
Visualization server for Documentation Robotics models.

Provides HTTP server for static assets and WebSocket server
for real-time model updates with token-based authentication.
"""

import asyncio
import json
import mimetypes
import secrets
import signal
import time
from importlib import resources
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
    HTTP/WebSocket server for model visualization with token authentication.

    Serves static visualization assets and maintains WebSocket connections
    for real-time model updates.

    Security features:
    - Cryptographically secure token generation using secrets module
    - Token validation on all HTTP requests
    - Token validation on WebSocket upgrade handshake
    - Token valid only for server process lifetime
    - Support for token in query parameter or Authorization header
    """

    def __init__(
        self,
        model_or_path,
        host_or_spec=None,
        port_or_host: int = 8080,
        port: int = None,
    ):
        """
        Initialize visualization server.

        Supports two calling signatures:
        1. VisualizationServer(model_path, spec_path, host, port) - Production
        2. VisualizationServer(model, host, port) - Testing

        Args:
            model_or_path: Either a Model instance or Path to model root directory
            host_or_spec: Either host string or Path to specification directory
            port_or_host: Either port number or host string
            port: Port number (only used in production signature)
        """
        # Detect if this is the test signature (model, host, port)
        if isinstance(model_or_path, Model) or hasattr(model_or_path, "layers"):
            # Test signature: VisualizationServer(model, host, port)
            self.model = model_or_path
            self.model_path = getattr(model_or_path, "model_path", None)
            self.spec_path = None
            self.host = host_or_spec
            self.port = port_or_host
        else:
            # Production signature: VisualizationServer(model_path, spec_path, host, port)
            self.model_path = model_or_path
            self.spec_path = host_or_spec
            self.host = port_or_host if isinstance(port_or_host, str) else "localhost"
            self.port = (
                port
                if port is not None
                else (8080 if isinstance(port_or_host, str) else port_or_host)
            )
            self.model = None

        self.token = secrets.token_urlsafe(32)

        # Server components
        self.app: Optional[web.Application] = None
        self.runner: Optional[web.AppRunner] = None
        self.file_monitor: Optional[FileMonitor] = None

        # WebSocket connections
        self.websockets: Set[web.WebSocketResponse] = set()

        # Loaded data
        self.specification: Optional[Dict[str, Any]] = None
        self.model_serializer: Optional[ModelSerializer] = None

        # Initialize model serializer if model is provided (test mode)
        if self.model is not None:
            self.model_serializer = ModelSerializer(self.model)

        # Performance: Cache serialized initial state
        self._cached_initial_state: Optional[Dict[str, Any]] = None
        self._cache_timestamp: float = 0.0

        # Event loop reference for cross-thread task scheduling
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Shutdown flag
        self._shutdown_event = asyncio.Event()

    def get_magic_link(self) -> str:
        """
        Get the magic link URL with embedded token.

        Returns:
            Full URL with token query parameter
        """
        return f"http://{self.host}:{self.port}/?token={self.token}"

    # Public handler methods (used by tests)
    async def handle_health(self, request: web.Request) -> web.Response:
        """Public alias for _handle_health."""
        return await self._handle_health(request)

    async def handle_index(self, request: web.Request) -> web.Response:
        """Public alias for _handle_index."""
        return await self._handle_index(request)

    async def handle_model_data(self, request: web.Request) -> web.Response:
        """Public alias for _handle_model_data."""
        return await self._handle_model_data(request)

    async def handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        """Public alias for _handle_websocket."""
        return await self._handle_websocket(request)

    def _validate_token(self, request: web.Request) -> bool:
        """
        Validate authentication token from request.

        Supports token in:
        - Query parameter: ?token=...
        - Authorization header: Bearer <token>

        Args:
            request: The incoming HTTP request

        Returns:
            True if token is valid, False otherwise
        """
        # Check query parameter
        query_token = request.query.get("token")
        if query_token and secrets.compare_digest(query_token, self.token):
            return True

        # Check Authorization header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            bearer_token = auth_header[7:]  # Remove "Bearer " prefix
            if secrets.compare_digest(bearer_token, self.token):
                return True

        return False

    @web.middleware
    async def auth_middleware(self, request: web.Request, handler: Any) -> web.Response:
        """
        Authentication middleware for all HTTP requests.

        Validates token on all requests except /health endpoint.
        Returns 401 Unauthorized for missing tokens.
        Returns 403 Forbidden for invalid tokens.

        Args:
            request: The incoming HTTP request
            handler: The request handler

        Returns:
            HTTP response
        """
        # Allow health checks without authentication
        if request.path == "/health":
            return await handler(request)

        # Validate token
        if not self._validate_token(request):
            # Check if token was provided but invalid
            has_token = "token" in request.query or "Authorization" in request.headers

            if has_token:
                return web.json_response({"error": "Invalid authentication token"}, status=403)
            else:
                return web.json_response(
                    {"error": "Authentication required. Please provide a valid token."}, status=401
                )

        return await handler(request)

    async def start(self) -> None:
        """
        Start the visualization server.

        Loads model and specification, configures routes, starts HTTP server,
        and begins file monitoring.
        """
        # Store event loop reference for cross-thread task scheduling
        self._loop = asyncio.get_running_loop()

        # Load specification (skip if not provided - test mode)
        if self.spec_path:
            spec_loader = SpecificationLoader(self.spec_path)
            self.specification = spec_loader.load_specification()
        else:
            self.specification = {}

        # Load model if not already provided
        if self.model is None:
            self.model = Model(self.model_path, enable_cache=True, lazy_load=False)

        self.model_serializer = ModelSerializer(self.model)

        # Create aiohttp application with authentication middleware
        self.app = web.Application(middlewares=[self.auth_middleware])
        self._configure_routes()

        # Start HTTP server
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()

        site = web.TCPSite(self.runner, self.host, self.port)
        await site.start()

        console.print(f"[green]Server started at http://{self.host}:{self.port}[/green]")

        # Start file monitoring using model's actual model_path (skip in test mode)
        if self.model.model_path and hasattr(self.model, "model_path"):
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
        # Health check endpoint (no auth required)
        self.app.router.add_get("/health", self._handle_health)

        # API endpoints (auth required via middleware)
        self.app.router.add_get("/api/model", self._handle_model_data)

        # WebSocket endpoint (auth required via middleware)
        self.app.router.add_get("/ws", self._handle_websocket)

        # Static file serving from viewer package
        self.app.router.add_get("/", self._handle_index)
        self.app.router.add_get("/{path:.*}", self._handle_static_file)

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

    async def _handle_model_data(self, request: web.Request) -> web.Response:
        """
        Handle API requests for model data.

        Args:
            request: HTTP request

        Returns:
            JSON response with model data
        """
        model_data = {
            "model_path": str(self.model_path),
            "root_path": str(self.model.root_path) if self.model else None,
            "layers": list(self.model.layers.keys()) if self.model else [],
            "version": self.model.manifest.version if self.model and self.model.manifest else None,
        }

        return web.json_response(model_data)

    async def _handle_index(self, request: web.Request) -> web.Response:
        """
        Handle index page requests.

        Args:
            request: HTTP request

        Returns:
            HTML response
        """
        # Try to serve index.html from bundled viewer
        try:
            return await self._serve_static_file("index.html")
        except (FileNotFoundError, ModuleNotFoundError):
            # Fallback to placeholder HTML if viewer package not available
            fallback_html = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation Robotics - Model Visualization Server</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            line-height: 1.6;
        }
        .error-box {
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 20px;
            margin: 20px 0;
        }
        code {
            background: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }
    </style>
</head>
<body>
    <h1>Documentation Robotics - Model Visualization Server</h1>
    <div class="error-box">
        <h2>⚠️ Viewer Not Available</h2>
        <p>The documentation-robotics-viewer package is not installed or bundled.</p>
        <p>The visualization server is running and API endpoints are available, but the web UI cannot be displayed.</p>
        <h3>To install the viewer:</h3>
        <p>Run: <code>pip install documentation-robotics-viewer</code></p>
    </div>
    <h2>Available Endpoints:</h2>
    <ul>
        <li><code>GET /health</code> - Server health check</li>
        <li><code>GET /api/model</code> - Model data (requires authentication)</li>
        <li><code>WS /ws</code> - WebSocket connection (requires authentication)</li>
    </ul>
</body>
</html>
            """
            return web.Response(text=fallback_html, content_type="text/html")

    async def _handle_static_file(self, request: web.Request) -> web.Response:
        """
        Handle static file requests from viewer package.

        Args:
            request: HTTP request

        Returns:
            Static file response or 404
        """
        path = request.match_info.get("path", "")

        # For SPA routing, serve index.html for non-asset requests
        if not path or ("." not in path and path not in ["health", "ws"]):
            return await self._handle_index(request)

        try:
            return await self._serve_static_file(path)
        except (FileNotFoundError, ModuleNotFoundError):
            raise web.HTTPNotFound(text=f"File not found: {path}")

    async def _serve_static_file(self, file_path: str) -> web.Response:
        """
        Serve static file from viewer package resources.

        Args:
            file_path: Relative file path within viewer package

        Returns:
            File response

        Raises:
            FileNotFoundError: If file not found
            ModuleNotFoundError: If viewer package not installed
        """
        try:
            # Load from bundled viewer assets
            import documentation_robotics

            # Use importlib.resources to access bundled viewer files
            if hasattr(resources, "files"):  # Python 3.9+
                package_files = resources.files(documentation_robotics)
                file_resource = package_files / "viewer" / "dist" / file_path
                content = file_resource.read_bytes()
            else:  # Python 3.8 fallback
                import pkg_resources

                viewer_path = pkg_resources.resource_filename(
                    "documentation_robotics", f"viewer/dist/{file_path}"
                )
                with open(viewer_path, "rb") as f:
                    content = f.read()

            # Determine content type
            content_type, _ = mimetypes.guess_type(file_path)
            if not content_type:
                content_type = "application/octet-stream"

            return web.Response(body=content, content_type=content_type)

        except (ModuleNotFoundError, ImportError, FileNotFoundError) as e:
            raise FileNotFoundError(f"Viewer file not found: {file_path}") from e

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
            # Send welcome message
            await ws.send_json({"type": "connected", "message": "WebSocket connection established"})

            # Send initial state (don't let errors close the connection)
            try:
                await self._send_initial_state(ws)
            except Exception as e:
                console.print(f"[yellow]Warning: Could not send initial state: {e}[/yellow]")

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

        Uses cached state if available and valid, otherwise regenerates.

        Args:
            ws: WebSocket connection
        """
        try:
            # Check if cache is valid (not invalidated by file changes)
            if self._cached_initial_state is None:
                # Generate and cache initial state
                model_data = self.model_serializer.serialize_model()
                changesets = load_changesets(self.model_path) if self.model_path else []

                self._cached_initial_state = create_initial_state_message(
                    specification=self.specification,
                    model=model_data,
                    changesets=changesets,
                )
                self._cache_timestamp = time.time()

                console.print("[dim]Initial state cached for future connections[/dim]")

            # Send cached state
            await ws.send_json(self._cached_initial_state)

        except (OSError, RuntimeError, ValueError, KeyError) as e:
            console.print(f"[red]Error sending initial state: {e}[/red]")
            # Don't send error for initial state failures in test mode
            if self.model_path:
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

            # Handle test messages
            if message_type == "test":
                await ws.send_json({"type": "response", "message": "Test message received"})
            else:
                # Future: Handle client commands (changeset switching, etc.)
                console.print(f"[dim]Received message type: {message_type}[/dim]")

        except json.JSONDecodeError as e:
            console.print(f"[red]Invalid JSON from WebSocket client: {e}[/red]")
            await ws.send_json({"type": "error", "message": "Invalid JSON"})
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

        Called from watchdog observer thread, so must safely schedule async work.

        Args:
            event_type: Type of change (created, modified, deleted)
            layer: Layer name
            file_path: Changed file path
        """
        if self._loop and self._loop.is_running():
            # Schedule task creation in the event loop thread (thread-safe)
            self._loop.call_soon_threadsafe(
                lambda: asyncio.create_task(
                    self._broadcast_file_change(event_type, layer, file_path)
                )
            )
        else:
            console.print(
                "[yellow]Warning: Event loop not running, cannot broadcast file change[/yellow]"
            )

    async def _broadcast_file_change(self, event_type: str, layer: str, file_path: Path) -> None:
        """
        Broadcast file change to all connected clients.

        Args:
            event_type: Type of change (created, modified, deleted)
            layer: Layer name
            file_path: Changed file path
        """
        try:
            # Invalidate cached initial state on any file change
            self._cached_initial_state = None

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
