/**
 * Instructions the dr MCP server sends in its initialize result. Clients such as Claude Code
 * load them into the session at start (alongside only the tool names), so this is the agent's
 * map of how the tools fit together. Claude Code caps it at 4096 characters; a test holds it
 * under that and checks that every tool named here exists.
 */
export const SERVER_INSTRUCTIONS = `Documentation Robotics (DR) keeps an architecture model of the project in documentation-robotics/: layers from motivation through application, API, data and testing, linked by typed relationships. The base model describes the code as built. A planned change lives in a changeset until it lands with the code. The user should never need to type a dr command: do each step with these tools, and never tell them to run dr for something a tool does.

Start with project_status. It reports the model, its spec version, changesets, code index, code changed since the model and the viewer, and ends with nextStep: the tool to call next. Call it again after a step. Pass rootPath only for another project.

Confirm with the user, and wait for their answer, before you create: the model's name (project_init); whether to bootstrap the model from the code now or grow it with each change; a changeset's name and intent (changeset_create). Propose each, don't decide it.

Set up: with no model, propose project_init. If the model's spec is behind, project_upgrade previews the migration; show the user and call it with apply: true only when they approve.

Read the model: model_search, model_show (with relationships), model_trace (dependencies), model_list (a layer). spec_type says which attributes a type takes and which relationships the catalog allows. Element ids are {layer}.{type}.{kebab-name}.

Plan a change (the /dr-plan workflow):
1. changeset_create opens a changeset and makes it active. While one is active, model and relationship writes stage into it, and the reads show the model as the plan leaves it. Wire several at once: model_add with elements: [...] (and relationships among them), relationship_add with relationships: [...]; bad items are skipped and reported.
2. Check each type with spec_type before adding it, and link every new element to what it serves, realizes or depends on.
3. Pressure-test with changeset_brief (compact; unwired: "summary" adds unwired connections) and changeset_impact. Revise with changeset_update and changeset_unstage (changes: [...] for several). changeset_deactivate sets a plan aside; changeset_activate resumes it.
4. Review: give the user review_open's url, the changeset in the viewer (call it again if it is still starting). They comment there; read with annotation_list, answer with annotation_reply.
5. Build from changeset_brief with sections: ["layers"] (detail: "full" for everything). Don't extract or verify during the build.
6. Verify as its own step, once the build is committed: codebase_extract with since (the branch the work started from) stages what was built into an as-built changeset, never written by hand or copied from the plan; changeset_verify compares the plan with it. Its unverifiable items and notes need no plan edit. Then the plan lands; the as-built changeset is discarded or kept as a record, not landed.

Code: codebase_index indexes in the background. Call it with wait: 30, then with status: true and wait: 30 until job.state is done (or failed: report its error and logPath). codebase_verify checks only the API layer (code routes against API operations); with no routes (a library) its findings are expected, not drift.

Model the code: codebase_extract stages what the rules decide into an as-built changeset and leaves it active (previousActive names the one it replaced). Stage its element cards with model_add (sourceFile and sourceSymbol from the card, sourceProvenance: "extracted"), then call it again for their relationships. Ask the user about cards you can't place, in one short list. For a bootstrap, call it without since.

Land a change with changeset_commit only when the user asks to land it; they confirm it in a dialog. It is refused if they decline, if the client can't show the dialog, or on drift unless they agree to force: true. If it is refused, they land it in the viewer (review_open, then Apply) or with dr changeset commit <name>. Never commit on your own initiative. changeset_discard deletes staged work for good; use it only when the user asks.`;
