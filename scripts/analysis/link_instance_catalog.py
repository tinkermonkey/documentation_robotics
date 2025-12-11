"""Link Instance Catalog - Catalogs all actual link instances in example models.

This module parses example models from layer markdown files and catalogs all link instances,
tracking usage frequency and mapping to link-registry.json definitions.
"""

import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.link_registry import LinkRegistry


@dataclass
class LinkInstance:
    """Represents a single link instance found in documentation."""

    link_type_id: str
    field_path: str
    value: str
    source_layer: str
    source_element: Optional[str] = None
    location: str = ""


@dataclass
class LinkInstanceStats:
    """Statistics for a link type's usage."""

    link_type_id: str
    link_type_name: str
    total_instances: int
    layers_used: Set[str] = field(default_factory=set)
    unique_values: Set[str] = field(default_factory=set)
    instances: List[LinkInstance] = field(default_factory=list)


@dataclass
class InstanceCatalog:
    """Complete catalog of link instances."""

    total_instances: int
    unique_link_types_used: int
    link_stats: Dict[str, LinkInstanceStats]
    xml_relationships: List[Dict[str, str]]
    layers_analyzed: int


class LinkInstanceCatalog:
    """Catalogs all link instances found in example models."""

    def __init__(self, spec_root: Optional[Path] = None, registry: Optional[LinkRegistry] = None):
        """Initialize the link instance cataloger.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
            registry: LinkRegistry instance. If None, creates new instance.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"
        self.registry = registry or LinkRegistry()

        # Patterns for extraction
        self.property_pattern = re.compile(
            r'^\s*-\s+key:\s*"([^"]+)"\s*\n\s*value:\s*"([^"]*)"',
            re.MULTILINE
        )
        self.xml_relationship_pattern = re.compile(
            r'<relationship\s+type="([^"]+)"\s+source="([^"]+)"\s+target="([^"]+)"\s*/>'
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

    def catalog(self) -> InstanceCatalog:
        """Catalog all link instances from layer documentation.

        Returns:
            InstanceCatalog with all link instances and statistics.
        """
        link_stats: Dict[str, LinkInstanceStats] = {}
        xml_relationships = []
        layers_analyzed = 0
        total_instances = 0

        # Process each layer
        for layer_file in sorted(self.layers_path.glob("*.md")):
            layer_id = self._extract_layer_id(layer_file.name)
            if not layer_id:
                continue

            instances, xml_rels = self._catalog_layer(layer_file, layer_id)
            layers_analyzed += 1

            # Add to catalog
            for instance in instances:
                if instance.link_type_id not in link_stats:
                    link_type = self.registry.link_types.get(instance.link_type_id)
                    link_stats[instance.link_type_id] = LinkInstanceStats(
                        link_type_id=instance.link_type_id,
                        link_type_name=link_type.name if link_type else "Unknown",
                        total_instances=0,
                    )

                stats = link_stats[instance.link_type_id]
                stats.total_instances += 1
                stats.layers_used.add(layer_id)
                stats.unique_values.add(instance.value)
                stats.instances.append(instance)
                total_instances += 1

            xml_relationships.extend(xml_rels)

        return InstanceCatalog(
            total_instances=total_instances,
            unique_link_types_used=len(link_stats),
            link_stats=link_stats,
            xml_relationships=xml_relationships,
            layers_analyzed=layers_analyzed,
        )

    def _extract_layer_id(self, filename: str) -> Optional[str]:
        """Extract layer ID from filename."""
        match = re.match(r'^(\d+)-', filename)
        return match.group(1) if match else None

    def _catalog_layer(
        self, layer_file: Path, layer_id: str
    ) -> tuple[List[LinkInstance], List[Dict[str, str]]]:
        """Catalog link instances from a single layer file."""
        instances: List[LinkInstance] = []
        xml_rels = []

        content = layer_file.read_text(encoding="utf-8")

        # Extract property-based links
        property_matches = self.property_pattern.finditer(content)
        for match in property_matches:
            field_path = match.group(1)
            value = match.group(2)

            # Find matching link type
            matching_links = self.registry.find_links_by_field_path(field_path)
            if matching_links:
                link_type = matching_links[0]
                instances.append(LinkInstance(
                    link_type_id=link_type.id,
                    field_path=field_path,
                    value=value,
                    source_layer=layer_id,
                    location=str(layer_file),
                ))

        # Extract XML relationships (structural, intra-layer)
        xml_matches = self.xml_relationship_pattern.finditer(content)
        for match in xml_matches:
            rel_type = match.group(1)
            source = match.group(2)
            target = match.group(3)

            xml_rels.append({
                "type": rel_type,
                "source": source,
                "target": target,
                "layer": layer_id,
                "location": str(layer_file),
            })

        return instances, xml_rels

    def generate_markdown_report(self, catalog: InstanceCatalog) -> str:
        """Generate markdown-formatted instance catalog report."""
        lines = ["# Link Instance Catalog", ""]

        # Summary
        lines.extend([
            "## Executive Summary",
            "",
            f"- **Total Link Instances**: {catalog.total_instances}",
            f"- **Unique Link Types Used**: {catalog.unique_link_types_used}",
            f"- **XML Relationships**: {len(catalog.xml_relationships)}",
            f"- **Layers Analyzed**: {catalog.layers_analyzed}",
            "",
        ])

        # Top link types by usage
        lines.extend([
            "## Top 20 Most Used Link Types",
            "",
            "| Rank | Link Type | Name | Instances | Layers | Unique Values |",
            "|------|-----------|------|-----------|--------|---------------|",
        ])

        top_links = sorted(
            catalog.link_stats.values(),
            key=lambda s: s.total_instances,
            reverse=True
        )[:20]

        for rank, stats in enumerate(top_links, 1):
            layers_str = ", ".join(sorted(stats.layers_used))
            lines.append(
                f"| {rank} | {stats.link_type_id} | {stats.link_type_name} | "
                f"{stats.total_instances} | {layers_str} | {len(stats.unique_values)} |"
            )

        lines.append("")

        # Usage by layer
        layer_usage = defaultdict(int)
        for stats in catalog.link_stats.values():
            for layer in stats.layers_used:
                layer_usage[layer] += stats.total_instances

        lines.extend([
            "## Link Instances by Layer",
            "",
            "| Layer | Total Instances | Unique Link Types |",
            "|-------|-----------------|-------------------|",
        ])

        layer_link_types = defaultdict(set)
        for stats in catalog.link_stats.values():
            for layer in stats.layers_used:
                layer_link_types[layer].add(stats.link_type_id)

        for layer in sorted(layer_usage.keys()):
            count = layer_usage[layer]
            unique_types = len(layer_link_types[layer])
            lines.append(f"| {layer} | {count} | {unique_types} |")

        lines.append("")

        # XML Relationships
        if catalog.xml_relationships:
            lines.extend([
                "## XML Structural Relationships",
                "",
                f"Found {len(catalog.xml_relationships)} XML relationship declarations:",
                "",
                "| Type | Count | Layers |",
                "|------|-------|--------|",
            ])

            xml_by_type = defaultdict(list)
            for rel in catalog.xml_relationships:
                xml_by_type[rel["type"]].append(rel["layer"])

            for rel_type in sorted(xml_by_type.keys()):
                layers = xml_by_type[rel_type]
                unique_layers = sorted(set(layers))
                lines.append(f"| {rel_type} | {len(layers)} | {', '.join(unique_layers)} |")

            lines.append("")

        # Detailed statistics per link type
        lines.extend([
            "## Detailed Link Type Statistics",
            "",
        ])

        for link_id in sorted(catalog.link_stats.keys()):
            stats = catalog.link_stats[link_id]
            lines.extend([
                f"### {stats.link_type_name} (`{link_id}`)",
                "",
                f"- **Total Instances**: {stats.total_instances}",
                f"- **Layers Used**: {', '.join(sorted(stats.layers_used))}",
                f"- **Unique Values**: {len(stats.unique_values)}",
                "",
            ])

            # Show sample values (up to 5)
            if stats.unique_values:
                sample_values = list(sorted(stats.unique_values))[:5]
                lines.append("Sample values:")
                for val in sample_values:
                    val_display = val if val else "(empty)"
                    lines.append(f"- `{val_display}`")
                if len(stats.unique_values) > 5:
                    lines.append(f"- ... and {len(stats.unique_values) - 5} more")
                lines.append("")

        return "\n".join(lines)

    def export_json(self, catalog: InstanceCatalog, output_path: Path) -> None:
        """Export instance catalog to JSON file."""
        data = {
            "summary": {
                "total_instances": catalog.total_instances,
                "unique_link_types_used": catalog.unique_link_types_used,
                "xml_relationships": len(catalog.xml_relationships),
                "layers_analyzed": catalog.layers_analyzed,
            },
            "link_stats": {
                link_id: {
                    "link_type_name": stats.link_type_name,
                    "total_instances": stats.total_instances,
                    "layers_used": sorted(stats.layers_used),
                    "unique_values": sorted(stats.unique_values),
                    "instances": [
                        {
                            "field_path": inst.field_path,
                            "value": inst.value,
                            "source_layer": inst.source_layer,
                            "source_element": inst.source_element,
                        }
                        for inst in stats.instances
                    ],
                }
                for link_id, stats in catalog.link_stats.items()
            },
            "xml_relationships": catalog.xml_relationships,
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
