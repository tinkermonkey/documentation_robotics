"""Link Documentation Generator - Auto-generates comprehensive link documentation.

This module provides the LinkDocGenerator class which parses schemas,
extracts link definitions, and generates documentation in multiple formats.
"""

from datetime import datetime
from pathlib import Path
from typing import List, Optional

from .link_registry import LinkRegistry, LinkType


class LinkDocGenerator:
    """Generates comprehensive documentation for cross-layer links.

    This class creates human-readable documentation from the link registry,
    including markdown tables, HTML pages, and Mermaid diagrams.
    """

    def __init__(self, link_registry: LinkRegistry):
        """Initialize the documentation generator.

        Args:
            link_registry: LinkRegistry instance with link definitions
        """
        self.registry = link_registry

    def generate_markdown_summary(self) -> str:
        """Generate a markdown summary of all links.

        Returns:
            Markdown formatted string
        """
        lines = [
            "# Cross-Layer Links Summary",
            "",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "## Overview",
            "",
            f"Total link types: {len(self.registry.link_types)}",
            f"Categories: {len(self.registry.categories)}",
            "",
        ]

        # Statistics
        stats = self.registry.get_statistics()
        lines.extend(["## Statistics", "", "### Links by Category", ""])

        for category, count in sorted(stats["category_counts"].items()):
            category_info = self.registry.categories.get(category, {})
            name = category_info.get("name", category)
            lines.append(f"- **{name}**: {count} link types")

        lines.extend(["", "### Links by Format", ""])
        for format_type, count in sorted(stats["format_counts"].items()):
            lines.append(f"- **{format_type}**: {count} link types")

        # All link types by category
        lines.extend(["", "## Link Types by Category", ""])

        for category in sorted(self.registry.categories.keys()):
            category_info = self.registry.categories[category]
            link_types = self.registry.get_link_types_by_category(category)

            if not link_types:
                continue

            lines.extend(
                [
                    f"### {category_info['name']}",
                    "",
                    category_info["description"],
                    "",
                    "| Link Type | Source Layers | Target Layer | Format | Description |",
                    "|-----------|---------------|--------------|--------|-------------|",
                ]
            )

            for lt in sorted(link_types, key=lambda x: x.name):
                sources = ", ".join(lt.source_layers)
                desc = lt.description[:80] + "..." if len(lt.description) > 80 else lt.description
                lines.append(
                    f"| {lt.name} | {sources} | {lt.target_layer} | " f"`{lt.format}` | {desc} |"
                )

            lines.append("")

        return "\n".join(lines)

    def generate_detailed_markdown(self) -> str:
        """Generate detailed markdown documentation with all link information.

        Returns:
            Detailed markdown formatted string
        """
        lines = [
            "# Cross-Layer Links - Detailed Reference",
            "",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
        ]

        # Group by category
        for category in sorted(self.registry.categories.keys()):
            category_info = self.registry.categories[category]
            link_types = self.registry.get_link_types_by_category(category)

            if not link_types:
                continue

            lines.extend([f"## {category_info['name']}", "", category_info["description"], ""])

            for lt in sorted(link_types, key=lambda x: x.name):
                lines.extend(self._generate_link_type_markdown(lt))

        return "\n".join(lines)

    def _generate_link_type_markdown(self, link_type: LinkType) -> List[str]:
        """Generate markdown documentation for a single link type.

        Args:
            link_type: LinkType to document

        Returns:
            List of markdown lines
        """
        lines = [
            f"### {link_type.name}",
            "",
            f"**ID:** `{link_type.id}`",
            "",
            f"**Description:** {link_type.description}",
            "",
            "**Configuration:**",
            "",
            f"- **Source Layers:** {', '.join(link_type.source_layers)}",
            f"- **Target Layer:** {link_type.target_layer}",
            f"- **Target Types:** {', '.join(link_type.target_element_types)}",
            f"- **Cardinality:** {link_type.cardinality}",
            f"- **Format:** `{link_type.format}`",
            "",
            "**Field Paths:**",
            "",
        ]

        for path in link_type.field_paths:
            lines.append(f"- `{path}`")

        if link_type.examples:
            lines.extend(["", "**Examples:**", ""])
            for example in link_type.examples:
                lines.append(f"- `{example}`")

        # Validation rules
        if link_type.validation_rules:
            lines.extend(["", "**Validation:**", ""])
            for rule_key, rule_value in link_type.validation_rules.items():
                lines.append(f"- {rule_key}: `{rule_value}`")

        lines.extend(["", "---", ""])

        return lines

    def generate_html_documentation(
        self, output_path: Path, include_search: bool = True, include_diagrams: bool = True
    ) -> None:
        """Generate interactive HTML documentation.

        Args:
            output_path: Path where HTML file should be written
            include_search: Include search functionality
            include_diagrams: Include Mermaid diagrams
        """
        html = self._build_html_document(include_search, include_diagrams)
        output_path.write_text(html, encoding="utf-8")

    def _build_html_document(self, include_search: bool, include_diagrams: bool) -> str:
        """Build the complete HTML document.

        Args:
            include_search: Include search functionality
            include_diagrams: Include Mermaid diagrams

        Returns:
            Complete HTML document string
        """
        stats = self.registry.get_statistics()

        html_parts = [
            "<!DOCTYPE html>",
            "<html lang='en'>",
            "<head>",
            "    <meta charset='UTF-8'>",
            "    <meta name='viewport' content='width=device-width, initial-scale=1.0'>",
            "    <title>Cross-Layer Links Registry</title>",
            "    <style>",
            self._get_css_styles(),
            "    </style>",
        ]

        if include_diagrams:
            html_parts.extend(
                [
                    "    <script src='https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'></script>",
                    "    <script>mermaid.initialize({ startOnLoad: true, theme: 'default' });</script>",
                ]
            )

        html_parts.extend(
            [
                "</head>",
                "<body>",
                "    <div class='container'>",
                "        <header>",
                "            <h1>Cross-Layer Links Registry</h1>",
                f"            <p class='subtitle'>Documentation Robotics v{stats.get('version', '2.0.0')}</p>",
                "        </header>",
            ]
        )

        # Statistics summary
        html_parts.extend(
            [
                "        <section class='summary'>",
                "            <h2>Overview</h2>",
                "            <div class='stats-grid'>",
                f"                <div class='stat-card'><h3>{stats['total_link_types']}</h3><p>Link Types</p></div>",
                f"                <div class='stat-card'><h3>{stats['total_categories']}</h3><p>Categories</p></div>",
                f"                <div class='stat-card'><h3>{len(stats['source_layers'])}</h3><p>Source Layers</p></div>",
                f"                <div class='stat-card'><h3>{len(stats['target_layers'])}</h3><p>Target Layers</p></div>",
                "            </div>",
                "        </section>",
            ]
        )

        # Search box
        if include_search:
            html_parts.extend(
                [
                    "        <section class='search-section'>",
                    "            <input type='text' id='searchBox' placeholder='Search link types...' onkeyup='filterLinks()'>",
                    "        </section>",
                ]
            )

        # Categories and link types
        html_parts.append("        <section class='links-section'>")

        for category in sorted(self.registry.categories.keys()):
            category_info = self.registry.categories[category]
            link_types = self.registry.get_link_types_by_category(category)

            if not link_types:
                continue

            html_parts.extend(
                [
                    f"            <div class='category' id='category-{category}'>",
                    f"                <h2 style='border-left: 4px solid {category_info.get('color', '#ccc')};'>",
                    f"                    {category_info['name']}",
                    "                </h2>",
                    f"                <p class='category-desc'>{category_info['description']}</p>",
                    "                <div class='link-types'>",
                ]
            )

            for lt in sorted(link_types, key=lambda x: x.name):
                html_parts.extend(
                    self._generate_link_type_html(lt, category_info.get("color", "#ccc"))
                )

            html_parts.extend(
                [
                    "                </div>",
                    "            </div>",
                ]
            )

        html_parts.append("        </section>")

        # JavaScript
        if include_search:
            html_parts.extend(
                [
                    "        <script>",
                    self._get_search_javascript(),
                    "        </script>",
                ]
            )

        html_parts.extend(["    </div>", "</body>", "</html>"])

        return "\n".join(html_parts)

    def _generate_link_type_html(self, link_type: LinkType, color: str) -> List[str]:
        """Generate HTML for a single link type.

        Args:
            link_type: LinkType to render
            color: Category color

        Returns:
            List of HTML lines
        """
        lines = [
            f"                    <div class='link-card' data-search='{link_type.id} {link_type.name} {link_type.description}'>",
            f"                        <h3 style='color: {color};'>{link_type.name}</h3>",
            f"                        <p class='link-id'><code>{link_type.id}</code></p>",
            f"                        <p class='description'>{link_type.description}</p>",
            "                        <div class='details'>",
            f"                            <p><strong>Source Layers:</strong> {', '.join(link_type.source_layers)}</p>",
            f"                            <p><strong>Target Layer:</strong> {link_type.target_layer}</p>",
            f"                            <p><strong>Format:</strong> <code>{link_type.format}</code> ({link_type.cardinality})</p>",
            "                            <p><strong>Field Paths:</strong></p>",
            "                            <ul>",
        ]

        for path in link_type.field_paths:
            lines.append(f"                                <li><code>{path}</code></li>")

        lines.append("                            </ul>")

        if link_type.examples:
            lines.append("                            <p><strong>Examples:</strong></p>")
            lines.append("                            <ul>")
            for example in link_type.examples[:3]:  # Limit to 3 examples
                lines.append(f"                                <li><code>{example}</code></li>")
            lines.append("                            </ul>")

        lines.extend(
            [
                "                        </div>",
                "                    </div>",
            ]
        )

        return lines

    def _get_css_styles(self) -> str:
        """Get CSS styles for HTML documentation.

        Returns:
            CSS string
        """
        return """
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            border-radius: 10px;
            margin-bottom: 30px;
            text-align: center;
        }
        header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .subtitle {
            font-size: 1.1em;
            opacity: 0.9;
        }
        .summary {
            background: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .stat-card h3 {
            font-size: 2.5em;
            margin-bottom: 5px;
        }
        .search-section {
            margin-bottom: 30px;
        }
        #searchBox {
            width: 100%;
            padding: 15px;
            font-size: 1em;
            border: 2px solid #ddd;
            border-radius: 8px;
            background: white;
        }
        #searchBox:focus {
            outline: none;
            border-color: #667eea;
        }
        .category {
            background: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .category h2 {
            padding-left: 15px;
            margin-bottom: 10px;
        }
        .category-desc {
            color: #666;
            margin-bottom: 20px;
            padding-left: 15px;
        }
        .link-types {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        .link-card {
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            background: #fafafa;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .link-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .link-card h3 {
            margin-bottom: 5px;
        }
        .link-id {
            color: #666;
            font-size: 0.9em;
            margin-bottom: 10px;
        }
        .description {
            margin-bottom: 15px;
            color: #555;
        }
        .details {
            font-size: 0.9em;
        }
        .details p {
            margin-bottom: 8px;
        }
        .details ul {
            margin-left: 20px;
            margin-top: 5px;
        }
        code {
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.9em;
        }
        """

    def _get_search_javascript(self) -> str:
        """Get JavaScript for search functionality.

        Returns:
            JavaScript string
        """
        return """
        function filterLinks() {
            const searchText = document.getElementById('searchBox').value.toLowerCase();
            const cards = document.querySelectorAll('.link-card');

            cards.forEach(card => {
                const searchData = card.getAttribute('data-search').toLowerCase();
                if (searchData.includes(searchText)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        }
        """

    def generate_mermaid_diagram(self, category: Optional[str] = None) -> str:
        """Generate a Mermaid diagram showing link relationships.

        Args:
            category: Optional category to filter by

        Returns:
            Mermaid diagram string
        """
        lines = [
            "```mermaid",
            "graph LR",
        ]

        # Get link types
        if category:
            link_types = self.registry.get_link_types_by_category(category)
        else:
            link_types = self.registry.get_all_link_types()

        # Create nodes for layers
        layers = set()
        for lt in link_types:
            layers.update(lt.source_layers)
            layers.add(lt.target_layer)

        # Define layer nodes with styling
        layer_styles = {}
        for i, layer in enumerate(sorted(layers)):
            node_id = layer.replace("-", "_")
            layer_name = layer.split("-")[1] if "-" in layer else layer
            lines.append(f'    {node_id}["{layer_name.title()} Layer"]')
            layer_styles[layer] = node_id

        # Add links
        for lt in link_types:
            target_node = layer_styles[lt.target_layer]
            for source_layer in lt.source_layers:
                source_node = layer_styles[source_layer]
                lines.append(f"    {source_node} -->|{lt.name}| {target_node}")

        lines.append("```")

        return "\n".join(lines)

    def generate_quick_reference(self) -> str:
        """Generate a quick reference guide.

        Returns:
            Markdown formatted quick reference
        """
        lines = ["# Cross-Layer Links - Quick Reference", "", "## Common Link Patterns", ""]

        # Most common patterns
        common_patterns = [
            "motivation-supports-goals",
            "motivation-fulfills-requirements",
            "motivation-governed-by-principles",
            "archimate-ref",
            "business-service-ref",
            "api-operation-id",
        ]

        for pattern_id in common_patterns:
            lt = self.registry.get_link_type(pattern_id)
            if lt:
                lines.extend(
                    [
                        f"### {lt.name}",
                        "",
                        f"**Use:** {lt.description}",
                        "",
                        f"**Field:** `{lt.field_paths[0]}`",
                        "",
                        f"**Type:** {lt.cardinality} {lt.format}",
                        "",
                        f"**Example:** `{lt.examples[0] if lt.examples else 'N/A'}`",
                        "",
                        "---",
                        "",
                    ]
                )

        return "\n".join(lines)
