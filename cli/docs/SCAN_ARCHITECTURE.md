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
│   └── nestjs.yaml
├── application/
│   └── nestjs-service.yaml
├── apm/
│   └── opentelemetry.yaml
├── data-model/
│   ├── prisma.yaml
│   └── typeorm.yaml
├── data-store/
│   └── prisma-schema.yaml
├── security/
│   └── passport.yaml
├── testing/
│   ├── jest.yaml
│   └── pytest.yaml
└── ux/
    └── react.yaml
```

#### Project Patterns (User-optional)

Located in `documentation-robotics/.scan-patterns/` within a project:

Create a `documentation-robotics/.scan-patterns/api/custom.yaml` file to extend patterns for custom frameworks. These patterns are merged with built-in patterns during scan.

### How Patterns Load

The pattern loading system follows this strategy:

1. **Load built-in patterns** from `cli/src/scan/patterns/`
2. **Load project patterns** from `documentation-robotics/.scan-patterns/`
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

### CodePrism Tools

Patterns invoke CodePrism tools via the MCP interface. Both regex-based and semantic tools are supported:

#### Regex-Based Tools

- **search_code** — Find code matching regex patterns for extracting architectural elements and relationships

#### Semantic Tools

- **analyze_api_surface** — Discover API endpoints, routes, and operations using AST analysis (framework-aware)
- **analyze_decorators** — Identify decorated classes and methods (e.g., @Injectable, @Entity, @UseGuards)
- **find_dependencies** — Map dependency graphs within and across modules/layers
- **search_symbols** — Locate and classify symbols (functions, classes, methods) with type information
- **detect_patterns** — Identify architectural and design patterns in code (MVC, microservices, design patterns)
- **batch_analysis** — Execute multiple independent tool invocations in parallel for performance

#### Batch Analysis Dispatch

Independent patterns (those without `depends_on`) are automatically grouped and dispatched via `batch_analysis` in a single call, improving performance. If `batch_analysis` is unavailable or fails, the scan engine gracefully falls back to sequential per-pattern execution.

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

| Option                 | Type     | Default     | Description                                  |
| ---------------------- | -------- | ----------- | -------------------------------------------- |
| `codeprism.command`    | string   | `codeprism` | Path to CodePrism MCP server executable      |
| `codeprism.args`       | string[] | `["--mcp"]` | Arguments passed to CodePrism                |
| `codeprism.timeout`    | number   | `5000`      | Timeout (ms) for CodePrism connections       |
| `confidence_threshold` | number   | `0.7`       | Minimum confidence for pattern matches (0-1) |
| `disabled_patterns`    | string[] | `[]`        | Framework names to exclude from scanning     |

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
layer: api # Target DR layer
framework: express # Framework identifier
version: "2.0" # Pattern version (semver)

patterns:
  - id: pattern.identifier # Unique pattern ID
    produces: # What the pattern produces
      type: node # or "relationship"
      layer: api
      elementType: endpoint
      # For relationships only:
      # relationshipType: calls
    query: # CodePrism query specification
      tool: analyze_api_surface # Semantic tool or search_code for regex
      params:
        framework: express # For semantic tools
        language: javascript
        # Additional CodePrism-specific params
    confidence: 0.95 # Confidence score (0-1)
    requires_index: false # (Optional) Pattern needs active CodePrism session
    depends_on: [] # (Optional) Array of pattern IDs this depends on
    mapping: # Template-based mapping
      id: "api.endpoint.{match.path|kebab}"
      name: "{match.path}"
      description: "HTTP {match.method} {match.path}"
      # For relationships:
      # source: "api.endpoint.{match.source}"
      # target: "api.endpoint.{match.target}"
```

### New Pattern Fields

#### `requires_index` (boolean, optional, default false)

Indicates that a pattern requires an active CodePrism session with indexed repository data. Semantic patterns that use AST analysis should set this to true.

**Graceful Degradation Behavior:**

- If `requires_index: true` and no active session exists, the pattern is skipped with a warning
- Users are instructed to run `dr scan index` to start a session
- The scan falls back to any co-existing regex patterns with the same produces type

```yaml
patterns:
  - id: nestjs.controller.route
    requires_index: true # Requires session
    query:
      tool: analyze_api_surface
      # ...

  - id: nestjs.controller.route.regex
    requires_index: false # Regex fallback (default)
    query:
      tool: search_code
      # ...
```

#### `depends_on` (array of pattern IDs, optional, default [])

Declares multi-pass pattern dependencies. Patterns listed in `depends_on` must complete before this pattern executes.

**Execution Model:**

- Independent patterns (empty `depends_on`) are batched and dispatched via `batch_analysis` in a single call
- Dependent patterns execute sequentially after their dependencies complete
- Invalid dependencies (referencing non-existent patterns) cause the pattern to be skipped with a warning

```yaml
patterns:
  # Phase 1: Discover services
  - id: nestjs.service.injectable
    requires_index: true
    query:
      tool: analyze_decorators
      # ...

  # Phase 2: Discover service dependencies (depends on services existing)
  - id: nestjs.service.dependency
    requires_index: true
    depends_on: ["nestjs.service.injectable"]
    query:
      tool: find_dependencies
      # ...
```

### Recommended Pattern Strategy

**Tier 1 Frameworks (JavaScript/TypeScript, Python, Java):**

Use semantic patterns with fallbacks for maximum accuracy:

1. Create semantic pattern with `requires_index: true` and high confidence (0.90+)
2. Create parallel regex pattern with `requires_index: false` and moderate confidence (0.60-0.75)
3. Users get best results when session is active; reasonable results when offline

**Example Pattern Pair:**

```yaml
# Semantic (preferred when session active)
- id: express.route.handler
  requires_index: true
  query:
    tool: analyze_api_surface
    params:
      framework: express
  confidence: 0.95

# Regex fallback (used when session inactive)
- id: express.route.handler.regex
  query:
    tool: search_code
    params:
      pattern: "(app|router)\\.(get|post|...)"
  confidence: 0.75
```

**Tier 2-3 Frameworks:**

Use regex patterns only (no semantic tools available):

```yaml
- id: custom.pattern
  query:
    tool: search_code
    params:
      pattern: "..."
  confidence: 0.70
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

## Execution Flow (Semantic Dispatch)

### Pattern Execution Strategy

1. **Pattern Grouping** — Patterns are separated by dependencies:
   - Independent patterns (no `depends_on`) are batched for parallel execution
   - Dependent patterns execute sequentially after their dependencies

2. **Session Management** — Semantic patterns check for active sessions:
   - Patterns with `requires_index: true` require an active CodePrism session
   - If no session exists, these patterns are skipped with a warning
   - Regex fallback patterns continue to execute

3. **Batch Analysis Dispatch** — Independent patterns are sent to CodePrism via `batch_analysis`:
   - All independent patterns dispatched in a single call for efficiency
   - If `batch_analysis` is unavailable, the engine falls back to sequential execution
   - Graceful degradation ensures scans complete even if batch dispatch fails

4. **Result Mapping** — Results are mapped to candidates in pattern order:
   - Each pattern's results are independently mapped
   - Mapping failures are logged as warnings (non-fatal)
   - High confidence results are preserved even if some patterns fail

### Session Management

Semantic patterns require an active CodePrism session:

```bash
# Start indexing the repository
dr scan index

# Check session status
dr scan status

# Stop the session
dr scan stop
```

**When Session is Active:**

- Semantic patterns execute with high confidence (0.90+)
- Batch analysis dispatch used for parallel execution
- Best-in-class results from AST analysis

**When Session is Inactive:**

- Semantic patterns skipped with warnings
- Regex fallback patterns execute (if present)
- Users guided to run `dr scan index` for better results

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

### Session Management Issues

**Error: "Pattern requires active session but no session is active"**

1. Start a session: `dr scan index`
2. Wait for indexing to complete
3. Resume scanning: `dr scan`
4. Check session status: `dr scan status`

**Semantic patterns are being skipped**

If semantic patterns (high confidence) are showing as skipped in verbose output:

1. Verify session is active: `dr scan status`
2. Check session.status is "ready" (not "indexing")
3. If stale, refresh: `dr scan stop` then `dr scan index`

### CodePrism Connection Issues

**Error: "Failed to connect to CodePrism"**

1. Check CodePrism is installed: `which codeprism`
2. Verify config: `dr scan --config`
3. Check CodePrism version: `codeprism --version`
4. Test MCP connection: `dr scan --verbose`

**Error: "batch_analysis failed, falling back to sequential execution"**

This is normal and not an error. The scan will continue with per-pattern execution, but more slowly. To optimize:

1. Ensure CodePrism is running: `codeprism --mcp`
2. Check available system resources (memory, CPU)
3. Try reducing pattern count with `disabled_patterns` in config

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

- [ADR-003: Pattern Files](../../docs/adr/ADR-003-pattern-files-cli-asset.md) — Architectural decision on CLI-maintained patterns
- [ADR-004: AST Parser](../../docs/adr/ADR-004-ast-parser-selection.md) — Why CodePrism was selected as the AST analysis engine
- [ADR-005: Language Support](../../docs/adr/ADR-005-language-support-management.md) — Language support strategy and tiers
