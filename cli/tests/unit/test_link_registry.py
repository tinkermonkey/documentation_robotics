"""Unit tests for LinkRegistry."""

import json

import pytest
from documentation_robotics.core.link_registry import LinkRegistry


class TestLinkRegistry:
    """Tests for LinkRegistry."""

    @pytest.fixture
    def sample_registry_data(self):
        """Create sample registry data for testing."""
        return {
            "metadata": {"version": "3.0.0", "description": "Test registry"},
            "categories": {
                "motivation": {
                    "name": "Motivation Layer References",
                    "description": "References to goals, requirements, and principles",
                },
                "business": {
                    "name": "Business Layer References",
                    "description": "References to business elements",
                },
            },
            "linkTypes": [
                {
                    "id": "motivation-supports-goals",
                    "name": "Supports Goals",
                    "category": "motivation",
                    "sourceLayers": ["02-business", "04-application"],
                    "targetLayer": "01-motivation",
                    "targetElementTypes": ["Goal"],
                    "fieldPaths": [
                        "motivation.supports-goals",
                        "motivationAlignment.supportsGoals",
                    ],
                    "cardinality": "array",
                    "format": "uuid",
                    "description": "References to goals that this element supports",
                    "examples": ["motivation.supports-goals: [goal-1, goal-2]"],
                    "validationRules": {
                        "targetExists": True,
                        "targetType": "Goal",
                        "formatPattern": "^[a-f0-9\\-]{36}$",
                    },
                },
                {
                    "id": "business-service-ref",
                    "name": "Business Service Reference",
                    "category": "business",
                    "sourceLayers": ["04-application", "06-api"],
                    "targetLayer": "02-business",
                    "targetElementTypes": ["BusinessService"],
                    "fieldPaths": ["x-business-service-ref"],
                    "cardinality": "single",
                    "format": "uuid",
                    "description": "Reference to a business service",
                    "examples": ["x-business-service-ref: service-123"],
                    "validationRules": {"targetExists": True, "targetType": "BusinessService"},
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

    def test_load_registry(self, registry_file):
        """Test loading registry from file."""
        registry = LinkRegistry(registry_file)

        assert len(registry.link_types) == 2
        assert "motivation-supports-goals" in registry.link_types
        assert "business-service-ref" in registry.link_types
        assert len(registry.categories) == 2
        assert registry.metadata["version"] == "3.0.0"

    def test_get_link_type(self, registry_file):
        """Test retrieving a link type by ID."""
        registry = LinkRegistry(registry_file)

        link_type = registry.get_link_type("motivation-supports-goals")
        assert link_type is not None
        assert link_type.id == "motivation-supports-goals"
        assert link_type.name == "Supports Goals"
        assert link_type.category == "motivation"
        assert link_type.cardinality == "array"
        assert link_type.format == "uuid"

    def test_get_link_type_not_found(self, registry_file):
        """Test retrieving non-existent link type."""
        registry = LinkRegistry(registry_file)

        link_type = registry.get_link_type("non-existent")
        assert link_type is None

    def test_get_link_types_by_category(self, registry_file):
        """Test filtering link types by category."""
        registry = LinkRegistry(registry_file)

        motivation_links = registry.get_link_types_by_category("motivation")
        assert len(motivation_links) == 1
        assert motivation_links[0].id == "motivation-supports-goals"

        business_links = registry.get_link_types_by_category("business")
        assert len(business_links) == 1
        assert business_links[0].id == "business-service-ref"

        empty_links = registry.get_link_types_by_category("nonexistent")
        assert len(empty_links) == 0

    def test_get_link_types_by_source_layer(self, registry_file):
        """Test filtering link types by source layer."""
        registry = LinkRegistry(registry_file)

        api_links = registry.get_link_types_by_source_layer("06-api")
        assert len(api_links) == 1
        assert api_links[0].id == "business-service-ref"

        app_links = registry.get_link_types_by_source_layer("04-application")
        assert len(app_links) == 2

        empty_links = registry.get_link_types_by_source_layer("99-nonexistent")
        assert len(empty_links) == 0

    def test_get_link_types_by_target_layer(self, registry_file):
        """Test filtering link types by target layer."""
        registry = LinkRegistry(registry_file)

        motivation_targets = registry.get_link_types_by_target_layer("01-motivation")
        assert len(motivation_targets) == 1
        assert motivation_targets[0].id == "motivation-supports-goals"

        business_targets = registry.get_link_types_by_target_layer("02-business")
        assert len(business_targets) == 1
        assert business_targets[0].id == "business-service-ref"

    def test_find_link_type_by_field_path(self, registry_file):
        """Test finding link type by field path."""
        registry = LinkRegistry(registry_file)

        link_type = registry.find_link_type_by_field_path("motivation.supports-goals")
        assert link_type is not None
        assert link_type.id == "motivation-supports-goals"

        link_type = registry.find_link_type_by_field_path("motivationAlignment.supportsGoals")
        assert link_type is not None
        assert link_type.id == "motivation-supports-goals"

        link_type = registry.find_link_type_by_field_path("x-business-service-ref")
        assert link_type is not None
        assert link_type.id == "business-service-ref"

        link_type = registry.find_link_type_by_field_path("nonexistent.field")
        assert link_type is None

    def test_get_all_link_types(self, registry_file):
        """Test retrieving all link types."""
        registry = LinkRegistry(registry_file)

        all_links = registry.get_all_link_types()
        assert len(all_links) == 2

    def test_get_all_categories(self, registry_file):
        """Test retrieving all categories."""
        registry = LinkRegistry(registry_file)

        categories = registry.get_all_categories()
        assert len(categories) == 2
        assert "motivation" in categories
        assert "business" in categories

    def test_get_source_layers(self, registry_file):
        """Test retrieving all source layers."""
        registry = LinkRegistry(registry_file)

        source_layers = registry.get_source_layers()
        assert "02-business" in source_layers
        assert "04-application" in source_layers
        assert "06-api" in source_layers
        assert len(source_layers) == 3

    def test_get_target_layers(self, registry_file):
        """Test retrieving all target layers."""
        registry = LinkRegistry(registry_file)

        target_layers = registry.get_target_layers()
        assert "01-motivation" in target_layers
        assert "02-business" in target_layers
        assert len(target_layers) == 2

    def test_export_to_dict(self, registry_file):
        """Test exporting registry to dictionary."""
        registry = LinkRegistry(registry_file)

        exported = registry.export_to_dict()
        assert "linkTypes" in exported
        assert "categories" in exported
        assert "metadata" in exported
        assert len(exported["linkTypes"]) == 2
        assert exported["metadata"]["version"] == "3.0.0"

    def test_export_to_json(self, registry_file):
        """Test exporting registry to JSON."""
        registry = LinkRegistry(registry_file)

        json_str = registry.export_to_json()
        data = json.loads(json_str)
        assert "linkTypes" in data
        assert len(data["linkTypes"]) == 2

    def test_export_to_markdown_table(self, registry_file):
        """Test exporting registry to markdown table."""
        registry = LinkRegistry(registry_file)

        markdown = registry.export_to_markdown_table()
        assert "| ID |" in markdown
        assert "motivation-supports-goals" in markdown
        assert "business-service-ref" in markdown

    def test_export_to_markdown_table_filtered(self, registry_file):
        """Test exporting filtered markdown table."""
        registry = LinkRegistry(registry_file)

        markdown = registry.export_to_markdown_table(category="motivation")
        assert "motivation-supports-goals" in markdown
        assert "business-service-ref" not in markdown

    def test_get_statistics(self, registry_file):
        """Test getting registry statistics."""
        registry = LinkRegistry(registry_file)

        stats = registry.get_statistics()
        assert stats["total_link_types"] == 2
        assert stats["total_categories"] == 2
        assert stats["category_counts"]["motivation"] == 1
        assert stats["category_counts"]["business"] == 1
        assert stats["format_counts"]["uuid"] == 2
        assert stats["version"] == "3.0.0"
        assert len(stats["source_layers"]) == 3
        assert len(stats["target_layers"]) == 2

    def test_link_type_properties(self, registry_file):
        """Test LinkType dataclass properties."""
        registry = LinkRegistry(registry_file)

        array_link = registry.get_link_type("motivation-supports-goals")
        assert array_link.is_array is True
        assert array_link.requires_uuid_format is True
        assert array_link.matches_field_path("motivation.supports-goals") is True
        assert array_link.matches_field_path("wrong.path") is False

        single_link = registry.get_link_type("business-service-ref")
        assert single_link.is_array is False
        assert single_link.requires_uuid_format is True

    def test_registry_file_not_found(self, tmp_path):
        """Test error when registry file doesn't exist."""
        nonexistent_path = tmp_path / "nonexistent.json"

        with pytest.raises(FileNotFoundError) as exc_info:
            LinkRegistry(nonexistent_path)

        assert "Link registry not found" in str(exc_info.value)

    def test_repr(self, registry_file):
        """Test string representation."""
        registry = LinkRegistry(registry_file)

        repr_str = repr(registry)
        assert "LinkRegistry" in repr_str
        assert "link_types=2" in repr_str
        assert "categories=2" in repr_str
