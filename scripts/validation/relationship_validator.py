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

        # Patterns for extraction
        self.property_pattern = re.compile(r'^\s*-\s+key:\s*"([^"]+)"\s*\n\s*value:\s*"([^"]*)"', re.MULTILINE)

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

            layer_issues, link_count = self._validate_layer(layer_file, lid)
            issues.extend(layer_issues)
            layers_validated += 1
            links_validated += link_count

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
        )

    def _extract_layer_id(self, filename: str) -> Optional[str]:
        """Extract layer ID from filename."""
        match = re.match(r'^(\d+)-', filename)
        return match.group(1) if match else None

    def _validate_layer(self, layer_file: Path, layer_id: str) -> Tuple[List[ValidationIssue], int]:
        """Validate relationships in a single layer file."""
        issues: List[ValidationIssue] = []
        link_count = 0

        content = layer_file.read_text(encoding="utf-8")

        # Extract all property definitions
        property_matches = self.property_pattern.finditer(content)

        for match in property_matches:
            field_path = match.group(1)
            value = match.group(2)

            # Find matching link type in registry
            matching_links = self.registry.find_links_by_field_path(field_path)

            if not matching_links:
                # Field path not in registry (already reported by coverage analyzer)
                continue

            link_type = matching_links[0]  # Use first match
            link_count += 1

            # Validate this link instance
            link_issues = self._validate_link_instance(
                link_type, field_path, value, layer_id, str(layer_file)
            )
            issues.extend(link_issues)

        return issues, link_count

    def _validate_link_instance(
        self,
        link_type,
        field_path: str,
        value: str,
        layer_id: str,
        location: str,
    ) -> List[ValidationIssue]:
        """Validate a single link instance."""
        issues: List[ValidationIssue] = []

        # 1. Schema validation - check source layer
        if layer_id not in link_type.source_layers:
            issues.append(ValidationIssue(
                severity="error",
                category="schema",
                message=f"Link type '{link_type.id}' used in invalid source layer",
                location=location,
                field_path=field_path,
                expected=f"One of: {', '.join(link_type.source_layers)}",
                actual=layer_id,
                suggestion=f"This link should only be used in layers: {', '.join(link_type.source_layers)}",
            ))

        # 2. Cardinality validation
        if link_type.is_array:
            # Should be comma-separated list
            if value and ',' not in value and len(value.split()) == 1:
                issues.append(ValidationIssue(
                    severity="warning",
                    category="cardinality",
                    message=f"Link expects array but appears to have single value",
                    location=location,
                    field_path=field_path,
                    expected="Comma-separated list",
                    actual=value,
                    suggestion="Use comma-separated format: value1,value2,value3",
                ))
        else:
            # Should be single value
            if value and ',' in value:
                issues.append(ValidationIssue(
                    severity="error",
                    category="cardinality",
                    message=f"Link expects single value but has multiple",
                    location=location,
                    field_path=field_path,
                    expected="Single value",
                    actual=value,
                    suggestion="Remove extra values or use array-type link",
                ))

        # 3. Format validation
        if value:
            format_issues = self._validate_format(link_type.format, value, field_path, location)
            issues.extend(format_issues)

        # 4. Required validation (if field is marked as required)
        if link_type.is_required and not value:
            issues.append(ValidationIssue(
                severity="error",
                category="required",
                message=f"Required link '{link_type.id}' is missing value",
                location=location,
                field_path=field_path,
                expected="Non-empty value",
                actual="empty",
                suggestion=f"This link is required: {link_type.description}",
            ))

        return issues

    def _validate_format(self, format_type: str, value: str, field_path: str, location: str) -> List[ValidationIssue]:
        """Validate value format."""
        issues: List[ValidationIssue] = []

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
            f"- **Links Validated**: {report.links_validated}",
            "",
        ])

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
