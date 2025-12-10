# Agent Guidance: Array Property Handling in Documentation Robotics CLI

## Overview

The `dr update-element` command has been enhanced with **additive-by-default** behavior for array properties, making it safe and reliable for agents to incrementally build model properties.

## Critical Breaking Change

**⚠️ BREAKING CHANGE:** The `--set` flag is now **additive by default** for array properties.

- **OLD BEHAVIOR:** `--set` would overwrite existing values
- **NEW BEHAVIOR:** `--set` appends to arrays, only replaces scalars

This change prevents data loss and makes the CLI more reliable for automated agents.

## Array Property Detection

The CLI automatically detects array properties through three mechanisms:

### 1. Well-Known Properties (from Documentation Robotics Spec)

These properties are always treated as arrays:

- `deployedOn` - Technology deployment mapping
- `realizes`, `serves`, `uses` - Service relationships
- `depends-on`, `dependsOn` - Dependencies
- `assigned-to`, `assignedTo` - Assignment relationships
- `implements`, `supports` - Implementation relationships
- `connects-to`, `connectsTo` - Connection relationships
- `triggers`, `includes`, `extends`, `provides` - Other relationships
- `composed-of`, `composedOf`, `contains` - Composition relationships
- `exposes`, `consumes`, `produces` - API relationships
- `stores`, `retrieves`, `validates`, `transforms` - Data relationships

### 2. Existing Array Values

If a property already contains an array, it remains an array.

### 3. Schema Definitions

If a schema defines a property as `type: "array"`, it's treated as an array.

## Command Reference

### --set: Add to Arrays (Additive - Default)

**Use Case:** Build up array properties incrementally

```bash
# First value - creates array
dr update-element app.component.viewer --set deployedOn=technology.framework.react

# Second value - APPENDS (doesn't overwrite)
dr update-element app.component.viewer --set deployedOn=technology.language.typescript

# Third value - continues appending
dr update-element app.component.viewer --set deployedOn=technology.library.react-flow

# Result: deployedOn = [react, typescript, react-flow]
```

**Output:**

```
Updating element: app.component.viewer

Set properties:
  ✓ deployedOn (array with 3 values):
    • technology.framework.react
    • technology.language.typescript
    • technology.library.react-flow

✓ Successfully updated element: app.component.viewer
```

**For Scalar Properties:** `--set` still replaces the value:

```bash
dr update-element app.component.viewer --set status=active
dr update-element app.component.viewer --set status=deprecated  # Replaces active

# Result: status = "deprecated"
```

### --replace: Complete Overwrite

**Use Case:** Replace entire property (array or scalar)

```bash
# Replace entire array with single value
dr update-element app.component.viewer --replace deployedOn=technology.language.python

# Result: deployedOn = "python" (no longer an array)
```

**Output:**

```
Updating element: app.component.viewer

Replaced properties:
  ⚠ deployedOn = technology.language.python

✓ Successfully updated element: app.component.viewer
```

### --remove: Remove Specific Value from Array

**Use Case:** Remove one value from an array property

```bash
# Remove specific technology from array
dr update-element app.component.viewer --remove deployedOn=technology.framework.react

# Result: deployedOn = [typescript, react-flow]
```

**Output:**

```
Updating element: app.component.viewer

Removed from arrays:
  ✓ Removed from deployedOn
    Remaining values (2):
    • technology.language.typescript
    • technology.library.react-flow

✓ Successfully updated element: app.component.viewer
```

### --unset: Remove Property Entirely

**Use Case:** Delete a property completely

```bash
# Remove entire property
dr update-element app.component.viewer --unset deployedOn

# Result: deployedOn property no longer exists
```

**Output:**

```
Updating element: app.component.viewer

Removed properties:
  ✓ deployedOn (was: [technology.framework.react, technology.language.typescript])

✓ Successfully updated element: app.component.viewer
```

## Agent Usage Patterns

### Pattern 1: Incremental Array Building (Most Common)

```bash
# Agents can safely make multiple calls without data loss
dr update-element ${COMPONENT_ID} --set deployedOn=${TECH1}
dr update-element ${COMPONENT_ID} --set deployedOn=${TECH2}
dr update-element ${COMPONENT_ID} --set deployedOn=${TECH3}

# All three values are preserved!
```

### Pattern 2: Mixed Operations

```bash
# Combine different operations in one call
dr update-element ${COMPONENT_ID} \
  --set deployedOn=${NEW_TECH} \
  --replace status=active \
  --unset deprecated-field

# Or make separate calls
dr update-element ${COMPONENT_ID} --set deployedOn=${NEW_TECH}
dr update-element ${COMPONENT_ID} --replace status=active
dr update-element ${COMPONENT_ID} --unset deprecated-field
```

### Pattern 3: Array Cleanup

```bash
# Remove obsolete technologies
dr update-element ${COMPONENT_ID} --remove deployedOn=${OLD_TECH1}
dr update-element ${COMPONENT_ID} --remove deployedOn=${OLD_TECH2}

# Or reset completely
dr update-element ${COMPONENT_ID} --replace deployedOn=${NEW_TECH}
```

## Feedback and Error Handling

### Success Feedback

The CLI provides clear feedback showing:

- **Current array size** for array properties
- **All current values** listed with bullet points
- **Operation type** (Set/Replaced/Removed)

### Error Cases

```bash
# Removing non-existent value
dr update-element app.component.viewer --remove deployedOn=not-there
# Output: ✗ Error in --remove: Value 'not-there' not found in deployedOn

# Unsetting non-existent property
dr update-element app.component.viewer --unset nonexistent
# Output: ✗ Error in --unset: Property 'nonexistent' not found
```

## Migration Guide for Agents

### If Your Agent Was Using OLD Behavior

**OLD CODE (assuming overwrite):**

```bash
# Agent built up values in a single call
dr update-element ${ID} --spec complete-config.yaml
```

**NEW CODE (leveraging additive behavior):**

```bash
# Agent can now make incremental updates safely
for tech in ${TECHNOLOGIES[@]}; do
  dr update-element ${ID} --set deployedOn=${tech}
done

# Or use --replace if overwrite is needed
dr update-element ${ID} --replace deployedOn=${FINAL_VALUE}
```

### If Your Agent Was Manually Editing YAML

**OLD WORKAROUND:**

```bash
# Manually edit YAML to create arrays
yq eval ".deployedOn = [\"${TECH1}\", \"${TECH2}\"]" -i ${FILE}
```

**NEW APPROACH:**

```bash
# Use CLI with confidence
dr update-element ${ID} --set deployedOn=${TECH1}
dr update-element ${ID} --set deployedOn=${TECH2}
# No manual file editing needed!
```

## Duplicate Prevention

The CLI automatically prevents duplicate values in arrays:

```bash
dr update-element ${ID} --set deployedOn=technology.framework.react
dr update-element ${ID} --set deployedOn=technology.framework.react  # Duplicate ignored

# Result: deployedOn = [technology.framework.react] (only one entry)
```

## Dry Run Mode

Test operations without making changes:

```bash
dr update-element ${ID} --set deployedOn=${TECH} --dry-run

# Output shows what WOULD happen:
# Would set properties (additive for arrays):
# deployedOn: technology.framework.react
#
# Dry run - not saving
```

## Best Practices for Agents

1. **Use `--set` for incremental building** - It's safe and prevents data loss
2. **Use `--replace` sparingly** - Only when you truly want to overwrite
3. **Check feedback** - The CLI tells you exactly what happened
4. **Use `--dry-run` first** - Preview changes before applying
5. **Leverage error messages** - They're designed to help agents recover

## Resolution of Issue #41

This implementation fully resolves [GitHub Issue #41](https://github.com/tinkermonkey/documentation_robotics/issues/41):

**Problem:** Sequential `dr update-element` commands were overwriting array properties instead of appending.

**Solution:**

- `--set` is now additive by default for array properties
- Array properties are auto-detected from spec, schema, and existing values
- Clear feedback shows all current values after each operation
- New `--replace` flag available when overwrite is needed

**Result:** Agents can now safely and incrementally build models without data loss.
