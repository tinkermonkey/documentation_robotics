/**
 * Instructions the dr MCP server sends in its initialize result. Clients such as Claude Code
 * load them into the session at start (alongside only the tool names), so this is the agent's
 * map of how the tools fit together. Claude Code caps it at 4096 characters; a test holds it
 * under that and checks that every tool named here exists.
 */
export const SERVER_INSTRUCTIONS = `Documentation Robotics (DR) keeps an architecture model of the project in documentation-robotics/: layers from motivation (goals, requirements) through product, application, API, data and testing, linked by typed relationships. The base model describes the code as built. A planned change lives in a changeset until it lands with the code. The user should never need to type a dr command: do each step with these tools.

Start with project_status. It reports the model, its spec version, the changesets, the code index and code changed since the model, and the viewer, and ends with nextStep: the tool to call next. Call it again after a step to see what remains. Tools serve the project the client has open; pass rootPath only for a different one.

Set up: if there is no model, offer project_init (it needs a name). If the model's spec is behind this dr, call project_upgrade to preview the migration, show it to the user, and call it again with apply: true only when they approve.

Read the model: model_search finds elements, model_show gives one with its relationships, model_trace follows what depends on what, model_list lists a layer, model_info summarises. spec_type says which attributes a type takes and which relationships the catalog allows. Element ids are {layer}.{type}.{kebab-name}.

Plan a change (the /dr-plan workflow):
1. changeset_create opens a changeset and makes it active. While one is active, model_add, model_update, model_delete, relationship_add and relationship_delete stage into it, and the reads show the model as the plan leaves it.
2. Check each type with spec_type before adding it, and link every new element to what it serves, realizes or depends on.
3. Pressure-test with changeset_brief (unwired connections, gaps, intent, drift) and changeset_impact (what a change touches). Revise with changeset_update and changeset_unstage. changeset_deactivate sets a plan aside; changeset_activate resumes it.
4. Review: call review_open and give the user its url, which opens the changeset on the graph in the viewer. If it says the viewer is still starting, call it again. Read their comments with annotation_list.
5. After building, changeset_verify compares the plan with what was built.

Code: codebase_index starts indexing in the background and returns at once. Tell the user it is running, then call codebase_index with status: true about every 30 seconds until the job is done (or failed: report its error and logPath). With a fresh index, codebase_verify compares the routes in the code with the model's API operations.

Land a change with changeset_commit only when the user asks to land it. The user confirms it in a dialog; it is refused if they decline, if the client can't show the dialog, or if the base drifted unless they agree to force: true. Otherwise they commit in the viewer (Apply) or with dr changeset commit. Never commit on your own initiative. changeset_discard deletes staged work for good; use it only when the user asks.`;
