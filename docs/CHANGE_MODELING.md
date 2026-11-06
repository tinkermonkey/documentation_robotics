# Change Modeling with DR

_The design for using a DR changeset as the spec for a change. The vision and the reasons are in the
[README](../README.md); this document is the working design for the tools. Update it as tools land._

## The loop

```text
Frame ─▶ Draft ─▶ Pressure-test ─▶ Review ─▶ Build ─▶ Verify ─▶ Land
  │        │            │              │         │        │        │
  │        │            │              │         │        │        └ human commits the changeset in the PR
  │        │            │              │         │        └ changeset_verify: plan vs an as-built changeset or the base
  │        │            │              │         └ Claude builds from changeset_brief
  │        │            │              └ viewer overlay, annotations, DrBot (on dr mcp)
  │        │            └ changeset_impact, changeset_brief (reach, gaps, intent), model_validate
  │        └ model_add / model_update / model_delete / relationship_add / relationship_delete / changeset_unstage
  └ changeset_create (activates), spec_type, model_search
```

A changeset stays staged from Frame to Land. The base model describes what is built; the changeset
describes what this change will build.

In Claude Code, `/dr-plan <change>`, or asking to "plan this change" with the `dr_change_planning`
skill installed, walks this loop. `dr claude install` installs both.

## Tools

All tools are on `dr mcp` (stdio and HTTP) and take an optional `rootPath`. Mutation tools stage
into the active changeset when there is one and write the base model when there isn't, the same as
the CLI. Planning a change therefore always starts with `changeset_create`. In changeset-only mode
(`DR_CHANGESET_ONLY=true`, which DrBot's `--with-changesets` sets) a write with no active changeset
is refused with a pointer to `changeset_create`.

Status: _existing_ predates change modeling; _slice 1_ is the first slice of change-modeling tools;
_slice 2_ is the second (changeset CRUD, verify, DrBot on MCP).

| Stage         | Tool                                                         | Status   | What it does                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame         | `changeset_create`                                           | slice 1  | Create a changeset from a name and the change's intent, and activate it.                                                                                                                            |
| Frame         | `changeset_activate`                                         | slice 1  | Make an existing staged changeset the one mutations stage into.                                                                                                                                     |
| Frame         | `changeset_deactivate`                                       | slice 1  | Stop staging; mutations write the base model again.                                                                                                                                                 |
| Frame         | `changeset_update`                                           | slice 2  | Rename a changeset or change its description (the intent). Names stay unique.                                                                                                                       |
| Frame         | `changeset_list` / `changeset_show`                          | existing | All changesets and which is active; one changeset with its staged changes.                                                                                                                          |
| Orient        | `spec_type`                                                  | slice 1  | A node type's definition, attributes (required, enums), and the relationships the catalog allows to and from it.                                                                                    |
| Orient        | `model_search` / `model_show` / `model_trace` / `model_list` | existing | Find and read elements. Inside a changeset they read the plan (slice 2): `model_show` lists relationships with a status, `model_search` gives a `changeStatus`, `model_trace` follows staged edges. |
| Draft         | `model_add` / `model_update` / `model_delete`                | existing | Stage element changes.                                                                                                                                                                              |
| Draft         | `relationship_add`                                           | slice 1  | Stage a relationship, validated against the catalog; works between elements that exist only in the changeset. A repeat is reported as a duplicate.                                                  |
| Draft         | `relationship_delete`                                        | slice 1  | Stage a relationship removal, or drop a relationship this changeset added.                                                                                                                          |
| Draft         | `changeset_unstage`                                          | slice 2  | Drop the staged changes to one element, or one staged relationship add or delete. Unstaging an add also drops the staged relationships to it.                                                       |
| Pressure-test | `changeset_impact`                                           | slice 1  | Walk the projected graph outward from every changed element; list the existing elements reached, by layer, with their source files.                                                                 |
| Pressure-test | `changeset_brief`                                            | slice 1  | The changeset as a spec: changes by layer with their connections, layers reached and not, gaps, intent trace, code touched, open annotations, drift.                                                |
| Pressure-test | `model_validate`                                             | existing | Validate the model (base + active changeset).                                                                                                                                                       |
| Review        | `annotation_*`                                               | existing | Read and answer the human's comments on elements.                                                                                                                                                   |
| Build         | `changeset_brief`                                            | slice 1  | The same brief is the build's input.                                                                                                                                                                |
| Verify        | `changeset_verify`                                           | slice 2  | Compare the plan with what was built: an as-built changeset, or the base model. Also `dr changeset verify` on the CLI.                                                                              |
| Abandon       | `changeset_discard`                                          | slice 2  | Abandon a changeset. It deletes the staged changes for good, so it needs an explicit id and `confirm: true`.                                                                                        |
| Land          | —                                                            | human    | Commit in the viewer or with `dr changeset commit`. Not exposed over MCP on purpose.                                                                                                                |

### The projected graph

`changeset_impact`, `changeset_brief`, `changeset_verify` and the changeset-aware reads see a
changeset through one view (`ChangesetGraph`, `cli/src/core/changeset-graph.ts`): the base model's
elements and relationships with the changeset's changes applied in sequence. Every element and
relationship carries a status: `added`, `updated`, `deleted` or `unchanged`. Unlike the per-layer
projection the CLI uses for elements, it includes staged relationships, so a traversal sees the
connections the change adds and the ones it removes. It works on any changeset by id or name, active
or not. It reads the committed relationships (`Model.getBaseRelationships()`), so staged ones keep
their status after the model is reloaded with the changeset active.

The CLI and the MCP tools stage relationships through the same code
(`cli/src/core/relationship-staging.ts`). In a changeset, `dr relationship add` and
`relationship_add` both report a duplicate, restore a relationship the changeset had deleted, and
match ends whether they are spelled as a UUID or a path.

### What `changeset_brief` reports

- **Changes by layer.** Each added, updated or deleted element with its type, description,
  attributes (and for updates, the fields that changed), and its connections in the projected graph.
- **Reach.** Layers the change touches, and layers it does not.
- **Gaps.** Within reason, every connection the spec models for a type is expected, though not
  every one will exist; the gaps below are where the brief can point at one mechanically. The
  planner still checks each changed element's allowed connections (`spec_type`) itself.
  - `unconnected`: an added element with no relationships at all.
  - `missing-required`: an added element lacks a relationship the catalog marks `required`. Which
    relationships are `required` is the spec's decision; none are marked today.
  - `peer-pattern`: the model's own convention. Peers are existing elements of the same type that
    relate to one of the added element's neighbours the same way (another layout function that
    also realizes the layout service). A connection at least half the peers have (and at least
    two), that the added element lacks, and that the catalog still allows, is reported with up to
    three examples. On heimdall, planning a new layout function this way reports that its sibling
    functions each have an API operation realizing them and a test sketch testing them.
- **Intent.** Changed elements outside the motivation, business and product layers that reach no
  element in those layers within four hops. A change that serves no stated intent is a question for
  the human.
- **Code touched.** Source files of the changed elements and of the existing elements one hop away.
  These are the files the build is likely to edit or must not break.
- **Feedback.** Unresolved annotations on changed elements and their neighbours.
- **Drift.** Whether the base model changed since the changeset was created (`isDrifted`), which
  staged changes the base now overlaps (`overlapping`: adds the base already has, deletes of what
  it no longer has, updates of elements changed in the base) and, when the changeset has a base
  index, what was added, removed or changed in the base (`baseChanges`). Staged adds the base
  already has are counted as `alreadyInBase`, apart from the adds, for elements and relationships
  alike. New changesets record the base index (`base-index.json` in the changeset's directory);
  older ones report `baseIndex: "not-recorded"`.

### What `changeset_verify` reports

It compares a planned changeset with what was built. The built side is an as-built changeset
(`against: {"changesetId": ...}`), written by hand today and by extraction later, or the base model
(`against: {"base": true}`), once the as-built changes are committed.

- The plan is its net changes: an add then a delete is nothing; an add then an update is an add.
- Elements match by id; then by layer, type and name, ignoring case and separators; then by layer
  and name with a different type; then by a shared source file. Anything but an exact id is
  `probable`, with a reason. An ambiguous match is not guessed: it is reported missing, with the
  candidates.
- Relationships match through the element matches. A different predicate or a reversed direction
  is a divergence, not a missing relationship plus an unplanned one.
- An element that existed before the plan (in its base index) is never a candidate for a planned
  add. Without a base index, unchanged elements with no relationship to the plan are left out, and
  the report notes it.
- A planned update is missing only when the build left its fields as they were before the plan; a
  field the build changed to something else is a divergence, with both values.
- The report lists matched, missing, unplanned, divergent (with the differing fields) and planned
  deletions that still exist, with a verdict: `match`, `probable-match`, `diverges`, `incomplete`
  or `empty-plan`. `summary.matched` counts divergent matches too; `divergent` is the subset.
- A `status` moved to a later lifecycle stage (planned → delivered, draft → automated; see
  `LIFECYCLE_FIELDS` and `LIFECYCLE_STAGES` in `cli/src/core/changeset-verify.ts`) is listed on the
  match as `lifecycle` and in the notes, not as a divergence. A move back, or to `deprecated`,
  `abandoned` or `cancelled`, is a divergence.
- Against the base, verify can't know what the build changed, so "unplanned" covers only new
  relationships on the elements the plan adds. The report says so.

## Iterating on a plan

A plan comes into focus over many passes: stage what is known, read what the brief says is
missing, add, assess, remove what turns out to be out of scope, and repeat. Take a new
`POST /orders/export` endpoint with an export-request payload. The first pass stages the
`api.operation` and the `data-model.objectschema` for the payload. The brief then says the change
reaches two layers and traces to no goal. Later passes add the application function the operation
realizes, the data-store collection the schema maps to, the test case sketch, the UX view that
triggers it and the link up to the feature; each pass shows gaps on the elements just added and
closes others. Some passes remove things: the export turns out not to need its own collection.

Within reason, every connection the spec models for a type is expected, though not every one will
exist. Each pass, the planner works through those connections for the elements the change adds or
alters, and decides which the change needs.

The tools make each pass cheap:

| Need                              | Tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is left to wire              | `changeset_brief` lists **unwired** connections: for each added or updated element, the triples the catalog defines for its type, in either direction, that the element has no relationship for. They are grouped by the other end's layer, each with `existingCount`, the number of elements of the other type the model has, so the planner knows whether to link one or add one. `unwired: "summary"` (default) gives counts per layer and lists entries only for layers the change already reaches; `"full"` lists all; `"none"` leaves it out. `unwiredLayers` lists the entries for chosen layers. |
| What changed since the last pass  | `changeset_brief` returns `revision` and `revisionToken`. Passing the token back as `since` adds a `delta`: elements added or removed, gaps opened and closed, unwired connections wired or new, layers newly reached or no longer reached, intent newly traced or untraced. The earlier state is rebuilt by applying the changes staged up to that revision, so nothing is stored between calls.                                                                                                                                                                                                        |
| What one element touches          | `changeset_impact` with `from` (element ids) walks from those elements instead of every changed one. `perHop` counts what each hop adds. A hub, an element with more relationships than `hubThreshold` (default 15), is listed in `hubs` with its degree and not walked through, unless `expandHubs` is set.                                                                                                                                                                                                                                                                                             |
| A short view of the plan          | `changeset_show` with `detail: "summary"`: one entry per change (sequence, operation, element or relationship, changed fields) and totals per operation, without the before and after snapshots.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Change one attribute              | `model_update` with `attributePatch` (`dr update --attribute-patch`): merged shallowly into the element's attributes, over staged values in a changeset; `null` removes a key. Required attributes need not be repeated. `attributes` still replaces them all.                                                                                                                                                                                                                                                                                                                                           |
| Drop everything staged at one end | `changeset_unstage` with `source` alone or `target` alone, optionally with `predicate`, drops every staged relationship add and delete at that end. Relationship removals cascaded by a staged element delete are kept.                                                                                                                                                                                                                                                                                                                                                                                  |

On heimdall, planning a layout-snapshot export endpoint this way took nine passes and settled by the
seventh: seven elements in seven layers, every one tracing to intent, one gap accepted. Most
decisions came from `unwired` (filtered with `unwiredLayers`) and peer-pattern gaps, with focused
impact as the check.

Accepted gaps, a gap the planner or the human decides to leave open, are written today into the
changeset's description or an annotation, and the brief doesn't read them back, so it reports them
again every pass. Recording them in the model, with the reason, is
tinkermonkey/documentation_robotics#1026.

## Using it from Claude Code

Register the server once per project (`.mcp.json`). `dr mcp` prints its API key to stderr on
start; the client must pass it back:

```json
{
  "mcpServers": {
    "dr": {
      "command": "dr",
      "args": ["mcp"],
      "env": { "DR_MCP_API_KEY": "<key>" }
    }
  }
}
```

Keep the key out of the repository (use a user-scope MCP config, or an environment variable the
config references). `DR_MCP_ROOT_PATH` points the server at a model when the client starts it in
another directory.

Then `/dr-plan <change>` runs the loop:

1. `changeset_create` with the change's name and intent.
2. `model_search` for what exists; `spec_type` for what a new element must carry and may connect to.
3. Stage elements and relationships across every layer the change reaches.
4. `changeset_brief`, then `changeset_impact` for anything the brief's reach or gaps question.
   Revise until the gaps are answered or accepted. An accepted gap is
   recorded in an annotation or in the changeset's description.
5. Ask the human to review it in the viewer (`dr visualize`), read their annotations, revise.
6. Build from the brief. Keep the changeset staged and commit its files on the branch.
7. Stage an as-built changeset from the diff and `changeset_verify` the plan against it. Fix what
   diverges, in the code or in the plan.
8. The human commits the changeset in the PR that ships the code.

The steps live in the skill (`integrations/claude_code/skills/dr_change_planning/`); the command
points at it. Copilot gets a copy of the skill in `integrations/github_copilot/skills/`.

### DrBot

The chat agent that `dr visualize` launches works through the same `dr mcp` server, so a
conversation in the viewer and a session in the terminal see the same changeset with the same
tools. Each launch writes a private MCP config (in a `0700` temp directory, removed when the agent
exits) that runs this dr installation as `dr mcp`, with the served model and the installation key.
Its allowed tools follow the mode: read-safe gets the read tools; `--with-changesets` adds the
changeset and staging tools and turns on changeset-only mode. Neither mode gets `chat_launch`, the
annotation writers or `changeset_discard` (danger mode skips permissions, as it always has). If the config can't be written, DrBot launches as before
(through Bash) and the server logs a warning.

## Known limits

- Impact walks relationships in both directions and does not weigh predicates. Whether, say, a
  `serves` edge carries impact upstream or downstream is a refinement for after real use.
- Verify needs an as-built side. Until the extraction cascade writes changesets, the agent writes
  the as-built changeset from the diff, which is only as independent as the agent is careful.
  `builtFromSnapshot` in `cli/src/core/changeset-verify.ts` is the seam for extraction.
- `changeset_discard` can't be undone. It is gated by `confirm: true`; `changeset_unstage` and
  `changeset_deactivate` are the gentler choices.
- DrBot on Copilot, and `dr chat` / `chat_launch`, still run `dr` through Bash.
- A `since` delta can't see past an unstage: unstaging renumbers the changes, so the earlier state
  can't be rebuilt. The brief warns when this happens, and the delta is then empty.
- The delta lists element adds and removals and connections wired, but not element updates, or
  relationships whose end is a new element.
- The brief is large for types with many same-layer triples (an API operation lists every OpenAPI
  type it may connect to, including ones the model has none of). Use `unwiredLayers`, or
  `unwired: "none"` for a quick pass.
- `existingCount` counts elements the changeset adds as well as existing ones.
- The intent trace walks through hubs and counts intent elements the changeset itself adds, and
  doesn't give the path, so a trace can look better than it is.
- The tools have not yet been used on a real change.
