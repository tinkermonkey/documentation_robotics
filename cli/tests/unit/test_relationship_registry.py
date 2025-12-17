"""Unit tests for RelationshipRegistry."""

import json
import tempfile
from pathlib import Path

import pytest
from documentation_robotics.core.relationship_registry import (
    RelationshipRegistry,
    RelationshipType,
)


@pytest.fixture
def sample_catalog_data():
    """Sample relationship catalog data for testing."""
    return {
        "version": "2.1.0",
        "generatedBy": "test",
        "lastUpdated": "2025-12-15",
        "relationshipTypes": [
            {
                "id": "composition",
                "predicate": "composes",
                "inversePredicate": "composed-of",
                "category": "structural",
                "archimateAlignment": "Composition",
                "description": "Whole-part relationship where the part cannot exist without the whole",
                "semantics": {
                    "directionality": "bidirectional",
                    "transitivity": False,
                    "symmetry": False,
                },
                "applicableLayers": ["02", "03", "04", "05", "06", "07", "08", "11", "12"],
                "examples": [
                    {
                        "source": "BusinessCollaboration",
                        "target": "BusinessRole",
                        "description": "Business collaboration composes business roles",
                    }
                ],
            },
            {
                "id": "aggregation",
                "predicate": "aggregates",
                "inversePredicate": "aggregated-by",
                "category": "structural",
                "archimateAlignment": "Aggregation",
                "description": "Whole-part relationship where the part can exist independently",
                "semantics": {
                    "directionality": "bidirectional",
                    "transitivity": False,
                    "symmetry": False,
                },
                "applicableLayers": ["01", "02", "03", "04", "05", "06", "07", "08", "11", "12"],
                "examples": [],
            },
            {
                "id": "realization",
                "predicate": "realizes",
                "inversePredicate": "realized-by",
                "category": "dependency",
                "archimateAlignment": "Realization",
                "description": "Behavioral relationship indicating implementation",
                "semantics": {
                    "directionality": "bidirectional",
                    "transitivity": True,
                    "symmetry": False,
                },
                "applicableLayers": ["02", "04", "05", "06", "08"],
                "examples": [],
            },
        ],
    }


@pytest.fixture
def temp_catalog_file(sample_catalog_data):
    """Create a temporary catalog file for testing."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(sample_catalog_data, f)
        temp_path = Path(f.name)
    yield temp_path
    temp_path.unlink()


class TestRelationshipType:
    """Tests for RelationshipType dataclass."""

    def test_relationship_type_creation(self):
        """Test creating a relationship type."""
        rel_type = RelationshipType(
            id="composition",
            predicate="composes",
            inverse_predicate="composed-of",
            category="structural",
            archimate_alignment="Composition",
            description="Test description",
            semantics={"directionality": "bidirectional", "transitivity": False},
            applicable_layers=["02", "03", "04"],
            examples=[],
        )

        assert rel_type.id == "composition"
        assert rel_type.predicate == "composes"
        assert rel_type.inverse_predicate == "composed-of"
        assert rel_type.category == "structural"

    def test_is_bidirectional(self):
        """Test bidirectional property."""
        rel_type = RelationshipType(
            id="test",
            predicate="test-pred",
            inverse_predicate="test-inv",
            category="test",
            archimate_alignment=None,
            description="test",
            semantics={"directionality": "bidirectional"},
            applicable_layers=["02"],
            examples=[],
        )
        assert rel_type.is_bidirectional is True

        rel_type2 = RelationshipType(
            id="test",
            predicate="test-pred",
            inverse_predicate="test-inv",
            category="test",
            archimate_alignment=None,
            description="test",
            semantics={"directionality": "unidirectional"},
            applicable_layers=["02"],
            examples=[],
        )
        assert rel_type2.is_bidirectional is False

    def test_applies_to_layer(self):
        """Test layer applicability checking."""
        rel_type = RelationshipType(
            id="test",
            predicate="test-pred",
            inverse_predicate="test-inv",
            category="test",
            archimate_alignment=None,
            description="test",
            semantics={},
            applicable_layers=["02", "03", "06"],
            examples=[],
        )

        # Test short form
        assert rel_type.applies_to_layer("02") is True
        assert rel_type.applies_to_layer("06") is True
        assert rel_type.applies_to_layer("01") is False

        # Test long form
        assert rel_type.applies_to_layer("02-business") is True
        assert rel_type.applies_to_layer("06-api") is True
        assert rel_type.applies_to_layer("01-motivation") is False


class TestRelationshipRegistry:
    """Tests for RelationshipRegistry."""

    def test_registry_creation_with_file(self, temp_catalog_file):
        """Test creating a registry with a catalog file."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        assert len(registry.relationship_types) == 3
        assert len(registry.predicate_map) == 6  # 3 forward + 3 inverse predicates
        assert len(registry.categories) == 2  # structural, dependency
        assert registry.metadata["version"] == "2.1.0"

    def test_get_relationship_type(self, temp_catalog_file):
        """Test getting relationship type by ID."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        rel_type = registry.get_relationship_type("composition")
        assert rel_type is not None
        assert rel_type.id == "composition"
        assert rel_type.predicate == "composes"

        # Non-existent
        assert registry.get_relationship_type("nonexistent") is None

    def test_get_predicate(self, temp_catalog_file):
        """Test getting relationship type by predicate."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        rel_type = registry.get_predicate("composes")
        assert rel_type is not None
        assert rel_type.id == "composition"

        rel_type2 = registry.get_predicate("realizes")
        assert rel_type2 is not None
        assert rel_type2.id == "realization"

        # Non-existent
        assert registry.get_predicate("nonexistent") is None

    def test_get_inverse_predicate(self, temp_catalog_file):
        """Test getting inverse predicate."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        inverse = registry.get_inverse_predicate("composes")
        assert inverse == "composed-of"

        inverse2 = registry.get_inverse_predicate("aggregates")
        assert inverse2 == "aggregated-by"

        # Non-existent
        assert registry.get_inverse_predicate("nonexistent") is None

    def test_get_predicates_for_layer(self, temp_catalog_file):
        """Test getting predicates for a specific layer."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        # Layer 02 (business) - has all three
        predicates_02 = registry.get_predicates_for_layer("02")
        assert "composes" in predicates_02
        assert "aggregates" in predicates_02
        assert "realizes" in predicates_02

        # Layer 06 (api) - has composes, aggregates, realizes
        predicates_06 = registry.get_predicates_for_layer("06-api")
        assert "composes" in predicates_06
        assert "aggregates" in predicates_06
        assert "realizes" in predicates_06

        # Layer 01 (motivation) - only has aggregates
        predicates_01 = registry.get_predicates_for_layer("01")
        assert "aggregates" in predicates_01
        assert "composes" not in predicates_01
        assert "realizes" not in predicates_01

    def test_get_relationship_types_by_category(self, temp_catalog_file):
        """Test getting relationship types by category."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        structural = registry.get_relationship_types_by_category("structural")
        assert len(structural) == 2
        assert any(r.id == "composition" for r in structural)
        assert any(r.id == "aggregation" for r in structural)

        dependency = registry.get_relationship_types_by_category("dependency")
        assert len(dependency) == 1
        assert dependency[0].id == "realization"

    def test_list_all_predicates(self, temp_catalog_file):
        """Test listing all predicates."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        predicates = registry.list_all_predicates()
        assert len(predicates) == 6  # 3 forward + 3 inverse predicates
        # Check forward predicates
        assert "composes" in predicates
        assert "aggregates" in predicates
        assert "realizes" in predicates
        # Check inverse predicates
        assert "composed-of" in predicates
        assert "aggregated-by" in predicates
        assert "realized-by" in predicates
        # Should be sorted
        assert predicates == sorted(predicates)

    def test_list_all_categories(self, temp_catalog_file):
        """Test listing all categories."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        categories = registry.list_all_categories()
        assert len(categories) == 2
        assert "structural" in categories
        assert "dependency" in categories
        # Should be sorted
        assert categories == sorted(categories)

    def test_get_all_relationship_types(self, temp_catalog_file):
        """Test getting all relationship types."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        all_types = registry.get_all_relationship_types()
        assert len(all_types) == 3
        assert any(r.id == "composition" for r in all_types)
        assert any(r.id == "aggregation" for r in all_types)
        assert any(r.id == "realization" for r in all_types)

    def test_get_statistics(self, temp_catalog_file):
        """Test getting catalog statistics."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        stats = registry.get_statistics()
        assert stats["total_relationship_types"] == 3
        assert stats["total_predicates"] == 6  # 3 forward + 3 inverse predicates
        assert stats["total_categories"] == 2
        assert stats["category_counts"]["structural"] == 2
        assert stats["category_counts"]["dependency"] == 1
        assert stats["bidirectional_count"] == 3  # All are bidirectional
        assert stats["version"] == "2.1.0"

    def test_export_to_dict(self, temp_catalog_file):
        """Test exporting to dictionary."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        exported = registry.export_to_dict()
        assert "metadata" in exported
        assert "relationshipTypes" in exported
        assert len(exported["relationshipTypes"]) == 3
        assert exported["metadata"]["version"] == "2.1.0"

    def test_repr(self, temp_catalog_file):
        """Test string representation."""
        registry = RelationshipRegistry(catalog_path=temp_catalog_file)

        repr_str = repr(registry)
        assert "RelationshipRegistry" in repr_str
        assert "relationship_types=3" in repr_str
        assert "predicates=6" in repr_str  # 3 forward + 3 inverse predicates
        assert "categories=2" in repr_str

    def test_missing_catalog_file(self):
        """Test handling of missing catalog file."""
        with pytest.raises(FileNotFoundError):
            RelationshipRegistry(catalog_path=Path("/nonexistent/file.json"))
