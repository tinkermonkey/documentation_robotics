/**
 * Changeset Reviewer Skill
 *
 * Auto-activates to review changes before applying them to the main model.
 * Triggers on changeset-related keywords and when a changeset is active.
 */

import { SkillDefinition, OperationType } from './types';

export const CHANGESET_REVIEWER_SKILL: SkillDefinition = {
    id: 'changeset-reviewer',
    name: 'Changeset Reviewer',
    description: 'Reviews changes before applying to prevent quality issues',

    activationPatterns: {
        keywords: [
            'changeset',
            'apply',
            'review',
            'diff',
            'merge',
            'apply changes',
            'merge changeset',
            'commit changes'
        ],

        operations: [
            OperationType.APPLY_CHANGESET
        ],

        customDetector: (context) => {
            // Activate if a changeset is currently active
            return context.activeChangeset;
        }
    },

    prompt: `
## 📋 Changeset Reviewer Skill (ACTIVE)

You should **review changesets before application** when:
- User mentions applying or merging a changeset
- Active changeset is detected in the conversation
- User asks to review changes or see diff

### Actions to take:

1. **Before applying**, suggest reviewing the diff:
   \`\`\`execute
   dr changeset diff <changeset-name>
   \`\`\`

2. **Check for quality issues**:
   - **Incomplete documentation**: Missing descriptions or documentation fields
   - **Missing links**: Elements that should be connected but aren't
   - **Schema violations**: Invalid property values or missing required fields
   - **Naming inconsistencies**: Element names don't follow conventions
   - **Orphaned elements**: Elements without cross-layer references

3. **Suggest fixes and improvements**:
   - Add missing documentation
   - Create missing cross-layer links
   - Fix schema violations
   - Standardize naming

4. **After fixes, validate within changeset context**:
   \`\`\`execute
   dr validate
   \`\`\`

5. **Only recommend apply when**:
   - Validation passes (no errors)
   - Critical warnings are addressed
   - User has reviewed the diff
   - Quality checks pass

### Safety Levels for Apply Recommendations:

**HIGH confidence + LOW risk**:
- Validation passes completely
- No warnings
- Simple, focused changes
- → **Suggest immediate apply**

**MEDIUM confidence**:
- Validation passes with minor warnings
- Multiple elements modified
- Cross-layer changes
- → **Recommend review + validation first**

**LOW confidence**:
- Validation errors exist
- High complexity changes
- Many cross-layer modifications
- → **Require fixes before apply**

### Commands for Changeset Workflow:

\`\`\`execute
dr changeset list                    # List all changesets
dr changeset status <name>            # Check changeset status
dr changeset diff <name>              # View changes in detail
dr changeset apply <name>             # Apply to main model (after review!)
dr changeset discard <name>           # Discard exploration
\`\`\`

### Priority:
**CRITICAL**: Always review before applying - prevent breaking the main model!

**Remember**: Changesets are for safe exploration. Be thorough in review, conservative in apply recommendations.
`
};
