"""Unit tests for DependencyTracker."""

import pytest
from documentation_robotics.core.dependency_tracker import (
    DependencyPath,
    DependencyTracker,
    TraceDirection,
)
from documentation_robotics.core.element import Element
from documentation_robotics.core.reference_registry import ReferenceDefinition


class TestTraceDirection:
    """Tests for TraceDirection enum."""

    def test_direction_values(self):
        """Test TraceDirection enum values."""
        assert TraceDirection.UP.value == "up"
        assert TraceDirection.DOWN.value == "down"
        assert TraceDirection.BOTH.value == "both"


class TestDependencyPath:
    """Tests for DependencyPath dataclass."""

    def test_path_creation(self):
        """Test creating a dependency path."""
        path = DependencyPath(
            source="a",
            target="c",
            path=["a", "b", "c"],
            depth=2,
            relationship_types=["uses", "serves"],
        )

        assert path.source == "a"
        assert path.target == "c"
        assert len(path.path) == 3
        assert path.depth == 2


class TestDependencyTracker:
    """Tests for DependencyTracker."""

    @pytest.fixture
    def model_with_deps(self, initialized_model):
        """Create a model with dependencies."""
        # Add reference definitions to the registry
        initialized_model.reference_registry.reference_definitions.extend(
            [
                ReferenceDefinition(
                    layer="application",
                    element_type="service",
                    property_path="realizes",
                    target_layer="business",
                    target_type="service",
                    reference_type="realization",
                    required=False,
                    cardinality="0..1",
                ),
                ReferenceDefinition(
                    layer="api",
                    element_type="operation",
                    property_path="applicationServiceRef",
                    target_layer="application",
                    target_type="service",
                    reference_type="uses",
                    required=False,
                    cardinality="0..1",
                ),
            ]
        )

        # Business service
        biz_service = Element(
            id="business.service.customer-mgmt",
            element_type="service",
            layer="business",
            data={"name": "Customer Management"},
        )
        initialized_model.add_element("business", biz_service)

        # Application service that realizes business service
        app_service = Element(
            id="application.service.customer-svc",
            element_type="service",
            layer="application",
            data={"name": "Customer Service", "realizes": "business.service.customer-mgmt"},
        )
        initialized_model.add_element("application", app_service)

        # API operation that uses application service
        api_op = Element(
            id="api.operation.get-customer",
            element_type="operation",
            layer="api",
            data={
                "name": "Get Customer",
                "applicationServiceRef": "application.service.customer-svc",
            },
        )
        initialized_model.add_element("api", api_op)

        return initialized_model

    def test_tracker_creation(self, initialized_model):
        """Test creating a dependency tracker."""
        tracker = DependencyTracker(initialized_model)

        assert tracker.model == initialized_model
        assert tracker.registry is not None

    def test_trace_dependencies_down(self, model_with_deps):
        """Test tracing downward dependencies."""
        tracker = DependencyTracker(model_with_deps)

        deps = tracker.trace_dependencies("business.service.customer-mgmt", TraceDirection.DOWN)

        # Should find application service that realizes it
        dep_ids = {d.id for d in deps}
        assert "application.service.customer-svc" in dep_ids

    def test_trace_dependencies_up(self, model_with_deps):
        """Test tracing upward dependencies."""
        tracker = DependencyTracker(model_with_deps)

        deps = tracker.trace_dependencies("api.operation.get-customer", TraceDirection.UP)

        # Should find application service it references
        dep_ids = {d.id for d in deps}
        assert "application.service.customer-svc" in dep_ids

    def test_trace_dependencies_both(self, model_with_deps):
        """Test tracing both directions."""
        tracker = DependencyTracker(model_with_deps)

        deps = tracker.trace_dependencies("application.service.customer-svc", TraceDirection.BOTH)

        dep_ids = {d.id for d in deps}

        # Should find business service (up) and API (down)
        assert "business.service.customer-mgmt" in dep_ids
        assert "api.operation.get-customer" in dep_ids

    def test_trace_dependencies_with_depth(self, model_with_deps):
        """Test tracing with depth limit."""
        tracker = DependencyTracker(model_with_deps)

        # Depth 1 from business service
        deps = tracker.trace_dependencies(
            "business.service.customer-mgmt", TraceDirection.DOWN, max_depth=1
        )

        dep_ids = {d.id for d in deps}

        # Should find app service (depth 1)
        assert "application.service.customer-svc" in dep_ids

        # Should NOT find API (depth 2)
        assert "api.operation.get-customer" not in dep_ids

    def test_trace_nonexistent_element(self, initialized_model):
        """Test tracing nonexistent element."""
        tracker = DependencyTracker(initialized_model)

        deps = tracker.trace_dependencies("nonexistent.element.id", TraceDirection.BOTH)

        assert len(deps) == 0

    def test_get_dependency_layers(self, model_with_deps):
        """Test getting dependencies by layer."""
        tracker = DependencyTracker(model_with_deps)

        by_layer = tracker.get_dependency_layers("business.service.customer-mgmt")

        # Should have dependencies in application and api layers
        assert "application" in by_layer
        assert "application.service.customer-svc" in by_layer["application"]

    def test_get_orphaned_elements(self, initialized_model):
        """Test finding orphaned elements."""
        # Add element with no connections
        orphan = Element(
            id="business.service.orphan",
            element_type="service",
            layer="business",
            data={"name": "Orphan Service"},
        )
        initialized_model.add_element("business", orphan)

        tracker = DependencyTracker(initialized_model)
        orphans = tracker.get_orphaned_elements()

        orphan_ids = {e.id for e in orphans}
        assert "business.service.orphan" in orphan_ids

    def test_get_hub_elements(self, model_with_deps):
        """Test finding hub elements."""
        # Add more connections to make a hub
        for i in range(5):
            elem = Element(
                id=f"api.operation.op-{i}",
                element_type="operation",
                layer="api",
                data={
                    "name": f"Operation {i}",
                    "applicationServiceRef": "application.service.customer-svc",
                },
            )
            model_with_deps.add_element("api", elem)

        tracker = DependencyTracker(model_with_deps)
        hubs = tracker.get_hub_elements(threshold=3)

        # Application service should be a hub
        hub_ids = [h[0] for h in hubs]
        assert "application.service.customer-svc" in hub_ids

    def test_find_dependency_paths(self, model_with_deps):
        """Test finding paths between elements."""
        tracker = DependencyTracker(model_with_deps)

        paths = tracker.find_dependency_paths(
            "api.operation.get-customer", "business.service.customer-mgmt"
        )

        assert len(paths) >= 1
        # Path should go through application service
        assert "application.service.customer-svc" in paths[0].path

    def test_trace_up(self, model_with_deps):
        """Test internal _trace_up method."""
        tracker = DependencyTracker(model_with_deps)
        graph = tracker.registry.get_dependency_graph()

        ancestors = tracker._trace_up(graph, "api.operation.get-customer", max_depth=None)

        assert "application.service.customer-svc" in ancestors

    def test_trace_down(self, model_with_deps):
        """Test internal _trace_down method."""
        tracker = DependencyTracker(model_with_deps)
        graph = tracker.registry.get_dependency_graph()

        descendants = tracker._trace_down(graph, "business.service.customer-mgmt", max_depth=None)

        assert "application.service.customer-svc" in descendants
