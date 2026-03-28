# Scanning Architecture Overview

This document provides a comprehensive overview of the scanning system and how it fits into the DR CLI architecture.

## Quick Navigation

- **[ADR-003: Pattern Files](../../docs/adr/ADR-003-pattern-files-cli-asset.md)** — Pattern files are CLI-maintained assets with optional project-specific extensions
- **[ADR-004: AST Parser Selection](../../docs/adr/ADR-004-ast-parser-selection.md)** — Why CodePrism was chosen over alternatives (tree-sitter, Babel, etc.)
- **[ADR-005: Language Support](../../docs/adr/ADR-005-language-support-management.md)** — How language support is managed through the pattern system

## System Overview

The scanning system extracts architectural elements and relationships from source code using:

```
dr scan command
    ↓
Pattern Loader (built-in + project patterns)
    ↓
MCP Client (connects to CodePrism)
    ↓
CodePrism Server (external, performs AST analysis)
    ↓
Pattern Matching (maps results to DR elements)
    ↓
Element/Relationship Candidates
    ↓
Staged Changeset (for review before committing)
```

### Key Design Principles

1. **Patterns are CLI-maintained assets** — Built-in patterns for popular frameworks ship with the CLI
2. **CodePrism provides semantic analysis** — Multi-language AST parsing and framework-aware analysis
3. **Users extend, don't replace** — Project patterns extend built-in patterns for custom frameworks
4. **Out-of-the-box usability** — No pattern configuration needed for common stacks
5. **Graceful degradation** — Scan succeeds even if some languages are unsupported

## Pattern System

### What Are Patterns?

Patterns are YAML files that define:
- **What to search for** — Regex/semantic patterns in code
- **What to produce** — DR layer node types or relationships
- **How to map results** — Template-based ID and attribute generation

Example pattern:
```yaml
layer: api
framework: express
version: "1.0"
patterns:
  - id: express.route.handler
    produces:
      type: node
      layer: api
      elementType: endpoint
    query:
      tool: search_code
      params:
        pattern: "(app|router)\\.(get|post|put|delete)\\(['\"]([^'\"]+)['\"]"
        language: javascript
    confidence: 0.9
    mapping:
      id: "api.endpoint.{match.path|kebab}"
      name: "{match.path}"
```

### Pattern Organization

#### Built-in Patterns (CLI-maintained)
Located in `cli/src/scan/patterns/{layer}/` and shipped with the CLI:

```
cli/src/scan/patterns/
├── api/
│   ├── express.yaml
│   ├── nestjs.yaml
│   ├── django.yaml
│   ├── spring-boot.yaml
│   └── fastapi.yaml
├── application/
│   ├── java-classes.yaml
│   └── python-classes.yaml
├── data-model/
├── security/
├── testing/
└── ... (one per layer)
```

#### Project Patterns (User-optional)
Located in `documentation-robotics/patterns/{layer}/` within a project:

Create a `documentation-robotics/patterns/api/custom.yaml` file to extend patterns for custom frameworks. These patterns are merged with built-in patterns during scan.

### How Patterns Load

The `PatternLoader` follows this strategy:

1. **Load built-in patterns** from `cli/src/scan/patterns/`
2. **Load project patterns** from `documentation-robotics/patterns/`
3. **Merge both sets** (project patterns can override built-in by framework/pattern ID)
4. **Filter by confidence** (remove patterns below threshold)
5. **Return merged set** to scan command

```typescript
const builtinPatterns = await loadBuiltinPatterns();
const projectPatterns = await loadProjectPatterns(projectRoot);
const merged = mergePatterns(builtinPatterns, projectPatterns);
const filtered = filterByConfidence(merged, confidenceThreshold);
```

## CodePrism Integration

### AST Parser Selection

[See ADR-004](../../docs/adr/ADR-004-ast-parser-selection.md) for detailed rationale.

**Why CodePrism?**
- Multi-language support (JavaScript, Python, Java, Go, C#, etc.)
- Semantic analysis (scopes, types, dependencies, cross-file references)
- Framework-aware (understands decorators, annotations, routing patterns)
- Standard MCP interface for cross-language consistency
- No embedded dependencies or user project modifications needed

**Alternatives considered:**
- **tree-sitter** — Fast but no semantic analysis, language-specific bindings
- **Babel** — JavaScript-only, not multi-language
- **Acorn** — JavaScript-only, minimal semantic analysis
- **Custom** — Too much engineering effort, maintenance burden

### MCP Connection

The CLI connects to CodePrism via MCP (Model Context Protocol):

```typescript
import { createMcpClient } from "../scan/mcp-client.js";

const client = createMcpClient({
  command: "codeprism",
  args: ["--mcp"],
  timeout: 5000
});

await client.connect();
const results = await client.callTool("search_code", {
  pattern: "(app|router)\\.get\\(",
  language: "javascript"
});
await client.disconnect();
```

### CodePrism Tools Used

Patterns invoke CodePrism tools via the MCP interface:

- **search_code** — Find code matching patterns (regex/semantic)
- **analyze_code** — Semantic analysis (scopes, types, dependencies)
- **list_symbols** — List all symbols of a type
- **get_symbol_info** — Get detailed information about a symbol

## Language Support

### Supported Languages

[See ADR-005](../../docs/adr/ADR-005-language-support-management.md) for detailed information.

#### Tier 1: Fully Supported (Out-of-Box)
- JavaScript/TypeScript (Express, NestJS, Fastify)
- Python (Django, FastAPI, Flask)
- Java (Spring Boot, Jakarta EE)

#### Tier 2: Community Patterns
- Go, C#, Ruby, PHP, Rust

#### Tier 3: Extensible
- Any language CodePrism can parse via custom project patterns

### Adding Language Support

**For CLI maintainers:**
1. Create pattern file: `cli/src/scan/patterns/{layer}/{framework}.yaml`
2. Verify CodePrism supports the language
3. Test patterns against real codebases
4. Submit as PR

**For users (custom languages):**
1. Create pattern file: `documentation-robotics/patterns/{layer}/custom.yaml`
2. Write patterns for your framework
3. Run `dr scan` — patterns automatically discovered

## Configuration

Users configure scanning via `~/.dr-config.yaml`:

```yaml
scan:
  codeprism:
    command: codeprism
    args: ["--mcp"]
    timeout: 5000
  confidence_threshold: 0.7
  disabled_patterns:
    - legacy-framework
    - internal-only
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `codeprism.command` | string | `codeprism` | Path to CodePrism MCP server executable |
| `codeprism.args` | string[] | `["--mcp"]` | Arguments passed to CodePrism |
| `codeprism.timeout` | number | `5000` | Timeout (ms) for CodePrism connections |
| `confidence_threshold` | number | `0.7` | Minimum confidence for pattern matches (0-1) |
| `disabled_patterns` | string[] | `[]` | Framework names to exclude from scanning |

## Scan Command Usage

### Basic Usage

```bash
# Scan entire codebase with built-in patterns
dr scan

# Validate configuration without connecting to CodePrism
dr scan --config

# Dry-run: print candidates without creating changeset
dr scan --dry-run

# Scan specific layer only
dr scan --layer api

# Show detailed scanning output
dr scan --verbose
```

### What Happens During Scan

1. **Load patterns** — Merge built-in and project patterns
2. **Validate configuration** — Check CodePrism config validity
3. **Connect to CodePrism** — Establish MCP connection
4. **Execute patterns** — For each pattern:
   - Query CodePrism for matches
   - Map results to DR elements/relationships
   - Calculate confidence score
   - Filter by threshold
5. **Create candidates** — Generate element/relationship candidates
6. **Stage changeset** — Create staged changeset for review
7. **Show results** — Display candidates and diff

### Example Output

```
Scanning codebase for architecture elements...

Loading patterns...
  ✓ Built-in patterns: 24 patterns (7 layers)
  ✓ Project patterns: 3 patterns (1 layer)
  ✓ Merged: 27 patterns

Validating CodePrism connection...
  ✓ Connected to CodePrism

Scanning...
  api:     12 endpoints discovered
  application: 8 services discovered
  data-model: 6 entities discovered
  api: 15 endpoint relationships

Generated 41 element candidates and 15 relationship candidates

Created staged changeset: dr-scan-20260328T154532Z
Review changes with: dr changeset show dr-scan-20260328T154532Z
```

## Pattern Development

### Pattern File Structure

```yaml
# Metadata
layer: api                 # Target DR layer
framework: express         # Framework identifier
version: "1.0"            # Pattern version (semver)

patterns:
  - id: pattern.identifier # Unique pattern ID
    produces:              # What the pattern produces
      type: node           # or "relationship"
      layer: api
      elementType: endpoint
      # For relationships only:
      # relationshipType: calls
    query:                # CodePrism query specification
      tool: search_code
      params:
        pattern: "regex pattern"
        language: javascript
        # Additional CodePrism-specific params
    confidence: 0.85      # Confidence score (0-1)
    mapping:              # Template-based mapping
      id: "api.endpoint.{match.path|kebab}"
      name: "{match.path}"
      description: "HTTP {match.method} {match.path}"
      # For relationships:
      # source: "api.endpoint.{match.source}"
      # target: "api.endpoint.{match.target}"
      # type: "calls"
```

### Template Syntax

Mappings support:
- `{match.property}` — Access match properties (e.g., `{match.method}`)
- `{match.property|kebab}` — Transform to kebab-case
- `{match.property|upper}` — Transform to uppercase
- `{match.property|lower}` — Transform to lowercase

Example:
```yaml
mapping:
  id: "api.endpoint.{match.method|lower}-{match.path|kebab}"
  name: "{match.method|upper} {match.path}"
```

### Testing Patterns

Validate patterns before committing:

```bash
# Check pattern syntax
dr scan --config

# Test with verbose output
dr scan --verbose --dry-run

# Focus on specific layer
dr scan --layer api --dry-run
```

## Troubleshooting

### CodePrism Connection Issues

**Error: "Failed to connect to CodePrism"**

1. Check CodePrism is installed: `which codeprism`
2. Verify config: `dr scan --config`
3. Check CodePrism version: `codeprism --version`
4. Test MCP connection: `dr scan --verbose`

### Pattern Matching Issues

**No candidates found for known patterns**

1. Check confidence threshold: `--verbose` shows which patterns were filtered
2. Verify pattern regex: Test patterns against actual code
3. Check language matches source files
4. Try lower confidence threshold in config

### Performance Issues

**Scanning is slow**

1. Run with specific layer: `dr scan --layer api`
2. Disable unnecessary patterns: Use `disabled_patterns` in config
3. Check CodePrism performance: Run `dr scan --verbose`
4. Consider code size: Very large codebases may take time

## Related Documentation

- [Scanning with `dr scan`](./commands.md#dr-scan) — Command-line reference
- [Creating Architecture Changesets](./CHANGESETS.md) — How changesets work
- [Pattern File Reference](./PATTERN_REFERENCE.md) — Detailed pattern syntax
- [ADR-003: Pattern Files](../../docs/adr/ADR-003-pattern-files-cli-asset.md) — Architectural decision
- [ADR-004: AST Parser](../../docs/adr/ADR-004-ast-parser-selection.md) — Parser selection rationale
- [ADR-005: Language Support](../../docs/adr/ADR-005-language-support-management.md) — Language coverage strategy
