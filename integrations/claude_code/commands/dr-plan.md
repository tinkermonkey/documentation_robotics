---
description: Plan a change as a staged DR changeset through the dr MCP server, pressure-test it, build from its brief, and verify the build. The human commits it in the PR.
argument-hint: "<the change to plan, in plain words>"
---

# Plan a Change

Plan `$ARGUMENTS` as a staged DR changeset instead of a prose plan.

## Instructions for Claude Code

Follow the `dr_change_planning` skill for this change.
In short:

1. **Frame**: start with `project_status` with `task: "plan"`. Propose a kebab-case name and the
   change's intent, and confirm both with the human before `changeset_create` takes them as `name`
   and `intent` (or `changeset_activate` an existing one). Write the intent as markdown: one or two
   sentences of intent, an **In scope** list naming the elements or areas (ids in code spans), and a
   **Done when** line. Wait for their answer. Find or stage the goal, requirement or feature it serves.
   With no model yet, confirm the model's name before `project_init`, and ask whether to bootstrap
   it from the code or let it grow with each change.
2. **Orient**: `model_search`, `model_show`, `model_trace` for what exists; `spec_type` for each
   type you will add. Within reason, every connection the spec models for a type is expected,
   though not every one will exist.
3. **Draft**: `model_add` / `model_update` / `model_delete` / `relationship_add` /
   `relationship_delete` across every layer the change reaches. Wire several at once with the
   lists: `model_add` `elements: [...]` (with `relationships` among them) and `relationship_add`
   `relationships: [...]`; invalid items are skipped and reported. A planned element with no code
   yet gets no source fields. `model_update` with
   `attributePatch` to change one attribute; `changeset_unstage` to back out (`source` or `target`
   alone drops every staged connection at that end; `changes: [...]` drops several in one call).
4. **Pressure-test**: `changeset_brief` (compact; `detail: "full"` only when you need everything)
   and `changeset_impact`. Answer each gap by staging what is
   missing, or accept it with `gap_accept` and the reason (`gap_reopen` takes it back). Steps 3 and 4 repeat:
   stage a little, then pass the brief's `revisionToken` back as `since` to see what changed, work
   through `unwired` (the expected links only: required, high-strength, or carried by existing elements; list it with
   `sections: ["unwired"], unwiredLayers: [...]`, naming the layers the change reaches; `optional`
   and `preexisting` are counted apart, not this change's to resolve), and walk `changeset_impact` with `from` set to what
   you just added.
5. **Review**: show the human the brief, then call `review_open` and give them its `url`, which
   opens the plan on the graph in the viewer. The human comments there; read the comments with
   `annotation_list`, answer with `annotation_reply`, revise. Wait for agreement before building.
   The active changeset is per checkout (`.dr/active-changeset`), not shared through git: a reviewer
   on the PR's branch finds the plan staged, not active, and opens it by name.
6. **Build** from the brief: `changeset_brief` with `sections: ["changes"]` for each changed
   element's attributes and connections (for a large plan, one layer at a time with
   `layers: ["<layer>"]`, from the default brief's `byLayer`). Commit only the plan's own changeset directory
   (`documentation-robotics/changesets/<id>/`) on the branch with the code.
   The as-built verification record is created in Verify, after this build commit. Don't verify
   during the build: no `codebase_extract`, no as-built changeset and no `changeset_verify` until
   the build is committed.
7. **Verify**, as its own step after the build is committed: `codebase_index` with `wait: 30`
   (then `status: true`, `wait: 30` until it is done; if it reports `ignoreFile.missing`, ask the
   developer to add those lines to their `.cbmignore`), then `codebase_extract`
   with `since` (the branch the work started from) and `changeset: "<name>-as-built"`. Stage the
   cards it returns that are elements with `model_add` (`sourceProvenance: "extracted"`), call it again for their relationships, then
   `changeset_verify` the plan against `<name>-as-built`. The as-built comes from `codebase_extract`,
   never by hand: never copy plan elements into it, and name each element after its card, not the
   plan. Ask the developer about the cards you can't place with confidence, batched in one short
   list, instead of guessing. Fix what diverges, in the code or in the plan, and `changeset_activate`
   the plan again. `unverifiable` items (what extraction can't see) and `notes` (description-only
   differences) need no plan edit; never edit the plan to match extracted placeholder text. Then the
   plan is what lands; ask the human whether to discard the as-built changeset or keep it as a
   record. It is the plan's verification record: `changeset_commit` refuses to land it,
   `force` or not. If they choose to discard it, call `changeset_discard` with `confirm: true`; if
   they choose to keep it, leave it staged and commit its directory with the plan's directory on
   the same branch and in the same PR; landing the plan moves it to `recorded` (kept, no longer
   staged work, no tool needed). Never land the verification record. To reconcile code drift, run
   `codebase_extract` with no plan active and `since` set to the commit `project_status` says the
   model was last reconciled with: any other `since` makes a verification record.
8. **Land**: the PR carries the plan, not the as-built changeset, and a person approves it there.
   When the user asks you to land it, call `changeset_commit` (no dialog, no token: git and the PR
   are the gate; `changesets: [...]` lands several in order). Then commit its `filesToCommit`, the
   changeset folder among them, with the code. `changeset_commit_preview` is the read-only dry run.
   A changeset-only (DrBot) session can't land: the user presses Apply in the viewer (`review_open`);
   never point them to the `dr` CLI. Never land unasked, and never apply or discard the plan yourself.

If the `dr` MCP tools are not available, say so and point the user to
`integrations/claude_code/docs/MCP_SERVER.md`.
