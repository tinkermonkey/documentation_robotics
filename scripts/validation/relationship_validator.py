"""Relationship Validator - Validates relationship completeness and correctness.

This module validates that all relationships follow the registry schema, reference valid targets,
use correct cardinality and formats, and maintain consistency across the ontology.
"""

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from uuid import UUID

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry
from utils.relationship_parser import RelationshipParser, ParsedRelationship


@dataclass
class ValidationIssue:
    """Represents a single validation issue."""

    severity: str  # error, warning, info
    category: str  # schema, reference, cardinality, format, bidirectionality, required
    message: str
    location: str  # file path or layer ID
    field_path: Optional[str] = None
    expected: Optional[str] = None
    actual: Optional[str] = None
    suggestion: Optional[str] = None


@dataclass
class ValidationReport:
    """Complete validation report."""

    total_issues: int
    errors: List[ValidationIssue]
    warnings: List[ValidationIssue]
    info: List[ValidationIssue]
    layers_validated: int
    links_validated: int
    validation_passed: bool
    format_breakdown: Dict[str, int] = field(default_factory=dict)  # NEW: Count by format type


class RelationshipValidator:
    """Validates relationship completeness and correctness across the ontology."""

    # UUID pattern for validation
    UUID_PATTERN = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        re.IGNORECASE
    )

    # Duration pattern (e.g., "200ms", "2s", "5m", "1h")
    DURATION_PATTERN = re.compile(r'^\d+(?:ms|s|m|h)$')

    # Percentage pattern (e.g., "99.9%", "99.95%")
    PERCENTAGE_PATTERN = re.compile(r'^\d+(?:\.\d+)?%$')

    # Path pattern (file paths)
    PATH_PATTERN = re.compile(r'^[a-zA-Z0-9_/\-\.]+$')

    def __init__(self, spec_root: Optional[Path] = None, registry: Optional[LinkRegistry] = None):
        """Initialize the relationship validator.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
            registry: LinkRegistry instance. If None, creates new instance.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.registry = registry or LinkRegistry()

        # NEW: Use shared relationship parser
        self.parser = RelationshipParser(
            registry=self.registry,
            relationship_catalog=self._load_relationship_catalog()
        )

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

    def _load_relationship_catalog(self) -> Dict:
        """Load relationship catalog from JSON."""
        catalog_path = self.spec_root / "schemas" / "relationship-catalog.json"

        if not catalog_path.exists():
            return {"relationshipTypes": []}

        with open(catalog_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def validate(self, layer_id: Optional[str] = None) -> ValidationReport:
        """Perform comprehensive relationship validation.

        Args:
            layer_id: Optional layer ID to validate. If None, validates all layers.

        Returns:
            ValidationReport with all validation issues.
        """
        issues: List[ValidationIssue] = []
        layers_validated = 0
        links_validated = 0
        format_counts: Dict[str, int] = {}

        # Determine which layers to validate
        if layer_id:
            layer_files = list(self.layers_path.glob(f"{layer_id}-*.md"))
        else:
            layer_files = list(self.layers_path.glob("*.md"))

        # Validate each layer
        for layer_file in sorted(layer_files):
            lid = self._extract_layer_id(layer_file.name)
            if not lid:
                continue

            layer_issues, link_count, layer_format_counts = self._validate_layer(layer_file, lid)
            issues.extend(layer_issues)
            layers_validated += 1
            links_validated += link_count

            # Aggregate format counts
            for format_type, count in layer_format_counts.items():
                format_counts[format_type] = format_counts.get(format_type, 0) + count

        # Categorize issues
        errors = [i for i in issues if i.severity == "error"]
        warnings = [i for i in issues if i.severity == "warning"]
        info = [i for i in issues if i.severity == "info"]

        return ValidationReport(
            total_issues=len(issues),
            errors=errors,
            warnings=warnings,
            info=info,
            layers_validated=layers_validated,
            links_validated=links_validated,
            validation_passed=(len(errors) == 0),
            format_breakdown=format_counts,
        )

    def _extract_layer_id(self, filename: str) -> Optional[str]:
        """Extract layer ID from filename (e.g., '02-business' from '02-business-layer.md')."""
        match = re.match(r'^(\d+-[a-z-]+)-layer\.md$', filename)
        return match.group(1) if match else None

    def _validate_layer(self, layer_file: Path, layer_id: str) -> Tuple[List[ValidationIssue], int, Dict[str, int]]:
        """Validate relationships in a single layer file.

        Returns:
            Tuple of (issues, link_count, format_counts)
        """
        issues: List[ValidationIssue] = []

        content = layer_file.read_text(encoding="utf-8")

        # NEW: Parse all relationship formats using shared parser
        parse_result = self.parser.parse_all_formats(content, layer_id, layer_file)

        # Validate each parsed relationship
        for relationship in parse_result.relationships:
            rel_issues = self._validate_parsed_relationship(relationship, layer_id, str(layer_file))
            issues.extend(rel_issues)

        # Add any parser errors/warnings
        for error in parse_result.errors:
            issues.append(ValidationIssue(
                severity="error",
                category="parsing",
                message=error,
                location=str(layer_file),
            ))

        for warning in parse_result.warnings:
            issues.append(ValidationIssue(
                severity="warning",
                category="parsing",
                message=warning,
                location=str(layer_file),
            ))

        link_count = len(parse_result.relationships)
        format_counts = parse_result.metadata.get('by_format', {})

        return issues, link_count, format_counts

    def _validate_parsed_relationship(
        self,
        relationship: ParsedRelationship,
        layer_id: str,
        location: str,
    ) -> List[ValidationIssue]:
        """Validate a parsed relationship (replaces old _validate_link_instance).

        This method validates relationships from all 4 formats using a unified approach.
        """
        issues: List[ValidationIssue] = []

        # Use parser's built-in validation first
        parser_issues = self.parser.validate_relationship(relationship, strict=True)

        # Convert parser issues to ValidationIssue format
        for parser_issue in parser_issues:
            issues.append(ValidationIssue(
                severity=parser_issue.get('severity', 'warning'),
                category=parser_issue.get('category', 'validation'),
                message=parser_issue.get('message', ''),
                location=parser_issue.get('location', location),
                field_path=parser_issue.get('field_path'),
                expected=parser_issue.get('expected'),
                actual=parser_issue.get('actual'),
                suggestion=parser_issue.get('suggestion'),
            ))

        # Format-specific validation
        if relationship.format_type in ["yaml_property", "xml_property"]:
            # Validate against link registry
            link_type_id = relationship.properties.get('link_type_id')
            if link_type_id:
                link_type = self.registry.link_types.get(link_type_id)
                if link_type:
                    # Schema validation - check source layer
                    if layer_id not in link_type.source_layers:
                        issues.append(ValidationIssue(
                            severity="error",
                            category="schema",
                            message=f"Link type '{link_type.id}' used in invalid source layer",
                            location=location,
                            field_path=relationship.field_path,
                            expected=f"One of: {', '.join(link_type.source_layers)}",
                            actual=layer_id,
                            suggestion=f"This link should only be used in layers: {', '.join(link_type.source_layers)}",
                        ))

                    # Required validation
                    if link_type.is_required and not relationship.value:
                        issues.append(ValidationIssue(
                            severity="error",
                            category="required",
                            message=f"Required link '{link_type.id}' is missing value",
                            location=location,
                            field_path=relationship.field_path,
                            expected="Non-empty value",
                            actual="empty",
                            suggestion=f"This link is required: {link_type.description}",
                        ))

        elif relationship.format_type == "xml_relationship":
            # Validate XML relationships (intra-layer)
            # Predicate validation is already handled by parser
            pass

        elif relationship.format_type == "integration_point":
            # Integration points are documentation - validate consistency
            if relationship.field_path:
                # Check if mentioned property exists in registry
                link_types = self.registry.find_links_by_field_path(relationship.field_path)
                if not link_types:
                    issues.append(ValidationIssue(
                        severity="warning",
                        category="reference",
                        message=f"Integration point references unknown property '{relationship.field_path}'",
                        location=location,
                        field_path=relationship.field_path,
                        suggestion="Add this property to link-registry.json or remove reference",
                    ))

        return issues

    def _validate_format(self, format_type: str, value: str, field_path: str, location: str) -> List[ValidationIssue]:
        """Validate value format."""
        issues: List[ValidationIssue] = []

        # Skip validation for documentation examples (pipe-separated options)
        if '|' in value:
            return issues

        # Split array values
        values = [v.strip() for v in value.split(',')] if ',' in value else [value]

        for val in values:
            if not val:
                continue

            if format_type == "uuid":
                if not self.UUID_PATTERN.match(val):
                    issues.append(ValidationIssue(
                        severity="error",
                        category="format",
                        message=f"Value does not match UUID format",
                        location=location,
                        field_path=field_path,
                        expected="UUID (e.g., 123e4567-e89b-12d3-a456-426614174000)",
                        actual=val,
                    ))

            elif format_type == "duration":
                if not self.DURATION_PATTERN.match(val):
                    issues.append(ValidationIssue(
                        severity="warning",
                        category="format",
                        message=f"Value does not match duration format",
                        location=location,
                        field_path=field_path,
                        expected="Duration (e.g., 200ms, 2s, 5m, 1h)",
                        actual=val,
                        suggestion="Use format: <number><unit> where unit is ms/s/m/h",
                    ))

            elif format_type == "percentage":
                if not self.PERCENTAGE_PATTERN.match(val):
                    issues.append(ValidationIssue(
                        severity="warning",
                        category="format",
                        message=f"Value does not match percentage format",
                        location=location,
                        field_path=field_path,
                        expected="Percentage (e.g., 99.9%, 99.95%)",
                        actual=val,
                        suggestion="Use format: <number>%",
                    ))

            elif format_type == "path":
                if not self.PATH_PATTERN.match(val):
                    issues.append(ValidationIssue(
                        severity="warning",
                        category="format",
                        message=f"Value does not match path format",
                        location=location,
                        field_path=field_path,
                        expected="File path (alphanumeric, /, -, _, .)",
                        actual=val,
                    ))

        return issues

    def generate_markdown_report(self, report: ValidationReport) -> str:
        """Generate markdown-formatted validation report."""
        lines = ["# Relationship Validation Report", ""]

        # Summary
        status_emoji = "✅" if report.validation_passed else "❌"
        lines.extend([
            "## Executive Summary",
            "",
            f"{status_emoji} **Validation Status**: {'PASSED' if report.validation_passed else 'FAILED'}",
            "",
            f"- **Total Issues**: {report.total_issues}",
            f"- **Errors**: {len(report.errors)} 🔴",
            f"- **Warnings**: {len(report.warnings)} ⚠️",
            f"- **Info**: {len(report.info)} ℹ️",
            f"- **Layers Validated**: {report.layers_validated}",
            f"- **Relationships Validated**: {report.links_validated}",
            "",
        ])

        # NEW: Breakdown by format
        if report.format_breakdown:
            lines.extend([
                "## Relationships by Format",
                "",
                "| Format | Count |",
                "|--------|-------|",
            ])
            for format_type, count in sorted(report.format_breakdown.items()):
                # Make format names more readable
                format_display = format_type.replace('_', ' ').title()
                lines.append(f"| {format_display} | {count} |")
            lines.append("")

        # Issues by severity
        if report.errors:
            lines.extend([
                "## Errors (Must Fix)",
                "",
                "| Category | Message | Location | Field Path | Expected | Actual |",
                "|----------|---------|----------|------------|----------|--------|",
            ])
            for issue in report.errors:
                lines.append(
                    f"| {issue.category} | {issue.message} | {Path(issue.location).name} | "
                    f"`{issue.field_path or 'N/A'}` | {issue.expected or 'N/A'} | {issue.actual or 'N/A'} |"
                )
            lines.append("")

        if report.warnings:
            lines.extend([
                "## Warnings (Should Fix)",
                "",
                "| Category | Message | Location | Field Path | Suggestion |",
                "|----------|---------|----------|------------|------------|",
            ])
            for issue in report.warnings:
                lines.append(
                    f"| {issue.category} | {issue.message} | {Path(issue.location).name} | "
                    f"`{issue.field_path or 'N/A'}` | {issue.suggestion or 'N/A'} |"
                )
            lines.append("")

        if report.info:
            lines.extend([
                "## Info (Optional)",
                "",
                "| Category | Message | Location |",
                "|----------|---------|----------|",
            ])
            for issue in report.info:
                lines.append(f"| {issue.category} | {issue.message} | {Path(issue.location).name} |")
            lines.append("")

        # Issues by category
        if report.total_issues > 0:
            issues_by_category = {}
            for issue in (report.errors + report.warnings + report.info):
                if issue.category not in issues_by_category:
                    issues_by_category[issue.category] = []
                issues_by_category[issue.category].append(issue)

            lines.extend([
                "## Issues by Category",
                "",
                "| Category | Count |",
                "|----------|-------|",
            ])
            for category in sorted(issues_by_category.keys(), key=lambda c: len(issues_by_category[c]), reverse=True):
                count = len(issues_by_category[category])
                lines.append(f"| {category} | {count} |")
            lines.append("")

        return "\n".join(lines)

    def export_json(self, report: ValidationReport, output_path: Path) -> None:
        """Export validation report to JSON file."""
        def issue_to_dict(issue: ValidationIssue) -> dict:
            return {
                "severity": issue.severity,
                "category": issue.category,
                "message": issue.message,
                "location": issue.location,
                "field_path": issue.field_path,
                "expected": issue.expected,
                "actual": issue.actual,
                "suggestion": issue.suggestion,
            }

        data = {
            "summary": {
                "validation_passed": report.validation_passed,
                "total_issues": report.total_issues,
                "errors": len(report.errors),
                "warnings": len(report.warnings),
                "info": len(report.info),
                "layers_validated": report.layers_validated,
                "links_validated": report.links_validated,
            },
            "errors": [issue_to_dict(i) for i in report.errors],
            "warnings": [issue_to_dict(i) for i in report.warnings],
            "info": [issue_to_dict(i) for i in report.info],
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
