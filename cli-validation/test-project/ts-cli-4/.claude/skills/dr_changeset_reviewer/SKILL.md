# Changeset Reviewer Skill

When the user works with changesets or asks for review:

1. List current changeset with `dr changeset list`
2. Show changes with `dr changeset diff`
3. Review additions/removals for naming consistency, reference validity, and layer-appropriate properties
4. Suggest improvements before applying

## When to Activate

This skill should activate when:

- User mentions "changeset", "review changes", or "diff"
- User is about to apply a changeset
- User asks "what changed" or "what did I add"
- User requests review before applying changes
- After making multiple changes in a changeset

## Tools Available

- Bash (for `dr changeset *` commands: list, diff, apply, discard)
- Read (to examine changeset files and understand context)
- Grep (to check naming patterns and find similar elements)

## Workflow

1. **Show current changeset:**

   ```bash
   dr changeset list
   ```

2. **Display diff:**

   ```bash
   dr changeset diff
   ```

3. **Review each change:**
   - **Additions:** Check naming, required properties, valid references
   - **Modifications:** Ensure changes make sense, don't break links
   - **Deletions:** Verify no dangling references remain

4. **Check for issues:**
   - Naming consistency (follows existing patterns?)
   - Reference validity (all referenced elements exist?)
   - Layer-appropriate properties (right properties for the layer?)
   - Relationship validation (cross-layer references valid in layer schemas?)

5. **Suggest improvements:**
   - Better naming conventions
   - Missing properties that should be added
   - Potential relationships that should be validated
   - Elements that might need to be added to support the change

6. **Recommend action:**
   - Apply if everything looks good
   - Fix issues first if problems found
   - Discard if changes are no longer needed

## Example Interaction

**User:** "Can you review my changeset before I apply it?"

**Assistant:** [Skill activates] Let me check what's in your current changeset...

```bash
dr changeset list
dr changeset diff
```

**Changeset:** explore-caching (active)

**Changes:**

**Additions (3):**

1. ✅ `application/cache-service`
   - Type: service
   - Description: "Caching layer for API responses"
   - Status: proposed
   - **Good:** Clear description, appropriate status

2. ⚠️ `technology/redis`
   - Type: technology
   - Description: "Redis cache"
   - **Issue:** Missing version property (recommended for technology layer)
   - **Suggestion:** Add `"version": "7.0"` or latest

3. ❌ `api/cache-endpoint`
   - References: `application/cache-service`, `data/cache-store`
   - **Issue:** References `data/cache-store` but this element doesn't exist
   - **Fix:** Either create `data/cache-store` or remove the reference

**Modifications (1):**

1. ✅ `api/user-profile-endpoint`
   - Added reference to `application/cache-service`
   - **Good:** Makes sense to integrate caching

**Deletions (0):**
None

**Missing Elements:**

- `data/cache-store` - Referenced by api/cache-endpoint but not created

**Cross-Layer Relationships:**

- ⚠️ New cross-layer relationships need validation:
  - application/cache-service → technology/redis
  - api/cache-endpoint → application/cache-service

**Recommendations:**

1. Add version to technology/redis
2. Create data/cache-store element
3. Validate cross-layer relationships
4. Consider adding motivation/improve-performance to justify caching

Would you like me to:

- Help you fix these issues before applying?
- Apply anyway (some issues are warnings, not blockers)?
- Show you how to add the missing elements?

## Review Checklist

For each addition, check:

- [ ] Naming follows conventions (kebab-case, descriptive)
- [ ] Required properties present (id, type, description, status)
- [ ] Layer-appropriate properties used
- [ ] References point to existing elements
- [ ] Status is valid for the element type

For each modification, check:

- [ ] Changes make logical sense
- [ ] Don't break existing links
- [ ] Updated properties are valid
- [ ] Description updated if behavior changed

For each deletion, check:

- [ ] No elements reference this one
- [ ] Links are updated/removed
- [ ] Deletion is intentional (not accidental)

For the changeset overall:

- [ ] Changes are cohesive (related to single feature/idea)
- [ ] Naming is consistent across new elements
- [ ] Cross-layer links are registered
- [ ] No orphaned references

## Common Issues

**Issue 1: Broken references**

- New element references non-existent element
- **Fix:** Create the referenced element or remove reference

**Issue 2: Missing link registration**

- Cross-layer references not in link registry
- **Fix:** Register links with `dr update ...`

**Issue 3: Inconsistent naming**

- New elements don't follow existing patterns
- **Fix:** Rename to match conventions

**Issue 4: Incomplete feature**

- Elements added across some layers but not others
- **Fix:** Complete the traceability chain (e.g., add business justification)

## Best Practices

- Review changesets before applying, not after
- Check that the changeset is focused (single feature/experiment)
- Verify all cross-layer references are valid
- Suggest improvements, but don't be overly strict
- Explain WHY something might be an issue
- After applying, always validate the full model
