# Spec-CLI Consistency Validator Skill

When the user modifies layer specifications, schemas, or CLI implementation, this skill validates that the spec and CLI remain in sync.

## When to Activate

This skill should activate when:

- User modifies files in `spec/layers/*.md`
- User modifies files in `spec/schemas/*.schema.json`
- User modifies files in `cli/src/documentation_robotics/schemas/bundled/*.schema.json`
- User modifies `cli/src/documentation_robotics/core/layer.py`
- User modifies validators or export formatters
- User mentions "consistency", "sync", "spec", "schema mismatch"
- Before committing changes to spec or CLI
- User asks "are spec and CLI in sync?"

## Tools Available

- Bash (for running validation commands, git diff, grep)
- Read (to examine spec files, schemas, and CLI code)
- Grep (to search for references and definitions)
- Glob (to find related files)

## Validation Checks

### 1. Schema Synchronization

**Check:** Schemas in `spec/schemas/` match `cli/src/documentation_robotics/schemas/bundled/`

```bash
# Compare schema files
for schema in spec/schemas/*.schema.json; do
    basename=$(basename "$schema")
    cli_schema="cli/src/documentation_robotics/schemas/bundled/$basename"

    if [ ! -f "$cli_schema" ]; then
        echo "❌ Missing CLI schema: $basename"
    else
        diff -q "$schema" "$cli_schema" || echo "❌ Schema mismatch: $basename"
    fi
done
```

**Report:**

- ✅ Schemas in sync
- ❌ Schema exists in spec but not CLI
- ❌ Schema exists in CLI but not spec
- ❌ Schema content differs between spec and CLI

**Auto-fix suggestion:**

```bash
# Copy spec schemas to CLI
cp spec/schemas/*.schema.json cli/src/documentation_robotics/schemas/bundled/
```

### 2. Layer Definition Consistency

**Check:** Layer names in `spec/layers/` match enum in `cli/src/documentation_robotics/core/layer.py`

**Steps:**

1. Extract layer names from spec:

   ```bash
   ls spec/layers/*.md | sed 's/.*\/\([0-9]*\)-\(.*\)-layer.md/\2/' | sort
   ```

2. Extract layer enum from CLI:

   ```bash
   grep -A 50 "class LayerType" cli/src/documentation_robotics/core/layer.py
   ```

3. Compare lists and report mismatches

**Report:**

- ✅ All spec layers have CLI enum entries
- ✅ All CLI enum entries have spec documents
- ❌ Layer defined in spec but missing from CLI enum
- ❌ Layer in CLI enum but no spec document
- ⚠️ Layer numbering mismatch

### 3. Element Type Validation

**Check:** Element types documented in spec match what CLI validators expect

**For each layer:**

1. Extract element types from `spec/layers/{layer}-layer.md`
2. Extract element types from corresponding JSON schema
3. Check if CLI validators reference these types
4. Verify export formatters handle these types

**Report:**

- ✅ Element types consistent across spec, schema, and CLI
- ❌ Element type in spec but not in schema
- ❌ Element type in schema but not validated by CLI
- ⚠️ Element type not handled by any exporter

### 4. Cross-Layer Reference Types

**Check:** Link types documented in spec match `cli/src/documentation_robotics/schemas/link-registry.json`

```bash
# Read link registry
cat cli/src/documentation_robotics/schemas/link-registry.json
```

**Compare with:**

- Link type tables in `spec/layers/*.md`
- Cross-layer reference documentation in `spec/core/`

**Report:**

- ✅ Link types match between spec and link-registry.json
- ❌ Link type in spec but not in registry
- ❌ Link type in registry but not documented in spec
- ⚠️ Link type description mismatch

### 5. Export Format Mappings

**Check:** Export formats documented in spec match CLI exporters

**Steps:**

1. Read export format mappings from spec documentation
2. Check which exporters exist in `cli/src/documentation_robotics/export/`
3. Verify each exporter's layer support matches spec

**Report:**

- ✅ Export formats match spec documentation
- ❌ Exporter exists but not documented in spec
- ❌ Export format documented but no exporter exists
- ⚠️ Layer support mismatch between spec and exporter

### 6. Validation Rules

**Check:** Validation rules documented in spec are implemented in CLI

**For each layer spec:**

1. Extract validation rules from "Validation" section
2. Check corresponding validator in `cli/src/documentation_robotics/validators/`
3. Verify rules are implemented

**Report:**

- ✅ All documented validation rules implemented
- ❌ Validation rule documented but not implemented
- ⚠️ Validator has rules not documented in spec
- 💡 Suggest documenting undocumented rules

### 7. Version Compatibility

**Check:** Spec version and CLI version compatibility

```bash
# Read versions
spec_version=$(cat spec/VERSION)
cli_version=$(grep '^version = ' cli/pyproject.toml | cut -d'"' -f2)

echo "Spec: $spec_version"
echo "CLI: $cli_version"
```

**Check compatibility matrix:**

- CLI version should be >= spec version (can be ahead)
- If spec version changed, check CLI CHANGELOG for compatibility notes
- Verify `cli/pyproject.toml` lists supported spec versions

**Report:**

- ✅ CLI supports current spec version
- ⚠️ CLI version significantly ahead of spec (may need spec update)
- ❌ CLI version behind spec (requires update)

## Workflow

### Phase 1: Detect Changes (5% of time)

Identify what changed:

```bash
# Check git status for modified files
git status --short spec/ cli/
```

**Categorize changes:**

- Schema changes
- Layer spec changes
- CLI implementation changes
- Documentation changes

### Phase 2: Run Validation Checks (60% of time)

Run all applicable checks based on what changed:

1. **Always run:** Schema synchronization, version compatibility
2. **If spec/layers/ changed:** Layer definition consistency, element type validation
3. **If schemas changed:** Element type validation, cross-layer reference types
4. **If CLI validators changed:** Validation rules consistency
5. **If CLI exporters changed:** Export format mappings

### Phase 3: Report Findings (25% of time)

Generate comprehensive report:

````markdown
# Spec-CLI Consistency Report

## Summary

- ✅ 12 checks passed
- ❌ 3 issues found
- ⚠️ 2 warnings

## Critical Issues

### ❌ Schema Mismatch: 06-api-layer.schema.json

**Location:** spec/schemas/06-api-layer.schema.json vs cli/schemas/bundled/
**Issue:** Schema in spec has new `operationSecurity` field not present in CLI
**Impact:** CLI validation will reject valid spec-compliant models
**Fix:** Copy updated schema to CLI:

```bash
cp spec/schemas/06-api-layer.schema.json cli/src/documentation_robotics/schemas/bundled/
```
````

### ❌ Missing Layer Definition: 13-deployment

**Location:** spec/layers/13-deployment-layer.md exists but no CLI enum entry
**Issue:** New layer documented in spec but not implemented in CLI
**Impact:** Users cannot create deployment layer elements
**Fix:** Add to `cli/src/documentation_robotics/core/layer.py`:

```python
DEPLOYMENT = "deployment"
```

## Warnings

### ⚠️ Undocumented Validation Rule

**Location:** cli/validators/semantic.py:142
**Issue:** CLI validates that API endpoints must have at least one security scheme, but this rule is not documented in spec/layers/06-api-layer.md
**Impact:** Users may be surprised by validation failures
**Suggestion:** Document this rule in the spec

## Auto-fix Available

Run these commands to fix critical issues:

```bash
# Sync schemas
cp spec/schemas/*.schema.json cli/src/documentation_robotics/schemas/bundled/

# Run tests to verify
cd cli && pytest tests/unit/test_schema_validation.py
```

## Next Steps

1. Review and apply suggested fixes
2. Update tests for new layer/element types
3. Update CHANGELOG if spec version needs bump
4. Re-run consistency check after fixes

```markdown

### Phase 4: Suggest Fixes (10% of time)

For each issue, provide:

1. **High-confidence fixes** (>90% certainty):
   - Exact command to run
   - Offer to apply automatically

2. **Medium-confidence fixes** (70-90% certainty):
   - Suggested approach
   - Ask user to confirm before applying

3. **Low-confidence warnings** (<70% certainty):
   - Highlight potential issue
   - Request user investigation

## Confidence Scoring

**High (90-100%):**
- Schema file content mismatch (byte-for-byte comparison)
- Missing files (file exists in one location but not other)
- Version number comparisons

**Medium (70-89%):**
- Layer enum mismatches (name comparison with fuzzy matching)
- Element type mismatches (requires parsing docs and code)
- Export format mapping issues

**Low (50-69%):**
- Validation rule documentation gaps (requires semantic analysis)
- Description mismatches between spec and CLI

## Example Interaction

**User:** "I just updated the API layer spec to add support for webhooks. Can you check if everything is consistent?"

**Assistant:** [Skill activates] Let me validate spec-CLI consistency after your API layer changes...

Running consistency checks:

1. ✅ Schema synchronization... OK (all schemas in sync)
2. ✅ Layer definitions... OK (api layer exists in both)
3. ❌ Element type validation... ISSUES FOUND
4. ✅ Cross-layer references... OK
5. ⚠️ Export format mappings... WARNING
6. ❌ Validation rules... ISSUES FOUND
7. ✅ Version compatibility... OK (CLI 0.7.3, Spec 0.6.0)

**Issues Found:**

### ❌ New Element Type Not in Schema
You added `webhook` as a new element type in `spec/layers/06-api-layer.md`, but the JSON schema doesn't include it.

**Fix (High Confidence 95%):**
Add to `spec/schemas/06-api-layer.schema.json`:
```json
{
  "type": "webhook",
  "properties": {
    "url": { "type": "string", "format": "uri" },
    "events": { "type": "array", "items": { "type": "string" } },
    "method": { "enum": ["POST", "PUT"] }
  }
}
````

Then sync to CLI:

```bash
cp spec/schemas/06-api-layer.schema.json cli/src/documentation_robotics/schemas/bundled/
```

### ⚠️ Webhook Elements May Not Export

The OpenAPI exporter (`cli/export/openapi_exporter.py`) doesn't have logic to handle webhook elements. They may be ignored during export.

**Suggestion (Medium Confidence 75%):**
Consider adding webhook support to OpenAPI exporter using the `x-webhooks` extension from OpenAPI 3.1.

Would you like me to:

1. Add the webhook type to the schema and sync it?
2. Show you how to extend the OpenAPI exporter?
3. Create a GitHub issue to track webhook export support?

## Best Practices

1. **Run after every spec change**: Catch drift early
2. **Run before releases**: Ensure consistency before version bumps
3. **Run in CI/CD**: Add as pre-commit or pre-push hook
4. **Trust high-confidence fixes**: They're safe to auto-apply
5. **Investigate warnings**: They often reveal undocumented assumptions
6. **Keep schemas synchronized first**: Schema mismatches break everything
7. **Document validation rules**: Undocumented rules confuse users
8. **Test after fixes**: Always run tests after applying fixes

## Integration with Other Tools

**Works well with:**

- **Schema Sync Agent**: Automatically syncs schemas between spec and CLI
- **Release Pre-flight Agent**: Runs consistency checks before version bumps
- **dr-architect**: Uses consistency data to guide architectural decisions

**Pre-commit Hook:**

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check for spec or CLI changes
if git diff --cached --name-only | grep -qE '^(spec/|cli/src/)'; then
    echo "🔍 Running spec-CLI consistency check..."
    # Activate skill or run validation
    # (Claude Code integration needed)
fi
```

## Error Handling

### Scenario: File Not Found

```text
Error: spec/schemas/06-api-layer.schema.json not found

Recovery:
1. Check if file was renamed or moved
2. Search for schema by layer number: find spec/ -name "*06*schema*"
3. If file genuinely missing, report as critical issue
```

### Scenario: Malformed JSON Schema

```text
Error: Invalid JSON in spec/schemas/07-data-model-layer.schema.json
Line 42: Unexpected token '}'

Recovery:
1. Validate JSON syntax: python -m json.tool < schema.json
2. Report syntax error location
3. Do not proceed with other checks until fixed
```

### Scenario: Git Not Available

```text
Warning: Cannot detect recent changes (git not installed)

Fallback:
1. Run all validation checks (conservative approach)
2. Suggest installing git for better change detection
3. Continue with full validation
```

## Performance Notes

- **Fast checks** (< 1s): Schema file comparison, version reading
- **Medium checks** (1-5s): Layer enum parsing, link registry validation
- **Slow checks** (5-15s): Element type deep validation, validation rule analysis

**Optimization:**

- If no spec/ changes detected, skip spec-specific checks
- If no CLI changes detected, skip CLI-specific checks
- Cache parsed schemas and specs between runs
- Run checks in parallel where possible
