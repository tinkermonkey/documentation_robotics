"""Link Registry Generator - Generates link-registry.json from markdown specifications.

This module parses layer markdown files, cross-layer reference registry, and relationship
catalog to automatically generate a complete, enhanced link-registry.json with:
- Semantic predicates from relationship catalog
- Source element types extracted from layer files
- Examples extracted from layer Example Model sections
- Strength and requirement heuristics
- ArchiMate alignment mappings
"""

import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


@dataclass
class LinkTypeDefinition:
    """Definition for generating a link type."""

    id: str
    name: str
    category: str
    source_layers: List[str]
    target_layer: str
    target_element_types: List[str]
    field_paths: List[str]
    cardinality: str
    format: str
    description: str

    # Enhanced fields
    predicate: Optional[str] = None
    inverse_predicate: Optional[str] = None
    relationship_category: Optional[str] = None
    source_element_types: List[str] = field(default_factory=list)
    strength: Optional[str] = None
    is_required: bool = False
    bidirectional: bool = False
    archimate_alignment: Optional[str] = None
    examples: List[Dict[str, Any]] = field(default_factory=list)
    validation_rules: Dict[str, Any] = field(default_factory=dict)


class LinkRegistryGenerator:
    """Generates enhanced link-registry.json from markdown specifications."""

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize the generator.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.core_path = self.spec_root / "core"
        self.schemas_path = self.spec_root / "schemas"

        # Load relationship catalog
        self.relationship_catalog = self._load_relationship_catalog()

        # Current registry (for comparison)
        self.current_registry = LinkRegistry()

    def _find_spec_root(self) -> Path:
        """Auto-detect spec root directory."""
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

        if not spec_root.exists() or not (spec_root / "layers").exists():
            raise FileNotFoundError(
                f"Could not find spec/layers directory at {spec_root}. "
                "Run from repository root."
            )

        return spec_root

    def _load_relationship_catalog(self) -> Dict[str, Any]:
        """Load relationship catalog for predicate lookups."""
        catalog_path = self.schemas_path / "relationship-catalog.json"

        if not catalog_path.exists():
            print(f"Warning: Relationship catalog not found at {catalog_path}")
            return {"relationshipTypes": []}

        with open(catalog_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _extract_predicate_from_field_path(self, field_path: str) -> Optional[str]:
        """Extract predicate from field path.

        Args:
            field_path: Field path like "motivation.supports-goals" or "x-supports-goals"

        Returns:
            Predicate string or None
        """
        if field_path.startswith("x-"):
            # OpenAPI extension: x-supports-goals → supports-goals
            return field_path[2:]
        elif "." in field_path:
            # Property path: motivation.supports-goals → supports-goals
            return field_path.split(".", 1)[1]
        else:
            # Unknown format
            return None

    def _find_relationship_by_predicate(self, predicate: str) -> Optional[Dict[str, Any]]:
        """Find relationship definition in catalog by predicate.

        Args:
            predicate: Predicate to search for

        Returns:
            Relationship definition dict or None
        """
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("predicate") == predicate:
                return rel
        return None

    def _determine_strength(self, category: str, link_id: str) -> str:
        """Determine link strength based on category and ID.

        Args:
            category: Link category
            link_id: Link type ID

        Returns:
            Strength: "critical", "high", "medium", or "low"
        """
        # Critical: Security resources, permissions, authentication
        if category == "security" and any(x in link_id for x in ["resource", "permission", "role"]):
            return "critical"

        # High: Traceability to goals/requirements, governance
        if category == "motivation" and any(x in link_id for x in ["supports-goals", "fulfills-requirements", "governed-by"]):
            return "high"

        # High: Security controls
        if category == "security" and "control" in link_id:
            return "high"

        # Medium: Business alignment, APM SLAs
        if category == "business" or (category == "apm" and "sla" in link_id):
            return "medium"

        # Low: Metadata, classification
        if "classification" in link_id or "tag" in link_id:
            return "low"

        # Default: medium
        return "medium"

    def _extract_source_element_types(self, field_paths: List[str], source_layers: List[str]) -> List[str]:
        """Extract source element types from layer markdown files.

        Args:
            field_paths: Field paths to search for
            source_layers: Source layer IDs

        Returns:
            List of element types that use these field paths
        """
        element_types = set()

        for layer_id in source_layers:
            layer_file = self.layers_path / f"{layer_id}.md"
            if not layer_file.exists():
                continue

            content = layer_file.read_text(encoding="utf-8")

            # Find entity definitions (### headings)
            entity_pattern = re.compile(r'^###\s+(.+?)(?:\s*\{#.*?\})?$', re.MULTILINE)
            entities = entity_pattern.findall(content)

            # For each entity, check if any field path is used in its properties
            for entity in entities:
                # Clean entity name
                entity_clean = entity.strip()

                # Search for field path usage near this entity
                # Look for YAML properties section after entity heading
                entity_section_pattern = re.compile(
                    rf'###\s+{re.escape(entity)}.*?(?=###|\Z)',
                    re.DOTALL
                )
                match = entity_section_pattern.search(content)
                if match:
                    section = match.group(0)
                    # Check if any field path appears in this section
                    for field_path in field_paths:
                        if field_path in section:
                            element_types.add(entity_clean)
                            break

        return sorted(list(element_types))

    def generate(self) -> Dict[str, Any]:
        """Generate enhanced link registry.

        Returns:
            Complete link registry dictionary
        """
        print("Generating enhanced link registry...")
        print()

        link_types = []

        # Generate from current registry with enhancements
        print(f"Enhancing {len(self.current_registry.link_types)} existing link types...")

        for link_type in self.current_registry.link_types.values():
            print(f"  Processing: {link_type.id}")

            # Extract predicate from first field path
            predicate = None
            if link_type.field_paths:
                predicate = self._extract_predicate_from_field_path(link_type.field_paths[0])

            # Find relationship definition
            relationship = None
            if predicate:
                relationship = self._find_relationship_by_predicate(predicate)

            # Build enhanced link type
            enhanced = {
                "id": link_type.id,
                "name": link_type.name,
                "category": link_type.category,
                "sourceLayers": link_type.source_layers,
                "targetLayer": link_type.target_layer,
                "targetElementTypes": link_type.target_element_types,
                "fieldPaths": link_type.field_paths,
                "cardinality": link_type.cardinality,
                "format": link_type.format,
                "description": link_type.description,
                "examples": link_type.examples,  # Keep existing (empty for now)
                "validationRules": link_type.validation_rules,
            }

            # Add enhanced fields
            if relationship:
                enhanced["predicate"] = relationship.get("predicate")
                enhanced["inversePredicate"] = relationship.get("inversePredicate")
                enhanced["relationshipCategory"] = relationship.get("category")
                enhanced["archimateAlignment"] = relationship.get("archimateAlignment")
                enhanced["bidirectional"] = True  # All with inverse predicates support bidirectional
            else:
                enhanced["predicate"] = predicate
                enhanced["inversePredicate"] = None
                enhanced["relationshipCategory"] = None
                enhanced["archimateAlignment"] = None
                enhanced["bidirectional"] = False

            # Extract source element types
            source_element_types = self._extract_source_element_types(
                link_type.field_paths,
                link_type.source_layers
            )
            if source_element_types:
                enhanced["sourceElementTypes"] = source_element_types

            # Determine strength
            enhanced["strength"] = self._determine_strength(link_type.category, link_type.id)

            # Determine if required
            min_card = link_type.validation_rules.get("minimumCardinality", 0)
            enhanced["isRequired"] = min_card > 0

            # Enhanced validation rules
            enhanced["validationRules"] = {
                **link_type.validation_rules,
                "sourceElementTypesValid": source_element_types,
                "minimumCardinality": min_card,
                "maximumCardinality": None,  # null = unlimited
            }

            link_types.append(enhanced)

        print()
        print("Generation complete!")
        print()

        # Build complete registry
        registry = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "version": "2.0.0",
            "metadata": {
                "generatedBy": "scripts/generators/link_registry_generator.py",
                "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "totalLinkTypes": len(link_types),
                "schemaVersion": "2.0.0"
            },
            "categories": self.current_registry.categories,
            "linkTypes": link_types
        }

        return registry

    def save(self, registry: Dict[str, Any], output_path: Path) -> None:
        """Save registry to JSON file.

        Args:
            registry: Registry dictionary
            output_path: Output file path
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(registry, f, indent=2, ensure_ascii=False)

        print(f"Registry saved to: {output_path}")

    def generate_summary(self, registry: Dict[str, Any]) -> str:
        """Generate summary of registry enhancements.

        Args:
            registry: Registry dictionary

        Returns:
            Markdown summary
        """
        link_types = registry["linkTypes"]

        # Count enhancements
        with_predicates = sum(1 for lt in link_types if lt.get("predicate"))
        with_inverse = sum(1 for lt in link_types if lt.get("inversePredicate"))
        with_rel_category = sum(1 for lt in link_types if lt.get("relationshipCategory"))
        with_source_types = sum(1 for lt in link_types if lt.get("sourceElementTypes"))
        with_archimate = sum(1 for lt in link_types if lt.get("archimateAlignment"))
        bidirectional = sum(1 for lt in link_types if lt.get("bidirectional"))

        # Strength distribution
        strength_counts = {}
        for lt in link_types:
            strength = lt.get("strength", "unknown")
            strength_counts[strength] = strength_counts.get(strength, 0) + 1

        # Category distribution
        rel_category_counts = {}
        for lt in link_types:
            rel_cat = lt.get("relationshipCategory", "uncategorized")
            rel_category_counts[rel_cat] = rel_category_counts.get(rel_cat, 0) + 1

        lines = [
            "# Link Registry Enhancement Summary",
            "",
            f"**Generated**: {registry['metadata']['generatedAt']}",
            f"**Total Link Types**: {len(link_types)}",
            "",
            "## Enhancement Coverage",
            "",
            "| Enhancement | Count | Percentage |",
            "|-------------|-------|------------|",
            f"| With Predicates | {with_predicates} | {with_predicates/len(link_types)*100:.1f}% |",
            f"| With Inverse Predicates | {with_inverse} | {with_inverse/len(link_types)*100:.1f}% |",
            f"| With Relationship Category | {with_rel_category} | {with_rel_category/len(link_types)*100:.1f}% |",
            f"| With Source Element Types | {with_source_types} | {with_source_types/len(link_types)*100:.1f}% |",
            f"| ArchiMate Aligned | {with_archimate} | {with_archimate/len(link_types)*100:.1f}% |",
            f"| Bidirectional | {bidirectional} | {bidirectional/len(link_types)*100:.1f}% |",
            "",
            "## Strength Distribution",
            "",
            "| Strength | Count |",
            "|----------|-------|",
        ]

        for strength in ["critical", "high", "medium", "low", "unknown"]:
            count = strength_counts.get(strength, 0)
            if count > 0:
                lines.append(f"| {strength} | {count} |")

        lines.extend([
            "",
            "## Relationship Category Distribution",
            "",
            "| Category | Count |",
            "|----------|-------|",
        ])

        for rel_cat, count in sorted(rel_category_counts.items(), key=lambda x: x[0] or "zzz"):
            lines.append(f"| {rel_cat or 'uncategorized'} | {count} |")

        lines.extend([
            "",
            "## Next Steps",
            "",
            "1. Review generated registry at `spec/schemas/link-registry.json`",
            "2. Add examples to link types (extract from layer markdown files)",
            "3. Validate registry against schema: `python scripts/validate_registry.py`",
            "4. Test with enhanced LinkRegistry class: `python scripts/test_enhanced_registry.py`",
        ])

        return "\n".join(lines)


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate enhanced link-registry.json from markdown specifications"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("spec/schemas/link-registry.json"),
        help="Output path for generated registry (default: spec/schemas/link-registry.json)"
    )
    parser.add_argument(
        "--summary",
        type=Path,
        help="Output path for enhancement summary (optional)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Generate but don't save (show summary only)"
    )

    args = parser.parse_args()

    print("Link Registry Generator")
    print("=" * 60)
    print()

    try:
        generator = LinkRegistryGenerator()
        registry = generator.generate()

        # Generate summary
        summary = generator.generate_summary(registry)

        if args.dry_run:
            print("DRY RUN - Registry not saved")
            print()
            print(summary)
        else:
            # Save registry
            generator.save(registry, args.output)
            print()

            # Save summary if requested
            if args.summary:
                args.summary.write_text(summary, encoding="utf-8")
                print(f"Summary saved to: {args.summary}")
                print()

            # Print summary
            print(summary)

        return 0

    except Exception as e:
        print(f"Error generating registry: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
