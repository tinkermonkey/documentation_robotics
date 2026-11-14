# Vision and roadmap

_The project's reference for where it is going (November 2026), moved here from the README so the
README can stay a getting-started summary. The [overview site](https://tinkermonkey.github.io/documentation_robotics/)
explains the concepts to new users; this page keeps the reasoning, status and sequencing for
contributors. [`EXTRACTION_STRATEGY.md`](EXTRACTION_STRATEGY.md) covers the extraction track in
detail; [`CHANGE_MODELING.md`](CHANGE_MODELING.md) covers the change-modeling track and its tools._

## The idea

A software spec should describe the whole stack, not one slice of it: why the system exists
(motivation, business, product), what it does (application, API, data model, UX, navigation), how it
runs (technology, data store, APM) and how we know it works and is safe (testing, security). DR is
that spec: thirteen layers joined into one graph by typed relationships, where every relationship
says what one thing does for another (`realizes`, `serves`, `accesses`, ...).

The graph is useful in two directions:

- **Model extraction** reads a codebase and records what the system **is**.
- **Change modeling** records what the system **will become**, before the code exists, and uses the
  graph to test that plan against everything it touches.

Both directions produce the same thing: a **changeset** against the model. That is the single most
important design fact in the project. Extraction and change modeling are not two products; they are
two ways of writing changesets, and they check each other.

## Two workflows, one currency

```text
Model extraction:  code ──▶ changeset ──▶ review ──▶ commit           "the model says what is"
Change modeling:   intent ──▶ changeset ──▶ pressure-test ──▶ build ──▶ verify ──▶ commit
                                                                       "the changeset says what will be"
```

They meet at **verification**. When a planned change is built, running extraction over the branch
should produce what the planned changeset predicted. The difference between the two is the review:
what was built but not planned, what was planned but not built, and what was built differently.
Neither workflow is complete without the other. Extraction without change modeling only documents
the past. Change modeling without extraction is a plan nobody checks.

### The base model is as-built

The committed model describes the system as it is. A change-modeling changeset stays **staged**
while its code is written, and is committed when the code lands, in the same pull request. So:

- A changeset is to the model what a branch is to the code. One changeset per change, carried on the
  branch (changesets are files under `documentation-robotics/changesets/`), merged with it.
- `main`'s model never claims something that isn't built, so extraction can always verify it, and
  drift means drift rather than "not built yet".
- Several changes can be in flight at once, each as its own staged changeset. Drift detection on the
  base snapshot already tells a changeset when the base moved under it.

The alternative, committing at plan approval and marking elements "planned", was considered and
set aside: the model would be wrong until the code caught up, and extraction could not tell a
planned element from a stale one.

## Change modeling: DR as the spec in spec-driven development

Today a change in Claude Code is planned as prose: a plan-mode document that lists what the session
thought of, read once, and then lost. With DR the plan is a changeset, and the graph does the work a
reviewer would otherwise do from memory.

| Stage             | What happens                                                                                                                                                                                                                                  | Who                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Frame**         | Name the change and its intent; open a changeset. Find the goal, requirement or feature it serves, or add one.                                                                                                                                | Claude, with the human's request   |
| **Draft**         | Stage the elements and relationships the change adds, alters or removes, layer by layer.                                                                                                                                                      | Claude, through MCP                |
| **Pressure-test** | Project the changeset across the graph: what existing elements it touches, which layers it reaches and which it should, what the catalog allows and peers have that the draft is missing, what no longer validates, what traces to no intent. | DR tools; Claude revises the draft |
| **Review**        | The human sees the changeset on the graph in the viewer, comments on elements (annotations), or talks it through with DrBot. Claude reads the comments and revises.                                                                           | Human, viewer, DrBot               |
| **Build**         | Claude implements from the changeset's brief: the changes by layer, their connections, and the source files of the existing elements they touch.                                                                                              | Claude                             |
| **Verify**        | An as-built changeset (staged by `codebase_extract` from the branch's changes) is compared with the plan (`changeset_verify`). Differences are fixed in the code or in the changeset.                                                         | Claude and DR tools                |
| **Land**          | The human commits the changeset in the pull request that ships the code, by confirming the agent's commit or in the viewer.                                                                                                                   | Human                              |

### What pressure-testing means

This is the part a prose plan cannot do, and the reason to model a change at all.

- **Impact.** Walk outward from every changed element through the projected graph (base plus staged
  relationships). Every existing element reached is something the change can break or must update;
  its source reference says where in the code it lives.
- **Reach.** Which layers the change touches. A new API operation with nothing in data model, data
  store, testing or APM is either a small change or an incomplete plan; the human should see which.
- **Connections.** Within reason, every connection the spec models for a type is expected, though
  not every one will exist. For each changed element, the planner checks the connections the
  catalog allows (`spec_type`) against what the plan has, and stages the ones the change needs or
  says why not. The brief helps: it flags added elements with no connections, relationships the
  spec marks `required`, and connections most similar elements in the model have and the new one
  lacks (every other layout function has an API operation and a test sketch).
- **Consistency.** The projected model validates: schemas, references, catalog triples.
- **Intent.** Every change traces up to a goal, requirement, outcome or feature. A change that traces
  to nothing is a question for the human, not an error.

### The human in the loop

- **The viewer** shows a changeset as an overlay on the model graph, and is where the human commits
  or discards it (`POST /api/changesets/:id/commit|discard` already exist).
- **Annotations** are review comments on elements. Claude reads and answers them through the same
  tools the viewer uses.
- **DrBot** is Claude Code launched by the viewer. It loads the same `dr mcp` server as the
  terminal session, so a conversation in the viewer and a session in the terminal see the same
  changeset with the same tools. With `--with-changesets`, the server refuses any write that is not
  staged in a changeset.
- **Commit stays with the human.** The MCP surface stages, projects and explains. It commits only when
  a person confirms: `changeset_commit` asks them in a dialog (MCP elicitation) showing the
  changeset's name, intent, counts and drift, and refuses when they decline, when the client can't
  ask, and in DrBot. It never applies. An agent can discard a changeset only by naming it and passing
  `confirm: true`.

## Model extraction

Extraction is being rebuilt as a cascade (see [`docs/EXTRACTION_STRATEGY.md`](EXTRACTION_STRATEGY.md)
and [`docs/analyzers/CASCADE_DESIGN.md`](analyzers/CASCADE_DESIGN.md)): codebase-memory-mcp's
AST graph, deterministic Tier-0 rules, a decision model (Clef) with calibrated probabilities for
closed-vocabulary choices, and Claude only for the ambiguous cases and the layers the AST cannot
see. Its output is a changeset, never a direct write. The spec is being revised layer by layer to
suit it: modelling rules stated in each layer, relationships described and pruned, migrations for
every break.

For change modeling, extraction matters in three places: it bootstraps a model for a project that has
none, it keeps the base model as-built, and it is the verify step.

## The 13 layers

| #   | Layer                                                   | Focus         | Standard      |
| --- | ------------------------------------------------------- | ------------- | ------------- |
| 01  | [Motivation](../spec/layers/01-motivation.layer.json)   | WHY           | ArchiMate 3.2 |
| 02  | [Business](../spec/layers/02-business.layer.json)       | WHAT          | ArchiMate 3.2 |
| 03  | [Product](../spec/layers/03-product.layer.json)         | WHAT DELIVERS | _Custom_      |
| 04  | [Security](../spec/layers/04-security.layer.json)       | WHO CAN       | _Custom_      |
| 05  | [Application](../spec/layers/05-application.layer.json) | HOW           | ArchiMate 3.2 |
| 06  | [Technology](../spec/layers/06-technology.layer.json)   | WITH WHAT     | ArchiMate 3.2 |
| 07  | [API](../spec/layers/07-api.layer.json)                 | INTERFACE     | OpenAPI 3.0   |
| 08  | [Data Model](../spec/layers/08-data-model.layer.json)   | STRUCTURE     | JSON Schema   |
| 09  | [Data Store](../spec/layers/09-data-store.layer.json)   | STORAGE       | SQL DDL       |
| 10  | [UX](../spec/layers/10-ux.layer.json)                   | PRESENTATION  | _Custom_      |
| 11  | [Navigation](../spec/layers/11-navigation.layer.json)   | FLOW          | _Custom_      |
| 12  | [APM/Observability](../spec/layers/12-apm.layer.json)   | OBSERVE       | OpenTelemetry |
| 13  | [Testing](../spec/layers/13-testing.layer.json)         | VERIFY        | _Custom_      |

Relationship direction follows the predicate, not the layer order; the
[design charter](../spec/DESIGN_CHARTER.md) says what the spec, its nodes and its relationships are for,
and how a change to them is judged.

## Where the pieces live

| Concern                                                       | Home                                 |
| ------------------------------------------------------------- | ------------------------------------ |
| Spec definition (layers, node and relationship schemas)       | This repo, `spec/`. Source of truth. |
| Ontology refinement (triage, reflection, walks, review queue) | Moving to Context Studio             |
| CLI, model operations, changesets, migrations                 | This repo, `cli/`                    |
| Extraction cascade                                            | This repo, `cli/src/analyzers/`      |
| Change-modeling tools (MCP)                                   | This repo, `cli/src/mcp/`            |
| Viewer UI                                                     | `documentation_robotics_viewer`      |
| Viewer server and DrBot                                       | This repo (`dr visualize`)           |

As the refinement tooling (`cli/scripts/spec-enrich/` and friends) moves to Context Studio, this repo
keeps the spec and grows the two workflows.

## Where things stand (2026-11-06)

- **Changesets** work end to end: create, activate, stage adds, updates, deletes and relationships,
  preview, diff, drift check, commit, revert, export and import. The viewer can commit and discard;
  DrBot can stage in `--with-changesets` mode.
- **They have only been used for extraction.** Of the 41 changesets in the three projects with models
  (context-studio 27, heimdall 9, the viewer 5), every one records extraction or repair of what was
  already built. None was written ahead of the code. Change modeling has mechanics and no practice.
- **The MCP server** (`dr mcp`, stdio and HTTP) can plan a change from start to finish: open,
  rename and abandon a changeset; stage, revise and unstage elements and relationships in it; read
  and trace the model as the changeset leaves it; look up what the spec allows; project
  the changeset across the graph with `changeset_impact` and `changeset_brief`; and compare the plan
  with what was built with `changeset_verify`. It lands a plan with `changeset_commit` once the
  human confirms it in a dialog. Each planning pass is
  cheap: the brief lists unwired connections and, given the last pass's `revisionToken`, what
  changed since; impact can start from chosen elements.
- **Claude Code** has `/dr-plan` and the `dr_change_planning` skill, which make "plan this change"
  mean "draft and pressure-test a changeset". DrBot in the viewer uses the same MCP server.
- **None of it has been used for a real change yet.** Two test runs on a copy of heimdall shaped
  it (an 8-layer plan, then a nine-pass iteration). A real change is next.
- **Extraction** is mid-rebuild: Tier 0 is in and stages into a changeset through the
  `codebase_extract` MCP tool, which also gives verify its as-built side. Tier 1 (Clef) is opt-in
  per checkout and runs in suggest mode: its answers are hints on the cards Tier 0 can't decide,
  which still go to the calling agent, and the agent stages the accept band in one call.

## The MVP

Use DR as the spec for real changes in the projects being built alongside it: context-studio, the DR
viewer, heimdall and its graph layouts, the house system, stagecraft and toland-cad. Three of these
have models; the other three need one bootstrapped first (by extraction, or by modelling the change
from an almost empty model and letting the model grow with the code).

It is working when:

1. Changes in those projects are planned as changesets through MCP instead of prose plans.
2. Pressure-testing finds things the prose plan would have missed, and we can name them.
3. The changeset is committed in the pull request that ships the code.
4. Once extraction can verify, the verified difference between plan and build is small and explained.

Record each change's outcome (what pressure-testing caught, how far the build diverged) so the tools
are judged on use, not on design.

## Sequencing

1. **Change-modeling tools, first slice** (landed): changeset lifecycle, relationship staging, spec
   type lookup, changeset impact over the projected graph, and the changeset brief. Enough to plan a
   real change from Claude Code.
2. **Changeset CRUD over MCP** (landed): rename, unstage and discard a changeset; model reads and
   traces that see the changeset; the CLI and MCP stage relationships the same way.
3. **DrBot on MCP** (landed): the viewer's agent runs on the `dr mcp` server, and changeset-only
   mode is enforced there. The viewer's changeset overlay is in the viewer repo.
4. **Verify** (landed, by hand): `changeset_verify` compares a plan with an as-built changeset or
   the base. Once the extraction cascade writes changesets, it supplies the as-built side.
5. **Planning integration** (landed): `/dr-plan` and the `dr_change_planning` skill, which hand the
   brief to the build.
6. **Plan iteration** (landed): unwired connections and `since` deltas in `changeset_brief`, focused
   impact with hub collapsing, `changeset_show` summaries, attribute patches, and unstaging by one
   relationship end.
7. **Use it** on the next change in one of the MVP projects, and fix what hurts.

## Open questions

- **Where a changeset lives during a change:** in the feature branch's `documentation-robotics/`
  (proposed above), or outside the repo until it lands?
- **Granularity:** how much of a change to model. The design charter's granularity rule applies to
  extraction; change modeling may want coarser elements early and finer ones as the build firms up.
- **Bootstrapping** the three MVP projects without models: extract first, or model only what each
  change touches?
