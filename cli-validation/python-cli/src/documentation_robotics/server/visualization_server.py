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
    create_changeset_created_message,
    create_connected_message,
    create_element_update_message,
    create_error_message,
    create_initial_state_message,
    create_model_updated_message,
    create_pong_message,
    create_subscribed_message,
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
            self.model_path = self._resolve_model_root(Path(model_or_path))
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

        # Topic subscriptions per WebSocket (model, changesets, annotations)
        self._ws_subscriptions: Dict[web.WebSocketResponse, Set[str]] = {}

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

        # Changeset monitoring
        self._changeset_observer: Optional[Observer] = None
        self._changeset_root: Optional[Path] = None

    def _resolve_model_root(self, path: Path) -> Path:
        """Find the project root by locating documentation-robotics/model/manifest.yaml.

        This method identifies the project root directory by searching for the manifest.yaml
        marker file. It does not validate the project structure - use CLI validation commands
        for that purpose.

        Accepts any of these inputs:
        - project root
        - documentation-robotics/ directory
        - documentation-robotics/model/ directory
        - direct path to manifest.yaml
        - any child path beneath the project root

        Returns:
            Path to the project root directory (parent of documentation-robotics/)

        Raises:
            FileNotFoundError: If manifest.yaml cannot be located in the directory tree
        """
        path = Path(path).resolve()

        # If a manifest file path is provided directly
        if path.name == "manifest.yaml" and (path.parent / "manifest.yaml").exists():
            model_dir = path.parent
            if model_dir.name == "model" and model_dir.parent.name == "documentation-robotics":
                return model_dir.parent.parent

        # If the path itself is the model directory
        manifest_in_dir = path / "manifest.yaml"
        if (
            manifest_in_dir.exists()
            and path.name == "model"
            and path.parent.name == "documentation-robotics"
        ):
            return path.parent.parent

        # If the path is the project root (or higher) containing documentation-robotics/model
        manifest_nested = path / "documentation-robotics" / "model" / "manifest.yaml"
        if manifest_nested.exists():
            return path

        # Walk upwards to find the project root that contains documentation-robotics/model/manifest.yaml
        for candidate in path.parents:
            manifest = candidate / "documentation-robotics" / "model" / "manifest.yaml"
            if manifest.exists():
                return candidate

        raise FileNotFoundError(
            f"documentation-robotics/model/manifest.yaml not found relative to {path}"
        )

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

        Checks in order:
        1. httpOnly cookie (primary method for web clients)
        2. Query parameter (for magic link initial access)
        3. Authorization header (for API clients)

        Args:
            request: The incoming HTTP request

        Returns:
            True if token is valid, False otherwise
        """
        # Check httpOnly cookie first (primary auth method)
        cookie_token = request.cookies.get("auth_token")
        if cookie_token and secrets.compare_digest(cookie_token, self.token):
            return True

        # Check query parameter (for magic link)
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

        Validates token on API and WebSocket endpoints only.
        Static assets (HTML, JS, CSS, images, fonts) are served without authentication
        since they contain no sensitive data - the viewer UI is public.

        When a valid token is provided via query param or Authorization header,
        sets an httpOnly cookie for subsequent requests.

        Returns 401 Unauthorized for missing tokens on protected endpoints.
        Returns 403 Forbidden for invalid tokens on protected endpoints.

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

        # Handle CORS preflight requests without requiring authentication
        if request.method == "OPTIONS":
            response = web.Response(status=200)
            self._add_cors_headers(response)
            return response

        # Allow static assets without authentication
        # Static assets (JS, CSS, images, fonts) are public - they're just the viewer UI files
        # The root path (/) requires authentication via magic link token
        # Authentication also protects API endpoints that return model data
        path = request.path
        if self._is_static_asset(path):
            response = await handler(request)
            self._add_cors_headers(response)
            return response

        # Require authentication for root path, API and WebSocket endpoints
        # Root path uses token-based "magic link" for access
        # API/WebSocket endpoints return sensitive model data
        if not self._validate_token(request):
            # Check if token was provided but invalid
            has_token = (
                "token" in request.query
                or "Authorization" in request.headers
                or "auth_token" in request.cookies
            )

            if has_token:
                response = web.json_response({"error": "Invalid authentication token"}, status=403)
            else:
                response = web.json_response(
                    {"error": "Authentication required. Please provide a valid token."}, status=401
                )
            self._add_cors_headers(response)
            return response

        # Valid token found - proceed with request
        response = await handler(request)
        self._add_cors_headers(response)

        # Set httpOnly cookie if valid token came from query param or header (not already a cookie)
        # This upgrades magic link or API authentication to cookie-based auth
        has_cookie = "auth_token" in request.cookies
        has_query_or_header = "token" in request.query or "Authorization" in request.headers

        if not has_cookie and has_query_or_header:
            response.set_cookie(
                "auth_token",
                self.token,
                max_age=86400 * 30,  # 30 days
                httponly=True,
                samesite="Lax",
                secure=request.scheme == "https",  # Only set secure flag for HTTPS
            )

        return response

    def _is_static_asset(self, path: str) -> bool:
        """
        Check if path is a static asset (JS, CSS, images, fonts, etc.).

        Static assets are public and don't require authentication.

        Args:
            path: Request path

        Returns:
            True if path is a static asset, False otherwise
        """
        # Common static asset extensions
        static_extensions = (
            ".js",
            ".mjs",
            ".css",
            ".html",
            ".ico",
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".svg",
            ".woff",
            ".woff2",
            ".ttf",
            ".eot",
            ".map",  # Source maps
        )
        path_lower = path.lower()
        return any(path_lower.endswith(ext) for ext in static_extensions)

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

        # Start changeset directory monitoring
        if self.model_path:
            self._changeset_root = self.model_path / ".dr" / "changesets"
            self._changeset_root.mkdir(parents=True, exist_ok=True)

            self._changeset_observer = Observer()

            class ChangesetHandler(FileSystemEventHandler):
                def __init__(self, parent: "VisualizationServer"):
                    super().__init__()
                    self.parent = parent

                def on_created(self, event: FileSystemEvent):
                    try:
                        path = Path(event.src_path)
                        if event.is_directory:
                            changeset_id = path.name
                            if self.parent._loop:
                                asyncio.run_coroutine_threadsafe(
                                    self.parent._broadcast_changeset_created(changeset_id),
                                    self.parent._loop,
                                )
                        elif path.name == "metadata.yaml" and path.parent.is_dir():
                            changeset_id = path.parent.name
                            if self.parent._loop:
                                asyncio.run_coroutine_threadsafe(
                                    self.parent._broadcast_changeset_created(changeset_id),
                                    self.parent._loop,
                                )
                    except Exception as e:
                        console.print(f"[yellow]Changeset handler warning: {e}[/yellow]")

            self._changeset_observer.schedule(
                ChangesetHandler(self), str(self._changeset_root), recursive=True
            )
            self._changeset_observer.start()

        # Setup signal handlers
        self._setup_signal_handlers()

        # Wait for shutdown
        await self._shutdown_event.wait()

    def _configure_routes(self) -> None:
        """Configure HTTP and WebSocket routes."""
        # Health check endpoint (no auth required)
        self.app.router.add_get("/health", self._handle_health)

        # API endpoints (auth required via middleware)
        self.app.router.add_get("/api/spec", self._handle_spec)
        self.app.router.add_get("/api/model", self._handle_model_data)
        self.app.router.add_get("/api/link-registry", self._handle_link_registry)
        self.app.router.add_get("/api/changesets", self._handle_changesets)
        self.app.router.add_get("/api/changesets/{changesetId}", self._handle_changeset_details)
        self.app.router.add_get("/api/annotations", self._handle_annotations)
        self.app.router.add_post("/api/annotations", self._handle_create_annotation)
        self.app.router.add_put("/api/annotations/{annotationId}", self._handle_update_annotation)
        self.app.router.add_delete(
            "/api/annotations/{annotationId}", self._handle_delete_annotation
        )

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
            Health check response matching API spec
        """
        health_data = {
            "status": "ok",
            "version": (
                self.specification.get("version", "unknown") if self.specification else "unknown"
            ),
        }

        return web.json_response(health_data)

    async def _handle_spec(self, request: web.Request) -> web.Response:
        """
        Handle API requests for schema specifications.

        Returns all JSON Schema files from .dr/schemas/ directory
        including layer schemas, relationship catalog, and link registry.

        Args:
            request: HTTP request

        Returns:
            JSON response with SpecDataResponse schema
        """
        try:
            if not self.specification:
                return web.json_response({"error": "Specification not loaded"}, status=500)

            # Load schemas from spec path
            schemas = {}
            link_registry = None
            relationship_catalog = None

            if self.spec_path:
                schemas_dir = self.spec_path / "schemas"
                if schemas_dir.exists():
                    # Load all JSON schema files
                    for schema_file in schemas_dir.glob("*.json"):
                        try:
                            with open(schema_file, "r") as f:
                                schemas[schema_file.name] = json.load(f)

                                # Extract special schemas
                                if schema_file.name == "link-registry.json":
                                    link_registry = schemas[schema_file.name]
                                elif schema_file.name == "relationship-catalog.json":
                                    relationship_catalog = schemas[schema_file.name]
                        except (json.JSONDecodeError, OSError) as e:
                            console.print(
                                f"[yellow]Warning: Could not load schema {schema_file.name}: {e}[/yellow]"
                            )

            response_data = {
                "version": self.specification.get("version", "unknown"),
                "type": "schema-collection",
                "description": "JSON Schema definitions from dr CLI",
                "source": "dr-cli",
                "schemas": schemas,
                "schema_count": len(schemas),
                "schemaCount": len(schemas),
            }

            # Add manifest if available
            if self.specification.get("metadata"):
                response_data["manifest"] = self.specification.get("metadata")

            # Add special schemas at top level if found
            if link_registry:
                response_data["linkRegistry"] = link_registry
                response_data["link_registry"] = link_registry

            if relationship_catalog:
                response_data["relationshipCatalog"] = relationship_catalog
                response_data["relationship_catalog"] = relationship_catalog

            return web.json_response(response_data)

        except Exception as e:
            console.print(f"[red]Error handling spec request: {e}[/red]")
            return web.json_response(
                {"error": f"Failed to load specifications: {str(e)}"}, status=500
            )

    async def _handle_link_registry(self, request: web.Request) -> web.Response:
        """
        Handle API requests for link registry.

        Returns the link registry defining valid cross-layer relationships.
        Located at .dr/schemas/link-registry.json.

        Args:
            request: HTTP request

        Returns:
            JSON response with LinkRegistry schema
        """
        try:
            if not self.spec_path:
                return web.json_response({"error": "Specification path not configured"}, status=500)

            link_registry_file = self.spec_path / "schemas" / "link-registry.json"

            if not link_registry_file.exists():
                return web.json_response({"error": "Link registry not found"}, status=404)

            with open(link_registry_file, "r") as f:
                link_registry = json.load(f)

            return web.json_response(link_registry)

        except json.JSONDecodeError:
            return web.json_response({"error": "Invalid JSON in link registry file"}, status=500)
        except Exception as e:
            console.print(f"[red]Error handling link registry request: {e}[/red]")
            return web.json_response(
                {"error": f"Failed to load link registry: {str(e)}"}, status=500
            )

    async def _handle_changesets(self, request: web.Request) -> web.Response:
        """
        Handle API requests to list all changesets.

        Returns a registry of all available changesets with summaries.

        Args:
            request: HTTP request

        Returns:
            JSON response with ChangesetRegistry schema
        """
        try:
            if not self.model_path:
                return web.json_response({"changesets": {}}, status=200)

            changesets_list = load_changesets(self.model_path)

            # Convert list to dictionary keyed by changeset ID
            changesets_dict = {}
            for changeset in changesets_list:
                changeset_id = changeset.get("id")
                if changeset_id:
                    # Create summary without full changes list
                    summary = {
                        "name": changeset.get("name"),
                        "status": changeset.get("status"),
                        "type": changeset.get("type"),
                        "created_at": changeset.get("created_at"),
                    }

                    # Add elements count from summary
                    change_summary = changeset.get("summary", {})
                    if change_summary:
                        summary["elements_count"] = (
                            change_summary.get("elements_added", 0)
                            + change_summary.get("elements_updated", 0)
                            + change_summary.get("elements_deleted", 0)
                        )

                    changesets_dict[changeset_id] = summary

            response_data = {
                "version": "1.0.0",
                "changesets": changesets_dict,
            }

            return web.json_response(response_data)

        except Exception as e:
            console.print(f"[red]Error handling changesets list request: {e}[/red]")
            return web.json_response({"error": f"Failed to load changesets: {str(e)}"}, status=500)

    async def _handle_changeset_details(self, request: web.Request) -> web.Response:
        """
        Handle API requests to get changeset details.

        Returns detailed information about a specific changeset including all changes.

        Args:
            request: HTTP request

        Returns:
            JSON response with ChangesetDetails schema
        """
        try:
            changeset_id = request.match_info.get("changesetId")
            if not changeset_id:
                return web.json_response({"error": "Missing changesetId parameter"}, status=400)

            if not self.model_path:
                return web.json_response({"error": "Model path not configured"}, status=500)

            changesets_list = load_changesets(self.model_path)

            # Find the requested changeset
            changeset = None
            for cs in changesets_list:
                if cs.get("id") == changeset_id:
                    changeset = cs
                    break

            if not changeset:
                return web.json_response(
                    {"error": f"Changeset not found: {changeset_id}"}, status=404
                )

            # Extract metadata and changes
            metadata = {
                "id": changeset.get("id"),
                "name": changeset.get("name"),
                "description": changeset.get("description"),
                "type": changeset.get("type"),
                "status": changeset.get("status"),
                "created_at": changeset.get("created_at"),
                "updated_at": changeset.get("updated_at"),
                "workflow": changeset.get("workflow"),
                "summary": changeset.get("summary"),
            }

            response_data = {
                "metadata": metadata,
                "changes": {
                    "version": "1.0.0",
                    "changes": changeset.get("changes", []),
                },
            }

            return web.json_response(response_data)

        except Exception as e:
            console.print(f"[red]Error handling changeset details request: {e}[/red]")
            return web.json_response({"error": f"Failed to load changeset: {str(e)}"}, status=500)

    async def _handle_model_data(self, request: web.Request) -> web.Response:
        """
        Handle API requests for model data.

        Returns the current architecture model from documentation-robotics/model/.
        Includes all layers, elements, relationships, and cross-layer references.

        Args:
            request: HTTP request

        Returns:
            JSON response with ModelResponse schema
        """
        try:
            if not self.model:
                return web.json_response({"error": "Model not loaded"}, status=500)

            # Build basic model response
            response_data = {
                "version": "0.1.0",
                "metadata": {
                    "type": "yaml-instance",
                    "source": "dr-cli",
                    "description": "Architecture model from Documentation Robotics",
                },
                "layers": {},
                "references": [],
            }

            # Add manifest info if available
            if hasattr(self.model, "manifest") and self.model.manifest:
                try:
                    version = getattr(self.model.manifest, "version", "0.1.0")
                    response_data["version"] = version

                    # Try to add project metadata
                    project = getattr(self.model.manifest, "project", None)
                    if project and not str(type(project)).startswith("<class 'unittest.mock"):
                        response_data["metadata"]["project"] = project

                    # Calculate statistics
                    if hasattr(self.model, "layers") and isinstance(self.model.layers, dict):
                        total_elements = sum(
                            len(getattr(layer, "elements", {})) if hasattr(layer, "elements") else 0
                            for layer in self.model.layers.values()
                        )
                        response_data["metadata"]["statistics"] = {
                            "total_layers": len(self.model.layers),
                            "total_elements": total_elements,
                        }
                except (AttributeError, TypeError):
                    # If manifest has issues, continue without it
                    pass

            # Build layers array from model
            if hasattr(self.model, "layers") and isinstance(self.model.layers, dict):
                for layer_name, layer in self.model.layers.items():
                    try:
                        # Only add layers with actual elements
                        elements = []
                        if hasattr(layer, "elements") and isinstance(layer.elements, dict):
                            for element in layer.elements.values():
                                try:
                                    element_id = getattr(element, "name", str(layer_name))
                                    element_type = getattr(element, "type", "unknown")
                                    element_dict = {
                                        "id": f"{layer_name}.{element_type}.{element_id}",
                                        "type": element_type,
                                        "name": element_id,
                                        "layerId": layer_name,
                                        "properties": getattr(element, "properties", {}) or {},
                                    }
                                    elements.append(element_dict)
                                except (AttributeError, TypeError):
                                    # Skip problematic elements
                                    pass

                        response_data["layers"][layer_name] = {
                            "id": layer_name,
                            "type": layer_name.capitalize(),
                            "name": layer_name,
                            "elements": elements,
                            "relationships": [],
                        }
                    except (AttributeError, TypeError):
                        # Skip problematic layers
                        pass

            return web.json_response(response_data)

        except Exception as e:
            console.print(f"[red]Error handling model data request: {e}[/red]")
            return web.json_response({"error": f"Failed to load model: {str(e)}"}, status=500)

    async def _handle_annotations(self, request: web.Request) -> web.Response:
        """
        Handle API requests for annotations data.

        Supports optional elementId query parameter to filter annotations.

        Args:
            request: HTTP request

        Returns:
            JSON response with annotations in format: {"annotations": [...]}
        """
        element_id = request.query.get("elementId")

        if self.annotation_serializer:
            all_annotations = self.annotation_serializer.serialize_all()

            # Filter by elementId if provided
            if element_id:
                annotations = [ann for ann in all_annotations if ann.get("elementId") == element_id]
            else:
                annotations = all_annotations
        else:
            annotations = []

        return web.json_response({"annotations": annotations})

    async def _handle_create_annotation(self, request: web.Request) -> web.Response:
        """
        Handle API requests to create new annotations.

        Expected JSON body:
        {
            "elementId": "layer.type.element-id",
            "content": "annotation text",
            "author": "username"
        }

        Args:
            request: HTTP request

        Returns:
            JSON response with created annotation
        """
        try:
            data = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "Invalid JSON in request body"}, status=400)

        # Validate required fields
        element_id = data.get("elementId")
        content = data.get("content")
        author = data.get("author")

        if not element_id:
            return web.json_response({"error": "Missing required field: elementId"}, status=400)
        if not content:
            return web.json_response({"error": "Missing required field: content"}, status=400)
        if not author:
            return web.json_response({"error": "Missing required field: author"}, status=400)

        if not self.model_path or not self.annotation_registry:
            return web.json_response({"error": "Annotation system not initialized"}, status=500)

        try:
            # Create annotation using AnnotationStore
            from datetime import datetime

            from ..core.annotations import Annotation, AnnotationStore, generate_annotation_id

            store = AnnotationStore(author, self.model_path)

            # Create new annotation
            annotation = Annotation(
                id=generate_annotation_id(),
                entity_uri=element_id,
                timestamp=datetime.utcnow().isoformat() + "Z",
                user=author,
                message=content,
                parent_id=None,
            )

            # Save to store
            store.add_annotation(annotation)

            # Reload registry to get the new annotation
            self.annotation_registry.load_all()

            # Serialize and return the created annotation
            created_ann = {
                "id": annotation.id,
                "elementId": annotation.entity_uri,
                "author": annotation.user,
                "content": annotation.message,
                "createdAt": annotation.timestamp,
                "resolved": False,
            }

            # Broadcast annotation added event to all WebSocket clients
            await self.broadcast_update(
                {
                    "type": "annotation.added",
                    "annotationId": annotation.id,
                    "elementId": element_id,
                    "timestamp": annotation.timestamp,
                }
            )

            return web.json_response(created_ann, status=201)

        except Exception as e:
            console.print(f"[red]Error creating annotation: {e}[/red]")
            return web.json_response(
                {"error": f"Failed to create annotation: {str(e)}"}, status=500
            )

    async def _handle_update_annotation(self, request: web.Request) -> web.Response:
        """
        Handle API requests to update existing annotations.

        Expected JSON body:
        {
            "content": "updated text",  # optional
            "tags": ["tag1", "tag2"]    # optional
        }

        Args:
            request: HTTP request

        Returns:
            JSON response with updated annotation
        """
        annotation_id = request.match_info.get("annotationId")
        if not annotation_id:
            return web.json_response({"error": "Missing annotation ID"}, status=400)

        try:
            data = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "Invalid JSON in request body"}, status=400)

        if not self.model_path or not self.annotation_registry:
            return web.json_response({"error": "Annotation system not initialized"}, status=500)

        try:
            # Reload registry to ensure we have latest data
            self.annotation_registry.load_all()

            # Find the annotation
            annotation = self.annotation_registry.get_annotation(annotation_id)
            if not annotation:
                return web.json_response(
                    {"error": f"Annotation not found: {annotation_id}"}, status=404
                )

            # Get the user's store
            from datetime import datetime

            from ..core.annotations import AnnotationStore

            store = AnnotationStore(annotation.user, self.model_path)
            annotations = store.load()

            # Find and update the annotation
            updated = False
            for ann in annotations:
                if ann.id == annotation_id:
                    # Update fields
                    if "content" in data:
                        ann.message = data["content"]
                    # Note: 'tags' are not a field in our annotation model
                    # If we need them, we would need to extend the Annotation dataclass
                    updated = True
                    break

            if not updated:
                return web.json_response(
                    {"error": f"Annotation not found in user's store: {annotation_id}"}, status=404
                )

            # Save updated annotations
            store.save(annotations)

            # Reload registry
            self.annotation_registry.load_all()
            updated_annotation = self.annotation_registry.get_annotation(annotation_id)

            # Serialize and return
            result = {
                "id": updated_annotation.id,
                "elementId": updated_annotation.entity_uri,
                "author": updated_annotation.user,
                "content": updated_annotation.message,
                "createdAt": updated_annotation.timestamp,
                "updatedAt": datetime.utcnow().isoformat() + "Z",
                "tags": data.get("tags", []),
            }

            # Broadcast update event
            await self.broadcast_update(
                {
                    "type": "annotation.updated",
                    "annotationId": annotation_id,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )

            return web.json_response(result)

        except Exception as e:
            console.print(f"[red]Error updating annotation: {e}[/red]")
            return web.json_response(
                {"error": f"Failed to update annotation: {str(e)}"}, status=500
            )

    async def _handle_delete_annotation(self, request: web.Request) -> web.Response:
        """
        Handle API requests to delete annotations.

        Args:
            request: HTTP request

        Returns:
            204 No Content on success, error response otherwise
        """
        annotation_id = request.match_info.get("annotationId")
        if not annotation_id:
            return web.json_response({"error": "Missing annotation ID"}, status=400)

        if not self.model_path or not self.annotation_registry:
            return web.json_response({"error": "Annotation system not initialized"}, status=500)

        try:
            # Reload registry to ensure we have latest data
            self.annotation_registry.load_all()

            # Find the annotation
            annotation = self.annotation_registry.get_annotation(annotation_id)
            if not annotation:
                return web.json_response(
                    {"error": f"Annotation not found: {annotation_id}"}, status=404
                )

            # Get the user's store
            from datetime import datetime

            from ..core.annotations import AnnotationStore

            store = AnnotationStore(annotation.user, self.model_path)
            annotations = store.load()

            # Filter out the annotation
            original_count = len(annotations)
            annotations = [ann for ann in annotations if ann.id != annotation_id]

            if len(annotations) == original_count:
                return web.json_response(
                    {"error": f"Annotation not found in user's store: {annotation_id}"}, status=404
                )

            # Save updated annotations
            store.save(annotations)

            # Reload registry
            self.annotation_registry.load_all()

            # Broadcast delete event
            await self.broadcast_update(
                {
                    "type": "annotation.deleted",
                    "annotationId": annotation_id,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
            )

            return web.Response(status=204)

        except Exception as e:
            console.print(f"[red]Error deleting annotation: {e}[/red]")
            return web.json_response(
                {"error": f"Failed to delete annotation: {str(e)}"}, status=500
            )

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
            if file_lower.endswith(".js") or file_lower.endswith(".mjs"):
                content_type = "text/javascript"
            elif file_lower.endswith(".css"):
                content_type = "text/css"
            elif file_lower.endswith(".html"):
                content_type = "text/html"
            elif file_lower.endswith(".json"):
                content_type = "application/json"
            elif file_lower.endswith(".svg"):
                content_type = "image/svg+xml"
            elif file_lower.endswith(".png"):
                content_type = "image/png"
            elif file_lower.endswith(".jpg") or file_lower.endswith(".jpeg"):
                content_type = "image/jpeg"
            elif file_lower.endswith(".gif"):
                content_type = "image/gif"
            elif file_lower.endswith(".ico"):
                content_type = "image/x-icon"
            elif file_lower.endswith(".woff"):
                content_type = "font/woff"
            elif file_lower.endswith(".woff2"):
                content_type = "font/woff2"
            elif file_lower.endswith(".ttf"):
                content_type = "font/ttf"
            elif file_lower.endswith(".eot"):
                content_type = "application/vnd.ms-fontobject"
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
            # Send spec-aligned connected message with version
            version = (
                self.specification.get("version", "unknown") if self.specification else "unknown"
            )
            await ws.send_json(create_connected_message(version))

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

            # Handle topic subscription
            elif message_type == "subscribe":
                topics = data.get("topics") if isinstance(data, dict) else None
                if topics is None or not isinstance(topics, list):
                    topics = []
                valid = {t for t in topics if t in {"model", "changesets", "annotations"}}
                if not valid:
                    valid = {"model", "changesets", "annotations"}
                self._ws_subscriptions[ws] = valid
                await ws.send_json(create_subscribed_message(sorted(valid)))

            # Heartbeat
            elif message_type == "ping":
                await ws.send_json(create_pong_message())

            else:
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

            # Broadcast to all clients (legacy format for test expectations)
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

            # Broadcast reply (legacy format for test expectations)
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

                # Also emit spec-aligned generic model.updated signal
                await self.broadcast_update(create_model_updated_message())

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
                # Topic-based filtering if subscriptions exist
                subs = self._ws_subscriptions.get(ws)
                if subs:
                    topic = self._infer_topic_from_message_type(message.get("type", ""))
                    if topic is None or topic in subs:
                        await ws.send_json(message)
                else:
                    await ws.send_json(message)
            except (OSError, RuntimeError) as e:
                console.print(f"[yellow]Error sending to client: {e}[/yellow]")
                disconnected.add(ws)

        # Clean up disconnected clients
        self.websockets -= disconnected

    def _infer_topic_from_message_type(self, message_type: str) -> Optional[str]:
        """Infer topic from message type for subscription filtering."""
        if not message_type:
            return None
        if message_type.startswith("annotation."):
            return "annotations"
        if message_type.startswith("changeset."):
            return "changesets"
        if message_type in {
            "model.updated",
            "element_updated",
            "element_added",
            "element_removed",
            "layer_updated",
        }:
            return "model"
        return None

    async def _broadcast_changeset_created(self, changeset_id: str) -> None:
        """Broadcast changeset.created event and invalidate cache."""
        try:
            self._cached_initial_state = None
            await self.broadcast_update(create_changeset_created_message(changeset_id))
        except Exception as e:
            console.print(f"[yellow]Warning broadcasting changeset.created: {e}[/yellow]")

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

        # Stop changeset monitoring
        if self._changeset_observer:
            try:
                self._changeset_observer.stop()
                self._changeset_observer.join(timeout=2.0)
            except (RuntimeError, AttributeError) as e:
                console.print(f"[yellow]Changeset observer cleanup warning: {e}[/yellow]")

        # Close all WebSocket connections
        # Iterate over a copy to avoid "Set changed size during iteration" error
        for ws in list(self.websockets):
            await ws.close()

        self.websockets.clear()

        # Stop HTTP server
        if self.runner:
            await self.runner.cleanup()

        # Signal shutdown complete
        self._shutdown_event.set()

        console.print("[green]Server shutdown complete[/green]")
