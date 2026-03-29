# ADR-005: Language Support Management via CodePrism

**Status**: Accepted

**Date**: 2026-03-28

---

## Context

The `dr scan` command needs to support analyzing source code in multiple programming languages to extract architectural elements from diverse technology stacks. However, different organizations use different languages:

- Some teams work in JavaScript/TypeScript ecosystems (Node.js, React)
- Others use Java/Spring Boot for backend services
- Python teams use Django, FastAPI, Flask
- Polyglot organizations use all of the above

The key architectural questions:

1. **How many languages should be supported out-of-the-box?**
2. **How should new language support be added?**
3. **What happens when a codebase uses unsupported languages?**
4. **Who maintains language-specific patterns?**

## Decision

**Language support is managed through the pattern system, with CodePrism as the parsing engine.**

### Three-Tier Support Model

#### Tier 1: Fully Supported (Out-of-Box)

Languages with comprehensive built-in patterns covering major frameworks:

- **JavaScript/TypeScript** — Express, NestJS, Fastify, and others
- **Python** — Django, FastAPI, Flask
- **Java** — Spring Boot, Jakarta EE

Built-in patterns for these languages are maintained by the CLI team and shipped with each release.

#### Tier 2: Supported (with community patterns)

Languages that CodePrism can parse but lack comprehensive built-in patterns:

- **Go** — Go standard library, popular frameworks
- **C#** — .NET, ASP.NET Core
- **Rust** — Actix, Rocket, Axum
- **PHP** — Laravel, Symfony

Support is extended through optional community-contributed patterns that users can install or write.

#### Tier 3: Extensible (custom patterns)

Any language CodePrism can parse:

Users can create project-specific patterns to analyze custom languages or proprietary frameworks. This requires:

1. Understanding CodePrism's pattern query syntax
2. Writing YAML pattern definitions
3. Placing them in the project's `documentation-robotics/.scan-patterns/` directory

### Language Detection

CodePrism automatically detects language based on file extension. Pattern definitions specify target language:

```yaml
patterns:
  - id: express.route.handler
    query:
      tool: search_code
      params:
        language: javascript # Target language
```

The scan command:

1. Discovers files in the codebase
2. Groups by language (using file extensions)
3. For each language, loads matching patterns
4. Executes CodePrism queries only for detected languages
5. Skips languages with no matching patterns (no error)

## Implementation

### Pattern Organization by Language

Built-in patterns are organized by layer. Each pattern file targets specific technologies:

```
cli/src/scan/patterns/
├── api/
│   ├── express.yaml         # Express.js framework (JavaScript/TypeScript)
│   └── nestjs.yaml          # NestJS framework (TypeScript)
├── application/
│   └── nestjs-service.yaml  # NestJS service patterns (TypeScript)
├── apm/
│   └── opentelemetry.yaml   # OpenTelemetry instrumentation
├── data-model/
│   ├── prisma.yaml          # Prisma ORM (JavaScript/TypeScript)
│   └── typeorm.yaml         # TypeORM (TypeScript)
├── data-store/
│   └── prisma-schema.yaml   # Prisma schema definitions
├── security/
│   └── passport.yaml        # Passport.js authentication (JavaScript/TypeScript)
├── testing/
│   ├── jest.yaml            # Jest test framework (JavaScript/TypeScript)
│   └── pytest.yaml          # pytest framework (Python)
└── ux/
    └── react.yaml           # React components (JavaScript/TypeScript/JSX)
```

Additional frameworks and patterns can be added by creating new YAML files in the corresponding layer directories.

### Pattern Language Coverage

Each pattern definition declares its language explicitly:

```yaml
layer: api
framework: django
version: "1.0"
patterns:
  - id: django.view.function
    produces:
      type: node
      layer: api
      elementType: endpoint
    query:
      tool: search_code
      params:
        language: python # ← Language specification
        pattern: "@(app|router)\\.route\\("
```

### Supporting New Languages

#### Adding Language Support to CLI (for maintainers)

1. Choose a popular framework in that language
2. Create a pattern file: `cli/src/scan/patterns/{layer}/{framework}.yaml`
3. Verify CodePrism can parse the language
4. Test patterns against real codebases
5. Document in CLI release notes
6. Submit as PR with tests

Example: Adding Ruby support

```yaml
layer: api
framework: rails
version: "1.0"
patterns:
  - id: rails.route.action
    query:
      tool: search_code
      params:
        language: ruby
```

#### Extending Language Support (for users)

1. Create project patterns: `documentation-robotics/.scan-patterns/{layer}/custom.yaml`
2. Write patterns for your framework
3. Commit to version control
4. Run `dr scan` — project patterns are automatically discovered and merged

Example: Supporting a custom language or proprietary framework

```yaml
layer: application
framework: proprietary
version: "1.0"
patterns:
  - id: proprietary.component.definition
    produces:
      type: node
      layer: application
      elementType: component
    query:
      tool: search_code
      params:
        language: go # or any language CodePrism supports
        pattern: "type \\w+Component struct"
```

## CodePrism Language Support Matrix

**Note**: This matrix reflects CodePrism's language parsing capabilities based on available documentation and testing. Since CodePrism is an external dependency maintained outside this project, support levels may change and should be verified with current CodePrism documentation.

CodePrism is designed to support analysis of these languages:

| Language   | Expected Support | Notes                                     |
| ---------- | ---------------- | ----------------------------------------- |
| JavaScript | Full             | Includes JSX, CommonJS, ES modules        |
| TypeScript | Full             | Includes TSX, all TS versions             |
| Python     | Full             | Python 3.x, including async/await         |
| Java       | Full             | Java 8+, including annotations            |
| Go         | Full             | Go 1.x, modules, packages                 |
| C#         | Full             | .NET, .NET Core, async/await              |
| Ruby       | Full             | Ruby 2.5+, including Rails conventions    |
| PHP        | Full             | PHP 5.4+, including Laravel patterns      |
| Rust       | Full             | Rust edition 2015+                        |
| Kotlin     | Full             | Kotlin 1.x                                |
| Swift      | Partial          | Basic parsing, limited semantic analysis  |
| C++        | Partial          | Basic parsing, limited framework patterns |

Languages marked "Partial" can be analyzed with CodePrism but may have limited framework support and less precise pattern matching. For the latest CodePrism language support, check the CodePrism documentation directly.

## Consequences

### Positive

- **Comprehensive out-of-box support** — Most common languages covered without user work
- **Graceful degradation** — Scan succeeds even if some languages are unsupported
- **User extensibility** — Any organization can add support for proprietary languages
- **Decoupled from AST parser** — Adding language support doesn't require CLI code changes
- **Community contribution** — Users can contribute patterns for their languages
- **Language-agnostic patterns** — Same pattern structure works across all languages
- **Future-proof** — As CodePrism adds languages, new patterns can be added without CLI release

### Negative

- **Pattern coverage varies** — Some languages have more comprehensive patterns than others
- **User knowledge required** — Writing custom patterns requires understanding CodePrism syntax
- **Maintenance burden** — CLI team must maintain patterns for supported languages
- **Potential gaps** — Popular frameworks may not have built-in patterns initially
- **CodePrism dependency** — Limited to languages CodePrism can parse

## Maintenance Strategy

### Built-in Pattern Maintenance

1. **Regular Updates** — Patterns updated with each CLI release
2. **Framework Tracking** — Monitor popular frameworks and update patterns
3. **Issue-Driven** — Users report missing patterns via GitHub issues
4. **Community** — Accept pattern contributions from community
5. **Versioning** — Pattern version bumped with CLI version

### Language Support Roadmap (Tentative)

This roadmap represents aspirational goals for future releases. Actual release content may vary based on community contributions, CodePrism capability updates, and project priorities.

| Release | Potential Additions | Notes                                                  |
| ------- | ------------------- | ------------------------------------------------------ |
| v0.2.0+ | Go, Python          | Expanded Java/Spring Boot patterns — subject to change |
| v0.3.0+ | C#/.NET, Ruby       | Django, FastAPI completeness — subject to change       |
| v0.4.0+ | Rust, PHP           | Rails, Laravel frameworks — subject to change          |

**Disclaimer**: This roadmap is not a commitment. Features and timelines are subject to change based on community feedback, CodePrism updates, and project resources.

## Extension Points

### For Power Users

1. **Project patterns** — Override or extend built-in patterns
2. **Custom frameworks** — Add patterns for proprietary technologies
3. **Selective scanning** — Use `--layer` flag to focus on specific layers

### For Future Enhancement

1. **AI-assisted pattern generation** — Auto-generate patterns from code examples
2. **Pattern templates** — Framework detection + auto-generate starter patterns
3. **Pattern testing** — Tools to validate pattern accuracy against codebases
4. **Multi-language patterns** — Patterns that work across related languages

## Relationship to Other ADRs

- [ADR-003: Pattern Files as CLI-Maintained Assets](./ADR-003-pattern-files-cli-asset.md) — Pattern system that enables flexible language support
- [ADR-004: AST Parser Selection (CodePrism)](./ADR-004-ast-parser-selection.md) — CodePrism provides multi-language parsing capability

## Related Files

- `cli/src/scan/pattern-loader.ts` — Pattern loading and language filtering
- `cli/src/scan/mcp-client.ts` — CodePrism MCP connection
- `cli/src/scan/patterns/` — Built-in pattern definitions by layer
- `cli/src/commands/scan.ts` — Scan command implementation
- `~/.dr-config.yaml` — User configuration for CodePrism and scanning behavior
