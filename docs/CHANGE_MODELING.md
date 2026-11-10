# Change Modeling with DR

_The design for using a DR changeset as the spec for a change. The vision and the reasons are in the
[README](../README.md); this document is the working design for the tools. Update it as tools land._

## The loop

```text
Frame ─▶ Draft ─▶ Pressure-test ─▶ Review ─▶ Build ─▶ Verify ─▶ Land
  │        │            │              │         │        │        │
  │        │            │              │         │        │        └ changeset_commit, confirmed by the human in a dialog; or the viewer / CLI
  │        │            │              │         │        └ codebase_extract (since), then changeset_verify: plan vs the as-built changeset
  │        │            │              │         └ Claude builds from changeset_brief
  │        │            │              └ review_open (viewer overlay link), annotations, DrBot (on dr mcp)
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
(`DR_CHANGESET_ONLY=true`, or `1`/`yes`/`on`, which DrBot's `--with-changesets` sets) a write with no active changeset
is refused with a pointer to `changeset_create`. `project_init` and `project_upgrade` write outside
any changeset, so that mode refuses them outright.

Status: _existing_ predates change modeling; _slice 1_ is the first slice of change-modeling tools;
_slice 2_ is the second (changeset CRUD, verify, DrBot on MCP); _gateway_ is the MCP gateway, which
lets the agent run every DR use case without the developer leaving the conversation.

| Stage         | Tool                                                         | Status   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start         | `project_status`                                             | gateway  | Where the repo stands with DR: model, spec version, changesets, code index, code changed since the model last did (git). Ends with the next step and its tool. The first call in a session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Onboard       | `project_init`                                               | gateway  | Create an empty model at the current spec version in the open folder, without prompts. Fails if it has a model; installs no integration files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Upgrade       | `project_upgrade`                                            | gateway  | Preview moving the model to the spec this dr carries (version path, type renames, relationship rewrites, what it can't migrate); `apply: true` runs it, lists the model files it wrote, added and removed (`filesModified`, `files`), and validates the base model with the warnings `dr validate` reports (orphans, missing source references); `force: true` with `apply` stamps an additive spec change.                                                                                                                                                                                                                                                                                                                                                                                            |
| Frame         | `changeset_create`                                           | slice 1  | Create a changeset from a name and the change's intent, and activate it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Frame         | `changeset_activate`                                         | slice 1  | Make an existing staged changeset the one mutations stage into.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Frame         | `changeset_deactivate`                                       | slice 1  | Stop staging; mutations write the base model again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Frame         | `changeset_update`                                           | slice 2  | Rename a changeset or change its description (the intent). Names stay unique.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Frame         | `changeset_list` / `changeset_show`                          | existing | All changesets and which is active; one changeset with its staged changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Orient        | `spec_type`                                                  | slice 1  | A node type's definition, attributes (required, enums), and the relationships the catalog allows to and from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Orient        | `model_search` / `model_show` / `model_trace` / `model_list` | existing | Find and read elements. Inside a changeset they read the plan (slice 2): `model_show` lists relationships with a status, `model_search` gives a `changeStatus`, `model_trace` follows staged edges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Draft         | `model_add` / `model_update` / `model_delete`                | existing | Stage element changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Draft         | `relationship_add`                                           | slice 1  | Stage a relationship, validated against the catalog; works between elements that exist only in the changeset. A repeat is reported as a duplicate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Draft         | `relationship_delete`                                        | slice 1  | Stage a relationship removal, or drop a relationship this changeset added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Draft         | `changeset_unstage`                                          | slice 2  | Drop the staged changes to one element, one staged relationship add or delete, or every staged relationship change at one end (`source` or `target` alone). Unstaging an add also drops the staged relationships to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Pressure-test | `changeset_impact`                                           | slice 1  | Walk the projected graph outward from every changed element; list the existing elements reached, by layer, with their source files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Pressure-test | `changeset_brief`                                            | slice 1  | The changeset as a spec: changes by layer with their connections, layers reached and not, gaps, intent trace, code touched, open annotations, drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Pressure-test | `model_validate`                                             | existing | Validate the model (base + active changeset).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Review        | `review_open`                                                | gateway  | A link that opens a changeset (default the active one) on the graph in the viewer. Reuses the viewer running for the project or starts `dr visualize --with-changesets`, which keeps running after the session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Review        | `annotation_*`                                               | existing | Read and answer the human's comments on elements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Build         | `changeset_brief`                                            | slice 1  | The same brief is the build's input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Index         | `codebase_index`                                             | gateway  | Index the code with codebase-memory-mcp in the background. Returns the job: `state` (`running`, `done`, `failed`), `startedAt`, `finishedAt`, `error`, `progress` and `logPath`, and the index's `state`. With `wait` (seconds, at most 50) it blocks until the run ends or the wait does; without it, it returns at once. Start with `wait: 30`, then call it with `status: true, wait: 30` until the job ends. A call during a run returns that run; `force` stops it and starts over. Skips a fresh index unless `force`; re-indexes uncommitted edits newer than the index without it. The run indexes the codebase root the server resolved. Selects an installed analyzer if none is, and says how to install codebase-memory-mcp when it is missing. The job is `.dr/analyzers/index-job.json`. |
| Verify        | `codebase_verify`                                            | gateway  | The API layer only: the HTTP routes the analyzer found in the code against the model's API operations (on a library or code with no routes, every operation is in the model only, which is not drift): matched, in the code only, in the model only, and ignored, with a summary (the `dr analyzer verify --json` report). Needs a fresh index; without one, or while a run is in flight, it points at `codebase_index`. Read-only.                                                                                                                                                                                                                                                                                                                                                                    |
| Extract       | `codebase_extract`                                           | gateway  | Run the extraction cascade on the indexed code and stage what differs from the model into an as-built changeset (default `extract-<sha>`; created if absent, left active, `previousActive` returned). Tier-0 decisions are staged with their relationships; the rest come back as paged cards for the agent. `since` limits it to files changed since a git ref. Needs a fresh index. Never writes the base model or commits. See [What `codebase_extract` stages](#what-codebase_extract-stages).                                                                                                                                                                                                                                                                                                     |
| Verify        | `changeset_verify`                                           | slice 2  | Compare the plan with what was built: an as-built changeset, or the base model. Also `dr changeset verify` on the CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Abandon       | `changeset_discard`                                          | slice 2  | Abandon a changeset. It deletes the staged changes for good, so it needs the changeset named explicitly (id or name) and `confirm: true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Land          | `changeset_commit`                                           | gateway  | Commit a named staged changeset (active or not) to the base model, only after the human confirms it in an MCP elicitation dialog. Also the viewer's Apply and `dr changeset commit`. See [Landing](#landing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Landing

`changeset_commit` lands a plan from the conversation, but only once a person confirms it
(`motivation.requirement.landing-a-change-needs-a-humans-confirmation`):

- It is listed with `_meta: {"anthropic/requiresUserInteraction": true}`, so Claude Code shows a
  permission prompt on every call, whatever the permission mode.
- The server then always asks the client to confirm (`elicitation/create`, one boolean `confirm`
  field). The dialog shows the changeset's name, its intent (description), counts by operation, the
  layers it touches, any drift, and how validation went. It commits only on `accept` with
  `confirm: true`.
- It refuses, and writes nothing, when the person declines or cancels, when the client doesn't
  support elicitation, and in changeset-only mode (DrBot), where no person can answer. The refusal
  points at the viewer's Apply (`review_open`) first, then an interactive session, then
  `dr changeset commit <name>` in a terminal.
- Drift and validation follow the CLI and are checked with a dry run before the person is asked. A
  drifted changeset is refused unless `force: true` is passed, and the dialog then shows the drift;
  errors the changeset introduces always block. The commit is `StagingAreaManager.commit`, the same
  code `dr changeset commit` and the viewer's `POST /api/changesets/:id/commit` run, on a fresh read
  of the model. An active changeset is deactivated afterwards.
- It commits only what the person saw. After they accept, it re-reads the changeset (its staged
  changes, modified time and status) and the base model (elements and relationships), and refuses
  if anything changed while the dialog was open.

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

### What `project_status` reports

It reads local files and git only. It makes no network call and never starts the code analyzer.
Each section comes from its own collector (`cli/src/mcp/tools/project-status-collectors.ts`); one
that fails reports `status: "error"` and the others still answer.

- `project`: the root, and how it was found: `rootPath`, `DR_MCP_ROOT_PATH`, `mcp-roots` or `cwd`.
- `model`: `present` or `absent`. No model is not an error. The model is reread when its files
  changed since the server cached it (a CLI command, a pull, a hand edit).
- `spec`: the model's spec version against the CLI's: `current`, `behind` (with the migration
  steps, and whether they reach the CLI's version) or `ahead` (update the CLI). A manifest without
  `spec_version` is read as 0.6.0, as `dr upgrade` reads it, with `assumed: true`.
- `changesets`: the active changeset and every staged one, with change counts by operation and
  `baseDrifted` (the base model's hash against the one the changeset was opened on).
- `codeIndex`: what `dr analyzer status` reads in `.dr/analyzers/`, for the active analyzer (or,
  when none is active, the first with an index, and it says so). Its `status` follows the one
  freshness rule the codebase tools share (`judgeIndex` in `cli/src/mcp/tools/codebase-shared.ts`):
  `stale` when commits since the indexed commit changed source files (`changedSinceIndex`); commits
  that touch only `documentation-robotics/`, `.dr/` or non-source files don't count.
  `fresh-with-uncommitted-edits` when uncommitted source edits are newer than the index
  (`uncommittedEdits`). `fresh` otherwise, `unknown` without git or without the codebase root,
  `absent` with no index.
- `codeDrift`: the last commit that touched `documentation-robotics/model/`, the commits since,
  and the files changed since that elements reference as source files, committed or not. A renamed
  file counts under its old path. `drift`, `in-step`, `unlinked` (no element has a source
  reference), `no-git`, or `unknown` with a reason (the model never committed, or the code in
  another repository).
- `nextStep`: a sentence and the tool to call, in this order: `project_init` (no model),
  `project_upgrade` (model behind), `changeset_brief` (a changeset is active). On drift,
  `codebase_index` then `codebase_verify` when the index is not fresh, else
  `codebase_verify` then `codebase_extract` with `since`. Then `codebase_index` when there is no
  index or it is not fresh. Every `codebase_index` step carries `wait: 30`. Otherwise `changeset_activate` for a staged changeset, or
  `changeset_create`. When the call named a `rootPath`, the step's `args` carry it.

### What `codebase_extract` stages

The extraction cascade, run on the code the analyzer indexed (`cli/src/analyzers/cards/extract.ts`
reads it, `cli/src/analyzers/extraction-plan.ts` plans the changes). It needs a fresh index: missing,
stale or still running, it points at `codebase_index`. Freshness is the shared rule above. It runs inline, in a few seconds (this
repository: 4,769 symbols, 25,000 mapped edges, about 8 s), one run per project at a time. A run
that passes 100 s stops before staging anything and says to narrow it with `layers` or `since`;
so does a cancelled call. It warns when source files have uncommitted edits newer than the index
and suggests `codebase_index`.

1. **Tier 0.** Every candidate symbol gets a card and the first matching rule (the same as
   `dr analyzer classify --tier0-only`). A route no rule covers is an `api.operation` by the node
   mapping. A decided symbol becomes an element: its name from the symbol (`OwnerController.showOwner`,
   `GET /owners/{param}`), its description from the docstring, the attributes the code gives (an
   operation's method and path) and defaults for the type's other required attributes (an operation's
   summary, a test sketch's `automated` status), and a source reference (`extracted`, file and
   symbol). One whose attributes still don't validate (a repository query with no collection, an `ANY`
   route) goes to the agent as a `needs-attributes` card instead.
2. **Tier 1** is not wired (see Known limits).
3. **The agent.** Narrowed and undecided symbols come back as cards, 25 a page: the symbol, its file
   and lines, signature and docstring, the candidate types (or the analyzer's default as a `hint`) and
   why Tier 0 couldn't decide. `page: 2` and on read the run's cards without extracting again
   (`.dr/analyzers/extract/<changeset>.json`); a page asked with other `since` or `layers`, or at
   another commit, is refused, and one read after the base model changed carries a warning. Files of
   changesets no longer staged are pruned. The agent stages its decisions with `model_add`
   (`sourceFile` and `sourceSymbol` from the card, `sourceProvenance: "extracted"`) and calls `codebase_extract` again, which finds
   those elements by their source reference and stages their relationships.

What it stages is only what differs from the model, the base plus the extraction changeset itself:

- An existing element matches a symbol by source file and symbol (`Parent.method`, the qualified
  name, `METHOD /path` with its parameters named or not), first for every symbol, then by the looser
  spellings: the bare name, a route's method and path (only on an operation that names no code, so
  another service's `GET /health` isn't taken), and a decided symbol's type and id on an element that
  names no code yet. Each element matches one symbol; a second symbol whose only match is taken comes
  back as an `ambiguous` card.
- A match whose code-derived fields are the same is left out. One that differs is an update of those
  fields only: a missing source location, an operation's method and path (compared with parameters
  and a trailing slash normalised and the method's case ignored, so `/owners/{ownerId}` stays), and
  the description from the docstring, only when the element has none or still has the one extraction
  wrote (`.dr/analyzers/extract/descriptions.json`): a description someone wrote stays. An update of
  an element the changeset adds rewrites the add. A match Tier 0 now types differently is listed in
  `retyped`.
- A decided symbol with no match is an add. On an empty model, that is the bootstrap. Re-running on
  unchanged code stages nothing.
- Relationships: the edge mapping's relationship for every mapped CBM edge with an end in scope,
  between two elements (staged or existing), when the model doesn't have it.
- **Deletes are never staged.** An element is a candidate delete, with its evidence, when its file
  was deleted or renamed in the `since` range (`replacedBy` names the element staged at the new path),
  when its file is missing (without `since`), or when the file no longer has its symbol and the name
  appears nowhere in the file. The agent stages `model_delete` for the ones that are really gone.

`since` (a git ref) limits the run to the files changed between its merge base with HEAD and the
working tree, and a route with no file of its own is read only when its handler is in one of them.
`layers` limits it to those layers. The changeset (`changeset`, default `extract-<short sha>`, or
`extract-<base>..<head>` with `since`) is created when absent and reused when staged. Everything is
staged in one write, and the changeset is activated last, so the agent's `model_add` calls stage
into it. The result's `previousActive` is the changeset active before the first run on it, returned
on later runs too while it is staged, so a verify run can switch back to the plan. When there is
nothing to stage, no cards and no candidate deletes, no changeset is created or activated. It
returns what it staged by layer, what it left unchanged, the candidate deletes, the first page of
cards and the next steps.

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
    three examples. On a copy of heimdall, planning a new layout function this way reports that its sibling
    functions each have an API operation realizing them and a test sketch testing them.
- **Intent.** Changed elements outside the motivation, business and product layers that reach no
  element in those layers within four hops. A change that serves no stated intent is a question for
  the human. Each trace carries its `path`. The trace doesn't walk through hubs (elements with more
  than 15 relationships). An intent element the changeset adds counts only when it traces to an
  existing one (`anchoredBy`); otherwise the elements that reach it are untraced and listed in
  `intent.unanchored`.
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
(`against: {"changesetId": ...}`), staged by `codebase_extract` with `since` (or written by hand), or
the base model (`against: {"base": true}`), once the as-built changes are committed.

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

| Need                              | Tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is left to wire              | `changeset_brief` lists **unwired** connections: for each added or updated element, the triples the catalog defines for its type, in either direction, that the element has no relationship for. They are grouped by the other end's layer, each with `existingCount` (elements of the other type outside this changeset) and `addedCount` (ones this changeset adds), so the planner knows whether to link one or add one. `unwired: "summary"` (default) lists entries only for layers the change reaches and only for types the model has, and counts the rest per layer as `typesNotInModel`; `"full"` lists all; `"none"` leaves it out. `unwiredLayers` lists the entries for chosen layers. |
| What changed since the last pass  | `changeset_brief` returns `revision` and `revisionToken`. Passing the token back as `since` adds a `delta`: elements added, removed and updated (with the fields), relationships added and removed, changes unstaged since, gaps opened and closed, unwired connections wired or new, layers newly reached or no longer reached, intent newly traced or untraced. Sequence numbers are never reused: each stage, unstage and in-place rewrite takes the next one, and an unstaged or rewritten change leaves a tombstone in the changeset's metadata (the last 200), so the earlier plan is rebuilt exactly. The token warns if `changes.yaml` was edited by hand.                                 |
| What one element touches          | `changeset_impact` with `from` (element ids) walks from those elements instead of every changed one. `perHop` counts what each hop adds. A hub, an element with more relationships than `hubThreshold` (default 15), is listed in `hubs` with its degree and not walked through, unless `expandHubs` is set.                                                                                                                                                                                                                                                                                                                                                                                       |
| A short view of the plan          | `changeset_show` with `detail: "summary"`: one entry per change (sequence, operation, element or relationship, changed fields) and totals per operation, without the before and after snapshots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Change one attribute              | `model_update` with `attributePatch` (`dr update --attribute-patch`): merged shallowly into the element's attributes, over staged values in a changeset; `null` removes a key. Required attributes need not be repeated. `attributes` still replaces them all.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Drop everything staged at one end | `changeset_unstage` with `source` alone or `target` alone, optionally with `predicate`, drops every staged relationship add and delete at that end. Relationship removals cascaded by a staged element delete are kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

On a copy of heimdall, planning a layout-snapshot export endpoint this way took nine passes and settled by the
seventh: seven elements in seven layers, every one tracing to intent, one gap accepted. Most
decisions came from `unwired` (filtered with `unwiredLayers`) and peer-pattern gaps, with focused
impact as the check.

Accepted gaps, a gap the planner or the human decides to leave open, are written today into the
changeset's description or an annotation, and the brief doesn't read them back, so it reports them
again every pass. Recording them in the model, with the reason, is
tinkermonkey/documentation_robotics#1026.

## Using it from Claude Code

Install the `dr` Claude Code plugin once per machine (`claude plugin marketplace add
tinkermonkey/documentation_robotics`, then `claude plugin install dr@documentation-robotics`). It
registers `dr mcp` for every project. The server serves the project the session has open, which
it learns from the client's MCP roots, and needs no API key over stdio. `DR_MCP_ROOT_PATH` pins it
to one model instead. Registering the server by hand is in
`integrations/claude_code/docs/MCP_SERVER.md`.

Then `/dr-plan <change>` runs the loop:

1. Confirm the change's name and intent with the human, then `changeset_create` with them.
2. `model_search` for what exists; `spec_type` for what a new element must carry and may connect to.
3. Stage elements and relationships across every layer the change reaches.
4. `changeset_brief`, then `changeset_impact` for anything the brief's reach or gaps question.
   Revise until the gaps are answered or accepted. An accepted gap is
   recorded in an annotation or in the changeset's description.
5. `review_open` and hand the human its link, which opens the changeset on the graph in the viewer
   (`dr visualize`); read their annotations, revise.
6. Build from the brief. Keep the changeset staged and commit its files on the branch.
7. `codebase_index`, then `codebase_extract` with `since` (the branch the work started from) stages
   the build into an as-built changeset; `changeset_verify` the plan against it. Fix what diverges,
   in the code or in the plan, then `changeset_activate` the plan again.
8. The human commits the changeset in the PR that ships the code: they ask the agent to land it
   (`changeset_commit`) and confirm in the dialog, or commit it in the viewer or the CLI.

The steps live in the skill (`integrations/claude_code/skills/dr_change_planning/`); the command
points at it. Copilot gets a copy of the skill in `integrations/github_copilot/skills/`.

### DrBot

The chat agent that `dr visualize` launches works through the same `dr mcp` server, so a
conversation in the viewer and a session in the terminal see the same changeset with the same
tools. Each launch writes a private MCP config (in a `0700` temp directory, removed when the agent
exits) that runs this dr installation as `dr mcp` over stdio, with `DR_MCP_ROOT_PATH` set to the
served project and, under `--with-changesets`, `DR_CHANGESET_ONLY=true`. It holds no API key: over
stdio there is none.
Its allowed tools follow the mode: read-safe gets the read tools; `--with-changesets` adds the
changeset and staging tools and turns on changeset-only mode. Neither mode gets `chat_launch`, the
annotation writers, `changeset_discard`, `changeset_commit`, `project_init`, `project_upgrade` or
`review_open` (DrBot is already in the viewer). Danger mode skips permissions, as it always has; the
server still refuses `changeset_commit` in changeset-only mode. If the
installed `dr-architect` agent predates MCP, the launch warns once to run `dr claude upgrade` and
skips MCP. If the config can't be written, DrBot launches as before
(through Bash) and the server logs a warning.

DrBot remembers the conversation. The viewer sends its conversation id with each message; the
server starts a Claude Code session for a new id and resumes it for later messages, so a new id
starts a fresh conversation.

The viewer sees each tool call start and finish: `chat.tool.invoke` arrives as `executing`, then as
`completed` or `failed` with the same `tool_use_id`. A call blocked at the permission prompt shows
as failed. Changes to changesets reach the viewer as they happen: the server watches
`documentation-robotics/changesets/` and broadcasts `changesets.updated`, so a changeset made or
staged from the terminal or by DrBot appears without a refresh. The messages are in
`cli/docs/VISUALIZATION_SERVER_PROTOCOL.md`.

### Opening the plan in the viewer

`review_open` returns `{ url, reused, port, changesetId, changesetName }`. The link is
`http://localhost:<port>/?token=<token>#/changesets/list?changeset=<id>`: the viewer reads the
token from the query string before the hash, and the route selects the changeset in the overlay.
Without auth (`--no-auth`) there is no token.

Each `dr visualize` records `{ pid, port, token, projectRoot, startedAt, withChangesets }` once it is
listening, and removes the record on exit. The record is in the user's state directory, never the
repository: `$XDG_STATE_HOME/dr/viewers/`, else `~/.local/state/dr/viewers/` (`DR_STATE_DIR`
overrides), one `0600` file per project, keyed by a hash of the project root, written atomically.
A record counts only while its pid is alive and the server answers `/health` (one retry with a
longer timeout). A record whose pid is dead is removed. One whose pid is alive but doesn't answer
is kept, and `review_open` reports it (pid and log) rather than start a second viewer
(`probeViewer` and `findRunningViewer` in `cli/src/server/viewer-registry.ts`). A viewer
`review_open` starts writes its output next to the record (`<hash>.log`) and a `<hash>.starting`
marker while it loads, so other calls wait for it. A call waits up to 60s; a viewer still loading
after that is left running, and the call says to try again. The viewer runs without the MCP
server's changeset-only setting, since the human commits there.

## Known limits

- Impact walks relationships in both directions and does not weigh predicates. Whether, say, a
  `serves` edge carries impact upstream or downstream is a refinement for after real use.
- Verify no longer needs a hand-written as-built side: `codebase_extract` with `since` stages it.
  What Tier 0 can't decide still comes back to the agent as cards, so that part of the as-built side
  is only as independent as the agent is careful. Extraction writes a changeset, so verify reads it
  through `builtFromGraph`; `builtFromSnapshot` stays for a run that doesn't write one.
- Tier 1 (Clef) is not wired into `codebase_extract`. It waits for the per-project opt-in
  (`docs/EXTRACTION_STRATEGY.md`, B6); until then every card Tier 0 narrows or leaves open goes to
  the agent, which on a TypeScript codebase is most of them (this repository: 31 of 4,769 symbols
  staged by the rules).
- Which descriptions `codebase_extract` wrote is recorded in `.dr/analyzers/extract/`, which git
  doesn't carry. In another clone it treats every existing description as someone's own and leaves
  it.
- `codebase_extract` never stages a delete or a relationship removal. Elements whose code is gone are
  listed for the agent; relationships the code no longer shows are not reported yet.
- `changeset_discard` can't be undone. It is gated by `confirm: true`; `changeset_unstage` and
  `changeset_deactivate` are the gentler choices.
- DrBot on Copilot, and `dr chat` / `chat_launch`, still run `dr` through Bash.
- Through Bash, DrBot can run one `dr` command per call. Its Bash access is one allow rule per
  `dr` command, and Claude Code checks each part of a compound command on its own, so a pipe, `&&`,
  `;` or redirect needs approval that nobody can give under `--print`, and the call is denied. The
  `dr-architect` prompt tells the agent to run single commands with `--json`. The allowlist stays
  narrow on purpose: adding general shell commands would undo the read-safe boundary.
- DrBot on Copilot forgets the conversation between messages. The Copilot CLI can resume a
  session by id, but the server can't set that id or read the one Copilot makes.
- A delta reaching back past the 200 most recent unstages or rewrites can't rebuild the earlier
  plan; it says so.
- `unwired: "full"` is still large for types with many triples (an API operation lists every
  OpenAPI type it may connect to). The default summary leaves out types the model has none of.
- `dr changeset commit` commits the active changeset only; activate the one to commit first.
  `changeset_commit` takes any staged changeset by id or name.
- `changeset_commit` needs a client that supports MCP elicitation; without it the tool refuses and
  the human commits in the viewer or the CLI. The server can't tell whether a client honoured
  `anthropic/requiresUserInteraction`, so it always asks. An elicitation alone is not a hard gate
  (a Claude Code `Elicitation` hook can answer it), which is why the flag is there too. The dialog
  waits 10 minutes, then the commit is refused.
- The tools have not yet been used on a real change.
