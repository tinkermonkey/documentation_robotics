/**
 * Instructions the dr MCP server sends in its initialize result. Clients such as Claude Code
 * load them into the session at start (alongside only the tool names), so this is the agent's
 * map of how the tools fit together. Claude Code caps it at 4096 characters; a test holds it
 * under that and checks that every tool named here exists.
 */
export const SERVER_INSTRUCTIONS = `Documentation Robotics (DR) keeps an architecture model of the project in documentation-robotics/: layers from motivation to testing, linked by typed relationships. The base model describes the code as built. A planned change lives in a changeset until it lands with the code. Do each step with these tools; never tell the user to run dr for something a tool does.

Start with project_status: it reports where the project stands and ends with nextStep: the tool to call next (and nextStep.also alongside it). Call it again after a step. Pass rootPath only for another project.

Confirm with the user, and wait, before you create: the model's name (project_init); whether to bootstrap the model from the code now or grow it with each change; a changeset's name and intent (changeset_create). Propose each, don't decide it.

Set up: if the model's spec is behind, project_upgrade previews the migration; show the user and call it with apply: true only when they approve.

Read the model: model_search, model_show, model_trace, model_list. spec_type gives a type's attributes and the relationships the catalog allows. Element ids are {layer}.{type}.{kebab-name}.

Plan a change (the /dr-plan workflow):
1. changeset_create opens a changeset and makes it active. While one is active, model and relationship writes stage into it, and the reads show the model as the plan leaves it. Wire several at once: model_add with elements: [...] (and relationships among them), relationship_add with relationships: [...]; bad items are skipped and reported.
2. Check each type with spec_type, and link every new element to what it serves, realizes or depends on.
3. Pressure-test with changeset_brief (it counts unwired links; list them with sections: ["unwired"], unwiredLayers: [...], never unfiltered) and changeset_impact. Revise with changeset_update and changeset_unstage (changes: [...] for several). changeset_deactivate sets a plan aside; changeset_activate resumes it. A link that doesn't apply: gap_accept with the reason.
4. Review: give the user review_open's url (retry if it is starting). They comment there; read with annotation_list, answer with annotation_reply.
5. Build from changeset_brief with sections: ["changes"] (large plan: layers: ["<layer>"], one at a time). Don't extract or verify during the build.
6. Verify as its own step, once the build's code is committed to git: codebase_extract with since (the base branch) stages what was built into an as-built changeset, never written by hand or copied from the plan; changeset_verify compares the plan with it. Its unverifiable items and notes need no plan edit. The as-built changeset is left active: changeset_activate the plan (previousActive) before editing it. Then the plan lands; the as-built changeset is discarded or kept as a record, not landed.

Code: codebase_index indexes in the background. Call it with wait: 30, then with status: true and wait: 30 until job.state is done (or failed: report its error and logPath). If it reports ignoreFile, tell the user to commit it. codebase_verify checks only the API layer; on code with no routes its findings are expected, not drift.

Model the code: codebase_extract stages what the rules decide into an as-built changeset and leaves it active. If it staged nothing it makes no changeset: call changeset_create with the name it gives before model_add. Stage its element cards with model_add (sourceFile and sourceSymbol from the card, sourceProvenance: "extracted"), then call it again for their relationships. Ask the user about cards you can't place, in one short list. For a bootstrap, call it without since.

Land a change with changeset_commit only when the user asks to land it; they confirm it in a dialog. It is refused if they decline, if the client can't show the dialog, or on drift unless they agree to force: true. If it is refused, they land it in the viewer (review_open, then Apply) or an interactive session, never the dr CLI. Never commit on your own initiative. changeset_discard deletes staged work for good; use it only when the user asks.`;
