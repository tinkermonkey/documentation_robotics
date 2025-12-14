"""Relationship Count Verification - Validates consistent counting across all tools.

This script provides a comprehensive count of all relationships using multiple methods
to verify accuracy and identify discrepancies.
"""

import sys
from pathlib import Path
from collections import defaultdict

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from analysis.intra_layer_analyzer import IntraLayerAnalyzer
from utils.relationship_parser import RelationshipParser
from utils.link_registry import LinkRegistry


def main():
    print("=" * 100)
    print(" " * 35 + "RELATIONSHIP COUNT VERIFICATION")
    print("=" * 100)
    print()

    # Initialize tools
    analyzer = IntraLayerAnalyzer()
    parser = RelationshipParser()
    registry = LinkRegistry()

    spec_root = Path.cwd() / "spec"
    layers_path = spec_root / "layers"

    # Storage for counts
    layer_counts = {}

    print("INTRA-LAYER RELATIONSHIPS (per layer)")
    print("=" * 100)
    print(f"{'Layer':<35} {'Raw XML Tags':<15} {'Unique (Dedup)':<18} {'Bidirectional':<18}")
    print("-" * 100)

    total_raw = 0
    total_unique = 0
    total_bidirectional = 0

    for layer_file in sorted(layers_path.glob("*.md")):
        layer_id = layer_file.stem

        # Parse using relationship parser
        content = layer_file.read_text(encoding="utf-8")
        parse_result = parser.parse_all_formats(content, layer_id, layer_file)

        # Count XML relationships (intra-layer)
        xml_rels = [r for r in parse_result.relationships if r.format_type == "xml_relationship"]
        raw_count = len(xml_rels)

        if raw_count == 0:
            continue

        # Analyze using intra-layer analyzer
        try:
            analysis = analyzer.analyze_layer(layer_id.split("-")[0])
            unique_count = analysis.total_relationships
            bidirectional_count = sum(
                p.total_relationships for p in analysis.entity_profiles.values()
            )
        except Exception as e:
            print(f"Warning: Could not analyze {layer_id}: {e}")
            continue

        layer_counts[layer_id] = {
            "raw": raw_count,
            "unique": unique_count,
            "bidirectional": bidirectional_count,
        }

        total_raw += raw_count
        total_unique += unique_count
        total_bidirectional += bidirectional_count

        print(f"{layer_id:<35} {raw_count:<15} {unique_count:<18} {bidirectional_count:<18}")

    print("-" * 100)
    print(f"{'TOTAL':<35} {total_raw:<15} {total_unique:<18} {total_bidirectional:<18}")
    print()

    # Inter-layer relationships
    print("=" * 100)
    print("INTER-LAYER RELATIONSHIPS (cross-layer properties)")
    print("=" * 100)
    print(f"{'Layer':<35} {'YAML Props':<15} {'XML Props':<15} {'Total':<15}")
    print("-" * 100)

    total_yaml = 0
    total_xml_props = 0

    for layer_file in sorted(layers_path.glob("*.md")):
        layer_id = layer_file.stem
        content = layer_file.read_text(encoding="utf-8")

        parse_result = parser.parse_all_formats(content, layer_id, layer_file)

        yaml_count = sum(
            1 for r in parse_result.relationships
            if r.format_type == "yaml_property" and r.is_cross_layer
        )
        xml_prop_count = sum(
            1 for r in parse_result.relationships
            if r.format_type == "xml_property" and r.is_cross_layer
        )

        total = yaml_count + xml_prop_count
        if total > 0:
            print(f"{layer_id:<35} {yaml_count:<15} {xml_prop_count:<15} {total:<15}")
            total_yaml += yaml_count
            total_xml_props += xml_prop_count

    print("-" * 100)
    print(f"{'TOTAL':<35} {total_yaml:<15} {total_xml_props:<15} {total_yaml + total_xml_props:<15}")
    print()

    # Grand summary
    print("=" * 100)
    print(" " * 40 + "GRAND SUMMARY")
    print("=" * 100)
    print()
    print("INTRA-LAYER (same layer):")
    print(f"  • Raw XML <relationship> tags:           {total_raw}")
    print(f"  • Unique relationships (deduplicated):   {total_unique}")
    print(f"  • Bidirectional view (double-counted):   {total_bidirectional}")
    print()
    print("INTER-LAYER (cross-layer):")
    print(f"  • YAML properties:                       {total_yaml}")
    print(f"  • XML <property> tags:                   {total_xml_props}")
    print(f"  • Total inter-layer:                     {total_yaml + total_xml_props}")
    print()
    print("TOTAL UNIQUE RELATIONSHIPS:")
    print(f"  • Intra-layer + Inter-layer:             {total_unique + total_yaml + total_xml_props}")
    print()
    print("=" * 100)
    print()

    # Verification note
    print("VERIFICATION NOTES:")
    print("-" * 100)
    print(f"✓ The 'Unique' count is the SOURCE OF TRUTH for intra-layer relationships")
    print(f"✓ The 'Bidirectional' count shows how relationships appear in entity profiles")
    print(f"✓ The 'Raw XML Tags' count may be higher than 'Unique' if there are duplicates")
    print()
    print(f"Relationship between counts:")
    print(f"  • Bidirectional ≈ Unique × 2 (each relationship counted from both entities)")
    print(f"  • Raw ≥ Unique (raw may include duplicate tags)")
    print()
    print("=" * 100)


if __name__ == "__main__":
    main()
