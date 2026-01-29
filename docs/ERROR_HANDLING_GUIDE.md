# Error Handling and Message Standardization Guide

## Overview

This guide documents the error handling approach used throughout the Documentation Robotics CLI, including standards for error messages, validation errors, and debugging information.

## Error Handling Strategy

### CLIError - Primary Error Type

All user-facing errors should use the `CLIError` class from `cli/src/utils/cli-error.ts`:

```typescript
import { CLIError } from "../utils/cli-error.js";

// Basic error
throw new CLIError("Element ID must not be empty", "validation");

// With context
throw new CLIError(
  `Failed to find element: ${elementId}`,
  "reference",
  `Try running 'dr list' to see available elements`
);
```

**Constructor:**

```typescript
constructor(message: string, category: string, hint?: string)
```

**Parameters:**

- `message` - Clear description of what went wrong
- `category` - Error category (validation, reference, file-io, schema, etc.)
- `hint` - Optional suggestion for resolution

### Error Message Standards

#### Format

Error messages should be concise but informative:

```
<subject> <action> <reason>
```

**Good Examples:**

- "Element 'customer' not found in layer 'business'"
- "Invalid layer name: 'data_store' (did you mean 'data-store'?)"
- "Layer manifest is missing required field: 'version'"
- "Failed to save changeset: permission denied for directory"

**Bad Examples:**

- "Error occurred" ❌ (too vague)
- "Cannot process" ❌ (missing context)
- "System error 500" ❌ (technical jargon)

#### Components

**1. Subject** - What entity caused the problem

- Element ID, layer name, file path, property name
- Include relevant identifiers

**2. Action** - What operation failed

- Create, find, validate, save, load, export
- Use past tense for completed actions: "failed to...", "could not..."

**3. Reason** - Why it failed

- Missing field, invalid format, reference not found, permission denied
- Provide specific detail that helps the user understand the cause

#### Context Examples

**Validation Error:**

```
throw new CLIError(
  `Element ID format invalid: '${providedId}' (expected format: '{layer}.{type}.{name}')`,
  'validation'
);
```

**Reference Error:**

```
throw new CLIError(
  `Cross-layer reference failed: '${sourceId}' references missing element '${targetId}'`,
  'reference',
  `Element '${targetId}' must exist before creating this reference`
);
```

**File I/O Error:**

```
throw new CLIError(
  `Failed to read model manifest: file not found at '${manifestPath}'`,
  'file-io',
  `Try running 'dr init' to create a new model`
);
```

### Error Categories

**Standard Categories:**

- **validation** - JSON schema, naming, format validation failures
- **reference** - Cross-layer reference integrity issues
- **schema** - Schema definition or validation problems
- **naming** - Element ID naming convention violations
- **semantic** - Business rule or logical consistency violations
- **file-io** - File reading/writing problems
- **permission** - Access control or authorization issues
- **not-found** - Resource (element, layer, file) does not exist
- **duplicate** - Duplicate element or constraint violation
- **conflict** - Conflicting configuration or state
- **migration** - Version migration or upgrade issues
- **internal** - Unexpected internal errors (should be rare)

### Error Handling in Commands

All command implementations should follow this pattern:

```typescript
export async function executeCommand(args: CommandArgs, model: Model): Promise<void> {
  try {
    // 1. Validate input
    if (!args.elementId) {
      throw new CLIError("Element ID is required", "validation");
    }

    // 2. Check preconditions
    const element = layer.getElement(args.elementId);
    if (!element) {
      throw new CLIError(`Element not found: '${args.elementId}'`, "not-found");
    }

    // 3. Perform operation
    const result = await performOperation(element);

    // 4. Report success
    console.log(`Successfully completed operation on '${args.elementId}'`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // 5. Handle errors consistently
    if (error instanceof CLIError) {
      console.error(error.format());
    } else if (error instanceof Error) {
      console.error(`Internal error: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    } else {
      console.error("Unknown error occurred");
    }
    process.exit(1);
  }
}
```

### Validation Pipeline Errors

The validation system uses specific error types for each validator:

```typescript
// Schema validation
throw new CLIError(
  `Schema validation failed: ${element.id} has invalid property '${propertyName}'`,
  "schema"
);

// Naming validation
throw new CLIError(
  `Naming convention violated: '${elementId}' (expected format: '{layer}.{type}.{kebab-case}')`,
  "naming"
);

// Reference validation
throw new CLIError(
  `Invalid reference from '${source}' to '${target}': target element not found`,
  "reference"
);

// Predicate validation
throw new CLIError(
  `Invalid relationship predicate '${predicate}' for element types '${sourceType}' and '${targetType}'`,
  "semantic"
);
```

## Message Standardization Patterns

### Consistent Wording

**Instead of:**
| ❌ Inconsistent | ✅ Consistent |
|---|---|
| "Could not find..." | "Element not found: ..." |
| "The layer doesn't exist" | "Layer not found: ..." |
| "Bad input format" | "Invalid format: ..." |
| "Unexpected error occurred" | "Internal error: ..." |

### Property and Field Names

Always use exact property names in error messages:

```typescript
// Good
throw new CLIError(`Missing required property 'method' on endpoint element`, "validation");

// Bad
throw new CLIError(`Missing HTTP method property`, "validation");
```

### File Paths

Always show relative paths from project root:

```typescript
// Good
`Failed to save: documentation-robotics/model/06_api/my-endpoint.yaml`
// Bad
`Failed to save: /home/user/project/documentation-robotics/model/06_api/my-endpoint.yaml`;
```

### Element IDs and References

Always show full element ID format:

```typescript
// Good
throw new CLIError(
  `Invalid cross-layer reference: '${sourceId}' references '${targetId}'`,
  "reference"
);

// Bad
throw new CLIError(`Cannot link 'order-service' to unknown element`, "reference");
```

## Debugging and Diagnostics

### Debug Mode

Enable debug output with environment variable:

```bash
DEBUG=1 dr add motivation goal test-goal
```

Debug output should include:

- Full error stack traces
- Internal state information
- Operation sequence trace

### Logging Patterns

```typescript
// Debug logging
if (process.env.DEBUG) {
  console.log(`[DEBUG] Processing element: ${element.id}`);
  console.log(`[DEBUG] Properties: ${JSON.stringify(element.properties)}`);
}

// Info logging
console.log(`✓ Successfully added element: ${element.id}`);

// Warning logging
console.warn(`⚠ Element already exists: ${element.id}, skipping`);

// Error logging
console.error(`✗ Failed to add element: ${reason}`);
```

## Type Safety and Assertions

### Avoiding Unsafe Type Assertions

**Problem Pattern:**

```typescript
// ❌ Loses type safety
const ref = (sourceObj as any).reference;
```

**Solution - Use Type Guards:**

```typescript
// ✅ Safe type narrowing
interface SourceObject {
  reference?: SourceReference;
}

function getSourceReference(sourceObj: unknown): SourceReference | undefined {
  if (!sourceObj || typeof sourceObj !== "object") {
    return undefined;
  }

  const obj = sourceObj as Record<string, unknown>;
  const ref = obj.reference;

  if (ref && typeof ref === "object" && hasSourceReferenceFields(ref)) {
    return ref as SourceReference;
  }

  return undefined;
}

function hasSourceReferenceFields(obj: unknown): obj is SourceReference {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const entry = obj as Record<string, unknown>;
  return typeof entry.type === "string" && typeof entry.file === "string";
}
```

### Type Guards for Properties

```typescript
// ✅ Safe property access with type narrowing
function getProperty<T>(
  properties: Record<string, unknown>,
  key: string,
  validate: (v: unknown) => v is T
): T | undefined {
  const value = properties[key];
  if (validate(value)) {
    return value;
  }
  return undefined;
}

// Usage
const method = getProperty<string>(
  element.properties,
  "method",
  (v): v is string => typeof v === "string"
);

if (!method) {
  throw new CLIError(
    `Endpoint '${element.id}' is missing required property 'method'`,
    "validation"
  );
}
```

## Common Error Scenarios

### Missing Required Field

```typescript
if (!element.properties["method"]) {
  throw new CLIError(
    `API endpoint '${element.id}' is missing required property 'method'`,
    "validation",
    `Use: dr update ${element.id} --property method=GET`
  );
}
```

### Invalid Element Reference

```typescript
if (!model.hasElement(targetId)) {
  throw new CLIError(
    `Cannot create reference: target element '${targetId}' does not exist`,
    "reference",
    `Ensure element exists before creating references to it`
  );
}
```

### Naming Convention Violation

```typescript
const validIdFormat = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
if (!validIdFormat.test(name)) {
  throw new CLIError(
    `Element name '${name}' violates naming convention (expected kebab-case)`,
    "naming",
    `Use only lowercase letters, numbers, and hyphens: 'my-element-name'`
  );
}
```

### Permission Denied

```typescript
try {
  await writeFile(filePath, content);
} catch (error) {
  if (error instanceof Error && error.message.includes("EACCES")) {
    throw new CLIError(
      `Permission denied: cannot write to '${filePath}'`,
      "permission",
      `Ensure you have write permissions for the model directory`
    );
  }
  throw error;
}
```

## Testing Error Messages

When testing error conditions, verify both the message and category:

```typescript
test("should report validation error for missing method", async () => {
  const element = new Element({
    id: "api.endpoint.create",
    type: "endpoint",
    name: "Create",
    properties: {}, // Missing 'method'
  });

  expect(() => validateEndpoint(element)).toThrow(CLIError);

  try {
    validateEndpoint(element);
  } catch (error) {
    if (error instanceof CLIError) {
      expect(error.category).toBe("validation");
      expect(error.message).toContain("method");
    }
  }
});
```

## Guidelines Summary

✅ **Do:**

- Use CLIError for all user-facing errors
- Provide specific context (element IDs, property names, paths)
- Include recovery hints when possible
- Use consistent error message format
- Use type guards instead of `as any` assertions
- Test error messages in unit tests

❌ **Don't:**

- Throw plain Error objects
- Use vague error messages
- Use technical jargon without context
- Leak internal stack traces to users
- Use `as any` for type assertions
- Mix error handling patterns

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture and design patterns
- [cli/src/utils/cli-error.ts](../cli/src/utils/cli-error.ts) - CLIError implementation
- [cli/src/validators/](../cli/src/validators/) - Validation pipeline examples
