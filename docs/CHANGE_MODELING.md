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

| Stage         | Tool                                                         | Status   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start         | `project_status`                                             | gateway  | Where the repo stands with DR: model, spec version, changesets, code index, code changed since the model last did (git). Ends with the next step and its tool. The first call in a session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Onboard       | `project_init`                                               | gateway  | Create an empty model at the current spec version in the open folder, without prompts. Fails if it has a model; installs no integration files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Upgrade       | `project_upgrade`                                            | gateway  | Preview moving the model to the spec this dr carries (version path, type renames, relationship rewrites, what it can't migrate, and `wouldOrphan`: the elements the migration's own dry-run relationships leave with no relationship or reference, by their new ids); `apply: true` runs it, lists the model files it wrote, added and removed (`filesModified`, `files`), and validates the base model with the warnings `dr validate` reports (orphans, missing source references); `force: true` with `apply` stamps an additive spec change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Frame         | `changeset_create`                                           | slice 1  | Create a changeset from a name and the change's intent, and activate it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Frame         | `changeset_activate`                                         | slice 1  | Make an existing staged changeset the one mutations stage into.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Frame         | `changeset_deactivate`                                       | slice 1  | Stop staging; mutations write the base model again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Frame         | `changeset_update`                                           | slice 2  | Rename a changeset or change its description (the intent). Names stay unique.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Frame         | `changeset_list` / `changeset_show`                          | existing | All changesets and which is active; one changeset with its staged changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Orient        | `spec_type`                                                  | slice 1  | A node type's definition, attributes (required, enums), and the relationships the catalog allows to and from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Orient        | `model_search` / `model_show` / `model_trace` / `model_list` | existing | Find and read elements. Inside a changeset they read the plan (slice 2): `model_show` lists relationships with a status, `model_search` gives a `changeStatus`, `model_trace` follows staged edges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Draft         | `model_add` / `model_update` / `model_delete`                | existing | Stage element changes. `model_add` takes a list too (`elements`, with `relationships` that may name them), staged in one write; each item is validated on its own and an invalid one is skipped and reported. A `sourceFile` sent without `sourceProvenance` gets `manual`; an `extracted` or `manual` provenance without a file is ignored with a warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Draft         | `relationship_add`                                           | slice 1  | Stage relationships, validated against the catalog; works between elements that exist only in the changeset. Takes one or a list (`relationships`), the list staged in one write with a result per item: staged, restored, duplicate, or invalid with the reason. A repeat is reported as a duplicate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Draft         | `relationship_delete`                                        | slice 1  | Stage a relationship removal, or drop a relationship this changeset added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Draft         | `changeset_unstage`                                          | slice 2  | Drop the staged changes to one element, one staged relationship add or delete, or every staged relationship change at one end (`source` or `target` alone). Unstaging an add also drops the staged relationships to it. `changes: [...]` takes several of these in one call and one write, with a result per item.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pressure-test | `changeset_impact`                                           | slice 1  | Walk the projected graph outward from every changed element; list the existing elements reached, by layer, with their source files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Pressure-test | `changeset_brief`                                            | slice 1  | The changeset as a spec: changes by layer with their connections, layers reached and not, gaps, intent trace, code touched, open annotations, drift. Compact by default; `detail: "full"` or `sections` for the rest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Pressure-test | `model_validate`                                             | existing | Validate the model (base + active changeset). With `layers`, as `dr validate --layers`: a relationship or reference whose other end lies outside the layers isn't validated, but is still an error when that end exists nowhere in the model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Review        | `review_open`                                                | gateway  | A link that opens a changeset (default the active one) on the graph in the viewer. Reuses the viewer running for the project or starts `dr visualize --with-changesets`, which keeps running after the session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Review        | `annotation_*`                                               | existing | Read and answer the human's comments on elements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Build         | `changeset_brief`                                            | slice 1  | The same brief is the build's input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Index         | `codebase_index`                                             | gateway  | Index the code with codebase-memory-mcp in the background. Returns the job: `state` (`running`, `done`, `failed`), `startedAt`, `finishedAt`, `error`, `progress` and `logPath`, and the index's `state`. With `wait` (seconds, at most 50) it blocks until the run ends or the wait does; without it, it returns at once. Start with `wait: 30`, then call it with `status: true, wait: 30` until the job ends. A call during a run returns that run; `force` stops it and starts over. Skips a fresh index unless `force`; re-indexes uncommitted edits newer than the index without it. The run indexes the codebase root the server resolved. Selects an installed analyzer if none is, and says how to install codebase-memory-mcp when it is missing. The job is `.dr/analyzers/index-job.json`. With codebase-memory-mcp, each run first adds `/documentation-robotics/` and `/.dr/` to a `.cbmignore` at the codebase root (creating it, keeping the developer's lines, and leaving alone a folder the file negates), since the analyzer takes no exclude argument and DR's folders are committed; `ignoreFile` says when it changed the file for a run that started, to commit with the code. |
| Verify        | `codebase_verify`                                            | gateway  | The API layer only: the HTTP routes the analyzer found in the code against the model's API operations (on a library or code with no routes, every operation is in the model only, which is not drift): matched, in the code only, in the model only, and ignored, with a summary (the `dr analyzer verify --json` report). Needs a fresh index; without one, or while a run is in flight, it points at `codebase_index`. Read-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Extract       | `codebase_extract`                                           | gateway  | Run the extraction cascade on the indexed code and stage what differs from the model into an as-built changeset (default `extract-<sha>`; created and left active when the run stages something, `previousActive` returned). Tier-0 decisions are staged with their relationships; the rest come back as paged cards for the agent, and `reject` records the ones that are not elements so later runs leave them out. `since` limits it to files changed since a git ref. Needs a fresh index. Never writes the base model or commits. See [What `codebase_extract` stages](#what-codebase_extract-stages).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Verify        | `changeset_verify`                                           | slice 2  | Compare the plan with what was built: an as-built changeset, or the base model. Also `dr changeset verify` on the CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Abandon       | `changeset_discard`                                          | slice 2  | Abandon a changeset. It deletes the staged changes for good, so it needs the changeset named explicitly (id or name) and `confirm: true`. Only its record stays (`metadata.yaml` with name, description and status `discarded`, and an empty `changes.yaml`); the base index and other side files are removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Land          | `changeset_commit`                                           | gateway  | Commit a named staged changeset (active or not) to the base model, only after the human confirms it in an MCP elicitation dialog. Also the viewer's Apply and `dr changeset commit`. See [Landing](#landing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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
- `dr changeset commit [changeset]` takes the changeset's id or name too. A named changeset that
  isn't active is activated for the commit, with the same drift, `--force` and validation handling,
  and the changeset active before is active again afterwards (also when the commit fails).
- Land the plan, not the as-built changeset. After verify, the as-built changeset from
  `codebase_extract` is discarded or kept as a record. Landed first, it changes the plan's base: the
  plan then needs `force`, and its descriptions don't apply to the elements the as-built side
  already added. When the changeset being committed came from `codebase_extract` (its description,
  or extraction's record of it) and a plan is staged, the dialog warns that the plan should land
  instead, and the result carries the warning in `warnings`.
- A commit regenerates the reports of the layers it changed: each changed element's layer and the
  layers at the other end of its relationships (read before and after the changes apply, so a
  relationship a delete purges still refreshes its other end), and both ends of each relationship change. A report
  (or `documentation-robotics/README.md`) is rewritten only when its content changes; its
  generation time and the README's "Last Updated" row don't count. The CLI, `changeset_commit` and
  the viewer's Apply share this path.

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
  `fresh-with-uncommitted-edits` when the uncommitted source files differ from what the index
  read (`uncommittedEdits`): `codebase_index` records them, with content hashes, as each run starts
  (`.dr/analyzers/<analyzer>/index-worktree.json`), so an edit, delete, rename or revert since then
  shows. For an index without that record, every uncommitted delete and renamed-away path counts,
  plus files written after the index time (the time the run started); an mtime in the future is
  ignored. Vendored and built code doesn't count. `fresh` otherwise, `unknown` without git or without the codebase root,
  `absent` with no index.
- `codeDrift`: the commit drift is counted from (`modelCommit`), the commits since, and the files
  changed since that elements reference as source files, committed or not. That commit is the last
  commit to `documentation-robotics/model/` that isn't a spec migration
  (`basis: "last-non-migration-commit"`): a commit whose diff of `manifest.yaml` changes
  `spec_version` rewrites the model without checking it against the code, so it is walked past
  (up to 50 model commits), and `lastModelCommit` names the newest one with a `note`. Any other
  model commit (a landed changeset, a catch-up after `codebase_verify`, a hand edit) resets drift.
  A merge that brings in a migration counts as one (its manifest is diffed against its first
  parent). Two limits: other model edits made in a migration commit don't reset drift, and an
  upgrade committed in two parts (the model files first, the manifest after) can under-report,
  since the first part reads as an ordinary model commit. When every recent model commit is a migration, or git can't tell them apart, the last model
  commit (`basis: "last-model-commit"`, with a `note`). A renamed file counts under its old path. `drift`, `in-step`,
  `unlinked` (no element has a source reference), `no-git`, or `unknown` with a reason (the model
  never committed, or the code in another repository).
- `nextStep`: a sentence and the tool to call, in this order: `project_init` (no model),
  `project_upgrade` (model behind), `changeset_brief` (a changeset is active). An active as-built
  changeset (one `codebase_extract` staged; `changesets.active.asBuilt`) is never "the plan": with
  a plan staged (the extraction record's `previousActive`, else the one other staged plan) the step
  is `changeset_verify` with `planned` and `against: {changesetId}`, and `also` is
  `changeset_activate` for the plan; with several plans and no record it names them and picks
  none; with none it is a keep-as-built catch-up, `review_open`, then `changeset_commit` when the
  user asks. On drift,
  `codebase_index` then `codebase_verify` when the index is not fresh, else
  `codebase_verify` then `codebase_extract` with `since`. Then `codebase_index` when there is no
  index or it is not fresh. Every `codebase_index` step carries `wait: 30`. Otherwise `changeset_activate` for a staged changeset, or
  `changeset_create`. When the call named a `rootPath`, the step's `args` carry it. A step that
  isn't `codebase_index` carries `also` when the index needs attention alongside it: an index run
  in progress (`codebase_index` with `status: true, wait: 30`), or, with a changeset active, an
  index that is stale or predates uncommitted edits (`codebase_index` with `wait: 30`). The
  sentence says it too, so the changeset step and the index both show.

### What `codebase_extract` stages

The extraction cascade, run on the code the analyzer indexed (`cli/src/analyzers/cards/extract.ts`
reads it, `cli/src/analyzers/extraction-plan.ts` plans the changes). It needs a fresh index: missing,
stale or still running, it points at `codebase_index`. Freshness is the shared rule above. It runs inline, in a few seconds (this
repository: 4,769 symbols, 25,000 mapped edges, about 8 s), one run per project at a time. A run
that passes 100 s stops before staging anything and says to narrow it with `layers` or `since`;
so does a cancelled call. It warns when source files have uncommitted edits newer than the index
and suggests `codebase_index`; its `index.state` is then `fresh-with-uncommitted-edits`, as
`project_status` says.

1. **Tier 0.** Every candidate symbol gets a card and the first matching rule (the same as
   `dr analyzer classify --tier0-only`). A route no rule covers is an `api.operation` by the node
   mapping, if the code serves it: a route with no file of its own and no `HANDLES` edge is a URL
   that tests or clients call (`/owners/1` from a test), and is never decided. It comes back as an `unhandled-route` card, last. A decided symbol becomes an element: its
   name from the symbol (`OwnerController.showOwner`, `GET /owners/{ownerId}`), its description from
   the docstring, the attributes the code gives (an operation's method and path) and defaults for the
   type's other required attributes (an operation's summary, a test sketch's `automated` status), and
   a source reference (`extracted`, file and symbol). A route keeps the code's parameter names: from
   CBM's stored route name, else a path literal in the handler with as many parameters, else the
   handler's path parameters (`{param}` when none of these names them). The root route's id is
   `api.operation.get-root`. One whose attributes still don't validate (a repository query with no
   collection, an `ANY` route) goes to the agent as a `needs-attributes` card instead; its
   `proposed.name` is one `model_add` turns into `proposed.id` (`PetTypeRepository findPetTypes`,
   since `model_add` drops a dot rather than breaking the word there).
2. **Tier 1** is not wired (see Known limits).
3. **The agent.** Narrowed and undecided symbols come back as cards, 25 a page (at most 50): the
   symbol, its file and lines, signature and docstring, the candidate types (or the analyzer's
   default as a `hint`) and why Tier 0 couldn't decide. A card's `name` is one `model_add` turns into
   the id extraction would give the symbol, with dots and slashes as word breaks: a module's is its
   path without the extension (`src utils graphDegree`, so `…applicationcomponent.src-utils-graph-degree`),
   a route's its method and path (`GET owners ownerId`). A response is kept under about 28 KB, so a
   client doesn't save it to a file. When the other lists alone (candidate deletes, updates,
   `retyped`, recorded decisions) would pass that, they list fewer items, and `listsShortened` says
   so (each `total` keeps the full count). Then a page that would be larger has its cards shortened
   (`undecided.detail: "shortened"`, then `"compact"`, with a note), and as a last resort is cut
   short: `undecided.cut`, `next` and the next steps all give the paging call that continues right
   after the cut. A response that can't fit even so says `overBudget`. `page: 2` and on read the run's cards without extracting again
   (`.dr/analyzers/extract/<changeset>.json`), with the run's `since` and `layers`. A page call, or a
   run into an existing extraction changeset, keeps that run's `since` and `layers`; with no
   `changeset`, a page or `reject` call reads the active extraction changeset, else the one staged
   changeset with a run at this commit (with several, it is refused and names them). One that names others, or one at another commit, is refused, and the error quotes
   both values. One read after the base model changed carries a warning. Files of changesets no
   longer staged are pruned. The agent stages its decisions with `model_add` (`sourceFile` and
   `sourceSymbol` from the card, `sourceProvenance: "extracted"`) and calls `codebase_extract` again, which finds those elements by
   their source reference and stages their relationships.
4. **Not-an-element decisions.** Code that is not an element goes back in `reject`
   (`[{card, reason}]`). `card` is a cardId (of the last run, or of an earlier run's card the agent
   has modelled since, even one it then unstaged), a symbol the extraction staged (one Tier 0
   decided, such as a crash demo's controller and route), the id of an element staged from it, or a
   bare symbol, `file#symbol` or qualified name only one of those has. An element id names every
   symbol the element's source locations name. Only an extraction changeset (one with cards, or
   that adopted waiting ones) is looked in, and in it only elements extraction staged or whose
   reference is `extracted`: a hand-written element is never unstaged. Such an element still staged
   for a rejected symbol is unstaged with the relationships staged for it, and the result lists it
   under `unstaged`, so the decision holds now and not only once the changeset lands. One that also
   names code that wasn't rejected stays staged, listed under `kept` with what else it names. One the
   base model already has stays, listed under `inModel`. A call with only `reject`
   or `clearRejected` records them and runs nothing else. They are kept per project, by file and symbol
   (a route by its file and normalised path, so a rejected client URL can't hide a served route), in
   `.dr/analyzers/extract/decisions.json`, until cleared. An element extraction staged that the
   agent unstages (the changeset keeps a tombstone of it) is recorded on the next run too, but only
   while that changeset stays staged: discarding or landing it drops the decision. Later runs, into
   any changeset, neither stage nor card those symbols, unless one has an element by then, and
   report the count in `notElements.skipped`. `clearRejected` (`true`, or a list of symbols)
   forgets them. Decisions are read and written under the run lock.

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
  between two elements (staged, existing, or added by the agent from a card), when the model doesn't
  have it. An end with no element of its own (a method of a class modelled as a component) counts as
  the class or module it is in. `INHERITS` is `specializes` between two elements of a type the catalog
  lets specialize (entity classes); a test case's calls are `tests` where the catalog has the triple
  (functions, interfaces, services, operations); and a test that calls a served route by URL
  (`get("/owners/{ownerId}")`) is an `HTTP_CALLS` edge to it, so the test `tests` the operation.
- **Deletes are never staged.** An element is a candidate delete, with its evidence, when its file
  was deleted or renamed in the `since` range (`replacedBy` names the element staged at the new path),
  when its file is missing (without `since`), or when the file has no symbol of that name and the name
  appears nowhere in it. With `since`, the file's text at the range's base decides which:
  `symbol-missing` when the file had the name there, `reference-never-matched` when it didn't (the
  range removed nothing; the element's reference was wrong before it). The agent stages
  `model_delete` for the ones that are really gone.

`since` (a git ref) limits the run to the files changed between its merge base with HEAD and the
working tree, and a route with no file of its own is read only when its handler is in one of them.
DR's own folders (`documentation-robotics/`, `.dr/`) are never in it, nor are files that are neither
source code nor named by an element (a README, a lockfile). Cards whose own lines the range changed
say `changedInRange: true` and come first; `undecided.changedInRange` counts them. A change is
credited to the innermost card it touched: a class whose only changed lines are in a changed method
card isn't flagged. Code deleted from inside a symbol counts for that symbol, not for the member
whose last line it follows. A module card is flagged only when the range added its file, or renamed
a file to its path.
`layers` limits it to those layers. The changeset (`changeset`, default `extract-<short sha>`,
`extract-<base>..<head>` with `since`, or `extract-<sha>+worktree` for a range of uncommitted edits
only) is created when absent and reused when staged. Everything is
staged in one write, and the changeset is activated last, so the agent's `model_add` calls stage
into it. The result's `previousActive` is the changeset active before the first run on it, returned
on later runs too while it is staged, so a verify run can switch back to the plan.

A run creates and activates a changeset only when it stages something. One that stages nothing
creates nothing, so no empty changeset is left to sit in `project_status` as the next thing to
resume. If it still leaves cards or candidate deletes, its `message` and `next` name the
changeset to create first (`changeset_create`, which makes it active) before `model_add` or
`model_delete`; its cards wait in `.dr/analyzers/extract/pending.json`, where `page` and `reject`
read them, and the changeset of that name adopts them (with the run's `since`, `layers` and
`previousActive`) on the next `codebase_extract` into it, or on a `reject` that unstages from it.
Waiting cards are only for the commit they were read at: after HEAD moves they are dropped, not
adopted. It returns what it staged by layer, what
it left unchanged, the candidate deletes, the first page of cards and the next steps. A `since` run
with a plan active before it is the verify workflow, and its next steps say so: stage the cards
named after their symbols (never the plan's elements, never copies of them), ask the user about the
ones that can't be placed, re-run for relationships, then `changeset_verify`; after verify the plan
lands, not the as-built changeset, which is discarded or kept as a record.

Its record of what it staged (`.dr/analyzers/extract/<changeset id>.json`, the `staged` list read by
`changeset_verify`) holds the elements it staged itself and those the agent staged from its cards:
a re-run records a card whose symbol an element added in the changeset now names, with that
element's id. Each entry carries the `name` and `attributes` the element was staged with (for a
card, as the element was when first recorded). The record also lists the updates extraction staged
(`updated`: element id, the fields it changed and, in `values`, the value it wrote for each, keyed
like `fields`: `description`, `source_reference`, `attributes.<key>`; the latest run's value wins;
an update folded into an add included; an entry
goes when its change is unstaged or the element rejected), the ids it listed as candidate deletes
(`candidateDeletes`), both accumulated across runs, and earlier runs' cards whole (`earlierCards`,
with their candidates, name and proposed element). Waiting cards (`pending.json`) carry the same
fields. `isExtractionChangeset(projectRoot, id, name?)` says whether a changeset is one it
stages into.

### What `changeset_brief` reports

By default the brief is compact, so it fits in one tool result: 12–17 KB for a 10–12 element plan
on heimdall, 11 KB for the 144-element petclinic bootstrap (the full brief is 60–68 KB and 470 KB).
It holds:

- the changeset's description in full (accepted gaps and decisions are recorded there);
- counts by layer and operation (`byLayer`, `summary`) and the reach;
- gaps, one line each (`element: kind: detail`);
- intent as ids: `traced`, `untraced`, `unanchored`;
- drift, with the overlap as lines and the base changes as counts plus the changed and removed ids;
- unwired connections counted per layer (the listing is opt-in: pass `unwired`);
- `codeTouched`, the files of the changed elements, and `neighborFiles`, the files that hold only
  existing elements next to the change (the build must not break them);
- open annotations, one line each;
- `changes`: each changed element's id and operation (its type is the id's second segment), its
  description cut at 160 characters, its `sourceFiles` (a file's name alone when no other touched
  file has it), and its connections as `predicate → id` lines (`predicate ← id` for one from an
  element the change does not touch; `(base)` and `(deleted)` mark relationships the base has or
  the change removes). Attributes are in the full brief.

A large plan (more than 60 changed elements, such as a bootstrap) gets `changesByType` instead of
`changes`: per `layer.type`, the counts by operation and the first 5 ids, with how many more.
`sections: ["changes"]` lists every element. Past 30 entries, the
intent lists and the delta's lists are cut, with their full lengths under `counts`, and gaps that
say the same thing (a bootstrap's unconnected adds) share one line with the count and the first ids.

`detail: "full"` returns the full brief described below, unchanged. `sections: [...]` returns only
the sections named, each in full, under a small header: the revision and its token, the changeset's
id, name and status, and the summary counts. The sections are `changes`, `changeset` (the
description and the drift in full), `drift`, `layers`, `unwired`, `intent`, `gaps`, `codeTouched`,
`feedback`, `relationshipChanges`, `alreadyInBase` and `delta`. With `since`, the delta comes too,
compact unless `delta` is named; `unwired` or `unwiredLayers` count as naming `unwired`. With
`since` and no sections, the compact brief leaves out `changes`, since the delta says what changed.

`sections: ["changes"]` is the build view: each changed element with its name, its description in
full, its attributes, for an update each changed field with its value before and after, its files,
and its connections as `predicate → id` lines. It carries what `layers` does for the build without
the other end's name and layer on every connection: 17 KB for a 12-element heimdall plan (`layers`
is 38 KB), 58 KB for the 144-element petclinic bootstrap (`layers` is 165 KB). `layers: [...]` and
`ids: [...]` narrow the element sections (`changes`, `layers`, `gaps`, `unwired`, `intent`,
`feedback`) to the changed elements in those layers or with those ids: the bootstrap's `api` layer
is 8 KB, its `testing` layer 32 KB. Without `sections` they narrow nothing, and the result's `note`
says so.

The full brief:

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
  it no longer has, updates of elements changed in the base, and relationships the plan adds or
  deletes with an end on a base element that changed or was removed since, as
  `endpoint-changed-in-base` or `endpoint-removed-in-base` with the `endpoints`) and, when the
  changeset has a base index, what was added, removed or changed in the base (`baseChanges`). The
  plan doesn't edit an element it only links to, but that element is not what the plan saw. Staged
  adds the base already has are counted as `alreadyInBase`, apart from the adds, for elements and
  relationships alike. New changesets record the base index (`base-index.json` in the changeset's directory);
  older ones report `baseIndex: "not-recorded"`.

### What `changeset_verify` reports

It compares a planned changeset with what was built. The built side is an as-built changeset
(`against: {"changesetId": ...}`), staged by `codebase_extract` with `since`, or the base model
(`against: {"base": true}`), once the as-built changes are committed. An as-built side the agent
writes itself proves little: a copy of the plan matches by definition.

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
- The report lists matched, missing, unverifiable, unplanned, divergent (with the differing fields,
  both values, `null` where a side has none) and planned deletions that still exist, with a verdict:
  `match`, `probable-match`, `diverges`, `incomplete`, `unverifiable` (nothing in the plan can be
  checked) or `empty-plan`. `summary.matched` counts divergent matches too; `divergent` is the subset.
- **Unverifiable.** When the as-built changeset came from extraction (`codebase_extract` has a record
  of it; its description, or elements that declare `sourceProvenance: "extracted"`, don't count), a
  planned change that the build lacks
  and that extraction can't produce is `unverifiable`, not missing, and is left out of the verdict.
  What extraction can produce is read from the analyzer's mapping (`spec/analyzers/cbm/`): the
  element types of the node mapping and the Tier-0 rules (with their file conditions), the
  relationships the edge mapping makes between those types (as `relationshipFor` decides them, with
  from_types and to_types), and the attributes the node mapping fills. So intent (motivation,
  business, product) never is; an `api.operation` sourced to a barrel file (a package entry that
  re-exports) with no method and path is not, nor is one planned with no method, path or source
  reference (the reason says to give it a method and path, or the handler's file and symbol, to
  make it verifiable; when the build has unplanned operations, one of them may be it, so it stays
  `missing` with that advice); test cases are not in JavaScript or TypeScript files,
  which get no test cards; edges between infrastructure labels no mapping produces make nothing; a
  component's `assigned-to` a function is only when the function is a class method. A planned update
  to a field extraction never writes (the description, an attribute the node mapping doesn't fill)
  that the build left alone is unverifiable per field (`unverifiableFields` on the match, or `fields`
  on an unverifiable element); `http_method` and `http_path` are code facts and are checked, with
  path parameters compared by position (`{ownerId}`, `:id` and `{}` are the same) and the method
  ignoring case. See `cli/src/core/extraction-observability.ts`. A plan whose observable part matches
  gets `match` with the unverifiable count beside it. Against a hand-written changeset every planned
  change is checked; against the base model too, unless `against` has `extracted: true` (the base
  holds a landed extraction of the build).
- **Descriptions are notes.** A description that differs (prose against a docstring, or extraction's
  placeholder text) is listed as `notes` on the match, not as a divergence. Don't edit the plan to
  match it. A planned update that changes the description still has it checked.
- **Where the as-built side came from.** It is read from `codebase_extract`'s own record of the
  changeset (`.dr/analyzers/extract/<changeset id>.json`), not from the provenance the elements
  declare or the changeset's description. A run that staged nothing leaves its record in
  `pending.json`; it counts for the changeset of its name, with a note when the code has moved
  since the run (a commit between extract and verify). The record is a plain file under `.dr/`: it
  is evidence of what extraction did, not tamper-proof.
  - An add counts as extracted (`fromExtraction`) when extraction staged its id (the agent's adds
    from cards are recorded there on the next run), or when its file and symbol are a staged
    symbol, a card or an earlier card. Its type must be one the card allows; for a card with no
    candidates (open, or an older record's earlier card that didn't keep them), one extraction can
    produce from that file. One that would match a planned add by id or name must also be named
    after its symbol (the symbol, its last part, the card's name, a module's file, or for a route
    the same method and path whatever its parameters are called), not after the plan's element.
  - An update counts when the record's `updated` lists it; a delete, when it is one of the record's
    candidate deletes.
  - An extracted element changed after extraction staged it is listed in `editedAfterExtraction`
    with the edits: an add whose name or attributes differ from what extraction staged, or from the
    value extraction wrote for a field it later updated on it; an update that changes a field the
    record's `updated` entry doesn't list, or holds a value other than the one extraction wrote
    (`values`, when recorded). It counts toward `fromExtraction`, but not as evidence: like an
    agent-added element, its matches are marked `builtByAgent` (with the edits), it counts toward
    the warning, and a verdict that would be `match` is `probable-match`, with the verdict text
    saying the match rests on elements extraction didn't stage or that were edited after it.
  - Everything else is `agentAdded`, with its declared provenance and the reason. `byProvenance`
    still counts what was declared. Relationships count as `betweenExtracted` when both ends are
    confirmed. Agent-added adds that share an id with the plan's adds are `copiedFromPlan`, with a
    note, and a match against any agent-added element is marked `builtByAgent`.
  - When more than half the as-built elements (adds, updates and deletes) are agent-added, the
    report has a `warning` and the verdict text says the comparison says little about the code. The
    extraction rule still applies then: turning it off would report what extraction can't see as
    missing and push the agent to add even more by hand. Without a record, the rule does not apply
    and nothing is confirmed.
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

| Need                              | Tool                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is left to wire              | `changeset_brief` lists **unwired** connections: for each added or updated element, the triples the catalog defines for its type, in either direction, that the element has no relationship for. They are grouped by the other end's layer, each with `existingCount` (elements of the other type outside this changeset) and `addedCount` (ones this changeset adds), so the planner knows whether to link one or add one. `unwired: "summary"` (the full brief's default; the compact brief only counts them per layer unless `unwired` is set) lists entries only for layers the change reaches and only for types the model has, and counts the rest per layer as `typesNotInModel`; `"full"` lists all; `"none"` leaves it out. `unwiredLayers` lists the entries for chosen layers. |
| What changed since the last pass  | `changeset_brief` returns `revision` and `revisionToken`. Passing the token back as `since` adds a `delta`: elements added, removed and updated (with the fields), relationships added and removed, changes unstaged since, gaps opened and closed, unwired connections wired or new, layers newly reached or no longer reached, intent newly traced or untraced. Sequence numbers are never reused: each stage, unstage and in-place rewrite takes the next one, and an unstaged or rewritten change leaves a tombstone in the changeset's metadata (the last 200), so the earlier plan is rebuilt exactly. The token warns if `changes.yaml` was edited by hand.                                                                                                                        |
| What one element touches          | `changeset_impact` with `from` (element ids) walks from those elements instead of every changed one. `perHop` counts what each hop adds. A hub, an element with more relationships than `hubThreshold` (default 15), is listed in `hubs` with its degree and not walked through, unless `expandHubs` is set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A short view of the plan          | `changeset_show` with `detail: "summary"`: one entry per change (sequence, operation, element or relationship, changed fields) and totals per operation, without the before and after snapshots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Change one attribute              | `model_update` with `attributePatch` (`dr update --attribute-patch`): merged shallowly into the element's attributes, over staged values in a changeset; `null` removes a key. Required attributes need not be repeated. `attributes` still replaces them all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Drop everything staged at one end | `changeset_unstage` with `source` alone or `target` alone, optionally with `predicate`, drops every staged relationship add and delete at that end. Relationship removals cascaded by a staged element delete are kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Drop several at once              | `changeset_unstage` with `changes: [{elementId} \| {source, predicate?, target} \| {source} \| {target}]`: each item means what the single form means, all are removed in one write (one revision), and each gets a result: `unstaged`, `already-unstaged` (an earlier item took its changes), `not-staged`, or `invalid` with the reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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
6. Build from the brief. Keep the changeset staged and commit its files on the branch. Don't
   extract or verify during the build.
7. Verify as its own step, once the build is committed: `codebase_index`, then `codebase_extract`
   with `since` (the branch the work started from) stages the build into an as-built changeset;
   `changeset_verify` the plan against it. The as-built side comes only from extraction: elements
   are named after their cards, and plan elements are never copied into it. Cards the agent can't
   place with confidence go to the developer as one short list of questions. Fix what diverges, in
   the code or in the plan, then `changeset_activate` the plan again. The as-built changeset is
   then discarded or kept as a record, not landed.
8. The human commits the plan in the PR that ships the code: they ask the agent to land it
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

The viewer listens on the loopback addresses only (`127.0.0.1` and `::1`). `dr visualize` takes the
first port from 8080 (or `--port`) that nothing holds on a loopback or wildcard address, so another
project's viewer on `*:8080` moves it to 8081. If another process takes the port between that check
and the bind, `review_open` starts the viewer again from the next port, up to three times; after
that it says which process holds the port.

Comments left in the viewer and the agent's `annotation_*` calls use the same files,
`documentation-robotics/annotations/<id>.yaml`, one per annotation with its replies. The viewer
server watches the folder and broadcasts changes the agent makes (`annotation.added`, and so on), and
annotations survive a restart. The viewer accepts a comment on an element in the model or on one a
staged changeset adds.

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
- `changeset_commit` needs a client that supports MCP elicitation; without it the tool refuses and
  the human commits in the viewer or the CLI. The server can't tell whether a client honoured
  `anthropic/requiresUserInteraction`, so it always asks. An elicitation alone is not a hard gate
  (a Claude Code `Elicitation` hook can answer it), which is why the flag is there too. The dialog
  waits 10 minutes, then the commit is refused.
- The tools have not yet been used on a real change.
