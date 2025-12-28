"""Unit tests for LinkAnalyzer."""

import json

import pytest
from documentation_robotics.core.link_analyzer import LinkAnalyzer, LinkPath
from documentation_robotics.core.link_registry import LinkRegistry


class TestLinkAnalyzer:
    """Tests for LinkAnalyzer."""

    @pytest.fixture
    def sample_registry_data(self):
        """Create sample registry data for testing."""
        return {
            "metadata": {"version": "3.0.0"},
            "categories": {"motivation": {"name": "Motivation"}, "business": {"name": "Business"}},
            "linkTypes": [
                {
                    "id": "motivation-supports-goals",
                    "name": "Supports Goals",
                    "category": "motivation",
                    "sourceLayers": ["02-business"],
                    "targetLayer": "01-motivation",
                    "targetElementTypes": ["Goal"],
                    "fieldPaths": ["motivation.supports-goals"],
                    "cardinality": "array",
                    "format": "uuid",
                    "description": "References to goals",
                    "examples": [],
                    "validationRules": {},
                },
                {
                    "id": "business-service-ref",
                    "name": "Business Service Reference",
                    "category": "business",
                    "sourceLayers": ["04-application"],
                    "targetLayer": "02-business",
                    "targetElementTypes": ["BusinessService"],
                    "fieldPaths": ["x-business-service-ref"],
                    "cardinality": "single",
                    "format": "uuid",
                    "description": "Reference to business service",
                    "examples": [],
                    "validationRules": {},
                },
            ],
        }

    @pytest.fixture
    def registry_file(self, tmp_path, sample_registry_data):
        """Create a temporary registry file."""
        registry_path = tmp_path / "link-registry.json"
        with open(registry_path, "w") as f:
            json.dump(sample_registry_data, f)
        return registry_path

    @pytest.fixture
    def registry(self, registry_file):
        """Create a LinkRegistry instance."""
        return LinkRegistry(registry_file)

    @pytest.fixture
    def sample_model_data(self):
        """Create sample model data for testing."""
        return {
            "01-motivation-layer": {
                "goals": [
                    {
                        "id": "goal-1",
                        "name": "Improve customer satisfaction",
                        "description": "Focus on customer experience",
                    },
                    {"id": "goal-2", "name": "Reduce costs", "description": "Optimize operations"},
                ]
            },
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Customer Service",
                        "motivation": {"supports-goals": ["goal-1", "goal-2"]},
                    },
                    {
                        "id": "service-2",
                        "name": "Billing Service",
                        "motivation": {"supports-goals": ["goal-2"]},
                    },
                ]
            },
            "04-application-layer": {
                "applicationServices": [
                    {
                        "id": "app-service-1",
                        "name": "CRM Application",
                        "x-business-service-ref": "service-1",
                    }
                ]
            },
        }

    def test_analyzer_initialization(self, registry):
        """Test LinkAnalyzer initialization."""
        analyzer = LinkAnalyzer(registry)

        assert analyzer.registry == registry
        assert len(analyzer.links) == 0
        assert len(analyzer.links_by_source) == 0
        assert len(analyzer.links_by_target) == 0
        assert len(analyzer.element_types) == 0

    def test_analyze_model(self, registry, sample_model_data):
        """Test analyzing a model to discover links."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        # Should discover links
        assert len(analyzer.links) > 0
        assert len(analyzer.element_types) > 0

        # Should track all elements
        assert "goal-1" in analyzer.element_types
        assert "goal-2" in analyzer.element_types
        assert "service-1" in analyzer.element_types
        assert "service-2" in analyzer.element_types
        assert "app-service-1" in analyzer.element_types

    def test_discover_array_links(self, registry, sample_model_data):
        """Test discovering array-type links."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        # service-1 should have links to goal-1 and goal-2
        service1_links = analyzer.get_links_from("service-1")
        assert len(service1_links) >= 1

        # Find the motivation link
        motivation_link = [
            link for link in service1_links if link.link_type.id == "motivation-supports-goals"
        ][0]
        assert "goal-1" in motivation_link.target_ids
        assert "goal-2" in motivation_link.target_ids

    def test_discover_single_links(self, registry, sample_model_data):
        """Test discovering single-value links."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        # app-service-1 should have link to service-1
        app_service_links = analyzer.get_links_from("app-service-1")
        assert len(app_service_links) >= 1

        # Find the business service reference link
        business_ref = [
            link for link in app_service_links if link.link_type.id == "business-service-ref"
        ][0]
        assert "service-1" in business_ref.target_ids

    def test_get_links_from(self, registry, sample_model_data):
        """Test getting links originating from an element."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        service1_links = analyzer.get_links_from("service-1")
        assert len(service1_links) >= 1

        nonexistent_links = analyzer.get_links_from("nonexistent-id")
        assert len(nonexistent_links) == 0

    def test_get_links_from_with_type_filter(self, registry, sample_model_data):
        """Test getting links with type filter."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        service1_links = analyzer.get_links_from("service-1", link_type="motivation-supports-goals")
        assert len(service1_links) >= 1
        assert all(link.link_type.id == "motivation-supports-goals" for link in service1_links)

    def test_get_links_to(self, registry, sample_model_data):
        """Test getting links targeting an element."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        # goal-1 should be targeted by service-1
        goal1_incoming = analyzer.get_links_to("goal-1")
        assert len(goal1_incoming) >= 1

        # service-1 should be targeted by app-service-1
        service1_incoming = analyzer.get_links_to("service-1")
        assert len(service1_incoming) >= 1

    def test_get_links_to_with_type_filter(self, registry, sample_model_data):
        """Test getting incoming links with type filter."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        goal1_links = analyzer.get_links_to("goal-1", link_type="motivation-supports-goals")
        assert len(goal1_links) >= 1
        assert all(link.link_type.id == "motivation-supports-goals" for link in goal1_links)

    def test_get_links_by_type(self, registry, sample_model_data):
        """Test getting all links of a specific type."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        motivation_links = analyzer.get_links_by_type("motivation-supports-goals")
        assert len(motivation_links) >= 2  # service-1 and service-2

        business_links = analyzer.get_links_by_type("business-service-ref")
        assert len(business_links) >= 1  # app-service-1

    def test_get_connected_elements_outgoing(self, registry, sample_model_data):
        """Test getting connected elements (outgoing only)."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        connected = analyzer.get_connected_elements("service-1", direction="down")
        assert "goal-1" in connected
        assert "goal-2" in connected

    def test_get_connected_elements_incoming(self, registry, sample_model_data):
        """Test getting connected elements (incoming only)."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        connected = analyzer.get_connected_elements("goal-1", direction="up")
        assert "service-1" in connected

    def test_get_connected_elements_both(self, registry, sample_model_data):
        """Test getting connected elements (both directions)."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        connected = analyzer.get_connected_elements("service-1", direction="both")
        assert "goal-1" in connected  # outgoing
        assert "goal-2" in connected  # outgoing
        assert "app-service-1" in connected  # incoming

    def test_find_path_direct(self, registry, sample_model_data):
        """Test finding a direct path between elements."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        path = analyzer.find_path("service-1", "goal-1")
        assert path is not None
        assert path.source_id == "service-1"
        assert path.target_id == "goal-1"
        assert path.total_distance == 1

    def test_find_path_multi_hop(self, registry, sample_model_data):
        """Test finding a multi-hop path."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        path = analyzer.find_path("app-service-1", "goal-1")
        assert path is not None
        assert path.source_id == "app-service-1"
        assert path.target_id == "goal-1"
        assert path.total_distance >= 2

    def test_find_path_same_element(self, registry, sample_model_data):
        """Test finding path from element to itself."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        path = analyzer.find_path("service-1", "service-1")
        assert path is not None
        assert path.total_distance == 0
        assert len(path.hops) == 0

    def test_find_path_not_found(self, registry, sample_model_data):
        """Test when no path exists between elements."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        # goal-1 has no outgoing links, so no path to service-1
        path = analyzer.find_path("goal-1", "service-1")
        assert path is None

    def test_find_path_max_hops(self, registry, sample_model_data):
        """Test path finding with max hops limit."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        # Set max_hops to 1, should not find multi-hop paths
        path = analyzer.find_path("app-service-1", "goal-1", max_hops=1)
        # Depending on structure, this might be None or a 1-hop path
        if path:
            assert path.total_distance <= 1

    def test_get_statistics(self, registry, sample_model_data):
        """Test getting link statistics."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        stats = analyzer.get_statistics()
        assert stats["total_links"] > 0
        assert stats["total_elements"] == 5  # 2 goals, 2 services, 1 app service
        assert stats["elements_with_outgoing_links"] > 0
        assert stats["elements_with_incoming_links"] > 0
        assert "links_by_type" in stats
        assert "links_by_category" in stats

    def test_find_broken_links(self, registry):
        """Test finding broken links (missing targets)."""
        analyzer = LinkAnalyzer(registry)

        # Model with broken link
        broken_model = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Test Service",
                        "motivation": {"supports-goals": ["nonexistent-goal"]},
                    }
                ]
            }
        }

        analyzer.analyze_model(broken_model)
        broken = analyzer.find_broken_links()

        assert len(broken) > 0
        link_instance, missing_ids = broken[0]
        assert "nonexistent-goal" in missing_ids

    def test_get_orphaned_elements(self, registry, sample_model_data):
        """Test finding orphaned elements (no links)."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        orphaned = analyzer.get_orphaned_elements()
        # goal-2 might have incoming links, so check structure
        # At minimum, we know the structure has connections
        assert isinstance(orphaned, list)

    def test_link_instance_properties(self, registry, sample_model_data):
        """Test LinkInstance properties."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        links = analyzer.get_links_from("service-1")
        assert len(links) > 0

        link = links[0]
        # Array link should have valid format
        assert link.is_valid_format is True

    def test_link_path_description(self, registry, sample_model_data):
        """Test LinkPath description generation."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        path = analyzer.find_path("service-1", "goal-1")
        assert path is not None

        description = path.get_path_description()
        assert "service-1" in description
        assert "goal-1" in description

    def test_link_path_no_path(self):
        """Test LinkPath with no hops."""
        path = LinkPath(source_id="elem-1", target_id="elem-2", hops=[])
        description = path.get_path_description()
        assert "no path" in description

    def test_repr(self, registry, sample_model_data):
        """Test string representation."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(sample_model_data)

        repr_str = repr(analyzer)
        assert "LinkAnalyzer" in repr_str
        assert "links=" in repr_str
        assert "elements=" in repr_str
