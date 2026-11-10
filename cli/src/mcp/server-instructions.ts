/**
 * Instructions the dr MCP server sends in its initialize result. Clients such as Claude Code
 * load them into the session at start (alongside only the tool names), so this is the agent's
 * map of how the tools fit together. Claude Code caps it at 4096 characters; a test holds it
 * under that and checks that every tool named here exists.
 */
export const SERVER_INSTRUCTIONS = `Documentation Robotics (DR) keeps an architecture model of the project in documentation-robotics/: layers from motivation (goals, requirements) through product, application, API, data and testing, linked by typed relationships. The base model describes the code as built. A planned change lives in a changeset until it lands with the code.

Project: tools serve the project the client has open. Pass rootPath only to work on a different project. If a tool reports that no model was found, the project has no DR model yet; tell the user (\`dr init\` creates one).

Read the model: model_search finds elements by name, model_show gives one element with its relationships, model_trace follows what depends on what, model_list lists a layer, model_info summarises the model. spec_type says which attributes a type takes and which relationships the catalog allows from and to it. Element ids are {layer}.{type}.{kebab-name}.

Plan a change (the /dr-plan workflow):
1. changeset_create opens a changeset and makes it active. While one is active, model_add, model_update, model_delete, relationship_add and relationship_delete stage into it, and the read tools show the model as the plan leaves it.
2. Check each type with spec_type before adding it, and link every new element to what it serves, realizes or depends on.
3. Pressure-test with changeset_brief (unwired elements, gaps against the catalog, drift from the base model) and changeset_impact (what a change touches).
4. Revise with changeset_update and changeset_unstage. changeset_deactivate returns to the base model; changeset_activate resumes a plan.

After building, changeset_verify compares the plan with what was built.

Landing a change is the human's step. Never try to commit or apply a changeset: tell the user it is ready to review and commit. changeset_discard deletes staged work for good; use it only when the user asks.`;
