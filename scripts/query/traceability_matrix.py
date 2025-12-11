"""Traceability Matrix Generator - Generate requirement traceability matrices.

This module creates traceability matrices showing relationships between:
- Goals → Requirements → Design → Implementation → Tests
- Requirements → Fulfilled By (per layer)
- Values → Delivered By (per layer)
- Constraints → Constrained Elements
"""

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


@dataclass
class TraceabilityEntry:
    """Single entry in a traceability matrix."""

    source_id: str
    source_type: str
    source_layer: str
    target_id: str
    target_type: str
    target_layer: str
    link_type: str
    predicate: str


class TraceabilityMatrixGenerator:
    """Generates traceability matrices for requirements and goals."""

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize the generator.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.registry = LinkRegistry()

    def _find_spec_root(self) -> Path:
        """Auto-detect spec root directory."""
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

        if not spec_root.exists():
            raise FileNotFoundError(f"Could not find spec directory at {spec_root}")

        return spec_root

    def generate_goal_traceability_matrix(self) -> str:
        """Generate Goal Traceability Matrix.

        Shows: Goals → Supported By (Business, Application, API layers)

        Returns:
            Markdown formatted matrix
        """
        lines = [
            "# Goal Traceability Matrix",
            "",
            "Shows which implementation elements support strategic goals.",
            "",
            "## Matrix Structure",
            "",
            "```",
            "Goal → Supported By:",
            "  - Business Services (Layer 02)",
            "  - Application Services (Layer 04)",
            "  - API Operations (Layer 06)",
            "```",
            "",
            "## Link Types Used",
            "",
        ]

        # Find supports-goals link types
        goal_links = self.registry.find_links_by_predicate("supports-goals")

        if goal_links:
            lines.append("| Layer | Link Type | Field Path |")
            lines.append("|-------|-----------|------------|")
            for lt in goal_links:
                for source_layer in lt.source_layers:
                    lines.append(f"| {source_layer} | {lt.name} | {', '.join(lt.field_paths)} |")
            lines.append("")
        else:
            lines.append("_No goal traceability links found in registry._")
            lines.append("")

        lines.extend([
            "## Traceability Chain",
            "",
            "```mermaid",
            "graph TD",
            "  Goal[\"🎯 Goal\"]",
            "  BizSvc[\"💼 Business Service\"]",
            "  AppSvc[\"⚙️ Application Service\"]",
            "  API[\"🔌 API Operation\"]",
            "",
            "  BizSvc -->|supports| Goal",
            "  AppSvc -->|supports| Goal",
            "  API -->|supports| Goal",
            "",
            "  style Goal fill:#FFD700",
            "  style BizSvc fill:#FF6B6B",
            "  style AppSvc fill:#4ECDC4",
            "  style API fill:#45B7D1",
            "```",
            "",
            "## Usage",
            "",
            "In layer markdown files, link to goals using:",
            "",
            "```yaml",
            "properties:",
            "  motivation.supports-goals:",
            "    type: array",
            "    items:",
            "      type: string",
            "    description: Goal IDs this element supports",
            "    example: [\"goal-1\", \"goal-2\"]",
            "```",
            "",
            "Or in OpenAPI:",
            "",
            "```yaml",
            "paths:",
            "  /api/resource:",
            "    post:",
            "      x-supports-goals: [\"goal-1\", \"goal-2\"]",
            "```",
        ])

        return "\n".join(lines)

    def generate_requirement_coverage_matrix(self) -> str:
        """Generate Requirement Coverage Matrix.

        Shows: Requirements → Fulfilled By (per layer)

        Returns:
            Markdown formatted matrix
        """
        lines = [
            "# Requirement Coverage Matrix",
            "",
            "Shows which implementation elements fulfill requirements.",
            "",
            "## Matrix Structure",
            "",
            "```",
            "Requirement → Fulfilled By:",
            "  - Business Services (Layer 02)",
            "  - Application Services (Layer 04)",
            "  - API Operations (Layer 06)",
            "  - Security Controls (Layer 03)",
            "  - APM Metrics (Layer 11)",
            "```",
            "",
            "## Link Types Used",
            "",
        ]

        # Find fulfills-requirements link types
        req_links = self.registry.find_links_by_predicate("fulfills-requirements")

        if req_links:
            lines.append("| Layer | Link Type | Field Path |")
            lines.append("|-------|-----------|------------|")
            for lt in req_links:
                for source_layer in lt.source_layers:
                    lines.append(f"| {source_layer} | {lt.name} | {', '.join(lt.field_paths)} |")
            lines.append("")
        else:
            lines.append("_No requirement fulfillment links found in registry._")
            lines.append("")

        lines.extend([
            "## Traceability Chain",
            "",
            "```mermaid",
            "graph TD",
            "  Req[\"📋 Requirement\"]",
            "  BizSvc[\"💼 Business Service\"]",
            "  AppSvc[\"⚙️ Application Service\"]",
            "  API[\"🔌 API Operation\"]",
            "  SecCtrl[\"🔒 Security Control\"]",
            "",
            "  BizSvc -->|fulfills| Req",
            "  AppSvc -->|fulfills| Req",
            "  API -->|fulfills| Req",
            "  SecCtrl -->|fulfills| Req",
            "",
            "  style Req fill:#FFE5B4",
            "  style BizSvc fill:#FF6B6B",
            "  style AppSvc fill:#4ECDC4",
            "  style API fill:#45B7D1",
            "  style SecCtrl fill:#FF4757",
            "```",
        ])

        return "\n".join(lines)

    def generate_value_realization_matrix(self) -> str:
        """Generate Value Realization Matrix.

        Shows: Values → Delivered By (per layer)

        Returns:
            Markdown formatted matrix
        """
        lines = [
            "# Value Realization Matrix",
            "",
            "Shows which business elements deliver strategic values.",
            "",
            "## Link Types Used",
            "",
        ]

        # Find delivers-value link types
        value_links = self.registry.find_links_by_predicate("delivers-value")

        if value_links:
            lines.append("| Layer | Link Type | Field Path |")
            lines.append("|-------|-----------|------------|")
            for lt in value_links:
                for source_layer in lt.source_layers:
                    lines.append(f"| {source_layer} | {lt.name} | {', '.join(lt.field_paths)} |")
            lines.append("")
        else:
            lines.append("_No value delivery links found in registry._")
            lines.append("")

        return "\n".join(lines)

    def generate_constraint_compliance_matrix(self) -> str:
        """Generate Constraint Compliance Matrix.

        Shows: Constraints → Constrained Elements

        Returns:
            Markdown formatted matrix
        """
        lines = [
            "# Constraint Compliance Matrix",
            "",
            "Shows which elements are constrained by regulatory/compliance constraints.",
            "",
            "## Link Types Used",
            "",
        ]

        # Find constrained-by link types
        constraint_links = self.registry.find_links_by_predicate("constrained-by")

        if constraint_links:
            lines.append("| Layer | Link Type | Field Path |")
            lines.append("|-------|-----------|------------|")
            for lt in constraint_links:
                for source_layer in lt.source_layers:
                    lines.append(f"| {source_layer} | {lt.name} | {', '.join(lt.field_paths)} |")
            lines.append("")
        else:
            lines.append("_No constraint links found in registry._")
            lines.append("")

        return "\n".join(lines)

    def generate_all_matrices(self, output_dir: Path) -> Dict[str, Path]:
        """Generate all traceability matrices.

        Args:
            output_dir: Output directory for matrices

        Returns:
            Dictionary mapping matrix names to output paths
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        output_files = {}

        # Goal traceability
        goal_matrix = self.generate_goal_traceability_matrix()
        goal_path = output_dir / "goal-traceability-matrix.md"
        goal_path.write_text(goal_matrix, encoding="utf-8")
        output_files["goal_traceability"] = goal_path

        # Requirement coverage
        req_matrix = self.generate_requirement_coverage_matrix()
        req_path = output_dir / "requirement-coverage-matrix.md"
        req_path.write_text(req_matrix, encoding="utf-8")
        output_files["requirement_coverage"] = req_path

        # Value realization
        value_matrix = self.generate_value_realization_matrix()
        value_path = output_dir / "value-realization-matrix.md"
        value_path.write_text(value_matrix, encoding="utf-8")
        output_files["value_realization"] = value_path

        # Constraint compliance
        constraint_matrix = self.generate_constraint_compliance_matrix()
        constraint_path = output_dir / "constraint-compliance-matrix.md"
        constraint_path.write_text(constraint_matrix, encoding="utf-8")
        output_files["constraint_compliance"] = constraint_path

        # Generate index
        index_lines = [
            "# Traceability Matrices Index",
            "",
            "## Available Matrices",
            "",
            "1. [Goal Traceability Matrix](goal-traceability-matrix.md) - Goals → Supported By",
            "2. [Requirement Coverage Matrix](requirement-coverage-matrix.md) - Requirements → Fulfilled By",
            "3. [Value Realization Matrix](value-realization-matrix.md) - Values → Delivered By",
            "4. [Constraint Compliance Matrix](constraint-compliance-matrix.md) - Constraints → Constrained Elements",
            "",
            "## Purpose",
            "",
            "These matrices provide traceability from strategic elements (goals, requirements, values, constraints)",
            "to implementation elements across all Documentation Robotics layers.",
            "",
            "## Usage",
            "",
            "Use these matrices to:",
            "- Verify complete requirement coverage",
            "- Trace goals to implementing services",
            "- Validate value delivery",
            "- Ensure constraint compliance",
            "- Support audit and compliance activities",
        ]

        index_path = output_dir / "README.md"
        index_path.write_text("\n".join(index_lines), encoding="utf-8")
        output_files["index"] = index_path

        return output_files
