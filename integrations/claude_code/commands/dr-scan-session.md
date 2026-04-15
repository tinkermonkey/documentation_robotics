---
description: Query the active CodePrism session for semantic code analysis and element verification
argument-hint: "start | status | query <tool> | stop"
---

# CodePrism Session Management

Access the live CodePrism semantic analysis engine to verify architectural elements against source code before proposing them to the model.

## What This Command Does

The session commands provide access to a persistent CodePrism instance that has indexed your repository. Use these tools during element extraction to:

1. **Orientation** — Understand repository structure and patterns before reading code
2. **Element Verification** — Confirm that proposed elements actually exist in the codebase
3. **Dependency Discovery** — Find cross-layer references that elements depend on
4. **Conflict Resolution** — Investigate when CodePrism analysis contradicts your inference

## When to Use (for Extraction Agents)

### Session Lifecycle

**Start of extraction session** (if session not already running):

```bash
dr scan session start
```

**Before analyzing any files**, read the repository orientation:

```bash
dr scan session query repository_stats
dr scan session query detect_patterns
```

**For each proposed element**, verify it exists:

```bash
dr scan session query explain_symbol --params '{"symbol":"MyService","language":"typescript"}'
```

**When wiring cross-layer references**, discover dependencies:

```bash
dr scan session query find_dependencies --params '{"symbol":"OrderService","language":"typescript"}'
```

**When done with extraction** (optional, depending on workflow):

```bash
dr scan session stop
```

### CodePrism Query Pattern (for Agents)

For the complete agent grounding workflow, including orientation step, per-element verification loop, discrepancy handling, and graceful degradation, see `/cli/docs/SCAN_ARCHITECTURE.md#agent-grounding-workflow`.

Quick reference for each proposed element:

```
1. Agent identifies candidate (e.g., "OrderService class at src/services/OrderService.ts")
2. Call: dr scan session query explain_symbol --params '{"symbol":"OrderService","language":"typescript"}'
3. CodePrism responds with: {type, location, scope, dependencies, decorators, ...}
4. Agent compares: expected vs actual. If match → confirm with source_reference
5. If mismatch: investigate via search_code to find actual location
6. Emit: dr add with confirmed source_reference and `--source-provenance extracted`
```

## Commands

### `dr scan session start`

Start a persistent CodePrism session and index the repository.

**Usage:**

```bash
dr scan session start [--workspace <path>]
```

**What happens:**

1. Spawns CodePrism process and caches the connection in memory
2. Polls for repository indexing to complete
3. Stores session metadata in `documentation-robotics/.scan-session`
4. Returns session status with indexed file count

**Output:**

```
✓ Session started
  PID: 12345
  Indexed files: 1,250
  Status: ready
  Workspace: /home/user/my-project
```

**Error handling:**

- If session already exists: stops and restarts it
- If CodePrism not installed: reports clear error with installation instructions
- If indexing times out: reports timeout and suggests restarting

### `dr scan session status`

Check the status of the running session.

**Usage:**

```bash
dr scan session status [--workspace <path>]
```

**Output (if session running):**

```
✓ running (ready)
  PID: 12345
  Workspace: /home/user/my-project
  Indexed files: 1,250
  Uptime: 5m 30s
```

**Output (if no session):**

```
✗ No session found

To start a session, run:
  dr scan session start
```

### `dr scan session query <tool>`

Query the running session for semantic analysis results.

**Usage:**

```bash
dr scan session query <tool> [--params <json>] [--format json|text]
```

**Tools available:**

All semantic tools that CodePrism provides. Common tools for extraction agents:

| Tool                  | Purpose                                                                    | Example Params                                                   |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `repository_stats`    | Get repo structure summary (languages, framework hints, top modules)       | `{}`                                                             |
| `detect_patterns`     | Identify architectural patterns (MVC, microservices, layering)             | `{}`                                                             |
| `explain_symbol`      | Verify element type/location and get detailed metadata                     | `{"symbol":"OrderService","language":"typescript"}`              |
| `find_dependencies`   | Discover dependencies of a symbol (what it depends on, what depends on it) | `{"symbol":"OrderService","language":"typescript","type":"all"}` |
| `search_code`         | Find code matching regex patterns                                          | `{"pattern":"class.*Service","language":"typescript"}`           |
| `analyze_decorators`  | List decorated symbols (e.g., @Injectable, @Entity)                        | `{"language":"typescript","decorator":"Injectable"}`             |
| `analyze_api_surface` | Find API endpoints and operations                                          | `{"framework":"express","language":"javascript"}`                |

**Return format:**

By default, results are formatted as JSON. Use `--format text` for human-readable output:

```bash
# JSON (default)
dr scan session query repository_stats --format json

# Human-readable
dr scan session query repository_stats --format text
```

**Error handling:**

- If no session is running: reports clear error and suggests `dr scan session start`
- If tool doesn't exist: lists available tools
- If params are invalid JSON: reports JSON parse error
- If CodePrism times out: reports timeout (increase timeout in `~/.dr-config.yaml` if needed)

### `dr scan session stop`

Stop the running session and clean up.

**Usage:**

```bash
dr scan session stop [--workspace <path>]
```

**Output:**

```
✓ Session stopped
```

**What happens:**

1. Disconnects the CodePrism MCP client connection
2. This closes the stdio transport and terminates the CodePrism process
3. Removes session metadata file and cache entry
4. Returns success regardless (cleanup is always attempted)

**Error handling:**

- If no session found: reports clearly and suggests `dr scan session start` if you meant to query
- If process doesn't respond to signals: forces kill (no error reported; cleanup succeeds anyway)

## Usage Examples

### Example 1: Extract and Ground a Service

```bash
# Start a persistent session before extraction begins
dr scan session start

# Now in the extraction agent:
# Candidate inference: "src/services/OrderService.ts contains a business service"

# Verify the element exists
dr scan session query explain_symbol \
  --params '{"symbol":"OrderService","language":"typescript"}'

# CodePrism confirms:
{
  "name": "OrderService",
  "type": "class",
  "location": "src/services/OrderService.ts:45",
  "decorators": ["@Injectable"],
  "methods": ["create", "update", "cancel"],
  "dependencies": ["DatabaseService", "LoggerService"]
}

# Now you can confidently emit:
dr add application service "Order Service" \
  --description "Handles order lifecycle (create, update, cancel)" \
  --source-file "src/services/OrderService.ts" \
  --source-symbol "OrderService" \
  --source-provenance extracted
```

### Example 2: Discover Cross-Layer References

```bash
# Agent proposes: api.endpoint.create-order → application.service.order-service

# Verify the dependency chain
dr scan session query find_dependencies \
  --params '{"symbol":"createOrderRoute","language":"typescript","type":"all"}'

# CodePrism returns the dependency graph:
{
  "symbol": "createOrderRoute",
  "depends_on": [
    {"symbol": "OrderService", "file": "src/services/OrderService.ts", "type": "class"},
    {"symbol": "OrderValidator", "file": "src/validators/OrderValidator.ts", "type": "function"},
    {"symbol": "Database", "file": "src/db/database.ts", "type": "class"}
  ],
  "depended_on_by": []
}

# Use this to wire both application and data-model references
```

### Example 3: Resolve Ambiguity

```bash
# Agent candidate: "There might be a UserService in src/services/"
# But CodePrism says there isn't one at that location

# Query to resolve:
dr scan session query search_code \
  --params '{"pattern":"class.*User.*Service","language":"typescript"}'

# CodePrism reveals:
{
  "matches": [
    {"file": "src/auth/UserAuthService.ts", "line": 12},
    {"file": "src/admin/UserAdminService.ts", "line": 8}
  ]
}

# Now investigate further with explain_symbol on each match:
dr scan session query explain_symbol \
  --params '{"symbol":"UserAuthService","language":"typescript"}'

# And decide: is this one element or two? What names should they have?
```

### Example 4: Orientation Before Extraction

```bash
# Session is active. Before reading any code:

# 1. Understand the repository structure
dr scan session query repository_stats --format text

# 2. Detect architectural patterns
dr scan session query detect_patterns --format text

# Output might be:
# - Primary language: TypeScript
# - Detected framework: NestJS
# - Found patterns: Microservices (API Gateway + Services), MVC (in admin)
# - Top modules: auth, orders, inventory, payments
# - Estimated services: 5-8

# Now you know: this is a NestJS microservices project
# Focus extraction on: Services (@Injectable), Controllers (@Controller),
# Modules (@Module) in the main API layers
```

## Graceful Degradation: When No Session Is Active

If you attempt to use session tools but no active session exists:

```bash
$ dr scan session query repository_stats

✗ No session found

To use session queries, start a session first:
  dr scan session start

Note: Without an active session, element extraction will proceed using
static code analysis. Source references may be less accurate and cross-layer
references may be incomplete.
```

**Extraction behavior when degraded:**

- Agent proceeds with **static code analysis only** (no semantic queries)
- All proposed elements must include `--source-file` and `--source-symbol` when possible
- Source provenance: Use `inferred` for elements without CodePrism confirmation
- Cross-layer references: Infer from type names and usage patterns, not confirmed dependencies
- Final model will validate successfully but with lower confidence

Example of degraded extraction output:

```bash
# Static analysis: found OrderService class based on regex + import scan
dr add application service "Order Service" \
  --description "Service class for order operations (inferred from static analysis)" \
  --source-file "src/services/OrderService.ts" \
  --source-symbol "OrderService" \
  --source-provenance inferred  # Less confident without CodePrism
```

## Configuration

Sessions use the same CodePrism configuration as the main `dr scan` command:

**Location:** `~/.dr-config.yaml`

```yaml
scan:
  codeprism:
    command: codeprism # CodePrism executable
    args: ["--mcp"] # MCP server arguments
    timeout: 5000 # Connection timeout (ms)
  confidence_threshold: 0.7
  disabled_patterns: []
```

**Session-specific settings:**

- **Max wait time** (for indexing completion): 60 seconds (built-in default)
- **Poll interval** (while waiting for ready): 1 second (built-in default)
- **Process timeout** (for shutdown): 5 seconds (built-in default)

These are not currently configurable but can be made so if needed.

## Error Reference

### "No session found"

Session doesn't exist or has been stopped. Start one: `dr scan session start`

### "Failed to connect to CodePrism"

CodePrism executable not found or not in PATH. Install CodePrism and verify: `which codeprism`

### "Session is indexing, please wait"

Session is still building the repository index. Call `dr scan session status` to check progress or wait and retry the query.

### "Tool not found"

The named tool doesn't exist in CodePrism. Call `dr scan session query repository_stats` to list available tools.

### "Invalid JSON in --params"

The `--params` argument is not valid JSON. Make sure to quote properly and escape special characters: `--params '{"symbol":"Foo","language":"typescript"}'`

### "Timeout waiting for tool result"

CodePrism took too long to respond. Check if the repository is very large or if the system is under heavy load. You can increase the timeout in `~/.dr-config.yaml` (scan → codeprism → timeout).

## Related Commands

- `/dr-map` — Extract architecture from codebase (uses session when available for grounding)
- `dr scan` — One-off scan without persistent session
- `dr search` — Query the model (different from session query)

## Design Notes

### Why Session Queries Over Static Analysis?

Static regex-based scanning finds code patterns but can't confirm:

- Symbol type (is it a class, interface, or export?)
- Scope and visibility (is it exported or private?)
- Dependencies and cross-references (what does it actually use?)
- Decorators and metadata (is it @Injectable or @Entity?)

A running CodePrism session answers all of these with AST-level precision.

### CodePrism as Fact-Checker, Not Sole Discoverer

The design principle: **CodePrism verifies and refines agent inferences; it doesn't replace them.**

1. Agent identifies candidates from static analysis
2. Agent proposes elements based on patterns and naming
3. CodePrism confirms or contradicts via semantic queries
4. Agent resolves conflicts and emits grounded elements

This keeps agents in control while leveraging CodePrism's semantic analysis for verification.

### Graceful Degradation Rationale

Extraction must succeed even if CodePrism is unavailable (offline development, CI environments, etc.). Sessions are opt-in:

- No automatic process spawning
- No hidden background overhead
- Extraction works with or without a session
- User chooses when to ground against the codebase
