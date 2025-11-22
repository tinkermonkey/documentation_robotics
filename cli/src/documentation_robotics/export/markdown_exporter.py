"""
Markdown documentation exporter.
"""
from pathlib import Path
from typing import List
from .export_manager import BaseExporter
from ..core.element import Element


class MarkdownExporter(BaseExporter):
    """
    Exports model to Markdown documentation.

    Creates comprehensive documentation with cross-references.
    """

    def export(self) -> Path:
        """
        Export to Markdown.

        Returns:
            Path to output directory
        """
        # Ensure output directory exists
        self.options.output_path.mkdir(parents=True, exist_ok=True)

        # Generate documentation files
        self._export_index()
        self._export_layer_docs()
        self._export_traceability_matrix()
        self._export_glossary()

        return self.options.output_path

    def _export_index(self) -> None:
        """Export index/README."""
        output_file = self.options.output_path / "README.md"

        with open(output_file, "w") as f:
            f.write(
                f"# {self.model.manifest.project.get('name', 'Architecture Model')}\n\n"
            )

            # Description
            if "description" in self.model.manifest.project:
                f.write(f"{self.model.manifest.project['description']}\n\n")

            # Statistics
            f.write("## Model Statistics\n\n")
            f.write(
                f"- **Total Elements**: {self.model.manifest.statistics.get('total_elements', 0)}\n"
            )
            f.write(
                f"- **Total Relationships**: {self.model.manifest.statistics.get('total_relationships', 0)}\n"
            )
            f.write(
                f"- **Completeness**: {self.model.manifest.statistics.get('completeness', 0) * 100:.1f}%\n\n"
            )

            # Layer overview
            f.write("## Layers\n\n")
            for layer_name, layer_config in self.model.manifest.layers.items():
                element_count = sum(layer_config.get("elements", {}).values())
                f.write(
                    f"- [{layer_config['name']}]({layer_name}.md) ({element_count} elements)\n"
                )

            f.write("\n")

            # Additional documentation
            f.write("## Documentation\n\n")
            f.write("- [Traceability Matrix](traceability-matrix.md)\n")
            f.write("- [Glossary](glossary.md)\n")

    def _export_layer_docs(self) -> None:
        """Export documentation for each layer."""
        for layer in self.model.layers.values():
            output_file = self.options.output_path / f"{layer.name}.md"

            with open(output_file, "w") as f:
                f.write(f"# {layer.config.get('name', layer.name.title())} Layer\n\n")

                # Layer description
                f.write(f"**Order**: {layer.config.get('order', 0)}\n\n")

                # Elements by type
                elements_by_type = {}
                for element in layer.elements.values():
                    if element.type not in elements_by_type:
                        elements_by_type[element.type] = []
                    elements_by_type[element.type].append(element)

                for element_type, elements in sorted(elements_by_type.items()):
                    f.write(f"## {element_type.title()}s\n\n")

                    for element in sorted(elements, key=lambda e: e.name):
                        self._write_element_doc(f, element)

    def _write_element_doc(self, f, element: Element) -> None:
        """Write documentation for a single element."""
        f.write(f"### {element.name}\n\n")
        f.write(f"**ID**: `{element.id}`\n\n")

        if element.description:
            f.write(f"{element.description}\n\n")

        # Properties table
        exclude_keys = {"id", "name", "description", "type"}
        props = {k: v for k, v in element.data.items() if k not in exclude_keys}

        if props:
            f.write("**Properties**:\n\n")
            f.write("| Property | Value |\n")
            f.write("|----------|-------|\n")

            for key, value in props.items():
                # Format value
                if isinstance(value, (dict, list)):
                    import json

                    value_str = f"`{json.dumps(value)}`"
                else:
                    value_str = str(value)

                f.write(f"| {key} | {value_str} |\n")

            f.write("\n")

        # Relationships
        if hasattr(self.model, "reference_registry"):
            refs_from = self.model.reference_registry.get_references_from(element.id)
            refs_to = self.model.reference_registry.get_references_to(element.id)

            if refs_from:
                f.write("**References**:\n\n")
                for ref in refs_from:
                    target = self.model.get_element(ref.target_id)
                    target_name = target.name if target else ref.target_id
                    f.write(
                        f"- {ref.reference_type}: [{target_name}](#{self._anchor(ref.target_id)})\n"
                    )
                f.write("\n")

            if refs_to:
                f.write("**Referenced by**:\n\n")
                for ref in refs_to:
                    source = self.model.get_element(ref.source_id)
                    source_name = source.name if source else ref.source_id
                    f.write(
                        f"- {ref.reference_type}: [{source_name}](#{self._anchor(ref.source_id)})\n"
                    )
                f.write("\n")

        f.write("---\n\n")

    def _export_traceability_matrix(self) -> None:
        """Export traceability matrix."""
        output_file = self.options.output_path / "traceability-matrix.md"

        with open(output_file, "w") as f:
            f.write("# Traceability Matrix\n\n")
            f.write("Shows relationships between layers.\n\n")

            # Business -> Application -> API
            f.write("## Business to Application to API\n\n")
            f.write("| Business Service | Application Service | API Operations |\n")
            f.write("|------------------|---------------------|----------------|\n")

            business_layer = self.model.get_layer("business")
            if business_layer:
                for element in business_layer.elements.values():
                    if element.type == "service":
                        app_services = self._find_realizing_services(element.id)
                        api_ops = self._find_api_operations(app_services)

                        f.write(
                            f"| {element.name} | {', '.join(app_services)} | {', '.join(api_ops)} |\n"
                        )

    def _find_realizing_services(self, business_service_id: str) -> List[str]:
        """Find application services that realize a business service."""
        services = []

        if not hasattr(self.model, "reference_registry"):
            return services

        refs = self.model.reference_registry.get_references_to(business_service_id)

        for ref in refs:
            if ref.reference_type == "realization":
                element = self.model.get_element(ref.source_id)
                if element:
                    services.append(element.name)

        return services

    def _find_api_operations(self, app_services: List[str]) -> List[str]:
        """Find API operations for application services."""
        operations = []

        api_layer = self.model.get_layer("api")
        if not api_layer:
            return operations

        for element in api_layer.elements.values():
            if element.type == "operation":
                app_service_ref = element.get("applicationServiceRef")
                if app_service_ref:
                    app_service = self.model.get_element(app_service_ref)
                    if app_service and app_service.name in app_services:
                        operations.append(element.name)

        return operations

    def _export_glossary(self) -> None:
        """Export glossary of all elements."""
        output_file = self.options.output_path / "glossary.md"

        with open(output_file, "w") as f:
            f.write("# Glossary\n\n")
            f.write("Alphabetical list of all elements in the model.\n\n")

            # Collect all elements
            all_elements = []
            for layer in self.model.layers.values():
                all_elements.extend(layer.elements.values())

            # Sort by name
            all_elements.sort(key=lambda e: e.name.lower())

            # Group by first letter
            current_letter = None

            for element in all_elements:
                first_letter = element.name[0].upper()

                if first_letter != current_letter:
                    current_letter = first_letter
                    f.write(f"\n## {current_letter}\n\n")

                f.write(f"**{element.name}** ({element.layer}/{element.type})\n")
                if element.description:
                    f.write(f": {element.description}\n")
                f.write("\n")

    def _anchor(self, element_id: str) -> str:
        """Create anchor for element ID."""
        return element_id.lower().replace(".", "-")

    def validate_output(self, output_path: Path) -> bool:
        """Validate exported Markdown documentation."""
        # Check that directory exists and has .md files
        if not output_path.exists() or not output_path.is_dir():
            return False

        # Check for expected files
        expected_files = ["README.md", "glossary.md", "traceability-matrix.md"]
        for file in expected_files:
            if not (output_path / file).exists():
                return False

        return True
