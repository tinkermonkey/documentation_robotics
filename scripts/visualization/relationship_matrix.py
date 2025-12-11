"""Relationship Matrix Generator - Generates matrices showing relationships between layers.

This module creates various matrix views of the ontology including layer-to-layer matrices,
element-to-element matrices, predicate frequency matrices, and coverage heatmaps.
"""

import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


@dataclass
class MatrixData:
    """Matrix data for visualization."""

    rows: List[str]
    columns: List[str]
    cells: Dict[Tuple[str, str], int]
    row_totals: Dict[str, int]
    column_totals: Dict[str, int]
    grand_total: int


class RelationshipMatrixGenerator:
    """Generates relationship matrices for ontology visualization."""

    def __init__(self, spec_root: Optional[Path] = None, registry: Optional[LinkRegistry] = None):
        """Initialize the matrix generator.

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

    def generate_layer_to_layer_matrix(self) -> MatrixData:
        """Generate layer-to-layer relationship matrix.

        Returns:
            MatrixData showing number of link types between each layer pair.
        """
        # Get all unique layers
        all_layers = set()
        for link_type in self.registry.link_types.values():
            all_layers.update(link_type.source_layers)
            all_layers.add(link_type.target_layer)

        layers = sorted(all_layers)

        # Count links between layers
        cells: Dict[Tuple[str, str], int] = {}
        for link_type in self.registry.link_types.values():
            for source in link_type.source_layers:
                target = link_type.target_layer
                key = (source, target)
                cells[key] = cells.get(key, 0) + 1

        # Calculate totals
        row_totals = defaultdict(int)
        column_totals = defaultdict(int)
        grand_total = 0

        for (source, target), count in cells.items():
            row_totals[source] += count
            column_totals[target] += count
            grand_total += count

        return MatrixData(
            rows=layers,
            columns=layers,
            cells=cells,
            row_totals=dict(row_totals),
            column_totals=dict(column_totals),
            grand_total=grand_total,
        )

    def generate_predicate_frequency_matrix(self) -> MatrixData:
        """Generate predicate frequency matrix.

        Returns:
            MatrixData showing which predicates are used in which layers.
        """
        # Extract predicates and layers
        predicates = set()
        layers = set()
        cells: Dict[Tuple[str, str], int] = {}

        for link_type in self.registry.link_types.values():
            # Extract predicate from field paths
            for field_path in link_type.field_paths:
                if field_path.startswith("x-"):
                    predicate = field_path[2:]
                elif "." in field_path:
                    predicate = field_path.split(".", 1)[1]
                else:
                    predicate = field_path

                predicates.add(predicate)

                # Count usage per layer
                for source_layer in link_type.source_layers:
                    layers.add(source_layer)
                    key = (predicate, source_layer)
                    cells[key] = cells.get(key, 0) + 1

        # Calculate totals
        row_totals = defaultdict(int)
        column_totals = defaultdict(int)
        grand_total = 0

        for (predicate, layer), count in cells.items():
            row_totals[predicate] += count
            column_totals[layer] += count
            grand_total += count

        return MatrixData(
            rows=sorted(predicates),
            columns=sorted(layers),
            cells=cells,
            row_totals=dict(row_totals),
            column_totals=dict(column_totals),
            grand_total=grand_total,
        )

    def generate_category_matrix(self) -> MatrixData:
        """Generate category usage matrix.

        Returns:
            MatrixData showing link categories used by each layer.
        """
        categories = set(self.registry.categories.keys())
        layers = set()
        cells: Dict[Tuple[str, str], int] = {}

        for link_type in self.registry.link_types.values():
            category = link_type.category

            for source_layer in link_type.source_layers:
                layers.add(source_layer)
                key = (category, source_layer)
                cells[key] = cells.get(key, 0) + 1

        # Calculate totals
        row_totals = defaultdict(int)
        column_totals = defaultdict(int)
        grand_total = 0

        for (category, layer), count in cells.items():
            row_totals[category] += count
            column_totals[layer] += count
            grand_total += count

        return MatrixData(
            rows=sorted(categories),
            columns=sorted(layers),
            cells=cells,
            row_totals=dict(row_totals),
            column_totals=dict(column_totals),
            grand_total=grand_total,
        )

    def generate_markdown_matrix(self, matrix: MatrixData, title: str, description: str = "") -> str:
        """Generate markdown table from matrix data."""
        lines = [f"### {title}", ""]

        if description:
            lines.extend([description, ""])

        # Header row
        header = ["From \\ To"] + matrix.columns + ["Total"]
        lines.append("| " + " | ".join(header) + " |")
        lines.append("|" + "---|" * len(header))

        # Data rows
        for row in matrix.rows:
            cells = [row]
            for col in matrix.columns:
                count = matrix.cells.get((row, col), 0)
                cells.append(str(count) if count > 0 else "-")
            cells.append(str(matrix.row_totals.get(row, 0)))
            lines.append("| " + " | ".join(cells) + " |")

        # Total row
        total_cells = ["**Total**"]
        for col in matrix.columns:
            total_cells.append(str(matrix.column_totals.get(col, 0)))
        total_cells.append(str(matrix.grand_total))
        lines.append("| " + " | ".join(total_cells) + " |")

        lines.append("")
        return "\n".join(lines)

    def generate_csv_matrix(self, matrix: MatrixData, output_path: Path) -> None:
        """Generate CSV file from matrix data."""
        import csv

        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)

            # Header
            header = ["From/To"] + matrix.columns + ["Total"]
            writer.writerow(header)

            # Data rows
            for row in matrix.rows:
                cells = [row]
                for col in matrix.columns:
                    count = matrix.cells.get((row, col), 0)
                    cells.append(count)
                cells.append(matrix.row_totals.get(row, 0))
                writer.writerow(cells)

            # Total row
            total_cells = ["Total"]
            for col in matrix.columns:
                total_cells.append(matrix.column_totals.get(col, 0))
            total_cells.append(matrix.grand_total)
            writer.writerow(total_cells)

    def generate_html_matrix(self, matrix: MatrixData, title: str) -> str:
        """Generate interactive HTML table from matrix data."""
        html = [
            f"<h3>{title}</h3>",
            '<table class="matrix-table">',
            "  <thead>",
            "    <tr>",
            '      <th class="header-cell">From \\ To</th>',
        ]

        # Header columns
        for col in matrix.columns:
            html.append(f'      <th class="header-cell">{col}</th>')
        html.append('      <th class="total-cell">Total</th>')
        html.append("    </tr>")
        html.append("  </thead>")
        html.append("  <tbody>")

        # Data rows
        for row in matrix.rows:
            html.append("    <tr>")
            html.append(f'      <th class="row-header">{row}</th>')

            for col in matrix.columns:
                count = matrix.cells.get((row, col), 0)
                intensity = min(100, int((count / max(matrix.row_totals.values() or [1])) * 100)) if count > 0 else 0
                cell_class = "empty-cell" if count == 0 else f"data-cell intensity-{intensity // 20}"
                display = str(count) if count > 0 else "-"
                html.append(f'      <td class="{cell_class}" data-value="{count}">{display}</td>')

            total = matrix.row_totals.get(row, 0)
            html.append(f'      <td class="total-cell">{total}</td>')
            html.append("    </tr>")

        # Total row
        html.append('    <tr class="total-row">')
        html.append('      <th class="row-header">Total</th>')
        for col in matrix.columns:
            total = matrix.column_totals.get(col, 0)
            html.append(f'      <td class="total-cell">{total}</td>')
        html.append(f'      <td class="total-cell grand-total">{matrix.grand_total}</td>')
        html.append("    </tr>")

        html.append("  </tbody>")
        html.append("</table>")

        return "\n".join(html)

    def generate_complete_report(self) -> str:
        """Generate complete markdown report with all matrices."""
        lines = ["# Relationship Matrix Report", ""]

        lines.extend([
            "## Overview",
            "",
            "This report provides various matrix views of the Documentation Robotics ontology,",
            "showing relationships between layers, predicate usage, and category distribution.",
            "",
        ])

        # Layer-to-layer matrix
        layer_matrix = self.generate_layer_to_layer_matrix()
        lines.append(self.generate_markdown_matrix(
            layer_matrix,
            "Layer-to-Layer Relationship Matrix",
            f"Shows the number of link types connecting each pair of layers. Total: {layer_matrix.grand_total} link types."
        ))

        # Category matrix
        category_matrix = self.generate_category_matrix()
        lines.append(self.generate_markdown_matrix(
            category_matrix,
            "Category Usage Matrix",
            "Shows which link categories are used by each layer."
        ))

        # Predicate frequency matrix
        predicate_matrix = self.generate_predicate_frequency_matrix()
        lines.append(self.generate_markdown_matrix(
            predicate_matrix,
            "Predicate Frequency Matrix",
            "Shows which predicates are used in which layers. (Top 20 predicates shown)"
        ))

        # Limit predicate matrix to top 20 for readability
        if len(predicate_matrix.rows) > 20:
            top_predicates = sorted(
                predicate_matrix.rows,
                key=lambda p: predicate_matrix.row_totals.get(p, 0),
                reverse=True
            )[:20]
            limited_matrix = MatrixData(
                rows=top_predicates,
                columns=predicate_matrix.columns,
                cells={k: v for k, v in predicate_matrix.cells.items() if k[0] in top_predicates},
                row_totals={k: v for k, v in predicate_matrix.row_totals.items() if k in top_predicates},
                column_totals=predicate_matrix.column_totals,
                grand_total=sum(v for k, v in predicate_matrix.cells.items() if k[0] in top_predicates),
            )
            lines.append(self.generate_markdown_matrix(
                limited_matrix,
                "Top 20 Predicate Frequency Matrix",
                "Shows the most frequently used predicates across layers."
            ))

        return "\n".join(lines)

    def export_all_formats(self, output_dir: Path) -> Dict[str, Path]:
        """Export matrices in all formats.

        Returns:
            Dictionary mapping format names to output file paths.
        """
        output_files = {}

        # Generate matrices
        layer_matrix = self.generate_layer_to_layer_matrix()
        category_matrix = self.generate_category_matrix()
        predicate_matrix = self.generate_predicate_frequency_matrix()

        # Markdown report
        markdown_path = output_dir / "relationship-matrices.md"
        markdown_report = self.generate_complete_report()
        markdown_path.write_text(markdown_report, encoding="utf-8")
        output_files["markdown"] = markdown_path

        # CSV files
        csv_dir = output_dir / "csv"
        csv_dir.mkdir(exist_ok=True)

        layer_csv = csv_dir / "layer-to-layer-matrix.csv"
        self.generate_csv_matrix(layer_matrix, layer_csv)
        output_files["layer_csv"] = layer_csv

        category_csv = csv_dir / "category-matrix.csv"
        self.generate_csv_matrix(category_matrix, category_csv)
        output_files["category_csv"] = category_csv

        predicate_csv = csv_dir / "predicate-matrix.csv"
        self.generate_csv_matrix(predicate_matrix, predicate_csv)
        output_files["predicate_csv"] = predicate_csv

        # HTML (with basic styling)
        html_path = output_dir / "relationship-matrices.html"
        html_content = self._generate_html_page([
            ("Layer-to-Layer Matrix", layer_matrix),
            ("Category Usage Matrix", category_matrix),
        ])
        html_path.write_text(html_content, encoding="utf-8")
        output_files["html"] = html_path

        return output_files

    def _generate_html_page(self, matrices: List[Tuple[str, MatrixData]]) -> str:
        """Generate complete HTML page with all matrices."""
        html = [
            "<!DOCTYPE html>",
            "<html>",
            "<head>",
            "  <meta charset='utf-8'>",
            "  <title>Relationship Matrices - Documentation Robotics</title>",
            "  <style>",
            "    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 20px; }",
            "    h1 { color: #333; }",
            "    h3 { color: #666; margin-top: 30px; }",
            "    .matrix-table { border-collapse: collapse; margin: 20px 0; }",
            "    .matrix-table th, .matrix-table td { border: 1px solid #ddd; padding: 8px; text-align: center; }",
            "    .header-cell { background-color: #f5f5f5; font-weight: bold; }",
            "    .row-header { background-color: #f9f9f9; font-weight: bold; text-align: left; }",
            "    .total-cell { background-color: #e8e8e8; font-weight: bold; }",
            "    .grand-total { background-color: #d8d8d8; }",
            "    .empty-cell { color: #ccc; }",
            "    .data-cell { background-color: #fff; }",
            "    .intensity-0 { background-color: #f0f9ff; }",
            "    .intensity-1 { background-color: #bae6fd; }",
            "    .intensity-2 { background-color: #7dd3fc; }",
            "    .intensity-3 { background-color: #38bdf8; }",
            "    .intensity-4 { background-color: #0ea5e9; }",
            "    .total-row { border-top: 2px solid #999; }",
            "  </style>",
            "</head>",
            "<body>",
            "  <h1>Relationship Matrices - Documentation Robotics Ontology</h1>",
        ]

        for title, matrix in matrices:
            html.append(self.generate_html_matrix(matrix, title))

        html.extend([
            "</body>",
            "</html>",
        ])

        return "\n".join(html)
