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
        self._export_security_diagram()
        self._export_cross_layer_diagram()
        self._export_traceability_diagram()

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

    def _export_security_diagram(self) -> None:
        """Export security architecture diagram."""
        security_layer = self.model.get_layer("security")
        if not security_layer:
            return

        output_file = self.options.output_path / "security.puml"

        with open(output_file, "w") as f:
            f.write("@startuml security\n")
            f.write("!theme plain\n")
            f.write("skinparam rectangle {\n")
            f.write("  BackgroundColor<<policy>> LightYellow\n")
            f.write("  BackgroundColor<<role>> LightBlue\n")
            f.write("  BackgroundColor<<permission>> LightGreen\n")
            f.write("  BackgroundColor<<resource>> LightCoral\n")
            f.write("}\n")
            f.write("title Security Architecture\n\n")

            # Group by type
            policies = []
            roles = []
            permissions = []
            resources = []

            for element in security_layer.elements.values():
                if element.type == "policy":
                    policies.append(element)
                elif element.type == "role":
                    roles.append(element)
                elif element.type == "permission":
                    permissions.append(element)
                elif element.type == "resource":
                    resources.append(element)

            # Add policies package
            if policies:
                f.write('package "Security Policies" {\n')
                for policy in policies:
                    f.write(
                        f'  rectangle "{policy.name}" <<policy>> as {self._sanitize_id(policy.id)}\n'
                    )
                f.write("}\n\n")

            # Add roles package
            if roles:
                f.write('package "Roles" {\n')
                for role in roles:
                    f.write(f'  rectangle "{role.name}" <<role>> as {self._sanitize_id(role.id)}\n')
                f.write("}\n\n")

            # Add permissions package
            if permissions:
                f.write('package "Permissions" {\n')
                for perm in permissions:
                    f.write(
                        f'  rectangle "{perm.name}" <<permission>> as {self._sanitize_id(perm.id)}\n'
                    )
                f.write("}\n\n")

            # Add protected resources
            if resources:
                f.write('package "Protected Resources" {\n')
                for resource in resources:
                    f.write(
                        f'  rectangle "{resource.name}" <<resource>> as {self._sanitize_id(resource.id)}\n'
                    )
                f.write("}\n\n")

            # Add relationships
            if hasattr(self.model, "reference_registry"):
                for ref in self.model.reference_registry.references:
                    if ref.source_id.startswith("security."):
                        source = self._sanitize_id(ref.source_id)
                        target = self._sanitize_id(ref.target_id)
                        label = ref.reference_type if ref.reference_type else "applies to"
                        f.write(f"{source} --> {target} : {label}\n")

            # Add cross-layer security relationships
            f.write("\n' Cross-layer security relationships\n")
            for layer in self.model.layers.values():
                if layer.name == "security":
                    continue
                for element in layer.elements.values():
                    # Check if element has security properties
                    secured_by = element.data.get("properties", {}).get("securedBy", [])
                    if isinstance(secured_by, str):
                        secured_by = [secured_by]
                    for security_ref in secured_by:
                        if security_ref.startswith("security."):
                            source = self._sanitize_id(element.id)
                            target = self._sanitize_id(security_ref)
                            f.write(f"{source} ..> {target} : secured by\n")

            f.write("\n@enduml\n")

    def _export_cross_layer_diagram(self) -> None:
        """Export cross-layer relationships diagram."""
        output_file = self.options.output_path / "cross-layer.puml"

        with open(output_file, "w") as f:
            f.write("@startuml cross-layer\n")
            f.write("!theme plain\n")
            f.write("title Cross-Layer Relationships\n\n")

            # Group elements by layer
            layer_groups = {}
            for layer in self.model.layers.values():
                layer_groups[layer.name] = []
                for element in layer.elements.values():
                    layer_groups[layer.name].append(element)

            # Render each layer as a package
            for layer_name, elements in layer_groups.items():
                if not elements:
                    continue

                f.write(f"package \"{layer_name.replace('_', ' ').title()} Layer\" {{\n")

                # Limit to key elements for readability
                for element in elements[:10]:  # Show max 10 elements per layer
                    element_type = self._get_plantuml_type(element.type)
                    f.write(
                        f'  {element_type} "{element.name}" as {self._sanitize_id(element.id)}\n'
                    )

                if len(elements) > 10:
                    f.write(f"  note right: ... and {len(elements) - 10} more elements\n")

                f.write("}\n\n")

            # Add cross-layer relationships
            f.write("' Cross-layer relationships\n")
            if hasattr(self.model, "reference_registry"):
                for ref in self.model.reference_registry.references:
                    # Extract layer from element IDs
                    source_layer = ref.source_id.split(".")[0] if "." in ref.source_id else None
                    target_layer = ref.target_id.split(".")[0] if "." in ref.target_id else None

                    # Only show cross-layer relationships
                    if source_layer and target_layer and source_layer != target_layer:
                        source = self._sanitize_id(ref.source_id)
                        target = self._sanitize_id(ref.target_id)
                        label = ref.reference_type if ref.reference_type else "depends on"
                        f.write(f"{source} --> {target} : {label}\n")

            f.write("\n@enduml\n")

    def _export_traceability_diagram(self) -> None:
        """Export traceability diagram from goals to implementation."""
        output_file = self.options.output_path / "traceability.puml"

        # Get key elements
        motivation_layer = self.model.get_layer("motivation")
        business_layer = self.model.get_layer("business")
        application_layer = self.model.get_layer("application")
        apm_layer = self.model.get_layer("apm")

        if not motivation_layer:
            return

        with open(output_file, "w") as f:
            f.write("@startuml traceability\n")
            f.write("!theme plain\n")
            f.write("left to right direction\n")
            f.write("title Goal-to-Implementation Traceability\n\n")

            # Add goals
            goals = [e for e in motivation_layer.elements.values() if e.type == "goal"]
            if goals:
                f.write('package "Strategic Goals" {\n')
                for goal in goals:
                    f.write(f'  rectangle "{goal.name}" as {self._sanitize_id(goal.id)}\n')
                f.write("}\n\n")

            # Add business services
            if business_layer:
                services = [e for e in business_layer.elements.values() if e.type == "service"]
                if services:
                    f.write('package "Business Services" {\n')
                    for service in services[:5]:  # Limit for readability
                        f.write(
                            f'  component "{service.name}" as {self._sanitize_id(service.id)}\n'
                        )
                    f.write("}\n\n")

            # Add application services
            if application_layer:
                app_services = [
                    e for e in application_layer.elements.values() if e.type == "service"
                ]
                if app_services:
                    f.write('package "Application Services" {\n')
                    for service in app_services[:5]:  # Limit for readability
                        f.write(
                            f'  component "{service.name}" as {self._sanitize_id(service.id)}\n'
                        )
                    f.write("}\n\n")

            # Add metrics
            if apm_layer:
                metrics = [e for e in apm_layer.elements.values() if e.type in ["metric", "sli"]]
                if metrics:
                    f.write('package "Metrics & Monitoring" {\n')
                    for metric in metrics[:5]:  # Limit for readability
                        f.write(f'  database "{metric.name}" as {self._sanitize_id(metric.id)}\n')
                    f.write("}\n\n")

            # Add traceability relationships
            f.write("' Traceability relationships\n")

            # Goals to business services
            if business_layer:
                for service in business_layer.elements.values():
                    supported_goals = service.data.get("properties", {}).get("supports_goals", [])
                    if isinstance(supported_goals, str):
                        supported_goals = [supported_goals]
                    for goal_id in supported_goals:
                        if goal_id.startswith("motivation.goal."):
                            source = self._sanitize_id(goal_id)
                            target = self._sanitize_id(service.id)
                            f.write(f"{source} --> {target} : supports\n")

            # Business services to application services
            if application_layer:
                for app_service in application_layer.elements.values():
                    realizes = app_service.data.get("properties", {}).get("realizes")
                    if realizes and realizes.startswith("business."):
                        source = self._sanitize_id(realizes)
                        target = self._sanitize_id(app_service.id)
                        f.write(f"{source} --> {target} : realized by\n")

            # Application services to metrics
            if apm_layer:
                for metric in apm_layer.elements.values():
                    monitors = metric.data.get("properties", {}).get("monitors")
                    if monitors:
                        if isinstance(monitors, str):
                            monitors = [monitors]
                        for service_id in monitors:
                            if service_id.startswith("application."):
                                source = self._sanitize_id(service_id)
                                target = self._sanitize_id(metric.id)
                                f.write(f"{source} --> {target} : monitored by\n")

                    # Metrics to goals
                    measures_goal = metric.data.get("properties", {}).get("measures_goal")
                    if measures_goal and measures_goal.startswith("motivation.goal."):
                        source = self._sanitize_id(metric.id)
                        target = self._sanitize_id(measures_goal)
                        f.write(f"{source} ..> {target} : measures\n")

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
