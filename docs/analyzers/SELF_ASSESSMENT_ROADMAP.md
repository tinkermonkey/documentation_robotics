# Assessment pass: roadmap

What has been tried, what was learned, and what to try next. Status: draft, 2026-11-21.

This page links the design ([SELF_ASSESSMENT_DESIGN.md](SELF_ASSESSMENT_DESIGN.md)) to the results
([SELF_ASSESSMENT_RESULTS.md](SELF_ASSESSMENT_RESULTS.md)). Update it whenever a track starts,
finishes or is dropped.

## Where things stand

The question is the maintainer's manual review: "there are no connections between the data model
layer and the data store layer, is that expected?". The goal is to turn that review into a
repeatable stage that runs after extraction.

### Tried (2026-11-20, no model spend)

| What                                         | Result                                                                                                                       | Verdict                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Gap ledger (layer pairs, relationship types) | Flags 100% of emptied layer pairs. Flags the type behind them 67% to 80% of the time                                         | **Keep.** It asks the right question every time             |
| Review checks (14 deterministic)             | The largest single contributor between layers (shape level), but they never name the other end. 63 to 557 findings per model | **Keep as witnesses** for the question bank, not as answers |
| Name join                                    | 13% exact on Context Studio types that no code edge can produce. 95% of the findings a hole causes point at it               | **Keep.** Cheap and precise where it fires                  |
| Edge probe                                   | 13% to 21% exact within a layer on extraction-built models. 0% on Context Studio                                             | **Keep for extraction-built models**                        |
| Path probe                                   | Mostly shape-level. 42% shape within a layer on stagecraft                                                                   | Keep for now. Expected to be absorbed by question Q2        |
| Peer pattern, fleet prior                    | See only small holes. Silent once a type is emptied or the model is thinned                                                  | Keep: free and precise, with narrow coverage                |
| Frontier probe, residual (missing elements)  | The removed element's code is in the top 100 in only 14 of 129 trials                                                        | **Drop.** Ranking the whole codebase is the wrong approach  |
| Same-symbol join, dependants ranking         | Almost nothing                                                                                                               | **Drop**                                                    |

What this shows:

1. The free finders tell you where a gap is but rarely what fills it. Between layers they reach
   shape level (one end plus the kind of link) for 25% to 34% of the removed relationships, and
   name the relationship itself for 0% to 16%.
2. The code index has a ceiling. A mapped edge can produce 183 of the 393 cross-layer types. No
   edge ever produces `maps-to`, `satisfies`, `monitors` or `requires`. These are inference by
   construction, which is what DR adds on top of the code graph.
3. Seeded gaps measure agreement with whatever the model already holds. On Context Studio the
   edge lookup reproduces 0 of 554 relationships that are edge-shaped in principle, because agents
   placed the elements on different symbols. A hole cut in an immature or agent-shaped model is a
   weak test.

### Not run from the original plan

| #   | Experiment                          | Now                                                                                                                   |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Cost of the manual prompt (control) | **Folded into track C.** Step B of each model review is the manual prompt, so log its tokens there                    |
| 2   | Maintainer labels 64 empty pairs    | **Superseded by track C.** The questions settle most pairs, with evidence, and labelling the rest by hand adds little |
| 4   | S1 layer-pair triage call           | Kept as a cheap pre-pass. Low priority                                                                                |
| 5   | S2 evidence probe                   | **Folded into the question bank (track B).** A question with code access is the evidence probe                        |
| 6   | S3 bank of about 30 questions       | **Becomes track B,** run by the coding agent instead of a single call                                                 |
| 7   | Every strategy on fresh bootstraps  | **Becomes track D** (from-scratch builds)                                                                             |
| 8   | The best weaves end to end          | After track D                                                                                                         |
| 9   | S7 documentation sketch             | **Folded into questions Q1 and Q12**                                                                                  |

## Tracks

Five tracks. Their order and dependencies come after the descriptions.

### A. Widen what the code index contributes

The idea was to add richness by mapping more CBM elements onto DR types.

**The CBM vocabulary is already mapped.** All 48 CBM edge types are in `edge-mapping.json`, with 17
creating relationships, and 15 of 31 node labels are mapped
([CBM_MAPPING_INVENTORY.md](CBM_MAPPING_INVENTORY.md)). The ones left unmapped were left out on
purpose. A second inventory pass would mostly find what the first one found.

The results point at two other limits:

- **Code edges with no relationship type to become.** In the viewer, 2,544 combinations of a code
  edge and the two element types at its ends match no catalog triple. Context Studio has 1,854.
  The largest groups are a few kinds:
  - in the viewer: a sub-view calling a component (117), a service calling an interface (104), and
    a component using a sub-view (96);
  - in Context Studio: one data config using another (114), and a view calling a data config (63).

  Each group is one of three things: a missing catalog triple (goes to Context Studio as a
  proposal), a missing preference in the edge mapping (a DR change), or elements given the wrong
  type (a model fix).

- **Elements the index cannot see.** In the viewer, 149 of 1,062 elements with a source reference
  are tied to index nodes. Context Studio has 921 of 1,082. Most of the viewer's untied elements
  are `it()` test callbacks or share a file with many other elements. An element with no tie is
  invisible to every code finder.

**Approach.** Rank the unmatched groups by edge count. Classify the top 20 with the maintainer,
since together they likely cover most of the edges. Route each group to its fix. Then re-run the
edge probe and extraction.

**Measures:**

- the share of edges between modelled elements that become relationships;
- the edge probe's exact recall on seeded gaps;
- the tie rate.

Free apart from the maintainer's time. Catalog changes go through Context Studio, never as direct
spec edits.

**Expectation.** A real but bounded gain, mainly within a layer. It cannot touch the types with no
edge route. Do it because it is cheap and it improves extraction itself, not only assessment.

### B. Architecture review questions, run by the coding agent

**Status (2026-11-21):** bank 0.1 curated with the maintainer. See
[REVIEW_QUESTION_BANK.md](REVIEW_QUESTION_BANK.md) for the bank and its decisions,
`cli/scripts/assess-eval/questions.json` for the data, and `RUNBOOK.md` beside it for the protocol.
Next: the heimdall pilot.

The finders show where the gaps are. Filling them takes inference, and the coding agent is the
tool for that: it has the model (dr MCP), the code graph (CBM MCP) and the source. The proposal is
a bank of 12 to 15 standard questions that an architect asks in a review, each run the same way by
any MCP-capable agent (Claude Code, Copilot).

**Grounding in practice.** Architecture reviews are driven by concerns, not checklists of types:

- ISO/IEC/IEEE 42010 frames a description as viewpoints answering stakeholder concerns;
- arc42 and C4 give the standard views (context, containers and building blocks, runtime,
  deployment, cross-cutting concepts);
- ATAM runs reviews through concrete scenarios.

The bank follows those views. Each question is a concern that a complete model must be able to
answer, not a check on one relationship type.

**What makes a question repeatable.** Each question is data, not prose in a prompt:

| Part         | What it is                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concern      | The question as an architect asks it                                                                                                                             |
| Applies when | A precondition read from the ledger (layers present, types used), so the agent never asks it where it cannot apply                                               |
| Witnesses    | Deterministic queries over the model that show what the answer is missing before the agent reads any code. The 14 review checks and the ledger rows become these |
| Evidence     | Where the agent looks: named CBM queries, file patterns, docs                                                                                                    |
| Answer       | Elements and relationships staged into a changeset with source references, or a verdict per witness (expected-absent, blind-spot, spec-gap) with a reason        |
| Done when    | The witnesses come back empty or explained                                                                                                                       |

Results land in a changeset, so they can be compared across agents and runs. Changesets can be
diffed, judged and kept as gold. A harness run uses a runbook and the bank as JSON. A `dr` tool
that serves the bank is for later, once the bank is proven (see
[eval harnesses stay beside the product](#how-this-stays-organised)).

**Draft bank (to curate):**

| #   | Concern                                                                                                                                                                             | View               | Layers                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| Q1  | Who uses the system and what for, and which external systems and data sources does it depend on? (Uses the README and docs: the S7 sketch)                                          | Context            | motivation, business, product, technology                |
| Q2  | Show how the model represents the full stack, from each client entry point through the API, application logic and data model to the stores and sources, including schemas and types | Runtime (scenario) | ux, navigation, api, application, data-model, data-store |
| Q3  | Where does each piece of persisted data live? What is its schema, and what reads and writes it?                                                                                     | Data               | data-model, data-store, application                      |
| Q4  | What does each interface expose, what realizes each operation, and who calls it?                                                                                                    | Building blocks    | api, application, ux                                     |
| Q5  | Where and how does it run: processes, containers, configuration, infrastructure?                                                                                                    | Deployment         | technology, application                                  |
| Q6  | Which outbound integrations does it have (HTTP, SDKs, queues, files), and are their counterparts modelled?                                                                          | Context            | technology, application, api                             |
| Q7  | What flows asynchronously? Who produces and who consumes each event or message?                                                                                                     | Runtime            | application, data-model                                  |
| Q8  | How is a caller authenticated and authorised? Where are the trust boundaries, and which data is sensitive?                                                                          | Cross-cutting      | security, api, data-model                                |
| Q9  | Why does each service or capability exist? Trace it to a feature, a capability and a goal                                                                                           | Intent             | application, product, business, motivation               |
| Q10 | What screens and routes are there, and which user flows do they make up?                                                                                                            | Building blocks    | ux, navigation, product                                  |
| Q11 | What is observed in production: logs, metrics, traces? Against which objectives?                                                                                                    | Cross-cutting      | apm, motivation                                          |
| Q12 | Which decisions, principles and constraints shape the design? (ADRs, docs)                                                                                                          | Decisions          | motivation                                               |
| Q13 | What is tested, at which level, and what is not?                                                                                                                                    | Quality            | testing                                                  |
| Q14 | What significant code does the model not cover? (Re-run extraction and read the cards it would add. This replaces the residual finder)                                              | Coverage           | all                                                      |

**Measures, per question:**

- fire rate: how often its precondition holds and its witnesses are non-empty;
- items proposed and the maintainer's accept rate (precision);
- tokens and wall time;
- unique contribution: accepted items no other question found.

The last one gives a set-cover curve. It tells you whether 6 questions do the work of 14.

### C. Harden the fleet's models, with the questions as the test bed

The models used so far are immature. heimdall has 9 layers and stagecraft 4, and stagecraft is 92%
test cases. Every measurement made against them inherits that. Building them up is needed anyway,
and it is the best available test of track B on partial models.

**The risk is circularity.** If the questions build the models, those models become in-sample for
the questions, and every later measurement against them flatters the questions. The protocol keeps
attribution clean.

**Protocol per repository:**

1. **Freeze.** Tag the model's commit (`assess/before-<date>`) and the bank's version. Run the
   ledger.
2. **Step A, questions only.** The agent runs the bank. Everything goes into a changeset named
   `review-questions`, and each item is tagged with its question id.
3. **Step B, open review.** A fresh agent session reviews the model with A's changeset active,
   without the bank. It acts as an architect asked to make the model complete, which is the manual
   prompt. Its additions go into a second changeset, `review-open`. These are what the questions
   missed. Log B's tokens: they are experiment 1's control.
4. **Step C, maintainer review.** The maintainer accepts, edits or rejects the items in both
   changesets. They are reviewed in the viewer, not one per turn. Accepted items land.
5. **Record.** Per question: precision (accepted of proposed). Recall share: A's accepted items
   over all accepted items in A and B. The categories in B that no question covers become
   candidate questions.

**Held out.** Write and revise the bank on two repositories. Measure it on the rest without
changing it. The viewer and Context Studio are already in-sample for the 14 checks, so they are the
authoring pair. heimdall, stagecraft, heimdall-layout-loop and DR's own model are the measurement
set. Revise the bank only between rounds, never during one.

**Fleet.** In scope are the repositories with a model and commits in the last 60 days: the viewer,
Context Studio, heimdall, heimdall-layout-loop, stagecraft and DR itself. codetoreum and switchyard
are dormant. Run one session per repository, in parallel. Each is a session of its own in its own
repository. Pilot on heimdall first: it is small (131 elements) and out of sample, so the protocol
and the cost per repository are known before the fleet starts.

### D. Build from scratch

Seeded gaps test agreement with a model. A build from nothing tests the whole pipeline. It is the
end-to-end test and the original experiment 7.

**Two arms:**

1. **Rebuild a hardened model.** Pick a repository whose model came through track C. Hide its
   model, run the whole pipeline (tier 0, tier 1, tier 2, the question bank), and compare with the
   reviewed model.
   - Recall by layer and type, and by relationship at exact, link and shape level, which is the
     same scoring as the seeded gaps.
   - Precision by adjudicating what the rebuild has and the reference lacks. Some of those items
     will be things the reference missed.
2. **Held-out fresh builds.** Run the pipeline on repositories that have no model and that no rule
   or question was written against: toland-cad, house-tasks-mcp, barcut, phone-home. There is no
   reference, so measure by pooled adjudication of the findings, as experiment 7 planned. These
   repositories need models anyway, under the DR everywhere practice.

**Measures:**

- the cost curve, as tokens and recall after each stage. This shows what each tier and the
  question pass buy;
- run-to-run variance, from three takes per arm (one take is a lead, not a result);
- the gap between arm 1 and arm 2, which shows how much the bank overfits.

Arm 1 depends on track C. A repository whose reference model was built by the questions favours the
questions when rebuilt. To control for that, keep one repository out of step A: harden it by open
review only and use it as the clean reference.

### E. Keep the harness honest

These are small things that keep the earlier results comparable:

- re-run `ledger.ts` and `seeded.ts` on each `assess/before` and `assess/after` tag. Two
  questions: do the free finders score differently on better models, and does any keep-or-drop
  verdict above change?
- drop the frontier, residual and same-symbol finders from the default run, and keep them behind a
  flag.

## From experiment to product: the question bank's path

The questions go through four stages. Each stage has to pass before the next starts. This follows
the rule that harnesses stay beside the product until an algorithm proves itself (last section).

### 1. Use: the review protocol on real models

Run `cli/scripts/assess-eval/RUNBOOK.md` on one repository at a time: the heimdall pilot first,
then the fleet. Each review leaves three things behind:

- the answer logs (`answers.jsonl`, `open.jsonl`), saying which question proposed what;
- the maintainer's verdicts;
- a better model.

The better model is track C's purpose, and it becomes reference data for tracks D and E.

### 2. Evaluate: what "adds value" means

A scoring script, `score.ts` (not written yet), reads those outputs. Verdicts are not recorded by
hand: an item is accepted if it is in the model at the `assess/after` tag, and rejected otherwise.
The reasons come from the maintainer's viewer annotations.

Per question, pooled over the fleet:

| Measure                                                                                              | Tells you                                      |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Precision: accepted over proposed, with a Wilson interval                                            | Whether its answers can be trusted             |
| Unique yield: accepted items no other question, P0 or free finder produced                           | Whether it earns its place (a set-cover curve) |
| Share of everything accepted in steps A and B                                                        | How much of a full review the bank covers      |
| Tokens per accepted item, from the log's `begin` and `end` timestamps against the session transcript | Its cost                                       |
| Applicability: how often it applies and its witnesses fire                                           | Whether it is worth asking                     |
| Agreement between two step A runs on the same frozen model (ideally Claude Code and Copilot)         | Whether it is repeatable                       |

**Decision rules,** from the design doc and applied per question:

- **Keep** when precision is at least 0.7 and either:
  - at least 10% of its accepted items are ones nothing cheaper found, or
  - it is the cheapest source of the ones it shares.
- **Drop** when precision is below 0.5, or when an accepted item costs more than three times the
  median.
- **Demote** to a free check when its verdicts are mechanical, that is, its witness alone gives the
  answer and the agent adds nothing.

**The pilot cannot decide this.** One repository yields a handful of items per question. The pilot
settles the protocol and the cost per repository. Verdicts on questions need the fleet pooled, and
they are measured on the held-out repositories with the bank unchanged. The same rule applies to
step B's categories: one that no question covers becomes a candidate for the next bank version, not
a change mid-round.

### 3. Integrate into assess-eval

There are two halves, at different speeds.

- **The witnesses become finders.** They are free and can go in now. The bank's model witnesses
  replace the `review-check` finder. `checks.json` stays so earlier results can be reproduced.
  `seeded.ts` then measures how well the witnesses point at seeded gaps. That makes it a free
  regression test for every new bank version, run before any tokens are spent on it.
- **A headless step A runner.** This needs the agent. It drives step A by script, with the dr and
  CBM MCP servers attached: the Agent SDK or `claude -p` for Claude Code, and Copilot's equivalent
  for the comparison between agents. It writes the same answer log, and `score.ts` reads it. It is
  what makes the repeatability measure and track D possible without someone running a session each
  time. Every run records its bank version, so results compare across versions.

### 4. Integrate into released DR

Only the questions that passed stage 2 go in, as a change of its own planned with `/dr-plan`. The
proposed shape:

1. **The bank becomes versioned data that ships with DR**, beside the CBM mapping in
   `spec/analyzers/`. `witnesses.ts --check` becomes a unit test, as the mapping's catalog test is,
   so a spec change that breaks a witness fails CI. DR owns it (decision 6 below).
2. **The witnesses become a `dr` command and MCP tool,** either a mode of `dr audit` or a review
   tool of their own. It is deterministic and free: it reports per question what the model lacks.
   This is where the bank would change or replace `dr audit`'s gap analysis.
3. **The agent half ships as a skill in the dr plugin, not as DR calling a model.**
   - The user's own coding agent fetches the witnesses through the MCP tool, investigates, and
     stages its answers into a changeset the user reviews.
   - Claude Code gets the plugin skill, and Copilot gets the same instructions through its
     integration, so DR stays neutral about which agent runs it.
4. **It hooks into the existing flows:**
   - after a bootstrap, `project_status` names the review as the next step;
   - in `/dr-plan`, the questions run scoped to a changeset's elements, the way the brief's intent
     trace does now.

## Upstream fixes from the heimdall pilot

The pilot (2026-11-21, bank 0.1, steps A and B) found problems that belong upstream, in the spec,
the dr tools, the CBM mapping, or the bank itself. Most of what step B found and step A missed comes
from these problems, not from the questions being badly chosen. Fixing them in the right place is
part of this roadmap. A workaround in one repository's model does not count as a fix.

This table is the index. Each row gets a link when it is filed, and its status changes when it
lands. Nothing is filed without the maintainer's OK. Spec rows go to Context Studio as proposals and
are never edited into `spec/` directly. Tool rows are `dogfood` issues on this repository. Bank and
runbook rows change in this repository, in bank 0.2.

**Blocks the fleet** marks rows that the fleet (step 4 of the order below) would otherwise
rediscover in every repository.

### Spec (Context Studio proposals)

| #   | Problem                                                                                                                                                                                                                                                     | Seen in | Blocks the fleet | Filed |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------- | ----- |
| S1  | A library's public API has no type. `api.operation` is OpenAPI-only. Step A logged 29 spec-gaps and left about 225 exports unstaged; step B staged 131 exports as `api.operation` anyway. Needs a ruling: a new type, or `application.applicationinterface` | A, B    | yes              | —     |
| S2  | No design-token type                                                                                                                                                                                                                                        | B       |                  | —     |
| S3  | The `technology.systemsoftware` type enum has no browser or JavaScript runtime value                                                                                                                                                                        | A       | yes              | —     |
| S4  | Only system software and technology services may `satisfies` a requirement. Technology artifacts, functions and processes, and application processes cannot                                                                                                 | B       |                  | —     |
| S5  | A technology process cannot compose a technology function or realize a countermeasure                                                                                                                                                                       | B       |                  | —     |
| S6  | A UX library cannot aggregate state patterns. A UX library component has no link to a product feature or a data-model schema                                                                                                                                | A, B    |                  | —     |
| S7  | An API operation cannot reach a data-model schema directly                                                                                                                                                                                                  | B       |                  | —     |
| S8  | Testing can link to navigation flows, guards and transitions, but not to the route a suite exercises                                                                                                                                                        | B       |                  | —     |
| S9  | The technology layer's rule text allows a node `assigned-to` a technology process, but the catalog refuses it. One of the two is wrong                                                                                                                      | A       |                  | —     |
| S10 | Layer rules leave granularity open, so the two runs disagreed. Should there be one test case sketch per test or per file? Is "browser serves component" plus "component depends-on browser" a duplicate? Is a React context a component or a data object?   | A, B    | yes              | —     |

### DR tools (`dogfood` issues)

| #   | Tool                                | Problem                                                                                                                         | Blocks the fleet | Filed |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- |
| D1  | `relationship_add`, `model_add`     | Cannot reference an element staged in another changeset, so step B's 131 operations could not be wired to step A's components   | yes              | —     |
| D2  | `changeset_brief`                   | Its unwired count (81,024) counts every catalog triple an element lacks, so it cannot be acted on                               | yes              | —     |
| D3  | `changeset_show`, `changeset_brief` | Neither pages a 6,000-change changeset by layer and type. The agent parsed `changes.yaml` itself                                |                  | —     |
| D4  | `model_add`                         | A 1,770-element batch returned 113 KB; `limit` did not cap it. One bad target produced one failure per relationship (123 lines) |                  | —     |
| D5  | `model_add`                         | A re-sent element comes back `invalid`, a re-sent relationship `duplicate`. Both should report as idempotent                    |                  | —     |
| D6  | `model_add`, `spec_type`            | Required attributes and enum values for several types cannot be fetched in one call (5 refusals in step B)                      |                  | —     |
| D7  | `model_add`                         | Names that differ only in case or punctuation get the same id, and links are silently merged into the wrong target              | yes              | —     |
| D8  | `codebase_extract` `view`           | Repeats the same candidate list on every card; `groupBy: file` is ignored in view                                               |                  | —     |
| D9  | `changeset_unstage`, `model_trace`  | No compact output; `limit` does not cap `model_trace`                                                                           |                  | —     |
| D10 | `changeset_deactivate`              | Deletes the tracked `changesets/.active` file                                                                                   |                  | —     |
| D11 | `codebase_index`                    | Writes `.cbmignore` into a frozen tree, which forces a commit and a moved tag                                                   |                  | —     |
| D12 | `project_status`                    | Recommends drift actions to a review session                                                                                    |                  | —     |
| D13 | `model_add`                         | Shortened-id notices grouped by name length (about 80 identical groups)                                                         |                  | —     |

### CBM mapping (track A)

| #   | Problem                                                                                                                | Filed |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| C1  | All 8 `Route` nodes and all `HTTP_CALLS` in heimdall are false positives (Playwright `page.goto`, JSX text, a comment) | —     |
| C2  | A decisions file outside an `adr/` folder gives no ADR node                                                            | —     |
| C3  | `query_graph` prefix compression (`rows_refs`) makes some results unreadable                                           | —     |

C1 and C2 can be filtered in this repository's mapping. Whether codebase-memory itself should change
is a separate question for its maintainers.

### Bank and runbook (bank 0.2, this repository)

These are mistakes in bank 0.1, mostly the assumption that every system is a service with HTTP,
storage and authentication.

| #   | Fix                                                                                                                                                                                                 | Blocks the fleet |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| B1  | Q10's precondition: client-side and supply-chain threats count, not only authentication code (markdown injection, tabnabbing, a tampered release)                                                   | yes              |
| B2  | Q11's precondition: dev-mode warnings and benchmarks count, not only telemetry libraries                                                                                                            | yes              |
| B3  | Q5 covers a library's public API (after S1)                                                                                                                                                         | yes              |
| B4  | Q7 covers public types, not only persisted data                                                                                                                                                     | yes              |
| B5  | Q9 covers packaging and distribution                                                                                                                                                                | yes              |
| B6  | A quality-attribute question (performance budgets, accessibility, reduced motion, server rendering)                                                                                                 | yes              |
| B7  | Q8 covers UI events, not only asynchronous messaging                                                                                                                                                |                  |
| B8  | The ledger assigns `application ~ data-model` to Q6, not Q8                                                                                                                                         |                  |
| B9  | Runbook: a log key for `outside`; a verdict for a stale element; whether satisfied witnesses are logged; a close step that does not depend on D2; begin and end lines written when the work happens | yes              |

### How the list stays current

- Each pilot or fleet run ends by comparing its friction and spec-gap lists against this table:
  a new problem becomes a row, and a known one gets the run added to "Seen in".
- `score.ts` (order step 3) counts `spec-gap` verdicts per row, so the spec rows can be ranked by how
  much they cost.
- A row is closed only when its fix lands upstream. A bank 0.2 that works around a spec row leaves
  that row open.

## Order

```
A  edge-group triage ───────────────────────────────┐ (independent, any time)
B  draft bank → curate → pilot on heimdall ─┐       │
                                             ├─ C fleet (steps A, B, C per repo) ─┬─ E re-measure
                                             │                                   └─ D arm 1 (rebuild)
D arm 2 (fresh builds) ──── needs the bank frozen after C's first round
```

1. **B: draft and curate the bank.** Done 2026-11-21 (bank 0.1).
2. **B and C: pilot on heimdall.** All three protocol steps. This gives the cost per repository and
   the first precision and recall numbers.
3. **`score.ts`,** written against the pilot's outputs.
   - **File the upstream fixes** (the section above), and land the rows marked "blocks the fleet":
     S1, S3 and S10 through Context Studio; D1, D2 and D7 in the dr tools; bank 0.2 for the B rows.
4. **C: the fleet,** one session per repository, once the rows that block it have landed. Then the
   per-question verdicts (stage 2 above), and bank 0.2.
5. **The headless step A runner,** for the repeatability measure and for track D.
6. **E: re-measure** on the hardened models.
7. **D:** arm 1 on one hardened repository, then arm 2 on two or three fresh repositories.
8. **The product change** (stage 4 above), for the questions that passed.

Turning the witnesses into finders (stage 3) is cheap and can be done at any point.

Track A runs whenever there is a gap. It touches extraction and the catalog, not the bank.

## Decisions needed

1. **The bank.** Settled for version 0.1 on 2026-11-21 (see
   [REVIEW_QUESTION_BANK.md](REVIEW_QUESTION_BANK.md)); wording and cuts are revised between rounds.
2. **Which repository is held out from step A** as the clean reference for track D.
3. **Review load.** Step C puts every proposed item in front of the maintainer. Choose between
   reviewing everything in the pilot and sampling in the fleet, for example all of step B's items
   plus a fixed sample from step A's.
4. **Budget per repository** for steps A and B. The pilot measures it. Set a ceiling before the
   fleet starts.
5. **Experiment 2** (pair labels): drop it, or keep it as a cross-check on the pilot.
6. **Who owns the bank once it ships.** Decided 2026-11-21: this codebase owns it, as it owns the
   CBM mapping. It ships beside the mapping in `spec/analyzers/` and changes through ordinary DR
   pull requests, not through Context Studio.

## How this stays organised

The harness stays in `cli/scripts/assess-eval/`, beside `classify-eval` and `spec-enrich`. The
question bank, its runbook and the protocol scripts go there too. Integration into `dr audit` or a
`dr` tool is planned as its own change once a track proves an algorithm.
