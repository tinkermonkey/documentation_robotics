"""Predicate Validator - Validates relationship predicates and semantics.

This module provides the PredicateValidator class which validates predicate usage,
inverse consistency, and cardinality constraints for intra-layer relationships.
"""

from typing import Any, Dict, List, Optional, Protocol

from ..core.relationship_registry import RelationshipRegistry, RelationshipType
from ..utils.layer_mapping import normalize_layer_identifier
from .base import ValidationResult


class ModelProtocol(Protocol):
    """Protocol for model objects used in validation."""

    def get_element(self, element_id: str) -> dict:
        """Get element by ID."""
        ...

    def get_relationships(self, element_id: str) -> list:
        """Get relationships for an element."""
        ...


class PredicateValidator:
    """Validates predicate usage against relationship-catalog.json.

    This validator enforces:
    - Predicate existence and valid usage
    - Layer-specific predicate constraints
    - Inverse predicate consistency for bidirectional relationships
    - Cardinality constraints (one-to-one, one-to-many, many-to-many)
    """

    def __init__(self, relationship_registry: RelationshipRegistry, strict_mode: bool = False):
        """Initialize the predicate validator.

        Args:
            relationship_registry: RelationshipRegistry with relationship definitions
            strict_mode: If True, warnings become errors
        """
        self.registry = relationship_registry
        self.strict_mode = strict_mode

    def _normalize_layer_identifier(self, layer: str) -> str:
        """Normalize layer identifier to numeric form for validation.

        Converts layer names (e.g., "api", "data_model") to numeric identifiers
        (e.g., "06", "07") for compatibility with relationship-catalog.json.

        Args:
            layer: Layer identifier (name, number, or full form)

        Returns:
            Normalized layer identifier (e.g., "06", "07")
        """
        try:
            return normalize_layer_identifier(layer)
        except ValueError:
            # If normalization fails, return as-is for error reporting
            return layer

    def validate_predicate_exists(self, predicate: str) -> ValidationResult:
        """Validate that a predicate exists in the catalog.

        Args:
            predicate: The predicate to check

        Returns:
            ValidationResult indicating validity
        """
        result = ValidationResult()
        rel_type = self.registry.get_predicate(predicate)
        if not rel_type:
            all_predicates = ', '.join(list(self.registry.list_all_predicates()))
            result.add_error(
                "relationships",
                message=f"Unknown predicate: '{predicate}'. Available predicates: {all_predicates}",
                element_id=predicate,
                location="predicate"
            )
        return result

    def validate_predicate_for_layer(
        self, predicate: str, source_layer: str, source_element_id: str
    ) -> ValidationResult:
        """Check if predicate is valid for the given layer.

        Args:
            predicate: The predicate to validate
            source_layer: Layer of the source element (e.g., "06-api", "api", "07-data-model", "data_model")
            source_element_id: ID of the source element (for error messages)

        Returns:
            ValidationResult indicating validity
        """
        result = ValidationResult()
        rel_type = self.registry.get_predicate(predicate)
        if not rel_type:
            result.add_error(
                source_layer,
                message=f"Unknown predicate: '{predicate}'",
                element_id=source_element_id,
                location="predicate"
            )
            return result

        # Normalize layer identifier for comparison
        normalized_layer = self._normalize_layer_identifier(source_layer)

        # Check applicable layers
        if rel_type.applicable_layers and not rel_type.applies_to_layer(normalized_layer):
            applicable_layers_str = ", ".join(rel_type.applicable_layers)
            result.add_error(
                source_layer,
                message=f"Predicate '{predicate}' (category: {rel_type.category}) "
                        f"not valid for layer {source_layer}. "
                        f"Applicable layers: {applicable_layers_str}",
                element_id=source_element_id,
                location="predicate"
            )

        return result

    def validate_inverse_consistency(
        self,
        source_id: str,
        target_id: str,
        predicate: str,
        model: ModelProtocol,
    ) -> ValidationResult:
        """Validate that inverse predicate exists for bidirectional relationship.

        For bidirectional relationships, checks that the target element has the
        expected inverse predicate relationship back to the source.

        Args:
            source_id: ID of the source element
            target_id: ID of the target element
            predicate: Forward predicate used
            model: Model instance with get_element() and get_relationships() methods

        Returns:
            ValidationResult with error or warning if inverse missing
        """
        result = ValidationResult()
        rel_type = self.registry.get_predicate(predicate)
        if not rel_type:
            # Unknown predicate handled by other validators
            return result

        # Check if this is a bidirectional relationship
        if not rel_type.is_bidirectional:
            # Not bidirectional, no inverse check needed
            return result

        expected_inverse = rel_type.inverse_predicate
        if not expected_inverse:
            # No inverse defined, skip check
            return result

        # Get relationships from target element
        target_relationships = self._get_relationships_from_model(model, target_id)

        # Check if target has inverse relationship back to source
        has_inverse = any(
            rel.get("targetId") == source_id and rel.get("predicate") == expected_inverse
            for rel in target_relationships
        )

        if not has_inverse:
            error_msg = (
                f"Missing inverse relationship: '{target_id}' should have "
                f"'{expected_inverse}' relationship to '{source_id}' "
                f"(inverse of '{predicate}')"
            )

            # Extract layer from source_id (format: layer-type-name)
            source_layer = source_id.split('-')[0] if '-' in source_id else "unknown"

            if self.strict_mode:
                result.add_error(
                    source_layer,
                    message=error_msg,
                    element_id=source_id,
                    location="relationships"
                )
            else:
                result.add_warning(
                    source_layer,
                    message=error_msg,
                    element_id=source_id,
                    location="relationships"
                )

        return result

    def validate_cardinality(
        self,
        source_id: str,
        predicate: str,
        model: ModelProtocol,
    ) -> ValidationResult:
        """Validate cardinality constraints for predicate usage.

        Checks that the number of relationships using this predicate from
        the source element complies with the relationship's cardinality constraint.

        Args:
            source_id: ID of the source element
            predicate: Predicate being used
            model: Model instance with get_relationships() method

        Returns:
            ValidationResult indicating validity
        """
        result = ValidationResult()
        rel_type = self.registry.get_predicate(predicate)
        if not rel_type:
            # Unknown predicate handled by other validators
            return result

        # Get cardinality constraint from semantics
        cardinality = rel_type.semantics.get("cardinality", "many-to-many")

        # Only enforce for one-to-one (not one-to-many)
        # one-to-one: source can have only 1 relationship with this predicate
        # one-to-many: source can have multiple relationships (many targets)
        # many-to-many: no restriction
        if cardinality != "one-to-one":
            return result

        # Count existing relationships with this predicate from source
        source_relationships = self._get_relationships_from_model(model, source_id)
        existing_rels = [
            rel for rel in source_relationships if rel.get("predicate") == predicate
        ]

        if len(existing_rels) > 1:
            # Extract layer from source_id (format: layer-type-name)
            source_layer = source_id.split('-')[0] if '-' in source_id else "unknown"
            result.add_error(
                source_layer,
                message=f"Cardinality violation: predicate '{predicate}' has "
                        f"{cardinality} constraint but element '{source_id}' "
                        f"has {len(existing_rels)} relationships with this predicate",
                element_id=source_id,
                location="relationships"
            )

        return result

    def validate_relationship(
        self,
        source_id: str,
        target_id: str,
        predicate: str,
        source_layer: str,
        model: ModelProtocol,
    ) -> ValidationResult:
        """Perform complete validation of a relationship.

        This is the main validation entry point that runs all checks:
        - Predicate existence
        - Layer-specific validity
        - Inverse consistency
        - Cardinality constraints

        Args:
            source_id: ID of the source element
            target_id: ID of the target element
            predicate: Predicate used in the relationship
            source_layer: Layer of the source element
            model: Model instance for queries

        Returns:
            ValidationResult with all errors and warnings
        """
        result = ValidationResult()

        # 1. Check predicate exists
        pred_result = self.validate_predicate_exists(predicate)
        result.errors.extend(pred_result.errors)
        if pred_result.errors:
            return result  # Fatal error, stop here

        # 2. Check predicate is valid for layer
        layer_result = self.validate_predicate_for_layer(predicate, source_layer, source_id)
        result.errors.extend(layer_result.errors)

        # 3. Check inverse consistency
        inverse_result = self.validate_inverse_consistency(source_id, target_id, predicate, model)
        result.errors.extend(inverse_result.errors)
        result.warnings.extend(inverse_result.warnings)

        # 4. Check cardinality
        card_result = self.validate_cardinality(source_id, predicate, model)
        result.errors.extend(card_result.errors)

        return result

    def _get_relationships_from_model(self, model: Any, element_id: str) -> List[Dict[str, Any]]:
        """Get relationships for an element from the model.

        Args:
            model: Model instance
            element_id: ID of the element

        Returns:
            List of relationship dictionaries
        """
        # Use the model's get_relationships() method as defined in ModelProtocol
        return model.get_relationships(element_id)

    def get_relationship_info(self, predicate: str) -> Optional[Dict[str, Any]]:
        """Get information about a relationship predicate.

        Args:
            predicate: Predicate to query

        Returns:
            Dictionary with relationship information or None if not found
        """
        rel_type = self.registry.get_predicate(predicate)
        if not rel_type:
            return None

        return {
            "id": rel_type.id,
            "predicate": rel_type.predicate,
            "inverse_predicate": rel_type.inverse_predicate,
            "category": rel_type.category,
            "description": rel_type.description,
            "applicable_layers": rel_type.applicable_layers,
            "is_bidirectional": rel_type.is_bidirectional,
            "is_transitive": rel_type.is_transitive,
            "is_symmetric": rel_type.is_symmetric,
            "cardinality": rel_type.semantics.get("cardinality", "many-to-many"),
        }

    def list_predicates_for_layer(self, layer: str) -> List[str]:
        """Get all valid predicates for a layer.

        Args:
            layer: Layer identifier (e.g., "06-api", "07-data-model")

        Returns:
            List of valid predicate names
        """
        return self.registry.get_predicates_for_layer(layer)

    def __repr__(self) -> str:
        """String representation of the validator."""
        return (
            f"PredicateValidator(predicates={len(self.registry.predicate_map)}, "
            f"strict_mode={self.strict_mode})"
        )
