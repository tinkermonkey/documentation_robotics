#!/usr/bin/env python3
"""
GraphML Exporter for Documentation Robotics Specification

Exports the spec ontology (layers, entities, links, predicates) to GraphML format
for visualization in tools like Gephi, yEd, or Cytoscape.

Usage:
    python scripts/tools/export_graphml.py [--output PATH] [--include-entities]

Requirements:
    None (uses only Python standard library)
"""

import json
import argparse
from pathlib import Path
from typing import Dict, List, Any, Set
import xml.etree.ElementTree as ET
from xml.dom import minidom


class GraphMLExporter:
    """Export Documentation Robotics specification to GraphML format."""

    def __init__(self, schemas_path: str, output_path: str):
        self.schemas_path = Path(schemas_path)
        self.output_path = Path(output_path)
        self.nodes = []
        self.edges = []
        self.node_ids = set()

    def create_graphml_structure(self) -> ET.Element:
        """Create the base GraphML XML structure."""
        graphml = ET.Element('graphml', {
            'xmlns': 'http://graphml.graphdrawing.org/xmlns',
            'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            'xsi:schemaLocation': 'http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd'
        })

        # Define node attributes
        node_attrs = [
            ('d0', 'node', 'name', 'string'),
            ('d1', 'node', 'type', 'string'),
            ('d2', 'node', 'description', 'string'),
            ('d3', 'node', 'category', 'string'),
            ('d4', 'node', 'layer', 'string'),
            ('d5', 'node', 'predicate', 'string'),
            ('d6', 'node', 'strength', 'string'),
            ('d7', 'node', 'bidirectional', 'boolean'),
        ]

        # Define edge attributes
        edge_attrs = [
            ('d10', 'edge', 'relationship', 'string'),
            ('d11', 'edge', 'predicate', 'string'),
            ('d12', 'edge', 'category', 'string'),
            ('d13', 'edge', 'strength', 'string'),
        ]

        for attr_id, attr_for, attr_name, attr_type in node_attrs + edge_attrs:
            key = ET.SubElement(graphml, 'key', {
                'id': attr_id,
                'for': attr_for,
                'attr.name': attr_name,
                'attr.type': attr_type
            })

        return graphml

    def add_node(self, node_id: str, node_type: str, attributes: Dict[str, Any]):
        """Add a node to the graph."""
        if node_id in self.node_ids:
            return

        self.node_ids.add(node_id)
        self.nodes.append({
            'id': node_id,
            'type': node_type,
            'attributes': attributes
        })

    def add_edge(self, source_id: str, target_id: str, relationship: str, attributes: Dict[str, Any] = None):
        """Add an edge to the graph."""
        edge_id = f"e{len(self.edges)}"
        self.edges.append({
            'id': edge_id,
            'source': source_id,
            'target': target_id,
            'relationship': relationship,
            'attributes': attributes or {}
        })

    def load_layers(self):
        """Load layer definitions."""
        print("Loading layers...")

        layers = [
            {"id": "01", "name": "Motivation Layer", "description": "Strategic goals and requirements"},
            {"id": "02", "name": "Business Layer", "description": "Business architecture"},
            {"id": "03", "name": "Security Layer", "description": "Security models and controls"},
            {"id": "04", "name": "Application Layer", "description": "Application architecture"},
            {"id": "05", "name": "Technology Layer", "description": "Technology infrastructure"},
            {"id": "06", "name": "API Layer", "description": "API specifications"},
            {"id": "07", "name": "Data Model Layer", "description": "Data schemas"},
            {"id": "08", "name": "Datastore Layer", "description": "Database schemas"},
            {"id": "09", "name": "UX Layer", "description": "User experience"},
            {"id": "10", "name": "Navigation Layer", "description": "Navigation flows"},
            {"id": "11", "name": "APM/Observability Layer", "description": "Monitoring and observability"},
            {"id": "12", "name": "Testing Layer", "description": "Test specifications"},
        ]

        for layer in layers:
            self.add_node(
                node_id=f"layer_{layer['id']}",
                node_type='Layer',
                attributes={
                    'name': layer['name'],
                    'description': layer['description'],
                    'layer': layer['id']
                }
            )

        print(f"Loaded {len(layers)} layers")

    def load_link_types(self):
        """Load link types from link-registry.json."""
        print("Loading link types...")

        registry_path = self.schemas_path / "link-registry.json"
        if not registry_path.exists():
            print(f"WARNING: Link registry not found at {registry_path}")
            return

        with open(registry_path) as f:
            registry = json.load(f)

        link_types = registry.get("linkTypes", [])

        for lt in link_types:
            # Add LinkType node
            self.add_node(
                node_id=f"linktype_{lt['id']}",
                node_type='LinkType',
                attributes={
                    'name': lt['name'],
                    'category': lt['category'],
                    'predicate': lt.get('predicate', ''),
                    'strength': lt.get('strength', 'medium'),
                    'bidirectional': str(lt.get('bidirectional', False))
                }
            )

            # Create edges from LinkType to source layers
            for source_layer in lt.get("sourceLayers", []):
                layer_id = source_layer.split("-")[0]
                self.add_edge(
                    source_id=f"linktype_{lt['id']}",
                    target_id=f"layer_{layer_id}",
                    relationship='LINKS_FROM',
                    attributes={'predicate': lt.get('predicate', '')}
                )

            # Create edge from LinkType to target layer
            if "targetLayer" in lt:
                target_layer_id = lt["targetLayer"].split("-")[0]
                self.add_edge(
                    source_id=f"linktype_{lt['id']}",
                    target_id=f"layer_{target_layer_id}",
                    relationship='LINKS_TO',
                    attributes={
                        'predicate': lt.get('predicate', ''),
                        'category': lt['category'],
                        'strength': lt.get('strength', 'medium')
                    }
                )

        print(f"Loaded {len(link_types)} link types")

    def load_predicates(self):
        """Load predicates from relationship-catalog.json."""
        print("Loading predicates...")

        catalog_path = self.schemas_path / "relationship-catalog.json"
        if not catalog_path.exists():
            print(f"WARNING: Relationship catalog not found at {catalog_path}")
            return

        with open(catalog_path) as f:
            catalog = json.load(f)

        relationship_types = catalog.get("relationshipTypes", [])

        for rt in relationship_types:
            # Add Predicate node
            self.add_node(
                node_id=f"predicate_{rt['predicate']}",
                node_type='Predicate',
                attributes={
                    'name': rt['predicate'],
                    'category': rt['category'],
                    'description': rt.get('description', ''),
                }
            )

            # Create inverse relationship edge if exists
            if rt.get('inversePredicate'):
                # Add inverse predicate node if not already added
                inverse_id = f"predicate_{rt['inversePredicate']}"

                # Add edge showing inverse relationship
                self.add_edge(
                    source_id=f"predicate_{rt['predicate']}",
                    target_id=inverse_id,
                    relationship='INVERSE_OF',
                    attributes={'category': rt['category']}
                )

        print(f"Loaded {len(relationship_types)} predicates")

    def load_entity_types(self):
        """Load entity type definitions from layer schemas."""
        print("Loading entity types from schemas...")

        count = 0
        for schema_file in sorted(self.schemas_path.glob("*-layer.schema.json")):
            layer_id = schema_file.name[:2]

            with open(schema_file) as f:
                schema = json.load(f)

            definitions = schema.get("definitions", {})

            for entity_name, entity_def in definitions.items():
                entity_id = f"entity_{layer_id}_{entity_name}"

                self.add_node(
                    node_id=entity_id,
                    node_type='EntityType',
                    attributes={
                        'name': entity_name,
                        'layer': layer_id,
                        'description': entity_def.get('description', '')[:200]  # Truncate long descriptions
                    }
                )

                # Link entity to its layer
                self.add_edge(
                    source_id=f"layer_{layer_id}",
                    target_id=entity_id,
                    relationship='DEFINES',
                    attributes={}
                )

                count += 1

        print(f"Loaded {count} entity types")

    def link_types_to_predicates(self):
        """Create edges between LinkTypes and Predicates they use."""
        print("Linking LinkTypes to Predicates...")

        registry_path = self.schemas_path / "link-registry.json"
        with open(registry_path) as f:
            registry = json.load(f)

        count = 0
        for lt in registry.get("linkTypes", []):
            predicate = lt.get('predicate', '')
            if predicate:
                predicate_id = f"predicate_{predicate}"
                linktype_id = f"linktype_{lt['id']}"

                # Check if predicate node exists
                if any(n['id'] == predicate_id for n in self.nodes):
                    self.add_edge(
                        source_id=linktype_id,
                        target_id=predicate_id,
                        relationship='USES_PREDICATE',
                        attributes={'category': lt['category']}
                    )
                    count += 1

        print(f"Created {count} LinkType->Predicate edges")

    def link_types_to_entities(self):
        """Create edges between LinkTypes and target EntityTypes."""
        print("Linking LinkTypes to target EntityTypes...")

        registry_path = self.schemas_path / "link-registry.json"
        with open(registry_path) as f:
            registry = json.load(f)

        count = 0
        for lt in registry.get("linkTypes", []):
            target_layer = lt.get("targetLayer", "").split("-")[0]

            for target_entity_type in lt.get("targetElementTypes", []):
                entity_id = f"entity_{target_layer}_{target_entity_type}"
                linktype_id = f"linktype_{lt['id']}"

                # Check if entity exists
                if any(n['id'] == entity_id for n in self.nodes):
                    self.add_edge(
                        source_id=linktype_id,
                        target_id=entity_id,
                        relationship='TARGETS_ENTITY',
                        attributes={'category': lt['category']}
                    )
                    count += 1

        print(f"Created {count} LinkType->EntityType edges")

    def write_graphml(self):
        """Write the GraphML file."""
        print(f"Writing GraphML to {self.output_path}...")

        graphml = self.create_graphml_structure()
        graph = ET.SubElement(graphml, 'graph', {
            'id': 'DocumentationRoboticsOntology',
            'edgedefault': 'directed'
        })

        # Add all nodes
        for node in self.nodes:
            node_elem = ET.SubElement(graph, 'node', {'id': node['id']})

            # Add type
            data = ET.SubElement(node_elem, 'data', {'key': 'd1'})
            data.text = node['type']

            # Add attributes
            attr_map = {
                'name': 'd0',
                'description': 'd2',
                'category': 'd3',
                'layer': 'd4',
                'predicate': 'd5',
                'strength': 'd6',
                'bidirectional': 'd7'
            }

            for attr_name, attr_value in node['attributes'].items():
                if attr_name in attr_map and attr_value:
                    data = ET.SubElement(node_elem, 'data', {'key': attr_map[attr_name]})
                    data.text = str(attr_value)

        # Add all edges
        for edge in self.edges:
            edge_elem = ET.SubElement(graph, 'edge', {
                'id': edge['id'],
                'source': edge['source'],
                'target': edge['target']
            })

            # Add relationship type
            data = ET.SubElement(edge_elem, 'data', {'key': 'd10'})
            data.text = edge['relationship']

            # Add edge attributes
            attr_map = {
                'predicate': 'd11',
                'category': 'd12',
                'strength': 'd13'
            }

            for attr_name, attr_value in edge['attributes'].items():
                if attr_name in attr_map and attr_value:
                    data = ET.SubElement(edge_elem, 'data', {'key': attr_map[attr_name]})
                    data.text = str(attr_value)

        # Pretty print
        xml_str = ET.tostring(graphml, encoding='unicode')
        dom = minidom.parseString(xml_str)
        pretty_xml = dom.toprettyxml(indent='  ')

        # Remove extra blank lines
        pretty_xml = '\n'.join([line for line in pretty_xml.split('\n') if line.strip()])

        # Write to file
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.output_path, 'w', encoding='utf-8') as f:
            f.write(pretty_xml)

        print(f"GraphML file written successfully!")

    def generate_summary(self):
        """Print export summary."""
        print("\n" + "="*60)
        print("Export Summary")
        print("="*60)

        node_counts = {}
        for node in self.nodes:
            node_type = node['type']
            node_counts[node_type] = node_counts.get(node_type, 0) + 1

        edge_counts = {}
        for edge in self.edges:
            rel_type = edge['relationship']
            edge_counts[rel_type] = edge_counts.get(rel_type, 0) + 1

        print("\nNodes by Type:")
        for node_type, count in sorted(node_counts.items()):
            print(f"  {node_type:.<30} {count:>6}")

        print(f"\n  {'Total Nodes':.<30} {len(self.nodes):>6}")

        print("\nEdges by Relationship:")
        for rel_type, count in sorted(edge_counts.items()):
            print(f"  {rel_type:.<30} {count:>6}")

        print(f"\n  {'Total Edges':.<30} {len(self.edges):>6}")
        print("="*60)

    def export(self, include_entities: bool = True):
        """Execute complete export pipeline."""
        print("Starting GraphML export of Documentation Robotics specification...")
        print(f"Schemas: {self.schemas_path}")
        print(f"Output: {self.output_path}")
        print(f"Include entities: {include_entities}")
        print()

        self.load_layers()
        self.load_link_types()
        self.load_predicates()

        if include_entities:
            self.load_entity_types()

        self.link_types_to_predicates()

        if include_entities:
            self.link_types_to_entities()

        self.write_graphml()
        self.generate_summary()

        print(f"\n✅ Export complete! GraphML saved to: {self.output_path}")
        print("\nOpen with:")
        print("  • Gephi: File → Open")
        print("  • yEd: File → Open")
        print("  • Cytoscape: File → Import → Network from File")
        print("  • Neo4j: Use neo4j-admin import tool")


def main():
    parser = argparse.ArgumentParser(
        description="Export Documentation Robotics specification to GraphML format"
    )
    parser.add_argument(
        "--output",
        default="reports/visualization/spec-ontology.graphml",
        help="Output GraphML file path (default: reports/visualization/spec-ontology.graphml)"
    )
    parser.add_argument(
        "--schemas-path",
        default="spec/schemas",
        help="Path to schema files (default: spec/schemas)"
    )
    parser.add_argument(
        "--include-entities",
        action="store_true",
        help="Include entity type nodes (makes graph much larger)"
    )
    parser.add_argument(
        "--minimal",
        action="store_true",
        help="Export only layers and link types (excludes entities and predicates)"
    )

    args = parser.parse_args()

    exporter = GraphMLExporter(args.schemas_path, args.output)

    # Adjust what to include
    include_entities = args.include_entities and not args.minimal

    if args.minimal:
        print("Minimal export mode: layers and link types only")
        exporter.load_layers()
        exporter.load_link_types()
        exporter.write_graphml()
        exporter.generate_summary()
    else:
        exporter.export(include_entities=include_entities)


if __name__ == "__main__":
    main()
