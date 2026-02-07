#!/usr/bin/env python3
"""
Extract relationship data from relationship-catalog.json and link-registry.json
to prepare for migration into layer schemas.

Generates per-layer JSON files with:
- Intra-layer relationships (from relationship catalog)
- Cross-layer relationships outgoing (from link registry and layer markdown)
- Cross-layer relationships incoming (inferred from other layers' outgoing)
"""

import json
import sys
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any

# Layer IDs
LAYERS = [
    "01-motivation",
    "02-business",
    "03-security",
    "04-application",
    "05-technology",
    "06-api",
    "07-data-model",
    "08-data-store",
    "09-ux",
    "10-navigation",
    "11-apm-observability",
    "12-testing"
]


def load_json(file_path: Path) -> Dict:
    """Load JSON file"""
    with open(file_path, 'r') as f:
        return json.load(f)


def extract_intra_layer_relationships(catalog: Dict) -> Dict[str, List[Dict]]:
    """Extract intra-layer relationships from relationship catalog, organized by layer"""

    intra_layer_by_layer = defaultdict(list)

    for rel_type in catalog['relationshipTypes']:
        rel_id = rel_type['id']
        predicate = rel_type['predicate']
        applicable_layers = rel_type.get('applicableLayers', [])

        # Group examples by layer
        for example in rel_type.get('examples', []):
            layer = example.get('layer')
            if not layer:
                # If no layer specified, it's generic - could apply to any applicable layer
                continue

            # Normalize layer ID (handle both '12-testing' and '12' formats)
            if '-' not in layer:
                layer_num = layer
                # Find full layer ID
                layer_id = None
                for l in LAYERS:
                    if l.startswith(layer_num + '-'):
                        layer_id = l
                        break
            else:
                layer_id = layer

            if layer_id:
                intra_layer_by_layer[layer_id].append({
                    'relationshipTypeId': rel_id,
                    'predicate': predicate,
                    'source': example['source'],
                    'target': example['target'],
                    'description': example['description']
                })

    return dict(intra_layer_by_layer)


def extract_cross_layer_relationships(link_registry: Dict) -> Dict[str, Dict[str, List[Dict]]]:
    """Extract cross-layer relationships from link registry, organized by source layer"""

    cross_layer_by_layer = defaultdict(lambda: {'outgoing': [], 'incoming': []})

    for link_type in link_registry.get('linkTypes', []):
        link_id = link_type['id']
        target_layer = link_type.get('targetLayer')
        source_layers = link_type.get('sourceLayers', [])

        if not target_layer:
            continue

        # Create cross-layer relationship definition
        cross_layer_def = {
            'id': link_id,
            'predicate': link_type.get('predicate') or link_id,
            'inversePredicate': link_type.get('inversePredicate', ''),
            'targetLayer': target_layer,
            'targetTypes': link_type.get('targetElementTypes', []),
            'sourceTypes': link_type.get('sourceElementTypes', []),
            'fieldPath': link_type.get('fieldPaths', [''])[0] if link_type.get('fieldPaths') else '',
            'cardinality': link_type.get('cardinality', 'array'),
            'format': link_type.get('format', 'uuid'),
            'strength': link_type.get('strength', 'medium'),
            'required': link_type.get('isRequired', False),
            'description': link_type.get('description', ''),
            'examples': link_type.get('examples', [])
        }

        # Add as outgoing for source layers
        for source_layer in source_layers:
            cross_layer_by_layer[source_layer]['outgoing'].append(cross_layer_def)

        # Add as incoming for target layer
        incoming_def = cross_layer_def.copy()
        incoming_def['sourceLayer'] = source_layers[0] if source_layers else 'unknown'
        cross_layer_by_layer[target_layer]['incoming'].append(incoming_def)

    return dict(cross_layer_by_layer)


def merge_relationship_data(
    intra_layer: Dict[str, List[Dict]],
    cross_layer: Dict[str, Dict[str, List[Dict]]]
) -> Dict[str, Dict]:
    """Merge intra-layer and cross-layer data per layer"""

    merged = {}

    for layer_id in LAYERS:
        merged[layer_id] = {
            'layerMetadata': {
                'layerId': layer_id,
                'layerName': layer_id.replace('-', ' ').title(),
                'intraLayerRelationshipSupport': bool(intra_layer.get(layer_id)),
                'crossLayerRelationshipSupport': bool(cross_layer.get(layer_id)),
                'relationshipCatalogVersion': '2.1.0'
            },
            'intraLayerRelationships': {
                '$comment': 'Relationships between entities within this layer. References relationship-catalog.json by ID.',
                'allowed': []
            },
            'crossLayerRelationships': {
                '$comment': 'Relationships to/from entities in other layers',
                'outgoing': cross_layer.get(layer_id, {}).get('outgoing', []),
                'incoming': cross_layer.get(layer_id, {}).get('incoming', [])
            }
        }

        # Process intra-layer relationships
        if layer_id in intra_layer:
            # Group by relationship type ID
            by_type = defaultdict(lambda: {'sourceTypes': set(), 'targetTypes': set(), 'examples': []})

            for rel in intra_layer[layer_id]:
                rel_type_id = rel['relationshipTypeId']
                by_type[rel_type_id]['sourceTypes'].add(rel['source'])
                by_type[rel_type_id]['targetTypes'].add(rel['target'])
                by_type[rel_type_id]['examples'].append({
                    'source': rel['source'],
                    'target': rel['target'],
                    'description': rel['description']
                })

            # Convert to list format
            for rel_type_id, data in by_type.items():
                merged[layer_id]['intraLayerRelationships']['allowed'].append({
                    'relationshipTypeId': rel_type_id,
                    'sourceTypes': sorted(list(data['sourceTypes'])),
                    'targetTypes': sorted(list(data['targetTypes'])),
                    'examples': data['examples']
                })

    return merged


def main():
    # Paths
    repo_root = Path(__file__).parent.parent.parent
    catalog_path = repo_root / 'spec' / 'schemas' / 'relationship-catalog.json'
    link_registry_path = repo_root / 'spec' / 'schemas' / 'link-registry.json'
    output_dir = repo_root / 'scripts' / 'migration' / 'extracted-data'

    # Load data
    print("Loading relationship catalog...")
    catalog = load_json(catalog_path)

    print("Loading link registry...")
    link_registry = load_json(link_registry_path)

    # Extract data
    print("\nExtracting intra-layer relationships...")
    intra_layer = extract_intra_layer_relationships(catalog)

    for layer_id, rels in intra_layer.items():
        print(f"  {layer_id}: {len(rels)} relationship examples")

    print("\nExtracting cross-layer relationships...")
    cross_layer = extract_cross_layer_relationships(link_registry)

    for layer_id, data in cross_layer.items():
        out_count = len(data.get('outgoing', []))
        in_count = len(data.get('incoming', []))
        print(f"  {layer_id}: {out_count} outgoing, {in_count} incoming")

    # Merge data
    print("\nMerging relationship data per layer...")
    merged = merge_relationship_data(intra_layer, cross_layer)

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Write per-layer files
    print(f"\nWriting per-layer data files to {output_dir}/...")
    for layer_id, data in merged.items():
        output_file = output_dir / f"{layer_id}-relationships.json"
        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"  Written: {output_file.name}")

    # Write summary
    summary = {
        'totalLayers': len(LAYERS),
        'layersWithIntraLayerRelationships': sum(1 for d in merged.values() if d['layerMetadata']['intraLayerRelationshipSupport']),
        'layersWithCrossLayerRelationships': sum(1 for d in merged.values() if d['layerMetadata']['crossLayerRelationshipSupport']),
        'totalIntraLayerRelationshipTypes': sum(len(d['intraLayerRelationships']['allowed']) for d in merged.values()),
        'totalOutgoingCrossLayerRelationships': sum(len(d['crossLayerRelationships']['outgoing']) for d in merged.values()),
        'totalIncomingCrossLayerRelationships': sum(len(d['crossLayerRelationships']['incoming']) for d in merged.values())
    }

    summary_file = output_dir / '_summary.json'
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)

    print(f"\n✓ Extraction complete!")
    print(f"\nSummary:")
    print(f"  Layers with intra-layer relationships: {summary['layersWithIntraLayerRelationships']}/12")
    print(f"  Layers with cross-layer relationships: {summary['layersWithCrossLayerRelationships']}/12")
    print(f"  Total intra-layer relationship types: {summary['totalIntraLayerRelationshipTypes']}")
    print(f"  Total outgoing cross-layer relationships: {summary['totalOutgoingCrossLayerRelationships']}")
    print(f"  Total incoming cross-layer relationships: {summary['totalIncomingCrossLayerRelationships']}")


if __name__ == '__main__':
    main()
