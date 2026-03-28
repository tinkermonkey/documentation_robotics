# ADR-003: Pattern Files as CLI-Maintained Assets

**Status**: Accepted

**Date**: 2026-03-28

---

## Context

The `dr scan` command enables automated discovery of architectural elements and relationships by scanning source code using CodePrism through an MCP (Model Context Protocol) client. The command relies on pattern definitions that map CodePrism AST query results to Documentation Robotics layer node types and relationships.

The key architectural question: **Who maintains pattern files, and what role do they play in the CLI?**

Previous assumptions treated patterns as a user-facing prerequisite, but this created friction:
- Patterns are complex YAML definitions requiring deep knowledge of CodePrism query syntax, DR layer structure, and template systems
- Framework patterns (Express, NestJS, Spring Boot, etc.) benefit from community maintenance
- Users should not need to write or understand pattern files to use `dr scan`

## Decision

**Pattern files are CLI-maintained assets with an optional per-project extension point.**

### Two-Tier Pattern System

1. **Built-in Patterns** (CLI-maintained, required)
   - Framework-specific patterns for popular technologies (Express, NestJS, Spring Boot, Django, etc.)
   - Shipped as part of the CLI distribution
   - Located in `cli/src/scan/patterns/{layer}/`
   - Automatically discovered and loaded by the pattern loader
   - Maintained through CLI releases
   - Designed to work out-of-the-box with zero user configuration

2. **Project-Specific Patterns** (User-optional, extends built-in)
   - Located in `documentation-robotics/patterns/{layer}/` within a project
   - Created only when users need to extend built-in patterns for custom frameworks
   - Merged with and can override built-in patterns during pattern loading
   - Completely optional — projects work fine with only built-in patterns
   - Typically created by domain experts within an organization

### Rationale for This Approach

- **Lower Barrier to Entry**: Users can run `dr scan` immediately with built-in patterns
- **Community Maintenance**: Framework patterns benefit from centralized CLI maintenance and updates
- **Extensibility**: Power users can customize scanning behavior for proprietary frameworks
- **Separation of Concerns**: CLI maintains technical pattern implementation; users focus on architectural decisions
- **Versioning**: Built-in patterns evolve with CLI versions, project patterns are isolated and stable

## Implementation

### Built-in Pattern Organization

Built-in patterns are organized by layer, with pattern files for specific frameworks and technologies:

```
cli/src/scan/patterns/
├── api/
│   ├── express.yaml         # Express.js framework
│   └── nestjs.yaml          # NestJS framework
├── application/
│   └── nestjs-service.yaml  # NestJS service pattern
├── data-model/
│   ├── prisma.yaml          # Prisma ORM
│   └── typeorm.yaml         # TypeORM
├── data-store/
│   └── prisma-schema.yaml   # Prisma schema parsing
├── security/
│   └── passport.yaml        # Passport.js authentication
├── apm/
│   └── opentelemetry.yaml   # OpenTelemetry instrumentation
├── ux/
│   └── react.yaml           # React UI components
└── testing/
    ├── jest.yaml            # Jest test framework
    └── pytest.yaml          # pytest framework
```

This structure reflects the current set of built-in patterns. New patterns can be added by creating new framework files in the appropriate layer directories.

### Pattern Loader Behavior

The pattern loader (`cli/src/scan/pattern-loader.ts`) follows this strategy:

1. Load built-in patterns from `cli/src/scan/patterns/`
2. Check for project patterns in `documentation-robotics/patterns/`
3. Merge both sets (project patterns override built-in by framework/pattern ID)
4. Filter merged patterns by confidence threshold
5. Return combined pattern set to scan command

### Pattern File Format

Pattern files are YAML documents defining:

```yaml
layer: api                    # Target DR layer
framework: express            # Framework identifier
version: "1.0"                # Pattern version
patterns:
  - id: express.route.handler # Unique pattern ID
    produces:                 # What the pattern produces
      type: node
      layer: api
      elementType: endpoint
    query:                    # CodePrism MCP query specification
      tool: search_code
      params:
        pattern: "..."
        language: javascript
    confidence: 0.9           # Confidence score
    mapping:                  # Template-based mapping
      id: "api.endpoint.{match.path|kebab}"
      name: "{match.path}"
```

See [CodePrism AST Parser Selection](./ADR-004-ast-parser-selection.md) for more on query structure and [Language Support Management](./ADR-005-language-support-management.md) for language-specific details.

### User Configuration

Users configure scan behavior via `~/.dr-config.yaml`, not by modifying patterns:

```yaml
scan:
  codeprism:
    command: codeprism          # Path to CodePrism MCP server
    args: ["--mcp"]
    timeout: 5000
  confidence_threshold: 0.7     # Filter patterns by minimum confidence
  disabled_patterns:            # Disable specific framework patterns
    - legacy-framework
```

## Consequences

### Positive

- Users can immediately use `dr scan` for popular frameworks without setup
- Built-in patterns scale with CLI community improvements
- Clear separation: CLI is responsible for pattern maintenance, users focus on architecture
- Project patterns can be version-controlled alongside the model
- New framework support requires only adding a new pattern file, no CLI code changes

### Negative

- Users with custom or proprietary frameworks need to write pattern files
- Pattern syntax requires understanding CodePrism query language (see ADR-004 for why CodePrism was chosen)
- Built-in patterns may not capture all frameworks or edge cases
- Pattern coverage varies by layer and framework

### Mitigation

- Extensive documentation on pattern file format and CodePrism query syntax
- Interactive pattern validation in `dr scan --config` to check syntax before connecting to MCP server
- Community examples and templates for common scenarios
- Clear guidance on when and how to extend with project-specific patterns
- Optional OpenAI-assisted pattern generation for custom frameworks (future enhancement)

## Related

- [ADR-004: AST Parser Selection (CodePrism)](./ADR-004-ast-parser-selection.md) — Why CodePrism was chosen as the AST analysis engine
- [ADR-005: Language Support Management](./ADR-005-language-support-management.md) — How CodePrism manages language support and limitations
- `cli/src/scan/pattern-loader.ts` — Pattern loading implementation
- `cli/src/scan/patterns/` — Built-in pattern definitions
- `cli/src/commands/scan.ts` — Scan command implementation
