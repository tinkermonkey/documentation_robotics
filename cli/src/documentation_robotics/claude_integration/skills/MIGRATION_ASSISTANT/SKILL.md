# Migration Assistant Skill

When the user has an older spec version or mentions upgrading:

1. Check current spec version with `dr list --version`
2. If version < 0.2.0, explain what changed
3. Run `dr migrate --dry-run` to preview changes
4. Guide through migration process
5. Validate after migration

## When to Activate

This skill should activate when:

- Model spec version < current (0.2.0)
- User mentions "upgrade", "migrate", or "update spec"
- Validation errors indicate old format (deprecated properties, old schemas)
- User opens a project with outdated spec version
- User asks "how do I upgrade to the latest version"

## Tools Available

- Bash (for `dr migrate`, `dr list --version`, `dr validate`)
- Read (to check model metadata and understand current state)
- Edit (to manually fix issues if migration fails)
- Write (to update metadata or fix edge cases)

## Workflow

1. **Check current version:**

   ```bash
   dr list --version
   ```

2. **Explain changes:**
   - If v0.1.x → v0.2.0: Cross-layer links, link registry, spec schema updates
   - Show what will change and why
   - Highlight any breaking changes

3. **Run dry-run:**

   ```bash
   dr migrate --dry-run
   ```

   - Show what would change without actually modifying files
   - Identify potential issues

4. **Get user approval:**
   - Explain the migration plan
   - Ask for confirmation before proceeding
   - Recommend backing up or using a changeset

5. **Execute migration:**

   ```bash
   dr migrate
   ```

6. **Validate results:**

   ```bash
   dr validate --strict
   ```

   - Fix any migration artifacts
   - Verify cross-layer links are intact
   - Check that all elements are valid

7. **Report results:**
   - What was migrated
   - Any manual fixes needed
   - Next steps (validate, test, commit)

## Example Interaction

**User:** "My model seems to be using an old format, can you help me upgrade?"

**Assistant:** [Skill activates] Let me check your spec version...

```bash
dr list --version
```

Your model is using spec v0.1.5. The current version is v0.2.0.

**Key changes in v0.2.0:**

- **Cross-layer link registry:** Links between layers are now explicitly registered
- **Enhanced schema validation:** Stricter property requirements
- **New metadata format:** Updated metadata.json structure
- **Link bidirectional consistency:** Forward and backward links are validated

Before migrating, let me show you what will change:

```bash
dr migrate --dry-run
```

**Preview of changes:**

- 47 elements will be updated to new schema format
- 23 cross-layer references will be added to link registry
- metadata.json will be upgraded to v0.2.0 format
- 3 deprecated properties will be removed

**Recommendation:** Create a changeset first to isolate these changes:

```bash
dr changeset create upgrade-to-v0.2.0
```

This lets you preview changes before applying them to your main model. Should I proceed with creating the changeset and running the migration?

## Migration Checklist

After running migration, verify:

- [ ] All elements have valid schemas
- [ ] Cross-layer links are registered
- [ ] Metadata version updated to 0.2.0
- [ ] No deprecated properties remain
- [ ] Validation passes with --strict
- [ ] Naming conventions still valid
- [ ] Tests still pass (if applicable)

## Common Migration Issues

**Issue 1: Missing link targets**

- **Cause:** Referenced element doesn't exist
- **Fix:** Remove invalid reference or create missing element

**Issue 2: Deprecated property values**

- **Cause:** Old enum values no longer valid
- **Fix:** Update to new valid values (e.g., status: "active" → "approved")

**Issue 3: Circular dependencies**

- **Cause:** Link registry exposes existing cycles
- **Fix:** Restructure relationships to break cycle

## Best Practices

- Always run `--dry-run` first
- Use a changeset for safety
- Backup before migrating (or ensure git history)
- Validate thoroughly after migration
- Check that tests still pass
- Review diffs before committing changes
- Don't auto-migrate without user approval
