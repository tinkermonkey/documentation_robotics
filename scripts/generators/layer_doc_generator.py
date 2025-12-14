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

    # Mapping from relationship-style names to actual entity names
    # TODO: Fix link registry data to use correct entity names directly
    ENTITY_NAME_CORRECTIONS = {
        "ConstrainedBy": "Constraint",
        "DeliversValue": "Value",
        "FulfillsRequirement": "Requirement",
        "GovernedByPrinciple": "Principle",
        "SupportsGoal": "Goal",
    }

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

    def _correct_entity_name(self, entity_name: str) -> str:
        """Correct entity names that are actually relationship names.

        Args:
            entity_name: Potentially incorrect entity name

        Returns:
            Corrected entity name
        """
        return self.ENTITY_NAME_CORRECTIONS.get(entity_name, entity_name)

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
            lines.append("| Predicate | Source Element | Target Element | Field Path | Description | Documented |")
            lines.append("|-----------|----------------|----------------|------------|-------------|------------|")

            for link in links_by_target[target_layer]:
                predicate = link.predicate or "TBD"
                # Show specific source element types for this layer if available
                if link.source_element_types_by_layer and layer_id in link.source_element_types_by_layer:
                    source_types = ", ".join(link.source_element_types_by_layer[layer_id])
                elif link.source_element_types:
                    # Fallback to flat list
                    source_types = ", ".join(link.source_element_types)
                else:
                    # Show which layer(s) the link comes from
                    layer_name = self.layer_names.get(layer_id, layer_id)
                    source_types = f"Any {layer_name} entity"

                # Correct entity names (fix relationship names being used as entity names)
                corrected_types = [self._correct_entity_name(t) for t in link.target_element_types] if link.target_element_types else []
                target_types = ", ".join(corrected_types) if corrected_types else "Any"
                field_paths = ", ".join([f"`{fp}`" for fp in link.field_paths])
                description = link.description[:100] + "..." if len(link.description) > 100 else link.description

                # Check if documented (has description and examples)
                if link.description and link.examples:
                    schema_file = f"../../spec/schemas/link-registry.json"
                    doc_link = f"[✓]({schema_file})"
                else:
                    doc_link = "✗"

                lines.append(f"| `{predicate}` | {source_types} | {target_types} | {field_paths} | {description} | {doc_link} |")

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
            lines.append("| Predicate | Source Element | Target Element | Field Path | Description | Documented |")
            lines.append("|-----------|----------------|----------------|------------|-------------|------------|")

            for link in links_by_source[source_layer]:
                predicate = link.predicate or "TBD"
                # Show specific source element types for this layer if available
                if link.source_element_types_by_layer and source_layer in link.source_element_types_by_layer:
                    source_types = ", ".join(link.source_element_types_by_layer[source_layer])
                elif link.source_element_types:
                    # Fallback to flat list
                    source_types = ", ".join(link.source_element_types)
                else:
                    # Show the source layer name
                    source_layer_name = self.layer_names.get(source_layer, source_layer)
                    source_types = f"Any {source_layer_name} entity"

                # Correct entity names (fix relationship names being used as entity names)
                corrected_types = [self._correct_entity_name(t) for t in link.target_element_types] if link.target_element_types else []
                target_types = ", ".join(corrected_types) if corrected_types else "Any"
                field_paths = ", ".join([f"`{fp}`" for fp in link.field_paths])
                description = link.description[:100] + "..." if len(link.description) > 100 else link.description

                # Check if documented (has description and examples)
                if link.description and link.examples:
                    schema_file = f"../../spec/schemas/link-registry.json"
                    doc_link = f"[✓]({schema_file})"
                else:
                    doc_link = "✗"

                lines.append(f"| `{predicate}` | {source_types} | {target_types} | {field_paths} | {description} | {doc_link} |")

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

        # Get incoming relationships to collect target entity types
        incoming = self.registry.get_links_by_target_layer(layer_id)

        # Collect unique target entity types for this layer
        target_entity_types = set()
        for link in incoming:
            # Correct entity names before adding to set
            corrected_types = [self._correct_entity_name(t) for t in link.target_element_types]
            target_entity_types.update(corrected_types)

        # Central layer as subgraph with individual entity types
        lines.append(f'  subgraph thisLayer["{layer_num}: {layer_name}"]')

        if target_entity_types:
            # Show individual entity types that are targets of cross-layer links
            for entity_type in sorted(target_entity_types):
                safe_id = entity_type.replace(" ", "").replace("-", "")
                lines.append(f'    this{safe_id}["{entity_type}"]')
        else:
            # Fallback if no specific entity types
            lines.append(f'    ThisLayerNode["Entities in {layer_name}"]')

        lines.extend(["  end", ""])

        # Outgoing relationships
        outgoing = self.registry.get_links_by_source_layer(layer_id)
        target_layers = sorted(set(link.target_layer for link in outgoing))

        if target_layers:
            lines.append("  %% Target layers")
            for target_layer in target_layers:
                target_name = self.layer_names.get(target_layer, target_layer)
                target_num = target_layer.split("-")[0]
                var_name = f"target{target_num}"

                # Get entity types for this target layer
                target_entities = set()
                for link in outgoing:
                    if link.target_layer == target_layer:
                        target_entities.update(link.target_element_types)

                lines.append(f'  subgraph {var_name}Layer["{target_num}: {target_name}"]')

                if target_entities:
                    for entity_type in sorted(target_entities):
                        # Correct entity name before creating node
                        corrected_entity = self._correct_entity_name(entity_type)
                        safe_id = corrected_entity.replace(" ", "").replace("-", "")
                        lines.append(f'    {var_name}{safe_id}["{corrected_entity}"]')
                else:
                    lines.append(f'    {var_name}Node["Entities in {target_name}"]')

                lines.append("  end")
            lines.append("")

        # Source layers with incoming relationships
        source_layers = sorted(set(
            source_layer
            for link in incoming
            for source_layer in link.source_layers
            if source_layer != layer_id  # Skip self-references
        ))

        if source_layers:
            lines.append("  %% Source layers")
            for source_layer in source_layers:
                source_name = self.layer_names.get(source_layer, source_layer)
                source_num = source_layer.split("-")[0]
                var_name = f"source{source_num}"

                lines.extend([
                    f'  subgraph {var_name}Layer["{source_num}: {source_name}"]',
                    f'    {var_name}Node["Any {source_name} entity"]',
                    "  end",
                ])
            lines.append("")

        # Add edges - outgoing relationships
        if outgoing:
            lines.append("  %% Outgoing relationships")
            for link in outgoing:
                target_num = link.target_layer.split("-")[0]

                # Find source node
                if target_entity_types:
                    source_nodes = [f'this{et.replace(" ", "").replace("-", "")}' for et in sorted(target_entity_types)]
                    source_node = source_nodes[0] if source_nodes else "ThisLayerNode"
                else:
                    source_node = "ThisLayerNode"

                # Find target nodes
                for target_entity in link.target_element_types:
                    # Correct entity name before creating node ID
                    corrected_entity = self._correct_entity_name(target_entity)
                    safe_id = corrected_entity.replace(" ", "").replace("-", "")
                    target_node = f'target{target_num}{safe_id}'
                    predicate = link.predicate or ""

                    if predicate:
                        lines.append(f'  {source_node} -->|{predicate}| {target_node}')
                    else:
                        lines.append(f'  {source_node} --> {target_node}')
            lines.append("")

        # Add edges - incoming relationships
        if incoming:
            lines.append("  %% Incoming relationships")
            for link in incoming:
                for source_layer in link.source_layers:
                    if source_layer == layer_id:
                        continue

                    source_num = source_layer.split("-")[0]
                    source_node = f'source{source_num}Node'

                    # Connect to specific target entities
                    for target_entity in link.target_element_types:
                        # Correct entity name before creating node ID
                        corrected_entity = self._correct_entity_name(target_entity)
                        safe_id = corrected_entity.replace(" ", "").replace("-", "")
                        target_node = f'this{safe_id}'
                        predicate = link.predicate or ""

                        if predicate:
                            lines.append(f'  {source_node} -->|{predicate}| {target_node}')
                        else:
                            lines.append(f'  {source_node} --> {target_node}')
            lines.append("")

        # Styling
        lines.extend([
            "  %% Styling",
            "  classDef thisLayerStyle fill:#4ECDC4,stroke:#333,stroke-width:3px",
            "  classDef targetLayerStyle fill:#FFD700,stroke:#333,stroke-width:2px",
            "  classDef sourceLayerStyle fill:#E17055,stroke:#333,stroke-width:2px",
            "",
        ])

        # Style this layer's nodes
        if target_entity_types:
            for entity_type in sorted(target_entity_types):
                safe_id = entity_type.replace(" ", "").replace("-", "")
                lines.append(f"  class this{safe_id} thisLayerStyle")
        else:
            lines.append("  class ThisLayerNode thisLayerStyle")

        # Style target nodes
        for target_layer in target_layers:
            target_num = target_layer.split("-")[0]
            target_entities = set()
            for link in outgoing:
                if link.target_layer == target_layer:
                    target_entities.update(link.target_element_types)

            if target_entities:
                for entity_type in sorted(target_entities):
                    safe_id = entity_type.replace(" ", "").replace("-", "")
                    lines.append(f"  class target{target_num}{safe_id} targetLayerStyle")
            else:
                lines.append(f"  class target{target_num}Node targetLayerStyle")

        # Style source nodes
        for source_layer in source_layers:
            source_num = source_layer.split("-")[0]
            lines.append(f"  class source{source_num}Node sourceLayerStyle")

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
        layer_name = self.layer_names.get(layer_id, layer_id)

        lines = [
            f"# {layer_name} - Cross-Layer Relationships",
            "",
            "## Cross-Layer Relationships",
            "",
            "**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.",
            "",
        ]

        # Diagram (moved to top, right after overview)
        lines.append(self.generate_cross_layer_diagram(layer_id))

        # Outgoing relationships
        lines.append(self.generate_outgoing_relationships_section(layer_id))

        # Incoming relationships
        lines.append(self.generate_incoming_relationships_section(layer_id))

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
