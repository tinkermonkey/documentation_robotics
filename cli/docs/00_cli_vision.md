## Folder Structure as the API

```
project/
├── model/                          # The canonical model
│   ├── manifest.yaml              # Model metadata & layer registry
│   ├── motivation/
│   │   ├── goals.yaml
│   │   ├── stakeholders.yaml
│   │   └── requirements.yaml
│   ├── business/
│   │   ├── services.yaml
│   │   ├── processes.yaml
│   │   └── actors.yaml
│   ├── security/
│   │   ├── roles.yaml
│   │   ├── permissions.yaml
│   │   └── policies.yaml
│   ├── application/
│   │   ├── components.yaml
│   │   └── services.yaml
│   ├── technology/
│   │   └── stack.yaml
│   ├── api/
│   │   ├── operations.yaml       # References to OpenAPI files
│   │   └── endpoints.yaml
│   ├── data/
│   │   ├── entities.yaml         # References to JSON Schema files
│   │   └── relationships.yaml
│   ├── ux/
│   │   ├── screens.yaml
│   │   └── states.yaml
│   └── navigation/
│       ├── routes.yaml
│       └── guards.yaml
│
├── specs/                          # Generated/exported specifications
│   ├── archimate/
│   │   └── model.archimate
│   ├── openapi/
│   │   ├── customer-api.yaml
│   │   └── product-api.yaml
│   ├── schemas/
│   │   ├── customer.schema.json
│   │   └── product.schema.json
│   ├── ux/
│   │   ├── customer-list.ux.yaml
│   │   └── customer-edit.ux.yaml
│   └── security/
│       └── security-model.yaml
│
├── projection-rules.yaml           # Rules for cross-layer projection
├── dr.config.yaml                 # Configuration for dr tool
└── dr                             # The CLI tool (Python/Node/Bash)
```

## The `dr` CLI Tool

A simple Python CLI that Claude Code can invoke:

```python
#!/usr/bin/env python3
# dr - Documentation Robotics CLI

import click
import yaml
import json
from pathlib import Path

class ModelManager:
    def __init__(self, root_dir=Path.cwd()):
        self.root = root_dir
        self.model_dir = root_dir / "model"
        self.specs_dir = root_dir / "specs"

    def load_layer(self, layer_name):
        layer_path = self.model_dir / layer_name
        data = {}
        for yaml_file in layer_path.glob("*.yaml"):
            key = yaml_file.stem
            data[key] = yaml.safe_load(yaml_file.read_text())
        return data

    def save_layer(self, layer_name, data):
        layer_path = self.model_dir / layer_name
        layer_path.mkdir(exist_ok=True)
        for key, content in data.items():
            (layer_path / f"{key}.yaml").write_text(
                yaml.dump(content, default_flow_style=False)
            )

@click.group()
def cli():
    """Documentation Robotics model management"""
    pass

@cli.command()
@click.argument('layer')
@click.argument('element_type')
@click.option('--name', required=True)
@click.option('--spec', type=click.File('r'), help='YAML/JSON spec file')
@click.option('--project-to', multiple=True, help='Project to other layers')
def add(layer, element_type, name, spec, project_to):
    """Add an element to a layer"""
    mgr = ModelManager()

    # Parse spec
    element_spec = yaml.safe_load(spec) if spec else {}
    element_spec['name'] = name
    element_spec['id'] = f"{layer}.{element_type}.{name.lower().replace(' ', '-')}"

    # Add to layer
    layer_data = mgr.load_layer(layer)
    if element_type not in layer_data:
        layer_data[element_type] = {}
    layer_data[element_type][name] = element_spec
    mgr.save_layer(layer, layer_data)

    click.echo(f"Added {element_type} '{name}' to {layer} layer")

    # Project to other layers
    if project_to:
        for target_layer in project_to:
            project_element(layer, element_spec, target_layer)
            click.echo(f"Projected to {target_layer}")

@cli.command()
@click.argument('query')
def find(query):
    """Find elements matching a query"""
    mgr = ModelManager()
    # Simple query: "application.service.CustomerService"
    parts = query.split('.')
    if len(parts) >= 2:
        layer_data = mgr.load_layer(parts[0])
        if parts[1] in layer_data:
            result = layer_data[parts[1]]
            if len(parts) > 2:
                result = result.get(parts[2])
            click.echo(yaml.dump(result))

@cli.command()
@click.option('--layer', help='Specific layer to validate')
@click.option('--strict', is_flag=True)
def validate(layer, strict):
    """Validate model consistency"""
    mgr = ModelManager()
    results = {}

    # Validate each layer
    if layer:
        results[layer] = validate_layer(layer, strict)
    else:
        for layer_dir in mgr.model_dir.iterdir():
            if layer_dir.is_dir():
                results[layer_dir.name] = validate_layer(layer_dir.name, strict)

    # Check cross-references
    results['references'] = validate_references(mgr)

    for layer, status in results.items():
        symbol = "✓" if status == "valid" else "✗"
        click.echo(f"{symbol} {layer}: {status}")

@cli.command()
@click.option('--format', type=click.Choice(['archimate', 'openapi', 'all']))
@click.option('--output', type=click.Path())
def export(format, output):
    """Export to standard specifications"""
    mgr = ModelManager()

    if format == 'archimate' or format == 'all':
        export_archimate(mgr)
    if format == 'openapi' or format == 'all':
        export_openapi(mgr)

    click.echo(f"Exported {format} to specs/")

@cli.command()
@click.argument('description')
@click.option('--layers', default='all')
def generate(description, layers):
    """Generate a capability across layers (uses Claude via template)"""
    # This creates a template file that Claude Code can see and complete
    template_path = Path.cwd() / ".dr-generate-request.yaml"
    template_path.write_text(f"""
# INSTRUCTION FOR CLAUDE:
# Generate a complete capability based on this description
# Fill in the specifications for each layer

description: {description}
target_layers: {layers}

motivation:
  goals: []
  requirements: []

business:
  services: []

application:
  components: []

api:
  operations: []

data:
  entities: []

ux:
  screens: []

security:
  permissions: []
""")
    click.echo(f"Generated template at {template_path}")
    click.echo("Claude Code can now complete this template")

if __name__ == '__main__':
    cli()
```

## How Claude Code Uses This

### Direct File Manipulation

Claude Code can directly read/write the model files:

```python
# Claude Code can directly manipulate files
def add_business_service(name, description):
    service_file = Path("model/business/services.yaml")
    services = yaml.safe_load(service_file.read_text()) or {}

    services[name] = {
        'id': f"business.service.{name.lower().replace(' ', '-')}",
        'name': name,
        'description': description,
        'created': datetime.now().isoformat()
    }

    service_file.write_text(yaml.dump(services))
```

### Using the `dr` CLI

Claude Code can also use the CLI for convenience:

```bash
# Claude Code runs these commands
$ dr add business service --name "Customer Management" \
    --spec service-spec.yaml \
    --project-to application,api

$ dr validate --strict

$ dr export --format openapi
```

### Hybrid Approach

Claude Code can mix both approaches:

```python
# Read the model directly
business = yaml.safe_load(Path("model/business/services.yaml").read_text())

# Analyze and design additions
new_service = design_service_based_on_gaps(business)

# Use CLI for validated additions
subprocess.run([
    "dr", "add", "business", "service",
    "--name", new_service['name'],
    "--spec", "-"
], input=yaml.dump(new_service), text=True)

# Read the projection rules directly
rules = yaml.safe_load(Path("projection-rules.yaml").read_text())

# Apply projections programmatically
apply_projections(new_service, rules)

# Use CLI to validate everything
subprocess.run(["dr", "validate", "--strict"])
```

## Key Advantages of This Approach

1. **No Additional Infrastructure**: Just files and a CLI tool
2. **Full Transparency**: Claude Code can see and understand everything
3. **Direct Manipulation**: Claude can bypass the CLI when needed
4. **Git-Friendly**: Everything is text files in version control
5. **Tool-Optional**: The `dr` CLI provides convenience and validation, but isn't required
6. **Simple Testing**: Just examine the files to verify correctness

## Example Claude Code Session

```markdown
You: "Add a Customer Management capability with CRUD operations"

Claude Code: I'll add a Customer Management capability across all relevant layers. Let me start by examining the current model structure and then add the necessary components.

[Claude reads model/manifest.yaml to understand the structure]
[Claude reads projection-rules.yaml to understand relationships]

First, I'll add the business service:

$ dr add business service --name "Customer Management" --project-to application,api

Now I'll define the detailed API operations by creating the OpenAPI spec:

[Creates specs/openapi/customer-api.yaml with full CRUD operations]

Let me add the data model:

[Creates specs/schemas/customer.schema.json]

Now I'll create the UX specifications for the customer screens:

[Creates specs/ux/customer-list.ux.yaml and customer-edit.ux.yaml]

Finally, let's add the security policies:

$ dr add security role --name "customer-manager"
$ dr add security permission --name "customer.create"
$ dr add security permission --name "customer.read"
$ dr add security permission --name "customer.update"
$ dr add security permission --name "customer.delete"

Let me validate everything:

$ dr validate --strict
✓ business: valid
✓ application: valid
✓ api: valid
✓ security: valid
✓ references: valid

The Customer Management capability has been added successfully!
```

## Projection Rules as Code

Since everything is in files, your projection rules can be simple YAML:

```yaml
# projection-rules.yaml
projections:
  - from: business.service
    to: application.component
    rules:
      - create_type: ApplicationService
        name_template: "{source.name}Service"
        properties:
          realizes: "{source.id}"

  - from: application.service
    to: api.specification
    rules:
      - create_file: "specs/openapi/{source.name.kebab}-api.yaml"
        template: "templates/openapi-service.yaml"

  - from: api.operation
    to: ux.state_action
    rules:
      - create_type: StateAction
        properties:
          action: fetchData
          api_operation: "{source.operationId}"
```

This approach gives you the best of both worlds:

- **Structure** through conventions and the `dr` tool
- **Flexibility** through direct file access
- **Intelligence** through Claude Code's ability to understand and manipulate both

# Federated Architecture Metadata Model

You need to make the metadata schema "discoverable" and "understandable" to Claude Code. Here are several complementary approaches:

## Approach 1: Schema-as-Documentation in the Repository

Create a `.dr/` directory with comprehensive documentation that Claude Code will always read:

```
project/
├── .dr/
│   ├── README.md                 # Overview and quick reference
│   ├── META-SCHEMA.md           # Complete metadata model
│   ├── CONVENTIONS.md           # File naming and structure rules
│   ├── schemas/
│   │   ├── business-layer.schema.yaml
│   │   ├── application-layer.schema.yaml
│   │   ├── security-layer.schema.yaml
│   │   └── ...
│   └── examples/
│       ├── add-business-service.example.yaml
│       ├── add-api-operation.example.yaml
│       └── ...
```

### `.dr/README.md`

```markdown
# Documentation Robotics Model

This codebase uses the Documentation Robotics federated architecture model.

## Quick Reference

| Layer       | Location             | Schema                                      | Description                          |
| ----------- | -------------------- | ------------------------------------------- | ------------------------------------ |
| Business    | `model/business/`    | `.dr/schemas/business-layer.schema.yaml`    | Business services, processes, actors |
| Application | `model/application/` | `.dr/schemas/application-layer.schema.yaml` | Software components and services     |
| API         | `specs/openapi/`     | OpenAPI 3.0                                 | API specifications                   |
| Data        | `specs/schemas/`     | JSON Schema                                 | Data models                          |
| UX          | `specs/ux/`          | `.dr/schemas/ux-layer.schema.yaml`          | User interface specifications        |
| Security    | `model/security/`    | `.dr/schemas/security-layer.schema.yaml`    | Roles, permissions, policies         |

## Working with the Model

1. **To add a new element**: Use `dr add <layer> <type>` or directly modify files following schemas
2. **To find elements**: Check `model/<layer>/*.yaml` files
3. **To validate**: Run `dr validate`
4. **To export**: Run `dr export --format <format>`

## File Naming Conventions

- Business services: `model/business/services.yaml`
- API specs: `specs/openapi/<service-name>-api.yaml`
- JSON schemas: `specs/schemas/<entity-name>.schema.json`
- UX specs: `specs/ux/<screen-name>.ux.yaml`

See CONVENTIONS.md for complete rules.
```

## Approach 2: Living Schema Files

Create YAML schemas that are both human and machine readable:

### `.dr/schemas/business-layer.schema.yaml`

```yaml
# Business Layer Schema
# This file describes the structure of business layer elements

layer:
  name: business
  path: model/business/
  description: Business architecture elements

element_types:
  service:
    file: services.yaml
    required_properties:
      - name # Human-readable name
      - id # Format: business.service.<kebab-name>
      - description # What this service does
    optional_properties:
      - processes # List of business processes
      - actors # Business actors involved
      - realizes # Links to motivation layer goals
    example:
      name: "Customer Management"
      id: "business.service.customer-management"
      description: "Manages customer lifecycle"
      processes: ["onboarding", "support", "retention"]
      actors: ["customer", "support-agent"]

  process:
    file: processes.yaml
    required_properties:
      - name
      - id # Format: business.process.<kebab-name>
      - steps # Ordered list of process steps
    relationships:
      - service # Which service owns this process
      - actors # Who participates

relationships:
  - from: service
    to: application.component
    type: realized_by
    projection_rule: |
      When a business service is created, create an ApplicationService
      with name "{service.name}Service" that realizes it
```

## Approach 3: Interactive Instructions File

Create a `.dr/INSTRUCTIONS.md` that Claude Code should always read first:

````markdown
# Instructions for Claude Code

When working with the Documentation Robotics model in this codebase:

## Before Making Changes

1. **Check the current state**: Read `model/manifest.yaml` to see what exists
2. **Understand the layer**: Read `.dr/schemas/<layer>.schema.yaml` for the layer you're modifying
3. **Follow conventions**: Check `.dr/CONVENTIONS.md` for naming rules

## When Adding Elements

For each element type, here's what to modify:

### Adding a Business Service

1. File: `model/business/services.yaml`
2. Structure:
   ```yaml
   ServiceName:
     id: business.service.service-name
     name: "Service Name"
     description: "What it does"
   ```
````

3. Then project to: application layer, api layer

### Adding an API Operation

1. File: `specs/openapi/<service>-api.yaml`
2. Follow OpenAPI 3.0 specification
3. Link to: application.service via x-realizes extension

### Adding a UX Screen

1. File: `specs/ux/<screen-name>.ux.yaml`
2. Structure: See `.dr/schemas/ux-layer.schema.yaml`
3. Reference: API operations via operationId

## Validation Rules

- All IDs must follow pattern: `<layer>.<type>.<kebab-name>`
- Cross-references must point to existing elements
- Required properties per `.dr/schemas/` must be present

## Available Commands

- `dr add <layer> <type> --name "Name"` - Add element
- `dr validate` - Check consistency
- `dr find <id>` - Locate element
- `dr export --format <format>` - Generate specifications

````

## Approach 4: Manifest with Intelligence

Make `model/manifest.yaml` be the "index" that teaches structure:

```yaml
# model/manifest.yaml
version: "1.0.0"
schema: "documentation-robotics-v1"
documentation: ".dr/README.md"

# This manifest describes the model structure
# Claude Code: Read this file to understand what exists and where

layers:
  motivation:
    path: model/motivation/
    schema: .dr/schemas/motivation-layer.schema.yaml
    elements:
      goals: 3
      requirements: 12
      stakeholders: 5

  business:
    path: model/business/
    schema: .dr/schemas/business-layer.schema.yaml
    elements:
      services: 5
      processes: 8
      actors: 6
    files:
      - services.yaml     # Business services
      - processes.yaml    # Business processes
      - actors.yaml      # Business actors

  application:
    path: model/application/
    schema: .dr/schemas/application-layer.schema.yaml
    elements:
      components: 10
      services: 8

  api:
    path: specs/openapi/
    format: openapi-3.0
    files:
      - customer-api.yaml
      - product-api.yaml
      - order-api.yaml

cross_references:
  # These show how layers connect
  - from: business.service.customer-management
    to: application.service.customer-service
    type: realized_by

  - from: application.service.customer-service
    to: api.customer-api.operations
    type: exposed_as

conventions:
  id_format: "{layer}.{type}.{kebab-case-name}"
  file_naming:
    api: "{service-name}-api.yaml"
    schema: "{entity-name}.schema.json"
    ux: "{screen-name}.ux.yaml"
````

## Approach 5: Example-Driven Learning

Create example files that show the patterns:

### `.dr/examples/complete-capability.yaml`

```yaml
# Example: Adding a complete "Order Management" capability
# This shows how elements connect across layers

business:
  service:
    name: "Order Management"
    id: "business.service.order-management"
    description: "Handles order lifecycle"
    processes: ["create-order", "fulfill-order", "handle-return"]

application:
  service:
    name: "OrderService"
    id: "application.service.order-service"
    realizes: "business.service.order-management"
    operations: ["createOrder", "getOrder", "updateOrder", "cancelOrder"]

  component:
    name: "OrderUI"
    id: "application.component.order-ui"
    type: "frontend"
    uses: ["application.service.order-service"]

api:
  # This goes in specs/openapi/order-api.yaml
  specification:
    openapi: "3.0.0"
    paths:
      /orders:
        post:
          operationId: "createOrder"
          x-realizes: "application.service.order-service"

data:
  # This goes in specs/schemas/order.schema.json
  entity:
    name: "Order"
    properties:
      id: { type: "string", format: "uuid" }
      customerId: { type: "string", format: "uuid" }
      items: { type: "array" }

ux:
  # This goes in specs/ux/order-create.ux.yaml
  screen:
    name: "order-create"
    states: ["initial", "editing", "submitting", "complete"]
    api_operations: ["createOrder"]

security:
  permissions:
    - "order.create"
    - "order.read"
    - "order.update"
    - "order.cancel"
```

## Approach 6: Validation as Teaching

Create a `dr check` command that explains what it's looking for:

```python
#!/usr/bin/env python3
# dr check - Teaches while validating

@cli.command()
@click.option('--teach', is_flag=True, help='Explain what is being checked')
def check(teach):
    """Validate and explain the model structure"""

    if teach:
        print("""
        Checking Documentation Robotics Model Structure:

        1. BUSINESS LAYER (model/business/)
           - Looking for services.yaml
           - Each service needs: id, name, description
           - IDs should match pattern: business.service.*

        2. APPLICATION LAYER (model/application/)
           - Looking for components.yaml and services.yaml
           - Services should realize business services

        3. API SPECIFICATIONS (specs/openapi/)
           - Each .yaml file should be valid OpenAPI 3.0
           - Operations should have x-realizes linking to app services
        """)

    # Actual validation...
```

## The Most Effective Combination

I recommend using **all of these approaches together**:

```
project/
├── .dr/
│   ├── README.md                    # Quick reference
│   ├── INSTRUCTIONS.md              # How to work with the model
│   ├── META-SCHEMA.md              # Full Documentation Robotics spec
│   ├── schemas/                    # Layer schemas
│   └── examples/                   # Complete examples
├── model/
│   ├── manifest.yaml               # Current state index
│   └── [layer directories]
├── specs/                          # Generated specifications
└── dr                              # CLI with --teach flag
```

Then, in your interactions with Claude Code, you can simply say:

> "Read `.dr/INSTRUCTIONS.md` first, then add a Customer Management capability following the Documentation Robotics model"

Claude Code will:

1. Read the instructions to understand the model
2. Check the manifest to see current state
3. Read relevant schemas for validation rules
4. Look at examples if needed
5. Make the appropriate changes
6. Validate using the `dr` command

## Pro Tip: Initial Context Setting

Create a `.claude-context` file that Claude Code should always read:

```markdown
# Context for Claude Code

This project uses the Documentation Robotics federated architecture model.

Key files to understand the model:

- `.dr/INSTRUCTIONS.md` - How to work with the model
- `model/manifest.yaml` - Current model state
- `.dr/schemas/` - Structure definitions for each layer

Before making changes:

1. Read the relevant schema file
2. Check existing elements in model/
3. Follow ID conventions: {layer}.{type}.{kebab-name}
4. Validate after changes: `dr validate`

For examples, see `.dr/examples/`
```

This way, you can just tell Claude Code: "Check `.claude-context` then add [whatever]" and it will have all the context it needs.
