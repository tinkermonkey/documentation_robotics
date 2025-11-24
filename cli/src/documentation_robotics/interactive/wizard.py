"""
Interactive wizards for guided element creation and configuration.
"""

from typing import Any, Dict, List, Optional

import questionary
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..core.model import Model
from ..utils.id_generator import generate_element_id

console = Console()


class WizardBase:
    """Base class for interactive wizards."""

    def __init__(self, model: Optional[Model] = None):
        self.model = model
        self.data = {}

    def welcome(self, title: str, description: str) -> None:
        """Display welcome message."""
        console.print(
            Panel(
                f"[bold]{title}[/bold]\n\n{description}",
                border_style="blue",
                padding=(1, 2),
            )
        )

    def confirm(self, message: str, default: bool = True) -> bool:
        """Ask for confirmation."""
        return questionary.confirm(message, default=default).ask()

    def text_input(
        self, message: str, default: str = "", validate: Optional[callable] = None
    ) -> str:
        """Get text input."""
        return questionary.text(message, default=default, validate=validate).ask()

    def select(self, message: str, choices: List[str]) -> str:
        """Select from list of choices."""
        return questionary.select(message, choices=choices).ask()

    def checkbox(self, message: str, choices: List[str]) -> List[str]:
        """Select multiple choices."""
        return questionary.checkbox(message, choices=choices).ask()

    def show_summary(self, data: Dict[str, Any]) -> None:
        """Display summary table."""
        table = Table(show_header=True, header_style="bold blue")
        table.add_column("Property", style="cyan")
        table.add_column("Value", style="white")

        for key, value in data.items():
            table.add_row(key, str(value))

        console.print("\n")
        console.print(Panel(table, title="Summary", border_style="blue"))


class ElementWizard(WizardBase):
    """
    Interactive wizard for creating architecture elements.

    Guides users through element creation with smart defaults,
    validation, and layer-specific prompts.
    """

    # Element templates for common types
    TEMPLATES = {
        "business": {
            "service": {
                "required": ["name", "description"],
                "optional": ["owner", "capabilities", "customers"],
                "defaults": {"type": "service", "status": "active"},
            },
            "process": {
                "required": ["name", "description"],
                "optional": ["owner", "inputs", "outputs", "steps"],
                "defaults": {"type": "process"},
            },
            "actor": {
                "required": ["name", "role"],
                "optional": ["responsibilities", "reports_to"],
                "defaults": {"type": "actor"},
            },
        },
        "application": {
            "service": {
                "required": ["name", "description"],
                "optional": ["technology", "realizes", "dependencies"],
                "defaults": {"type": "service", "status": "active"},
            },
            "component": {
                "required": ["name", "description"],
                "optional": ["technology", "interfaces", "dependencies"],
                "defaults": {"type": "component"},
            },
        },
        "security": {
            "policy": {
                "required": ["name", "description", "policy_type", "enforcement"],
                "optional": ["compliance_framework", "applies_to"],
                "defaults": {"type": "policy", "status": "active"},
            },
            "role": {
                "required": ["name", "description"],
                "optional": ["permissions", "inherits_from"],
                "defaults": {"type": "role"},
            },
            "permission": {
                "required": ["name", "action", "resource"],
                "optional": ["conditions"],
                "defaults": {"type": "permission"},
            },
        },
        "api": {
            "operation": {
                "required": ["name", "method", "path"],
                "optional": [
                    "description",
                    "parameters",
                    "request_body",
                    "responses",
                    "applicationServiceRef",
                ],
                "defaults": {"type": "operation"},
            },
        },
        "data_model": {
            "entity": {
                "required": ["name", "description"],
                "optional": ["attributes", "relationships", "constraints"],
                "defaults": {"type": "entity"},
            },
        },
    }

    def __init__(self, model: Model):
        super().__init__(model)
        self.layer = None
        self.element_type = None
        self.template = None

    def run(self) -> Dict[str, Any]:
        """
        Run the element creation wizard.

        Returns:
            Element data dictionary
        """
        self.welcome(
            "Element Creation Wizard",
            "This wizard will guide you through creating a new architecture element.",
        )

        # Step 1: Select layer
        self.layer = self._select_layer()

        # Step 2: Select element type
        self.element_type = self._select_element_type()

        # Step 3: Load template if available
        self.template = self._get_template(self.layer, self.element_type)

        # Step 4: Collect required fields
        self._collect_required_fields()

        # Step 5: Collect optional fields
        if self.confirm("Would you like to add optional properties?", default=False):
            self._collect_optional_fields()

        # Step 6: Add custom properties
        if self.confirm("Would you like to add custom properties?", default=False):
            self._collect_custom_properties()

        # Step 7: Generate ID
        self.data["id"] = self._generate_id()

        # Step 8: Show summary and confirm
        self.show_summary(self.data)

        if not self.confirm("Create this element?", default=True):
            console.print("[yellow]Element creation cancelled[/yellow]")
            return None

        return {
            "layer": self.layer,
            "element_type": self.element_type,
            "data": self.data,
        }

    def _select_layer(self) -> str:
        """Select target layer."""
        layers = list(self.model.layers.keys())
        layer_display = [
            f"{name} - {self.model.layers[name].config.get('name', name)}" for name in layers
        ]

        console.print("\n[bold]Step 1:[/bold] Select target layer")
        selected = self.select("Which layer should this element belong to?", layer_display)

        # Extract layer name from display string
        layer = selected.split(" - ")[0]
        return layer

    def _select_element_type(self) -> str:
        """Select element type."""
        # Get element types from schema if available
        layer_obj = self.model.get_layer(self.layer)
        if layer_obj and layer_obj.schema_path:
            # TODO: Parse schema to get valid types
            # For now, use common types
            pass

        # Use template types if available
        if self.layer in self.TEMPLATES:
            types = list(self.TEMPLATES[self.layer].keys())
        else:
            types = ["service", "component", "entity", "policy", "operation"]

        console.print("\n[bold]Step 2:[/bold] Select element type")
        element_type = self.select("What type of element is this?", types + ["Other"])

        if element_type == "Other":
            element_type = self.text_input("Enter custom element type:")

        return element_type

    def _get_template(self, layer: str, element_type: str) -> Optional[Dict]:
        """Get template for layer and element type."""
        if layer in self.TEMPLATES and element_type in self.TEMPLATES[layer]:
            return self.TEMPLATES[layer][element_type]
        return None

    def _collect_required_fields(self) -> None:
        """Collect required fields."""
        console.print("\n[bold]Step 3:[/bold] Required fields")

        if self.template:
            required = self.template.get("required", ["name", "description"])
        else:
            required = ["name", "description"]

        for field in required:
            value = self.text_input(f"{field.replace('_', ' ').title()}:")
            self.data[field] = value

    def _collect_optional_fields(self) -> None:
        """Collect optional fields."""
        console.print("\n[bold]Step 4:[/bold] Optional fields")

        if self.template:
            optional = self.template.get("optional", [])
        else:
            optional = []

        if not optional:
            console.print("[dim]No predefined optional fields for this type[/dim]")
            return

        selected_fields = self.checkbox("Select optional fields to add:", optional)

        for field in selected_fields:
            value = self.text_input(f"{field.replace('_', ' ').title()}:")
            self.data[field] = value

    def _collect_custom_properties(self) -> None:
        """Collect custom properties."""
        console.print("\n[bold]Step 5:[/bold] Custom properties")

        while True:
            key = self.text_input("Property name (empty to finish):")
            if not key:
                break

            value = self.text_input(f"Value for {key}:")
            self.data[key] = value

    def _generate_id(self) -> str:
        """Generate element ID."""
        console.print("\n[bold]Step 6:[/bold] Element ID")

        suggested_id = generate_element_id(self.layer, self.element_type, self.data.get("name", ""))
        console.print(f"[dim]Suggested ID: {suggested_id}[/dim]")

        if self.confirm("Use suggested ID?", default=True):
            return suggested_id

        return self.text_input("Enter custom ID:")


class InitWizard(WizardBase):
    """
    Interactive wizard for initializing new projects.

    Guides users through project setup with smart defaults.
    """

    def run(self) -> Dict[str, Any]:
        """
        Run the init wizard.

        Returns:
            Configuration dictionary
        """
        self.welcome(
            "Project Initialization Wizard",
            "This wizard will help you create a new architecture model project.",
        )

        # Project name
        console.print("\n[bold]Step 1:[/bold] Project Information")
        project_name = self.text_input("Project name:")
        self.data["project_name"] = project_name

        # Template selection
        console.print("\n[bold]Step 2:[/bold] Template Selection")
        template = self.select(
            "Select a template:",
            [
                "basic - Standard 11-layer architecture",
                "minimal - Minimal structure with core layers only",
                "microservices - Template for microservices architecture",
                "e-commerce - Template for e-commerce systems",
            ],
        )
        self.data["template"] = template.split(" - ")[0]

        # Options
        console.print("\n[bold]Step 3:[/bold] Additional Options")
        options = self.checkbox(
            "Select additional options:",
            [
                "Include example elements",
                "Create documentation templates",
                "Setup Git repository",
                "Enable all layers",
            ],
        )

        self.data["with_examples"] = "Include example elements" in options
        self.data["with_docs"] = "Create documentation templates" in options
        self.data["init_git"] = "Setup Git repository" in options
        self.data["enable_all_layers"] = "Enable all layers" in options

        # Directory
        console.print("\n[bold]Step 4:[/bold] Location")
        default_path = f"./{project_name.lower().replace(' ', '-')}"
        path = self.text_input("Target directory:", default=default_path)
        self.data["path"] = path

        # Summary
        summary_data = {
            "Project Name": project_name,
            "Template": self.data["template"],
            "Target Directory": path,
            "Include Examples": self.data["with_examples"],
        }

        self.show_summary(summary_data)

        if not self.confirm("Initialize project with these settings?", default=True):
            console.print("[yellow]Project initialization cancelled[/yellow]")
            return None

        return self.data


class ProjectionWizard(WizardBase):
    """
    Interactive wizard for creating projection rules.

    Helps define cross-layer element projection rules.
    """

    def __init__(self, model: Model):
        super().__init__(model)
        self.projection = {}

    def run(self) -> Dict[str, Any]:
        """
        Run the projection wizard.

        Returns:
            Projection rule dictionary
        """
        self.welcome(
            "Projection Rule Wizard",
            "This wizard will help you create a new projection rule for cross-layer element generation.",
        )

        # Rule name
        console.print("\n[bold]Step 1:[/bold] Rule Information")
        name = self.text_input("Rule name:")
        self.projection["name"] = name

        # Source layer and type
        console.print("\n[bold]Step 2:[/bold] Source Element")
        source_layer = self._select_layer("Select source layer:")
        source_type = self.text_input("Source element type:")
        self.projection["from"] = f"{source_layer}.{source_type}"

        # Target layer and type
        console.print("\n[bold]Step 3:[/bold] Target Element")
        target_layer = self._select_layer("Select target layer:")
        target_type = self.text_input("Target element type:")
        self.projection["to"] = f"{target_layer}.{target_type}"

        # Name template
        console.print("\n[bold]Step 4:[/bold] Element Generation")
        name_template = self.select(
            "Name template:",
            [
                "{{source.name}} - Use source name",
                "{{source.name_kebab}} - Use kebab-case version",
                "Custom template",
            ],
        )

        if "Custom" in name_template:
            name_template = self.text_input("Enter name template:")
        else:
            name_template = name_template.split(" - ")[0]

        # Properties
        console.print("\n[bold]Step 5:[/bold] Properties")
        properties = {}

        if self.confirm("Add property mappings?", default=True):
            while True:
                prop_name = self.text_input("Property name (empty to finish):")
                if not prop_name:
                    break

                prop_value = self.text_input(f"Value template for {prop_name}:")
                properties[prop_name] = prop_value

        # Build rule
        rule = {
            "create_type": target_type,
            "name_template": name_template,
            "properties": properties,
        }

        self.projection["rules"] = [rule]

        # Summary
        summary_data = {
            "Rule Name": name,
            "Source": self.projection["from"],
            "Target": self.projection["to"],
            "Name Template": name_template,
            "Properties": len(properties),
        }

        self.show_summary(summary_data)

        if not self.confirm("Create this projection rule?", default=True):
            console.print("[yellow]Projection rule creation cancelled[/yellow]")
            return None

        return self.projection

    def _select_layer(self, message: str) -> str:
        """Select a layer."""
        layers = list(self.model.layers.keys())
        return self.select(message, layers)


class UpdateWizard(WizardBase):
    """
    Interactive wizard for updating elements.

    Provides guided element updates with validation.
    """

    def __init__(self, model: Model, element_id: str):
        super().__init__(model)
        self.element_id = element_id
        self.element = model.get_element(element_id)

        if not self.element:
            raise ValueError(f"Element '{element_id}' not found")

    def run(self) -> Dict[str, Any]:
        """
        Run the update wizard.

        Returns:
            Updates dictionary
        """
        self.welcome(
            "Element Update Wizard",
            f"Update element: {self.element.name} ({self.element.id})",
        )

        # Show current values
        console.print("\n[bold]Current Values:[/bold]")
        current_table = Table(show_header=True, header_style="bold blue")
        current_table.add_column("Property")
        current_table.add_column("Current Value")

        for key, value in self.element.data.items():
            if key not in ["id", "type"]:
                current_table.add_row(key, str(value))

        console.print(current_table)
        console.print()

        # Select fields to update
        fields = [k for k in self.element.data.keys() if k not in ["id", "type"]]
        selected = self.checkbox("Select fields to update:", fields + ["Add new field"])

        updates = {}

        for field in selected:
            if field == "Add new field":
                new_field = self.text_input("New field name:")
                new_value = self.text_input(f"Value for {new_field}:")
                updates[new_field] = new_value
            else:
                current_value = str(self.element.data.get(field, ""))
                new_value = self.text_input(f"{field}:", default=current_value)
                if new_value != current_value:
                    updates[field] = new_value

        if not updates:
            console.print("[yellow]No changes made[/yellow]")
            return None

        # Show summary
        self.show_summary(updates)

        if not self.confirm("Apply these updates?", default=True):
            console.print("[yellow]Update cancelled[/yellow]")
            return None

        return updates
