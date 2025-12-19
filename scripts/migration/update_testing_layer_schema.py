#!/usr/bin/env python3
"""
Update 12-testing-layer.schema.json with relationship sections
"""

import json
from pathlib import Path


def main():
    repo_root = Path(__file__).parent.parent.parent

    # Load the testing layer schema
    schema_path = repo_root / 'spec' / 'schemas' / '12-testing-layer.schema.json'
    print(f"Loading {schema_path}...")
    with open(schema_path, 'r') as f:
        schema = json.load(f)

    # Load the extracted relationship data
    data_path = repo_root / 'scripts' / 'migration' / 'extracted-data' / '12-testing-relationships.json'
    print(f"Loading {data_path}...")
    with open(data_path, 'r') as f:
        rel_data = json.load(f)

    # Fix the layer name to be properly capitalized
    rel_data['layerMetadata']['layerName'] = 'Testing Layer'

    # For the testing layer, we need to fix the cross-layer relationships since the extracted data
    # has generic examples. Let's simplify to just the predicates we know should exist.
    # Based on the layer markdown, testing layer should link to motivation layer
    rel_data['crossLayerRelationships']['outgoing'] = [
        {
            "id": "testing-supports-goals",
            "predicate": "supports-goals",
            "inversePredicate": "supported-by",
            "targetLayer": "01-motivation",
            "targetTypes": ["Goal"],
            "sourceTypes": ["TestCoverageModel", "TestCaseSketch"],
            "fieldPath": "motivation.supports-goals",
            "cardinality": "array",
            "format": "uuid",
            "strength": "high",
            "required": False,
            "description": "Testing elements support strategic goals"
        },
        {
            "id": "testing-fulfills-requirements",
            "predicate": "fulfills-requirements",
            "inversePredicate": "fulfilled-by",
            "targetLayer": "01-motivation",
            "targetTypes": ["Requirement"],
            "sourceTypes": ["TestCoverageModel", "TestCaseSketch", "CoverageRequirement"],
            "fieldPath": "motivation.fulfills-requirements",
            "cardinality": "array",
            "format": "uuid",
            "strength": "high",
            "required": False,
            "description": "Testing elements fulfill requirements"
        },
        {
            "id": "testing-governed-by-principles",
            "predicate": "governed-by-principles",
            "inversePredicate": "governs",
            "targetLayer": "01-motivation",
            "targetTypes": ["Principle"],
            "sourceTypes": ["TestCoverageModel"],
            "fieldPath": "motivation.governed-by-principles",
            "cardinality": "array",
            "format": "uuid",
            "strength": "high",
            "required": False,
            "description": "Testing models governed by testing principles"
        },
        {
            "id": "testing-constrained-by",
            "predicate": "constrained-by",
            "inversePredicate": "constrains",
            "targetLayer": "01-motivation",
            "targetTypes": ["Constraint"],
            "sourceTypes": ["TestCoverageModel", "CoverageRequirement"],
            "fieldPath": "motivation.constrained-by",
            "cardinality": "array",
            "format": "uuid",
            "strength": "medium",
            "required": False,
            "description": "Testing elements constrained by limitations"
        }
    ]

    # Create new schema with relationship sections inserted after description
    new_schema = {
        "$schema": schema["$schema"],
        "$id": schema["$id"],
        "title": schema["title"],
        "description": schema["description"],

        # NEW: Relationship sections
        "layerMetadata": rel_data["layerMetadata"],
        "intraLayerRelationships": rel_data["intraLayerRelationships"],
        "crossLayerRelationships": rel_data["crossLayerRelationships"],

        # Existing schema content
        "type": schema["type"],
        "properties": schema["properties"],
        "definitions": schema.get("definitions", {})
    }

    # Write updated schema
    print(f"Writing updated schema to {schema_path}...")
    with open(schema_path, 'w') as f:
        json.dump(new_schema, f, indent=2)

    print("✓ Testing layer schema updated successfully!")
    print(f"  - Added layerMetadata section")
    print(f"  - Added {len(rel_data['intraLayerRelationships']['allowed'])} intra-layer relationship types")
    print(f"  - Added {len(rel_data['crossLayerRelationships']['outgoing'])} outgoing cross-layer relationships")
    print(f"  - Added {len(rel_data['crossLayerRelationships']['incoming'])} incoming cross-layer relationships")


if __name__ == '__main__':
    main()
