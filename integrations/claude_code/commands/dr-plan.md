---
description: Plan a change as a staged DR changeset through the dr MCP server, pressure-test it, build from its brief, and verify the build. The human commits it in the PR.
argument-hint: "<the change to plan, in plain words>"
---

# Plan a Change

Plan `$ARGUMENTS` as a staged DR changeset instead of a prose plan.

## Instructions for Claude Code

Follow the `dr_change_planning` skill for this change.
In short:

1. **Frame**: propose a kebab-case name and the change's intent, and confirm both with the human
   before `changeset_create` uses them as the name and description (or `changeset_activate` an
   existing one). Wait for their answer. Find or stage the goal, requirement or feature it serves.
   With no model yet, confirm the model's name before `project_init`, and ask whether to bootstrap
   it from the code or let it grow with each change.
2. **Orient**: `model_search`, `model_show`, `model_trace` for what exists; `spec_type` for each
   type you will add. Within reason, every connection the spec models for a type is expected,
   though not every one will exist.
3. **Draft**: `model_add` / `model_update` / `model_delete` / `relationship_add` /
   `relationship_delete` across every layer the change reaches. Stage many at once with
   `model_add` `elements: [...]` and `relationship_add` `relationships: [...]`. `model_update` with
   `attributePatch` to change one attribute; `changeset_unstage` to back out (`source` or `target`
   alone drops every staged connection at that end).
4. **Pressure-test**: `changeset_brief` (compact; `detail: "full"` only when you need everything)
   and `changeset_impact`. Answer each gap by staging what is
   missing, or accept it and say why in an annotation or the description. Steps 3 and 4 repeat:
   stage a little, then pass the brief's `revisionToken` back as `since` to see what changed, work
   through `unwired` (ask for it with `unwired: "summary"` or `sections: ["unwired"]`), and walk `changeset_impact` with `from` set to what you just added.
5. **Review**: show the human the brief, then call `review_open` and give them its `url`, which
   opens the plan on the graph in the viewer. The human comments there; read the comments with
   `annotation_list`, answer with `annotation_reply`, revise. Wait for agreement before building.
6. **Build** from the brief: `changeset_brief` with `sections: ["layers"]` for the attributes, or
   `detail: "full"` for everything. Commit only the plan's own changeset directory
   (`documentation-robotics/changesets/<id>/`) on the branch with the code; keep `.active` and the
   as-built changeset out of the commit.
7. **Verify**: `codebase_index` with `wait: 30` once the build is done (then `status: true`,
   `wait: 30` until it is done), then `codebase_extract`
   with `since` (the branch the work started from) and `changeset: "<name>-as-built"`. Stage the
   cards it returns that are elements with `model_add`, call it again for their relationships, then
   `changeset_verify` the plan against `<name>-as-built`. The as-built comes from `codebase_extract`,
   never by hand. Fix what diverges, in the code or in the plan, and `changeset_activate` the plan
   again. `unverifiable` items (what extraction can't see) and `notes` (description-only differences)
   need no plan edit; never edit the plan to match extracted placeholder text.
8. **Land**: the human commits the changeset in the PR. When they ask you to land it, call
   `changeset_commit`; they confirm it in a dialog, and it commits only then. If it is refused, they
   land it in the viewer (`review_open`, then Apply), or in a terminal with
   `dr changeset activate <name>` then `dr changeset commit`. Never commit unasked, and never apply
   or discard the plan yourself.

If the `dr` MCP tools are not available, say so and point the user to
`integrations/claude_code/docs/MCP_SERVER.md`.
