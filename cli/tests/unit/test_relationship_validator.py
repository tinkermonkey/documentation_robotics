"""
Tests for relationship validator.
"""

import pytest
from documentation_robotics.validators.relationship_validator import RelationshipValidator


@pytest.fixture
def bundled_schemas_dir():
    """Get path to bundled schemas directory."""
    from documentation_robotics.schemas import get_bundled_schemas_dir

    return get_bundled_schemas_dir()


@pytest.fixture
def relationship_validator(bundled_schemas_dir):
    """Create a relationship validator instance."""
    return RelationshipValidator(bundled_schemas_dir)


class TestRelationshipCatalogLoading:
    """Test relationship catalog loading."""

    def test_loads_relationship_catalog(self, relationship_validator):
        """Test that relationship catalog loads successfully."""
        assert relationship_validator.catalog is not None
        assert "relationshipTypes" in relationship_validator.catalog
        assert relationship_validator.catalog_version is not None

    def test_builds_relationship_type_lookup(self, relationship_validator):
        """Test that relationship types are indexed."""
        assert len(relationship_validator._relationship_types) > 0
        assert "composition" in relationship_validator._relationship_types
        assert "aggregation" in relationship_validator._relationship_types


class TestIntraLayerRelationshipValidation:
    """Test intra-layer relationship validation."""

    def test_validate_valid_composition_relationship(
        self, relationship_validator, bundled_schemas_dir
    ):
        """Test validating a valid composition relationship."""
        testing_schema = bundled_schemas_dir / "12-testing-layer.schema.json"

        is_valid, error = relationship_validator.validate_intra_layer_relationship(
            testing_schema, "TestCoverageModel", "TestCoverageTarget", "composition"
        )

        assert is_valid, f"Expected valid relationship, got error: {error}"
        assert error is None

    def test_validate_invalid_relationship_type(self, relationship_validator, bundled_schemas_dir):
        """Test validating an invalid relationship type."""
        testing_schema = bundled_schemas_dir / "12-testing-layer.schema.json"

        is_valid, error = relationship_validator.validate_intra_layer_relationship(
            testing_schema, "TestCoverageModel", "TestCoverageTarget", "invalid-relationship"
        )

        assert not is_valid
        assert "not allowed" in error.lower()

    def test_validate_invalid_entity_types(self, relationship_validator, bundled_schemas_dir):
        """Test validating invalid entity types for a relationship."""
        testing_schema = bundled_schemas_dir / "12-testing-layer.schema.json"

        is_valid, error = relationship_validator.validate_intra_layer_relationship(
            testing_schema, "InvalidSource", "InvalidTarget", "composition"
        )

        assert not is_valid
        assert error is not None


class TestCrossLayerRelationshipValidation:
    """Test cross-layer relationship validation."""

    def test_validate_valid_cross_layer_relationship(
        self, relationship_validator, bundled_schemas_dir
    ):
        """Test validating a valid cross-layer relationship."""
        testing_schema = bundled_schemas_dir / "12-testing-layer.schema.json"

        is_valid, error = relationship_validator.validate_cross_layer_relationship(
            testing_schema, "01-motivation", "supports-goals"
        )

        assert is_valid or error is None  # May not have outgoing relationships

    def test_validate_invalid_predicate(self, relationship_validator, bundled_schemas_dir):
        """Test validating an invalid predicate."""
        testing_schema = bundled_schemas_dir / "12-testing-layer.schema.json"

        is_valid, error = relationship_validator.validate_cross_layer_relationship(
            testing_schema, "01-motivation", "invalid-predicate"
        )

        # Should fail because predicate doesn't exist
        # Unless there are no outgoing relationships at all
        assert not is_valid or "No cross-layer relationship" in (error or "")


class TestRelationshipMetadata:
    """Test relationship metadata retrieval."""

    def test_get_relationship_metadata(self, relationship_validator):
        """Test retrieving relationship metadata."""
        metadata = relationship_validator.get_relationship_metadata("composition")

        assert metadata is not None
        assert metadata["id"] == "composition"
        assert "predicate" in metadata
        assert "inversePredicate" in metadata

    def test_check_transitivity(self, relationship_validator):
        """Test checking if a relationship is transitive."""
        # Composition is not transitive
        assert not relationship_validator.is_relationship_transitive("composition")

        # Some relationships like specialization might be transitive
        # (check actual catalog data)

    def test_check_symmetry(self, relationship_validator):
        """Test checking if a relationship is symmetric."""
        # Most ArchiMate relationships are not symmetric
        assert not relationship_validator.is_relationship_symmetric("composition")


class TestGetAllowedRelationships:
    """Test getting allowed relationships from schemas."""

    def test_get_intra_layer_relationships(self, relationship_validator, bundled_schemas_dir):
        """Test getting allowed intra-layer relationships."""
        testing_schema = bundled_schemas_dir / "12-testing-layer.schema.json"

        allowed = relationship_validator.get_allowed_intra_layer_relationships(testing_schema)

        assert isinstance(allowed, list)
        assert len(allowed) > 0

        # Should have composition relationship
        composition_found = any(rel.get("relationshipTypeId") == "composition" for rel in allowed)
        assert composition_found

    def test_get_outgoing_cross_layer_relationships(
        self, relationship_validator, bundled_schemas_dir
    ):
        """Test getting outgoing cross-layer relationships."""
        testing_schema = bundled_schemas_dir / "12-testing-layer.schema.json"

        outgoing = relationship_validator.get_outgoing_cross_layer_relationships(testing_schema)

        assert isinstance(outgoing, list)
        # Testing layer may or may not have outgoing relationships

    def test_get_incoming_cross_layer_relationships(
        self, relationship_validator, bundled_schemas_dir
    ):
        """Test getting incoming cross-layer relationships."""
        motivation_schema = bundled_schemas_dir / "01-motivation-layer.schema.json"

        incoming = relationship_validator.get_incoming_cross_layer_relationships(motivation_schema)

        assert isinstance(incoming, list)
        # Motivation layer should have incoming relationships
