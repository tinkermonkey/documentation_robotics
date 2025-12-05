# Cross-Layer Link Validation Skill

When the user works with elements across multiple layers or mentions relationships/links:

1. Run `dr links validate` to check cross-layer references
2. Identify broken links, missing targets, or circular dependencies
3. Suggest link additions based on naming patterns
4. Verify bidirectional consistency

## When to Activate

This skill should activate when:

- User adds or modifies elements with references to other layers
- User mentions "links", "references", "relationships", or "traceability"
- User works across multiple layers simultaneously
- User asks questions like "what links to this" or "what depends on X"
- After importing or extracting models from code

## Tools Available

- Bash (for `dr links *` commands: validate, find, trace, etc.)
- Read (to examine element references and understand relationships)
- Grep (to find related elements by ID or name)
- Write (to update link registry if needed)

## Workflow

1. **Validate existing links:**

   ```bash
   dr links validate
   ```

2. **Analyze link issues:**
   - **Broken links:** Source element references non-existent target
   - **Orphaned elements:** Elements with no incoming or outgoing links
   - **Circular dependencies:** A→B→C→A cycles
   - **Missing registry entries:** References exist but not in link registry

3. **Discover potential links:**
   - Look for naming patterns (e.g., `user-service` → `user-api` → `user-data`)
   - Check layer adjacency (business should link to application, application to api, etc.)
   - Find implicit relationships in descriptions or properties

4. **Suggest fixes:**
   - High confidence: Broken link targets that exist elsewhere
   - Medium confidence: Pattern-based link suggestions
   - Low confidence: Semantic relationship suggestions

5. **Visualize relationships:**

   ```bash
   dr links find <element-id>
   ```

## Example Interaction

**User:** "I added a new API endpoint for user authentication, can you check if all the links are correct?"

**Assistant:** [Skill activates] Let me validate the cross-layer links...

```bash
dr links validate
```

I found some link issues:

1. ✅ **api/auth-login-endpoint** correctly links to:
   - application/authentication-service
   - data/user-credentials

2. ❌ **api/auth-login-endpoint** references **implementation/jwt-handler** but this link is not registered
   - **Fix:** Add link to registry
   - **Confidence:** 95%

3. ⚠️ **api/auth-login-endpoint** might also link to:
   - motivation/secure-user-access (business justification)
   - technology/jwt-library (implementation detail)
   - **Confidence:** 75% (based on naming patterns)

Would you like me to:

1. Add the missing link to jwt-handler?
2. Show you the full traceability chain for the auth endpoint?
3. Add the suggested links to motivation and technology layers?

## Link Discovery Patterns

The skill uses these patterns to suggest links:

**Layer Adjacency:**

- Motivation ↔ Business
- Business ↔ Application
- Application ↔ API
- API ↔ Data
- Data ↔ Implementation
- Implementation ↔ Technology
- Technology ↔ Physical

**Naming Patterns:**

- `{entity}-service` → `{entity}-api` → `{entity}-data`
- `{feature}-endpoint` → `{feature}-handler` → `{feature}-storage`

**Semantic Patterns:**

- Authentication/authorization elements often link together
- CRUD operations link to corresponding data models
- Services link to their deployment infrastructure

## Best Practices

- Always validate links after bulk operations
- Explain why a link is broken (target missing vs not registered)
- Show traceability chains when helpful (`dr links trace`)
- Don't auto-add low-confidence semantic links without asking
- Verify bidirectional consistency (if A→B exists, should B→A?)
- Group link issues by layer for easier understanding
