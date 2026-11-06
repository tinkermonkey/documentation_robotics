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

- You need the `dr` MCP server (`dr mcp`, registered in Copilot's MCP configuration with the
  `DR_MCP_API_KEY` it prints on start; see `integrations/claude_code/docs/MCP_SERVER.md`). The
  tool names below are the server's own; Copilot may show them with a server prefix. If the tools
  are missing, tell the user to register the server and stop. Don't fall back to prose.
- Staging writes files under `documentation-robotics/changesets/`.
- You never commit, apply or discard the plan. Those are the human's steps, and commit and apply are
  not MCP tools.

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
   exist only in the changeset. Pass `sourceFile` (and `sourceSymbol`) when you know where the code goes. Fix a
   mistake with `changeset_unstage` (one element, or one relationship), not by staging the reverse.
4. **Pressure-test.** `changeset_brief`, then `changeset_impact` for anything the brief questions.
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
   impact, code touched. Ask them to look at it in `dr visualize` and comment on elements there.
   Read their comments with `annotation_list`, answer with `annotation_reply`, revise, and run the
   brief again. Don't start building until they agree.
6. **Build.** Build from the brief. Its "code touched" list is what you will edit or must not
   break. Keep the changeset staged and commit only the plan's own directory
   (`documentation-robotics/changesets/<id>/`, with the id `changeset_show` reports) on the branch
   with the code. Don't add the whole `changesets/` directory: the `.active` marker and any
   `<name>-as-built` changeset stay out of the commit. If the build has to differ from the plan,
   change the plan to match and say why.
7. **Verify.** Write down what was built, separately from the plan: `changeset_create`
   `<name>-as-built`, stage what the diff actually contains (read the code, not the plan), then
   `changeset_verify` with `planned: <name>` and `against: {"changesetId": "<name>-as-built"}`.
   Fix each missing, unplanned or divergent item in the code or in the plan. Look for missing
   connections in the as-built too: for each element, compare what the spec models for its type
   with what was staged, and look for evidence of each absent one in the code (and the analyzer's
   graph, `dr analyzer callers` / `callees`, when it is indexed). Confirm or reject
   every `probable` match. `changeset_activate` the plan again afterwards. Tell the human the
   as-built changeset can be discarded; discard it (`changeset_discard`, `confirm: true`) only when
   they agree. Until then it stays out of git: when you commit fixes, add only the plan's
   directory again. Once the plan is committed, `against: {"base": true}` checks the model too.
8. **Land.** Hand over: the PR carries the code and the staged changeset. The human commits it,
   in the viewer or with `dr changeset commit`.

## Tolerance

Tools report odd input and carry on instead of failing. Read the report each time:

- `relationship_add` reports a duplicate, or restores a relationship the plan had deleted.
- `changeset_unstage` reports `not-staged` when there was nothing to drop.
- In a changeset-only session (DrBot with `--with-changesets`), a write with no active changeset is
  refused. Call `changeset_create` or `changeset_activate` and retry.
- DrBot cannot write annotations (`annotation_create` and `annotation_reply` are not among its
  tools). There, record accepted gaps in the description with `changeset_update` and answer the
  human's comments in the chat.

## Keep it short

Model at the grain of the change. One function, one operation and one test sketch beat a
speculative tree. Add detail as the build firms up.
