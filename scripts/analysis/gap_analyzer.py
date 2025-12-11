"""Gap Analyzer - Identifies ontology gaps and inconsistencies.

This module identifies missing relationships, incomplete coverage, and structural gaps
in the Documentation Robotics ontology.
"""

import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


@dataclass
class Gap:
    """Represents a single identified gap."""

    gap_type: str  # inter-layer, intra-layer, semantic, bidirectional, element-coverage
    severity: str  # critical, high, medium, low
    description: str
    affected_layers: List[str]
    recommendation: str
    examples: List[str] = field(default_factory=list)


@dataclass
class GapReport:
    """Complete gap analysis report."""

    inter_layer_gaps: List[Gap]
    intra_layer_gaps: List[Gap]
    semantic_gaps: List[Gap]
    bidirectional_gaps: List[Gap]
    element_coverage_gaps: List[Gap]
    total_gaps: int
    critical_gaps: int
    high_priority_gaps: int


class GapAnalyzer:
    """Analyzes ontology for gaps and inconsistencies."""

    # Expected layer pairs that should have links (based on ArchiMate and DR architecture)
    EXPECTED_LAYER_LINKS = {
        ("02", "01"): "Business should link to Motivation (goals, values)",
        ("04", "01"): "Application should link to Motivation (requirements, principles)",
        ("04", "02"): "Application should realize Business services",
        ("05", "04"): "Technology should serve Application",
        ("06", "04"): "API should reference Application services",
        ("06", "02"): "API should reference Business services/interfaces",
        ("07", "02"): "Data Model should represent Business objects",
        ("09", "02"): "UX should support Business processes",
        ("10", "09"): "Navigation should link to UX experiences",
        ("11", "02"): "APM should track Business metrics",
        ("11", "04"): "APM should monitor Application services",
        ("12", "04"): "Testing should test Application components",
    }

    # Layers that should have intra-layer structural relationships
    LAYERS_NEEDING_INTRA_LINKS = {
        "01": "Motivation elements should relate to each other",
        "02": "Business elements should have composition/aggregation",
        "04": "Application components should have structure",
        "05": "Technology components should have structure",
    }

    def __init__(self, spec_root: Optional[Path] = None, registry: Optional[LinkRegistry] = None):
        """Initialize the gap analyzer.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
            registry: LinkRegistry instance. If None, creates new instance.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.registry = registry or LinkRegistry()

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

    def analyze(self) -> GapReport:
        """Perform comprehensive gap analysis.

        Returns:
            GapReport with all identified gaps.
        """
        inter_layer_gaps = self._analyze_inter_layer_gaps()
        intra_layer_gaps = self._analyze_intra_layer_gaps()
        semantic_gaps = self._analyze_semantic_gaps()
        bidirectional_gaps = self._analyze_bidirectional_gaps()
        element_coverage_gaps = self._analyze_element_coverage_gaps()

        all_gaps = (
            inter_layer_gaps +
            intra_layer_gaps +
            semantic_gaps +
            bidirectional_gaps +
            element_coverage_gaps
        )

        critical_count = sum(1 for g in all_gaps if g.severity == "critical")
        high_count = sum(1 for g in all_gaps if g.severity == "high")

        return GapReport(
            inter_layer_gaps=inter_layer_gaps,
            intra_layer_gaps=intra_layer_gaps,
            semantic_gaps=semantic_gaps,
            bidirectional_gaps=bidirectional_gaps,
            element_coverage_gaps=element_coverage_gaps,
            total_gaps=len(all_gaps),
            critical_gaps=critical_count,
            high_priority_gaps=high_count,
        )

    def _analyze_inter_layer_gaps(self) -> List[Gap]:
        """Identify missing inter-layer links."""
        gaps = []

        # Get actual layer pairs with links
        actual_pairs = set()
        for link_type in self.registry.link_types.values():
            for source_layer in link_type.source_layers:
                actual_pairs.add((source_layer, link_type.target_layer))

        # Check expected pairs
        for (source, target), description in self.EXPECTED_LAYER_LINKS.items():
            if (source, target) not in actual_pairs:
                # Check if layers exist
                source_file = self.layers_path / f"{source}-*.md"
                target_file = self.layers_path / f"{target}-*.md"

                if list(self.layers_path.glob(f"{source}-*.md")) and list(self.layers_path.glob(f"{target}-*.md")):
                    severity = "high" if source in ["02", "04", "06"] else "medium"
                    gaps.append(Gap(
                        gap_type="inter-layer",
                        severity=severity,
                        description=f"Missing links from Layer {source} to Layer {target}",
                        affected_layers=[source, target],
                        recommendation=description,
                        examples=[],
                    ))

        return gaps

    def _analyze_intra_layer_gaps(self) -> List[Gap]:
        """Identify layers missing internal structural relationships."""
        gaps = []

        xml_relationship_pattern = re.compile(
            r'<relationship\s+type="([^"]+)"\s+source="([^"]+)"\s+target="([^"]+)"\s*/>'
        )

        for layer_id, description in self.LAYERS_NEEDING_INTRA_LINKS.items():
            layer_files = list(self.layers_path.glob(f"{layer_id}-*.md"))
            if not layer_files:
                continue

            layer_file = layer_files[0]
            content = layer_file.read_text(encoding="utf-8")

            # Count XML relationships (intra-layer structural)
            xml_relationships = xml_relationship_pattern.findall(content)

            if len(xml_relationships) == 0:
                gaps.append(Gap(
                    gap_type="intra-layer",
                    severity="medium",
                    description=f"Layer {layer_id} lacks intra-layer structural relationships",
                    affected_layers=[layer_id],
                    recommendation=description,
                    examples=["Add <relationship> tags to show composition, aggregation, specialization"],
                ))

        return gaps

    def _analyze_semantic_gaps(self) -> List[Gap]:
        """Identify relationships described in text but not formalized."""
        gaps = []

        # Keywords that suggest relationships but might not be formalized
        relationship_keywords = [
            ("depends on", "dependency"),
            ("relies on", "dependency"),
            ("interacts with", "interaction"),
            ("communicates with", "communication"),
            ("extends", "specialization"),
            ("inherits from", "inheritance"),
            ("part of", "composition"),
            ("contains", "composition"),
        ]

        for layer_file in sorted(self.layers_path.glob("*.md")):
            layer_id = self._extract_layer_id(layer_file.name)
            if not layer_id:
                continue

            content = layer_file.read_text(encoding="utf-8")

            for keyword, relationship_type in relationship_keywords:
                if keyword in content.lower():
                    # Check if this is formalized (has corresponding property or XML relationship)
                    has_formalization = (
                        f'key: "{relationship_type}"' in content or
                        f'type="{relationship_type.title()}"' in content
                    )

                    if not has_formalization:
                        gaps.append(Gap(
                            gap_type="semantic",
                            severity="low",
                            description=f"Layer {layer_id} mentions '{keyword}' but may lack formal relationship",
                            affected_layers=[layer_id],
                            recommendation=f"Consider formalizing '{keyword}' as a {relationship_type} relationship",
                            examples=[],
                        ))
                        break  # Only report once per layer

        return gaps

    def _analyze_bidirectional_gaps(self) -> List[Gap]:
        """Identify missing inverse relationships."""
        gaps = []

        # Check for one-way relationships that should be bidirectional
        forward_predicates = defaultdict(list)
        inverse_predicates = defaultdict(list)

        for link_id, link_type in self.registry.link_types.items():
            for field_path in link_type.field_paths:
                # Extract predicate
                if field_path.startswith("x-"):
                    predicate = field_path[2:]
                elif "." in field_path:
                    predicate = field_path.split(".", 1)[1]
                else:
                    continue

                if predicate.endswith("-by"):
                    # This is an inverse
                    base = predicate[:-3]  # Remove "-by"
                    inverse_predicates[base].append(link_id)
                else:
                    forward_predicates[predicate].append(link_id)

        # Find forward predicates without inverses
        for predicate, link_ids in forward_predicates.items():
            if predicate not in inverse_predicates:
                # This forward predicate has no inverse
                inverse_form = f"{predicate}-by"

                gaps.append(Gap(
                    gap_type="bidirectional",
                    severity="medium",
                    description=f"Predicate '{predicate}' lacks inverse '{inverse_form}'",
                    affected_layers=[],
                    recommendation=f"Add inverse relationship '{inverse_form}' for bidirectional navigation",
                    examples=[f"Link IDs using this: {', '.join(link_ids[:3])}"],
                ))

        return gaps

    def _analyze_element_coverage_gaps(self) -> List[Gap]:
        """Identify element types with no outgoing or incoming links."""
        gaps = []

        # Extract all element types from layers
        element_types_by_layer: Dict[str, Set[str]] = defaultdict(set)

        entity_pattern = re.compile(r'^###\s+([A-Z][a-zA-Z]+)$', re.MULTILINE)

        for layer_file in sorted(self.layers_path.glob("*.md")):
            layer_id = self._extract_layer_id(layer_file.name)
            if not layer_id:
                continue

            content = layer_file.read_text(encoding="utf-8")
            entity_types = entity_pattern.findall(content)
            element_types_by_layer[layer_id].update(entity_types)

        # Check which element types have links
        elements_with_outgoing = defaultdict(set)
        elements_with_incoming = defaultdict(set)

        for link_type in self.registry.link_types.values():
            for source_layer in link_type.source_layers:
                if link_type.source_element_types:
                    for elem_type in link_type.source_element_types:
                        elements_with_outgoing[source_layer].add(elem_type)

            target_layer = link_type.target_layer
            for elem_type in link_type.target_element_types:
                elements_with_incoming[target_layer].add(elem_type)

        # Find elements with no links
        for layer_id, element_types in element_types_by_layer.items():
            for elem_type in element_types:
                has_outgoing = elem_type in elements_with_outgoing[layer_id]
                has_incoming = elem_type in elements_with_incoming[layer_id]

                if not has_outgoing and not has_incoming:
                    gaps.append(Gap(
                        gap_type="element-coverage",
                        severity="low",
                        description=f"{elem_type} in Layer {layer_id} has no documented links",
                        affected_layers=[layer_id],
                        recommendation=f"Document how {elem_type} relates to other elements",
                        examples=[],
                    ))

        return gaps

    def _extract_layer_id(self, filename: str) -> Optional[str]:
        """Extract layer ID from filename."""
        match = re.match(r'^(\d+)-', filename)
        return match.group(1) if match else None

    def generate_markdown_report(self, report: GapReport) -> str:
        """Generate markdown-formatted gap analysis report."""
        lines = ["# Ontology Gap Analysis Report", ""]

        # Summary
        lines.extend([
            "## Executive Summary",
            "",
            f"- **Total Gaps Identified**: {report.total_gaps}",
            f"- **Critical Priority**: {report.critical_gaps}",
            f"- **High Priority**: {report.high_priority_gaps}",
            f"- **Inter-Layer Gaps**: {len(report.inter_layer_gaps)}",
            f"- **Intra-Layer Gaps**: {len(report.intra_layer_gaps)}",
            f"- **Semantic Gaps**: {len(report.semantic_gaps)}",
            f"- **Bidirectional Gaps**: {len(report.bidirectional_gaps)}",
            f"- **Element Coverage Gaps**: {len(report.element_coverage_gaps)}",
            "",
        ])

        # Gap sections
        sections = [
            ("Inter-Layer Gaps", report.inter_layer_gaps, "Missing links between layers"),
            ("Intra-Layer Gaps", report.intra_layer_gaps, "Missing structural relationships within layers"),
            ("Semantic Gaps", report.semantic_gaps, "Relationships mentioned but not formalized"),
            ("Bidirectional Gaps", report.bidirectional_gaps, "Missing inverse relationships"),
            ("Element Coverage Gaps", report.element_coverage_gaps, "Elements with no documented links"),
        ]

        for title, gaps, description in sections:
            if not gaps:
                continue

            lines.extend([
                f"## {title}",
                "",
                f"*{description}*",
                "",
                "| Severity | Description | Affected Layers | Recommendation |",
                "|----------|-------------|-----------------|----------------|",
            ])

            for gap in sorted(gaps, key=lambda g: (g.severity, g.description)):
                layers_str = ", ".join(gap.affected_layers)
                lines.append(
                    f"| {gap.severity.upper()} | {gap.description} | {layers_str} | {gap.recommendation} |"
                )

            lines.append("")

        # Priority recommendations
        critical_and_high = [
            g for g in (
                report.inter_layer_gaps +
                report.intra_layer_gaps +
                report.semantic_gaps +
                report.bidirectional_gaps +
                report.element_coverage_gaps
            )
            if g.severity in ["critical", "high"]
        ]

        if critical_and_high:
            lines.extend([
                "## Priority Action Items",
                "",
                "The following gaps should be addressed first:",
                "",
            ])

            for idx, gap in enumerate(sorted(critical_and_high, key=lambda g: g.severity), 1):
                lines.append(f"{idx}. **[{gap.severity.upper()}]** {gap.description}")
                lines.append(f"   - *Recommendation*: {gap.recommendation}")
                if gap.examples:
                    lines.append(f"   - *Examples*: {'; '.join(gap.examples)}")
                lines.append("")

        return "\n".join(lines)

    def export_json(self, report: GapReport, output_path: Path) -> None:
        """Export gap analysis report to JSON file."""
        def gap_to_dict(gap: Gap) -> dict:
            return {
                "gap_type": gap.gap_type,
                "severity": gap.severity,
                "description": gap.description,
                "affected_layers": gap.affected_layers,
                "recommendation": gap.recommendation,
                "examples": gap.examples,
            }

        data = {
            "summary": {
                "total_gaps": report.total_gaps,
                "critical_gaps": report.critical_gaps,
                "high_priority_gaps": report.high_priority_gaps,
                "inter_layer_gaps_count": len(report.inter_layer_gaps),
                "intra_layer_gaps_count": len(report.intra_layer_gaps),
                "semantic_gaps_count": len(report.semantic_gaps),
                "bidirectional_gaps_count": len(report.bidirectional_gaps),
                "element_coverage_gaps_count": len(report.element_coverage_gaps),
            },
            "inter_layer_gaps": [gap_to_dict(g) for g in report.inter_layer_gaps],
            "intra_layer_gaps": [gap_to_dict(g) for g in report.intra_layer_gaps],
            "semantic_gaps": [gap_to_dict(g) for g in report.semantic_gaps],
            "bidirectional_gaps": [gap_to_dict(g) for g in report.bidirectional_gaps],
            "element_coverage_gaps": [gap_to_dict(g) for g in report.element_coverage_gaps],
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
