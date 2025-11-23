# `dr` CLI Tool - Detailed Requirements

## 1. Overview

The `dr` (Documentation Robotics) CLI is a command-line tool for managing federated architecture metadata models. It enables creation, validation, querying, and export of architecture models across 11 layers using both standard specifications (ArchiMate, OpenAPI, JSON Schema, OpenTelemetry) and custom extensions.

**Design Philosophy:**

- **Files are the API** - The model is stored as YAML/JSON files that can be directly manipulated
- **CLI provides convenience** - The `dr` tool offers validation, projection, and export functionality
- **Claude Code integration** - Designed to be easily used by both humans and Claude Code
- **Standards-based** - Leverage existing standards wherever possible
- **Git-friendly** - All model files are text-based and version-controllable

## 2. Functional Requirements

### 2.1 Core Capabilities

#### FR-001: Model Initialization

**Requirement:** The tool SHALL create a new architecture model with default structure.

**Acceptance Criteria:**

- Creates `model/` directory with all 11 layer subdirectories
- Creates `specs/` directory with appropriate subdirectories
- Creates `model/manifest.yaml` with layer registry
- Creates `.dr/` directory with documentation and schemas
- Creates `dr.config.yaml` with default configuration
- Creates `projection-rules.yaml` with default projection rules

**Command:**

```bash
dr init [project-name] [options]
  --template <template-name>  # Optional: use a template (basic, microservices, etc.)
  --minimal                   # Only create essential directories
  --with-examples             # Include example elements
```

#### FR-002: Element Management

**Requirement:** The tool SHALL support adding, updating, and removing elements across all 11 layers.

**Acceptance Criteria:**

- Can add elements to any layer with validation
- Can update existing elements
- Can remove elements with dependency checking
- Can bulk import elements from files
- Validates element structure against layer schemas
- Maintains cross-layer references
- Updates manifest.yaml automatically

**Commands:**

```bash
# Add element
dr add <layer> <element-type> --name <name> [options]
  --spec <file>               # YAML/JSON spec file
  --id <id>                   # Custom ID (auto-generated if not provided)
  --project-to <layer>[,...]  # Project to other layers
  --properties <key=value>... # Additional properties
  --interactive               # Interactive mode with prompts

# Update element
dr update <element-id> [options]
  --spec <file>               # Updated YAML/JSON spec
  --set <key=value>...        # Set specific properties
  --interactive               # Interactive update

# Remove element
dr remove <element-id> [options]
  --force                     # Skip dependency checks
  --cascade                   # Remove dependent elements
  --dry-run                   # Show what would be removed

# Bulk operations
dr import <layer> --file <file>  # Import multiple elements
dr export <layer> --file <file>  # Export layer to file
```

**Examples:**

```bash
# Add a business service
dr add business service \
  --name "Customer Management" \
  --spec business-service.yaml \
  --project-to application,api

# Add API operation
dr add api operation \
  --name "getCustomer" \
  --spec customer-api.yaml

# Update element
dr update business.service.customer-management \
  --set description="Enhanced customer management service"

# Remove with cascade
dr remove business.service.customer-management --cascade
```

#### FR-003: Query and Search

**Requirement:** The tool SHALL support querying and searching elements across all layers.

**Acceptance Criteria:**

- Can find elements by ID, name, type, or layer
- Can search by property values
- Can filter by relationships
- Can trace cross-layer dependencies
- Outputs in multiple formats (YAML, JSON, table)

**Commands:**

```bash
# Find by ID
dr find <element-id>
  --output <format>           # yaml, json, table (default: yaml)
  --show-refs                 # Show cross-references
  --show-deps                 # Show dependencies

# Search by criteria
dr search [options]
  --layer <layer>             # Filter by layer
  --type <element-type>       # Filter by element type
  --name <pattern>            # Filter by name (supports wildcards)
  --property <key=value>      # Filter by property value
  --output <format>           # Output format

# List elements
dr list <layer> [element-type] [options]
  --output <format>
  --sort <field>              # Sort by field
  --limit <n>                 # Limit results

# Trace dependencies
dr trace <element-id> [options]
  --direction <up|down|both>  # Trace direction
  --max-depth <n>             # Maximum depth
  --output <format>
```

**Examples:**

```bash
# Find specific element
dr find business.service.customer-management --show-refs

# Search for all services
dr search --type service --output table

# List business layer
dr list business --sort name

# Trace dependencies
dr trace application.service.customer-service --direction both
```

#### FR-004: Validation

**Requirement:** The tool SHALL validate model integrity, schema compliance, and cross-layer consistency.

**Acceptance Criteria:**

- Validates each layer against its schema (ArchiMate XSD, JSON Schema, etc.)
- Validates cross-layer references
- Validates projection rules
- Checks for circular dependencies
- Validates naming conventions
- Reports all validation errors with clear messages
- Supports incremental validation (single layer or element)

**Commands:**

```bash
dr validate [options]
  --layer <layer>             # Validate specific layer
  --element <element-id>      # Validate specific element
  --strict                    # Strict validation mode
  --fix                       # Auto-fix common issues
  --output <format>           # Output format (text, json, junit)
  --fail-fast                 # Stop on first error

dr check [options]            # Alias for validate with --strict
```

**Validation Rules:**

1. **Schema Validation:**
   - Motivation Layer: ArchiMate 3.2 Motivation elements
   - Business Layer: ArchiMate 3.2 Business elements
   - Security Layer: Custom security schema
   - Application Layer: ArchiMate 3.2 Application elements
   - Technology Layer: ArchiMate 3.2 Technology elements
   - API Layer: OpenAPI 3.0 specification
   - Data Model Layer: JSON Schema Draft 7
   - Data Store Layer: SQL DDL schema
   - UX Layer: Custom UX schema
   - Navigation Layer: Custom navigation schema
   - APM Layer: OpenTelemetry configuration

2. **Cross-Layer Validation:**
   - All references point to existing elements
   - Projection rules are satisfied
   - Naming conventions are followed (e.g., `{layer}.{type}.{kebab-name}`)
   - No circular dependencies
   - Required relationships exist

3. **Semantic Validation:**
   - Business services realized by application services
   - API operations reference application services
   - UX screens reference API operations
   - Navigation routes reference UX screens
   - Security resources reference application/data elements

#### FR-005: Projection

**Requirement:** The tool SHALL support automatic projection of elements across layers based on rules.

**Acceptance Criteria:**

- Applies projection rules from `projection-rules.yaml`
- Creates derived elements in target layers
- Maintains relationships between projected elements
- Supports template-based projection
- Allows custom projection logic
- Validates projected elements

**Commands:**

```bash
dr project <element-id> --to <layer>[,...] [options]
  --rule <rule-name>          # Use specific projection rule
  --dry-run                   # Show what would be created
  --force                     # Overwrite existing elements

dr project-all [options]      # Project all unprojected elements
  --layer <layer>             # Only project from specific layer
  --to <layer>                # Only project to specific layer
```

**Projection Rules Structure:**

```yaml
# projection-rules.yaml
projections:
  - name: "business-to-application"
    from: business.service
    to: application.service
    rules:
      - create_type: ApplicationService
        name_template: "{source.name}Service"
        properties:
          realizes: "{source.id}"
          documentation: "Realizes {source.name}"

  - name: "application-to-api"
    from: application.service
    to: api.specification
    rules:
      - create_file: "specs/openapi/{source.name.kebab}-api.yaml"
        template: "templates/openapi-service.yaml"
        operations:
          - operationId: "get{source.name.pascal}"
          - operationId: "create{source.name.pascal}"
          - operationId: "update{source.name.pascal}"
          - operationId: "delete{source.name.pascal}"
```

#### FR-006: Export

**Requirement:** The tool SHALL export the model to various standard formats.

**Acceptance Criteria:**

- Exports to ArchiMate XML
- Exports to OpenAPI 3.0 YAML
- Exports to JSON Schema
- Exports to PlantUML diagrams
- Exports to Markdown documentation
- Exports to GraphML (for visualization)
- Exports to custom formats via plugins

**Commands:**

```bash
dr export [options]
  --format <format>           # archimate, openapi, schema, plantuml, markdown, graphml, all
  --layer <layer>             # Export specific layer
  --output <path>             # Output directory (default: specs/)
  --filter <element-type>     # Export only specific element types

# Format-specific exports
dr export archimate --output specs/archimate/
dr export openapi --layer api --output specs/openapi/
dr export schema --layer data --output specs/schemas/
dr export plantuml --output docs/diagrams/
dr export markdown --output docs/
```

**Export Formats:**

1. **ArchiMate XML** - Full model export compatible with ArchiMate tools
2. **OpenAPI 3.0** - API specifications from API layer
3. **JSON Schema** - Data schemas from Data Model layer
4. **PlantUML** - UML diagrams (class, component, sequence)
5. **Markdown** - Documentation with cross-references
6. **GraphML** - Graph structure for visualization tools

#### FR-007: Code Generation

**Requirement:** The tool SHALL support code generation from model specifications.

**Acceptance Criteria:**

- Generates TypeScript/JavaScript code from API specs
- Generates Python code from API specs
- Generates database migrations from Data Store layer
- Generates React components from UX layer
- Generates navigation routes from Navigation layer
- Generates middleware from Security layer
- Supports custom code generation templates
- Generates tests from specifications

**Commands:**

```bash
dr generate <target> [options]
  --language <lang>           # typescript, javascript, python, java, etc.
  --framework <framework>     # react, vue, angular, express, fastapi, etc.
  --output <path>             # Output directory
  --template <template>       # Custom template
  --dry-run                   # Show what would be generated

# Specific generators
dr generate api-client --language typescript --output src/api/
dr generate database-migration --output migrations/
dr generate ui-components --framework react --output src/components/
dr generate routes --output src/routes/
dr generate middleware --output src/middleware/
dr generate tests --output tests/
```

**Generation Targets:**

1. **API Client** - Type-safe API clients from OpenAPI specs
2. **Database Schema** - DDL scripts and migrations
3. **UI Components** - Component scaffolding from UX specs
4. **Navigation** - Route definitions and guards
5. **Security Middleware** - Authentication and authorization code
6. **Tests** - Unit and integration tests
7. **Documentation** - API documentation, architecture docs

#### FR-008: Diff and Merge

**Requirement:** The tool SHALL support comparing models and merging changes.

**Acceptance Criteria:**

- Compares two model versions
- Shows added, modified, and deleted elements
- Supports structural and semantic diffs
- Merges changes from different sources
- Resolves conflicts interactively
- Generates change reports

**Commands:**

```bash
dr diff <source> <target> [options]
  --layer <layer>             # Compare specific layer
  --output <format>           # text, json, html
  --ignore <pattern>          # Ignore certain changes
  --semantic                  # Semantic diff (ignore formatting)

dr merge <source> [options]
  --strategy <strategy>       # ours, theirs, interactive
  --dry-run                   # Show merge result
  --no-commit                 # Don't update files
```

**Examples:**

```bash
# Compare current model with previous version
dr diff HEAD~1 HEAD

# Compare specific layers
dr diff model-v1/ model-v2/ --layer business

# Merge changes
dr merge feature-branch --strategy interactive
```

#### FR-009: Reporting

**Requirement:** The tool SHALL generate reports and analytics about the model.

**Acceptance Criteria:**

- Generates coverage reports (which layers are populated)
- Generates dependency reports
- Generates complexity metrics
- Generates traceability matrices
- Generates compliance reports
- Exports reports in multiple formats

**Commands:**

```bash
dr report <report-type> [options]
  --output <file>             # Output file
  --format <format>           # html, pdf, markdown, json

# Report types
dr report coverage            # Layer coverage report
dr report dependencies        # Dependency analysis
dr report traceability        # Traceability matrix
dr report complexity          # Complexity metrics
dr report compliance          # Compliance checklist
dr report stats               # Model statistics
```

**Report Contents:**

1. **Coverage Report:**
   - Elements per layer
   - Completeness percentage
   - Missing projections
   - Orphaned elements

2. **Dependency Report:**
   - Cross-layer dependencies
   - Dependency graph
   - Circular dependencies
   - Impact analysis

3. **Traceability Matrix:**
   - Stakeholder � Goal � Requirement � Implementation
   - Business Service � Application � API � UX
   - Threat � Assessment � Requirement � Control

4. **Complexity Metrics:**
   - Elements per layer
   - Relationship counts
   - Cyclomatic complexity
   - Coupling metrics

#### FR-010: Interactive Mode

**Requirement:** The tool SHALL provide an interactive REPL mode for exploratory work.

**Acceptance Criteria:**

- Starts interactive shell with autocomplete
- Supports all CLI commands
- Provides context-aware suggestions
- Shows inline help
- Maintains session history
- Supports scripting

**Commands:**

```bash
dr interactive                # Start interactive mode
dr repl                       # Alias for interactive

# Within interactive mode:
> find business.service.customer-management
> validate --layer business
> add application service --name CustomerService
> project business.service.customer-management --to application
> exit
```

### 2.2 Configuration Requirements

#### FR-011: Configuration Management

**Requirement:** The tool SHALL support flexible configuration.

**Configuration File:** `dr.config.yaml`

```yaml
# dr.config.yaml
version: "1.0.0"

# Model paths
paths:
  model: "./model" # Model directory
  specs: "./specs" # Specs output directory
  templates: "./.dr/templates" # Template directory
  schemas: "./.dr/schemas" # Schema directory

# Default behaviors
defaults:
  output_format: "yaml" # Default output format
  validation_mode: "standard" # standard, strict
  auto_project: true # Auto-project on add
  backup_before_update: true # Backup before destructive operations

# Layer configuration
layers:
  motivation:
    enabled: true
    schema: ".dr/schemas/01-motivation-layer.schema.json"
    file_pattern: "*.yaml"
  business:
    enabled: true
    schema: ".dr/schemas/02-business-layer.schema.json"
    file_pattern: "*.yaml"
  security:
    enabled: true
    schema: ".dr/schemas/03-security-layer.schema.json"
    file_pattern: "*.yaml"
  # ... other layers

# Validation rules
validation:
  strict_naming: true # Enforce naming conventions
  require_documentation: false # Require documentation field
  check_cross_refs: true # Validate cross-references
  fail_on_warning: false # Treat warnings as errors

# Projection configuration
projection:
  auto_project: true # Auto-project on element creation
  rules_file: "./projection-rules.yaml"

# Export configuration
export:
  archimate:
    version: "3.2"
    format: "xml"
  openapi:
    version: "3.0.0"
    format: "yaml"

# Code generation
generation:
  typescript:
    target: "es2020"
    module: "esnext"
  python:
    version: "3.9"

# Plugins
plugins:
  enabled: [] # List of enabled plugins

# Logging
logging:
  level: "info" # debug, info, warning, error
  file: ".dr/logs/dr.log" # Log file location
```

**Commands:**

```bash
dr config get <key>             # Get configuration value
dr config set <key> <value>     # Set configuration value
dr config list                  # List all configuration
dr config validate              # Validate configuration file
```

### 2.3 Claude Code Integration Requirements

#### FR-012: Claude Code Compatibility

**Requirement:** The tool SHALL be easily usable by Claude Code.

**Acceptance Criteria:**

- All commands have clear, parseable output
- JSON output mode for programmatic consumption
- Exit codes indicate success/failure
- Error messages are actionable
- Supports batch operations
- No interactive prompts in non-interactive mode

**Claude Code Usage Patterns:**

1. **Direct File Manipulation:**

```python
# Claude Code can directly read/write files
import yaml
from pathlib import Path

# Read business services
services = yaml.safe_load(Path("model/business/services.yaml").read_text())

# Add new service
services["CustomerManagement"] = {
    "id": "business.service.customer-management",
    "name": "Customer Management",
    "description": "Manages customer lifecycle"
}

# Write back
Path("model/business/services.yaml").write_text(yaml.dump(services))
```

2. **Using CLI for Validation:**

```bash
# Claude Code runs validation after making changes
dr validate --strict --output json
```

3. **Hybrid Approach:**

```python
# Claude reads model
model = load_model("model/")

# Claude analyzes and designs
new_service = design_service(model)

# Claude uses CLI to add with validation
subprocess.run([
    "dr", "add", "business", "service",
    "--name", new_service['name'],
    "--spec", "-"
], input=yaml.dump(new_service), text=True)

# Claude validates
result = subprocess.run(["dr", "validate", "--strict"], capture_output=True)
```

#### FR-013: Documentation Discovery

**Requirement:** The tool SHALL provide comprehensive self-documentation for Claude Code.

**Documentation Structure:**

```
.dr/
   README.md                    # Quick reference
   INSTRUCTIONS.md              # Detailed instructions for Claude Code
   META-SCHEMA.md              # Complete metadata model specification
   CONVENTIONS.md              # Naming and structure conventions
   schemas/                    # JSON Schema definitions
      01-motivation-layer.schema.json
      02-business-layer.schema.json
      ...
   examples/                   # Complete examples
      add-business-service.yaml
      add-api-operation.yaml
      complete-capability.yaml
      ...
   templates/                  # Code generation templates
       openapi-service.yaml
       react-component.tsx
       ...
```

**Commands:**

```bash
dr docs                         # Show documentation index
dr docs <topic>                 # Show specific topic
dr examples                     # List examples
dr examples <example>           # Show specific example
dr schema <layer>               # Show layer schema
```

### 2.4 Error Handling Requirements

#### FR-014: Error Handling

**Requirement:** The tool SHALL provide clear, actionable error messages.

**Error Categories:**

1. **Validation Errors:**

```yaml
Error: Validation failed for element 'business.service.customer-management'
  Location: model/business/services.yaml:15
  Issue: Missing required property 'description'
  Fix: Add description property to the element
```

2. **Cross-Reference Errors:**

```yaml
Error: Invalid cross-reference
  Element: application.service.customer-service
  Property: realizes
  Reference: business.service.customer-mgmt
  Issue: Referenced element does not exist
  Did you mean: business.service.customer-management?
```

3. **Projection Errors:**

```yaml
Error: Projection failed
  Source: business.service.customer-management
  Target Layer: application
  Issue: Projection template 'ApplicationService' not found
  Fix: Check projection-rules.yaml for correct template name
```

4. **Schema Errors:**

```yaml
Error: Schema validation failed
  File: specs/openapi/customer-api.yaml
  Schema: OpenAPI 3.0
  Line: 42
  Issue: Invalid operation definition - missing 'responses' field
  Fix: Add 'responses' field to operation 'createCustomer'
```

**Exit Codes:**

- `0` - Success
- `1` - Validation error
- `2` - Schema error
- `3` - Cross-reference error
- `4` - File I/O error
- `5` - Configuration error
- `10` - Unknown error

## 3. Non-Functional Requirements

### 3.1 Performance

#### NFR-001: Response Time

- Command execution SHALL complete within 2 seconds for models up to 1000 elements
- Validation SHALL complete within 5 seconds for models up to 1000 elements
- Export SHALL complete within 10 seconds for full model

#### NFR-002: Scalability

- SHALL support models with up to 10,000 elements
- SHALL support up to 100,000 cross-layer references
- Memory usage SHALL not exceed 500MB for typical models

### 3.2 Usability

#### NFR-003: User Experience

- All commands SHALL have clear help text
- Error messages SHALL be actionable
- Output SHALL be human-readable by default
- JSON output SHALL be available for all commands
- Tab completion SHALL be available for shells (bash, zsh, fish)

#### NFR-004: Documentation

- All commands SHALL have man pages
- All features SHALL have examples
- All schemas SHALL have inline documentation
- Quick start guide SHALL be available

### 3.3 Reliability

#### NFR-005: Data Integrity

- All destructive operations SHALL create backups
- All file operations SHALL be atomic
- All validations SHALL be performed before writes
- Recovery SHALL be possible from backups

#### NFR-006: Robustness

- SHALL handle malformed YAML/JSON gracefully
- SHALL handle missing files gracefully
- SHALL handle circular dependencies
- SHALL handle concurrent access

### 3.4 Maintainability

#### NFR-007: Code Quality

- Code coverage SHALL be >80%
- All public APIs SHALL have documentation
- All modules SHALL have unit tests
- All integration points SHALL have integration tests

#### NFR-008: Extensibility

- SHALL support plugins via extension points
- SHALL support custom validators
- SHALL support custom generators
- SHALL support custom projection rules

### 3.5 Portability

#### NFR-009: Platform Support

- SHALL run on Linux, macOS, and Windows
- SHALL support Python 3.9+
- SHALL support Node.js 16+ (if implemented in Node)
- SHALL be installable via pip/npm/brew

#### NFR-010: Integration

- SHALL integrate with Git workflows
- SHALL integrate with CI/CD pipelines
- SHALL integrate with IDEs (VS Code, IntelliJ)
- SHALL integrate with ArchiMate tools

## 4. Data Model Requirements

### 4.1 File Structure

```
project/
   .dr/                          # Tool configuration and documentation
      README.md
      INSTRUCTIONS.md
      META-SCHEMA.md
      CONVENTIONS.md
      schemas/                  # JSON Schema definitions
      examples/                 # Example elements
      templates/                # Code generation templates
      logs/                     # Tool logs

   model/                        # The canonical model
      manifest.yaml             # Model metadata & layer registry
   
      01_motivation/            # Layer 01: Motivation
         stakeholders.yaml
         drivers.yaml
         assessments.yaml
         goals.yaml
         outcomes.yaml
         principles.yaml
         requirements.yaml
         constraints.yaml
   
      02_business/              # Layer 02: Business
         actors.yaml
         roles.yaml
         collaborations.yaml
         interfaces.yaml
         processes.yaml
         functions.yaml
         interactions.yaml
         events.yaml
         services.yaml
         objects.yaml
         contracts.yaml
         representations.yaml
         products.yaml
   
      03_security/              # Layer 03: Security
         authentication.yaml
         actors.yaml
         roles.yaml
         permissions.yaml
         resources.yaml
         information-entities.yaml
         delegations.yaml
         security-constraints.yaml
         policies.yaml
         data-classification.yaml
         social-dependencies.yaml
         accountability.yaml
         threats.yaml
   
      04_application/           # Layer 04: Application
         components.yaml
         collaborations.yaml
         interfaces.yaml
         functions.yaml
         interactions.yaml
         events.yaml
         services.yaml
         processes.yaml
         data-objects.yaml
   
      05_technology/            # Layer 05: Technology
         nodes.yaml
         devices.yaml
         system-software.yaml
         technology-collaborations.yaml
         technology-interfaces.yaml
         paths.yaml
         communication-networks.yaml
         technology-functions.yaml
         technology-processes.yaml
         technology-interactions.yaml
         technology-events.yaml
         technology-services.yaml
         artifacts.yaml
   
      06_api/                   # Layer 06: API
         operations.yaml       # References to OpenAPI files
         endpoints.yaml
   
      07_data_model/            # Layer 07: Data Model
         entities.yaml         # References to JSON Schema files
         relationships.yaml
   
      08_datastore/             # Layer 08: Data Store
         databases.yaml
         tables.yaml
         columns.yaml
         constraints.yaml
         indexes.yaml
         views.yaml
         triggers.yaml
   
      09_ux/                    # Layer 09: UX
         screens.yaml
         states.yaml
         layouts.yaml
         components.yaml
   
      10_navigation/            # Layer 10: Navigation
         routes.yaml
         guards.yaml
         transitions.yaml
         menus.yaml
   
      11_apm/                   # Layer 11: APM/Observability
          traces.yaml
          logs.yaml
          metrics.yaml

   specs/                        # Generated/exported specifications
      archimate/
         model.archimate       # ArchiMate XML export
      openapi/
         customer-api.yaml
         product-api.yaml
      schemas/
         customer.schema.json
         product.schema.json
      ux/
         customer-list.ux.yaml
         customer-edit.ux.yaml
      navigation/
         navigation.yaml
      security/
         security-model.yaml
      apm/
          apm-config.yaml

   projection-rules.yaml         # Rules for cross-layer projection
   dr.config.yaml               # Configuration for dr tool
   .gitignore                   # Git ignore rules
```

### 4.2 Manifest File

**File:** `model/manifest.yaml`

```yaml
# Model manifest
version: "1.0.0"
schema: "documentation-robotics-v1"
created: "2025-01-22T10:00:00Z"
updated: "2025-01-22T15:30:00Z"

# Project metadata
project:
  name: "Product Management System"
  description: "E-commerce product management platform"
  version: "1.0.0"

# Documentation
documentation: ".dr/README.md"

# Layer registry
layers:
  motivation:
    order: 1
    name: "Motivation"
    path: "model/01_motivation/"
    schema: ".dr/schemas/01-motivation-layer.schema.json"
    enabled: true
    elements:
      stakeholders: 5
      drivers: 3
      assessments: 4
      goals: 8
      outcomes: 6
      principles: 4
      requirements: 12
      constraints: 7

  business:
    order: 2
    name: "Business"
    path: "model/02_business/"
    schema: ".dr/schemas/02-business-layer.schema.json"
    enabled: true
    elements:
      actors: 6
      roles: 8
      processes: 10
      services: 5
      objects: 12
      products: 3

  security:
    order: 3
    name: "Security"
    path: "model/03_security/"
    schema: ".dr/schemas/03-security-layer.schema.json"
    enabled: true
    elements:
      roles: 4
      permissions: 15
      resources: 8
      policies: 6

  # ... other layers

# Cross-references summary
cross_references:
  total: 87
  by_type:
    realization: 15
    serving: 12
    access: 18
    flow: 22
    association: 20

# Statistics
statistics:
  total_elements: 145
  total_relationships: 87
  completeness: 0.73 # 73% complete
  last_validation: "2025-01-22T15:30:00Z"
  validation_status: "passed"

# Naming conventions
conventions:
  id_format: "{layer}.{type}.{kebab-case-name}"
  file_naming:
    api: "{service-name}-api.yaml"
    schema: "{entity-name}.schema.json"
    ux: "{screen-name}.ux.yaml"
```

## 5. Command Reference Summary

### 5.1 Model Management

| Command     | Description               | Example                                                        |
| ----------- | ------------------------- | -------------------------------------------------------------- |
| `dr init`   | Initialize new model      | `dr init my-project`                                           |
| `dr add`    | Add element to layer      | `dr add business service --name "Customer Mgmt"`               |
| `dr update` | Update element            | `dr update business.service.customer-mgmt --set status=active` |
| `dr remove` | Remove element            | `dr remove business.service.customer-mgmt --cascade`           |
| `dr import` | Import elements from file | `dr import business --file services.yaml`                      |
| `dr export` | Export layer to file      | `dr export business --file backup.yaml`                        |

### 5.2 Querying

| Command     | Description            | Example                                                    |
| ----------- | ---------------------- | ---------------------------------------------------------- |
| `dr find`   | Find element by ID     | `dr find business.service.customer-mgmt`                   |
| `dr search` | Search elements        | `dr search --type service --name "Customer*"`              |
| `dr list`   | List elements in layer | `dr list business service`                                 |
| `dr trace`  | Trace dependencies     | `dr trace business.service.customer-mgmt --direction both` |

### 5.3 Validation

| Command       | Description                 | Example                     |
| ------------- | --------------------------- | --------------------------- |
| `dr validate` | Validate model              | `dr validate --strict`      |
| `dr check`    | Alias for strict validation | `dr check --layer business` |

### 5.4 Projection

| Command          | Description               | Example                                              |
| ---------------- | ------------------------- | ---------------------------------------------------- |
| `dr project`     | Project element to layers | `dr project business.service.x --to application,api` |
| `dr project-all` | Project all elements      | `dr project-all --from business --to application`    |

### 5.5 Export & Generation

| Command       | Description                | Example                                        |
| ------------- | -------------------------- | ---------------------------------------------- |
| `dr export`   | Export to standard formats | `dr export --format archimate`                 |
| `dr generate` | Generate code              | `dr generate api-client --language typescript` |

### 5.6 Reporting

| Command     | Description           | Example              |
| ----------- | --------------------- | -------------------- |
| `dr report` | Generate reports      | `dr report coverage` |
| `dr stats`  | Show model statistics | `dr stats`           |

### 5.7 Utility

| Command          | Description          | Example                                |
| ---------------- | -------------------- | -------------------------------------- |
| `dr config`      | Manage configuration | `dr config set validation.strict true` |
| `dr docs`        | Show documentation   | `dr docs business-layer`               |
| `dr examples`    | Show examples        | `dr examples add-business-service`     |
| `dr schema`      | Show layer schema    | `dr schema business`                   |
| `dr interactive` | Start REPL           | `dr interactive`                       |
| `dr diff`        | Compare models       | `dr diff v1/ v2/`                      |
| `dr merge`       | Merge models         | `dr merge feature-branch`              |
| `dr version`     | Show version         | `dr version`                           |
| `dr help`        | Show help            | `dr help add`                          |

## 6. Implementation Priorities

### Phase 1: Core Functionality (MVP)

1.  Model initialization (`init`)
2.  Element management (`add`, `update`, `remove`)
3.  Query and search (`find`, `search`, `list`)
4.  Basic validation (`validate`)
5.  Manifest management

### Phase 2: Validation & Integrity

1.  Schema validation for all layers
2.  Cross-reference validation
3.  Semantic validation
4.  Projection support (`project`)
5.  Dependency tracing (`trace`)

### Phase 3: Export & Integration

1.  ArchiMate export
2.  OpenAPI export
3.  JSON Schema export
4.  PlantUML export
5.  Markdown documentation

### Phase 4: Code Generation

1.  API client generation
2.  Database migration generation
3.  UI component generation
4.  Test generation

### Phase 5: Advanced Features

1.  Interactive mode (`interactive`)
2.  Diff and merge (`diff`, `merge`)
3.  Reporting (`report`)
4.  Plugin system

## 7. Testing Requirements

### 7.1 Unit Tests

- All command handlers SHALL have unit tests
- All validators SHALL have unit tests
- All generators SHALL have unit tests
- Code coverage SHALL be >80%

### 7.2 Integration Tests

- All CLI commands SHALL have integration tests
- All export formats SHALL have integration tests
- All projection scenarios SHALL have integration tests

### 7.3 End-to-End Tests

- Complete workflow scenarios SHALL be tested
- Claude Code integration SHALL be tested
- Multi-layer operations SHALL be tested

### 7.4 Performance Tests

- Large model handling SHALL be tested
- Memory usage SHALL be monitored
- Command execution time SHALL be measured

## 8. Documentation Requirements

### 8.1 User Documentation

- Quick start guide
- Command reference (man pages)
- Tutorial with examples
- Best practices guide
- Troubleshooting guide

### 8.2 Developer Documentation

- Architecture overview
- API reference
- Plugin development guide
- Contribution guidelines
- Testing guide

### 8.3 Schema Documentation

- Layer schema specifications
- Element definitions
- Relationship types
- Validation rules
- Examples for each entity type

## 9. Acceptance Criteria

The `dr` CLI tool is considered complete when:

1.  All Phase 1-3 features are implemented
2.  All commands have comprehensive help text
3.  All 11 layers are supported with validation
4.  Cross-layer references are validated
5.  Export to ArchiMate, OpenAPI, JSON Schema works
6.  Code coverage is >80%
7.  Integration tests pass
8.  Documentation is complete
9.  Claude Code can successfully use the tool
10.  A complete example project can be created and validated

## 10. Success Metrics

- **Usability:** Claude Code can perform 90% of tasks without errors
- **Performance:** Commands complete within target response times
- **Reliability:** Zero data loss in destructive operations
- **Quality:** <5% bug rate in production use
- **Adoption:** Used in at least 3 real projects within 6 months
