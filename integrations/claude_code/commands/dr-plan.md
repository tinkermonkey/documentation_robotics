---
description: Plan a change as a staged DR changeset through the dr MCP server, pressure-test it, build from its brief, and verify the build. The human commits it in the PR.
argument-hint: "<the change to plan, in plain words>"
---

# Plan a Change

Plan `$ARGUMENTS` as a staged DR changeset instead of a prose plan.

## Instructions for Claude Code

Follow the `dr_change_planning` skill (`.claude/skills/dr_change_planning/SKILL.md`) for this change.
In short:

1. **Frame**: `changeset_create` with a kebab-case name and the change's intent as the description
   (or `changeset_activate` an existing one). Find or stage the goal, requirement or feature it
   serves.
2. **Orient**: `model_search`, `model_show`, `model_trace` for what exists; `spec_type` for each
   type you will add. Within reason, every connection the spec models for a type is expected,
   though not every one will exist.
3. **Draft**: `model_add` / `model_update` / `model_delete` / `relationship_add` /
   `relationship_delete` across every layer the change reaches. `model_update` with
   `attributePatch` to change one attribute; `changeset_unstage` to back out (`source` or `target`
   alone drops every staged connection at that end).
4. **Pressure-test**: `changeset_brief` and `changeset_impact`. Answer each gap by staging what is
   missing, or accept it and say why in an annotation or the description. Steps 3 and 4 repeat:
   stage a little, then pass the brief's `revisionToken` back as `since` to see what changed, work
   through `unwired`, and walk `changeset_impact` with `from` set to what you just added.
5. **Review**: show the human the brief and ask them to review it in `dr visualize`. Read
   `annotation_list`, reply, revise. Wait for agreement before building.
6. **Build** from the brief. Commit only the plan's own changeset directory
   (`documentation-robotics/changesets/<id>/`) on the branch with the code; keep `.active` and the
   as-built changeset out of the commit.
7. **Verify**: stage an `<name>-as-built` changeset from the diff, then `changeset_verify` the plan
   against it. Fix what diverges, in the code or in the plan.
8. **Land**: the human commits the changeset in the PR. Never commit, apply or discard the plan
   yourself.

If the `dr` MCP tools are not available, say so and point the user to
`integrations/claude_code/docs/MCP_SERVER.md`.
