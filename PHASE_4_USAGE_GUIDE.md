# Phase 4: Enhanced Markdown Export - Usage Guide

## Quick Start

### Export to Enhanced Markdown
```bash
dr export --format enhanced-markdown --output architecture.md
```

### View Output
```bash
cat architecture.md
```

### Pipe to Browser/Markdown Viewer
```bash
dr export --format enhanced-markdown | less
```

## Features

### 1. Architecture Overview Diagram
Automatically generates a Mermaid diagram showing:
- All layers in your architecture
- Number of elements per layer
- Dependencies between layers

Example output:
```
graph TD
  motivation["Motivation<br/>(5 elements)"]
  business["Business<br/>(3 elements)"]
  application["Application<br/>(4 elements)"]
  motivation --> business
  business --> application
```

### 2. Layer Summary Table
Quick overview of each layer:

| Layer | Elements | Relationships | Description |
|-------|----------|----------------|-------------|
| Motivation | 5 | 0 | Goals, requirements, drivers... |
| Business | 3 | 2 | Business processes, functions... |
| Application | 4 | 3 | Application components, services... |

### 3. Element Details Tables
For each element, shows:
- Element ID
- Name
- Type
- Description
- Properties (in a formatted table)
- Incoming/outgoing relationships

### 4. Architecture Statistics
Summary metrics:
- Total elements
- Total relationships
- Number of layers with content
- Element type diversity

### 5. Relationships Summary
Top relationship types by count:

| Relationship Type | Count |
|-------------------|-------|
| realized-by | 4 |
| satisfied-by | 3 |
| exposes | 2 |

## CLI Options

### Basic Usage
```bash
dr export --format enhanced-markdown --output output.md
```

### Output to Stdout
```bash
dr export --format enhanced-markdown
```

### Export Specific Layers
```bash
dr export --format enhanced-markdown --output api-docs.md --layers motivation,business,api
```

### Include Source References
```bash
dr export --format enhanced-markdown --output arch-with-sources.md --includeSources
```

## Programmatic Usage

### Basic Example
```typescript
import { EnhancedMarkdownExporter } from "@documentation-robotics/cli";

const exporter = new EnhancedMarkdownExporter();
const markdown = await exporter.export(model);
console.log(markdown);
```

### Advanced Example with Options
```typescript
import { MarkdownGenerator } from "@documentation-robotics/cli";

const generator = new MarkdownGenerator(model, {
  includeMermaid: true,
  includeTables: true,
  maxTableRows: 25,
  diagramType: "graph",
  includeSourceReferences: true,
});

const markdown = await generator.generate();
```

## Configuration Options

### MarkdownGenerator Options

```typescript
interface MarkdownGeneratorOptions {
  includeMermaid?: boolean;        // Enable Mermaid diagrams (default: true)
  includeTables?: boolean;         // Enable formatted tables (default: true)
  tableFormat?: "markdown" | "html"; // Table style (default: "markdown")
  maxTableRows?: number;           // Rows per table (default: 50)
  diagramType?: "graph" | "flowchart" | "sequence"; // Diagram type (default: "graph")
  includeSourceReferences?: boolean; // Include source references (default: false)
}
```

## Output Structure

The generated markdown follows this structure:

```
# [Model Name]
[Description]

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Layer Summary](#layer-summary)
- [Detailed Layer Documentation](#detailed-layer-documentation)

## Architecture Overview
[Mermaid diagram]

### Model Information
[Metadata table]

## Layer Summary
[Layer summary table]

## Detailed Layer Documentation
### [Layer Name]
[Layer description]
[Layer diagram]
[Elements table]
#### Element Details
[Element details with properties and relationships]

## Architecture Statistics
[Statistics table]

## Relationships Summary
[Relationship types table]
```

## Examples

### Example 1: Simple API Documentation
```bash
dr export --format enhanced-markdown --output API.md --layers motivation,business,api,data-model
```

Generated documentation will include:
- Architecture overview showing how layers connect
- API endpoints with methods and paths
- Data models used by API
- Business capabilities driving the API

### Example 2: Full System Architecture
```bash
dr export --format enhanced-markdown --output SystemArchitecture.md
```

Generated documentation includes all layers with complete relationships and properties.

### Example 3: Technology Deep Dive
```bash
dr export --format enhanced-markdown --output TechStack.md --layers technology,application,api
```

Generated documentation focuses on technology layer, applications, and how they interact via APIs.

## Integration with Documentation Tools

### Markdown to HTML
```bash
pandoc architecture.md -o architecture.html
```

### Markdown to PDF
```bash
pandoc architecture.md -o architecture.pdf
```

### Markdown Viewer
```bash
# View in VS Code
code architecture.md

# View with built-in viewer
open architecture.md  # macOS
xdg-open architecture.md  # Linux
```

## Tips and Best Practices

### 1. Use Meaningful Element Names
Better element names result in clearer documentation:
```
✓ api.endpoint.customer-create-order
✗ api.endpoint.endpoint1
```

### 2. Include Descriptions
Descriptions enhance the generated documentation:
```typescript
const element = new Element({
  id: "application.service.order-service",
  name: "Order Service",
  description: "Handles all order-related operations including creation, modification, and retrieval",
  properties: { framework: "Spring Boot" }
});
```

### 3. Organize Layers Logically
Follow the layer hierarchy for cleaner diagrams:
- Motivation → Business → Application → API → Data Model

### 4. Use Custom Diagrams
For specific diagram types:
```typescript
const generator = new MarkdownGenerator(model, {
  diagramType: "flowchart" // Better for sequential flows
});
```

### 5. Control Table Size
For large models, adjust maxTableRows:
```typescript
const generator = new MarkdownGenerator(model, {
  maxTableRows: 25 // Smaller tables for easier reading
});
```

## Troubleshooting

### Special Characters in Output
If special characters appear escaped in markdown:
- This is expected for markdown compatibility
- They will render correctly in markdown viewers

### Large Model Performance
For models with 1000+ elements:
- Consider exporting specific layers
- Use smaller maxTableRows values
- Diagram generation may take a few seconds

### Mermaid Rendering Issues
If diagrams don't render:
- Ensure your markdown viewer supports Mermaid
- GitHub, GitLab, and VS Code support Mermaid by default
- Some markdown tools require plugins

## Getting Help

For more information:
- Check the main CLI documentation: `dr --help`
- View export format options: `dr export --help`
- See example models: check `examples/` directory

---

Generated by Phase 4: Enhanced Markdown Export Feature
