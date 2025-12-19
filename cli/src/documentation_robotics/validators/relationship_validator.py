"""Relationship Validator - Validates intra-layer and cross-layer relationships.

This module provides the RelationshipValidator class which validates relationships
against layer schema definitions and the relationship catalog.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..schemas import load_relationship_catalog


class RelationshipValidator:
    """Validates relationships against layer schemas and relationship catalog."""

    def __init__(self, schema_dir: Optional[Path] = None):
        """Initialize the relationship validator.

        Args:
            schema_dir: Directory containing layer schemas. If None, uses bundled schemas.
        """
        self.schema_dir = schema_dir
        self.catalog = load_relationship_catalog()
        self.catalog_version = self.catalog.get("version", "unknown")

        # Build lookup tables
        self._relationship_types = {}
        for rel_type in self.catalog.get("relationshipTypes", []):
            self._relationship_types[rel_type["id"]] = rel_type

        # Cache for layer schemas
        self._layer_schemas = {}

    def _load_layer_schema(self, layer_schema_path: Path) -> Dict:
        """Load a layer schema file.

        Args:
            layer_schema_path: Path to the layer schema file

        Returns:
            Parsed layer schema
        """
        if layer_schema_path in self._layer_schemas:
            return self._layer_schemas[layer_schema_path]

        with open(layer_schema_path, "r", encoding="utf-8") as f:
            schema = json.load(f)

        self._layer_schemas[layer_schema_path] = schema
        return schema

    def validate_intra_layer_relationship(
        self, layer_schema_path: Path, source_type: str, target_type: str, relationship_type_id: str
    ) -> tuple[bool, Optional[str]]:
        """Validate an intra-layer relationship against the layer schema.

        Args:
            layer_schema_path: Path to the layer schema file
            source_type: Source entity type
            target_type: Target entity type
            relationship_type_id: Relationship type ID from catalog

        Returns:
            Tuple of (is_valid, error_message)
        """
        # Load layer schema
        try:
            schema = self._load_layer_schema(layer_schema_path)
        except Exception as e:
            return False, f"Failed to load layer schema: {e}"

        # Check if schema has intraLayerRelationships
        intra_rels = schema.get("intraLayerRelationships", {})
        allowed_rels = intra_rels.get("allowed", [])

        if not allowed_rels:
            return False, "Layer schema does not define any intra-layer relationships"

        # Check if this relationship type is allowed in the layer
        matching_rels = [
            rel for rel in allowed_rels if rel.get("relationshipTypeId") == relationship_type_id
        ]

        if not matching_rels:
            return False, f"Relationship type '{relationship_type_id}' not allowed in this layer"

        # Check if source and target types are valid for this relationship
        for rel in matching_rels:
            source_types = rel.get("sourceTypes", [])
            target_types = rel.get("targetTypes", [])

            # Support wildcard
            if "*" in source_types or source_type in source_types:
                if "*" in target_types or target_type in target_types:
                    return True, None

        return (
            False,
            f"Relationship '{relationship_type_id}' not allowed between {source_type} and {target_type}",
        )

    def validate_cross_layer_relationship(
        self,
        source_layer_schema_path: Path,
        target_layer: str,
        predicate: str,
        source_type: Optional[str] = None,
        target_type: Optional[str] = None,
    ) -> tuple[bool, Optional[str]]:
        """Validate a cross-layer relationship.

        Args:
            source_layer_schema_path: Path to source layer schema
            target_layer: Target layer ID (e.g., "01-motivation")
            predicate: Relationship predicate
            source_type: Optional source entity type for stricter validation
            target_type: Optional target entity type for stricter validation

        Returns:
            Tuple of (is_valid, error_message)
        """
        # Load source layer schema
        try:
            schema = self._load_layer_schema(source_layer_schema_path)
        except Exception as e:
            return False, f"Failed to load source layer schema: {e}"

        # Check if schema has crossLayerRelationships
        cross_rels = schema.get("crossLayerRelationships", {})
        outgoing_rels = cross_rels.get("outgoing", [])

        if not outgoing_rels:
            return (
                False,
                "Source layer schema does not define any outgoing cross-layer relationships",
            )

        # Find matching relationship by predicate and target layer
        matching_rels = [
            rel
            for rel in outgoing_rels
            if rel.get("predicate") == predicate and rel.get("targetLayer") == target_layer
        ]

        if not matching_rels:
            # Try matching without layer suffix
            target_layer_prefix = (
                target_layer.split("-")[0] if "-" in target_layer else target_layer
            )
            matching_rels = [
                rel
                for rel in outgoing_rels
                if rel.get("predicate") == predicate
                and rel.get("targetLayer", "").startswith(target_layer_prefix)
            ]

        if not matching_rels:
            return (
                False,
                f"No cross-layer relationship with predicate '{predicate}' to layer '{target_layer}'",
            )

        # If types are provided, validate them
        if source_type or target_type:
            for rel in matching_rels:
                source_types = rel.get("sourceTypes", [])
                target_types = rel.get("targetTypes", [])

                source_valid = not source_type or not source_types or source_type in source_types
                target_valid = not target_type or not target_types or target_type in target_types

                if source_valid and target_valid:
                    return True, None

            return (
                False,
                f"Types {source_type} -> {target_type} not valid for predicate '{predicate}'",
            )

        return True, None

    def get_allowed_intra_layer_relationships(
        self, layer_schema_path: Path
    ) -> List[Dict[str, Any]]:
        """Get all allowed intra-layer relationships for a layer.

        Args:
            layer_schema_path: Path to the layer schema file

        Returns:
            List of allowed relationship definitions
        """
        try:
            schema = self._load_layer_schema(layer_schema_path)
            return schema.get("intraLayerRelationships", {}).get("allowed", [])
        except Exception:
            return []

    def get_outgoing_cross_layer_relationships(
        self, layer_schema_path: Path
    ) -> List[Dict[str, Any]]:
        """Get all outgoing cross-layer relationships for a layer.

        Args:
            layer_schema_path: Path to the layer schema file

        Returns:
            List of outgoing relationship definitions
        """
        try:
            schema = self._load_layer_schema(layer_schema_path)
            return schema.get("crossLayerRelationships", {}).get("outgoing", [])
        except Exception:
            return []

    def get_incoming_cross_layer_relationships(
        self, layer_schema_path: Path
    ) -> List[Dict[str, Any]]:
        """Get all incoming cross-layer relationships for a layer.

        Args:
            layer_schema_path: Path to the layer schema file

        Returns:
            List of incoming relationship definitions
        """
        try:
            schema = self._load_layer_schema(layer_schema_path)
            return schema.get("crossLayerRelationships", {}).get("incoming", [])
        except Exception:
            return []

    def get_relationship_metadata(self, relationship_type_id: str) -> Optional[Dict[str, Any]]:
        """Get metadata for a relationship type from the catalog.

        Args:
            relationship_type_id: Relationship type ID

        Returns:
            Relationship metadata or None if not found
        """
        return self._relationship_types.get(relationship_type_id)

    def is_relationship_transitive(self, relationship_type_id: str) -> bool:
        """Check if a relationship type is transitive.

        Args:
            relationship_type_id: Relationship type ID

        Returns:
            True if transitive, False otherwise
        """
        rel_type = self._relationship_types.get(relationship_type_id)
        if not rel_type:
            return False

        semantics = rel_type.get("semantics", {})
        return semantics.get("transitivity", False)

    def is_relationship_symmetric(self, relationship_type_id: str) -> bool:
        """Check if a relationship type is symmetric.

        Args:
            relationship_type_id: Relationship type ID

        Returns:
            True if symmetric, False otherwise
        """
        rel_type = self._relationship_types.get(relationship_type_id)
        if not rel_type:
            return False

        semantics = rel_type.get("semantics", {})
        return semantics.get("symmetry", False)
