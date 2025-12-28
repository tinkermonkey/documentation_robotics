"""
Tests for multi-channel navigation support.
"""

from documentation_robotics.core.navigation import (
    ChannelAddressing,
    GuardAction,
    GuardType,
    NavigationChannel,
    NavigationGraph,
    NavigationGuard,
    Route,
    RouteGenerator,
    RouteMeta,
    RouteType,
    URLPatternValidator,
)


class TestChannelAddressing:
    """Test multi-channel addressing."""

    def test_single_channel_web(self):
        addressing = ChannelAddressing(url="/products")
        assert addressing.has_channel(NavigationChannel.WEB)
        assert not addressing.has_channel(NavigationChannel.VOICE)
        assert len(addressing.get_channels()) == 1

    def test_multi_channel(self):
        addressing = ChannelAddressing(
            url="/products/:id", intent="ShowProductDetail", event="product.detail.requested"
        )
        assert addressing.has_channel(NavigationChannel.WEB)
        assert addressing.has_channel(NavigationChannel.VOICE)
        assert addressing.has_channel(NavigationChannel.CHAT)
        assert not addressing.has_channel(NavigationChannel.SMS)
        assert len(addressing.get_channels()) == 3

    def test_all_channels(self):
        addressing = ChannelAddressing(
            url="/status", intent="CheckStatus", event="status.requested", keyword="STATUS"
        )
        assert len(addressing.get_channels()) == 4
        assert addressing.has_channel(NavigationChannel.WEB)
        assert addressing.has_channel(NavigationChannel.VOICE)
        assert addressing.has_channel(NavigationChannel.CHAT)
        assert addressing.has_channel(NavigationChannel.SMS)

    def test_to_dict(self):
        addressing = ChannelAddressing(url="/test", intent="TestIntent")
        data = addressing.to_dict()
        assert data["url"] == "/test"
        assert data["intent"] == "TestIntent"
        assert "event" not in data
        assert "keyword" not in data

    def test_from_dict(self):
        data = {"url": "/products", "intent": "ShowProducts", "event": "products.requested"}
        addressing = ChannelAddressing.from_dict(data)
        assert addressing.url == "/products"
        assert addressing.intent == "ShowProducts"
        assert addressing.event == "products.requested"
        assert addressing.keyword is None


class TestRoute:
    """Test navigation route."""

    def test_basic_route(self):
        route = Route(
            identifier="product-list",
            name="Product List",
            route_type=RouteType.EXPERIENCE,
            addressing=ChannelAddressing(url="/products"),
        )
        assert route.identifier == "product-list"
        assert route.name == "Product List"
        assert route.get_url_pattern() == "/products"

    def test_multi_channel_route(self):
        addressing = ChannelAddressing(
            url="/products/:id", intent="ShowProduct", event="product.requested"
        )
        route = Route(
            identifier="product-detail",
            name="Product Detail",
            route_type=RouteType.EXPERIENCE,
            addressing=addressing,
        )
        assert route.supports_channel(NavigationChannel.WEB)
        assert route.supports_channel(NavigationChannel.VOICE)
        assert route.supports_channel(NavigationChannel.CHAT)
        assert route.is_multi_channel()
        assert route.get_url_pattern() == "/products/:id"
        assert route.get_intent_name() == "ShowProduct"
        assert route.get_event_name() == "product.requested"

    def test_nested_route(self):
        route = Route(
            identifier="product-edit",
            name="Edit Product",
            route_type=RouteType.EXPERIENCE,
            parent="product-detail",
            addressing=ChannelAddressing(url="/products/:id/edit"),
        )
        assert route.parent == "product-detail"

    def test_route_with_guards(self):
        route = Route(
            identifier="admin-panel",
            name="Admin Panel",
            route_type=RouteType.EXPERIENCE,
            guards=["authenticated", "is-admin"],
            addressing=ChannelAddressing(url="/admin"),
        )
        assert "authenticated" in route.guards
        assert "is-admin" in route.guards

    def test_route_with_meta(self):
        meta = RouteMeta(requires_auth=True, roles=["admin"], layout="admin-layout")
        route = Route(
            identifier="admin-panel",
            name="Admin Panel",
            route_type=RouteType.EXPERIENCE,
            meta=meta,
            addressing=ChannelAddressing(url="/admin"),
        )
        assert route.requires_authentication()
        assert route.meta.roles == ["admin"]

    def test_redirect_route(self):
        route = Route(
            identifier="home",
            name="Home",
            route_type=RouteType.REDIRECT,
            redirect_to="product-list",
            addressing=ChannelAddressing(url="/"),
        )
        assert route.route_type == RouteType.REDIRECT
        assert route.redirect_to == "product-list"

    def test_from_dict(self):
        data = {
            "identifier": "test-route",
            "name": "Test Route",
            "type": "experience",
            "title": "Test",
            "addressing": {"url": "/test", "intent": "TestIntent"},
            "guards": ["authenticated"],
        }
        route = Route.from_dict(data)
        assert route.identifier == "test-route"
        assert route.name == "Test Route"
        assert route.title == "Test"
        assert route.get_url_pattern() == "/test"
        assert route.get_intent_name() == "TestIntent"
        assert "authenticated" in route.guards

    def test_to_dict(self):
        addressing = ChannelAddressing(url="/test", intent="TestIntent")
        route = Route(
            identifier="test-route",
            name="Test Route",
            route_type=RouteType.EXPERIENCE,
            addressing=addressing,
            guards=["authenticated"],
        )
        data = route.to_dict()
        assert data["identifier"] == "test-route"
        assert data["name"] == "Test Route"
        assert data["type"] == "experience"
        assert data["addressing"]["url"] == "/test"
        assert data["addressing"]["intent"] == "TestIntent"
        assert data["guards"] == ["authenticated"]


class TestNavigationGuard:
    """Test navigation guards."""

    def test_authentication_guard(self):
        data = {
            "name": "authenticated",
            "type": "authentication",
            "condition": {"expression": "user.isAuthenticated()"},
            "onDeny": {"action": "redirect", "target": "login"},
        }
        guard = NavigationGuard.from_dict(data)
        assert guard.name == "authenticated"
        assert guard.guard_type == GuardType.AUTHENTICATION
        assert guard.condition_expression == "user.isAuthenticated()"
        assert guard.on_deny_action == GuardAction.REDIRECT
        assert guard.deny_target == "login"

    def test_authorization_guard(self):
        data = {
            "name": "is-admin",
            "type": "authorization",
            "condition": {"expression": "user.hasRole('admin')"},
            "onDeny": {"action": "show-error", "message": "Access denied"},
        }
        guard = NavigationGuard.from_dict(data)
        assert guard.guard_type == GuardType.AUTHORIZATION
        assert guard.deny_message == "Access denied"

    def test_async_guard(self):
        data = {
            "name": "data-loaded",
            "type": "data-loaded",
            "condition": {"expression": "await loadData()", "async": True, "timeout": 5000},
            "onDeny": {"action": "abort"},
        }
        guard = NavigationGuard.from_dict(data)
        assert guard.is_async
        assert guard.timeout_ms == 5000


class TestNavigationGraph:
    """Test navigation graph."""

    def test_create_graph(self):
        graph = NavigationGraph(
            version="0.1.0", application="test-app", description="Test navigation"
        )
        assert graph.version == "0.1.0"
        assert graph.application == "test-app"
        assert len(graph.routes) == 0

    def test_add_route(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")
        route = Route(
            identifier="home",
            name="Home",
            route_type=RouteType.EXPERIENCE,
            addressing=ChannelAddressing(url="/"),
        )
        graph.add_route(route)
        assert len(graph.routes) == 1
        assert graph.get_route("home") == route

    def test_add_guard(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")
        guard_data = {
            "name": "authenticated",
            "type": "authentication",
            "condition": {"expression": "user.isAuthenticated()"},
            "onDeny": {"action": "redirect", "target": "login"},
        }
        guard = NavigationGuard.from_dict(guard_data)
        graph.add_guard(guard)
        assert len(graph.guards) == 1
        assert graph.get_guard("authenticated") == guard

    def test_get_routes_for_channel(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        # Web-only route
        graph.add_route(
            Route(
                identifier="web-only",
                name="Web Only",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/web"),
            )
        )

        # Voice-only route
        graph.add_route(
            Route(
                identifier="voice-only",
                name="Voice Only",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(intent="VoiceIntent"),
            )
        )

        # Multi-channel route
        graph.add_route(
            Route(
                identifier="multi",
                name="Multi",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/multi", intent="MultiIntent"),
            )
        )

        web_routes = graph.get_routes_for_channel(NavigationChannel.WEB)
        assert len(web_routes) == 2  # web-only and multi

        voice_routes = graph.get_routes_for_channel(NavigationChannel.VOICE)
        assert len(voice_routes) == 2  # voice-only and multi

    def test_get_multi_channel_routes(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        # Single channel
        graph.add_route(
            Route(
                identifier="single",
                name="Single",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/single"),
            )
        )

        # Multi-channel
        graph.add_route(
            Route(
                identifier="multi",
                name="Multi",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/multi", intent="MultiIntent"),
            )
        )

        multi_routes = graph.get_multi_channel_routes()
        assert len(multi_routes) == 1
        assert multi_routes[0].identifier == "multi"

    def test_get_authenticated_routes(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        # Public route
        graph.add_route(
            Route(
                identifier="public",
                name="Public",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/public"),
            )
        )

        # Authenticated route
        meta = RouteMeta(requires_auth=True)
        graph.add_route(
            Route(
                identifier="private",
                name="Private",
                route_type=RouteType.EXPERIENCE,
                meta=meta,
                addressing=ChannelAddressing(url="/private"),
            )
        )

        auth_routes = graph.get_authenticated_routes()
        assert len(auth_routes) == 1
        assert auth_routes[0].identifier == "private"

    def test_get_nested_routes(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        # Parent route
        graph.add_route(
            Route(
                identifier="products",
                name="Products",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/products"),
            )
        )

        # Child routes
        graph.add_route(
            Route(
                identifier="product-detail",
                name="Product Detail",
                route_type=RouteType.EXPERIENCE,
                parent="products",
                addressing=ChannelAddressing(url="/products/:id"),
            )
        )

        graph.add_route(
            Route(
                identifier="product-edit",
                name="Product Edit",
                route_type=RouteType.EXPERIENCE,
                parent="products",
                addressing=ChannelAddressing(url="/products/:id/edit"),
            )
        )

        nested = graph.get_nested_routes("products")
        assert len(nested) == 2
        assert all(r.parent == "products" for r in nested)

    def test_validate_references_valid(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        # Add guard
        guard_data = {
            "name": "authenticated",
            "type": "authentication",
            "condition": {"expression": "user.isAuthenticated()"},
            "onDeny": {"action": "redirect", "target": "login"},
        }
        graph.add_guard(NavigationGuard.from_dict(guard_data))

        # Add routes
        graph.add_route(
            Route(
                identifier="login",
                name="Login",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/login"),
            )
        )

        graph.add_route(
            Route(
                identifier="products",
                name="Products",
                route_type=RouteType.EXPERIENCE,
                guards=["authenticated"],
                addressing=ChannelAddressing(url="/products"),
            )
        )

        errors = graph.validate_references()
        assert len(errors) == 0

    def test_validate_references_invalid(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        # Route with non-existent guard
        graph.add_route(
            Route(
                identifier="products",
                name="Products",
                route_type=RouteType.EXPERIENCE,
                guards=["non-existent-guard"],
                addressing=ChannelAddressing(url="/products"),
            )
        )

        # Route with non-existent parent
        graph.add_route(
            Route(
                identifier="product-edit",
                name="Edit Product",
                route_type=RouteType.EXPERIENCE,
                parent="non-existent-parent",
                addressing=ChannelAddressing(url="/products/:id/edit"),
            )
        )

        # Redirect to non-existent route
        graph.add_route(
            Route(
                identifier="home",
                name="Home",
                route_type=RouteType.REDIRECT,
                redirect_to="non-existent-route",
                addressing=ChannelAddressing(url="/"),
            )
        )

        errors = graph.validate_references()
        assert len(errors) == 3


class TestURLPatternValidator:
    """Test URL pattern validation."""

    def test_valid_simple_path(self):
        errors = URLPatternValidator.validate("/products")
        assert len(errors) == 0

    def test_valid_with_param(self):
        errors = URLPatternValidator.validate("/products/:id")
        assert len(errors) == 0

    def test_valid_with_multiple_params(self):
        errors = URLPatternValidator.validate("/users/:userId/posts/:postId")
        assert len(errors) == 0

    def test_valid_with_wildcard(self):
        errors = URLPatternValidator.validate("/docs/*")
        assert len(errors) == 0

    def test_invalid_no_leading_slash(self):
        errors = URLPatternValidator.validate("products")
        assert len(errors) > 0
        assert any("must start with" in err for err in errors)

    def test_invalid_multiple_wildcards(self):
        errors = URLPatternValidator.validate("/docs/*/files/*")
        assert len(errors) > 0
        assert any("at most one wildcard" in err for err in errors)

    def test_invalid_wildcard_not_at_end(self):
        errors = URLPatternValidator.validate("/docs/*/files")
        assert len(errors) > 0
        assert any("must be at the end" in err for err in errors)

    def test_extract_params(self):
        params = URLPatternValidator.extract_params("/users/:userId/posts/:postId")
        assert params == ["userId", "postId"]

    def test_extract_params_none(self):
        params = URLPatternValidator.extract_params("/products")
        assert params == []


class TestRouteGenerator:
    """Test route generation for different frameworks."""

    def test_generate_react_router_routes(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        graph.add_route(
            Route(
                identifier="home",
                name="Home",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/"),
            )
        )

        graph.add_route(
            Route(
                identifier="products",
                name="Products",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/products"),
            )
        )

        graph.add_route(
            Route(
                identifier="product-detail",
                name="Product Detail",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(url="/products/:id"),
            )
        )

        output = RouteGenerator.generate_react_router_routes(graph)
        assert "import { Routes, Route } from 'react-router-dom'" in output
        assert 'path="/"' in output
        assert 'path="/products"' in output
        assert 'path="/products/:id"' in output

    def test_generate_voice_intents(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        graph.add_route(
            Route(
                identifier="product-search",
                name="Product Search",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(intent="SearchProducts"),
            )
        )

        graph.add_route(
            Route(
                identifier="order-status",
                name="Order Status",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(intent="CheckOrderStatus"),
            )
        )

        intents = RouteGenerator.generate_voice_intents(graph)
        assert "SearchProducts" in intents
        assert "CheckOrderStatus" in intents
        assert intents["SearchProducts"]["name"] == "SearchProducts"

    def test_generate_chat_event_handlers(self):
        graph = NavigationGraph(version="0.1.0", application="test-app")

        graph.add_route(
            Route(
                identifier="product-inquiry",
                name="Product Inquiry",
                route_type=RouteType.EXPERIENCE,
                addressing=ChannelAddressing(event="product.inquiry"),
            )
        )

        output = RouteGenerator.generate_chat_event_handlers(graph)
        assert "chatbot.on('product.inquiry'" in output
        assert "async (context)" in output
