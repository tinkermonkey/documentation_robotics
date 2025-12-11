"""Link Coverage Analyzer - Analyzes which links are defined, used, and missing.

This module scans all layer markdown files for relationship patterns and compares them
against the link-registry.json to identify coverage gaps and inconsistencies.
"""

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


@dataclass
class LinkUsage:
    """Represents usage of a link pattern in documentation."""

    link_id: str
    field_path: str
    source_layer: str
    source_element_type: str
    usage_count: int = 0
    example_locations: List[str] = field(default_factory=list)


@dataclass
class LayerCoverage:
    """Coverage statistics for a single layer."""

    layer_id: str
    layer_name: str
    total_entity_types: int
    entity_types_with_links: int
    outgoing_link_count: int
    incoming_link_count: int
    unique_field_paths: Set[str] = field(default_factory=set)
    missing_registry_links: List[str] = field(default_factory=list)


@dataclass
class CoverageReport:
    """Complete link coverage analysis report."""

    layers_analyzed: int
    total_link_types_in_registry: int
    link_types_found_in_docs: int
    link_types_unused: List[str]
    links_in_docs_not_in_registry: List[Dict[str, str]]
    layer_coverage: Dict[str, LayerCoverage]
    bidirectional_candidates: List[Tuple[str, str]]
    layer_pair_coverage: Dict[Tuple[str, str], int]


class LinkCoverageAnalyzer:
    """Analyzes link coverage across layer documentation and registry."""

    def __init__(self, spec_root: Optional[Path] = None, registry: Optional[LinkRegistry] = None):
        """Initialize the link coverage analyzer.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects from current location.
            registry: LinkRegistry instance. If None, creates new instance.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.registry = registry or LinkRegistry()

        # Patterns for extracting links from markdown
        self.property_pattern = re.compile(r'^\s*-\s+key:\s*"([^"]+)"', re.MULTILINE)
        self.xml_relationship_pattern = re.compile(
            r'<relationship\s+type="([^"]+)"\s+source="([^"]+)"\s+target="([^"]+)"\s*/>'
        )
        self.field_path_pattern = re.compile(r'`([a-z]+\.[a-z-]+)`|`(x-[a-z-]+)`')

    def _find_spec_root(self) -> Path:
        """Auto-detect spec root directory."""
        # From scripts/analysis/, spec is ../../spec/
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

        if not spec_root.exists() or not (spec_root / "layers").exists():
            raise FileNotFoundError(
                f"Could not find spec/layers directory at {spec_root}. "
                "Run from repository root."
            )

        return spec_root

    def analyze(self) -> CoverageReport:
        """Perform comprehensive link coverage analysis.

        Returns:
            CoverageReport with complete analysis results.
        """
        # Initialize report
        link_types_found = set()
        links_not_in_registry = []
        layer_coverage = {}
        link_usages: Dict[str, LinkUsage] = {}
        layer_pair_links: Dict[Tuple[str, str], int] = {}

        # Analyze each layer
        for layer_file in sorted(self.layers_path.glob("*.md")):
            layer_id = self._extract_layer_id(layer_file.name)
            if not layer_id:
                continue

            coverage = self._analyze_layer(
                layer_file, layer_id, link_types_found, links_not_in_registry, link_usages
            )
            layer_coverage[layer_id] = coverage

        # Count layer pair coverage
        for link_id, link_type in self.registry.link_types.items():
            for source_layer in link_type.source_layers:
                target_layer = link_type.target_layer
                key = (source_layer, target_layer)
                layer_pair_links[key] = layer_pair_links.get(key, 0) + 1

        # Identify unused link types
        all_link_ids = set(self.registry.link_types.keys())
        link_types_unused = sorted(all_link_ids - link_types_found)

        # Identify bidirectional candidates
        bidirectional_candidates = self._find_bidirectional_candidates()

        return CoverageReport(
            layers_analyzed=len(layer_coverage),
            total_link_types_in_registry=len(self.registry.link_types),
            link_types_found_in_docs=len(link_types_found),
            link_types_unused=link_types_unused,
            links_in_docs_not_in_registry=links_not_in_registry,
            layer_coverage=layer_coverage,
            bidirectional_candidates=bidirectional_candidates,
            layer_pair_coverage=layer_pair_links,
        )

    def _extract_layer_id(self, filename: str) -> Optional[str]:
        """Extract layer ID from filename (e.g., '02-business-layer.md' -> '02')."""
        match = re.match(r'^(\d+)-', filename)
        return match.group(1) if match else None

    def _analyze_layer(
        self,
        layer_file: Path,
        layer_id: str,
        link_types_found: Set[str],
        links_not_in_registry: List[Dict[str, str]],
        link_usages: Dict[str, LinkUsage],
    ) -> LayerCoverage:
        """Analyze a single layer file for link coverage."""
        content = layer_file.read_text(encoding="utf-8")

        # Extract layer name
        layer_name_match = re.search(r'^#\s+Layer\s+\d+:\s+(.+)$', content, re.MULTILINE)
        layer_name = layer_name_match.group(1) if layer_name_match else "Unknown"

        # Count entity types
        entity_pattern = re.compile(r'^###\s+([A-Z][a-zA-Z]+)$', re.MULTILINE)
        entity_types = set(entity_pattern.findall(content))
        total_entity_types = len(entity_types)

        # Extract field paths from properties
        unique_field_paths = set()
        entity_types_with_links = set()

        # Find all property definitions
        property_matches = self.property_pattern.finditer(content)
        for match in property_matches:
            field_path = match.group(1)
            unique_field_paths.add(field_path)

            # Try to match to registry
            matched = False
            for link_id, link_type in self.registry.link_types.items():
                if field_path in link_type.field_paths:
                    link_types_found.add(link_id)
                    matched = True

                    # Track usage
                    if link_id not in link_usages:
                        link_usages[link_id] = LinkUsage(
                            link_id=link_id,
                            field_path=field_path,
                            source_layer=layer_id,
                            source_element_type="Unknown",
                        )
                    link_usages[link_id].usage_count += 1
                    link_usages[link_id].example_locations.append(str(layer_file))
                    break

            if not matched:
                # This field path is not in registry
                links_not_in_registry.append({
                    "field_path": field_path,
                    "layer": layer_id,
                    "file": str(layer_file),
                })

        # Find field paths mentioned in documentation
        doc_field_paths = self.field_path_pattern.findall(content)
        for path_tuple in doc_field_paths:
            path = path_tuple[0] or path_tuple[1]  # Extract from tuple
            if path:
                unique_field_paths.add(path)

        # Determine entity types with links
        entity_section_pattern = re.compile(
            r'^###\s+([A-Z][a-zA-Z]+).*?(?=^###\s+|\Z)', re.MULTILINE | re.DOTALL
        )
        for entity_match in entity_section_pattern.finditer(content):
            entity_type = entity_match.group(1)
            entity_content = entity_match.group(0)

            # Check if this entity has property definitions
            if 'properties:' in entity_content or 'key:' in entity_content:
                entity_types_with_links.add(entity_type)

        # Count outgoing and incoming links
        outgoing_count = 0
        incoming_count = 0
        for link_id, link_type in self.registry.link_types.items():
            if layer_id in link_type.source_layers:
                outgoing_count += 1
            if layer_id == link_type.target_layer:
                incoming_count += 1

        # Find missing registry links
        missing_registry_links = []
        for link_id, link_type in self.registry.link_types.items():
            if layer_id in link_type.source_layers:
                # This layer should use this link
                found_in_layer = any(fp in unique_field_paths for fp in link_type.field_paths)
                if not found_in_layer:
                    missing_registry_links.append(link_id)

        return LayerCoverage(
            layer_id=layer_id,
            layer_name=layer_name,
            total_entity_types=total_entity_types,
            entity_types_with_links=len(entity_types_with_links),
            outgoing_link_count=outgoing_count,
            incoming_link_count=incoming_count,
            unique_field_paths=unique_field_paths,
            missing_registry_links=missing_registry_links,
        )

    def _find_bidirectional_candidates(self) -> List[Tuple[str, str]]:
        """Identify potential bidirectional link pairs."""
        candidates = []

        # Look for field paths that suggest bidirectional relationships
        bidirectional_terms = [
            ("realizes", "realized-by"),
            ("supports-goals", "supported-by"),
            ("fulfills-requirements", "fulfilled-by"),
            ("delivers-value", "delivered-by"),
            ("serves", "served-by"),
            ("uses", "used-by"),
            ("accesses", "accessed-by"),
            ("triggers", "triggered-by"),
            ("constrains", "constrained-by"),
        ]

        for forward, inverse in bidirectional_terms:
            # Check if both directions exist in registry
            forward_links = [
                lid for lid, lt in self.registry.link_types.items()
                if any(forward in fp for fp in lt.field_paths)
            ]
            inverse_links = [
                lid for lid, lt in self.registry.link_types.items()
                if any(inverse in fp for fp in lt.field_paths)
            ]

            if forward_links and not inverse_links:
                candidates.append((forward, inverse + " (missing)"))
            elif inverse_links and not forward_links:
                candidates.append((forward + " (missing)", inverse))

        return candidates

    def generate_markdown_report(self, report: CoverageReport) -> str:
        """Generate markdown-formatted coverage report."""
        lines = ["# Link Coverage Analysis Report", ""]

        # Summary
        coverage_pct = (report.link_types_found_in_docs / report.total_link_types_in_registry * 100)
        lines.extend([
            "## Executive Summary",
            "",
            f"- **Layers Analyzed**: {report.layers_analyzed}",
            f"- **Link Types in Registry**: {report.total_link_types_in_registry}",
            f"- **Link Types Found in Docs**: {report.link_types_found_in_docs}",
            f"- **Coverage**: {coverage_pct:.1f}%",
            f"- **Unused Link Types**: {len(report.link_types_unused)}",
            f"- **Links Not in Registry**: {len(report.links_in_docs_not_in_registry)}",
            "",
        ])

        # Layer-by-layer coverage
        lines.extend([
            "## Coverage by Layer",
            "",
            "| Layer | Name | Entity Types | Types with Links | Outgoing | Incoming | Field Paths |",
            "|-------|------|--------------|------------------|----------|----------|-------------|",
        ])

        for layer_id in sorted(report.layer_coverage.keys()):
            cov = report.layer_coverage[layer_id]
            link_pct = (
                f"{(cov.entity_types_with_links / cov.total_entity_types * 100):.0f}%"
                if cov.total_entity_types > 0 else "N/A"
            )
            lines.append(
                f"| {cov.layer_id} | {cov.layer_name} | {cov.total_entity_types} | "
                f"{cov.entity_types_with_links} ({link_pct}) | "
                f"{cov.outgoing_link_count} | {cov.incoming_link_count} | {len(cov.unique_field_paths)} |"
            )

        lines.append("")

        # Layer pair coverage matrix
        lines.extend([
            "## Layer-to-Layer Link Coverage",
            "",
            "Number of link types between layer pairs:",
            "",
        ])

        all_layers = sorted(set(
            [k[0] for k in report.layer_pair_coverage.keys()] +
            [k[1] for k in report.layer_pair_coverage.keys()]
        ))

        if all_layers:
            lines.append("| From \\ To | " + " | ".join(all_layers) + " |")
            lines.append("|" + "---|" * (len(all_layers) + 1))

            for source in all_layers:
                row = [source]
                for target in all_layers:
                    count = report.layer_pair_coverage.get((source, target), 0)
                    row.append(str(count) if count > 0 else "-")
                lines.append("| " + " | ".join(row) + " |")

            lines.append("")

        # Unused link types
        if report.link_types_unused:
            lines.extend([
                "## Unused Link Types",
                "",
                "The following link types are defined in the registry but not found in any layer documentation:",
                "",
            ])
            for link_id in report.link_types_unused:
                link_type = self.registry.link_types[link_id]
                lines.append(f"- **{link_id}**: {link_type.name} ({', '.join(link_type.field_paths)})")
            lines.append("")

        # Links not in registry
        if report.links_in_docs_not_in_registry:
            lines.extend([
                "## Field Paths Not in Registry",
                "",
                "The following field paths are used in documentation but not defined in link-registry.json:",
                "",
            ])
            seen = set()
            for link_info in report.links_in_docs_not_in_registry:
                fp = link_info["field_path"]
                if fp not in seen:
                    seen.add(fp)
                    lines.append(f"- `{fp}` (Layer {link_info['layer']})")
            lines.append("")

        # Bidirectional candidates
        if report.bidirectional_candidates:
            lines.extend([
                "## Potential Bidirectional Relationships",
                "",
                "The following relationship pairs may benefit from bidirectional modeling:",
                "",
            ])
            for forward, inverse in report.bidirectional_candidates:
                lines.append(f"- {forward} ⇄ {inverse}")
            lines.append("")

        return "\n".join(lines)

    def export_json(self, report: CoverageReport, output_path: Path) -> None:
        """Export coverage report to JSON file."""
        data = {
            "summary": {
                "layers_analyzed": report.layers_analyzed,
                "total_link_types_in_registry": report.total_link_types_in_registry,
                "link_types_found_in_docs": report.link_types_found_in_docs,
                "coverage_percent": round(
                    report.link_types_found_in_docs / report.total_link_types_in_registry * 100, 2
                ),
                "link_types_unused": report.link_types_unused,
                "links_in_docs_not_in_registry_count": len(report.links_in_docs_not_in_registry),
            },
            "layer_coverage": {
                layer_id: {
                    "layer_name": cov.layer_name,
                    "total_entity_types": cov.total_entity_types,
                    "entity_types_with_links": cov.entity_types_with_links,
                    "outgoing_link_count": cov.outgoing_link_count,
                    "incoming_link_count": cov.incoming_link_count,
                    "unique_field_paths": sorted(cov.unique_field_paths),
                    "missing_registry_links": cov.missing_registry_links,
                }
                for layer_id, cov in report.layer_coverage.items()
            },
            "links_not_in_registry": report.links_in_docs_not_in_registry,
            "bidirectional_candidates": report.bidirectional_candidates,
            "layer_pair_coverage": {
                f"{src}->{tgt}": count for (src, tgt), count in report.layer_pair_coverage.items()
            },
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
