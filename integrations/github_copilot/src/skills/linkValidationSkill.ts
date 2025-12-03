/**
 * Link Validation Skill
 *
 * Auto-activates to validate cross-layer references and suggest missing links.
 * Triggers on keywords related to linking, bulk operations, and cross-layer work.
 */

import { SkillDefinition, OperationType } from './types';

export const LINK_VALIDATION_SKILL: SkillDefinition = {
    id: 'link-validation',
    name: 'Link Validation',
    description: 'Validates cross-layer references and suggests missing links',

    activationPatterns: {
        keywords: [
            'link',
            'reference',
            'relationship',
            'traceability',
            'cross-layer',
            'projection',
            'connect',
            'relate',
            'associate'
        ],

        operations: [
            OperationType.ADD_ELEMENT,
            OperationType.MODIFY_ELEMENT
        ],

        customDetector: (context) => {
            // Activate if 3+ recent add operations (bulk operations likely need link validation)
            const addCount = context.recentCommands.filter(c => c.includes('dr add')).length;
            if (addCount >= 3) {
                return true;
            }

            // Activate if working across multiple layers (cross-layer work needs link validation)
            if (context.modifiedLayers.length >= 2) {
                return true;
            }

            return false;
        }
    },

    prompt: `
## 🔗 Link Validation Skill (ACTIVE)

You should **proactively validate cross-layer references** when:
- User adds or modifies elements across multiple layers
- User mentions links, references, relationships, or traceability
- Bulk operations are detected (3+ element additions)
- Cross-layer work is detected (2+ layers modified)

### Actions to take:

1. **After element operations**, suggest running:
   \`\`\`execute
   dr links validate
   \`\`\`

2. **If errors are found**, explain them clearly:
   - Broken links (target doesn't exist)
   - Type mismatches
   - Circular dependencies
   - Bidirectional inconsistencies

3. **Suggest missing links proactively** using naming patterns:
   - If adding \`api.operation.get-users\`, suggest linking to \`business.service.user-management\`
   - If adding \`application.component.auth-service\`, suggest linking to \`security.policy.authentication\`
   - If adding \`data_model.entity.order\`, suggest linking to \`business.object.order\`

4. **Verify bidirectional consistency** for reflexive link types:
   - If A links to B with type X, check if B links back to A with the inverse type

### Link Pattern Categories (62+ standardized patterns):

**Upward Projections** (dot-notation in properties):
- \`motivation.supports-goals\` - Links to motivation layer goals
- \`business.realizes-services\` - Links to business layer services
- \`security.enforces-policies\` - Links to security policies

**X-Extensions** (in OpenAPI/JSON schemas):
- \`x-archimate-ref\` - General ArchiMate references
- \`x-security-policies\` - Security policy references
- \`x-implements-requirements\` - Requirement traceability

**Direct Fields**:
- \`operationId\` - Links API operations
- \`schemaRef\` - Links to data schemas
- \`$ref\` - JSON Schema references

### Priority:
- **HIGH**: Run validation after bulk changes (3+ adds)
- **MEDIUM**: Run validation after cross-layer modifications
- **LOW**: Suggest validation when user mentions links/references

### Confidence Levels for Fix Suggestions:
- **HIGH (>90%)**: Auto-suggest immediate fix command
- **MEDIUM (70-90%)**: Explain the issue and offer fix
- **LOW (<70%)**: Explain issue, ask user for clarification on intent

**Remember**: Cross-layer traceability is critical for architecture quality. Be proactive about link validation!
`
};
