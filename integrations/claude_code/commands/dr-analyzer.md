---
description: Discover, install, index, and query code analyzers. Supports graph-based analysis of your codebase with dual-root awareness (metadata root may differ from source code root).
argument-hint: "[discover|status|index|endpoints|services|datastores|callers|callees|query|verify] [options]"
---

# Code Analyzer Management

Discover, install, and manage code analyzers that scan your codebase and build a code graph for verification and querying. These commands respect the configured codebase root, allowing metadata (model) and source code to reside in separate directories.

## Overview

Analyzers are optional but powerful: they enable verification of your architecture model against actual code, detection of missing or drifted elements, and deep code querying. The DR CLI currently supports **Codebase Memory** (CBM), a graph-based analyzer.

## Key Concept: Dual-Root Architecture

Your Documentation Robotics project has two roots:

- **Model Root**: Where your `documentation-robotics/` directory lives (contains manifest, changesets, layers)
- **Codebase Root**: Where your actual source code is located

These can be the **same directory** (typical case) or **different directories** (useful for monorepos, federated architectures, or farms).

### Resolution Priority

When you run analyzer commands, the codebase root is resolved in this order:

1. **Explicit CLI option** (if added in the future)
2. **`manifest.codebase_path`** — Relative path from model root (configured in `documentation-robotics/model/manifest.yaml`)
3. **Farm auto-resolution** — If your model is inside a farm, resolved from farm configuration
4. **Default** — Uses the model root itself

**Example Resolution:**

```
Model root:    /workspace/documentation-robotics/
Codebase root: /workspace/  (source code lives here)

Configure in manifest.yaml:
  codebase_path: ../

Or configure via farm (auto-detected if model is in a farm)
```

### Important: Re-indexing After Update

If you have a pre-existing CBM project entry that was indexed under the old (incorrect) model root, you need to re-index after enabling the dual-root configuration:

```bash
# After configuring codebase_path in manifest.yaml:
dr analyzer index --force
```

This ensures the analyzer indexes the correct codebase root.

---

## Commands

### discover — Discover and Select Analyzer

Scan for installed analyzers and select the one to use for your project.

```bash
dr analyzer discover [--json] [--reselect]
```

**Options:**

- `--json` — Output discovery results as JSON (includes installed count, available analyzers, selected analyzer)
- `--reselect` — Force re-selection even if an analyzer is already selected

**Output:**

- Interactive mode: Prompts to select from installed analyzers
- JSON mode: Returns list of discovered analyzers with installation status
- Result: Saves selection to `.dr/analyzers/session.json` (project root)

**Examples:**

```bash
# Interactive discovery and selection
dr analyzer discover

# Non-interactive discovery (auto-selects first installed)
dr analyzer discover --json

# Force re-selection
dr analyzer discover --reselect
```

---

### status — Check Analyzer Status

Report on analyzer detection and project index state.

```bash
dr analyzer status [--name <analyzer>] [--json]
```

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active analyzer from session)
- `--json` — Output status as JSON

**Status Fields:**

- `detected.installed` — Whether analyzer is installed
- `detected.binary_path` — Path to analyzer binary (if installed)
- `detected.version` — Analyzer version
- `detected.mcp_registered` — Whether analyzer is registered as an MCP server
- `detected.contract_ok` — Whether contract validation passed
- `indexed` — Whether project has been indexed
- `fresh` — Whether index is current (not stale)
- `last_indexed` — Timestamp of last indexing

**Important:** Status respects the dual-root configuration — it checks the codebase root for index status, not the model root.

**Examples:**

```bash
# Check active analyzer
dr analyzer status

# Check specific analyzer
dr analyzer status --name cbm

# JSON output
dr analyzer status --json
```

---

### index — Index Project with Analyzer

Build the code graph by scanning the codebase. Respects the configured codebase root.

```bash
dr analyzer index [--name <analyzer>] [--force]
```

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active analyzer from session)
- `--force` — Force re-indexing even if index is current

**Output:**

- Indexing progress
- Node count (code entities discovered)
- Edge count (relationships discovered)
- Git HEAD (commit hash of indexed code)

**Codebase Root Resolution:**

When indexing, the analyzer:
1. Locates your model root
2. Resolves the codebase root using the priority order (see "Dual-Root Architecture")
3. Scans the codebase root for code
4. Stores index metadata in `.dr/analyzers/` at the model root

**Important for Dual-Root Users:**

If you recently configured `manifest.codebase_path`, re-index with `--force`:

```bash
# After updating manifest.codebase_path
dr analyzer index --force
```

**Examples:**

```bash
# Index with active analyzer
dr analyzer index

# Force re-index
dr analyzer index --force

# Index with specific analyzer
dr analyzer index --name cbm
```

---

### endpoints — List Discovered API Endpoints

Query the indexed code graph for discovered API endpoints.

```bash
dr analyzer endpoints [--name <analyzer>] [--json]
```

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active)
- `--json` — Output as JSON

**Output Columns:**

- Method (HTTP verb)
- Path (URL route)
- Name (suggested element name)
- ID Fragment (suggested element ID suffix)
- Symbol (source code symbol)
- Confidence (high/medium/low)
- File (source file path)

**Examples:**

```bash
# List endpoints
dr analyzer endpoints

# JSON output
dr analyzer endpoints --json

# Specific analyzer
dr analyzer endpoints --name cbm
```

---

### services — Query for Services/Components

Discover application services and components from the indexed code.

```bash
dr analyzer services [--name <analyzer>] [--layer <layer>] [--json]
```

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active)
- `--layer <layer>` — Filter by suggested layer (e.g., application)
- `--json` — Output as JSON

**Output Columns:**

- Name
- Layer (suggested layer)
- Type (suggested element type)
- Symbol (source code symbol)
- Confidence (high/medium/low)
- File (source file)

**Examples:**

```bash
# List all services
dr analyzer services

# Filter by layer
dr analyzer services --layer application

# JSON output
dr analyzer services --json
```

---

### datastores — Query for Databases

Discover data stores and databases inferred from code (database libraries, ORMs, migrations).

```bash
dr analyzer datastores [--name <analyzer>] [--json]
```

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active)
- `--json` — Output as JSON

**Output:**

For each datastore:
- Name (inferred)
- Source evidence (files and patterns)
- Notes (if available)

**Examples:**

```bash
# List datastores
dr analyzer datastores

# JSON output
dr analyzer datastores --json
```

---

### callers — Trace Callers of a Symbol

Find all functions or methods that call a specific symbol.

```bash
dr analyzer callers <qualified-name> [--name <analyzer>] [--depth <n>] [--json]
```

**Arguments:**

- `<qualified-name>` — Fully-qualified name of the target symbol (e.g., `com.example.Service.handleRequest`)

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active)
- `--depth <n>` — Maximum traversal depth (default: 3, max: 10)
- `--json` — Output as JSON

**Output:**

For each caller:
- Qualified name
- Source file
- Source symbol
- Depth (distance in call graph)
- Edge type (direct call, inheritance, etc.)

**Examples:**

```bash
# Find callers of a method
dr analyzer callers com.example.Service.handleRequest

# Deeper traversal
dr analyzer callers com.example.Service.handleRequest --depth 5

# JSON output
dr analyzer callers com.example.Service.handleRequest --json
```

---

### callees — Trace Callees of a Symbol

Find all functions or methods called by a specific symbol.

```bash
dr analyzer callees <qualified-name> [--name <analyzer>] [--depth <n>] [--json]
```

**Arguments:**

- `<qualified-name>` — Fully-qualified name of the target symbol

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active)
- `--depth <n>` — Maximum traversal depth (default: 3, max: 10)
- `--json` — Output as JSON

**Output:**

For each callee:
- Qualified name
- Source file
- Source symbol
- Depth (distance in call graph)
- Edge type (direct call, inheritance, etc.)

**Examples:**

```bash
# Find methods called by a handler
dr analyzer callees com.example.Service.handleRequest

# Deeper traversal
dr analyzer callees com.example.Service.handleRequest --depth 5
```

---

### query — Execute Raw Graph Query

Advanced: Execute a raw query (Cypher) against the analyzer's graph. Use when standard commands don't meet your needs.

```bash
dr analyzer query "<cypher>" [--name <analyzer>]
```

**Arguments:**

- `<cypher>` — Cypher query string (note: backend-specific, currently supports Cypher for graph analyzers)

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active)

**Output:**

Always JSON format. Query results depend on the query itself.

**Warning:**

This is an advanced escape hatch. Query syntax and result format depend on the analyzer backend. Use standard commands when possible.

**Examples:**

```bash
# Find all services
dr analyzer query "MATCH (n:Service) RETURN n.name"

# Count nodes
dr analyzer query "MATCH (n) RETURN count(n)"

# Find nodes with specific property
dr analyzer query "MATCH (n) WHERE n.name CONTAINS 'order' RETURN n"
```

---

### verify — Verify Model Against Code Graph

Cross-reference your model against discovered code routes. Reports matched, graph-only (suspected gaps), and model-only (possible drift) entries.

```bash
dr analyzer verify [--name <analyzer>] [--layer <layer>...] [--format <format>] [--output <path>]
```

**Options:**

- `--name <analyzer>` — Specific analyzer name (default: active)
- `--layer <layer>` — Layer(s) to verify (default: api; v1 only supports api)
- `--format <format>` — Output format: text (default), json, markdown
- `--output <path>` — Write report to file (format inferred from extension)

**Output Buckets:**

- **Matched**: Graph routes that exist in model ✓
- **Graph-Only**: Code routes not in model (suspected gaps) ⚠
- **Model-Only**: Model operations not in code (possible drift) ?

**Report Fields:**

- Summary counts (matched, gaps, drift, ignored)
- Changeset context (which version verified)
- Detailed buckets with source information

**Examples:**

```bash
# Verify to console
dr analyzer verify

# JSON output
dr analyzer verify --json

# Save markdown report
dr analyzer verify --output verify.md

# Save JSON report
dr analyzer verify --output verify.json
```

For detailed verification workflow and reconciliation options, see `/dr-verify` command reference.

---

## Configuration

### Setting the Codebase Root

**Option 1: Via manifest.yaml** (recommended for persistent configuration)

```yaml
# documentation-robotics/model/manifest.yaml
version: 0.1.0
schema: documentation-robotics-v1
...
codebase_path: ../  # Relative to model root
```

Then re-index:

```bash
dr analyzer index --force
```

**Option 2: Via Farm Configuration** (if model is in a farm)

Farm auto-resolves the codebase root. See your farm's configuration for details.

---

## Troubleshooting

### Problem: "Project not indexed"

**Solution:**
```bash
dr analyzer index
```

### Problem: "No analyzer selected"

**Solution:**
```bash
dr analyzer discover
# Then select an analyzer
```

### Problem: "Analyzer not installed"

**Solution:**

1. Run `dr analyzer discover` to see installation instructions
2. Follow the links to install the analyzer for your platform
3. Run `dr analyzer index` to index your codebase

### Problem: Index is Stale

**Solution:**
```bash
dr analyzer index --force
```

### Problem: Dual-Root Configuration Not Recognized

After updating `manifest.codebase_path`, analyzer commands may still read from the old root. Re-index:

```bash
dr analyzer index --force
```

The analyzer cache must be rebuilt at the correct codebase root.

---

## Related Commands

- `/dr-verify` — Interactive verification workflow against indexed code
- `/dr-map` — Extract architecture model from codebase (consumes analyzer pre-briefs)
- `/dr-validate` — Validate model integrity
- `dr show <element-id>` — Inspect element details
- `dr add <layer> <type> <name>` — Manually add elements

---

## Advanced: Integration with Claude Code

When running DR commands in Claude Code, the analyzer integration enables:

1. **Pre-briefs**: `/dr-map` consumes analyzer results to accelerate extraction
2. **Verification**: `/dr-verify` cross-references model against code
3. **Querying**: Direct code graph access via `dr analyzer query`
4. **Codebase Memory**: Shared cache of analyzer results across commands

Dual-root awareness ensures all these operations work correctly whether metadata and source are co-located or separate.
