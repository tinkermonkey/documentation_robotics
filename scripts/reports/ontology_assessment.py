"""Ontology Assessment Report Generator - Generates comprehensive assessment reports.

This module creates executive summaries of ontology state including coverage metrics,
gap summaries, consistency scores, maturity assessments, and recommendations.
"""

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from analysis.link_coverage_analyzer import LinkCoverageAnalyzer
from analysis.predicate_extractor import PredicateExtractor
from analysis.gap_analyzer import GapAnalyzer
from analysis.link_instance_catalog import LinkInstanceCatalog
from utils.link_registry import LinkRegistry


@dataclass
class MaturityScore:
    """Maturity assessment for a layer."""

    layer_id: str
    layer_name: str
    score: int  # 1-5 scale
    strengths: List[str]
    weaknesses: List[str]


@dataclass
class AssessmentReport:
    """Comprehensive ontology assessment report."""

    # Coverage metrics
    total_layers: int
    total_link_types: int
    link_types_used: int
    coverage_percentage: float
    unused_link_types: int

    # Predicate metrics
    total_predicates: int
    categorized_predicates: int
    uncategorized_predicates: int
    xml_relationship_types: int

    # Gap metrics
    total_gaps: int
    critical_gaps: int
    high_priority_gaps: int
    inter_layer_gaps: int
    intra_layer_gaps: int
    semantic_gaps: int
    bidirectional_gaps: int
    element_coverage_gaps: int

    # Usage metrics
    total_link_instances: int
    unique_link_types_used: int

    # Maturity scores
    layer_maturity: List[MaturityScore]
    overall_maturity: float

    # Top recommendations
    recommendations: List[str]


class OntologyAssessmentReporter:
    """Generates comprehensive ontology assessment reports."""

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize the assessment reporter.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.registry = LinkRegistry()
        self.coverage_analyzer = LinkCoverageAnalyzer(spec_root=self.spec_root, registry=self.registry)
        self.predicate_extractor = PredicateExtractor(spec_root=self.spec_root)
        self.gap_analyzer = GapAnalyzer(spec_root=self.spec_root, registry=self.registry)
        self.instance_catalog = LinkInstanceCatalog(spec_root=self.spec_root, registry=self.registry)

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

    def generate_assessment(self) -> AssessmentReport:
        """Generate comprehensive assessment report."""
        # Run analyses
        print("Running coverage analysis...")
        coverage_report = self.coverage_analyzer.analyze()

        print("Extracting predicates...")
        predicate_catalog = self.predicate_extractor.extract()

        print("Analyzing gaps...")
        gap_report = self.gap_analyzer.analyze()

        print("Cataloging link instances...")
        instance_catalog = self.instance_catalog.catalog()

        # Calculate metrics
        total_link_types = len(self.registry.link_types)
        coverage_percentage = (coverage_report.link_types_found_in_docs / total_link_types * 100) if total_link_types > 0 else 0

        categorized = sum(
            count for cat, count in predicate_catalog.categories.items()
            if cat != "Other"
        )

        # Calculate layer maturity scores
        layer_maturity = self._assess_layer_maturity(coverage_report, gap_report, instance_catalog)

        overall_maturity = sum(m.score for m in layer_maturity) / len(layer_maturity) if layer_maturity else 0

        # Generate recommendations
        recommendations = self._generate_recommendations(
            coverage_report, predicate_catalog, gap_report, instance_catalog
        )

        return AssessmentReport(
            total_layers=coverage_report.layers_analyzed,
            total_link_types=total_link_types,
            link_types_used=coverage_report.link_types_found_in_docs,
            coverage_percentage=coverage_percentage,
            unused_link_types=len(coverage_report.link_types_unused),
            total_predicates=len(predicate_catalog.predicates),
            categorized_predicates=categorized,
            uncategorized_predicates=predicate_catalog.categories.get("Other", 0),
            xml_relationship_types=len(predicate_catalog.xml_relationship_types),
            total_gaps=gap_report.total_gaps,
            critical_gaps=gap_report.critical_gaps,
            high_priority_gaps=gap_report.high_priority_gaps,
            inter_layer_gaps=len(gap_report.inter_layer_gaps),
            intra_layer_gaps=len(gap_report.intra_layer_gaps),
            semantic_gaps=len(gap_report.semantic_gaps),
            bidirectional_gaps=len(gap_report.bidirectional_gaps),
            element_coverage_gaps=len(gap_report.element_coverage_gaps),
            total_link_instances=instance_catalog.total_instances,
            unique_link_types_used=instance_catalog.unique_link_types_used,
            layer_maturity=layer_maturity,
            overall_maturity=overall_maturity,
            recommendations=recommendations,
        )

    def _assess_layer_maturity(self, coverage_report, gap_report, instance_catalog) -> List[MaturityScore]:
        """Assess maturity of each layer (1-5 scale)."""
        layer_names = {
            "01": "Motivation",
            "02": "Business",
            "03": "Security",
            "04": "Application",
            "05": "Technology",
            "06": "API",
            "07": "Data Model",
            "08": "Datastore",
            "09": "UX",
            "10": "Navigation",
            "11": "APM/Observability",
            "12": "Testing",
        }

        maturity_scores = []

        for layer_id, layer_name in sorted(layer_names.items()):
            # Find layer coverage
            layer_cov = next(
                (lc for lc in coverage_report.layer_coverage.values() if lc.layer_id == layer_id),
                None
            )

            if not layer_cov:
                continue

            strengths = []
            weaknesses = []
            score = 3  # Start at baseline

            # Factor 1: Link coverage
            link_count = layer_cov.outgoing_link_count + layer_cov.incoming_link_count
            if link_count > 10:
                strengths.append(f"Rich link coverage ({link_count} links)")
                score += 1
            elif link_count < 3:
                weaknesses.append(f"Low link coverage ({link_count} links)")
                score -= 1

            # Factor 2: Missing registry links
            if len(layer_cov.missing_registry_links) == 0:
                strengths.append("All links properly registered")
                score += 0.5
            elif len(layer_cov.missing_registry_links) > 5:
                weaknesses.append(f"{len(layer_cov.missing_registry_links)} unregistered links")
                score -= 0.5

            # Factor 3: Entity coverage
            if layer_cov.total_entity_types > 0:
                entity_coverage = layer_cov.entity_types_with_links / layer_cov.total_entity_types
                if entity_coverage > 0.7:
                    strengths.append(f"High entity coverage ({entity_coverage:.0%})")
                    score += 0.5
                elif entity_coverage < 0.3:
                    weaknesses.append(f"Low entity coverage ({entity_coverage:.0%})")
                    score -= 0.5

            # Factor 4: Gap presence
            layer_gaps = [
                g for g in gap_report.inter_layer_gaps + gap_report.semantic_gaps
                if layer_id in g.affected_layers
            ]
            if len(layer_gaps) > 3:
                weaknesses.append(f"{len(layer_gaps)} gaps identified")
                score -= 0.5

            # Clamp score to 1-5
            final_score = max(1, min(5, int(round(score))))

            maturity_scores.append(MaturityScore(
                layer_id=layer_id,
                layer_name=layer_name,
                score=final_score,
                strengths=strengths,
                weaknesses=weaknesses,
            ))

        return maturity_scores

    def _generate_recommendations(self, coverage_report, predicate_catalog, gap_report, instance_catalog) -> List[str]:
        """Generate prioritized recommendations."""
        recommendations = []

        # Recommendation 1: Critical/high priority gaps
        if gap_report.high_priority_gaps > 0:
            recommendations.append(
                f"**PRIORITY 1**: Address {gap_report.high_priority_gaps} high-priority gaps "
                "identified in gap analysis report."
            )

        # Recommendation 2: Unused link types
        if coverage_report.link_types_unused:
            recommendations.append(
                f"**PRIORITY 2**: Review {len(coverage_report.link_types_unused)} unused link types "
                "for deprecation or add examples to documentation."
            )

        # Recommendation 3: Unregistered links
        total_unregistered = len(coverage_report.links_in_docs_not_in_registry)
        if total_unregistered > 10:
            recommendations.append(
                f"**PRIORITY 3**: Register {total_unregistered} field paths found in docs "
                "but missing from link-registry.json."
            )

        # Recommendation 4: Predicate categorization
        uncategorized_pct = (predicate_catalog.categories.get("Other", 0) / predicate_catalog.total_predicate_usages * 100) if predicate_catalog.total_predicate_usages > 0 else 0
        if uncategorized_pct > 50:
            recommendations.append(
                f"**PRIORITY 4**: Categorize {predicate_catalog.categories.get('Other', 0)} predicates "
                f"currently in 'Other' category ({uncategorized_pct:.1f}% of total)."
            )

        # Recommendation 5: Bidirectional relationships
        if gap_report.bidirectional_gaps:
            recommendations.append(
                f"**PRIORITY 5**: Define inverse predicates for {len(gap_report.bidirectional_gaps)} "
                "relationships to enable bidirectional navigation."
            )

        # Recommendation 6: Element coverage
        if gap_report.element_coverage_gaps:
            top_layers = {}
            for gap in gap_report.element_coverage_gaps[:20]:  # Top 20
                for layer in gap.affected_layers:
                    top_layers[layer] = top_layers.get(layer, 0) + 1

            if top_layers:
                worst_layer = max(top_layers.items(), key=lambda x: x[1])
                recommendations.append(
                    f"**PRIORITY 6**: Improve element coverage. Layer {worst_layer[0]} has "
                    f"{worst_layer[1]} entities with no documented links."
                )

        # Recommendation 7: Inter-layer gaps
        if gap_report.inter_layer_gaps:
            recommendations.append(
                f"**PRIORITY 7**: Define links for {len(gap_report.inter_layer_gaps)} missing "
                "expected layer pairs (see gap analysis report)."
            )

        # Recommendation 8: Documentation examples
        empty_example_count = sum(
            1 for lt in self.registry.link_types.values()
            if not lt.examples
        )
        if empty_example_count > 5:
            recommendations.append(
                f"**PRIORITY 8**: Add examples to {empty_example_count} link types "
                "with empty examples[] fields."
            )

        return recommendations

    def generate_markdown_report(self, assessment: AssessmentReport) -> str:
        """Generate markdown assessment report."""
        lines = ["# Ontology Assessment Report", ""]

        # Executive Summary
        lines.extend([
            "## Executive Summary",
            "",
            f"This report provides a comprehensive assessment of the Documentation Robotics ontology,",
            f"evaluating coverage, consistency, maturity, and identifying areas for improvement.",
            "",
            f"**Overall Maturity Score**: {assessment.overall_maturity:.1f}/5.0",
            "",
        ])

        # Coverage Metrics
        lines.extend([
            "## Coverage Metrics",
            "",
            "| Metric | Value |",
            "|--------|-------|",
            f"| Layers Analyzed | {assessment.total_layers} |",
            f"| Total Link Types (Registry) | {assessment.total_link_types} |",
            f"| Link Types Used (Docs) | {assessment.link_types_used} |",
            f"| **Coverage Percentage** | **{assessment.coverage_percentage:.1f}%** |",
            f"| Unused Link Types | {assessment.unused_link_types} |",
            f"| Total Link Instances | {assessment.total_link_instances} |",
            f"| Unique Link Types with Instances | {assessment.unique_link_types_used} |",
            "",
        ])

        # Predicate Metrics
        lines.extend([
            "## Predicate Metrics",
            "",
            "| Metric | Value |",
            "|--------|-------|",
            f"| Total Unique Predicates | {assessment.total_predicates} |",
            f"| Categorized Predicates | {assessment.categorized_predicates} |",
            f"| Uncategorized Predicates | {assessment.uncategorized_predicates} |",
            f"| XML Relationship Types | {assessment.xml_relationship_types} |",
            "",
        ])

        # Gap Summary
        lines.extend([
            "## Gap Summary",
            "",
            "| Gap Type | Count |",
            "|----------|-------|",
            f"| **Total Gaps** | **{assessment.total_gaps}** |",
            f"| Critical Priority | {assessment.critical_gaps} |",
            f"| High Priority | {assessment.high_priority_gaps} |",
            f"| Inter-Layer Gaps | {assessment.inter_layer_gaps} |",
            f"| Intra-Layer Gaps | {assessment.intra_layer_gaps} |",
            f"| Semantic Gaps | {assessment.semantic_gaps} |",
            f"| Bidirectional Gaps | {assessment.bidirectional_gaps} |",
            f"| Element Coverage Gaps | {assessment.element_coverage_gaps} |",
            "",
        ])

        # Layer Maturity Assessment
        lines.extend([
            "## Layer Maturity Assessment",
            "",
            "Maturity scale: 1 (Immature) - 5 (Mature)",
            "",
            "| Layer | Score | Strengths | Weaknesses |",
            "|-------|-------|-----------|------------|",
        ])

        for maturity in assessment.layer_maturity:
            stars = "⭐" * maturity.score
            strengths = "; ".join(maturity.strengths) if maturity.strengths else "None identified"
            weaknesses = "; ".join(maturity.weaknesses) if maturity.weaknesses else "None identified"
            lines.append(
                f"| {maturity.layer_id}: {maturity.layer_name} | {stars} ({maturity.score}/5) | "
                f"{strengths} | {weaknesses} |"
            )

        lines.append("")

        # Recommendations
        lines.extend([
            "## Priority Recommendations",
            "",
            "The following recommendations are prioritized based on impact and urgency:",
            "",
        ])

        for idx, rec in enumerate(assessment.recommendations, 1):
            lines.append(f"{idx}. {rec}")
            lines.append("")

        # Next Steps
        lines.extend([
            "## Next Steps",
            "",
            "Based on this assessment, the recommended next steps are:",
            "",
            "1. **Immediate (Week 1-2)**:",
            "   - Address high-priority gaps identified in gap analysis",
            "   - Register all unregistered field paths in link-registry.json",
            "   - Add examples to link types with empty examples[]",
            "",
            "2. **Short-term (Week 3-6)**:",
            "   - Categorize uncategorized predicates",
            "   - Define inverse predicates for bidirectional navigation",
            "   - Improve entity coverage for low-scoring layers",
            "",
            "3. **Medium-term (Week 7-12)**:",
            "   - Define missing inter-layer relationships",
            "   - Implement automated link registry generation",
            "   - Build query and traceability tooling",
            "",
            "## Related Reports",
            "",
            "For detailed analysis, see:",
            "- `reports/ontology/link-coverage-report.md` - Detailed link coverage analysis",
            "- `reports/ontology/predicate-catalog.md` - Complete predicate catalog",
            "- `reports/ontology/gap-analysis-report.md` - Detailed gap analysis",
            "- `reports/catalog/link-instances.md` - Link instance usage statistics",
            "- `reports/visualization/relationship-matrices.md` - Relationship matrices",
        ])

        return "\n".join(lines)

    def export_json(self, assessment: AssessmentReport, output_path: Path) -> None:
        """Export assessment as JSON."""
        data = {
            "coverage": {
                "total_layers": assessment.total_layers,
                "total_link_types": assessment.total_link_types,
                "link_types_used": assessment.link_types_used,
                "coverage_percentage": round(assessment.coverage_percentage, 2),
                "unused_link_types": assessment.unused_link_types,
                "total_link_instances": assessment.total_link_instances,
                "unique_link_types_used": assessment.unique_link_types_used,
            },
            "predicates": {
                "total_predicates": assessment.total_predicates,
                "categorized_predicates": assessment.categorized_predicates,
                "uncategorized_predicates": assessment.uncategorized_predicates,
                "xml_relationship_types": assessment.xml_relationship_types,
            },
            "gaps": {
                "total_gaps": assessment.total_gaps,
                "critical_gaps": assessment.critical_gaps,
                "high_priority_gaps": assessment.high_priority_gaps,
                "inter_layer_gaps": assessment.inter_layer_gaps,
                "intra_layer_gaps": assessment.intra_layer_gaps,
                "semantic_gaps": assessment.semantic_gaps,
                "bidirectional_gaps": assessment.bidirectional_gaps,
                "element_coverage_gaps": assessment.element_coverage_gaps,
            },
            "maturity": {
                "overall_score": round(assessment.overall_maturity, 2),
                "layers": [
                    {
                        "layer_id": m.layer_id,
                        "layer_name": m.layer_name,
                        "score": m.score,
                        "strengths": m.strengths,
                        "weaknesses": m.weaknesses,
                    }
                    for m in assessment.layer_maturity
                ],
            },
            "recommendations": assessment.recommendations,
        }

        output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
