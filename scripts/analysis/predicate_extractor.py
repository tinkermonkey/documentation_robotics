"""Predicate Extractor - Extracts all relationship predicates from documentation.

This module parses layer markdown files to extract and catalog all relationship predicates,
including property-based references, XML relationships, and OpenAPI x- extensions.
"""

import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@dataclass
class PredicateInfo:
    """Information about a single predicate."""

    predicate: str
    category: str  # Structural, Behavioral, Dependency, Governance, Alignment, Traceability
    field_paths: Set[str] = field(default_factory=set)
    usage_count: int = 0
    layers_used: Set[str] = field(default_factory=set)
    example_usages: List[Dict[str, str]] = field(default_factory=list)


@dataclass
class PredicateCatalog:
    """Complete catalog of predicates found in documentation."""

    predicates: Dict[str, PredicateInfo]
    categories: Dict[str, int]  # Count by category
    xml_relationship_types: Set[str]
    property_patterns: Set[str]
    x_extensions: Set[str]
    total_predicate_usages: int


class PredicateExtractor:
    """Extracts and catalogs relationship predicates from layer documentation."""

    # Predicate category mapping (based on common patterns)
    PREDICATE_CATEGORIES = {
        # Structural
        "composition": "Structural",
        "aggregation": "Structural",
        "specialization": "Structural",
        "realization": "Structural",
        "assignment": "Structural",
        "realizes": "Structural",
        "realized-by": "Structural",

        # Behavioral
        "triggering": "Behavioral",
        "flow": "Behavioral",
        "serving": "Behavioral",
        "access": "Behavioral",
        "triggers": "Behavioral",
        "triggered-by": "Behavioral",
        "flows-to": "Behavioral",
        "serves": "Behavioral",
        "served-by": "Behavioral",
        "accesses": "Behavioral",
        "accessed-by": "Behavioral",

        # Dependency
        "uses": "Dependency",
        "used-by": "Dependency",
        "depends-on": "Dependency",
        "references": "Dependency",
        "referenced-by": "Dependency",

        # Governance
        "governed-by-principles": "Governance",
        "constrained-by": "Governance",
        "enforces-requirement": "Governance",
        "enforced-by": "Governance",

        # Alignment/Traceability
        "supports-goals": "Traceability",
        "supported-by": "Traceability",
        "fulfills-requirements": "Traceability",
        "fulfilled-by": "Traceability",
        "delivers-value": "Traceability",
        "delivered-by": "Traceability",
        "measures-outcome": "Traceability",
        "measured-by": "Traceability",
    }

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize the predicate extractor.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"

        # Patterns for extraction
        self.property_pattern = re.compile(r'^\s*-\s+key:\s*"([^"]+)"', re.MULTILINE)
        self.xml_relationship_pattern = re.compile(
            r'<relationship\s+type="([^"]+)"\s+source="([^"]+)"\s+target="([^"]+)"\s*/>'
        )
        self.field_path_inline_pattern = re.compile(r'`([a-z]+\.[a-z-]+)`|`(x-[a-z-]+)`')
        self.table_field_path_pattern = re.compile(r'\|\s*`([^`]+)`\s*\|')

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

    def extract(self) -> PredicateCatalog:
        """Extract all predicates from layer documentation.

        Returns:
            PredicateCatalog with all extracted predicates and statistics.
        """
        predicates: Dict[str, PredicateInfo] = {}
        xml_relationship_types = set()
        property_patterns = set()
        x_extensions = set()
        total_usages = 0

        # Process each layer
        for layer_file in sorted(self.layers_path.glob("*.md")):
            layer_id = self._extract_layer_id(layer_file.name)
            if not layer_id:
                continue

            self._extract_from_layer(
                layer_file,
                layer_id,
                predicates,
                xml_relationship_types,
                property_patterns,
                x_extensions,
            )

        # Count total usages
        for pred_info in predicates.values():
            total_usages += pred_info.usage_count

        # Count by category
        categories = defaultdict(int)
        for pred_info in predicates.values():
            categories[pred_info.category] += pred_info.usage_count

        return PredicateCatalog(
            predicates=predicates,
            categories=dict(categories),
            xml_relationship_types=xml_relationship_types,
            property_patterns=property_patterns,
            x_extensions=x_extensions,
            total_predicate_usages=total_usages,
        )

    def _extract_layer_id(self, filename: str) -> Optional[str]:
        """Extract layer ID from filename."""
        match = re.match(r'^(\d+)-', filename)
        return match.group(1) if match else None

    def _extract_from_layer(
        self,
        layer_file: Path,
        layer_id: str,
        predicates: Dict[str, PredicateInfo],
        xml_relationship_types: Set[str],
        property_patterns: Set[str],
        x_extensions: Set[str],
    ) -> None:
        """Extract predicates from a single layer file."""
        content = layer_file.read_text(encoding="utf-8")

        # Extract XML relationship types
        xml_matches = self.xml_relationship_pattern.finditer(content)
        for match in xml_matches:
            rel_type = match.group(1).lower()
            xml_relationship_types.add(rel_type)

            # Add to predicates catalog
            self._add_predicate(
                predicates, rel_type, layer_id, "xml-relationship",
                f"XML relationship in {layer_file.name}"
            )

        # Extract property-based field paths
        property_matches = self.property_pattern.finditer(content)
        for match in property_matches:
            field_path = match.group(1)
            property_patterns.add(field_path)

            # Extract predicate from field path (e.g., "motivation.supports-goals" -> "supports-goals")
            predicate = self._extract_predicate_from_field_path(field_path)
            if predicate:
                self._add_predicate(
                    predicates, predicate, layer_id, field_path,
                    f"Property in {layer_file.name}"
                )

            # Track x- extensions separately
            if field_path.startswith("x-"):
                x_extensions.add(field_path)

        # Extract field paths from documentation (inline code blocks)
        inline_matches = self.field_path_inline_pattern.finditer(content)
        for match in inline_matches:
            field_path = match.group(1) or match.group(2)
            if field_path:
                property_patterns.add(field_path)
                predicate = self._extract_predicate_from_field_path(field_path)
                if predicate:
                    self._add_predicate(
                        predicates, predicate, layer_id, field_path,
                        f"Documentation mention in {layer_file.name}"
                    )

        # Extract from tables
        table_matches = self.table_field_path_pattern.finditer(content)
        for match in table_matches:
            field_path = match.group(1)
            if field_path and ('.' in field_path or field_path.startswith('x-')):
                property_patterns.add(field_path)
                predicate = self._extract_predicate_from_field_path(field_path)
                if predicate:
                    self._add_predicate(
                        predicates, predicate, layer_id, field_path,
                        f"Table reference in {layer_file.name}"
                    )

    def _extract_predicate_from_field_path(self, field_path: str) -> Optional[str]:
        """Extract the predicate portion from a field path.

        Examples:
            "motivation.supports-goals" -> "supports-goals"
            "x-supports-goals" -> "supports-goals"
            "apm.business-metrics" -> "business-metrics"
        """
        if field_path.startswith("x-"):
            # Remove x- prefix
            return field_path[2:]
        elif "." in field_path:
            # Extract part after dot
            parts = field_path.split(".", 1)
            if len(parts) == 2:
                return parts[1]
        return None

    def _add_predicate(
        self,
        predicates: Dict[str, PredicateInfo],
        predicate: str,
        layer_id: str,
        field_path: str,
        context: str,
    ) -> None:
        """Add or update a predicate in the catalog."""
        if predicate not in predicates:
            # Determine category
            category = self.PREDICATE_CATEGORIES.get(predicate, "Other")

            predicates[predicate] = PredicateInfo(
                predicate=predicate,
                category=category,
            )

        pred_info = predicates[predicate]
        pred_info.field_paths.add(field_path)
        pred_info.usage_count += 1
        pred_info.layers_used.add(layer_id)

        # Add example (limit to first 3 per predicate)
        if len(pred_info.example_usages) < 3:
            pred_info.example_usages.append({
                "layer": layer_id,
                "field_path": field_path,
                "context": context,
            })

    def generate_markdown_report(self, catalog: PredicateCatalog) -> str:
        """Generate markdown-formatted predicate catalog report."""
        lines = ["# Predicate Catalog Report", ""]

        # Summary
        lines.extend([
            "## Executive Summary",
            "",
            f"- **Total Unique Predicates**: {len(catalog.predicates)}",
            f"- **Total Predicate Usages**: {catalog.total_predicate_usages}",
            f"- **XML Relationship Types**: {len(catalog.xml_relationship_types)}",
            f"- **Property Patterns**: {len(catalog.property_patterns)}",
            f"- **OpenAPI x- Extensions**: {len(catalog.x_extensions)}",
            "",
        ])

        # Usage by category
        lines.extend([
            "## Predicate Usage by Category",
            "",
            "| Category | Count | Percentage |",
            "|----------|-------|------------|",
        ])

        for category in sorted(catalog.categories.keys()):
            count = catalog.categories[category]
            pct = (count / catalog.total_predicate_usages * 100) if catalog.total_predicate_usages > 0 else 0
            lines.append(f"| {category} | {count} | {pct:.1f}% |")

        lines.append("")

        # Predicates by category
        for category in sorted(set(p.category for p in catalog.predicates.values())):
            predicates_in_cat = [
                p for p in catalog.predicates.values() if p.category == category
            ]
            if not predicates_in_cat:
                continue

            lines.extend([
                f"## {category} Predicates",
                "",
                "| Predicate | Usage Count | Layers | Field Paths |",
                "|-----------|-------------|--------|-------------|",
            ])

            for pred_info in sorted(predicates_in_cat, key=lambda p: p.usage_count, reverse=True):
                layers_str = ", ".join(sorted(pred_info.layers_used))
                field_paths_str = ", ".join([f"`{fp}`" for fp in sorted(pred_info.field_paths)[:3]])
                if len(pred_info.field_paths) > 3:
                    field_paths_str += f", ... ({len(pred_info.field_paths)} total)"

                lines.append(
                    f"| {pred_info.predicate} | {pred_info.usage_count} | {layers_str} | {field_paths_str} |"
                )

            lines.append("")

        # XML Relationship Types
        if catalog.xml_relationship_types:
            lines.extend([
                "## XML Relationship Types",
                "",
                "Found in `<relationship type=\"...\">` tags:",
                "",
            ])
            for rel_type in sorted(catalog.xml_relationship_types):
                lines.append(f"- {rel_type}")
            lines.append("")

        # Most Common Predicates
        lines.extend([
            "## Top 20 Most Used Predicates",
            "",
            "| Rank | Predicate | Category | Usage Count |",
            "|------|-----------|----------|-------------|",
        ])

        top_predicates = sorted(
            catalog.predicates.values(),
            key=lambda p: p.usage_count,
            reverse=True
        )[:20]

        for rank, pred_info in enumerate(top_predicates, 1):
            lines.append(
                f"| {rank} | {pred_info.predicate} | {pred_info.category} | {pred_info.usage_count} |"
            )

        lines.append("")

        return "\n".join(lines)

    def export_json(self, catalog: PredicateCatalog, output_path: Path) -> None:
        """Export predicate catalog to JSON file."""
        data = {
            "summary": {
                "total_unique_predicates": len(catalog.predicates),
                "total_predicate_usages": catalog.total_predicate_usages,
                "xml_relationship_types_count": len(catalog.xml_relationship_types),
                "property_patterns_count": len(catalog.property_patterns),
                "x_extensions_count": len(catalog.x_extensions),
            },
            "categories": catalog.categories,
            "predicates": {
                pred: {
                    "category": info.category,
                    "usage_count": info.usage_count,
                    "field_paths": sorted(info.field_paths),
                    "layers_used": sorted(info.layers_used),
                    "example_usages": info.example_usages,
                }
                for pred, info in catalog.predicates.items()
            },
            "xml_relationship_types": sorted(catalog.xml_relationship_types),
            "x_extensions": sorted(catalog.x_extensions),
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
