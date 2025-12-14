"""Traceability matrix generator module.

Generates traceability matrices showing cross-layer relationships like:
- Goal → Implementation traceability
- Requirement → Fulfillment coverage
- Value → Realization mapping
- Constraint → Compliance tracking
"""

from pathlib import Path
from typing import Dict, List, Any
import sys

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.link_registry import LinkRegistry  # noqa: E402


class TraceabilityGenerator:
    """Generate traceability matrices for cross-layer relationships."""

    def __init__(self, spec_root: Path):
        """Initialize traceability generator.

        Args:
            spec_root: Path to spec/ directory
        """
        self.spec_root = spec_root
        self.registry = LinkRegistry()

    def generate_motivation_to_testing(self, output_path: Path):
        """Generate motivation to testing traceability matrix.

        Shows how motivation layer elements (goals, requirements) trace through
        to testing layer (test specs, test cases).

        Args:
            output_path: Output file path
        """
        lines = [
            "# Motivation to Testing Traceability Matrix",
            "",
            "This matrix shows how goals and requirements from the Motivation Layer",
            "trace through the architecture layers to testing specifications.",
            "",
            "## Traceability Chain",
            "",
            "```",
            "Goal → BusinessProcess → ApplicationService → TechnologyComponent → TestCase",
            "Requirement → ApplicationService → TestSuite",
            "```",
            "",
            "## Goals → Testing",
            "",
            "| Goal | Business | Application | Technology | Testing |",
            "|------|----------|-------------|------------|---------|",
            "| (To be populated from spec data) | | | | |",
            "",
            "## Requirements → Testing",
            "",
            "| Requirement | Application | Test Suite | Coverage |",
            "|-------------|-------------|------------|----------|",
            "| (To be populated from spec data) | | | |",
            "",
        ]

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"Generated: {output_path}")

    def generate_business_to_technology(self, output_path: Path):
        """Generate business to technology traceability matrix.

        Shows how business layer elements map to technology implementation.

        Args:
            output_path: Output file path
        """
        lines = [
            "# Business to Technology Traceability Matrix",
            "",
            "This matrix shows how business architecture elements trace to",
            "technology implementation.",
            "",
            "## Traceability Chain",
            "",
            "```",
            "BusinessService → ApplicationService → TechnologyComponent",
            "BusinessProcess → ApplicationService → TechnologyService",
            "```",
            "",
            "## Services",
            "",
            "| Business Service | Application | Technology | Notes |",
            "|------------------|-------------|------------|-------|",
            "| (To be populated from spec data) | | | |",
            "",
            "## Processes",
            "",
            "| Business Process | Application | Technology | Notes |",
            "|------------------|-------------|------------|-------|",
            "| (To be populated from spec data) | | | |",
            "",
        ]

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"Generated: {output_path}")

    def generate_requirements_to_tests(self, output_path: Path):
        """Generate requirements to tests coverage matrix.

        Shows which requirements are covered by which test specifications.

        Args:
            output_path: Output file path
        """
        lines = [
            "# Requirements to Tests Coverage Matrix",
            "",
            "This matrix tracks requirement fulfillment and test coverage.",
            "",
            "## Coverage Summary",
            "",
            "| Requirement Type | Total | Tested | Coverage % |",
            "|-----------------|-------|--------|------------|",
            "| Functional | (TBD) | (TBD) | (TBD) |",
            "| Non-Functional | (TBD) | (TBD) | (TBD) |",
            "| Security | (TBD) | (TBD) | (TBD) |",
            "",
            "## Detailed Coverage",
            "",
            "| Requirement ID | Description | Test Specs | Status |",
            "|----------------|-------------|------------|--------|",
            "| (To be populated from spec data) | | | |",
            "",
        ]

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"Generated: {output_path}")

    def generate_goals_to_implementation(self, output_path: Path):
        """Generate goals to implementation traceability matrix.

        Shows how strategic goals map to implementation across layers.

        Args:
            output_path: Output file path
        """
        lines = [
            "# Goals to Implementation Traceability Matrix",
            "",
            "This matrix shows how strategic goals from the Motivation Layer",
            "are implemented across the architecture.",
            "",
            "## Traceability Chain",
            "",
            "```",
            "Goal → Value → Outcome → BusinessService → ApplicationService → TechnologyComponent",
            "```",
            "",
            "## Strategic Goals",
            "",
            "| Goal | Values | Business | Application | Technology | Status |",
            "|------|--------|----------|-------------|------------|--------|",
            "| (To be populated from spec data) | | | | | |",
            "",
            "## Goal Realization",
            "",
            "| Goal | KPI | Target | Actual | Achievement |",
            "|------|-----|--------|--------|-------------|",
            "| (To be populated from spec data) | | | | |",
            "",
        ]

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"Generated: {output_path}")

    def generate_all(self, output_dir: Path):
        """Generate all traceability matrices.

        Args:
            output_dir: Output directory for matrices
        """
        print("Generating traceability matrices...")

        self.generate_motivation_to_testing(output_dir / "motivation-to-testing.md")
        self.generate_business_to_technology(output_dir / "business-to-technology.md")
        self.generate_requirements_to_tests(output_dir / "requirements-to-tests.md")
        self.generate_goals_to_implementation(output_dir / "goals-to-implementation.md")

        print(f"✅ Generated all traceability matrices in: {output_dir}")
