# Example Prompts for Building Models from Existing Codebases

This guide provides example prompts to use with Claude Code to extract and model an existing codebase using the Documentation Robotics CLI tool. These prompts follow a bottom-up, layer-by-layer approach to building a comprehensive 11-layer architecture model.

## Initial Setup

### Prompt 1: Initialize the Model

```
Initialize a new dr model for the CLI tool itself in a directory called 'dr-cli-model'. Name it "Documentation Robotics CLI" and give it a description about modeling the CLI tool's architecture.
```

## Bottom-Up Layer Building

### Prompt 2: Technology Layer (Infrastructure)

```
Analyze the CLI codebase at cli/ and help me add Technology Layer elements to the dr model. Look at:
- pyproject.toml for dependencies (Python runtime, key libraries like click, pydantic, networkx)
- Development tools (pytest, coverage)
- Infrastructure components (filesystem storage, JSON processing)
Create technology nodes for the major platforms and infrastructure components.
```

### Prompt 3: Data Store Layer

```
Examine the CLI's data storage approach (the .dr/ directory structure in core/model.py and related files) and help me model:
- The manifest.json storage
- Layer JSON file storage pattern
- File system organization
Add these as data store elements with appropriate schemas.
```

### Prompt 4: Data Model Layer (Core Domain)

```
Analyze the core domain model in cli/src/documentation_robotics/core/ and help me create Data Model elements for:
- Element (element.py)
- Layer (layer.py)
- Model (model.py)
- Manifest (manifest.py)
- Reference types and their properties
Extract the key attributes and relationships for each entity.
```

### Prompt 5: Application Layer (Components & Services)

```
Examine the CLI architecture and help me model Application Layer components:
- Core services (ModelManager, ReferenceRegistry, DependencyTracker, ProjectionEngine)
- Validator services (SchemaValidator, NamingValidator, ReferenceValidator, SemanticValidator)
- Export services (ExportManager and individual exporters)
- Utility services (IdGenerator, FileIO, Output)
Show how these components relate to each other.
```

### Prompt 6: API Layer (CLI Commands)

```
Analyze all command files in cli/src/documentation_robotics/commands/ and help me model each CLI command as an API endpoint:
- init, add, update, remove, list, search, find, validate, trace, project, export
For each command, capture:
- Input parameters (arguments and options)
- Return types
- Description of what it does
Map these to the API layer with proper OpenAPI-style definitions.
```

### Prompt 7: UX Layer (CLI Interface)

```
Examine the CLI interface structure (cli.py and command implementations) and help me model:
- Command groups and their organization
- Input/output patterns (JSON, table, tree formats)
- Error message patterns
- User interaction flows
Create UX elements that represent the command-line interface components.
```

### Prompt 8: Navigation Layer (Command Routing)

```
Analyze how commands are routed and organized in cli.py and help me model:
- Main entry points
- Command routing structure
- Subcommand hierarchy
- How users navigate between different operations
```

### Prompt 9: Business Layer (Workflows)

```
Based on the CLI documentation and command implementations, help me identify and model key business workflows:
- Model initialization workflow
- Element management workflow (CRUD operations)
- Validation workflow
- Export workflow
- Dependency analysis workflow
Create business process elements that represent these workflows.
```

### Prompt 10: Motivation Layer (Goals & Requirements)

```
Review the CLI documentation in cli/README.md and cli/docs/ to help me model:
- Key goals (e.g., "Enable architecture model management", "Ensure cross-layer consistency")
- Requirements derived from the phase documentation
- Stakeholders (developers, architects, documentation teams)
Create motivation elements that capture the why behind the CLI.
```

### Prompt 11: Security Layer

```
Examine the codebase for any security considerations and help me model:
- File system access controls
- Input validation patterns
- Any security-related constraints or policies
(This might be minimal for a CLI tool, but worth checking)
```

### Prompt 12: APM Layer (Observability)

```
Look for logging, error handling, and monitoring patterns in the CLI codebase and help me model:
- Error handling approach
- Logging patterns (if any)
- Validation reporting
- Export progress tracking
```

## Cross-Layer Analysis

### Prompt 13: Build Cross-Layer References

```
Now help me connect the layers by adding cross-layer references:
- Link Application components to Technology infrastructure
- Link API commands to Application services they use
- Link Business workflows to API commands they invoke
- Link UX elements to API commands
- Link Data Model entities to Data Store schemas
Use the dr update command to add these relationships.
```

### Prompt 14: Validate the Model

```
Run dr validate on the complete model and help me fix any validation errors:
- Missing required fields
- Invalid cross-layer references
- Naming convention violations
- Semantic validation issues
```

### Prompt 15: Analyze Dependencies

```
Use dr trace and dr project commands to analyze:
- How changes to core domain entities would impact upper layers
- Dependencies between different application components
- Which business workflows depend on which technical components
Show me the dependency graph and identify any architectural issues.
```

## Export and Documentation

### Prompt 16: Export the Model

```
Help me export the complete CLI model in multiple formats:
- Export to Markdown for documentation
- Export to PlantUML to visualize the architecture
- Export to GraphML to see the dependency graph
- Export to OpenAPI for the API layer
- Export to JSON Schema for the data model
Review the exports and suggest any improvements to the model.
```

### Prompt 17: Generate Architecture Documentation

```
Based on the exported model, help me create comprehensive architecture documentation that:
- Shows the layered architecture
- Explains key components and their responsibilities
- Documents the dependency flows
- Highlights architectural patterns used
```

## Iterative Refinement

### Prompt 18: Identify Gaps

```
Review the complete model and help me identify:
- Missing elements that should be documented
- Weak or missing cross-layer relationships
- Areas where more detail would be valuable
- Potential architectural improvements
```

## Usage Tips

1. **Start from the Bottom** - Begin with Technology and Data layers, then work up to Application and Business layers
2. **Build Incrementally** - Don't try to model everything at once; focus on one layer at a time
3. **Validate Often** - Run `dr validate` after adding elements to each layer
4. **Use Search** - Use `dr search` to find existing elements before creating new ones
5. **Reference Up** - Remember that higher layers reference lower layers, not the other way around
6. **Export Early** - Export to visualization formats (PlantUML, GraphML) early to see the structure
7. **Iterate** - The model will evolve as you understand the codebase better

## Customizing for Your Codebase

These prompts use the CLI tool itself as an example. To adapt them for your codebase:

1. Replace references to `cli/` with your codebase path
2. Adjust layer focus based on your architecture (e.g., web apps have strong UX/Navigation, libraries focus on API/Data Model)
3. Modify technology stack references to match your dependencies
4. Adapt the business workflows to match your domain
5. Scale the detail level based on codebase size and complexity

## Common Patterns by Project Type

### Web Application
- Strong focus on UX, Navigation, API, and Application layers
- Security layer is critical
- APM layer for production monitoring

### Library/SDK
- Focus on API, Data Model, and Application layers
- Technology layer for runtime dependencies
- Minimal UX/Navigation layers

### CLI Tool
- API layer represents commands
- UX layer represents CLI interface
- Navigation layer represents command routing

### Microservice
- Application layer for service components
- API layer for REST/gRPC endpoints
- Technology layer for containerization/deployment
- Strong APM layer for observability

## Next Steps

After building your initial model:

1. Use `dr trace` to understand element dependencies
2. Use `dr project` to analyze impact of changes
3. Export to multiple formats for different audiences
4. Keep the model updated as the codebase evolves
5. Use the model to onboard new team members
6. Generate architecture documentation automatically
