/**
 * Instructions the dr MCP server sends in its initialize result. Clients such as Claude Code
 * load them into the session at start (alongside only the tool names), so this is the agent's
 * map of how the tools fit together. Claude Code caps it at 4096 characters; a test holds it
 * under that and checks that every tool named here exists.
 */
export const SERVER_INSTRUCTIONS = `Documentation Robotics (DR) keeps an architecture model of the project in documentation-robotics/: layers from motivation (goals, requirements) through product, application, API, data and testing, linked by typed relationships. The base model describes the code as built. A planned change lives in a changeset until it lands with the code. The user should never need to type a dr command: do each step with these tools, and never tell them to run dr for something a tool does.

Start with project_status. It reports the model, its spec version, the changesets, the code index, code changed since the model, and the viewer, and ends with nextStep: the tool to call next. Call it again after a step. Tools serve the project the client has open; pass rootPath only for another.

Confirm with the user, and wait for their answer, before you create: the model's name (project_init); whether to bootstrap the model from the code now or grow it with each change; a changeset's name and intent (changeset_create). Propose each, don't decide it.

Set up: with no model, propose project_init. If the model's spec is behind this dr, call project_upgrade to preview the migration, show it to the user, and call it with apply: true only when they approve.

Read the model: model_search finds elements, model_show gives one with its relationships, model_trace follows dependencies, model_list lists a layer. spec_type says which attributes a type takes and which relationships the catalog allows. Element ids are {layer}.{type}.{kebab-name}.

Plan a change (the /dr-plan workflow):
1. changeset_create opens a changeset and makes it active. While one is active, model_add, model_update, model_delete, relationship_add and relationship_delete stage into it, and the reads show the model as the plan leaves it. Stage many changes in one call: model_add with elements: [...], relationship_add with relationships: [...].
2. Check each type with spec_type before adding it, and link every new element to what it serves, realizes or depends on.
3. Pressure-test with changeset_brief (compact; unwired: "summary" adds unwired connections) and changeset_impact. Revise with changeset_update and changeset_unstage. changeset_deactivate sets a plan aside; changeset_activate resumes it.
4. Review: give the user review_open's url, which opens the changeset in the viewer (if it is still starting, call it again). They comment there; read with annotation_list, answer with annotation_reply.
5. Build from changeset_brief with sections: ["layers"] (detail: "full" for everything). Then codebase_extract with since (the branch the work started from) stages what was built into an as-built changeset, never written by hand; changeset_verify compares the plan with it. Its unverifiable items and notes need no plan edit.

Code: codebase_index indexes in the background. Call it with wait: 30, then with status: true and wait: 30 until job.state is done (or failed: report its error and logPath). codebase_verify checks only the API layer (the code's routes against API operations); on a library or code with no routes its findings are expected, not drift.

Model the code: codebase_extract stages what the rules decide into an as-built changeset and leaves it active (previousActive names the one it replaced). Stage the cards it returns that are elements with model_add (sourceFile and sourceSymbol from the card), then call it again for their relationships. Without a model, call project_init first; for a bootstrap, call it without since.

Land a change with changeset_commit only when the user asks to land it. The user confirms it in a dialog; it is refused if they decline, if the client can't show the dialog, or if the base drifted unless they agree to force: true. If it is refused, the user lands it in the viewer (review_open, then Apply), or in a terminal with dr changeset activate <name> then dr changeset commit. Never commit on your own initiative. changeset_discard deletes staged work for good; use it only when the user asks.`;
