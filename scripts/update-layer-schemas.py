#!/usr/bin/env python3
"""
Update all layer schemas with layerMetadata, intraLayerRelationships, and crossLayerRelationships.

This script reads the extracted relationship data and updates each layer schema
(Phase 2, Step 4).

Usage:
    python scripts/update-layer-schemas.py [--dry-run]
"""

import json
import argparse
from pathlib import Path
from typing import Dict, List, Any


# Layer ID to name mapping
LAYER_NAMES = {
    "01": "Motivation Layer",
    "02": "Business Layer",
    "03": "Security Layer",
    "04": "Application Layer",
    "05": "Technology Layer",
    "06": "API Layer",
    "07": "Data Model Layer",
    "08": "Data Store Layer",
    "09": "UX Layer",
    "10": "Navigation Layer",
    "11": "APM/Observability Layer",
    "12": "Testing Layer"
}

# Layer ID to filename mapping
LAYER_FILES = {
    "01": "01-motivation-layer.schema.json",
    "02": "02-business-layer.schema.json",
    "03": "03-security-layer.schema.json",
    "04": "04-application-layer.schema.json",
    "05": "05-technology-layer.schema.json",
    "06": "06-api-layer.schema.json",
    "07": "07-data-model-layer.schema.json",
    "08": "08-data-store-layer.schema.json",
    "09": "09-ux-layer.schema.json",
    "10": "10-navigation-layer.schema.json",
    "11": "11-apm-observability-layer.schema.json",
    "12": "12-testing-layer.schema.json"
}


class LayerSchemaUpdater:
    """Updates layer schemas with relationship metadata."""

    def __init__(self, spec_dir: Path, relationship_data_dir: Path):
        self.spec_dir = spec_dir
        self.schemas_dir = spec_dir / "schemas"
        self.relationship_data_dir = relationship_data_dir

    def load_relationship_data(self, layer_id: str) -> Dict:
        """Load extracted relationship data for a layer."""
        data_file = self.relationship_data_dir / f"layer-{layer_id}-relationships.json"

        if not data_file.exists():
            print(f"Warning: No relationship data found for layer {layer_id}")
            return {}

        with open(data_file, 'r', encoding='utf-8') as f:
            return json.load(f)

    def load_schema(self, layer_id: str) -> Dict:
        """Load existing layer schema."""
        schema_file = self.schemas_dir / LAYER_FILES[layer_id]

        if not schema_file.exists():
            raise FileNotFoundError(f"Schema file not found: {schema_file}")

        with open(schema_file, 'r', encoding='utf-8') as f:
            return json.load(f)

    def save_schema(self, layer_id: str, schema: Dict, dry_run: bool = False):
        """Save updated schema to file."""
        schema_file = self.schemas_dir / LAYER_FILES[layer_id]

        if dry_run:
            print(f"[DRY RUN] Would save updated schema to: {schema_file}")
            return

        with open(schema_file, 'w', encoding='utf-8') as f:
            json.dump(schema, f, indent=2, ensure_ascii=False)
            f.write('\n')  # Add trailing newline

        print(f"Updated: {schema_file}")

    def create_layer_metadata(self, layer_id: str, rel_data: Dict) -> Dict:
        """Create layerMetadata section."""
        has_intra = rel_data.get("intraLayerRelationships", {}).get("count", 0) > 0
        has_cross = (rel_data.get("crossLayerRelationships", {}).get("outgoing", {}).get("count", 0) +
                    rel_data.get("crossLayerRelationships", {}).get("incoming", {}).get("count", 0)) > 0

        return {
            "layerId": f"{layer_id}-{LAYER_FILES[layer_id].replace('.schema.json', '').replace(f'{layer_id}-', '')}",
            "layerName": LAYER_NAMES[layer_id],
            "intraLayerRelationshipSupport": has_intra,
            "crossLayerRelationshipSupport": has_cross,
            "relationshipCatalogVersion": "2.1.0"
        }

    def create_intra_layer_relationships(self, rel_data: Dict) -> Dict:
        """Create intraLayerRelationships section."""
        relationships = rel_data.get("intraLayerRelationships", {}).get("relationships", [])

        # Convert to schema format
        allowed = []
        for rel in relationships:
            allowed.append({
                "relationshipTypeId": rel["relationshipTypeId"],
                "sourceTypes": rel["sourceTypes"],
                "targetTypes": rel["targetTypes"],
                "examples": rel.get("examples", [])[:3]  # Limit to 3 examples
            })

        return {
            "$comment": "Relationships between entities within this layer. References relationship-catalog.json by ID.",
            "allowed": allowed
        }

    def create_cross_layer_relationships(self, rel_data: Dict) -> Dict:
        """Create crossLayerRelationships section."""
        outgoing_rels = rel_data.get("crossLayerRelationships", {}).get("outgoing", {}).get("relationships", [])
        incoming_rels = rel_data.get("crossLayerRelationships", {}).get("incoming", {}).get("relationships", [])

        # Convert to schema format
        outgoing = []
        for rel in outgoing_rels:
            outgoing.append({
                "id": rel["id"],
                "predicate": rel["predicate"],
                "inversePredicate": rel["inversePredicate"],
                "targetLayer": rel["targetLayer"],
                "targetTypes": rel["targetTypes"],
                "sourceTypes": rel.get("sourceTypes", []),
                "fieldPath": rel.get("fieldPath", ""),
                "cardinality": rel.get("cardinality", "array"),
                "format": rel.get("format", "uuid"),
                "strength": rel.get("strength", "medium"),
                "required": rel.get("required", False),
                "description": rel.get("description", ""),
                "examples": rel.get("examples", [])[:2]  # Limit to 2 examples
            })

        incoming = []
        for rel in incoming_rels:
            incoming.append({
                "id": rel["id"],
                "predicate": rel["predicate"],
                "inversePredicate": rel["inversePredicate"],
                "sourceLayer": rel["sourceLayer"],
                "sourceTypes": rel.get("sourceTypes", []),
                "targetTypes": rel["targetTypes"],
                "fieldPath": rel.get("fieldPath", ""),
                "cardinality": rel.get("cardinality", "array"),
                "description": rel.get("description", "")
            })

        return {
            "$comment": "Relationships to/from entities in other layers",
            "outgoing": outgoing,
            "incoming": incoming
        }

    def update_layer_schema(self, layer_id: str, dry_run: bool = False):
        """Update a single layer schema with relationship data."""
        print(f"\n=== Updating Layer {layer_id} ({LAYER_NAMES[layer_id]}) ===")

        # Skip if already updated (testing layer)
        if layer_id == "12":
            print(f"Layer {layer_id} already updated (testing layer POC), skipping...")
            return

        # Load data
        rel_data = self.load_relationship_data(layer_id)
        schema = self.load_schema(layer_id)

        # Check if already has the new sections
        if "layerMetadata" in schema:
            print(f"Layer {layer_id} already has layerMetadata, skipping...")
            return

        # Create new sections
        layer_metadata = self.create_layer_metadata(layer_id, rel_data)
        intra_layer_rels = self.create_intra_layer_relationships(rel_data)
        cross_layer_rels = self.create_cross_layer_relationships(rel_data)

        # Insert new sections at the beginning (after $schema, $id, title, description)
        new_schema = {}

        # Copy preamble
        for key in ["$schema", "$id", "title", "description"]:
            if key in schema:
                new_schema[key] = schema[key]

        # Add new sections
        new_schema["layerMetadata"] = layer_metadata

        if intra_layer_rels["allowed"]:
            new_schema["intraLayerRelationships"] = intra_layer_rels

        if cross_layer_rels["outgoing"] or cross_layer_rels["incoming"]:
            new_schema["crossLayerRelationships"] = cross_layer_rels

        # Copy remaining sections
        for key in schema:
            if key not in ["$schema", "$id", "title", "description"]:
                new_schema[key] = schema[key]

        # Print summary
        intra_count = len(intra_layer_rels["allowed"])
        outgoing_count = len(cross_layer_rels["outgoing"])
        incoming_count = len(cross_layer_rels["incoming"])

        print(f"  - Added layerMetadata")
        if intra_count > 0:
            print(f"  - Added {intra_count} intra-layer relationship types")
        if outgoing_count > 0 or incoming_count > 0:
            print(f"  - Added {outgoing_count} outgoing, {incoming_count} incoming cross-layer relationships")

        # Save
        self.save_schema(layer_id, new_schema, dry_run)

    def update_all_schemas(self, dry_run: bool = False):
        """Update all layer schemas."""
        print("Starting layer schema updates...")

        for layer_id in sorted(LAYER_FILES.keys()):
            try:
                self.update_layer_schema(layer_id, dry_run)
            except Exception as e:
                print(f"Error updating layer {layer_id}: {e}")
                if not dry_run:
                    raise

        print("\n=== Schema Updates Complete ===")


def main():
    parser = argparse.ArgumentParser(
        description="Update layer schemas with relationship metadata"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )
    parser.add_argument(
        "--spec-dir",
        type=Path,
        default=Path("spec"),
        help="Specification directory (default: spec/)"
    )
    parser.add_argument(
        "--relationship-data-dir",
        type=Path,
        default=Path("scripts/migration/relationship-data"),
        help="Directory with extracted relationship data (default: scripts/migration/relationship-data/)"
    )

    args = parser.parse_args()

    # Validate directories
    if not args.spec_dir.exists():
        print(f"Error: Spec directory not found: {args.spec_dir}")
        return 1

    if not args.relationship_data_dir.exists():
        print(f"Error: Relationship data directory not found: {args.relationship_data_dir}")
        return 1

    # Create and run updater
    updater = LayerSchemaUpdater(args.spec_dir, args.relationship_data_dir)
    updater.update_all_schemas(args.dry_run)

    return 0


if __name__ == "__main__":
    exit(main())
