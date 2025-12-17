"""Unit tests for PredicateValidator."""

import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, MagicMock

import pytest

from documentation_robotics.core.relationship_registry import RelationshipRegistry, RelationshipType
from documentation_robotics.validators.predicate_validator import PredicateValidator
from documentation_robotics.validators.base import ValidationResult


@pytest.fixture
def mock_relationship_registry():
    """Create a mock relationship registry for testing."""
    registry = Mock(spec=RelationshipRegistry)

    # Create test relationship types
    composition_rel = RelationshipType(
        id="composition",
        predicate="composes",
        inverse_predicate="composed-of",
        category="structural",
        archimate_alignment="composition",
        description="Structural composition relationship",
        semantics={
            "directionality": "bidirectional",
            "transitivity": True,
            "symmetry": False,
            "cardinality": "one-to-many",
        },
        applicable_layers=["06", "07", "09"],
        examples=[],
    )

    aggregation_rel = RelationshipType(
        id="aggregation",
        predicate="aggregates",
        inverse_predicate="aggregated-by",
        category="structural",
        archimate_alignment="aggregation",
        description="Structural aggregation relationship",
        semantics={
            "directionality": "bidirectional",
            "transitivity": False,
            "symmetry": False,
            "cardinality": "many-to-many",
        },
        applicable_layers=["06", "07"],
        examples=[],
    )

    dependency_rel = RelationshipType(
        id="dependency",
        predicate="depends-on",
        inverse_predicate="depended-on-by",
        category="dependency",
        archimate_alignment=None,
        description="Dependency relationship",
        semantics={
            "directionality": "unidirectional",
            "transitivity": True,
            "symmetry": False,
            "cardinality": "many-to-many",
        },
        applicable_layers=["04", "06", "07", "09"],
        examples=[],
    )

    one_to_one_rel = RelationshipType(
        id="specialization",
        predicate="specializes",
        inverse_predicate="specialized-by",
        category="structural",
        archimate_alignment="specialization",
        description="One-to-one specialization",
        semantics={
            "directionality": "bidirectional",
            "transitivity": False,
            "symmetry": False,
            "cardinality": "one-to-one",
        },
        applicable_layers=["07"],
        examples=[],
    )

    # Configure mock methods
    registry.predicate_map = {
        "composes": composition_rel,
        "composed-of": composition_rel,
        "aggregates": aggregation_rel,
        "aggregated-by": aggregation_rel,
        "depends-on": dependency_rel,
        "depended-on-by": dependency_rel,
        "specializes": one_to_one_rel,
        "specialized-by": one_to_one_rel,
    }

    def get_predicate(pred):
        return registry.predicate_map.get(pred)

    def get_inverse_predicate(pred):
        rel = registry.predicate_map.get(pred)
        return rel.inverse_predicate if rel else None

    def get_predicates_for_layer(layer):
        predicates = []
        for rel in registry.predicate_map.values():
            if rel.applies_to_layer(layer):
                predicates.append(rel.predicate)
        return sorted(set(predicates))

    def list_all_predicates():
        return list(set(rel.predicate for rel in registry.predicate_map.values()))

    registry.get_predicate = get_predicate
    registry.get_inverse_predicate = get_inverse_predicate
    registry.get_predicates_for_layer = get_predicates_for_layer
    registry.list_all_predicates = list_all_predicates

    return registry


@pytest.fixture
def predicate_validator(mock_relationship_registry):
    """Create a PredicateValidator instance for testing."""
    return PredicateValidator(mock_relationship_registry, strict_mode=False)


@pytest.fixture
def strict_predicate_validator(mock_relationship_registry):
    """Create a strict PredicateValidator instance for testing."""
    return PredicateValidator(mock_relationship_registry, strict_mode=True)


@pytest.fixture
def mock_model():
    """Create a mock model for testing."""
    model = Mock()

    # Create mock elements
    element_a = Mock()
    element_a.id = "07-data-model.entity.user"
    element_a.data = {
        "relationships": [
            {"targetId": "07-data-model.entity.profile", "predicate": "composes"}
        ]
    }

    element_b = Mock()
    element_b.id = "07-data-model.entity.profile"
    element_b.data = {
        "relationships": [
            {"targetId": "07-data-model.entity.user", "predicate": "composed-of"}
        ]
    }

    element_c = Mock()
    element_c.id = "07-data-model.entity.order"
    element_c.data = {"relationships": []}

    def get_element(element_id):
        if element_id == "07-data-model.entity.user":
            return element_a
        elif element_id == "07-data-model.entity.profile":
            return element_b
        elif element_id == "07-data-model.entity.order":
            return element_c
        return None

    model.get_element = get_element
    return model


class TestPredicateValidator:
    """Tests for PredicateValidator class."""

    def test_validate_predicate_exists_valid(self, predicate_validator):
        """Test validation of existing predicate."""
        result = predicate_validator.validate_predicate_exists("composes")

        assert result.is_valid() is True
        assert len(result.errors) == 0

    def test_validate_predicate_exists_invalid(self, predicate_validator):
        """Test validation of non-existent predicate."""
        result = predicate_validator.validate_predicate_exists("invalid-predicate")

        assert result.is_valid() is False
        assert len(result.errors) > 0
        assert "Unknown predicate" in result.errors[0].message
        assert "invalid-predicate" in result.errors[0].message

    def test_validate_predicate_for_layer_valid(self, predicate_validator):
        """Test predicate validation for valid layer."""
        result = predicate_validator.validate_predicate_for_layer(
            "composes", "07-data-model", "07-data-model.entity.user"
        )

        assert result.is_valid() is True
        assert len(result.errors) == 0

    def test_validate_predicate_for_layer_invalid(self, predicate_validator):
        """Test predicate validation for invalid layer."""
        result = predicate_validator.validate_predicate_for_layer(
            "composes", "02-business", "02-business.process.checkout"
        )

        assert result.is_valid() is False
        assert len(result.errors) > 0
        assert "not valid for layer" in result.errors[0].message
        assert "02-business" in result.errors[0].message

    def test_validate_predicate_for_layer_short_form(self, predicate_validator):
        """Test predicate validation with short layer form."""
        result = predicate_validator.validate_predicate_for_layer(
            "composes", "07", "07.entity.user"
        )

        assert result.is_valid() is True

    def test_validate_inverse_consistency_valid(self, predicate_validator, mock_model):
        """Test inverse consistency with valid inverse relationship."""
        result = predicate_validator.validate_inverse_consistency(
            source_id="07-data-model.entity.user",
            target_id="07-data-model.entity.profile",
            predicate="composes",
            model=mock_model,
        )

        assert result.is_valid() is True
        assert len(result.warnings) == 0

    def test_validate_inverse_consistency_missing_inverse_warning(
        self, predicate_validator, mock_model
    ):
        """Test inverse consistency with missing inverse (warning mode)."""
        result = predicate_validator.validate_inverse_consistency(
            source_id="07-data-model.entity.user",
            target_id="07-data-model.entity.order",
            predicate="composes",
            model=mock_model,
        )

        assert result.is_valid() is True
        assert len(result.warnings) > 0
        assert "Missing inverse relationship" in result.warnings[0].message
        assert "composed-of" in result.warnings[0].message

    def test_validate_inverse_consistency_missing_inverse_error(
        self, strict_predicate_validator, mock_model
    ):
        """Test inverse consistency with missing inverse (strict mode)."""
        result = strict_predicate_validator.validate_inverse_consistency(
            source_id="07-data-model.entity.user",
            target_id="07-data-model.entity.order",
            predicate="composes",
            model=mock_model,
        )

        assert result.is_valid() is False
        assert len(result.errors) > 0
        assert "Missing inverse relationship" in result.errors[0].message
        assert "composed-of" in result.errors[0].message

    def test_validate_inverse_consistency_unidirectional(self, predicate_validator, mock_model):
        """Test inverse consistency for unidirectional relationship."""
        result = predicate_validator.validate_inverse_consistency(
            source_id="07-data-model.entity.user",
            target_id="07-data-model.entity.order",
            predicate="depends-on",
            model=mock_model,
        )

        # Unidirectional relationships don't require inverse
        assert result.is_valid() is True
        assert len(result.warnings) == 0

    def test_validate_cardinality_many_to_many(self, predicate_validator, mock_model):
        """Test cardinality validation for many-to-many relationships."""
        # Get the element and add multiple aggregation relationships
        element = mock_model.get_element("07-data-model.entity.user")
        original_relationships = element.data["relationships"][:]
        element.data["relationships"].extend(
            [
                {"targetId": "07-data-model.entity.order", "predicate": "aggregates"},
                {"targetId": "07-data-model.entity.profile", "predicate": "aggregates"},
            ]
        )

        result = predicate_validator.validate_cardinality(
            source_id="07-data-model.entity.user", predicate="aggregates", model=mock_model
        )

        # Restore original relationships
        element.data["relationships"] = original_relationships

        # Many-to-many allows multiple relationships
        assert result.is_valid() is True

    def test_validate_cardinality_one_to_many_violation(self, predicate_validator, mock_model):
        """Test cardinality validation for one-to-many violation."""
        # Add multiple composition relationships
        element = mock_model.get_element("07-data-model.entity.user")
        element.data["relationships"] = [
            {"targetId": "07-data-model.entity.profile", "predicate": "composes"},
            {"targetId": "07-data-model.entity.order", "predicate": "composes"},
        ]

        result = predicate_validator.validate_cardinality(
            source_id="07-data-model.entity.user", predicate="composes", model=mock_model
        )

        # One-to-many should allow multiple
        assert result.is_valid() is True

    def test_validate_cardinality_one_to_one_violation(self, predicate_validator, mock_model):
        """Test cardinality validation for one-to-one violation."""
        # Add multiple specialization relationships
        element = mock_model.get_element("07-data-model.entity.user")
        element.data["relationships"] = [
            {"targetId": "07-data-model.entity.profile", "predicate": "specializes"},
            {"targetId": "07-data-model.entity.order", "predicate": "specializes"},
        ]

        result = predicate_validator.validate_cardinality(
            source_id="07-data-model.entity.user", predicate="specializes", model=mock_model
        )

        # One-to-one should not allow multiple
        assert result.is_valid() is False
        assert len(result.errors) > 0
        assert "Cardinality violation" in result.errors[0].message
        assert "one-to-one" in result.errors[0].message

    def test_validate_relationship_complete(self, predicate_validator, mock_model):
        """Test complete relationship validation."""
        result = predicate_validator.validate_relationship(
            source_id="07-data-model.entity.user",
            target_id="07-data-model.entity.profile",
            predicate="composes",
            source_layer="07-data-model",
            model=mock_model,
        )

        assert result.is_valid() is True

    def test_validate_relationship_unknown_predicate(self, predicate_validator, mock_model):
        """Test relationship validation with unknown predicate."""
        result = predicate_validator.validate_relationship(
            source_id="07-data-model.entity.user",
            target_id="07-data-model.entity.profile",
            predicate="unknown-predicate",
            source_layer="07-data-model",
            model=mock_model,
        )

        assert result.is_valid() is False
        assert len(result.errors) > 0
        assert "Unknown predicate" in result.errors[0].message

    def test_validate_relationship_invalid_layer(self, predicate_validator, mock_model):
        """Test relationship validation with invalid layer."""
        result = predicate_validator.validate_relationship(
            source_id="02-business.process.checkout",
            target_id="02-business.process.payment",
            predicate="composes",
            source_layer="02-business",
            model=mock_model,
        )

        assert result.is_valid() is False
        assert len(result.errors) > 0
        assert "not valid for layer" in result.errors[0].message

    def test_get_relationship_info(self, predicate_validator):
        """Test getting relationship info."""
        info = predicate_validator.get_relationship_info("composes")

        assert info is not None
        assert info["predicate"] == "composes"
        assert info["inverse_predicate"] == "composed-of"
        assert info["category"] == "structural"
        assert info["is_bidirectional"] is True
        assert info["cardinality"] == "one-to-many"

    def test_get_relationship_info_not_found(self, predicate_validator):
        """Test getting relationship info for unknown predicate."""
        info = predicate_validator.get_relationship_info("unknown")

        assert info is None

    def test_list_predicates_for_layer(self, predicate_validator):
        """Test listing predicates for a layer."""
        predicates = predicate_validator.list_predicates_for_layer("07-data-model")

        assert "composes" in predicates
        assert "aggregates" in predicates
        assert "depends-on" in predicates
        assert len(predicates) > 0

    def test_repr(self, predicate_validator):
        """Test string representation."""
        repr_str = repr(predicate_validator)

        assert "PredicateValidator" in repr_str
        assert "strict_mode=False" in repr_str
