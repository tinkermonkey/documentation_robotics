# ADR-004: AST Parser Selection (CodePrism)

**Status**: Accepted

**Date**: 2026-03-28

---

## Context

The `dr scan` command needs to analyze source code and extract architectural elements and relationships to populate the DR model. To do this effectively across multiple programming languages and frameworks, it requires:

1. **Cross-language AST parsing capability** — Must parse Java, JavaScript/TypeScript, Python, Go, C#, etc.
2. **Framework-aware pattern matching** — Must recognize framework-specific conventions (decorators, annotations, routing patterns)
3. **Accessible analysis engine** — Must work without modifying user projects or requiring build-time instrumentation
4. **Extensible query system** — Must support adding new code analysis patterns for custom frameworks

The key architectural question: **Which AST parser should drive the scanning system, and why?**

## Decision

**Use CodePrism as the AST analysis engine via MCP (Model Context Protocol).**

CodePrism is a multi-language code analysis engine that:

- Parses multiple languages (JavaScript, TypeScript, Python, Go, Java, C#, Rust, and more)
- Performs semantic analysis across code (scopes, types, dependencies)
- Provides a standard MCP interface for querying AST results
- Handles framework-specific patterns through semantic code understanding
- Operates as an external MCP server, not embedded in the CLI

### Comparison with Alternatives

#### tree-sitter

- **Strengths**: Fast incremental parsing, mature ecosystem, language-agnostic
- **Weaknesses**:
  - Requires language-specific binding installation (native modules)
  - No semantic analysis (scopes, types, cross-file references)
  - Requires maintaining per-language tree-sitter grammars and query patterns
  - Query language learning curve for each language separately
  - Not framework-aware (can't distinguish Express routes from other function calls)
- **Verdict**: Insufficient for framework-level semantic analysis

#### Babel

- **Strengths**: De facto standard for JavaScript/TypeScript, excellent AST quality, extensive plugin ecosystem
- **Weaknesses**:
  - JavaScript/TypeScript only (doesn't support Java, Python, Go, etc.)
  - Embedded in JavaScript tooling, not accessible from CLI without Node.js subprocess
  - Pattern matching requires custom JavaScript code for each pattern
  - Not suitable as cross-language solution
- **Verdict**: Too language-specific

#### Acorn

- **Strengths**: Lightweight JavaScript parser, minimal dependencies
- **Weaknesses**:
  - JavaScript only
  - No semantic analysis capabilities
  - Similar limitations to tree-sitter for our use case
- **Verdict**: JavaScript-only, insufficient for multi-language scanning

#### Custom AST Implementation

- **Approach**: Build or integrate multiple language-specific parsers
- **Weaknesses**:
  - Massive engineering effort (months of work for reasonable language coverage)
  - Maintenance burden for parser updates, grammar changes, edge cases
  - Duplicate effort already solved by established tools
  - Difficult to achieve semantic analysis across languages
- **Verdict**: Not practical given project scope

#### CodePrism (Selected)

- **Strengths**:
  - Native multi-language support (10+ languages)
  - Semantic analysis: scopes, types, dependencies, cross-file references
  - Framework-aware: Can understand decorator patterns, annotations, routing conventions
  - Standard MCP interface: Consistent query language across all supported languages
  - Claude-powered: Leverages LLM semantic understanding for complex patterns
  - No embedded dependencies: Works as external MCP server
  - No user project modifications needed: Reads existing source code as-is
  - Active development and maintenance
- **Weaknesses**:
  - Requires external MCP server (CodePrism must be installed separately)
  - Query results depend on CodePrism's semantic understanding (not deterministic)
  - Limited to frameworks/patterns that CodePrism has seen before
  - Potential latency for large codebases (MCP round-trip time)

## Implementation

### Architecture Overview

```
dr scan command
     ↓
Pattern Loader (loads YAML definitions)
     ↓
MCP Client (connects to CodePrism server)
     ↓
CodePrism Server (external, MCP protocol)
     ↓
Source Code Analysis
     ↓
AST Results → Pattern Matching → Element Candidates
```

### Query Specification in Patterns

Pattern files specify CodePrism queries using a standard format:

```yaml
patterns:
  - id: express.route.handler
    query:
      tool: search_code # CodePrism MCP tool name
      params:
        pattern: "app\\.get\\(.*\\)" # Regex or semantic pattern
        language: javascript # Target language
        # Additional CodePrism-specific params (context, scope, etc.)
```

### Key Features Used from CodePrism

1. **search_code** — Find code matching regex/semantic patterns
2. **analyze_code** — Semantic analysis (scopes, types, dependencies)
3. **language detection** — Automatic language identification
4. **framework detection** — Recognize patterns specific to Express, NestJS, Django, etc.

### MCP Connection

The CLI connects to CodePrism via MCP:

```typescript
import { createMcpClient } from "../scan/mcp-client.js";

const client = createMcpClient(config.codeprism);
await client.connect();
const results = await client.callTool("search_code", params);
```

See `cli/src/scan/mcp-client.ts` for implementation details.

## Consequences

### Positive

- **Multi-language support out-of-the-box**: No need to manage multiple language-specific parsers
- **Framework-aware analysis**: Can understand semantic meaning of code patterns, not just syntax
- **Semantic-level scanning**: Cross-file references, scope analysis, type information
- **Maintainability**: Offload language grammar and semantic analysis maintenance to CodePrism
- **Extensibility**: New patterns can be added without CLI code changes (pattern YAML only)
- **Future-proof**: Benefits from improvements to CodePrism over time
- **No build instrumentation**: Works with unmodified source code

### Negative

- **External dependency**: CodePrism must be installed and running separately
- **Network latency**: MCP communication adds overhead for each pattern query
- **Non-deterministic results**: AI-based semantic analysis may vary slightly between runs
- **Learning curve**: Users must understand CodePrism query syntax to write custom patterns
- **Potential cost**: CodePrism may have usage costs or rate limits (to be determined)
- **Coverage limitations**: Only works for languages/frameworks CodePrism supports

### Mitigation Strategies

1. **Installation**: Package CodePrism installation instructions and automated setup in CLI
2. **Performance**: Cache pattern results, batch multiple queries where possible
3. **Determinism**: Version CodePrism and document any non-determinism in pattern results
4. **Learning**: Comprehensive documentation on pattern syntax and CodePrism queries
5. **Fallback**: Graceful degradation when CodePrism unavailable or patterns don't match
6. **Coverage**: Build comprehensive pattern library for popular frameworks

## Why Not Embed CodePrism Directly?

CodePrism is accessed through the MCP protocol rather than embedding it directly in the CLI because:

- **Decoupling**: CLI doesn't depend on Claude/CodePrism implementation details
- **Flexibility**: Users can use any MCP-compatible code analysis engine
- **Modularity**: CodePrism can be updated independently of CLI releases
- **Separation of concerns**: Analysis engine separate from model management engine

## Integration with Pattern System

This decision is tightly coupled with [ADR-003: Pattern Files as CLI-Maintained Assets](./ADR-003-pattern-files-cli-asset.md):

- **Pattern files** define WHAT to search for (CodePrism queries)
- **CodePrism** executes the analysis (AST parsing, semantic analysis)
- **Pattern mapping** converts results to DR elements (template-based)

The combination allows:

1. Non-developers can manage patterns (just YAML)
2. Developers can extend patterns for custom frameworks
3. Analysis logic stays external (CodePrism)
4. CLI focuses on model management and relationship synthesis

## Related

- [ADR-003: Pattern Files as CLI-Maintained Assets](./ADR-003-pattern-files-cli-asset.md) — How patterns define CodePrism queries
- [ADR-005: Language Support Management](./ADR-005-language-support-management.md) — How CodePrism manages language support
- `cli/src/scan/mcp-client.ts` — MCP client implementation
- `cli/src/scan/pattern-loader.ts` — Pattern loading and CodePrism query specification
- `cli/src/commands/scan.ts` — Scan command orchestration
