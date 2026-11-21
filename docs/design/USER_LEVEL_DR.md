# User-level DR

Design for issues 1279 (one viewer for every mapped codebase) and 1285 (worktrees as a
first-class structure), CLI 0.8.0.

**The staged changeset `user-level-dr` is the source of truth.** It lives in
`documentation-robotics/changesets/changeset-1795281066041-0kg0ygyyb/`. Read it with
`changeset_brief` or open it in the viewer. This document explains the decisions and the
alternatives that the model can't hold. Element ids below refer to that changeset.

Two kinds of statement appear here, and they are kept apart:

- **Ruling**: the maintainer's settled decisions of 2026-11-21. They are not reopened here.
- **Recommendation**: a design choice made in this document. Each one is open to review and
  is marked _(recommendation)_.

## 1. Maintainer rulings (settled)

| #   | Ruling                                                                                                                                                                                         | Where the plan carries it                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | One cohesive, deterministic list of projects, shared by the MCP server, the viewer and the CLI. No interface has its own discovery or behaviour.                                               | `motivation.principle.one-project-list-for-every-interface`, `motivation.requirement.projects-resolve-through-one-registry` |
| 2   | One deterministic set of project names. Worktrees are never folded into a name; they are a first-class structure in the project data model.                                                    | `motivation.principle.one-name-per-project-across-interfaces`, `motivation.principle.worktrees-are-a-structure-not-a-name`  |
| 3   | One auth token for all projects. Authenticate every call, then trust it. No click proofs, no cookies.                                                                                          | `motivation.principle.authenticate-every-call-then-trust`                                                                   |
| 4   | DrBot is a short-lived coding-agent sub-process. One central back-end process serves the MCP interface and the viewer, and launches every DrBot sub-process in the right project and checkout. | `motivation.requirement.one-central-process-per-user`, `motivation.requirement.dr-bot-runs-in-its-project-and-checkout`     |
| 5   | The unscoped viewer `/api/...` routes go as fast as possible, with no long compatibility window.                                                                                               | `motivation.requirement.every-api-call-names-its-project-and-checkout`                                                      |
| 6   | A cross-project platform view is not in scope now, but the design must not rule it out.                                                                                                        | `motivation.constraint.names-and-routes-stay-usable-across-projects`                                                        |

## 2. The structure: project, repository, checkout (issue 1285, point 1)

```
Project  (name: "documentation-robotics")    registered in the user farm
 └─ Repository                               derived from git, never stored
     ├─ Checkout "main"                      the main worktree
     ├─ Checkout "t11-test-reliability-4a7e32"   a linked worktree
     └─ Checkout "user-level-dr-design"          a linked worktree
```

- **Project** (`data-model.objectschema.farm-project`, dr-farm-v2): the unit a person names. It
  has a `name`, a `repository` (the main checkout's path), a `model` path and a `remote`.
  **One project per git repository** _(recommendation)_.
- **Repository** (`data-model.objectschema.repository`): identified by the real path of the git
  common directory (`git rev-parse --git-common-dir`). Every worktree of a repository reports the
  same common directory, so the repository identity is deterministic from any checkout. It is
  derived and never stored.
- **Checkout** (`data-model.objectschema.checkout`): one working tree. It is identified by a
  **key** that is unique within its project _(recommendation)_:
  - `main` for the main worktree;
  - for a linked worktree, the name git itself gives it under `<commonDir>/worktrees/<name>`.
    Git guarantees that name is unique per repository, and it stays stable for the worktree's
    life.

  A checkout also carries its path, branch (null when detached), head, `isMain`, `state`
  (`present`, `missing` or `prunable`) and `locked`.

- **A checkout is a child of a project.** The project's canonical checkout is `main`. Wherever a
  checkout can be named and is not, the default is `main`, except where a path says otherwise
  (an MCP session in a worktree resolves to that worktree).

**Why not a checkout key from the branch name?** Branches move: a worktree can switch branch, be
detached, or share a branch name with a remote. The worktree's git name is stable for the
worktree's life, and git already guarantees it is unique per repository.

**Why not one project per worktree with a "parent" link?** That repeats today's problem, every
worktree as a project, with a link bolted on. It also breaks ruling 2: a name per worktree is a
name that encodes the worktree.

**Alternative left open:** a repository that hosts two DR models in different folders (a
monorepo). Today `model` is a single path per project. A later `models:` list per project
would fit under the same structure without renaming anything.

## 3. Names, and addressing a checkout (point 2)

The **project name** is the farm entry's name. It is kebab-case and unique across the user farm.
`application.applicationfunction.derive-project-name` decides the name of a newly registered
project:

1. an explicit name (`dr farm add <name>`, or `name` on `project_list`/registration), else
2. the main checkout's folder name in kebab case.

A name another repository already holds is **refused**, and the refusal names the call that
registers it with an explicit name. It is never given a `-2` suffix _(recommendation)_. A
suffix would depend on the order of registration, which breaks "deterministic".

The project name is also the name federated models use in `@name/` references
(`motivation.constraint.names-and-routes-stay-usable-across-projects`). This keeps the
cross-project view of ruling 6 possible: a platform view can join projects by the names they
already use.

A **checkout** is addressed as project plus checkout, the `CheckoutRef`
(`data-model.objectschema.checkout-ref`), everywhere:

| Interface  | How a checkout is named                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP        | `rootPath` still works and resolves through the registry. New optional `project` and `checkout` arguments name it directly _(recommendation)_. Every result carries `project` and `checkout`. |
| Viewer URL | `/p/<project>/c/<checkout>/...`, e.g. `/p/documentation-robotics/c/main/changesets/<id>`                                                                                                      |
| API        | `/api/projects/{project}/checkouts/{checkout}/...`                                                                                                                                            |
| CLI        | `dr visualize [path]` resolves a path. `--project <name> [--checkout <key>]` names one.                                                                                                       |
| Farm       | Checkouts are not written to `farm.yaml`; they are discovered (section 4).                                                                                                                    |
| WebSocket  | `FeedSubscription {action, project, checkout}` frames; every event carries its `CheckoutRef`.                                                                                                 |

## 4. Discovery and lifecycle (point 3)

**Projects** come from the user farm only. A path that no registered project owns (an MCP root,
`dr visualize <path>`) is registered through `application.applicationfunction.register-project`,
which is the same code for every interface. That is how ruling 1 holds even for first use. The
alternative was to refuse until the user runs `dr farm add`. It was rejected because the agent
would then have to stop and ask on every new repository; auto-registration is deterministic
because it writes the registry before serving _(recommendation)_.

**Checkouts** are discovered, not registered:
`application.applicationfunction.discover-checkouts` runs `git worktree list --porcelain` in the
project's repository and caches the result until `<commonDir>/worktrees/` changes (a directory
watch, plus a re-check on each `project_list`). Worktrees made with `git worktree add`, by Claude
Code (`.claude/worktrees/<name>`) or by any other tool show up without registration.

**When a worktree goes away:**

- `git worktree remove`: it drops out of the list, and the
  `application.applicationevent.checkout-removed` event fires.
- Folder deleted without `remove`: git reports it `prunable`. DR shows it as `missing` until
  `git worktree prune` runs. A missing checkout serves no routes (404) and is listed with its
  state.
- On the event, `application.applicationfunction.close-checkout-context` ends its DrBot turns,
  sends its websocket subscribers a `checkout-removed` event, and drops its context from the pool.
  Its `.dr/` state goes with the folder. The central process keeps nothing on disk per checkout,
  so there is nothing to clean up. This replaces the folder-gone exit that per-project viewers
  have today.

## 5. What is shared and what is per checkout (point 4)

| State                                                 | Scope                            | Where                                           | Why                                                                                                                    |
| ----------------------------------------------------- | -------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Model (`documentation-robotics/model/`)               | per checkout, follows the branch | checkout files                                  | It is in the repository, so it travels with the branch. A plan's model only means something against its branch's code. |
| Changesets (`documentation-robotics/changesets/`)     | per checkout, follows the branch | `data-store.collection.changesets`              | Same reason. A plan staged in a worktree lands with that worktree's PR.                                                |
| Active changeset marker (`.dr/active-changeset`)      | per checkout                     | `data-store.collection.active-changeset-marker` | Two sessions in two worktrees each work on their own plan.                                                             |
| Annotations (`documentation-robotics/annotations/`)   | per checkout, follows the branch | `data-store.collection.annotations`             | Review comments belong to the plan they review, which lives on that branch.                                            |
| Analyzer index and Tier 1 (`.dr/analyzers/`)          | per checkout                     | `data-store.collection.analyzer-index`          | The code differs per checkout. Sharing an index by commit is a later optimization (section 10).                        |
| Reconcile and as-built stamps (`manifest.reconciled`) | per checkout, follows the branch | model manifest                                  | They describe that branch's model against that branch's code.                                                          |
| DrBot conversations                                   | per checkout                     | central process memory, `DrBotSessionKey`       | DrBot runs in the checkout's directory and sees its files; a conversation can't span two branches' files.              |
| Project name, repository, model path, remote          | per project                      | user farm                                       | Identity, shared by every checkout.                                                                                    |
| Server record, token                                  | per user                         | `data-store.collection.server-record`           | One central process (ruling 4) and one token (ruling 3).                                                               |

**Recommendation:** nothing is "derived from the branch" by DR itself. Everything per checkout is
either a file in the checkout, which git already scopes to the branch, or memory keyed by
`CheckoutRef`. DR never keeps a second copy keyed by branch name, so a branch switched inside a
worktree needs no migration.

**What the viewer shows across checkouts:** a project view lists every checkout with its branch,
head, active changeset and staged changeset count (`data-model.objectschema.project-list-entry`).
Opening a changeset opens it in its checkout. The viewer never merges changesets from two
checkouts into one list.

## 6. The single project registry (issue 1279, rulings 1 and 2)

`application.applicationcomponent.project-registry` is the only code that answers these
questions:

- What projects exist? (`list-projects`)
- What is this path? (`resolve-checkout`)
- What checkouts does a project have? (`discover-checkouts`)
- What is a new project called? (`derive-project-name`, `register-project`)

The MCP server (`pick-project-root`, `follow-client-roots`, every tool's `rootPath`), the viewer API
(`GET /api/projects...`) and the CLI (`dr farm`, `dr visualize`) all call it.

**Where the registry lives** _(recommendation; open question Q1)_: in the **user farm**, a
`farm.yaml` at `$XDG_CONFIG_HOME/dr/farm.yaml` (`~/.config/dr/farm.yaml`), with `DR_FARM` naming
another. The farm is already "where the list starts" (issue 1279). Keeping one file avoids a
second registry that could disagree with it. Config, not state, because it is the user's list of
projects. Farms elsewhere on disk (CI farms, the portfolio fleet) keep working with `dr farm
--farm <path>`. The central process serves only the user farm.

**Farm v2** (`data-model.objectschema.farm-manifest-data`, version `dr-farm-v2`), point 5:

```yaml
version: dr-farm-v2
name: austin
projects:
  documentation-robotics:
    name: documentation-robotics
    repository: /Users/.../documentation_robotics # main checkout
    model: documentation-robotics/model # relative to each checkout's root
    remote: https://github.com/tinkermonkey/documentation_robotics.git
  barcut:
    name: barcut
    repository: /Users/.../barcut
    model: ../barcut-model # a detached model: an absolute or farm-relative path
```

`branch` is dropped: checkouts come from git. `dr farm add` resolves a worktree path to its main
checkout, so adding a worktree finds or adds its project, never a project per worktree.
`dr farm sync` and `pull` act on the main checkout.

**Migration from dr-farm-v1** (`application.applicationfunction.migrate-farm-manifest`,
`dr farm migrate`, preview by default, `--apply` to write):

1. Group v1 entries by repository (git common directory of `source`).
2. The entry whose `source` is the main checkout names the project. If none is, the main
   checkout's folder name does.
3. Every other entry in the group becomes a checkout (no record needed) and its name is listed as
   **dropped**.
4. A second run changes nothing.

A v1 file is still read, with a notice naming `dr farm migrate`. Old names are not kept as aliases
(ruling 5's spirit: no long compatibility window). The preview lists them so the user can fix
scripts first.

## 7. The central back-end process (issue 1279, ruling 4)

`application.applicationcomponent.visualization-server` becomes the user's central process
(`dr serve`, `application.applicationservice.serve-command`). The component keeps its name in
the plan because it is the same class grown, not a new server. Renaming the class (`DrServer`)
is a build-time choice.

**One process, one port, one token.** It serves:

- `/mcp`: the MCP interface (streamable HTTP, already in `cli/src/mcp/http-transport.ts`);
- `/api/...`: the viewer API (section 8);
- `/ws`: the websocket feed and DrBot chat;
- `/` and `/p/...`: the viewer's pages;
- `/health`, which stays unauthenticated and minimal.

**Getting MCP clients onto it** _(recommendation)_: `dr mcp` over stdio, which the Claude Code
plugin and Copilot run, becomes `application.applicationcomponent.mcp-stdio-bridge`. It finds the
central process from `server.json` (`ensure-central-server`), starts it detached when absent, and
forwards MCP messages to `/mcp` with the token. It passes the client's roots so tools resolve the
session's checkout. The plugin configuration doesn't change, and no token is written into a
client's config.

The alternative was to point clients at `http://127.0.0.1:<port>/mcp` directly. That needs the
token and port in every client's config and breaks whenever the port changes. `dr mcp --http`
keeps serving that transport for clients that want it.

**Per-checkout state.** `application.applicationcomponent.checkout-context` holds one checkout's
`Model`, `StagingAreaManager`, `AnnotationStore`, `StagedChangesetStorage`, file watcher,
websocket subscribers and DrBot conversations. It replaces every `this.model.rootPath` in
`server.ts` (there are about 30). Contexts are never shared between checkouts. That is the whole
isolation guarantee (`motivation.requirement.per-checkout-state-never-leaks`). The plan's
coverage target `per-checkout-isolation` tests it across two checkouts and a second project.

**Lazy loading and eviction.** `application.applicationcomponent.checkout-context-pool` loads a
context on first use (`acquire-checkout-context`) and evicts it (`evict-checkout-contexts`) when:

- it has been idle for `idleMinutes` (default 30), or
- the pool has more than `maxLoaded` contexts (default 4), least recently used first.

It never evicts a context that has a websocket subscriber or a running DrBot turn. Eviction drops
memory only: everything durable is already in the checkout's files. The defaults are guesses
(open question Q4). The repository's own model (2,491 elements) is the size to measure against.

**WebSocket.** There is one socket per browser tab, and it subscribes per checkout
(`application.message.subscribe-to-checkout-feed`, `FeedSubscription`).
`publish-checkout-event` sends only to that checkout's subscribers, and every event is stamped
with its `CheckoutRef`. The alternative, a socket per checkout at `/ws/projects/:p/checkouts/:c`,
was rejected: a tab that shows a project's checkouts side by side would need several sockets.

**Lifecycle and the registry.**

- `server.json` (`data-model.objectschema.server-record`) replaces the per-project
  `viewers/<hash>.<pid>.json` records. It holds pid, port, cliVersion, startedAt and the launcher
  pid. The token sits in `server.token` (0600) beside it.
- The port defaults to 8080, or the next free port, and is recorded. It is not fixed, so a
  stray process on 8080 can't block DR.
- **Idle exit** keeps #1237's rule: 24 hours (`DR_VIEWER_IDLE_HOURS`) with no websocket client,
  no MCP session and no request other than `/health`. A bridge connection is an MCP session, so
  the process stays up while any agent session is open.
- `--exit-with-parent` no longer applies to the central process (it outlives its starter). It
  remains for test-spawned servers.
- **Version check:** the bridge (or `dr visualize`) replaces an older central process only when
  no tab, MCP session or DrBot turn is connected. Otherwise it uses the older one and passes on a
  notice. This is the same rule #1237 set for `review_open`, applied to the one process.

**Moving users off per-project viewers.** At start-up `sweep-per-project-viewers` reads the legacy
records and does a process scan. It stops old viewers that `review_open` started and that have no
connected tab (the rule #1237 already uses). It reports the rest, with pids, under
`dr visualize --list`, and `dr visualize --stop --all` stops them. Old records are swept once
their processes are gone. `--list` and `--stop` otherwise show and stop the one central process.

**`dr visualize [path]`** ensures the central process runs and opens the browser at
`/p/<project>/c/<checkout>/` for the checkout the path (default: cwd) resolves to. `--port` sets
the port only when it starts the process. `--no-browser` prints the link instead.

## 8. Project- and checkout-scoped API routes (ruling 5)

The plan deletes the 16 unscoped project-data operations and adds 19 scoped ones:

| Old (deleted)                                                                         | New                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| —                                                                                     | `GET /api/projects`, `GET /api/projects/{project}`, `GET /api/projects/{project}/checkouts` |
| `GET /api/model`                                                                      | `GET /api/projects/{project}/checkouts/{checkout}/model`                                    |
| `GET /api/layers/{layerName}`                                                         | `.../layers/{layerName}`                                                                    |
| `GET /api/tier1`                                                                      | `.../tier1`                                                                                 |
| `GET /api/changesets[/{id}]`, `POST .../commit`, `POST .../discard`, `PUT .../review` | `.../changesets[/{changesetId}]`, `.../commit`, `.../discard`, `.../review`                 |
| 8 annotation routes                                                                   | `.../annotations[...]` (same 8)                                                             |

These stay unscoped because they are not project data: `/health`, `/api/spec` (the CLI's own
bundled spec), `/api-docs`, `/api-spec.yaml`, `/mcp`, `/ws` (scoped by its subscriptions), and the
viewer asset paths.

**Retiring the unscoped routes** _(recommendation)_: the CLI bundles the viewer. So the unscoped
routes are removed **in the same CLI release whose bundled viewer uses the scoped routes**, with
no overlap release. A custom viewer build (`--viewer-path`) that still calls them gets
`410 Gone` with the scoped replacement path in the body for that one release, and a 404 after it.
The viewer companion issue has to land before that CLI release is cut. That is the only ordering
constraint.

Every route requires the token (ruling 3). An unknown project or checkout returns 404, and so does
a `missing` checkout. The OpenAPI document (`/api-spec.yaml`, `docs/api-spec.yaml`) is regenerated
from the scoped routes as part of the build.

## 9. MCP viewer links and DrBot orchestration

**Deep links without starting a process** (`motivation.requirement.links-into-the-shared-viewer-start-no-process`).
`application.applicationfunction.viewer-url` builds a `ViewerLink` from the server record and a
`CheckoutRef`, plus optionally a changeset or element:

```
http://127.0.0.1:8080/p/documentation-robotics/c/t11-test-reliability-4a7e32/changesets/<id>?token=…
```

- **`review_open`** resolves the session's checkout and returns that link. Because MCP now runs in
  the central process (through the bridge), the process that answers is the one the link points
  at. Nothing is spawned, so `spawnDetachedViewer`, `portInUse`, `StartedViewer` and `PendingStart`
  are deleted in the plan. `restart: true` keeps its meaning for the central process, with the same
  "ask first, it ends DrBot chats" rule.
- **`project_status`** names the project and checkout, lists the project's other checkouts (paged,
  per the no-silent-limits rule) and gives this checkout's link.
- **`project_list`** (new) returns every project with its checkouts.
- **Other tools** that mention the viewer (`changeset_commit`'s refusal, which says to land it in
  the viewer) carry the same link.

**DrBot.** `application.applicationcomponent.dr-bot-launcher` launches each turn
(`launch-dr-bot-turn`):

- **cwd** is the checkout's path;
- **`DR_MCP_ROOT_PATH`** is the checkout's path, so the sub-process's own dr MCP (a bridge to the
  same central process) resolves to the same `CheckoutRef`;
- **the agent** comes from `prepareDrBotAgent` for that checkout;
- **conversations** are keyed by `DrBotSessionKey {project, checkout, conversationId}`, so a
  conversation id reused in another checkout starts a new session;
- **concurrency** is capped per user (default 3 running turns _(recommendation)_). A turn over the
  cap waits, and the chat tells the user it is queued;
- **checkout removal** ends that checkout's turns.

The launched programs (Claude Code CLI, GitHub Copilot CLI) are modelled as
`technology.systemsoftware` that serves the launcher. The maintainer withdrew the earlier ruling
that kept launched programs out of the model.

## 10. Things this design leaves room for, and doesn't do

- **Cross-project platform view (ruling 6):** `GET /api/projects` and project-qualified ids are
  enough for a later view to load several checkouts' models and join them on `@name/`
  references. Nothing here prevents it, and nothing builds it.
- **Shared analyzer index across checkouts:** an index keyed by commit could be reused by a
  worktree at the same commit. It is left out because per-checkout indexes are simple and correct.
- **Persisted DrBot sessions:** conversation-to-session ids are in memory, so a restart of the
  central process starts new sessions. Persisting them in the user state directory is a small
  addition if wanted.
- **Remote or multi-user DR:** out of scope. Everything binds to `127.0.0.1`.

## 11. Open questions for the maintainer

- **Q1.** Is the user farm at `~/.config/dr/farm.yaml` the registry, or should an existing farm
  root be designated (`DR_FARM` only, no default)?
- **Q2.** Should an MCP call or `dr visualize` on an unregistered path auto-register it (this
  design), or refuse and ask for `dr farm add`?
- **Q3.** Checkout key from git's worktree name (this design), or from the folder name? They
  differ when a worktree folder is renamed after `git worktree add`.
- **Q4.** Pool defaults (`maxLoaded` 4, idle 30 minutes) and the DrBot cap (3 turns per user).
- **Q5.** Should old v1 farm names be dropped at migration (this design) or kept as aliases for
  one release?
- **Q6.** Should the token stay in the deep link's query string, as today, or move to the URL
  fragment, so it stays out of server logs and `Referer` headers? This is not a trust-model
  change (ruling 3). It is about where the one token travels.

## 12. Spec gaps found while modelling (Context Studio proposals, not edits)

- `technology.systemsoftware.softwareType` has no value for a language runtime (Node.js), a
  version-control tool (git) or a developer CLI or coding agent (Claude Code, Copilot). The plan
  uses `middleware` for all four.
- `technology.device` can't compose or host `systemsoftware`: the catalog offers no
  `device --composes--> systemsoftware`. The plan uses `systemsoftware --depends-on--> device`
  instead. There is also no `technology.node` `nodeType` for a developer workstation.
- `data-model.objectschema --references--> data-model.objectschema` is not in the catalog. The
  spec routes it through `schemaproperty`, so a schema that names another one (`Checkout` names a
  `Repository`) can't be linked at this grain.
- `data-store.database.engine` takes free text, and the plan uses
  `filesystem (YAML and JSON files)`. The data-store layer has no notion of a file store, though
  CLIs and agents commonly keep state that way.
- `apm.span` requires runtime values as model attributes (`traceId`, `spanId`, `parentSpanId`,
  the start and end times, dropped counts), and types the times and two of the counts as strings.
  A span in an architecture model is a span _name_ and its attributes, not one recorded span. The
  plan puts `runtime` and `"0"` placeholders in those fields.

## 13. Gaps in DR's own model that this changeset fills

Before this changeset, DR's own model had no technology, data-store, APM or testing layer. That
is missing data, not intent. So the changeset stages, from the code as it is today, what the
design touches in those layers, beside the planned elements:

- **Technology:**
  - the workstation, its operating system, and the Node.js and Bun runtimes the CLI and
    `server-entry.ts` run on;
  - git, and the Claude Code and Copilot CLIs that DrBot launches;
  - the `@documentation-robotics/cli` package, the `server-entry.js` artifact and the downloaded
    `dr-viewer` bundle (`cli/scripts/download-viewer.sh`);
  - the OTLP collector the telemetry build exports to.
- **APM** (`cli/src/telemetry/`, `cli/src/server/telemetry-middleware.ts`, the WebSocket spans in
  `server.ts`):
  - the `dr-cli` resource, tracer scope, trace configuration and OTLP exporter;
  - the existing `http.server.request` and `ws.message.processed` spans;
  - two planned spans, `drbot.turn` and `checkout_context.evict`. Spans gain `dr.project` and
    `dr.checkout` (`motivation.requirement.telemetry-names-its-project-and-checkout`).
- **Data store:**
  - the per-checkout state DR keeps today: the active changeset marker, analyzer index,
    changesets and annotations;
  - the user state it keeps today: the legacy viewer records, the starting marker and
    `.farm-sync.yaml`;
  - the object schemas that map to each.
- **Testing:** the existing test files that cover what the design changes. These are
  `review-open-viewer`, `project-status-tool`, `project-root`, `farm`,
  `visualization-server-api`, `drbot-mcp-launch`, `visualize-viewer-lifetime` and
  `viewer-control`. Each is an automated test case sketch with its source file, under the
  coverage target the design moves it to.
- **Product:** the "Move to user-level DR" workflow (preview the farm migration, apply it, stop
  the old viewers). It replaces an earlier accepted gap that said the migration had no workflow.

The three accepted gaps that remain are connections that don't apply. The registry, the pool and
the DrBot launcher work only with declared shapes (object schemas), not domain data objects.
