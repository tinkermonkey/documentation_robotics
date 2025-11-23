"""
PlantUML diagram exporter.
"""

from pathlib import Path
from typing import Any

from .export_manager import BaseExporter


class PlantUMLExporter(BaseExporter):
    """
    Exports model to PlantUML diagram specifications.

    Creates PlantUML files for component, class, and sequence diagrams.
    """

    def export(self) -> Path:
        """
        Export to PlantUML.

        Returns:
            Path to output directory
        """
        # Ensure output directory exists
        self.options.output_path.mkdir(parents=True, exist_ok=True)

        # Generate different diagram types
        self._export_component_diagram()
        self._export_class_diagram()
        self._export_deployment_diagram()
        self._export_layer_diagrams()

        return self.options.output_path

    def _export_component_diagram(self) -> None:
        """Export component diagram from application layer."""
        app_layer = self.model.get_layer("application")
        if not app_layer:
            return

        output_file = self.options.output_path / "components.puml"

        with open(output_file, "w") as f:
            f.write("@startuml components\n")
            f.write("!theme plain\n")
            f.write("title Application Components\n\n")

            # Add components
            for element in app_layer.elements.values():
                if element.type == "component":
                    f.write(f'component "{element.name}" as {self._sanitize_id(element.id)}\n')

            f.write("\n")

            # Add relationships
            if hasattr(self.model, "reference_registry"):
                for ref in self.model.reference_registry.references:
                    if ref.source_id.startswith("application."):
                        source = self._sanitize_id(ref.source_id)
                        target = self._sanitize_id(ref.target_id)
                        f.write(f"{source} --> {target} : {ref.reference_type}\n")

            f.write("\n@enduml\n")

    def _export_class_diagram(self) -> None:
        """Export class diagram from data model layer."""
        data_layer = self.model.get_layer("data_model")
        if not data_layer:
            return

        output_file = self.options.output_path / "data-model.puml"

        with open(output_file, "w") as f:
            f.write("@startuml data-model\n")
            f.write("!theme plain\n")
            f.write("title Data Model\n\n")

            # Add entities as classes
            for element in data_layer.elements.values():
                if element.type == "entity":
                    f.write(f"class {element.name} {{\n")

                    # Add properties
                    properties = element.get("properties", {})
                    for prop_name, prop_def in properties.items():
                        prop_type = self._get_property_type(prop_def)
                        f.write(f"  {prop_name}: {prop_type}\n")

                    f.write("}\n\n")

            # Add relationships
            for element in data_layer.elements.values():
                if element.type == "relationship":
                    source = element.get("from")
                    target = element.get("to")
                    rel_type = element.get("relationshipType", "association")

                    if source and target:
                        arrow = self._get_relationship_arrow(rel_type)
                        f.write(f"{source} {arrow} {target}\n")

            f.write("\n@enduml\n")

    def _export_deployment_diagram(self) -> None:
        """Export deployment diagram from technology layer."""
        tech_layer = self.model.get_layer("technology")
        if not tech_layer:
            return

        output_file = self.options.output_path / "deployment.puml"

        with open(output_file, "w") as f:
            f.write("@startuml deployment\n")
            f.write("!theme plain\n")
            f.write("title Deployment Architecture\n\n")

            # Add nodes
            for element in tech_layer.elements.values():
                if element.type in ["node", "device"]:
                    f.write(f'node "{element.name}" as {self._sanitize_id(element.id)} {{\n')

                    # Find artifacts deployed to this node
                    for other in tech_layer.elements.values():
                        if other.type == "artifact" and other.get("deployedTo") == element.id:
                            f.write(f'  artifact "{other.name}"\n')

                    f.write("}\n\n")

            f.write("\n@enduml\n")

    def _export_layer_diagrams(self) -> None:
        """Export diagram for each layer."""
        layers_to_export = ["business", "application"]

        for layer_name in layers_to_export:
            layer = self.model.get_layer(layer_name)
            if not layer:
                continue

            output_file = self.options.output_path / f"{layer_name}-layer.puml"

            with open(output_file, "w") as f:
                f.write(f"@startuml {layer_name}-layer\n")
                f.write("!theme plain\n")
                f.write(f"title {layer_name.title()} Layer\n\n")

                # Add all elements as packages/components
                for element in layer.elements.values():
                    element_type = self._get_plantuml_type(element.type)
                    f.write(f'{element_type} "{element.name}" as {self._sanitize_id(element.id)}\n')

                f.write("\n")

                # Add relationships within layer
                if hasattr(self.model, "reference_registry"):
                    for ref in self.model.reference_registry.references:
                        if ref.source_id.startswith(f"{layer_name}."):
                            source = self._sanitize_id(ref.source_id)
                            target = self._sanitize_id(ref.target_id)
                            f.write(f"{source} --> {target}\n")

                f.write("\n@enduml\n")

    def _sanitize_id(self, element_id: str) -> str:
        """Sanitize element ID for PlantUML."""
        return element_id.replace(".", "_").replace("-", "_")

    def _get_property_type(self, prop_def: Any) -> str:
        """Get property type for PlantUML."""
        if isinstance(prop_def, str):
            return prop_def
        if isinstance(prop_def, dict):
            return prop_def.get("type", "string")
        return "string"

    def _get_relationship_arrow(self, rel_type: str) -> str:
        """Get PlantUML arrow for relationship type."""
        arrows = {
            "composition": "*--",
            "aggregation": "o--",
            "inheritance": "--|>",
            "implementation": "..|>",
            "dependency": "..>",
            "association": "--",
        }
        return arrows.get(rel_type, "--")

    def _get_plantuml_type(self, element_type: str) -> str:
        """Get PlantUML element type."""
        type_map = {
            "service": "component",
            "component": "component",
            "process": "activity",
            "function": "usecase",
            "interface": "interface",
            "object": "object",
            "actor": "actor",
        }
        return type_map.get(element_type, "component")

    def validate_output(self, output_path: Path) -> bool:
        """Validate exported PlantUML files."""
        # Check that directory exists and has .puml files
        if not output_path.exists() or not output_path.is_dir():
            return False

        puml_files = list(output_path.glob("*.puml"))
        if not puml_files:
            return False

        # Basic validation of each file
        for puml_file in puml_files:
            try:
                content = puml_file.read_text()
                # Check for basic PlantUML syntax
                if "@startuml" not in content or "@enduml" not in content:
                    return False
            except Exception:
                return False

        return True
