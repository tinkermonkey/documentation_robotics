"""
Markdown documentation exporter.
"""

from pathlib import Path
from typing import List

from ..core.element import Element
from .export_manager import BaseExporter


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
        self._export_security_doc()
        self._export_traceability_matrix()
        self._export_cross_layer_relationships()
        self._export_glossary()

        return self.options.output_path

    def _export_index(self) -> None:
        """Export index/README."""
        output_file = self.options.output_path / "README.md"

        with open(output_file, "w") as f:
            f.write(f"# {self.model.manifest.project.get('name', 'Architecture Model')}\n\n")

            # Description
            if "description" in self.model.manifest.project:
                f.write(f"{self.model.manifest.project['description']}\n\n")

            # Statistics
            f.write("## Model Statistics\n\n")
            f.write(
                f"- **Total Elements**: {self.model.manifest.statistics.get('total_elements', 0)}\n"
            )
            relationships = self.model.manifest.statistics.get("total_relationships", 0)
            f.write(f"- **Total Relationships**: {relationships}\n")
            completeness = self.model.manifest.statistics.get("completeness", 0) * 100
            f.write(f"- **Completeness**: {completeness:.1f}%\n\n")

            # Layer overview
            f.write("## Layers\n\n")
            for layer_name, layer_config in self.model.manifest.layers.items():
                element_count = sum(layer_config.get("elements", {}).values())
                f.write(f"- [{layer_config['name']}]({layer_name}.md) ({element_count} elements)\n")

            f.write("\n")

            # Additional documentation
            f.write("## Documentation\n\n")
            f.write("- [Security Architecture](security.md)\n")
            f.write("- [Traceability Matrix](traceability-matrix.md)\n")
            f.write("- [Cross-Layer Relationships](cross-layer-relationships.md)\n")
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

                        services_str = ", ".join(app_services)
                        ops_str = ", ".join(api_ops)
                        f.write(f"| {element.name} | {services_str} | {ops_str} |\n")

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

    def _export_security_doc(self) -> None:
        """Export security architecture documentation."""
        security_layer = self.model.get_layer("security")
        if not security_layer:
            return

        output_file = self.options.output_path / "security.md"

        with open(output_file, "w") as f:
            f.write("# Security Architecture\n\n")
            f.write("Security policies, roles, permissions, and protected resources.\n\n")

            # Group by type
            policies = []
            roles = []
            permissions = []
            resources = []
            controls = []

            for element in security_layer.elements.values():
                if element.type == "policy":
                    policies.append(element)
                elif element.type == "role":
                    roles.append(element)
                elif element.type == "permission":
                    permissions.append(element)
                elif element.type == "resource":
                    resources.append(element)
                elif element.type == "control":
                    controls.append(element)

            # Security Policies
            if policies:
                f.write("## Security Policies\n\n")
                for policy in policies:
                    f.write(f"### {policy.name}\n\n")
                    if policy.description:
                        f.write(f"{policy.description}\n\n")

                    # Policy details
                    props = policy.data.get("properties", {})
                    if "policy_type" in props:
                        f.write(f"**Type**: {props['policy_type']}\n\n")
                    if "enforcement" in props:
                        f.write(f"**Enforcement**: {props['enforcement']}\n\n")
                    if "compliance_framework" in props:
                        f.write(f"**Compliance**: {props['compliance_framework']}\n\n")

                    # What it applies to
                    applies_to = props.get("applies_to", [])
                    if isinstance(applies_to, str):
                        applies_to = [applies_to]
                    if applies_to:
                        f.write("**Applies To**:\n")
                        for target in applies_to:
                            element = self.model.get_element(target)
                            if element:
                                f.write(f"- {element.name} ({element.layer})\n")
                        f.write("\n")

            # Roles
            if roles:
                f.write("## Security Roles\n\n")
                f.write("| Role | Description | Permissions |\n")
                f.write("|------|-------------|-------------|\n")

                for role in roles:
                    desc = role.description or "-"
                    # Find permissions for this role
                    role_perms = []
                    if hasattr(self.model, "reference_registry"):
                        refs = self.model.reference_registry.get_references_from(role.id)
                        for ref in refs:
                            if ref.target_id.startswith("security.permission."):
                                perm = self.model.get_element(ref.target_id)
                                if perm:
                                    role_perms.append(perm.name)

                    perms_str = ", ".join(role_perms) if role_perms else "-"
                    f.write(f"| {role.name} | {desc} | {perms_str} |\n")

                f.write("\n")

            # Permissions
            if permissions:
                f.write("## Permissions\n\n")
                f.write("| Permission | Action | Resource |\n")
                f.write("|------------|--------|----------|\n")

                for perm in permissions:
                    props = perm.data.get("properties", {})
                    action = props.get("action", "-")
                    resource = props.get("resource", "-")
                    f.write(f"| {perm.name} | {action} | {resource} |\n")

                f.write("\n")

            # Protected Resources
            if resources:
                f.write("## Protected Resources\n\n")
                for resource in resources:
                    f.write(f"### {resource.name}\n\n")
                    if resource.description:
                        f.write(f"{resource.description}\n\n")

                    # Find what secures this resource
                    secured_by = []
                    if hasattr(self.model, "reference_registry"):
                        refs = self.model.reference_registry.get_references_to(resource.id)
                        for ref in refs:
                            if ref.source_id.startswith("security."):
                                sec_elem = self.model.get_element(ref.source_id)
                                if sec_elem:
                                    secured_by.append(f"{sec_elem.name} ({sec_elem.type})")

                    if secured_by:
                        f.write("**Secured By**:\n")
                        for sec in secured_by:
                            f.write(f"- {sec}\n")
                        f.write("\n")

            # Security Controls
            if controls:
                f.write("## Security Controls\n\n")
                for control in controls:
                    f.write(f"### {control.name}\n\n")
                    if control.description:
                        f.write(f"{control.description}\n\n")

                    props = control.data.get("properties", {})
                    if "control_type" in props:
                        f.write(f"**Type**: {props['control_type']}\n\n")
                    if "status" in props:
                        f.write(f"**Status**: {props['status']}\n\n")

    def _export_cross_layer_relationships(self) -> None:
        """Export cross-layer relationships documentation."""
        output_file = self.options.output_path / "cross-layer-relationships.md"

        with open(output_file, "w") as f:
            f.write("# Cross-Layer Relationships\n\n")
            f.write("Shows how elements in different layers relate to each other.\n\n")

            if not hasattr(self.model, "reference_registry"):
                f.write("*No reference registry available*\n")
                return

            # Group relationships by source layer
            layer_relationships = {}

            for ref in self.model.reference_registry.references:
                source_layer = ref.source_id.split(".")[0] if "." in ref.source_id else "unknown"
                target_layer = ref.target_id.split(".")[0] if "." in ref.target_id else "unknown"

                # Skip same-layer relationships
                if source_layer == target_layer:
                    continue

                key = f"{source_layer} → {target_layer}"
                if key not in layer_relationships:
                    layer_relationships[key] = []

                layer_relationships[key].append(ref)

            # Write relationships by layer pair
            for layer_pair, refs in sorted(layer_relationships.items()):
                f.write(f"## {layer_pair.title()}\n\n")
                f.write("| Source | Relationship | Target |\n")
                f.write("|--------|--------------|--------|\n")

                for ref in refs[:20]:  # Limit to 20 per section for readability
                    source = self.model.get_element(ref.source_id)
                    target = self.model.get_element(ref.target_id)

                    source_name = source.name if source else ref.source_id
                    target_name = target.name if target else ref.target_id
                    rel_type = ref.reference_type if ref.reference_type else "relates to"

                    f.write(f"| {source_name} | {rel_type} | {target_name} |\n")

                if len(refs) > 20:
                    f.write(f"\n*... and {len(refs) - 20} more relationships*\n")

                f.write("\n")

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
