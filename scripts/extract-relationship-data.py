#!/usr/bin/env python3
"""
Extract relationship data from relationship catalog, link registry, and layer markdown files.

This script generates per-layer relationship data files for review as part of the
relationship schema migration (Phase 1, Step 2).

Usage:
    python scripts/extract-relationship-data.py [--output-dir OUTPUT_DIR]

Output:
    Creates JSON files in the specified output directory (default: scripts/migration/relationship-data/)
    with the extracted relationship data for each layer.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Any
import argparse
from collections import defaultdict


class RelationshipDataExtractor:
    """Extracts relationship data from various sources for schema migration."""

    def __init__(self, spec_dir: Path):
        self.spec_dir = spec_dir
        self.schemas_dir = spec_dir / "schemas"
        self.layers_dir = spec_dir / "layers"

        # Load source files
        self.relationship_catalog = self._load_json(self.schemas_dir / "relationship-catalog.json")
        self.link_registry = self._load_json(self.schemas_dir / "link-registry.json")

        # Storage for extracted data
        self.intra_layer_relationships = defaultdict(list)
        self.cross_layer_relationships = defaultdict(lambda: {"outgoing": [], "incoming": []})
        self.markdown_relationships = defaultdict(list)

    def _load_json(self, path: Path) -> Dict:
        """Load and parse a JSON file."""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"Warning: File not found: {path}")
            return {}
        except json.JSONDecodeError as e:
            print(f"Error parsing {path}: {e}")
            return {}

    def extract_intra_layer_relationships(self):
        """Extract intra-layer relationships from relationship catalog."""
        print("\n=== Extracting Intra-Layer Relationships ===")

        if "relationshipTypes" not in self.relationship_catalog:
            print("Warning: No relationshipTypes found in catalog")
            return

        for rel_type in self.relationship_catalog["relationshipTypes"]:
            rel_id = rel_type.get("id")
            applicable_layers = rel_type.get("applicableLayers", [])
            examples = rel_type.get("examples", [])

            # Group examples by layer
            layer_examples = defaultdict(list)
            for example in examples:
                layer = example.get("layer")
                if layer:
                    layer_examples[layer].append(example)

            # Create relationship entries for each applicable layer
            for layer_num in applicable_layers:
                # layer_num is already a string like "02"
                layer_id = str(layer_num).zfill(2)

                # Find examples for this specific layer
                layer_specific_examples = layer_examples.get(f"{layer_id}-testing", []) + \
                                         layer_examples.get(f"{layer_id}-motivation", []) + \
                                         layer_examples.get(f"{layer_id}-business", []) + \
                                         layer_examples.get(f"{layer_id}-security", []) + \
                                         layer_examples.get(f"{layer_id}-application", []) + \
                                         layer_examples.get(f"{layer_id}-technology", []) + \
                                         layer_examples.get(f"{layer_id}-api", []) + \
                                         layer_examples.get(f"{layer_id}-data-model", []) + \
                                         layer_examples.get(f"{layer_id}-datastore", []) + \
                                         layer_examples.get(f"{layer_id}-ux", []) + \
                                         layer_examples.get(f"{layer_id}-navigation", []) + \
                                         layer_examples.get(f"{layer_id}-apm-observability", [])

                # Extract source and target types from examples
                source_types = set()
                target_types = set()
                for ex in layer_specific_examples:
                    if "source" in ex:
                        source_types.add(ex["source"])
                    if "target" in ex:
                        target_types.add(ex["target"])

                # If no examples, use generic layer examples
                if not layer_specific_examples and examples:
                    # Use up to 3 generic examples
                    layer_specific_examples = examples[:3]
                    for ex in layer_specific_examples:
                        if "source" in ex:
                            source_types.add(ex["source"])
                        if "target" in ex:
                            target_types.add(ex["target"])

                relationship = {
                    "relationshipTypeId": rel_id,
                    "predicate": rel_type.get("predicate"),
                    "inversePredicate": rel_type.get("inversePredicate"),
                    "category": rel_type.get("category"),
                    "description": rel_type.get("description"),
                    "sourceTypes": sorted(list(source_types)) if source_types else ["*"],
                    "targetTypes": sorted(list(target_types)) if target_types else ["*"],
                    "examples": layer_specific_examples[:3]  # Limit to 3 examples
                }

                self.intra_layer_relationships[layer_id].append(relationship)

        # Print summary
        for layer_id, relationships in sorted(self.intra_layer_relationships.items()):
            print(f"Layer {layer_id}: {len(relationships)} intra-layer relationship types")

    def extract_cross_layer_relationships(self):
        """Extract cross-layer relationships from link registry."""
        print("\n=== Extracting Cross-Layer Relationships ===")

        if "linkTypes" not in self.link_registry:
            print("Warning: No linkTypes found in link registry")
            return

        for link_type in self.link_registry["linkTypes"]:
            link_id = link_type.get("id")
            predicate = link_type.get("predicate")
            inverse_predicate = link_type.get("inversePredicate")
            source_layers = link_type.get("sourceLayers", [])
            target_layer = link_type.get("targetLayer")

            # Determine target layer ID
            target_layer_id = self._extract_layer_id(target_layer)

            if not target_layer_id:
                continue

            # Handle each source layer
            for source_layer in source_layers:
                source_layer_id = self._extract_layer_id(source_layer)

                if not source_layer_id:
                    continue
                if not source_layer_id:
                    continue

                # Get source types for this specific layer
                source_types = link_type.get("sourceElementTypesByLayer", {}).get(source_layer,
                              link_type.get("sourceElementTypes", []))

                # Build cross-layer relationship object
                relationship = {
                    "id": link_id,
                    "predicate": predicate,
                    "inversePredicate": inverse_predicate or "referenced-by",
                    "targetLayer": target_layer,
                    "targetTypes": link_type.get("targetElementTypes", []),
                    "sourceTypes": source_types if isinstance(source_types, list) else [],
                    "fieldPath": link_type.get("fieldPaths", [""])[0] if link_type.get("fieldPaths") else "",
                    "cardinality": link_type.get("cardinality", "array"),
                    "format": link_type.get("format", "uuid"),
                    "strength": link_type.get("strength", "medium"),
                    "required": link_type.get("isRequired", False),
                    "description": link_type.get("description", ""),
                    "examples": link_type.get("examples", [])[:2]  # Limit to 2 examples
                }

                # Add to outgoing relationships for source layer
                self.cross_layer_relationships[source_layer_id]["outgoing"].append(relationship)

                # Add to incoming relationships for target layer (with adjusted perspective)
                incoming_relationship = {
                    "id": link_id,
                    "predicate": inverse_predicate or "referenced-by",
                    "inversePredicate": predicate,
                    "sourceLayer": source_layer,
                    "sourceTypes": source_types if isinstance(source_types, list) else [],
                    "targetTypes": link_type.get("targetElementTypes", []),
                    "fieldPath": link_type.get("fieldPaths", [""])[0] if link_type.get("fieldPaths") else "",
                    "cardinality": link_type.get("cardinality", "array"),
                    "description": f"Inverse of: {link_type.get('description', '')}"
                }
                self.cross_layer_relationships[target_layer_id]["incoming"].append(incoming_relationship)

        # Print summary
        for layer_id, relationships in sorted(self.cross_layer_relationships.items()):
            outgoing_count = len(relationships["outgoing"])
            incoming_count = len(relationships["incoming"])
            print(f"Layer {layer_id}: {outgoing_count} outgoing, {incoming_count} incoming cross-layer relationships")

    def _extract_layer_id(self, layer_name: str) -> str:
        """Extract layer ID from layer name (e.g., '01-motivation' from 'Motivation Layer')."""
        # Map common layer names to IDs
        layer_map = {
            "motivation": "01",
            "business": "02",
            "security": "03",
            "application": "04",
            "technology": "05",
            "api": "06",
            "data-model": "07",
            "datastore": "08",
            "ux": "09",
            "navigation": "10",
            "apm-observability": "11",
            "testing": "12"
        }

        if not layer_name:
            return ""

        # Check if already in format "XX-name"
        match = re.match(r'^(\d{2})-', layer_name)
        if match:
            return match.group(1)

        # Try to extract from descriptive name
        layer_name_lower = layer_name.lower().replace(" layer", "").replace(" ", "-")
        for name, layer_id in layer_map.items():
            if name in layer_name_lower:
                return layer_id

        return ""

    def extract_markdown_relationships(self):
        """Extract relationship information from layer markdown files."""
        print("\n=== Extracting Relationships from Layer Markdown ===")

        if not self.layers_dir.exists():
            print(f"Warning: Layers directory not found: {self.layers_dir}")
            return

        for md_file in self.layers_dir.glob("*.md"):
            layer_name = md_file.stem
            layer_id = self._extract_layer_id(layer_name)

            if not layer_id:
                continue

            content = md_file.read_text(encoding='utf-8')

            # Extract relationship sections
            rel_sections = re.findall(
                r'##\s+(?:Intra-Layer\s+)?Relationships\s*\n(.*?)(?=\n##|\Z)',
                content,
                re.DOTALL | re.IGNORECASE
            )

            cross_layer_sections = re.findall(
                r'##\s+Cross-Layer\s+Relationships\s*\n(.*?)(?=\n##|\Z)',
                content,
                re.DOTALL | re.IGNORECASE
            )

            if rel_sections or cross_layer_sections:
                self.markdown_relationships[layer_id] = {
                    "intra_layer_sections": rel_sections,
                    "cross_layer_sections": cross_layer_sections,
                    "has_content": bool(rel_sections or cross_layer_sections)
                }
                print(f"Layer {layer_id} ({layer_name}): Found relationship documentation")

    def generate_layer_data_files(self, output_dir: Path):
        """Generate per-layer JSON files with extracted relationship data."""
        print(f"\n=== Generating Layer Data Files ===")

        output_dir.mkdir(parents=True, exist_ok=True)

        # Get all unique layer IDs
        all_layer_ids = set(self.intra_layer_relationships.keys()) | \
                       set(self.cross_layer_relationships.keys()) | \
                       set(self.markdown_relationships.keys())

        for layer_id in sorted(all_layer_ids):
            layer_data = {
                "layerId": layer_id,
                "intraLayerRelationships": {
                    "count": len(self.intra_layer_relationships.get(layer_id, [])),
                    "relationships": self.intra_layer_relationships.get(layer_id, [])
                },
                "crossLayerRelationships": {
                    "outgoing": {
                        "count": len(self.cross_layer_relationships.get(layer_id, {}).get("outgoing", [])),
                        "relationships": self.cross_layer_relationships.get(layer_id, {}).get("outgoing", [])
                    },
                    "incoming": {
                        "count": len(self.cross_layer_relationships.get(layer_id, {}).get("incoming", [])),
                        "relationships": self.cross_layer_relationships.get(layer_id, {}).get("incoming", [])
                    }
                },
                "markdownDocumentation": self.markdown_relationships.get(layer_id, {
                    "has_content": False
                })
            }

            output_file = output_dir / f"layer-{layer_id}-relationships.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(layer_data, f, indent=2, ensure_ascii=False)

            print(f"Generated: {output_file}")

        # Generate summary file
        summary = {
            "totalLayers": len(all_layer_ids),
            "layers": {}
        }

        for layer_id in sorted(all_layer_ids):
            intra_count = len(self.intra_layer_relationships.get(layer_id, []))
            outgoing_count = len(self.cross_layer_relationships.get(layer_id, {}).get("outgoing", []))
            incoming_count = len(self.cross_layer_relationships.get(layer_id, {}).get("incoming", []))
            has_docs = self.markdown_relationships.get(layer_id, {}).get("has_content", False)

            summary["layers"][layer_id] = {
                "intraLayerRelationships": intra_count,
                "outgoingCrossLayerRelationships": outgoing_count,
                "incomingCrossLayerRelationships": incoming_count,
                "hasMarkdownDocumentation": has_docs
            }

        summary_file = output_dir / "relationship-extraction-summary.json"
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        print(f"\nGenerated summary: {summary_file}")
        print(f"\nTotal files generated: {len(all_layer_ids) + 1}")

    def run(self, output_dir: Path):
        """Execute the full extraction process."""
        print("Starting relationship data extraction...")

        self.extract_intra_layer_relationships()
        self.extract_cross_layer_relationships()
        self.extract_markdown_relationships()
        self.generate_layer_data_files(output_dir)

        print("\n=== Extraction Complete ===")


def main():
    parser = argparse.ArgumentParser(
        description="Extract relationship data from catalog, registry, and markdown files"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("scripts/migration/relationship-data"),
        help="Output directory for extracted data files (default: scripts/migration/relationship-data/)"
    )
    parser.add_argument(
        "--spec-dir",
        type=Path,
        default=Path("spec"),
        help="Specification directory containing schemas and layers (default: spec/)"
    )

    args = parser.parse_args()

    # Validate spec directory exists
    if not args.spec_dir.exists():
        print(f"Error: Spec directory not found: {args.spec_dir}")
        return 1

    # Create and run extractor
    extractor = RelationshipDataExtractor(args.spec_dir)
    extractor.run(args.output_dir)

    return 0


if __name__ == "__main__":
    exit(main())
