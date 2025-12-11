#!/usr/bin/env python3
"""Layer Documentation Structure Validator.

Validates that layer markdown files follow the standard template structure.
"""

import re
import sys
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

    # Required sections in v2.0.0 template
    REQUIRED_SECTIONS = {
        "Overview",
        "Layer Characteristics",
        "Entity Definitions",
        "Example Model",
        "Validation Rules",
    }

    # Recommended sections
    RECOMMENDED_SECTIONS = {
        "Intra-Layer Relationships",
        "Cross-Layer Relationships",
        "Integration Points",
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
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

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
                    severity="warning",
                    section=section,
                    message=f"Recommended section missing: {section} (see v2.0.0 template)",
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

        # Check for cross-layer relationships table structure
        if "Cross-Layer Relationships" in sections_found:
            # Look for relationship tables
            in_cross_layer = False
            found_outgoing = False
            found_incoming = False

            for i, line in enumerate(lines, start=1):
                if "## Cross-Layer Relationships" in line:
                    in_cross_layer = True
                elif in_cross_layer and line.startswith("## ") and "Cross-Layer" not in line:
                    in_cross_layer = False

                if in_cross_layer:
                    if "### Outgoing Relationships" in line:
                        found_outgoing = True
                    if "### Incoming Relationships" in line:
                        found_incoming = True

            if not found_outgoing:
                issues.append(
                    ValidationIssue(
                        severity="warning",
                        section="Cross-Layer Relationships",
                        message="Missing '### Outgoing Relationships' subsection",
                        line_number=section_line_numbers.get("Cross-Layer Relationships"),
                    )
                )

            if not found_incoming:
                issues.append(
                    ValidationIssue(
                        severity="warning",
                        section="Cross-Layer Relationships",
                        message="Missing '### Incoming Relationships' subsection",
                        line_number=section_line_numbers.get("Cross-Layer Relationships"),
                    )
                )

        # Check for Mermaid diagrams
        mermaid_count = content.count("```mermaid")
        if mermaid_count == 0:
            issues.append(
                ValidationIssue(
                    severity="info",
                    section="Diagrams",
                    message="No Mermaid diagrams found. Consider adding relationship diagrams.",
                )
            )

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


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Validate layer documentation structure against v2.0.0 template"
    )
    parser.add_argument("--layer", help="Validate specific layer (e.g., 02-business)")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("reports/validation/structure-validation.md"),
        help="Output file for report",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors (exit 1 if warnings found)",
    )

    args = parser.parse_args()

    print("Layer Documentation Structure Validator")
    print("=" * 60)
    print()

    try:
        validator = LayerStructureValidator()

        if args.layer:
            reports = [validator.validate_layer(args.layer)]
        else:
            reports = validator.validate_all_layers()

        # Generate report
        report_text = validator.generate_report(reports)

        # Write report
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report_text, encoding="utf-8")

        # Console output
        total_errors = sum(len(r.errors) for r in reports)
        total_warnings = sum(len(r.warnings) for r in reports)
        total_infos = sum(len(r.infos) for r in reports)

        print(f"Validation Results:")
        print(f"  Layers validated: {len(reports)}")
        print(f"  Passed: {len([r for r in reports if r.passed])}")
        print(f"  Failed: {len([r for r in reports if not r.passed])}")
        print()
        print(f"Issues Found:")
        print(f"  🔴 Errors: {total_errors}")
        print(f"  ⚠️  Warnings: {total_warnings}")
        print(f"  ℹ️  Info: {total_infos}")
        print()
        print(f"Report saved to: {args.output}")
        print()

        # Exit code
        if total_errors > 0:
            return 1
        if args.strict and total_warnings > 0:
            return 1

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
