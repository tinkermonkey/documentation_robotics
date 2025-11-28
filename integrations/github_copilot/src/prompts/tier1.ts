export const TIER1_ESSENTIALS = `
# Documentation Robotics - Essentials

## Element ID Format
\`{layer}.{type}.{kebab-case-name}\`
Example: \`business.service.order-management\`

## 11 Architecture Layers
1. **motivation** - Strategic goals, requirements (WHY)
2. **business** - Business processes, services (WHAT)
3. **security** - Policies, permissions (WHO CAN)
4. **application** - Software components (HOW)
5. **technology** - Infrastructure (WITH WHAT)
6. **api** - Endpoints, operations (INTERFACE)
7. **data_model** - Logical structures (STRUCTURE)
8. **datastore** - Physical databases (STORAGE)
9. **ux** - Views, experiences (PRESENTATION)
10. **navigation** - Routes, flows (FLOW)
11. **apm** - Metrics, logs (OBSERVE)

## Essential CLI Commands
- \`dr find {id}\`: Get element details
- \`dr list {layer} {type}\`: List elements
- \`dr search {pattern}\`: Search model
- \`dr add {layer} {type} --name "..."\`: Create element
- \`dr update {id} --set k=v\`: Update element
- \`dr validate\`: Check model validity
- \`dr project {source}→{target}\`: Project across layers
`;
