# Schema Validation Skill

When the user's DR model has validation errors or they mention "validation", "errors", or "schema issues":

1. Run `dr validate` to check the current model
2. If errors found, categorize them by severity and layer
3. Suggest specific fixes with confidence scores
4. Offer to apply fixes automatically or guide manual fixes

## When to Activate

This skill should activate when:

- User mentions validation, errors, or schema issues
- Model files have been recently modified
- User asks about model quality or correctness
- User says things like "check my model" or "are there any issues"
- After bulk additions or modifications to model elements

## Tools Available

- Bash (for `dr validate` and `dr validate --strict`)
- Read (to examine model files and understand context)
- Edit (to apply fixes to model files)
- Write (if creating new files is needed)

## Workflow

1. **Validate the model:**

   ```bash
   dr validate --strict
   ```

2. **Analyze results:**
   - Categorize errors by layer (motivation, business, application, etc.)
   - Identify severity (critical schema violations vs warnings)
   - Look for patterns (e.g., all errors in one layer)

3. **Suggest fixes with confidence scores:**
   - High confidence (90%+): Direct schema violations, missing required fields
   - Medium confidence (70-89%): Naming conventions, reference issues
   - Low confidence (50-69%): Semantic issues, design improvements

4. **Present options:**
   - "I found X errors. Would you like me to fix them automatically?"
   - "I can fix high-confidence issues now and guide you through the others"
   - "Let me show you each error and we'll fix them together"

5. **Apply or guide fixes:**
   - For automatic fixes: Edit files, then re-validate
   - For guided fixes: Explain the issue and suggest the correction
   - Always validate after fixing to ensure success

## Example Interaction

**User:** "I just added some elements, are there any issues?"

**Assistant:** [Skill activates] Let me validate your model...

```bash
dr validate --strict
```

I found 3 validation errors:

1. ❌ **motivation/improve-user-experience** - Invalid status "active" (should be "proposed" or "approved")
   - **Fix:** Change status to "proposed"
   - **Confidence:** 95%

2. ⚠️ **api/user-profile-endpoint** - References data/user-profile but link not in registry
   - **Fix:** Add link: `api/user-profile-endpoint → data/user-profile`
   - **Confidence:** 90%

3. ⚠️ **business/customer-onboarding** - Missing recommended property "stakeholders"
   - **Fix:** Add stakeholders array
   - **Confidence:** 70%

Would you like me to fix issues #1 and #2 automatically (high confidence), and guide you through #3?

## Best Practices

- Always run validation before suggesting it's complete
- Group related errors together (e.g., all missing link registrations)
- Explain WHY something is an error, not just WHAT the error is
- After fixes, always re-validate to confirm success
- Don't be overly aggressive with automatic fixes - ask first for medium/low confidence
