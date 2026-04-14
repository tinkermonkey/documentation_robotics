# ADR-006: CodePrism Session Lifecycle - Persistent Background Sessions

**Date**: 2026-04-14  
**Status**: Accepted  
**Context**: Issue #629 - Implement persistent CodePrism session infrastructure  
**Decision**: Implement explicit, opt-in session lifecycle management with the `dr scan session` command family

## Problem

The current scanning workflow requires spawning a new CodePrism process on each `dr scan` invocation. This creates several inefficiencies:

1. **Indexing Overhead**: Each scan command rebuilds the repository index from scratch
2. **Startup Cost**: Spawning and initializing CodePrism (typically 5-30+ seconds) happens on every scan
3. **Resource Wastage**: Multiple processes compete for system resources during scans
4. **Future Integration Blocking**: The index command, reference validator, and agent grounding system all need access to a running, indexed CodePrism instance with a known connection point

## Decision

Implement an **explicit session lifecycle** where developers:

1. **Opt into sessions** via `dr scan session start` - spawn CodePrism once, keep it alive
2. **Reuse the session** for subsequent queries via `dr scan session query` (and future `dr index`, `dr ref validate`, etc.)
3. **Explicitly end sessions** via `dr scan session stop` - developers have full control

This design enforces **intentional session management** rather than hidden background processes:

- Sessions don't start automatically
- Sessions don't persist across terminal/session restarts (by design)
- Session state is always visible via `dr scan session status`
- Session lifecycle is explicit in commands and visible in documentation

## Solution

### Session Lifecycle Model

```
Developer              CLI                    CodePrism Process
   |                  |                              |
   |--session start--->|                              |
   |                  |--spawn (detached)----------->|
   |                  |                              |
   |                  |--poll repository_stats------>|
   |                  |<-ready/indexed_files---------|
   |                  |<--PID, status, timestamp-----|
   |<-session ready---|                              |
   |                  |                              |
   |--session query--->|                              |
   |                  |--call tool (e.g., search)---->|
   |                  |<---tool result----------------|
   |<-result----------|                              |
   |                  |                              |
   |--session stop---->|                              |
   |                  |--SIGTERM + poll for exit---->|
   |                  |--SIGKILL if not responsive-->|
   |                  |<-process exited-------------|
   |<-stopped---------|                              |
```

### Command Family: `dr scan session`

```bash
# Start a persistent session
dr scan session start [--workspace <path>]
# Output: ✓ Session started (PID: 12345)
#         Indexed files: 1,250
#         Workspace: /home/user/my-project
# Session is ready for queries...

# Check session status
dr scan session status [--workspace <path>]
# Output: ✓ running (ready)
#   PID: 12345
#   Workspace: /home/user/my-project
#   Indexed files: 1,250
#   Uptime: 5m

# Query the running session
dr scan session query <tool> [--params <json>] [--format json|text] [--workspace <path>]
# Example: dr scan session query repository_stats
# Example: dr scan session query search_code --params '{"pattern":"class.*User","language":"typescript"}'

# Stop the session
dr scan session stop [--workspace <path>]
# Output: ✓ Session stopped
```

### Session File Schema (`.scan-session`)

Sessions are persisted in a metadata file at `documentation-robotics/.scan-session`:

```json
{
  "pid": 12345,
  "workspace": "/home/user/my-project",
  "status": "ready",
  "indexed_files": 1250,
  "started_at": "2026-04-14T10:30:00Z",
  "endpoint": "codeprism:--mcp"
}
```

**Validation**: JSON Schema validated on read/write using Zod
**Location**: One session per workspace at `{workspace}/documentation-robotics/.scan-session`
**Cleanup**: Automatically removed when session is stopped

### Process Lifecycle

1. **Start**: Spawn CodePrism as **detached background process**
   - `spawn(..., { detached: true, stdio: 'pipe' })`
   - `child.unref()` so Node doesn't wait for exit
   - Process survives CLI process exit
   
2. **Polling**: Poll `repository_stats` tool until indexing complete
   - Default timeout: 60 seconds
   - Default poll interval: 1 second
   - Configurable via test options
   
3. **Liveness Check**: PID-based process detection
   - `process.kill(pid, 0)` to check if process exists
   - Used by status command to verify session is still alive
   
4. **Shutdown**: Graceful SIGTERM + forced SIGKILL fallback
   - Send SIGTERM
   - Wait up to 5 seconds
   - Send SIGKILL if not responsive
   - Remove session file regardless

### Error Handling

All session subcommands degrade gracefully when no session is active:

```
$ dr scan session status
✗ No session found

To start a session, run: dr scan session start
```

**Exit codes**:
- `0`: Command succeeded
- `1`: User error (no session, invalid params) or session command error
- `2`: System error (process spawn failed, file I/O error)

### Design Invariants

1. **Explicit Session Lifecycle** - Sessions don't start automatically
2. **Single Session Per Workspace** - Only one session per `documentation-robotics/` directory
3. **Detached Background Process** - Session survives CLI exit and terminal closure
4. **Liveness Verification** - Session status uses PID-based process detection
5. **Graceful Degradation** - All commands work when session exists or report clear errors when it doesn't
6. **Configuration Reuse** - Session uses same CodePrism config as `dr scan` command

## Implementation

### Core Module: `cli/src/scan/session-manager.ts`

Exported functions:

```typescript
// Lifecycle
export async function startSession(
  workspace: string,
  config: LoadedScanConfig,
  options?: { maxWaitMs?: number; pollIntervalMs?: number }
): Promise<SessionFile>

export async function stopSession(workspace: string): Promise<void>

export async function getSessionState(workspace: string): Promise<SessionState | null>

// Queries
export async function querySession(
  workspace: string,
  config: LoadedScanConfig,
  toolName: string,
  toolParams: Record<string, unknown>
): Promise<ToolResult[]>

// Utilities
export function isProcessAlive(pid: number): boolean
export function getSessionPath(workspace: string): string
export async function loadSessionFile(workspace: string): Promise<SessionFile | null>
export async function saveSessionFile(workspace: string, session: SessionFile): Promise<void>
```

### Command Handlers: `cli/src/commands/scan.ts`

```typescript
export async function sessionStartCommand(options: { workspace?: string }): Promise<void>
export async function sessionStatusCommand(options?: { workspace?: string }): Promise<void>
export async function sessionQueryCommand(
  tool: string,
  options?: { params?: string; format?: "json" | "text"; workspace?: string }
): Promise<void>
export async function sessionStopCommand(options?: { workspace?: string }): Promise<void>

export function scanCommands(program: Command): void
```

### CLI Registration: `cli/src/cli.ts`

```typescript
import { scanCommands } from "./commands/scan.js";

// Replace old direct scan command registration with:
scanCommands(program);
```

## Configuration

Sessions use the same scan configuration as the main `dr scan` command:

**Location**: `~/.dr-config.yaml`

```yaml
scan:
  codeprism:
    command: codeprism        # CodePrism binary
    args: ["--mcp"]           # MCP server args
    timeout: 5000             # Connection timeout (ms)
  confidence_threshold: 0.7   # (used by main scan)
  disabled_patterns: []       # (used by main scan)
```

Sessions inherit all CodePrism configuration (command, args, environment) from this file.

## Testing Strategy

Integration tests in `cli/tests/integration/scan-session-lifecycle.test.ts`:

1. **Graceful Error Handling**
   - Report clear error when CodePrism is not available
   - Handle invalid JSON in `--params`
   - Handle missing/invalid workspace paths

2. **Command Structure Verification**
   - All subcommands accept `--workspace` parameter
   - Help text is displayed correctly
   - Examples are included in help

3. **Session State Verification**
   - Report "No session found" when none exists
   - Fail gracefully when querying without active session
   - Fail gracefully when stopping without active session

4. **Full Lifecycle** (when CodePrism is available)
   - Start session: process spawned, file created, status is ready
   - Status: reports running (ready), shows uptime and file count
   - Query: forwards tool call without re-indexing
   - Stop: terminates process, removes session file

Note: Full lifecycle tests are conditional on CodePrism availability. Tests gracefully skip if CodePrism is not installed.

## Future Extensions

This session model enables:

1. **Index Command** (`dr index`) - Use running session to build index
2. **Reference Validator** (`dr ref validate`) - Check references against indexed codebase
3. **Agent Grounding** - Provide context to Claude agents from live CodePrism
4. **Incremental Updates** - Query session for changed files without full re-index
5. **Multi-language Support** - Query session for language-specific patterns

## Backwards Compatibility

- Existing `dr scan` command works unchanged (spawns ephemeral CodePrism)
- No breaking changes to existing workflows
- Sessions are opt-in feature
- No automatic background processes

## Trade-offs

### Chosen Explicit Over Implicit

**Why not auto-start sessions?**
- Hidden background processes are harder to debug
- Developers need visibility into session state
- Resource consumption is explicit and controllable
- Manual control allows for development workflows (e.g., restart session for config changes)

### Chosen Detached Over Managed

**Why not manage process with Node process manager?**
- Session survives terminal closure and CLI process exit
- Developers can work with session across multiple terminal windows
- Simpler implementation (no need to track child processes across CLI invocations)

### Chosen PID-Based Over Socket-Based

**Why not use named pipes or sockets?**
- PID-based detection is simpler and platform-independent
- Session file contains all needed metadata
- Works across terminal/process boundaries
- Matches existing CodePrism MCP communication model

## See Also

- [ADR-003](./ADR-003-pattern-files-cli-asset.md) - Pattern file design
- [ADR-004](./ADR-004-ast-parser-selection.md) - CodePrism selection rationale
- [ADR-005](./ADR-005-language-support-management.md) - Language support strategy
- [Scanning Architecture](../cli/SCAN_ARCHITECTURE.md)
