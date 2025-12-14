"""Intra-Layer Report Generator - Generates per-entity intra-layer relationship reports.

Produces reports that show same-layer entity connections, coverage metrics, and gaps.
"""

import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Set

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from analysis.intra_layer_analyzer import (
    EntityRelationshipProfile,
    IntraLayerRelationship,
    LayerIntraRelationshipReport,
)


class IntraLayerReportGenerator:
    """Generates detailed intra-layer relationship reports."""

    def __init__(self):
        """Initialize the report generator."""
        pass

    def generate_layer_report(self, analysis: LayerIntraRelationshipReport) -> str:
        """Generate complete markdown report for a layer.

        Args:
            analysis: Layer analysis results

        Returns:
            Complete markdown report
        """
        lines = []

        # Header
        lines.extend(self._generate_header(analysis))

        # Diagram (right after overview)
        lines.extend(self._generate_mermaid_diagram(analysis))

        # Summary (moved to top, right after diagram)
        lines.extend(self._generate_layer_summary(analysis))

        # Entity sections
        for entity_name in sorted(analysis.entity_profiles.keys()):
            profile = analysis.entity_profiles[entity_name]
            lines.extend(self._generate_entity_section(profile))

        return "\n".join(lines)

    def _generate_header(self, analysis: LayerIntraRelationshipReport) -> List[str]:
        """Generate report header.

        Args:
            analysis: Layer analysis results

        Returns:
            Header lines
        """
        layer_title = analysis.layer_spec.title
        layer_id = analysis.layer_id

        return [
            f"# {layer_title} - Intra-Layer Relationships",
            "",
            "## Overview",
            "",
            "**Purpose**: Define semantic links between entities WITHIN this layer, capturing",
            "structural composition, behavioral dependencies, and influence relationships.",
            "",
            f"**Layer ID**: `{layer_id}`",
            f"**Analysis Date**: Generated automatically",
            f"**Validation**: Uses MarkdownLayerParser for closed-loop validation",
            "",
            "---",
            "",
        ]

    def _generate_entity_section(self, profile: EntityRelationshipProfile) -> List[str]:
        """Generate markdown section for a single entity.

        Args:
            profile: Entity relationship profile

        Returns:
            Entity section lines
        """
        lines = [
            f"## Entity: {profile.entity_name}",
            "",
            f"**Definition**: {profile.entity_description}",
            "",
        ]

        # Outgoing relationships
        lines.extend([
            f"### Outgoing Relationships ({profile.entity_name} → Other Entities)",
            "",
        ])

        if profile.outgoing_relationships:
            lines.extend([
                "| Relationship Type | Target Entity | Predicate | Status | Source | In Catalog | Documented |",
                "|-------------------|---------------|-----------|--------|--------|------------|------------|",
            ])

            for rel in sorted(
                profile.outgoing_relationships, key=lambda r: (r.target_entity, r.predicate)
            ):
                status_parts = []
                if rel.documented:
                    status_parts.append("Documented")
                if rel.has_xml_example:
                    status_parts.append("XML")
                status = " + ".join(status_parts) if status_parts else "Implicit"

                in_catalog = "✓" if rel.in_relationship_catalog else "✗"

                # Generate source link
                layer_file = f"../../spec/layers/{rel.layer_id}-layer.md"
                if rel.source_location == "xml_example":
                    source_link = f"[XML]({layer_file}#example-model)"
                elif rel.documented:
                    source_link = f"[Doc]({layer_file}#relationships)"
                else:
                    source_link = rel.source_location

                # Generate documentation link
                if rel.documented:
                    doc_link = f"[✓]({layer_file}#relationships)"
                else:
                    doc_link = "✗"

                lines.append(
                    f"| {rel.relationship_type} | {rel.target_entity} | `{rel.predicate}` | "
                    f"{status} | {source_link} | {in_catalog} | {doc_link} |"
                )

            lines.append("")
        else:
            lines.extend([
                "_No outgoing intra-layer relationships documented._",
                "",
            ])

        # Incoming relationships
        lines.extend([
            f"### Incoming Relationships (Other Entities → {profile.entity_name})",
            "",
        ])

        if profile.incoming_relationships:
            lines.extend([
                "| Relationship Type | Source Entity | Predicate | Status | Source | In Catalog | Documented |",
                "|-------------------|---------------|-----------|--------|--------|------------|------------|",
            ])

            for rel in sorted(
                profile.incoming_relationships, key=lambda r: (r.source_entity, r.predicate)
            ):
                status_parts = []
                if rel.documented:
                    status_parts.append("Documented")
                if rel.has_xml_example:
                    status_parts.append("XML")
                status = " + ".join(status_parts) if status_parts else "Implicit"

                in_catalog = "✓" if rel.in_relationship_catalog else "✗"

                # Generate source link
                layer_file = f"../../spec/layers/{rel.layer_id}-layer.md"
                if rel.source_location == "xml_example":
                    source_link = f"[XML]({layer_file}#example-model)"
                elif rel.documented:
                    source_link = f"[Doc]({layer_file}#relationships)"
                else:
                    source_link = rel.source_location

                # Generate documentation link
                if rel.documented:
                    doc_link = f"[✓]({layer_file}#relationships)"
                else:
                    doc_link = "✗"

                lines.append(
                    f"| {rel.relationship_type} | {rel.source_entity} | `{rel.predicate}` | "
                    f"{status} | {source_link} | {in_catalog} | {doc_link} |"
                )

            lines.append("")
        else:
            lines.extend([
                "_No incoming intra-layer relationships documented._",
                "",
            ])

        # Entity summary
        lines.extend([
            "### Relationship Summary",
            "",
            f"- **Total Relationships**: {profile.total_relationships}",
            f"- **Outgoing**: {len(profile.outgoing_relationships)}",
            f"- **Incoming**: {len(profile.incoming_relationships)}",
            f"- **Documented**: {profile.documented_count}/{profile.total_relationships}",
            f"- **With XML Examples**: {profile.xml_example_count}/{profile.total_relationships}",
            f"- **In Catalog**: {profile.catalog_coverage_count}/{profile.total_relationships}",
            "",
        ])

        # Recommended registry entries if gaps exist
        gaps = [
            r
            for r in profile.outgoing_relationships + profile.incoming_relationships
            if not r.in_relationship_catalog
        ]

        if gaps:
            lines.extend(self._generate_gap_recommendations(profile.entity_name, gaps))

        lines.extend([
            "---",
            "",
        ])

        return lines

    def _generate_gap_recommendations(
        self, entity_name: str, gaps: List[IntraLayerRelationship]
    ) -> List[str]:
        """Generate recommended registry entries for gaps.

        Args:
            entity_name: Entity name
            gaps: Relationships not in catalog

        Returns:
            Gap recommendation lines
        """
        lines = [
            "### Recommended Catalog Updates",
            "",
            "_The following relationships should be added to relationship-catalog.json:_",
            "",
        ]

        for gap in gaps[:3]:  # Show up to 3 examples
            lines.extend([
                f"**{gap.relationship_type}** ({gap.source_entity} → {gap.target_entity}):",
                "```json",
                "{",
                f'  "id": "{gap.relationship_type.lower()}",',
                f'  "predicate": "{gap.predicate}",',
                f'  "inversePredicate": "{gap.inverse_predicate or gap.predicate + "-by"}",',
                f'  "category": "structural",',
                f'  "applicableLayers": ["{gap.layer_id.split("-")[0]}"],',
                f'  "description": "{gap.source_entity} {gap.predicate} {gap.target_entity}"',
                "}",
                "```",
                "",
            ])

        if len(gaps) > 3:
            lines.append(f"_...and {len(gaps) - 3} more relationships_")
            lines.append("")

        return lines

    def _generate_layer_summary(self, analysis: LayerIntraRelationshipReport) -> List[str]:
        """Generate layer-wide summary section.

        Args:
            analysis: Layer analysis results

        Returns:
            Summary section lines
        """
        lines = [
            "## Layer Summary",
            "",
            f"### Entity Coverage (Target: {analysis.COVERAGE_TARGET}+ relationships per entity)",
            "",
            f"- **Entities Meeting Target**: {analysis.entities_meeting_target}/{analysis.total_entities}",
            f"- **Entity Coverage**: {analysis.entity_coverage_percentage:.1f}%",
            "",
        ]

        # Identify entities below target
        below_target = [
            (name, profile.total_relationships)
            for name, profile in analysis.entity_profiles.items()
            if profile.total_relationships < analysis.COVERAGE_TARGET
        ]

        if below_target:
            lines.extend([
                "**Entities Below Target**:",
                "",
            ])
            for entity_name, count in sorted(below_target, key=lambda x: x[1]):
                lines.append(f"- {entity_name}: {count} relationship(s) (needs {analysis.COVERAGE_TARGET - count} more)")
            lines.append("")

        lines.extend([
            "### Coverage Matrix",
            "",
            "| Entity | Outgoing | Incoming | Total | Meets Target | Status |",
            "|--------|----------|----------|-------|--------------|--------|",
        ])

        # Calculate sum of all entity totals (entity perspective, each relationship counted twice)
        entity_perspective_total = 0

        for entity_name in sorted(analysis.entity_profiles.keys()):
            profile = analysis.entity_profiles[entity_name]
            outgoing = len(profile.outgoing_relationships)
            incoming = len(profile.incoming_relationships)
            total = profile.total_relationships
            meets_target = "✓" if total >= analysis.COVERAGE_TARGET else "✗"
            status = "Complete" if total >= analysis.COVERAGE_TARGET else f"Needs {analysis.COVERAGE_TARGET - total}"

            entity_perspective_total += total

            lines.append(
                f"| {entity_name} | {outgoing} | {incoming} | {total} | {meets_target} | {status} |"
            )

        # Totals row - show sum of entity totals for consistency
        lines.extend([
            f"| **TOTAL** | **-** | **-** | **{entity_perspective_total}** | **{analysis.entities_meeting_target}/{analysis.total_entities}** | **{analysis.entity_coverage_percentage:.1f}%** |",
            "",
        ])

        # Relationship statistics
        lines.extend([
            "### Relationship Statistics",
            "",
            f"- **Total Unique Relationships**: {analysis.total_relationships}",
            f"- **Total Connections (Entity Perspective)**: {entity_perspective_total}",
            f"- **Average Connections per Entity**: {entity_perspective_total / analysis.total_entities:.1f}",
            f"- **Entity Coverage Target**: {analysis.COVERAGE_TARGET}+ relationships",
            "",
        ])

        # Priority gaps
        priority_gaps = self._identify_priority_gaps(analysis)

        if priority_gaps:
            lines.extend([
                "### Priority Gaps",
                "",
                "_These relationships appear frequently but are not in the catalog:_",
                "",
            ])

            for idx, (rel_type, count) in enumerate(priority_gaps[:5], 1):
                lines.append(f"{idx}. **{rel_type}** - Appears {count} time(s)")

            lines.append("")

        return lines

    def _identify_priority_gaps(
        self, analysis: LayerIntraRelationshipReport
    ) -> List[tuple]:
        """Identify most common gaps.

        Args:
            analysis: Layer analysis results

        Returns:
            List of (relationship_type, count) tuples, sorted by count descending
        """
        gap_counts = defaultdict(int)

        for profile in analysis.entity_profiles.values():
            for rel in profile.outgoing_relationships + profile.incoming_relationships:
                if not rel.in_relationship_catalog:
                    key = f"{rel.relationship_type} ({rel.predicate})"
                    gap_counts[key] += 1

        return sorted(gap_counts.items(), key=lambda x: x[1], reverse=True)

    def _generate_mermaid_diagram(
        self, analysis: LayerIntraRelationshipReport
    ) -> List[str]:
        """Generate Mermaid diagram for intra-layer relationships.

        Args:
            analysis: Layer analysis results

        Returns:
            Mermaid diagram lines
        """
        lines = [
            "### Relationship Diagram",
            "",
            "```mermaid",
            "graph TB",
            f'  subgraph "{analysis.layer_spec.title}"',
            "",
        ]

        # Add nodes for each entity
        for entity_name in sorted(analysis.entity_profiles.keys()):
            lines.append(f'    {entity_name}["{entity_name}"]')

        lines.append("")

        # Add edges for relationships
        added_edges = set()

        for profile in analysis.entity_profiles.values():
            for rel in profile.outgoing_relationships:
                # Create unique key for this edge
                edge_key = (rel.source_entity, rel.target_entity, rel.predicate)

                if edge_key not in added_edges:
                    added_edges.add(edge_key)

                    # Determine edge style based on catalog status
                    if rel.in_relationship_catalog:
                        # Solid line for cataloged relationships
                        lines.append(
                            f'    {rel.source_entity} -->|{rel.predicate}| {rel.target_entity}'
                        )
                    else:
                        # Dashed line for uncataloged relationships
                        lines.append(
                            f'    {rel.source_entity} -.->|{rel.predicate}| {rel.target_entity}'
                        )

        lines.extend([
            "  end",
            "",
            "  %% Styling",
            "  classDef default fill:#E3F2FD,stroke:#1976D2,stroke-width:2px",
            "```",
            "",
        ])

        return lines

    def generate_gap_summary_report(
        self, all_reports: Dict[str, LayerIntraRelationshipReport]
    ) -> str:
        """Generate aggregate gap analysis across all layers.

        Args:
            all_reports: Dictionary mapping layer ID to report

        Returns:
            Markdown gap summary report
        """
        # Get coverage target from first report
        coverage_target = next(iter(all_reports.values())).COVERAGE_TARGET if all_reports else 2

        lines = [
            "# Intra-Layer Relationship Coverage Analysis",
            "",
            "**Generated**: Automatically",
            f"**Layers Analyzed**: {len(all_reports)}",
            f"**Coverage Target**: {coverage_target}+ relationships per entity",
            "",
            "## Executive Summary",
            "",
            "| Layer | Entities | Meeting Target | Coverage % | Total Relations |",
            "|-------|----------|----------------|------------|-----------------|",
        ]

        total_entities = 0
        total_meeting_target = 0
        total_relationships = 0

        for layer_id in sorted(all_reports.keys()):
            report = all_reports[layer_id]

            entities = report.total_entities
            meeting_target = report.entities_meeting_target
            coverage_pct = report.entity_coverage_percentage
            relationships = report.total_relationships

            total_entities += entities
            total_meeting_target += meeting_target
            total_relationships += relationships

            lines.append(
                f"| {layer_id} | {entities} | {meeting_target} | {coverage_pct:.1f}% | {relationships} |"
            )

        # Totals
        total_coverage_pct = (
            (total_meeting_target / total_entities * 100) if total_entities > 0 else 0
        )

        lines.extend([
            f"| **TOTAL** | **{total_entities}** | **{total_meeting_target}** | "
            f"**{total_coverage_pct:.1f}%** | **{total_relationships}** |",
            "",
        ])

        # Coverage statistics
        lines.extend([
            "## Coverage Statistics",
            "",
            f"- **Total Entities**: {total_entities}",
            f"- **Entities Meeting Target**: {total_meeting_target}/{total_entities} ({total_coverage_pct:.1f}%)",
            f"- **Entities Below Target**: {total_entities - total_meeting_target}",
            f"- **Total Relationships**: {total_relationships}",
            f"- **Average Relationships per Entity**: {total_relationships / total_entities:.1f}",
            "",
        ])

        # Layers needing attention
        layers_below_50 = [
            (layer_id, report.entity_coverage_percentage)
            for layer_id, report in all_reports.items()
            if report.entity_coverage_percentage < 50
        ]

        if layers_below_50:
            lines.extend([
                "## Layers Needing Immediate Attention (< 50% Coverage)",
                "",
            ])
            for layer_id, coverage in sorted(layers_below_50, key=lambda x: x[1]):
                report = all_reports[layer_id]
                lines.append(
                    f"- **{layer_id}**: {coverage:.1f}% ({report.entities_meeting_target}/{report.total_entities} entities)"
                )
            lines.append("")

        # Priority recommendations
        lines.extend([
            "## Critical Gaps by Category",
            "",
            "_These relationship types appear frequently across layers but are not in the catalog._",
            "",
        ])

        # Aggregate gap analysis
        all_gaps = defaultdict(int)

        for report in all_reports.values():
            for profile in report.entity_profiles.values():
                for rel in profile.outgoing_relationships + profile.incoming_relationships:
                    if not rel.in_relationship_catalog:
                        key = f"{rel.relationship_type} ({rel.predicate})"
                        all_gaps[key] += 1

        if all_gaps:
            lines.extend([
                "| Relationship Type | Occurrences | Priority |",
                "|-------------------|-------------|----------|",
            ])

            for rel_type, count in sorted(all_gaps.items(), key=lambda x: x[1], reverse=True)[
                :10
            ]:
                priority = "CRITICAL" if count >= 5 else "HIGH" if count >= 3 else "MEDIUM"
                lines.append(f"| {rel_type} | {count} | {priority} |")

            lines.append("")

        # Recommendations
        lines.extend([
            "## Recommended Actions",
            "",
            "1. **Phase 1 - Layers Below 50% Coverage**",
            f"   - Focus on {len(layers_below_50)} layers with critical coverage gaps",
            "   - Ensure each entity has at least 2 relationships",
            "",
            "2. **Phase 2 - Complete Structural Layers** (Business, Application, Technology)",
            "   - Add composition/aggregation relationships where missing",
            "   - Required for ArchiMate compliance",
            "",
            "3. **Phase 3 - Technical Layers** (API, Data, UX, Navigation)",
            "   - Define domain-specific intra-layer relationships",
            "   - Focus on entities with 0-1 relationships",
            "",
        ])

        return "\n".join(lines)
