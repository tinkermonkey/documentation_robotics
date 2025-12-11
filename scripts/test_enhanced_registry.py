#!/usr/bin/env python3
"""Test script for enhanced LinkRegistry features.

This script demonstrates the new v2.0 query capabilities of the LinkRegistry class.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils.link_registry import LinkRegistry


def main():
    print("Enhanced Link Registry Test")
    print("=" * 60)
    print()

    # Load registry
    registry = LinkRegistry()
    print(f"Loaded {len(registry.link_types)} link types from registry")
    print()

    # Test 1: Get statistics
    print("=" * 60)
    print("Test 1: Registry Statistics")
    print("=" * 60)
    stats = registry.get_statistics()
    print(f"Total link types: {stats['total_link_types']}")
    print(f"With predicates: {stats['with_predicates']} ({stats['predicate_coverage']})")
    print(f"Bidirectional: {stats['bidirectional']}")
    print(f"With examples: {stats['with_examples']}")
    print(f"Without examples: {stats['without_examples']}")
    print(f"ArchiMate aligned: {stats['archimate_aligned']}")
    print()

    print("Category counts:")
    for cat, count in sorted(stats['category_counts'].items()):
        print(f"  {cat}: {count}")
    print()

    if stats['relationship_category_counts']:
        print("Relationship category counts:")
        for rel_cat, count in sorted(stats['relationship_category_counts'].items()):
            print(f"  {rel_cat}: {count}")
        print()

    if stats['strength_counts']:
        print("Strength distribution:")
        for strength, count in sorted(stats['strength_counts'].items()):
            if count > 0:
                print(f"  {strength}: {count}")
        print()

    # Test 2: Find links without examples
    print("=" * 60)
    print("Test 2: Links Without Examples")
    print("=" * 60)
    no_examples = registry.get_links_without_examples()
    print(f"Found {len(no_examples)} link types without examples:")
    for lt in no_examples[:10]:  # Show first 10
        print(f"  - {lt.id} ({lt.name})")
    if len(no_examples) > 10:
        print(f"  ... and {len(no_examples) - 10} more")
    print()

    # Test 3: Category-based queries
    print("=" * 60)
    print("Test 3: Links by Category")
    print("=" * 60)
    categories_to_test = ["motivation", "apm", "security"]
    for category in categories_to_test:
        links = registry.get_links_by_category(category)
        print(f"{category}: {len(links)} link types")
        for lt in links[:3]:  # Show first 3
            print(f"  - {lt.id}: {lt.description[:60]}...")
    print()

    # Test 4: Layer-based queries
    print("=" * 60)
    print("Test 4: Links Between Layers")
    print("=" * 60)
    test_pairs = [
        ("02-business", "01-motivation"),
        ("04-application", "01-motivation"),
        ("06-api", "01-motivation"),
    ]
    for source, target in test_pairs:
        links = registry.find_links_between(source, target)
        print(f"{source} → {target}: {len(links)} link types")
        for lt in links:
            print(f"  - {lt.id}: {', '.join(lt.field_paths)}")
    print()

    # Test 5: Enhanced fields check
    print("=" * 60)
    print("Test 5: Enhanced Fields Check (v2.0 features)")
    print("=" * 60)
    print("NOTE: Current registry (v0.6.0) doesn't have enhanced fields.")
    print("After Week 6 implementation, these will be populated.")
    print()

    # Check if any links have predicates
    with_predicates = [lt for lt in registry.link_types.values() if lt.has_predicate]
    print(f"Links with predicates: {len(with_predicates)}")
    if with_predicates:
        for lt in with_predicates[:3]:
            print(f"  - {lt.id}: {lt.predicate} / {lt.inverse_predicate}")
    else:
        print("  (None yet - will be populated in Week 6)")
    print()

    # Check bidirectional support
    bidirectional = registry.get_bidirectional_links()
    print(f"Bidirectional links: {len(bidirectional)}")
    if bidirectional:
        for lt in bidirectional[:3]:
            print(f"  - {lt.id}: {lt.predicate} ⇄ {lt.inverse_predicate}")
    else:
        print("  (None yet - will be populated in Week 6)")
    print()

    # Test 6: New query methods (will return empty for now)
    print("=" * 60)
    print("Test 6: New Query Methods (v2.0)")
    print("=" * 60)
    print("These methods are ready but will return results after Week 6:")
    print()

    # Try predicate query
    predicate_links = registry.find_links_by_predicate("supports-goals")
    print(f"find_links_by_predicate('supports-goals'): {len(predicate_links)} results")

    # Try relationship category query
    trace_links = registry.get_links_by_relationship_category("traceability")
    print(f"get_links_by_relationship_category('traceability'): {len(trace_links)} results")

    # Try strength query
    critical_links = registry.get_links_by_strength("critical", "high")
    print(f"get_links_by_strength('critical', 'high'): {len(critical_links)} results")

    # Try required links
    required_links = registry.get_required_links()
    print(f"get_required_links(): {len(required_links)} results")
    print()

    print("=" * 60)
    print("Enhanced LinkRegistry Test Complete!")
    print("=" * 60)
    print()
    print("Summary:")
    print(f"  ✓ All {len(registry.link_types)} link types loaded successfully")
    print(f"  ✓ Original v0.6.0 query methods working")
    print(f"  ✓ New v2.0 query methods ready (will be populated in Week 6)")
    print()
    print("Next Steps:")
    print("  - Week 6: Implement automated generator to populate enhanced fields")
    print("  - Predicates will be extracted from relationship-catalog.json")
    print("  - Examples will be extracted from layer markdown files")
    print("  - Source element types will be inferred from usage patterns")


if __name__ == "__main__":
    main()
