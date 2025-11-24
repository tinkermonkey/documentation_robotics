"""
Multi-channel navigation support for the Navigation Layer.

This module provides support for defining and managing navigation routes
across multiple channels (web/visual, voice, chat, SMS) as specified in
the Navigation Layer schema.
"""

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml


class RouteType(str, Enum):
    """Type of route."""

    EXPERIENCE = "experience"
    REDIRECT = "redirect"
    EXTERNAL = "external"


class NavigationChannel(str, Enum):
    """Supported navigation channels."""

    WEB = "web"  # URL-based routing
    VOICE = "voice"  # Intent-based routing
    CHAT = "chat"  # Event-based routing
    SMS = "sms"  # Keyword-based routing


class GuardType(str, Enum):
    """Type of navigation guard."""

    AUTHENTICATION = "authentication"
    AUTHORIZATION = "authorization"
    VALIDATION = "validation"
    DATA_LOADED = "data-loaded"
    CUSTOM = "custom"


class GuardAction(str, Enum):
    """Action to take when guard denies access."""

    REDIRECT = "redirect"
    SHOW_ERROR = "show-error"
    NAVIGATE_BACK = "navigate-back"
    ABORT = "abort"


@dataclass
class ChannelAddressing:
    """
    Channel-specific addressing for a route.

    Supports multiple channels:
    - URL pattern for web (e.g., /products/:id)
    - Intent name for voice (e.g., "ShowProductDetail")
    - Event name for chat (e.g., "product.detail.requested")
    - Keyword for SMS (e.g., "PRODUCT")
    """

    url: Optional[str] = None
    intent: Optional[str] = None
    event: Optional[str] = None
    keyword: Optional[str] = None

    def get_channels(self) -> Set[NavigationChannel]:
        """Get set of channels this route supports."""
        channels = set()
        if self.url:
            channels.add(NavigationChannel.WEB)
        if self.intent:
            channels.add(NavigationChannel.VOICE)
        if self.event:
            channels.add(NavigationChannel.CHAT)
        if self.keyword:
            channels.add(NavigationChannel.SMS)
        return channels

    def has_channel(self, channel: NavigationChannel) -> bool:
        """Check if route supports a specific channel."""
        return channel in self.get_channels()

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChannelAddressing":
        """Create from dictionary."""
        return cls(
            url=data.get("url"),
            intent=data.get("intent"),
            event=data.get("event"),
            keyword=data.get("keyword"),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result = {}
        if self.url:
            result["url"] = self.url
        if self.intent:
            result["intent"] = self.intent
        if self.event:
            result["event"] = self.event
        if self.keyword:
            result["keyword"] = self.keyword
        return result


@dataclass
class RouteMeta:
    """Metadata for a route (auth, layout, SEO, analytics)."""

    requires_auth: bool = False
    roles: List[str] = field(default_factory=list)
    permissions: List[str] = field(default_factory=list)
    layout: Optional[str] = None
    keep_alive: bool = False
    transition: Optional[str] = None
    seo: Dict[str, Any] = field(default_factory=dict)
    analytics: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RouteMeta":
        """Create from dictionary."""
        return cls(
            requires_auth=data.get("requiresAuth", False),
            roles=data.get("roles", []),
            permissions=data.get("permissions", []),
            layout=data.get("layout"),
            keep_alive=data.get("keepAlive", False),
            transition=data.get("transition"),
            seo=data.get("seo", {}),
            analytics=data.get("analytics", {}),
        )


@dataclass
class Route:
    """
    A navigation route that can be accessed through multiple channels.
    """

    identifier: str
    name: str
    route_type: RouteType
    title: Optional[str] = None
    description: Optional[str] = None
    experience: Optional[str] = None  # UX spec reference
    archimate_ref: Optional[str] = None
    guards: List[str] = field(default_factory=list)
    parent: Optional[str] = None  # For nested routes
    redirect_to: Optional[str] = None  # For redirects
    addressing: Optional[ChannelAddressing] = None
    meta: Optional[RouteMeta] = None

    def __post_init__(self):
        """Validate route after initialization."""
        if self.addressing is None:
            self.addressing = ChannelAddressing()

    def get_url_pattern(self) -> Optional[str]:
        """Get URL pattern for web channel."""
        return self.addressing.url if self.addressing else None

    def get_intent_name(self) -> Optional[str]:
        """Get intent name for voice channel."""
        return self.addressing.intent if self.addressing else None

    def get_event_name(self) -> Optional[str]:
        """Get event name for chat channel."""
        return self.addressing.event if self.addressing else None

    def get_keyword(self) -> Optional[str]:
        """Get keyword for SMS channel."""
        return self.addressing.keyword if self.addressing else None

    def supports_channel(self, channel: NavigationChannel) -> bool:
        """Check if route supports a specific channel."""
        return self.addressing.has_channel(channel) if self.addressing else False

    def get_supported_channels(self) -> Set[NavigationChannel]:
        """Get all channels this route supports."""
        return self.addressing.get_channels() if self.addressing else set()

    def is_multi_channel(self) -> bool:
        """Check if route supports multiple channels."""
        return len(self.get_supported_channels()) > 1

    def requires_authentication(self) -> bool:
        """Check if route requires authentication."""
        return (self.meta and self.meta.requires_auth) or "authenticated" in self.guards

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Route":
        """Create route from dictionary."""
        route_type = RouteType(data.get("type", "experience"))
        addressing = None
        if "addressing" in data:
            addressing = ChannelAddressing.from_dict(data["addressing"])

        meta = None
        if "meta" in data:
            meta = RouteMeta.from_dict(data["meta"])

        return cls(
            identifier=data["identifier"],
            name=data["name"],
            route_type=route_type,
            title=data.get("title"),
            description=data.get("description"),
            experience=data.get("experience"),
            archimate_ref=data.get("archimateRef"),
            guards=data.get("guards", []),
            parent=data.get("parent"),
            redirect_to=data.get("redirectTo"),
            addressing=addressing,
            meta=meta,
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert route to dictionary."""
        result = {"identifier": self.identifier, "name": self.name, "type": self.route_type.value}

        if self.title:
            result["title"] = self.title
        if self.description:
            result["description"] = self.description
        if self.experience:
            result["experience"] = self.experience
        if self.archimate_ref:
            result["archimateRef"] = self.archimate_ref
        if self.guards:
            result["guards"] = self.guards
        if self.parent:
            result["parent"] = self.parent
        if self.redirect_to:
            result["redirectTo"] = self.redirect_to
        if self.addressing:
            result["addressing"] = self.addressing.to_dict()

        return result


@dataclass
class NavigationGuard:
    """A guard that controls access to routes."""

    name: str
    guard_type: GuardType
    condition_expression: str
    on_deny_action: GuardAction
    description: Optional[str] = None
    order: int = 0
    is_async: bool = False
    timeout_ms: Optional[int] = None
    deny_target: Optional[str] = None  # Route to redirect to on deny
    deny_message: Optional[str] = None
    preserve_route: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NavigationGuard":
        """Create guard from dictionary."""
        condition = data.get("condition", {})
        on_deny = data.get("onDeny", {})

        return cls(
            name=data["name"],
            guard_type=GuardType(data.get("type", "custom")),
            condition_expression=condition.get("expression", ""),
            on_deny_action=GuardAction(on_deny.get("action", "abort")),
            description=data.get("description"),
            order=data.get("order", 0),
            is_async=condition.get("async", False),
            timeout_ms=condition.get("timeout"),
            deny_target=on_deny.get("target"),
            deny_message=on_deny.get("message"),
            preserve_route=on_deny.get("preserveRoute", False),
        )


@dataclass
class NavigationTransition:
    """A transition between two routes."""

    from_route: str
    to_route: str
    trigger: str
    description: Optional[str] = None
    guards: List[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NavigationTransition":
        """Create transition from dictionary."""
        return cls(
            from_route=data["from"],
            to_route=data["to"],
            trigger=data["trigger"],
            description=data.get("description"),
            guards=data.get("guards", []),
        )


@dataclass
class NavigationFlow:
    """A navigation flow that realizes business processes."""

    name: str
    steps: List[Dict[str, Any]]
    description: Optional[str] = None
    realizes_process: Optional[str] = None
    realizes_services: List[str] = field(default_factory=list)
    shared_context: List[Dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NavigationFlow":
        """Create flow from dictionary."""
        business = data.get("business", {})
        return cls(
            name=data["name"],
            steps=data.get("steps", []),
            description=data.get("description"),
            realizes_process=business.get("realizesProcess"),
            realizes_services=business.get("realizesServices", []),
            shared_context=data.get("sharedContext", []),
        )


class NavigationGraph:
    """
    Complete navigation structure for an application.
    Supports multi-channel routing.
    """

    def __init__(
        self,
        version: str,
        application: str,
        description: Optional[str] = None,
        archimate_element: Optional[str] = None,
    ):
        self.version = version
        self.application = application
        self.description = description
        self.archimate_element = archimate_element
        self.routes: Dict[str, Route] = {}
        self.guards: Dict[str, NavigationGuard] = {}
        self.transitions: List[NavigationTransition] = []
        self.flows: Dict[str, NavigationFlow] = {}

    def add_route(self, route: Route) -> None:
        """Add a route to the navigation graph."""
        self.routes[route.identifier] = route

    def get_route(self, identifier: str) -> Optional[Route]:
        """Get a route by identifier."""
        return self.routes.get(identifier)

    def add_guard(self, guard: NavigationGuard) -> None:
        """Add a navigation guard."""
        self.guards[guard.name] = guard

    def get_guard(self, name: str) -> Optional[NavigationGuard]:
        """Get a guard by name."""
        return self.guards.get(name)

    def add_transition(self, transition: NavigationTransition) -> None:
        """Add a navigation transition."""
        self.transitions.append(transition)

    def add_flow(self, flow: NavigationFlow) -> None:
        """Add a navigation flow."""
        self.flows[flow.name] = flow

    def get_routes_for_channel(self, channel: NavigationChannel) -> List[Route]:
        """Get all routes that support a specific channel."""
        return [route for route in self.routes.values() if route.supports_channel(channel)]

    def get_multi_channel_routes(self) -> List[Route]:
        """Get all routes that support multiple channels."""
        return [route for route in self.routes.values() if route.is_multi_channel()]

    def get_authenticated_routes(self) -> List[Route]:
        """Get all routes that require authentication."""
        return [route for route in self.routes.values() if route.requires_authentication()]

    def get_nested_routes(self, parent_identifier: str) -> List[Route]:
        """Get all child routes of a parent route."""
        return [route for route in self.routes.values() if route.parent == parent_identifier]

    def validate_references(self) -> List[str]:
        """
        Validate all references in the navigation graph.
        Returns list of validation errors.
        """
        errors = []

        # Validate route references
        for route in self.routes.values():
            # Check parent exists
            if route.parent and route.parent not in self.routes:
                errors.append(
                    f"Route '{route.identifier}' references non-existent parent '{route.parent}'"
                )

            # Check redirect target exists
            if route.redirect_to and route.redirect_to not in self.routes:
                errors.append(
                    f"Route '{route.identifier}' redirects to non-existent route '{route.redirect_to}'"
                )

            # Check guards exist
            for guard_name in route.guards:
                if guard_name not in self.guards:
                    errors.append(
                        f"Route '{route.identifier}' references non-existent guard '{guard_name}'"
                    )

        # Validate transitions
        for transition in self.transitions:
            if transition.from_route not in self.routes:
                errors.append(
                    f"Transition references non-existent source route '{transition.from_route}'"
                )
            if transition.to_route not in self.routes:
                errors.append(
                    f"Transition references non-existent target route '{transition.to_route}'"
                )
            for guard_name in transition.guards:
                if guard_name not in self.guards:
                    errors.append(f"Transition references non-existent guard '{guard_name}'")

        # Validate flows
        for flow in self.flows.values():
            for step in flow.steps:
                route_id = step.get("route")
                if route_id and route_id not in self.routes:
                    errors.append(
                        f"Flow '{flow.name}' step references non-existent route '{route_id}'"
                    )

        return errors

    @classmethod
    def from_yaml(cls, file_path: Path) -> "NavigationGraph":
        """Load navigation graph from YAML file."""
        with open(file_path, "r") as f:
            data = yaml.safe_load(f)

        graph = cls(
            version=data["version"],
            application=data["application"],
            description=data.get("description"),
            archimate_element=data.get("archimateElement"),
        )

        # Load routes
        for route_data in data.get("routes", []):
            route = Route.from_dict(route_data)
            graph.add_route(route)

        # Load guards
        for guard_data in data.get("guards", []):
            guard = NavigationGuard.from_dict(guard_data)
            graph.add_guard(guard)

        # Load transitions
        for transition_data in data.get("transitions", []):
            transition = NavigationTransition.from_dict(transition_data)
            graph.add_transition(transition)

        # Load flows
        for flow_data in data.get("flows", []):
            flow = NavigationFlow.from_dict(flow_data)
            graph.add_flow(flow)

        return graph

    def to_dict(self) -> Dict[str, Any]:
        """Convert navigation graph to dictionary."""
        result = {
            "version": self.version,
            "application": self.application,
            "routes": [route.to_dict() for route in self.routes.values()],
        }

        if self.description:
            result["description"] = self.description
        if self.archimate_element:
            result["archimateElement"] = self.archimate_element
        if self.guards:
            result["guards"] = [
                {
                    "name": guard.name,
                    "type": guard.guard_type.value,
                    "description": guard.description,
                    "order": guard.order,
                    "condition": {
                        "expression": guard.condition_expression,
                        "async": guard.is_async,
                        **({"timeout": guard.timeout_ms} if guard.timeout_ms else {}),
                    },
                    "onDeny": {
                        "action": guard.on_deny_action.value,
                        **({"target": guard.deny_target} if guard.deny_target else {}),
                        **({"message": guard.deny_message} if guard.deny_message else {}),
                        "preserveRoute": guard.preserve_route,
                    },
                }
                for guard in self.guards.values()
            ]
        if self.transitions:
            result["transitions"] = [
                {
                    "from": t.from_route,
                    "to": t.to_route,
                    "trigger": t.trigger,
                    **({"description": t.description} if t.description else {}),
                    **({"guards": t.guards} if t.guards else {}),
                }
                for t in self.transitions
            ]

        return result

    def to_yaml(self, file_path: Path) -> None:
        """Save navigation graph to YAML file."""
        with open(file_path, "w") as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False, sort_keys=False)


class URLPatternValidator:
    """Validates URL patterns for web routes."""

    # Valid URL pattern: /path/:param/*wildcard
    URL_PATTERN_REGEX = re.compile(r"^/[a-zA-Z0-9\-_/:*]*$")
    PARAM_REGEX = re.compile(r":([a-zA-Z0-9_]+)")
    WILDCARD_REGEX = re.compile(r"\*")

    @classmethod
    def validate(cls, url_pattern: str) -> List[str]:
        """
        Validate URL pattern.
        Returns list of validation errors.
        """
        errors = []

        if not url_pattern:
            return errors

        if not url_pattern.startswith("/"):
            errors.append("URL pattern must start with '/'")

        if not cls.URL_PATTERN_REGEX.match(url_pattern):
            errors.append(f"Invalid URL pattern format: {url_pattern}")

        # Check for multiple wildcards
        wildcards = cls.WILDCARD_REGEX.findall(url_pattern)
        if len(wildcards) > 1:
            errors.append("URL pattern can have at most one wildcard (*)")

        # Check wildcard is at the end
        if wildcards and not url_pattern.endswith("*"):
            errors.append("Wildcard (*) must be at the end of the pattern")

        return errors

    @classmethod
    def extract_params(cls, url_pattern: str) -> List[str]:
        """Extract parameter names from URL pattern."""
        return cls.PARAM_REGEX.findall(url_pattern)


class RouteGenerator:
    """Generates route definitions for different channels/frameworks."""

    @staticmethod
    def generate_react_router_routes(graph: NavigationGraph) -> str:
        """Generate React Router v6 route definitions."""
        lines = [
            "// Generated React Router routes",
            "import { Routes, Route } from 'react-router-dom';",
            "",
        ]

        web_routes = graph.get_routes_for_channel(NavigationChannel.WEB)

        lines.append("export const AppRoutes = () => (")
        lines.append("  <Routes>")

        for route in web_routes:
            if route.route_type == RouteType.EXPERIENCE and route.get_url_pattern():
                component_name = route.identifier.replace("-", "_").title().replace("_", "")
                lines.append(
                    f'    <Route path="{route.get_url_pattern()}" element={{<{component_name} />}} />'
                )

        lines.append("  </Routes>")
        lines.append(");")

        return "\n".join(lines)

    @staticmethod
    def generate_voice_intents(graph: NavigationGraph) -> Dict[str, Any]:
        """Generate voice intent definitions (Alexa/Google Assistant format)."""
        voice_routes = graph.get_routes_for_channel(NavigationChannel.VOICE)

        intents = {}
        for route in voice_routes:
            intent_name = route.get_intent_name()
            if intent_name:
                intents[intent_name] = {
                    "name": intent_name,
                    "slots": [],  # Could extract from route parameters
                    "samples": [
                        f"Show me {route.name.lower()}",
                        f"I want to see {route.name.lower()}",
                    ],
                }

        return intents

    @staticmethod
    def generate_chat_event_handlers(graph: NavigationGraph) -> str:
        """Generate chat event handler definitions."""
        chat_routes = graph.get_routes_for_channel(NavigationChannel.CHAT)

        lines = ["// Generated chat event handlers", ""]

        for route in chat_routes:
            event_name = route.get_event_name()
            if event_name:
                handler_name = event_name.replace(".", "_")
                lines.append(f"chatbot.on('{event_name}', async (context) => {{")
                lines.append(f"  // Navigate to {route.name}")
                lines.append(f"  return await handle{handler_name.title()}(context);")
                lines.append("});")
                lines.append("")

        return "\n".join(lines)
