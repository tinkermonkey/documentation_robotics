"""Layer Documentation Generator - Generate relationship sections for layer files.

This tool analyzes the link registry and generates the Intra-Layer and Cross-Layer
relationship sections for layer markdown files following the standard template.
"""

import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


class LayerDocGenerator:
    """Generates relationship documentation sections for layers."""

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize the generator.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.registry = LinkRegistry()

        # Map layer IDs to names
        self.layer_names = self._extract_layer_names()

    def _find_spec_root(self) -> Path:
        """Auto-detect spec root directory."""
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

        if not spec_root.exists():
            raise FileNotFoundError(f"Could not find spec directory at {spec_root}")

        return spec_root

    def _extract_layer_names(self) -> Dict[str, str]:
        """Extract layer names from markdown files.

        Returns:
            Dictionary mapping layer ID to layer name
        """
        layer_names = {}

        for layer_file in sorted(self.layers_path.glob("*.md")):
            # Extract layer ID from filename (e.g., "02-business-layer.md" -> "02-business")
            match = re.match(r"(\d{2}-[\w-]+)-layer\.md", layer_file.name)
            if not match:
                continue

            layer_id = match.group(1)

            # Read first line to get layer name
            content = layer_file.read_text(encoding="utf-8")
            first_line = content.split("\n")[0]
            name_match = re.match(r"#\s+Layer \d+:\s+(.+)", first_line)

            if name_match:
                layer_names[layer_id] = name_match.group(1)
            else:
                # Fallback to layer ID
                layer_names[layer_id] = layer_id

        return layer_names

    def generate_outgoing_relationships_section(self, layer_id: str) -> str:
        """Generate outgoing relationships section for a layer.

        Args:
            layer_id: Layer identifier (e.g., "02-business")

        Returns:
            Markdown formatted section
        """
        lines = [
            "### Outgoing Relationships (This Layer → Other Layers)",
            "",
            "Links from entities in this layer to entities in other layers.",
            "",
        ]

        # Get all outgoing links from this layer
        outgoing_links = self.registry.get_links_by_source_layer(layer_id)

        if not outgoing_links:
            lines.append("_No outgoing cross-layer relationships defined._")
            lines.append("")
            return "\n".join(lines)

        # Group by target layer
        links_by_target = defaultdict(list)
        for link in outgoing_links:
            links_by_target[link.target_layer].append(link)

        # Generate section for each target layer
        for target_layer in sorted(links_by_target.keys()):
            target_name = self.layer_names.get(target_layer, target_layer)
            target_num = target_layer.split("-")[0]

            lines.append(f"#### To {target_name} ({target_num})")
            lines.append("")

            # Description based on target layer
            if target_layer == "01-motivation":
                lines.append("Links to strategic goals, requirements, principles, and constraints.")
            elif target_layer == "02-business":
                lines.append("Links to business services, processes, and actors.")
            elif target_layer == "03-security":
                lines.append("Links to security models, resources, and controls.")
            elif target_layer == "07-data-model":
                lines.append("Links to data schemas, tables, and columns.")
            else:
                lines.append(f"Links to {target_name.lower()} elements.")

            lines.append("")

            # Generate table
            lines.append("| Predicate | Source Element | Target Element | Field Path | Strength | Required | Description |")
            lines.append("|-----------|----------------|----------------|------------|----------|----------|-------------|")

            for link in links_by_target[target_layer]:
                predicate = link.predicate or "TBD"
                source_types = ", ".join(link.source_element_types) if link.source_element_types else "Any"
                target_types = ", ".join(link.target_element_types) if link.target_element_types else "Any"
                field_paths = ", ".join([f"`{fp}`" for fp in link.field_paths])
                strength = link.strength or "Medium"
                required = "Yes" if link.is_required else "No"
                description = link.description[:100] + "..." if len(link.description) > 100 else link.description

                lines.append(f"| `{predicate}` | {source_types} | {target_types} | {field_paths} | {strength} | {required} | {description} |")

            lines.append("")

            # Add example for this target layer
            if links_by_target[target_layer]:
                example_link = links_by_target[target_layer][0]
                lines.append("**Example**:")
                lines.append("```yaml")
                lines.append("properties:")
                lines.append(f"  {example_link.field_paths[0]}:")
                if example_link.cardinality == "array":
                    lines.append("    type: array")
                    lines.append("    items:")
                    lines.append("      type: string")
                    lines.append(f'    description: {example_link.description}')
                    lines.append('    example: ["target-id-1", "target-id-2"]')
                else:
                    lines.append("    type: string")
                    lines.append(f'    description: {example_link.description}')
                    lines.append('    example: "target-id-1"')
                lines.append("```")
                lines.append("")

        return "\n".join(lines)

    def generate_incoming_relationships_section(self, layer_id: str) -> str:
        """Generate incoming relationships section for a layer.

        Args:
            layer_id: Layer identifier (e.g., "02-business")

        Returns:
            Markdown formatted section
        """
        lines = [
            "### Incoming Relationships (Other Layers → This Layer)",
            "",
            "Links from entities in other layers to entities in this layer.",
            "",
        ]

        # Get all incoming links to this layer
        incoming_links = self.registry.get_links_by_target_layer(layer_id)

        if not incoming_links:
            lines.append("_No incoming cross-layer relationships defined._")
            lines.append("")
            return "\n".join(lines)

        # Group by source layer
        links_by_source = defaultdict(list)
        for link in incoming_links:
            for source_layer in link.source_layers:
                links_by_source[source_layer].append(link)

        # Generate section for each source layer
        for source_layer in sorted(links_by_source.keys()):
            source_name = self.layer_names.get(source_layer, source_layer)
            source_num = source_layer.split("-")[0]

            lines.append(f"#### From {source_name} ({source_num})")
            lines.append("")

            # Generate table
            lines.append("| Predicate | Source Element | Target Element | Field Path | Description |")
            lines.append("|-----------|----------------|----------------|------------|-------------|")

            for link in links_by_source[source_layer]:
                predicate = link.predicate or "TBD"
                source_types = ", ".join(link.source_element_types) if link.source_element_types else "Any"
                target_types = ", ".join(link.target_element_types) if link.target_element_types else "Any"
                field_paths = ", ".join([f"`{fp}`" for fp in link.field_paths])
                description = link.description[:100] + "..." if len(link.description) > 100 else link.description

                lines.append(f"| `{predicate}` | {source_types} | {target_types} | {field_paths} | {description} |")

            lines.append("")

        return "\n".join(lines)

    def generate_cross_layer_diagram(self, layer_id: str) -> str:
        """Generate Mermaid diagram for cross-layer relationships.

        Args:
            layer_id: Layer identifier

        Returns:
            Mermaid diagram markdown
        """
        lines = [
            "### Cross-Layer Relationship Diagram",
            "",
            "```mermaid",
            "graph TB",
        ]

        # Get this layer's name
        layer_name = self.layer_names.get(layer_id, layer_id)
        layer_num = layer_id.split("-")[0]

        # Central node
        lines.append(f'  ThisLayer["{layer_num}: {layer_name}"]')
        lines.append("")

        # Outgoing relationships
        outgoing = self.registry.get_links_by_source_layer(layer_id)
        target_layers = sorted(set(link.target_layer for link in outgoing))

        for target_layer in target_layers:
            target_name = self.layer_names.get(target_layer, target_layer)
            target_num = target_layer.split("-")[0]
            var_name = f"Target{target_num}"
            lines.append(f'  {var_name}["{target_num}: {target_name}"]')

        lines.append("")

        # Incoming relationships
        incoming = self.registry.get_links_by_target_layer(layer_id)
        source_layers = sorted(set(
            source_layer
            for link in incoming
            for source_layer in link.source_layers
        ))

        for source_layer in source_layers:
            if source_layer == layer_id:  # Skip self-references
                continue
            source_name = self.layer_names.get(source_layer, source_layer)
            source_num = source_layer.split("-")[0]
            var_name = f"Source{source_num}"
            lines.append(f'  {var_name}["{source_num}: {source_name}"]')

        lines.append("")

        # Add edges
        for target_layer in target_layers:
            target_num = target_layer.split("-")[0]
            var_name = f"Target{target_num}"

            # Get predicates for this connection
            predicates = set(
                link.predicate for link in outgoing
                if link.target_layer == target_layer and link.predicate
            )

            if predicates:
                predicate_label = ", ".join(sorted(predicates)[:2])  # Show up to 2
                if len(predicates) > 2:
                    predicate_label += ", ..."
                lines.append(f'  ThisLayer -->|{predicate_label}| {var_name}')
            else:
                lines.append(f'  ThisLayer --> {var_name}')

        for source_layer in source_layers:
            if source_layer == layer_id:
                continue
            source_num = source_layer.split("-")[0]
            var_name = f"Source{source_num}"

            # Get predicates for this connection
            predicates = set(
                link.predicate
                for link in incoming
                if source_layer in link.source_layers and link.predicate
            )

            if predicates:
                predicate_label = ", ".join(sorted(predicates)[:2])
                if len(predicates) > 2:
                    predicate_label += ", ..."
                lines.append(f'  {var_name} -->|{predicate_label}| ThisLayer')
            else:
                lines.append(f'  {var_name} --> ThisLayer')

        lines.append("")

        # Styling
        lines.append("  style ThisLayer fill:#4ECDC4,stroke:#333,stroke-width:3px")

        # Color target layers
        for i, target_layer in enumerate(target_layers):
            target_num = target_layer.split("-")[0]
            var_name = f"Target{target_num}"
            colors = ["#FFD700", "#FF6B6B", "#95E1D3", "#45B7D1", "#F8B500"]
            lines.append(f"  style {var_name} fill:{colors[i % len(colors)]}")

        # Color source layers
        for i, source_layer in enumerate(source_layers):
            if source_layer == layer_id:
                continue
            source_num = source_layer.split("-")[0]
            var_name = f"Source{source_num}"
            colors = ["#E17055", "#6C5CE7", "#FDCB6E", "#00B894", "#D63031"]
            lines.append(f"  style {var_name} fill:{colors[i % len(colors)]}")

        lines.append("```")
        lines.append("")

        return "\n".join(lines)

    def generate_complete_cross_layer_section(self, layer_id: str) -> str:
        """Generate complete cross-layer relationships section.

        Args:
            layer_id: Layer identifier

        Returns:
            Complete markdown section
        """
        lines = [
            "## Cross-Layer Relationships",
            "",
            "**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.",
            "",
        ]

        # Outgoing relationships
        lines.append(self.generate_outgoing_relationships_section(layer_id))

        # Incoming relationships
        lines.append(self.generate_incoming_relationships_section(layer_id))

        # Diagram
        lines.append(self.generate_cross_layer_diagram(layer_id))

        return "\n".join(lines)

    def generate_layer_doc(self, layer_id: str, output_path: Optional[Path] = None) -> str:
        """Generate complete relationship documentation for a layer.

        Args:
            layer_id: Layer identifier
            output_path: Optional path to write output. If None, returns string.

        Returns:
            Generated markdown content
        """
        content = self.generate_complete_cross_layer_section(layer_id)

        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(content, encoding="utf-8")

        return content
