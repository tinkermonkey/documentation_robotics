"""
Initialize a new architecture model.
"""

from pathlib import Path

import click
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from ..core.manifest import Manifest
from ..schemas import copy_schemas_to_project
from ..utils.file_io import create_directory_structure

console = Console()


class ModelInitializer:
    """Handles model initialization."""

    def __init__(
        self,
        root_path: Path,
        project_name: str,
        template: str = "basic",
        minimal: bool = False,
        with_examples: bool = False,
    ):
        self.root_path = root_path
        self.project_name = project_name
        self.template = template
        self.minimal = minimal
        self.with_examples = with_examples

    def create(self) -> None:
        """Create the model structure."""
        with Progress(
            SpinnerColumn(), TextColumn("[progress.description]{task.description}"), console=console
        ) as progress:
            # Create directory structure
            task = progress.add_task("Creating directory structure...", total=None)
            self._create_directories()
            progress.update(task, completed=True)

            # Copy schemas
            task = progress.add_task("Copying schema files...", total=None)
            self._create_schemas()
            progress.update(task, completed=True)

            # Create manifest
            task = progress.add_task("Creating manifest...", total=None)
            self._create_manifest()
            progress.update(task, completed=True)

            # Create documentation
            task = progress.add_task("Creating documentation...", total=None)
            self._create_documentation()
            progress.update(task, completed=True)

            # Create config file
            task = progress.add_task("Creating configuration...", total=None)
            self._create_config()
            progress.update(task, completed=True)

            # Phase 2: Create projection rules
            task = progress.add_task("Creating projection rules...", total=None)
            self._create_projection_rules()
            progress.update(task, completed=True)

            # Create examples if requested
            if self.with_examples:
                task = progress.add_task("Creating examples...", total=None)
                self._create_examples()
                progress.update(task, completed=True)

        console.print(
            f"\n✓ Successfully initialized model: {self.project_name}", style="green bold"
        )
        console.print(f"   Location: {self.root_path.absolute()}")
        console.print("\nNext steps:")
        console.print("  1. Review the model structure in documentation-robotics/model/")
        console.print("  2. Read documentation in .dr/README.md")
        console.print("  3. Add your first element: dr add business service --name 'My Service'")

    def _create_directories(self) -> None:
        """Create directory structure."""
        directories = [
            ".dr/schemas",
            ".dr/examples",
            ".dr/templates",
            ".dr/logs",
            "documentation-robotics/model/01_motivation",
            "documentation-robotics/model/02_business",
            "documentation-robotics/model/03_security",
            "documentation-robotics/model/04_application",
            "documentation-robotics/model/05_technology",
            "documentation-robotics/model/06_api",
            "documentation-robotics/model/07_data_model",
            "documentation-robotics/model/08_datastore",
            "documentation-robotics/model/09_ux",
            "documentation-robotics/model/10_navigation",
            "documentation-robotics/model/11_apm",
            "documentation-robotics/model/12_testing",
            "documentation-robotics/specs/archimate",
            "documentation-robotics/specs/openapi",
            "documentation-robotics/specs/schemas",
            "documentation-robotics/specs/ux",
            "documentation-robotics/specs/navigation",
            "documentation-robotics/specs/security",
            "documentation-robotics/specs/apm",
        ]

        create_directory_structure(self.root_path, directories)

    def _create_schemas(self) -> None:
        """Copy bundled schema files to .dr/schemas/.

        The CLI owns the .dr/ directory and manages it authoritatively.
        Always overwrites existing files and cleans obsolete files.
        """
        schemas_dir = self.root_path / ".dr" / "schemas"

        try:
            copied_count = copy_schemas_to_project(schemas_dir)
            console.print(f"   Synced {copied_count} schema files", style="dim")
        except Exception as e:
            console.print(f"   [yellow]Warning: Failed to sync schemas: {e}[/yellow]")
            console.print("   You may need to manually sync schema files to .dr/schemas/")

    def _create_manifest(self) -> None:
        """Create manifest.yaml."""
        Manifest.create(
            path=self.root_path / "documentation-robotics" / "model" / "manifest.yaml",
            project_name=self.project_name,
            project_description=f"Architecture model for {self.project_name}",
        )

    def _create_documentation(self) -> None:
        """Create .dr/README.md and other documentation."""
        readme_content = f"""# {self.project_name} - Architecture Model

This is a Documentation Robotics architecture model.

## Structure

- `documentation-robotics/` - Main project directory
  - `model/` - The canonical architecture model (11 layers)
  - `specs/` - Generated specifications (ArchiMate, OpenAPI, etc.)
  - `projection-rules.yaml` - Cross-layer projection rules
- `.dr/` - Tool configuration and schemas

## Quick Start

View model layers:
```bash
dr list business
```

Add an element:
```bash
dr add business service --name "My Service"
```

Validate model:
```bash
dr validate
```

## Model Information

- **Project:** {self.project_name}
- **Version:** 1.0.0

For more information, see the Documentation Robotics documentation.
"""

        readme_path = self.root_path / ".dr" / "README.md"
        readme_path.parent.mkdir(parents=True, exist_ok=True)
        readme_path.write_text(readme_content)

    def _create_config(self) -> None:
        """Create dr.config.yaml."""
        config_content = """version: "0.1.0"

# Model paths
paths:
  model: "./documentation-robotics/model"
  specs: "./documentation-robotics/specs"
  templates: "./.dr/templates"
  schemas: "./.dr/schemas"

# Default behaviors
defaults:
  output_format: "yaml"
  validation_mode: "standard"
  auto_project: false
  backup_before_update: true

# Validation rules
validation:
  strict_naming: true
  require_documentation: false
  check_cross_refs: true
  fail_on_warning: false

# Logging
logging:
  level: "info"
  file: ".dr/logs/dr.log"
"""

        config_path = self.root_path / "dr.config.yaml"
        config_path.write_text(config_content)

    def _create_projection_rules(self) -> None:
        """Create projection-rules.yaml with default rules."""
        projection_rules_content = """# Projection rules for cross-layer element generation
version: "0.1.0"

projections:
  # Business Service -> Application Service
  - name: "business-to-application"
    from: business.service
    to: application.service
    rules:
      - create_type: service
        name_template: "{{source.name}}"
        properties:
          realizes: "{{source.id}}"
          description: "Realizes {{source.name}}"
          documentation: "Application service for {{source.description}}"

  # Application Service -> API Specification
  - name: "application-to-api"
    from: application.service
    to: api.operation
    rules:
      - create_type: operation
        name_template: "{{source.name_kebab}}-operations"
        properties:
          applicationServiceRef: "{{source.id}}"

  # Business Service -> Security Resource
  - name: "business-to-security"
    from: business.service
    to: security.resource
    rules:
      - create_type: resource
        name_template: "{{source.name_kebab}}-api"
        properties:
          resource: "{{source.name_kebab}}-api"
          type: "api"
          archimateRef: "{{source.id}}"

  # API Operation -> UX State Action
  - name: "api-to-ux"
    from: api.operation
    to: ux.action
    rules:
      - create_type: action
        name_template: "{{source.name}}"
        properties:
          type: "api-call"
          operationId: "{{source.id}}"
"""

        projection_rules_path = self.root_path / "documentation-robotics" / "projection-rules.yaml"
        projection_rules_path.write_text(projection_rules_content)

    def _create_examples(self) -> None:
        """Create example elements."""
        # Create example business service
        example_service = """# Example Business Service

CustomerManagement:
  id: business.service.customer-management
  name: "Customer Management"
  description: "Manages customer lifecycle and relationships"
  documentation: "Handles all customer-related operations"
"""

        example_path = (
            self.root_path / "documentation-robotics" / "model" / "02_business" / "services.yaml"
        )
        example_path.parent.mkdir(parents=True, exist_ok=True)
        example_path.write_text(example_service)


@click.command()
@click.argument("project-name", required=True)
@click.option("--template", default="basic", help="Template to use")
@click.option("--minimal", is_flag=True, help="Create minimal structure")
@click.option("--with-examples", is_flag=True, help="Include example elements")
@click.option("--path", type=click.Path(), default=".", help="Target directory")
def init(
    project_name: str,
    template: str,
    minimal: bool,
    with_examples: bool,
    path: str,
):
    """Initialize a new architecture model."""

    root_path = Path(path).resolve()

    # Check if directory already has a model
    if (root_path / "documentation-robotics" / "model" / "manifest.yaml").exists():
        console.print("✗ Error: Model already exists in this directory", style="red bold")
        console.print(
            f"   Found: {root_path / 'documentation-robotics' / 'model' / 'manifest.yaml'}"
        )
        raise click.Abort()

    initializer = ModelInitializer(
        root_path=root_path,
        project_name=project_name,
        template=template,
        minimal=minimal,
        with_examples=with_examples,
    )

    try:
        initializer.create()
    except Exception as e:
        console.print(f"✗ Error during initialization: {e}", style="red bold")
        raise
