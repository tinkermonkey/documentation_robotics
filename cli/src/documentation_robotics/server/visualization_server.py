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
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from ..core.annotations import Annotation, AnnotationRegistry, AnnotationStore
from ..core.model import Model
from .annotation_serializer import AnnotationSerializer
from .chat_handler import ChatHandler
from .chat_session import ChatSession
from .file_monitor import FileMonitor
from .model_serializer import ModelSerializer, load_changesets
from .specification_loader import SpecificationLoader
from .websocket_protocol import (
    create_annotation_added_message,
    create_annotation_reply_added_message,
    create_element_update_message,
    create_error_message,
    create_initial_state_message,
    get_timestamp,
)

console = Console()


class AnnotationFileHandler(FileSystemEventHandler):
    """Handler for annotation file changes."""

    def __init__(self, callback):
        """
        Initialize annotation file handler.

        Args:
            callback: Callback function with signature (event_type: str, file_path: Path) -> None
                      Called when annotation files are created, modified, or deleted.
        """
        super().__init__()
        self.callback = callback

    def on_created(self, event: FileSystemEvent):
        """Handle file created event."""
        if not event.is_directory and event.src_path.endswith(".json"):
            self.callback("created", Path(event.src_path))

    def on_modified(self, event: FileSystemEvent):
        """Handle file modified event."""
        if not event.is_directory and event.src_path.endswith(".json"):
            self.callback("modified", Path(event.src_path))

    def on_deleted(self, event: FileSystemEvent):
        """Handle file deleted event."""
        if not event.is_directory and event.src_path.endswith(".json"):
            self.callback("deleted", Path(event.src_path))


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
            # Get root_path from model for chat handler/orchestrator
            self.model_path = getattr(model_or_path, "root_path", None)
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
        self._annotation_observer: Optional[Observer] = None
        self._annotation_handler: Optional[AnnotationFileHandler] = None

        # WebSocket connections
        self.websockets: Set[web.WebSocketResponse] = set()

        # Chat sessions per WebSocket
        self._ws_sessions: Dict[web.WebSocketResponse, ChatSession] = {}

        # Loaded data
        self.specification: Optional[Dict[str, Any]] = None
        self.model_serializer: Optional[ModelSerializer] = None

        # Annotation components
        self.annotation_registry: Optional[AnnotationRegistry] = None
        self.annotation_serializer: Optional[AnnotationSerializer] = None

        # Chat handler
        self.chat_handler: Optional[ChatHandler] = None

        # Initialize model serializer if model is provided (test mode)
        if self.model is not None:
            self.model_serializer = ModelSerializer(self.model)

        # Initialize annotation components if model_path is available
        if self.model_path:
            self.annotation_registry = AnnotationRegistry(self.model_path)
            self.annotation_serializer = AnnotationSerializer(self.model_path)

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

    def _get_model_context(self) -> Dict[str, Any]:
        """
        Get model context for DrBot.

        Returns:
            Dictionary containing model metadata for Claude context
        """
        if self.model_serializer:
            return self.model_serializer.serialize_model()
        return {}

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
            response = await handler(request)
            self._add_cors_headers(response)
            return response

        # Validate token
        if not self._validate_token(request):
            # Check if token was provided but invalid
            has_token = "token" in request.query or "Authorization" in request.headers

            if has_token:
                response = web.json_response({"error": "Invalid authentication token"}, status=403)
            else:
                response = web.json_response(
                    {"error": "Authentication required. Please provide a valid token."}, status=401
                )
            self._add_cors_headers(response)
            return response

        response = await handler(request)
        self._add_cors_headers(response)
        return response

    def _add_cors_headers(self, response: web.Response) -> None:
        """
        Add CORS headers to response.

        Args:
            response: HTTP response to add headers to
        """
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Max-Age"] = "3600"

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

        # Initialize annotation components if not already done
        if not self.annotation_registry and self.model_path:
            self.annotation_registry = AnnotationRegistry(self.model_path)
            self.annotation_serializer = AnnotationSerializer(self.model_path)

        # Load annotations on startup
        if self.annotation_registry:
            self.annotation_registry.load_all()

        # Initialize chat handler
        self.chat_handler = ChatHandler(
            model_path=self.model_path,
            model_context_provider=self._get_model_context,
        )

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

        # Start annotation file monitoring
        if self.model_path:
            annotations_dir = self.model_path / "annotations"
            # Create annotations directory if it doesn't exist
            annotations_dir.mkdir(parents=True, exist_ok=True)

            # Set up file monitoring for annotations directory
            self._annotation_observer = Observer()
            self._annotation_handler = AnnotationFileHandler(self._handle_annotation_file_change)
            self._annotation_observer.schedule(
                self._annotation_handler, str(annotations_dir), recursive=True
            )
            self._annotation_observer.start()

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

        # Skip handling for API endpoints and WebSocket - they have their own routes
        if path.startswith("api/") or path == "ws" or path == "health":
            raise web.HTTPNotFound(text=f"Path not found: {path}")

        # For SPA routing, serve index.html for non-asset requests
        # Assets typically have file extensions (e.g., .js, .css, .png)
        if not path or ("." not in path):
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

            # Determine content type with explicit mappings for common web assets
            # This prevents MIME type misdetection that can cause CORS/module loading errors
            content_type = None
            file_lower = file_path.lower()

            # Explicit mappings for JavaScript modules and web assets
            if file_lower.endswith('.js') or file_lower.endswith('.mjs'):
                content_type = 'text/javascript'
            elif file_lower.endswith('.css'):
                content_type = 'text/css'
            elif file_lower.endswith('.html'):
                content_type = 'text/html'
            elif file_lower.endswith('.json'):
                content_type = 'application/json'
            elif file_lower.endswith('.svg'):
                content_type = 'image/svg+xml'
            elif file_lower.endswith('.png'):
                content_type = 'image/png'
            elif file_lower.endswith('.jpg') or file_lower.endswith('.jpeg'):
                content_type = 'image/jpeg'
            elif file_lower.endswith('.gif'):
                content_type = 'image/gif'
            elif file_lower.endswith('.ico'):
                content_type = 'image/x-icon'
            elif file_lower.endswith('.woff'):
                content_type = 'font/woff'
            elif file_lower.endswith('.woff2'):
                content_type = 'font/woff2'
            elif file_lower.endswith('.ttf'):
                content_type = 'font/ttf'
            elif file_lower.endswith('.eot'):
                content_type = 'application/vnd.ms-fontobject'
            else:
                # Fallback to mimetypes module for other file types
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
            # Clean up chat session
            if self.chat_handler and ws in self._ws_sessions:
                session = self._ws_sessions[ws]
                await self.chat_handler.session_manager.remove_session(session.session_id)
                del self._ws_sessions[ws]

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

                # Add annotations to model data
                if self.annotation_serializer:
                    model_data["annotations"] = self.annotation_serializer.serialize_all()
                else:
                    model_data["annotations"] = []

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

            # Handle annotation messages
            elif message_type == "annotation_add":
                await self._handle_annotation_add(ws, data)

            elif message_type == "annotation_reply":
                await self._handle_annotation_reply(ws, data)

            # Check for JSON-RPC chat messages
            elif data.get("jsonrpc") == "2.0":
                # Get or create session for this WebSocket
                if ws not in self._ws_sessions:
                    self._ws_sessions[ws] = self.chat_handler.session_manager.create_session()
                session = self._ws_sessions[ws]
                await self.chat_handler.handle_message(ws, message, session)

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

    async def _handle_annotation_add(
        self, ws: web.WebSocketResponse, message: Dict[str, Any]
    ) -> None:
        """
        Handle annotation add from web UI.

        Message format:
        {
          'type': 'annotation_add',
          'data': {
            'entity_uri': 'motivation.goal.deliver-value',
            'message': 'Annotation text',
            'user': 'username'
          }
        }

        Args:
            ws: WebSocket connection
            message: Message data containing type and data fields
        """
        try:
            data = message.get("data", {})

            # Validate required fields
            entity_uri = data.get("entity_uri")
            annotation_message = data.get("message")
            user = data.get("user")

            if not all([entity_uri, annotation_message, user]):
                await self._send_error(ws, "Missing required fields: entity_uri, message, user")
                return

            # Generate annotation ID
            annotation_id = f"ann-{secrets.token_urlsafe(6)[:8]}"

            # Create annotation
            annotation = Annotation(
                id=annotation_id,
                entity_uri=entity_uri,
                timestamp=get_timestamp(),
                user=user,
                message=annotation_message,
                parent_id=None,
            )

            # Save to user's store
            if not self.model_path:
                await self._send_error(ws, "Server not configured with model path")
                return

            store = AnnotationStore(user, self.model_path)
            store.add_annotation(annotation)

            # Reload registry to include new annotation
            if self.annotation_registry:
                self.annotation_registry.load_all()

            # Invalidate cache
            self._cached_initial_state = None

            # Broadcast to all clients
            broadcast_message = create_annotation_added_message(annotation)
            await self.broadcast_update(broadcast_message)

            console.print(f"[dim]Annotation added: {annotation_id} by {user}[/dim]")

        except (ValueError, KeyError, OSError) as e:
            console.print(f"[red]Error handling annotation add: {e}[/red]")
            await self._send_error(ws, f"Failed to add annotation: {e}")

    async def _handle_annotation_reply(
        self, ws: web.WebSocketResponse, message: Dict[str, Any]
    ) -> None:
        """
        Handle annotation reply from web UI.

        Message format:
        {
          'type': 'annotation_reply',
          'data': {
            'parent_id': 'ann-abc123',
            'message': 'Reply text',
            'user': 'username'
          }
        }

        Args:
            ws: WebSocket connection
            message: Message data containing type and data fields
        """
        try:
            data = message.get("data", {})

            # Validate required fields
            parent_id = data.get("parent_id")
            reply_message = data.get("message")
            user = data.get("user")

            if not all([parent_id, reply_message, user]):
                await self._send_error(ws, "Missing required fields: parent_id, message, user")
                return

            # Get parent to retrieve entity_uri
            if not self.annotation_registry:
                await self._send_error(ws, "Annotation system not initialized")
                return

            parent = self.annotation_registry.get_annotation(parent_id)
            if not parent:
                await self._send_error(ws, f"Parent annotation not found: {parent_id}")
                return

            # Generate reply ID
            reply_id = f"ann-{secrets.token_urlsafe(6)[:8]}"

            # Create reply
            reply = Annotation(
                id=reply_id,
                entity_uri=parent.entity_uri,
                timestamp=get_timestamp(),
                user=user,
                message=reply_message,
                parent_id=parent_id,
            )

            # Save to user's store
            if not self.model_path:
                await self._send_error(ws, "Server not configured with model path")
                return

            store = AnnotationStore(user, self.model_path)
            store.add_annotation(reply)

            # Reload registry to include new reply
            self.annotation_registry.load_all()

            # Invalidate cache
            self._cached_initial_state = None

            # Broadcast to all clients
            broadcast_message = create_annotation_reply_added_message(reply)
            await self.broadcast_update(broadcast_message)

            console.print(f"[dim]Reply added: {reply_id} by {user} to {parent_id}[/dim]")

        except (ValueError, KeyError, OSError) as e:
            console.print(f"[red]Error handling annotation reply: {e}[/red]")
            await self._send_error(ws, f"Failed to add reply: {e}")

    def _handle_annotation_file_change(self, event_type: str, file_path: Path) -> None:
        """
        Handle annotation file system change event.

        Called from watchdog observer thread, so must safely schedule async work.

        Args:
            event_type: Type of change (created, modified, deleted)
            file_path: Changed file path
        """
        if self._loop and self._loop.is_running():
            # Schedule task creation in the event loop thread (thread-safe)
            self._loop.call_soon_threadsafe(
                lambda: asyncio.create_task(
                    self._broadcast_annotation_change(event_type, file_path)
                )
            )
        else:
            console.print(
                "[yellow]Warning: Event loop not running, cannot broadcast annotation change[/yellow]"
            )

    async def _broadcast_annotation_change(self, event_type: str, file_path: Path) -> None:
        """
        Broadcast annotation file change to all connected clients.

        Args:
            event_type: Type of change (created, modified, deleted)
            file_path: Changed file path
        """
        try:
            # Invalidate cached initial state
            self._cached_initial_state = None

            # Reload annotations from affected user's directory
            if self.annotation_registry:
                self.annotation_registry.load_all()

            # For now, we don't broadcast individual annotation changes from file system
            # changes because those are already broadcast when created via WebSocket.
            # File system changes are primarily for external edits or cross-process sync.
            console.print(
                f"[dim]Annotation file {event_type}: {file_path.relative_to(self.model_path)}[/dim]"
            )

        except (OSError, ValueError, RuntimeError) as e:
            console.print(f"[red]Error broadcasting annotation change: {e}[/red]")

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

        # Stop annotation file monitoring
        if self._annotation_observer:
            try:
                self._annotation_observer.stop()
                self._annotation_observer.join(timeout=2.0)
            except (RuntimeError, AttributeError) as e:
                console.print(f"[yellow]Annotation observer cleanup warning: {e}[/yellow]")

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
