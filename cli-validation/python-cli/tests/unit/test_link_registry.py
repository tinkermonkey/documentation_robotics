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


class TestLinkRegistryPredicates:
    """Tests for LinkRegistry predicate methods (v0.6.0)."""

    @pytest.fixture
    def sample_registry_with_predicates(self):
        """Create sample registry data with v0.6.0 predicate fields."""
        return {
            "version": "2.0.0",
            "metadata": {"version": "2.0.0", "description": "Test registry with predicates"},
            "categories": {
                "archimate": {
                    "name": "ArchiMate References",
                    "description": "References to ArchiMate elements",
                }
            },
            "linkTypes": [
                {
                    "id": "archimate-serves",
                    "name": "Serves",
                    "category": "archimate",
                    "sourceLayers": ["04-application"],
                    "targetLayer": "02-business",
                    "targetElementTypes": ["BusinessService"],
                    "fieldPaths": ["x-archimate-serves"],
                    "cardinality": "array",
                    "format": "uuid",
                    "description": "Application component serves business service",
                    "examples": [],
                    "validationRules": {},
                    "predicate": "serves",
                    "inversePredicate": "served-by",
                },
                {
                    "id": "archimate-realizes",
                    "name": "Realizes",
                    "category": "archimate",
                    "sourceLayers": ["04-application"],
                    "targetLayer": "02-business",
                    "targetElementTypes": ["BusinessService"],
                    "fieldPaths": ["x-archimate-realizes"],
                    "cardinality": "single",
                    "format": "uuid",
                    "description": "Application service realizes business service",
                    "examples": [],
                    "validationRules": {},
                    "predicate": "realizes",
                    "inversePredicate": "realized-by",
                },
                {
                    "id": "legacy-link",
                    "name": "Legacy Link",
                    "category": "archimate",
                    "sourceLayers": ["06-api"],
                    "targetLayer": "04-application",
                    "targetElementTypes": ["ApplicationService"],
                    "fieldPaths": ["x-legacy-ref"],
                    "cardinality": "single",
                    "format": "uuid",
                    "description": "Legacy link without predicates",
                    "examples": [],
                    "validationRules": {},
                },
            ],
        }

    @pytest.fixture
    def registry_with_predicates(self, tmp_path, sample_registry_with_predicates):
        """Create a temporary registry file with predicates."""
        registry_path = tmp_path / "link-registry-with-predicates.json"
        with open(registry_path, "w") as f:
            json.dump(sample_registry_with_predicates, f)
        return registry_path

    def test_get_predicate_for_link_type(self, registry_with_predicates):
        """Test getting predicate for a link type."""
        registry = LinkRegistry(registry_with_predicates)

        predicate = registry.get_predicate_for_link_type("archimate-serves")
        assert predicate == "serves"

        predicate = registry.get_predicate_for_link_type("archimate-realizes")
        assert predicate == "realizes"

        # Link type without predicate
        predicate = registry.get_predicate_for_link_type("legacy-link")
        assert predicate is None

        # Non-existent link type
        predicate = registry.get_predicate_for_link_type("nonexistent")
        assert predicate is None

    def test_get_inverse_predicate_for_link_type(self, registry_with_predicates):
        """Test getting inverse predicate for a link type."""
        registry = LinkRegistry(registry_with_predicates)

        inverse = registry.get_inverse_predicate_for_link_type("archimate-serves")
        assert inverse == "served-by"

        inverse = registry.get_inverse_predicate_for_link_type("archimate-realizes")
        assert inverse == "realized-by"

        # Link type without inverse predicate
        inverse = registry.get_inverse_predicate_for_link_type("legacy-link")
        assert inverse is None

        # Non-existent link type
        inverse = registry.get_inverse_predicate_for_link_type("nonexistent")
        assert inverse is None

    def test_get_link_types_with_predicate(self, registry_with_predicates):
        """Test finding link types by predicate."""
        registry = LinkRegistry(registry_with_predicates)

        serves_links = registry.get_link_types_with_predicate("serves")
        assert len(serves_links) == 1
        assert "archimate-serves" in serves_links

        realizes_links = registry.get_link_types_with_predicate("realizes")
        assert len(realizes_links) == 1
        assert "archimate-realizes" in realizes_links

        # Non-existent predicate
        nonexistent = registry.get_link_types_with_predicate("nonexistent")
        assert len(nonexistent) == 0

    def test_get_link_types_with_predicates(self, registry_with_predicates):
        """Test getting all link types that have predicates."""
        registry = LinkRegistry(registry_with_predicates)

        links_with_predicates = registry.get_link_types_with_predicates()
        assert len(links_with_predicates) == 2

        link_ids = [link.id for link in links_with_predicates]
        assert "archimate-serves" in link_ids
        assert "archimate-realizes" in link_ids
        assert "legacy-link" not in link_ids  # No predicate

    @pytest.fixture
    def sample_v0_5_registry(self):
        """Create sample v0.5.0 registry data without predicates."""
        return {
            "metadata": {"version": "1.0.0", "description": "v0.5.0 registry"},
            "categories": {
                "motivation": {
                    "name": "Motivation Layer References",
                    "description": "References to goals",
                }
            },
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
                }
            ],
        }

    @pytest.fixture
    def v0_5_registry_file(self, tmp_path, sample_v0_5_registry):
        """Create a temporary v0.5.0 registry file without predicates."""
        registry_path = tmp_path / "link-registry-v0.5.json"
        with open(registry_path, "w") as f:
            json.dump(sample_v0_5_registry, f)
        return registry_path

    def test_backward_compatibility_v0_5_0(self, v0_5_registry_file):
        """Test that v0.5.0 link registries without predicates still work."""
        registry = LinkRegistry(v0_5_registry_file)

        # Should load successfully
        assert len(registry.link_types) == 1

        # Predicate fields should be None for v0.5.0 links
        link = registry.get_link_type("motivation-supports-goals")
        assert link.predicate is None
        assert link.inverse_predicate is None

        # New methods should handle None gracefully
        predicate = registry.get_predicate_for_link_type("motivation-supports-goals")
        assert predicate is None

        inverse = registry.get_inverse_predicate_for_link_type("motivation-supports-goals")
        assert inverse is None

        # Should return empty list when no predicates exist
        links_with_predicates = registry.get_link_types_with_predicates()
        assert len(links_with_predicates) == 0

    def test_export_to_dict_preserves_predicates(self, registry_with_predicates):
        """Test that export_to_dict preserves predicate fields."""
        registry = LinkRegistry(registry_with_predicates)

        # Export to dict
        exported = registry.export_to_dict()

        # Verify predicate fields are present in exported data
        serves_link = next(
            (link for link in exported["linkTypes"] if link["id"] == "archimate-serves"),
            None,
        )
        assert serves_link is not None
        assert serves_link["predicate"] == "serves"
        assert serves_link["inversePredicate"] == "served-by"

        realizes_link = next(
            (link for link in exported["linkTypes"] if link["id"] == "archimate-realizes"),
            None,
        )
        assert realizes_link is not None
        assert realizes_link["predicate"] == "realizes"
        assert realizes_link["inversePredicate"] == "realized-by"

        # Legacy link should have None predicates
        legacy_link = next(
            (link for link in exported["linkTypes"] if link["id"] == "legacy-link"),
            None,
        )
        assert legacy_link is not None
        assert legacy_link["predicate"] is None
        assert legacy_link["inversePredicate"] is None

        # Test roundtrip: export and re-import
        import tempfile
        from pathlib import Path

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            import json

            json.dump(exported, f)
            temp_path = Path(f.name)

        try:
            # Re-load from exported data
            registry2 = LinkRegistry(temp_path)

            # Verify predicates survived roundtrip
            serves_link2 = registry2.get_link_type("archimate-serves")
            assert serves_link2.predicate == "serves"
            assert serves_link2.inverse_predicate == "served-by"

            realizes_link2 = registry2.get_link_type("archimate-realizes")
            assert realizes_link2.predicate == "realizes"
            assert realizes_link2.inverse_predicate == "realized-by"

            legacy_link2 = registry2.get_link_type("legacy-link")
            assert legacy_link2.predicate is None
            assert legacy_link2.inverse_predicate is None
        finally:
            temp_path.unlink()
