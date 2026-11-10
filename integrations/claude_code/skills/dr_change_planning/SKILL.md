---
name: dr_change_planning
description: Plan a code change as a staged DR changeset through the dr MCP server, pressure-test it against the model, build from its brief, and verify the build against it. Use when asked to plan, design or scope a change in a project with a DR model.
triggers:
  [
    "plan this change",
    "plan the change",
    "plan a change",
    "plan this feature",
    "how should we build",
    "scope this change",
    "design this change",
    "draft a changeset",
    "changeset brief"
  ]
---

# Plan a change as a DR changeset

In a project with a DR model (`documentation-robotics/model/`), a plan is a staged changeset, not a
prose document. The changeset says what the change will build. The model says what is built. The
graph checks the plan for you. The full design is `docs/CHANGE_MODELING.md` in the DR repository.

## Before you start

- You need the `dr` MCP server. Its tools show up as `mcp__plugin_dr_dr__<tool>` from the `dr`
  plugin, or `mcp__dr__<tool>` when the server is registered by hand as `dr`. If they are missing,
  tell the user to install the `dr` plugin (see `integrations/claude_code/docs/MCP_SERVER.md`)
  and stop. Don't fall back to prose.
- Staging writes files under `documentation-robotics/changesets/`. If the session is in plan mode,
  say that the plan will be a changeset and leave plan mode before staging.
- You never land or discard the plan on your own. Commit it (`changeset_commit`) only when the
  human asks you to land it; they confirm it in a dialog. Apply is not an MCP tool. Discard only when
  they agree.

## The loop

1. **Frame.** `changeset_list` first: if a changeset for this change exists, `changeset_activate` it
   and continue. Otherwise `changeset_create` with a short kebab-case `name` and a `description`
   that states the intent: what the change is for and what done looks like. Find the goal,
   requirement or feature it serves (`model_search` in motivation, business, product). If there is
   none, stage one, or ask the human what the change is for.
2. **Orient.** `model_search` / `model_show` / `model_trace` for the elements the change touches.
   Inside a changeset these read the plan as it stands (each result carries a change status).
   `spec_type` for a type you will add: its required attributes, enums, and the relationships the
   catalog allows to and from it. Within reason, every connection the spec models for a type is
   expected, though not every one will exist: treat the catalog's list as the checklist for each
   element the change adds or alters.
3. **Draft.** Stage the change in every layer it reaches: `model_add`, `model_update`,
   `model_delete`, `relationship_add`, `relationship_delete`. Relationships may join elements that
   exist only in the changeset. Pass `sourceFile`, `sourceProvenance` (`manual` for a planned location) and `sourceSymbol` when you know where the code goes.
   Change one attribute with `model_update` `attributePatch`, not by repeating every attribute. Fix a
   mistake with `changeset_unstage` (one element, one relationship, or `source` or `target` alone for
   every staged connection at that end), not by staging the reverse.
4. **Pressure-test.** `changeset_brief`, then `changeset_impact` for anything the brief questions.
   Steps 3 and 4 are a loop: a plan comes into focus over many passes. Each pass, stage a little,
   then:
   - Pass the last brief's `revisionToken` as `since`; read the `delta` first. It covers unstages
     too (`unstaged`). If it warns (a hand-edited `changes.yaml`, or a reach back past the last 200
     unstages), read the brief itself.
   - Work through `unwired` for each element you added or changed. Where `existingCount` is above
     0, link an existing element; otherwise decide whether the change needs a new one. Use
     `unwiredLayers` to see one layer in full, and `unwired: "none"` when you only need the gaps.
   - Walk `changeset_impact` with `from` set to what you just added, not the whole changeset.
   - Read the plan with `changeset_show` `detail: "summary"`, not the full snapshots.

   Read the brief's gaps:
   - `peer-pattern`: most elements like this one have a connection it lacks.
   - `unconnected`: an added element with no relationships.
   - Intent: a change that reaches no motivation, business or product element.
   - Layers not reached: a new API operation with nothing in data model, testing or APM is a small
     change or an unfinished plan. Decide which.
   - Connections the brief can't flag: for each changed element, compare what `spec_type` says its
     type can connect to with what the plan has. Stage the ones the change needs; leave the ones it
     doesn't, but don't skip the comparison.

   For each gap, either stage what is missing or accept it. Record an accepted gap where the human
   will see it: an `annotation_create` on the element, or a line in the description
   (`changeset_update`). `model_validate` should pass on the projected model.

5. **Review.** Stop and show the human the brief: changes by layer, gaps fixed and gaps accepted,
   impact, code touched. Call `review_open` and give them its `url`: it opens the plan on the graph
   in the viewer (`dr visualize`), reusing the viewer already running for the project or starting
   one. Ask them to comment on elements there. Read their comments with `annotation_list`, answer with `annotation_reply`, revise, and run the
   brief again. Don't start building until they agree.
6. **Build.** Build from the brief. Its "code touched" list is what you will edit or must not
   break. Keep the changeset staged and commit only the plan's own directory
   (`documentation-robotics/changesets/<id>/`, with the id `changeset_show` reports) on the branch
   with the code. Don't add the whole `changesets/` directory: the `.active` marker and any
   `<name>-as-built` changeset stay out of the commit. If the build has to differ from the plan,
   change the plan to match and say why.
7. **Verify.** Extract what was built, separately from the plan. Re-index the code once the build
   is done: `codebase_index` with `force: true` (an index counts as fresh while the commit hasn't
   moved, even after edits), polling with `status: true` until it is done. Then `codebase_extract`
   with `since` set to the branch the work started from (e.g. `main`) and
   `changeset: "<name>-as-built"`. It stages what the rules decide in the changed files and leaves
   `<name>-as-built` active. For each card it returns that is a model element, stage it with
   `model_add` (`sourceFile` and `sourceSymbol` from the card), reading the code, not the plan;
   then call `codebase_extract` again to stage their relationships, and `model_delete` the
   `candidateDeletes` that are really gone. Then `changeset_verify` with `planned: <name>` and
   `against: {"changesetId": "<name>-as-built"}`. Fix each missing, unplanned or divergent item in
   the code or in the plan. Look for missing connections in the as-built too: for each element,
   compare what the spec models for its type with what was staged, and look for evidence of each
   absent one in the code (and the analyzer's graph, `dr analyzer callers` / `callees`). Confirm or
   reject every `probable` match. `changeset_activate` the plan again afterwards (the extract
   result's `previousActive`). Tell the human the
   as-built changeset can be discarded; discard it (`changeset_discard`, `confirm: true`) only when
   they agree. Until then it stays out of git: when you commit fixes, add only the plan's
   directory again. If the as-built changes are committed to the model instead of kept as a changeset,
   `against: {"base": true}` compares the plan with the model.
8. **Land.** The PR carries the code and the staged changeset, and the human commits the changeset
   in it. When they ask you to land it, call `changeset_commit` with its name. The server asks them
   to confirm in a dialog that shows the name, intent, counts by operation, layers and drift, and
   commits only if they confirm; if they decline, leave it staged. If it is refused for drift, show
   them what drifted (`changeset_brief`) and pass `force: true` only if they still want it. Then add
   the model's changed files and the changeset's directory to the branch. Otherwise they commit it in
   the viewer (Apply) or with `dr changeset commit`.

## Tolerance

Tools report odd input and carry on instead of failing. Read the report each time:

- `relationship_add` reports a duplicate, or restores a relationship the plan had deleted.
- `changeset_unstage` reports `not-staged` when there was nothing to drop.
- In a changeset-only session (DrBot with `--with-changesets`), a write with no active changeset is
  refused. Call `changeset_create` or `changeset_activate` and retry.
- `changeset_commit` is refused when the human declines or cancels the dialog, when the client
  can't show one (no MCP elicitation), and in DrBot, which doesn't have it. Nothing is written; the
  human commits in the viewer (Apply) or with `dr changeset commit`.
- DrBot cannot write annotations (`annotation_create` and `annotation_reply` are not among its
  tools). There, record accepted gaps in the description with `changeset_update` and answer the
  human's comments in the chat.
- DrBot has no `review_open`: it runs in the viewer, so the human already has the plan in front
  of them. Point them to the changeset in the viewer's Changesets view instead.

## Keep it short

Model at the grain of the change. One function, one operation and one test sketch beat a
speculative tree. Add detail as the build firms up.
