# Command Lifecycle Standard

## Overview

All DR CLI commands follow a standardized lifecycle pattern to ensure consistent error handling, telemetry instrumentation, and proper cleanup.

## Command Categories

### 1. Short-Running Commands

Commands that execute deterministic workflows and terminate immediately.

**Examples:**

- `dr add` - Add elements to layers
- `dr update` - Modify existing elements
- `dr delete` - Remove elements
- `dr list` - Display layer contents
- `dr search` - Search across layers
- `dr validate` - Run validation checks
- `dr info` - Show model information
- `dr trace` - Display dependency traces
- `dr project` - Project dependencies
- `dr export` - Export to formats
- `dr relationship` - Manage relationships
- `dr catalog` - Display catalogs
- `dr conformance` - Check spec conformance
- `dr upgrade` - Upgrade spec version
- `dr stats` - Display statistics
- `dr changeset` - Manage changesets
- `dr element` - Element operations
- `dr claude` - Claude integration management
- `dr copilot` - GitHub Copilot management

**Lifecycle Pattern:**

```typescript
export async function commandFunction(args: ArgumentType, options: OptionsType): Promise<void> {
  try {
    // 1. Load model if needed
    const model = await Model.load();

    // 2. Validate inputs
    if (!validInput) {
      throw new CLIError("Invalid input", 1);
    }

    // 3. Execute command logic
    const result = await doWork(model);

    // 4. Save model if modified
    await model.save();

    // 5. Display success output
    console.log(ansis.green("✓ Success message"));

    // 6. Return normally (no explicit exit)
    return;
  } catch (error) {
    // 7. Re-throw CLIError instances
    if (error instanceof CLIError) {
      throw error;
    }

    // 8. Wrap other errors in CLIError
    const message = error instanceof Error ? error.message : String(error);
    throw new CLIError(message, 1);
  }
}
```

### 2. Long-Running Commands

Commands that spawn subprocesses and monitor their lifecycle.

**Examples:**

- `dr chat` - Interactive chat with AI agents
- `dr visualize` - Visualization server with WebSocket

**Lifecycle Pattern:**

```typescript
export async function longRunningCommand(args: ArgumentType, options: OptionsType): Promise<void> {
  let serverProcess: ChildProcess | null = null;

  try {
    // 1. Setup and validation
    const config = await prepareConfiguration();

    // 2. Spawn subprocess
    serverProcess = spawn(command, args, spawnOptions);

    // 3. Monitor subprocess events
    serverProcess.on("exit", (code) => {
      if (code !== 0) {
        throw new CLIError(`Process exited with code ${code}`, code || 1);
      }
    });

    serverProcess.on("error", (error) => {
      throw new CLIError(`Failed to start: ${error.message}`, 1);
    });

    // 4. Wait for completion or handle signals
    await waitForCompletion(serverProcess);

    // 5. Return normally
    return;
  } catch (error) {
    // 6. Cleanup subprocess if needed
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }

    // 7. Re-throw CLIError instances
    if (error instanceof CLIError) {
      throw error;
    }

    // 8. Wrap other errors
    const message = error instanceof Error ? error.message : String(error);
    throw new CLIError(message, 1);
  }
}
```

## Critical Rules

### ❌ NEVER Do This

```typescript
// WRONG: Direct process.exit() bypasses telemetry
if (error) {
  console.error("Error:", error.message);
  process.exit(1);
}

// WRONG: Silent success exit
if (noChanges) {
  process.exit(0);
}
```

### ✅ ALWAYS Do This

```typescript
// CORRECT: Throw CLIError for errors
if (error) {
  throw new CLIError('Error message', 1);
}

// CORRECT: Just return for success paths
if (noChanges) {
  console.log('No changes needed');
  return;
}

// CORRECT: Preserve CLIError context
catch (error) {
  if (error instanceof CLIError) {
    throw error;  // Preserve exit code and context
  }
  throw new CLIError('Unexpected error', 1);
}
```

## Why This Matters

### Telemetry Shutdown

The CLI wrapper (`cli.ts`) catches all errors and calls `shutdownTelemetry()` before exit:

```typescript
// cli.ts lines 650-677
try {
  await program.parseAsync(process.argv);
} catch (error) {
  // Extract exit code from CLIError
  exitCode = await extractExitCode(error);
  // ... error handling ...
}

// Shutdown telemetry after execution completes
await shutdownTelemetry();

// Exit with appropriate code after telemetry shutdown
if (exitCode !== 0) {
  process.exit(exitCode);
}
```

**Direct `process.exit()` bypasses this:**

- OpenTelemetry spans are lost
- Metrics aren't flushed
- No traces sent to collector
- Debugging production issues becomes impossible

### Consistent Error Format

CLIError provides:

- Exit code control
- Error categories
- Actionable suggestions
- Contextual information

```typescript
throw new CLIError(
  "Element not found",
  1, // exit code
  ErrorCategory.USER,
  ["Check element ID", "Run dr list to see available elements"],
  { elementId: "missing-element" }
);
```

## CLI Wrapper Responsibilities

The CLI wrapper (`cli.ts`) handles:

1. **Command Execution**
   - Parse command-line arguments
   - Route to command handler
   - Wrap in telemetry span

2. **Error Handling**
   - Catch all errors from commands
   - Extract exit codes from CLIError
   - Display formatted error messages

3. **Telemetry Management**
   - Initialize telemetry on startup
   - Create root span for command
   - Flush and shutdown before exit

4. **Process Exit**
   - Single point of `process.exit()`
   - Only after telemetry shutdown
   - Proper exit code propagation

## Command Responsibilities

Commands should:

1. **Execute Logic**
   - Validate inputs
   - Perform operations
   - Return results

2. **Error Signaling**
   - Throw `CLIError` for user errors
   - Throw `CLIError` for system errors
   - Never call `process.exit()`

3. **Success Indication**
   - Log success messages
   - Return normally
   - No explicit exit call

## Success vs. Failure Paths

### Success Path

```typescript
// Display results
console.log(ansis.green("✓ Operation completed"));

// Just return - CLI wrapper handles exit
return;
```

### User Error Path

```typescript
// User provided invalid input
throw new CLIError("Invalid JSON in --properties", 1);
```

### System Error Path

```typescript
// Catch block at command level
catch (error) {
  if (error instanceof CLIError) {
    throw error;  // Preserve exit code and context
  }

  // Wrap unexpected errors
  const message = error instanceof Error ? error.message : String(error);
  throw new CLIError(message, 1);
}
```

### Cancellation Path

```typescript
// User cancelled via prompt
if (!confirmed) {
  console.log(ansis.dim("Cancelled"));
  return; // Just return, don't exit
}
```

## Migration Checklist

When updating a command from old to new pattern:

- [ ] Add `import { CLIError } from '../utils/errors.js';`
- [ ] Replace `process.exit(1)` with `throw new CLIError(message, 1)`
- [ ] Replace `process.exit(0)` with `return`
- [ ] Add `if (error instanceof CLIError) throw error;` in catch blocks
- [ ] Remove `console.error()` calls (CLIError handles formatting)
- [ ] Test telemetry spans are sent on both success and failure
- [ ] Verify exit codes are preserved

## Testing Commands

### Test Telemetry Integration

```bash
# Enable telemetry for testing
export TELEMETRY_ENABLED=true

# Run command - should send spans even on failure
dr add invalid-layer invalid-type test-element

# Check OTLP collector received spans
```

### Test Exit Codes

```bash
# Should exit with code 0 on success
dr list motivation
echo $?  # Should be 0

# Should exit with code 1 on error
dr show nonexistent-element
echo $?  # Should be 1
```

### Test Error Messages

```bash
# Should display formatted error without stack trace
dr add motivation goal test --name "Test" --invalid-option

# Should show suggestions when available
dr delete element-with-dependencies
```

## Lint Rules

Add to `.eslintrc.json`:

```json
{
  "rules": {
    "no-process-exit": "error"
  },
  "overrides": [
    {
      "files": ["cli.ts"],
      "rules": {
        "no-process-exit": "off"
      }
    }
  ]
}
```

Only `cli.ts` is allowed to call `process.exit()`.

## Related Documentation

- [Error Handling Guide](../../docs/ERROR_HANDLING_GUIDE.md)
- [Telemetry Architecture](./telemetry.md)
- [Testing Guide](../../docs/testing/)

## Examples

### Before (Incorrect)

```typescript
// ❌ old-command.ts
export async function oldCommand(id: string): Promise<void> {
  try {
    const model = await Model.load();
    const element = model.getElement(id);

    if (!element) {
      console.error(`Error: Element ${id} not found`);
      process.exit(1); // ❌ Bypasses telemetry
    }

    console.log("Success");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1); // ❌ Bypasses telemetry
  }
}
```

### After (Correct)

```typescript
// ✅ new-command.ts
import { CLIError } from "../utils/errors.js";

export async function newCommand(id: string): Promise<void> {
  try {
    const model = await Model.load();
    const element = model.getElement(id);

    if (!element) {
      throw new CLIError(`Element ${id} not found`, 1); // ✅ Proper error
    }

    console.log("Success");
    return; // ✅ Just return
  } catch (error) {
    if (error instanceof CLIError) {
      throw error; // ✅ Preserve error context
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new CLIError(message, 1); // ✅ Wrap unexpected errors
  }
}
```

## Summary

**One Simple Rule:**

> Commands throw errors. CLI wrapper exits process.

This separation ensures telemetry is always properly flushed, error handling is consistent, and the application gracefully shuts down even when commands fail.
