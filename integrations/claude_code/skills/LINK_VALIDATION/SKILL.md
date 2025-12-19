# Cross-Layer Relationship Validation Skill

When the user works with elements across multiple layers or mentions relationships:

1. Run `dr links validate` to check cross-layer references
2. Identify broken relationships, missing targets, or circular dependencies
3. Suggest relationship additions based on naming patterns
4. Verify bidirectional consistency

## When to Activate

This skill should activate when:

- User adds or modifies elements with references to other layers
- User mentions "relationships", "references", "traceability", or cross-layer connections
- User works across multiple layers simultaneously
- User asks questions like "what relationships exist for this" or "what depends on X"
- After importing or extracting models from code

## Tools Available

- Bash (for `dr links *` commands: validate, find, trace, etc.)
- Read (to examine element references and layer schemas)
- Grep (to find related elements by ID or name)
- Write (to update model files if needed)

## Workflow

1. **Validate existing relationships:**

   ```bash
   dr links validate
   ```

2. **Analyze relationship issues:**
   - **Broken relationships:** Source element references non-existent target
   - **Orphaned elements:** Elements with no incoming or outgoing relationships
   - **Circular dependencies:** A→B→C→A cycles
   - **Invalid relationship types:** Relationship not defined in layer schema or catalog

3. **Discover potential relationships:**
   - Look for naming patterns (e.g., `user-service` → `user-api` → `user-data`)
   - Check layer adjacency (business should link to application, application to api, etc.)
   - Find implicit relationships in descriptions or properties

4. **Suggest fixes:**
   - High confidence: Broken relationship targets that exist elsewhere
   - Medium confidence: Pattern-based relationship suggestions
   - Low confidence: Semantic relationship suggestions

5. **Visualize relationships:**

   ```bash
   dr links find <element-id>
   ```

## Example Interaction

**User:** "I added a new API endpoint for user authentication, can you check if all the relationships are correct?"

**Assistant:** [Skill activates] Let me validate the cross-layer relationships...

```bash
dr links validate
```

I found some relationship issues:

1. ✅ **api/auth-login-endpoint** correctly links to:
   - application/authentication-service
   - data/user-credentials

2. ❌ **api/auth-login-endpoint** references **implementation/jwt-handler** but this relationship is not defined in the API layer schema
   - **Fix:** This appears to be a valid implementation reference
   - **Confidence:** 95%

3. ⚠️ **api/auth-login-endpoint** might also link to:
   - motivation/secure-user-access (business justification)
   - technology/jwt-library (implementation detail)
   - **Confidence:** 75% (based on naming patterns)

Would you like me to:

1. Verify the jwt-handler reference is appropriate?
2. Show you the full traceability chain for the auth endpoint?
3. Add the suggested relationships to motivation and technology layers?

## Relationship Discovery Patterns

The skill uses these patterns to suggest relationships:

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

- Always validate relationships after bulk operations
- Explain why a relationship is broken (target missing vs not defined in schema)
- Show traceability chains when helpful (`dr links trace`)
- Don't auto-add low-confidence semantic relationships without asking
- Verify bidirectional consistency (if A→B exists, should B→A?)
- Group relationship issues by layer for easier understanding
