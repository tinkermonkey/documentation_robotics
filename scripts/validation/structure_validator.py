"""Layer documentation structure validator module.

Validates that layer markdown files follow the standard template structure.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Set


@dataclass
class ValidationIssue:
    """Single validation issue."""

    severity: str  # "error", "warning", "info"
    section: str
    message: str
    line_number: Optional[int] = None


@dataclass
class StructureValidationReport:
    """Validation report for layer documentation structure."""

    layer_id: str
    layer_file: Path
    passed: bool
    issues: List[ValidationIssue]

    @property
    def errors(self) -> List[ValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> List[ValidationIssue]:
        return [i for i in self.issues if i.severity == "warning"]

    @property
    def infos(self) -> List[ValidationIssue]:
        return [i for i in self.issues if i.severity == "info"]


class LayerStructureValidator:
    """Validates layer documentation structure."""

    # Required sections in current standardized layer format
    # All 12 layers follow the same structure: title, standard, overview, node types, references
    REQUIRED_SECTIONS = {
        "Overview",
        "Node Types",
        "References",
    }

    # Recommended sections
    RECOMMENDED_SECTIONS = {
        "Standard",  # Standard reference (ArchiMate, OpenAPI, JSON Schema, etc.)
    }

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize validator.

        Args:
            spec_root: Path to spec/ directory
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"

    def _find_spec_root(self) -> Path:
        """Auto-detect spec root directory."""
        import sys
        # Validator module is in scripts/validation, root is 2 levels up, then spec/
        script_dir = Path(sys.path[0]) if sys.path else Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec" if 'scripts' in str(script_dir) else script_dir / "spec"

        if not spec_root.exists():
            raise FileNotFoundError(f"Could not find spec directory at {spec_root}")

        return spec_root

    def validate_layer(self, layer_id: str) -> StructureValidationReport:
        """Validate a single layer's documentation structure.

        Args:
            layer_id: Layer identifier (e.g., "02-business")

        Returns:
            Validation report
        """
        layer_file = self.layers_path / f"{layer_id}-layer.md"

        if not layer_file.exists():
            return StructureValidationReport(
                layer_id=layer_id,
                layer_file=layer_file,
                passed=False,
                issues=[
                    ValidationIssue(
                        severity="error",
                        section="File",
                        message=f"Layer file not found: {layer_file}",
                    )
                ],
            )

        content = layer_file.read_text(encoding="utf-8")
        lines = content.split("\n")
        issues = []

        # Extract all section headers
        sections_found = set()
        section_line_numbers = {}

        for i, line in enumerate(lines, start=1):
            # Match H2 headers (## Section Name)
            match = re.match(r"^##\s+(.+)$", line)
            if match:
                section_name = match.group(1).strip()
                sections_found.add(section_name)
                section_line_numbers[section_name] = i

        # Check required sections
        missing_required = self.REQUIRED_SECTIONS - sections_found
        for section in missing_required:
            issues.append(
                ValidationIssue(
                    severity="error",
                    section=section,
                    message=f"Required section missing: {section}",
                )
            )

        # Check recommended sections
        missing_recommended = self.RECOMMENDED_SECTIONS - sections_found
        for section in missing_recommended:
            issues.append(
                ValidationIssue(
                    severity="info",
                    section=section,
                    message=f"Recommended section missing: {section} (e.g., Standard reference with link)",
                )
            )

        # Validate first line is title
        if lines:
            first_line = lines[0]
            expected_pattern = r"^#\s+Layer \d+:\s+.+"
            if not re.match(expected_pattern, first_line):
                issues.append(
                    ValidationIssue(
                        severity="error",
                        section="Title",
                        message=f"First line must be '# Layer NN: LayerName', got: {first_line[:50]}",
                        line_number=1,
                    )
                )

        # Note: Optional sections like Cross-Layer Relationships are not required
        # in the current standardized format. Layers use "Node Types" to document
        # all entity definitions with their attributes and relationships.

        # Determine if passed
        passed = len([i for i in issues if i.severity == "error"]) == 0

        return StructureValidationReport(
            layer_id=layer_id,
            layer_file=layer_file,
            passed=passed,
            issues=issues,
        )

    def validate_all_layers(self) -> List[StructureValidationReport]:
        """Validate all layer documentation files.

        Returns:
            List of validation reports
        """
        reports = []

        # Find all layer files
        for layer_file in sorted(self.layers_path.glob("*-layer.md")):
            # Extract layer ID from filename
            match = re.match(r"(\d{2}-[\w-]+)-layer\.md", layer_file.name)
            if match:
                layer_id = match.group(1)
                reports.append(self.validate_layer(layer_id))

        return reports

    def generate_report(self, reports: List[StructureValidationReport]) -> str:
        """Generate markdown report.

        Args:
            reports: Validation reports

        Returns:
            Markdown formatted report
        """
        lines = [
            "# Layer Documentation Structure Validation Report",
            "",
            f"**Layers Validated**: {len(reports)}",
            f"**Passed**: {len([r for r in reports if r.passed])}",
            f"**Failed**: {len([r for r in reports if not r.passed])}",
            "",
        ]

        # Summary table
        lines.append("## Summary")
        lines.append("")
        lines.append("| Layer | Status | Errors | Warnings | Info |")
        lines.append("|-------|--------|--------|----------|------|")

        for report in reports:
            status = "✅ PASS" if report.passed else "❌ FAIL"
            lines.append(
                f"| {report.layer_id} | {status} | {len(report.errors)} | "
                f"{len(report.warnings)} | {len(report.infos)} |"
            )

        lines.append("")

        # Detailed issues
        lines.append("## Detailed Issues")
        lines.append("")

        for report in reports:
            if report.issues:
                lines.append(f"### {report.layer_id}")
                lines.append("")

                for issue in report.issues:
                    icon = "🔴" if issue.severity == "error" else "⚠️" if issue.severity == "warning" else "ℹ️"
                    location = f" (line {issue.line_number})" if issue.line_number else ""
                    lines.append(f"- {icon} **{issue.section}**{location}: {issue.message}")

                lines.append("")

        return "\n".join(lines)
