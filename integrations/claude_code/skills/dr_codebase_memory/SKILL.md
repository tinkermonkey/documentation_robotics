---
name: DR_CODEBASE_MEMORY
description: Graph-based code intelligence for using dr analyzer subcommands to understand codebase structure, discover elements, and verify model alignment
triggers:
  [
    "what endpoints exist",
    "endpoints",
    "what calls",
    "call graph",
    "is the model complete",
    "what services exist",
    "analyzer",
    "codebase memory",
    "reindex",
    "freshness",
    "code structure",
    "extract workflows",
    "code changes verification"
  ]
version: 0.1.3
---

# Codebase Memory Skill

**Scope:** CLI version 0.1.3
**Purpose:** Teaches agents when and how to use `dr analyzer` subcommands for graph-based code intelligence rather than running grep+Read loops to understand codebase structure.

---

## When to Activate

This skill activates when:

- User asks **structural codebase questions**: "What endpoints exist?", "What services are in this codebase?", "Is the model complete?", "What calls what?"
- User asks about **call graphs and dependencies**: "Who calls this function?", "What does this endpoint depend on?"
- **Before extraction workflows**: Agent is about to grep the codebase to discover elements
- **After code changes**: User asks "Is this fresh?", "Did I miss anything?", "What changed?" — check with analyzer before manual inspection
- User mentions **analyzer**, **codebase memory**, **reindex**, or **freshness**
- User mentions **verification** or **verification scenarios**

---

## Core Commands

The `dr analyzer` surface provides ten subcommands for codebase discovery and verification. Each has a specific purpose and confidence level:

### 1. `dr analyzer discover`

**Purpose:** Scan for installed analyzers and select the active analyzer.

**What it does:**

- Detects which analyzers are installed and available on the system
- Prompts for selection if multiple analyzers are found
- Persists the selected analyzer to session state for subsequent commands
- Can force re-selection with `--reselect` flag

**Confidence:** Medium — Use to **bootstrap analyzer selection** before other commands

**Example:**

```bash
dr analyzer discover
dr analyzer discover --reselect         # Force new selection
```

**Use when:**

- User wants to see what analyzers are available
- No analyzer is currently selected
- User wants to switch to a different analyzer

---

### 2. `dr analyzer status`

**Purpose:** Probe analyzer state and project index freshness before any other query.

**What it does:**

- Detects if an analyzer is installed and active
- Reports project index state (indexed, not indexed, stale)
- Indicates which analyzer is selected (e.g., codebase-memory, source-graph)
- Shows index metadata (last indexed time, schema version)

**Confidence:** Medium — Use to make **graceful degradation decisions** (see protocol below)

**Example:**

```bash
dr analyzer status
```

**Output indicates:**

- Analyzer installed and active → Use other commands with full confidence
- Analyzer available but not indexed → Offer to `dr analyzer index` first
- No analyzer → Fall back to code inspection, mention capability once

---

### 3. `dr analyzer index`

**Purpose:** Index the project codebase with the active analyzer.

**What it does:**

- Scans the project for code structures (endpoints, services, database schemas, call relationships)
- Builds internal graph of codebase elements
- Persists index state for subsequent queries
- Reports indexing progress and completion

**Confidence:** Medium — Indexing takes time; offer only if user has explicit freshness concerns

**Example:**

```bash
dr analyzer index
```

**Use when:**

- `status` shows index is stale or missing
- User asks "Is this fresh?" and index needs updating
- Extracting a large feature (multiple endpoints/services)

---

### 4. `dr analyzer endpoints`

**Purpose:** List all API endpoints discovered in the indexed project.

**What it does:**

- Enumerates HTTP endpoints (routes, methods, parameters)
- Infers endpoint details from code (path, verb, description)
- Returns structured data: path, HTTP method, handler, parameters, return type

**Confidence:** **HIGH** — This is authoritative ground truth. Endpoints in code = endpoints that exist.

**Example:**

```bash
dr analyzer endpoints
```

**Trust this for:**

- ✅ "What API endpoints exist in this codebase?"
- ✅ Verification that all code endpoints are modeled
- ✅ Discovering missing endpoints to add to the model

---

### 5. `dr analyzer services`

**Purpose:** Query for services/components in the indexed project.

**What it does:**

- Identifies application services and components (business logic groupings)
- Infers from code organization (package/module structure, class hierarchy)
- Returns service names, description, dependencies, exposed interfaces

**Confidence:** **MEDIUM-to-LOW** — Treat as a **checklist, not ground truth**. Code organization ≠ intended architecture.

**Example:**

```bash
dr analyzer services
```

**Trust this for:**

- ✅ As a **checklist**: "Did we model all the major code packages?"
- ✅ Discovering services not yet in the model
- ❌ As authoritative: Don't assume analyzer's grouping matches intended architecture

**When uncertain:**

- Ask the user: "Analyzer sees these services; does this match your intended architecture?"
- Compare against layer 2 (Business) or layer 4 (Application) model definitions

---

### 6. `dr analyzer datastores`

**Purpose:** Identify database schemas and data storage patterns inferred from code.

**What it does:**

- Detects database connections, ORM models, migration files
- Infers schema structure from code (table names, columns, relationships)
- Returns database names, tables, columns, inferred types

**Confidence:** **LOW** — Treat as **"consider this"**, not definitive. Inferred schemas may be incomplete, stale, or speculative.

**Example:**

```bash
dr analyzer datastores
```

**Trust this for:**

- ✅ As a starting point: "What databases and tables exist?"
- ✅ Discovering schemas not yet modeled in layer 7/8
- ✅ Finding orphaned tables or stale schemas
- ❌ As ground truth: Inferred schemas can miss columns, relationships, or constraints

**When uncertain:**

- Always cross-check against actual schema definitions (SQL migrations, ORM models)
- Ask the user: "Analyzer inferred these tables; can you confirm this matches your database?"

---

### 7. `dr analyzer callers <qualified-name>`

**Purpose:** Analyze incoming call relationships for a function/method.

**What it does:**

- Finds all functions that call the given function
- Builds call graph from code analysis (static analysis, type information)
- Returns caller information: names, locations, call context
- Useful for understanding callers and reverse dependencies

**Confidence:** Medium — Accurate for explicit calls; may miss dynamic/reflection-based calls

**Example:**

```bash
dr analyzer callers "auth.service.validateToken"
```

**Trust this for:**

- ✅ Understanding who calls a given function
- ✅ Reverse dependency analysis
- ✅ Finding unexpected callers
- ⚠️ Be aware: Dynamic calls (callbacks, reflection, higher-order functions) may not be detected

---

### 8. `dr analyzer callees <qualified-name>`

**Purpose:** Analyze outgoing call relationships for a function/method.

**What it does:**

- Finds all functions that the given function calls
- Builds call graph from code analysis (static analysis, type information)
- Returns callee information: names, locations, call context
- Useful for understanding dependencies and call chains

**Confidence:** Medium — Accurate for explicit calls; may miss dynamic/reflection-based calls

**Example:**

```bash
dr analyzer callees "api.handler.createOrder"
```

**Trust this for:**

- ✅ Understanding function dependencies
- ✅ Forward impact analysis ("What does this function depend on?")
- ✅ Discovering call chains and dependency graphs
- ⚠️ Be aware: Dynamic calls (callbacks, reflection, higher-order functions) may not be detected

---

### 9. `dr analyzer query <cypher>`

**Purpose:** Execute custom graph queries against the indexed codebase.

**What it does:**

- Accepts Cypher query language for flexible graph traversal
- Queries the underlying codebase graph directly (bypassing predefined commands)
- Returns raw graph results based on custom query logic
- Powerful for advanced analysis beyond standard commands

**Confidence:** HIGH for graph structure, but requires Cypher knowledge — Use when standard commands don't fit

**Example:**

```bash
dr analyzer query "MATCH (fn:Function) WHERE fn.name CONTAINS 'payment' RETURN fn.fqn, fn.description"
```

**Trust this for:**

- ✅ Custom graph traversals (e.g., "functions that call X and are called by Y")
- ✅ Finding all nodes of a specific type with filters
- ✅ Complex relationship analysis
- ✅ Exploring graph structure itself

**When to use:**

- Standard commands (`endpoints`, `services`, `callers`, `callees`) don't meet your needs
- You need to filter or combine results in a custom way
- Analyzing complex graph patterns

**Before using:**

- Run `get_graph_schema` MCP tool first to understand available node/edge types
- See "MCP Escape Hatch" section below for protocol

---

### 10. `dr analyzer verify`

**Purpose:** Verify that code-discovered routes align with model endpoints and validate against active changeset.

**What it does:**

- Compares endpoints found in code against endpoints defined in the model (layer 6)
- Reports **matches** (endpoint in code and model), **graph-only** (in code but not modeled), **model-only** (modeled but not in code)
- Reports against the **active changeset view** if a changeset is staged
- Returns JSON with detailed mappings and changeset context

**Confidence:** **HIGH for diffs, MEDIUM for absolute alignment** — Shows what changed; absolute alignment depends on model accuracy

**Example:**

```bash
dr analyzer verify --json
```

**Output includes:**

```json
{
  "generated_at": "2026-04-21T15:30:45.123Z",
  "project_root": "/path/to/project",
  "analyzer": "codebase-memory-mcp",
  "analyzer_indexed_at": "2026-04-21T15:20:00.000Z",
  "changeset_context": {
    "active_changeset": "feat-payments",
    "verified_against": "changeset_view"
  },
  "layers_verified": ["api"],
  "buckets": {
    "matched": [...],
    "in_graph_only": [...],
    "in_model_only": [...],
    "ignored": [...]
  },
  "summary": {
    "matched_count": 45,
    "gap_count": 2,
    "drift_count": 1,
    "ignored_count": 0,
    "total_graph_entries": 47,
    "total_model_entries": 46
  }
}
```

**Trust this for:**

- ✅ Finding endpoints in code that aren't modeled yet (in_graph_only)
- ✅ Finding modeled endpoints that don't exist in code (in_model_only)
- ✅ Verifying model freshness after code changes
- ✅ Checking what changed when a changeset is active (via `changeset_context`)

**When reporting results to user:**

- Always **quote the `changeset_context` fields** (`active_changeset` and `verified_against`) to indicate which model version was compared
- Use terminology: **"graph-only"** for `in_graph_only` (suspected gaps), **"model-only"** for `in_model_only` (possible drift)

---

## Confidence Interpretation Table

| Command      | Confidence | Use As                                  | Caveats                                            |
| ------------ | ---------- | --------------------------------------- | -------------------------------------------------- |
| `discover`   | Medium     | Bootstrap analyzer selection            | Only used once per session                         |
| `status`     | Medium     | Decision gate (is analyzer available?)  | Only probes; doesn't query codebase                |
| `index`      | Medium     | Refresh command (accept if user asks)   | Takes time; only offer if freshness concerns       |
| `endpoints`  | **HIGH**   | Authoritative ground truth              | Complete and accurate (code is source truth)       |
| `services`   | Medium-Low | Checklist, starting point for discovery | Inferred; may not match intended architecture      |
| `datastores` | **LOW**    | Consider as a lead, verify manually     | Inferred schemas may be incomplete/stale           |
| `callers`    | Medium     | Reverse dependency analysis             | Misses dynamic calls (callbacks, reflection)       |
| `callees`    | Medium     | Forward dependency analysis             | Misses dynamic calls (callbacks, reflection)       |
| `query`      | **HIGH**   | Custom graph traversal                  | Requires Cypher knowledge and graph schema         |
| `verify`     | **HIGH**   | Gap/drift detection, freshness check    | High confidence on diffs; quotes changeset context |

---

## When NOT to Use

Do NOT activate this skill when:

- **Text search needed** → User asks "find all uses of variable X" → Use Grep/Glob instead
- **Single file edits** → User asks "show me this file" → Use Read instead
- **Analyzer unavailable** → `dr analyzer status` shows "no analyzer active" → Fall back to code inspection (see Graceful Degradation below)
- **Ad-hoc symbol lookup** → User asks "what does this function return?" → Code inspection is faster than analyzer query
- **Low-level code review** → User asks "is this implementation correct?" → Read and analyze the code directly

**Summary:** Analyzer excels at **structural questions** (what exists, how are things connected). Use traditional tools for **content questions** (what does this do, is it correct).

---

## Graceful Degradation Protocol

The analyzer may not be installed or indexed. Handle with three-tier degradation:

### Level 1: Full Capability (Analyzer Active and Indexed)

**Condition:** `dr analyzer status` shows analyzer installed and index is current.

**Action:** Use all ten commands freely. User gets authoritative answers.

---

### Level 2: Available But Not Indexed (Analyzer Installed, Not Indexed)

**Condition:** `dr analyzer status` shows analyzer installed but index is stale or missing.

**Action:**

1. Offer to index: "I can index the codebase for faster structural queries. Run `dr analyzer index`?"
2. If user declines, fall back to code inspection
3. Do NOT repeatedly offer; accept user's choice once per session

---

### Level 3: No Analyzer (Not Installed)

**Condition:** `dr analyzer status` shows no analyzer active.

**Action:**

1. **Mention capability once:** "This codebase could be indexed for structural queries—see `dr analyzer discover` if interested."
2. **Step aside:** Do not mention analyzer again this session; proceed with code inspection
3. Use Read/Glob/Grep to answer structural questions the traditional way

**Why this protocol:**

- Respects user choice (don't nag if they prefer manual inspection)
- Avoids repeated offers that clutter conversation
- Transitions cleanly to fallback tools
- Keeps focus on solving the user's immediate problem

---

## MCP Escape Hatch

For use cases not covered by `dr analyzer` subcommands, the codebase-memory MCP provides lower-level graph access:

### Available MCP Tools

- `mcp__codebase-memory-mcp__get_graph_schema` — Retrieve graph schema (structure, node types, edge types)
- `mcp__codebase-memory-mcp__query_graph` — Execute custom Cypher query against the codebase graph
- `mcp__codebase-memory-mcp__query_graph_with_llm` — Execute Cypher with LLM assistance

### Protocol

**Always run `get_graph_schema` first** before any custom Cypher query. This tells you:

- Available node types (Endpoint, Service, Function, Database, etc.)
- Available edge types (calls, references, depends_on, etc.)
- Node and edge properties

**Example:**

```bash
# 1. Get schema first
mcp__codebase-memory-mcp__get_graph_schema

# 2. Write custom Cypher query
mcp__codebase-memory-mcp__query_graph
MATCH (fn:Function) WHERE fn.name CONTAINS "payment"
RETURN fn.fqn, fn.description
```

**When to use MCP over `dr analyzer`:**

- Finding all nodes of a specific type (e.g., all "Payment" related functions)
- Complex graph traversals (e.g., "functions that call X and are called by Y")
- Custom filtering based on node properties
- Exploring graph structure itself

---

## Changeset Awareness

When a user has an active changeset, `dr analyzer verify` reports **against the active changeset view** — i.e., the model as it would exist after applying the staged changes.

### How to Report Results

When summarizing verify output to the user:

1. **Quote the `changeset_context` field** from the verify JSON response
2. **Indicate what model version was checked:** "Verified against changeset X" or "Verified against current model"
3. **Highlight graph-only/model-only in context:**
   - Graph-only = "These endpoints are in code but not in changeset X"
   - Model-only = "These endpoints are in changeset X but not in code"

**Example:**

**User:** "Is the API model fresh?"

**Assistant:** Let me verify...

```bash
dr analyzer verify --json
```

**Result (in JSON):**

```json
{
  "changeset_context": {
    "active_changeset": "feat-payments",
    "verified_against": "changeset_view"
  },
  "buckets": {
    "matched": [...],
    "in_graph_only": [{ "id": "route-1", "http_method": "POST", "http_path": "/api/v1/payments/refund", "source_file": "src/routes.ts", "source_symbol": "refundPayment" }],
    "in_model_only": [],
    "ignored": []
  },
  "summary": {
    "matched_count": 45,
    "gap_count": 1,
    "drift_count": 0,
    "ignored_count": 0,
    "total_graph_entries": 46,
    "total_model_entries": 45
  }
}
```

**Response to user:**
"Verified against changeset `feat-payments`. Found 1 graph-only entry: `POST /api/v1/payments/refund` is in code but not in the changeset yet. All 45 existing endpoints match. Would you like me to add the missing endpoint to the changeset?"

### Why This Matters

- User understands which model version was verified (important if they're comparing drafts)
- Helps debug: "Did you add this in the changeset?" → Check changeset_context
- Surfaces discrepancies early before applying changes

---

## Quick Reference

**Activation Triggers:**

- "What endpoints exist?" → `dr analyzer endpoints`
- "Is the model complete?" → `dr analyzer verify`
- "What services are here?" → `dr analyzer services` (+ user confirmation)
- "What databases?" → `dr analyzer datastores` (verify manually)
- "Does this call that?" → `dr analyzer callers|callees <fqn>`

**Confidence Levels:**

- 🟢 HIGH: `endpoints`, `verify` (graph-only/model-only detection), `query` (custom traversal)
- 🟡 MEDIUM: `discover`, `status`, `index`, `callers`, `callees`, `services` (checklist only)
- 🔴 LOW: `datastores` (consider, verify manually)

**Fallback When Analyzer Unavailable:**

- Mention capability once: "See `dr analyzer discover` to install analyzer support"
- Use Read/Glob/Grep for structural questions
- Do NOT repeatedly offer analyzer

**With Changesets:**

- Always quote `changeset_context.active_changeset` and `changeset_context.verified_against` from verify output
- Clarify which model version was checked (base_model vs changeset_view)
- Use terminology: **graph-only** for in_graph_only, **model-only** for in_model_only
