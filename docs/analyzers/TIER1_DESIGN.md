# Tier 1 (decision model): implementation design (draft, 2026-11-13)

Status: **draft for maintainer review**. Design only; no code has changed. This is the build plan
for step 3 of [CASCADE_DESIGN.md](CASCADE_DESIGN.md) ("Build order") and track B step B6 of
[EXTRACTION_STRATEGY.md](../EXTRACTION_STRATEGY.md). It takes §3 of the cascade design (backend
interface, two question stages, bands) and the maintainer's decisions of 2026-10-29 as given, and
fits them to what changed since: production extraction runs through the `codebase_extract` MCP tool
(`cli/src/mcp/tools/codebase-extract.ts`, planned by `cli/src/analyzers/extraction-plan.ts`), and
the gateway decision of 2026-11-09 is that it runs Tier 0, then Tier 1 only if the project opted in,
then the calling agent.

## Recommendations in brief

1. **Tier 1 runs inside `codebase_extract`**, between Tier 0 and the agent, on the cards Tier 0
   narrowed or left open, and in `dr analyzer classify`. It asks nothing about symbols that already
   have an element.
2. **Accepted cards are staged like Tier-0 decisions** (same planner path, so they also get their
   mapped relationships), with the tier, question set, model and probabilities recorded in the
   extraction record, not in the model. **Until the thresholds are verified on held-out labels (B5),
   Tier 1 runs in _suggest_ mode**: every card carries Tier 1's answer and band, nothing is staged or
   hidden by Tier 1 alone, and the agent can take the accept band in one call (`acceptTier1`).
3. **The opt-in is a committed block in `documentation-robotics/model/manifest.yaml`**
   (`extraction.tier1`, naming provider and model); credentials come only from the environment or
   `~/.dr-config.yaml`, never from the manifest. Credentials without the block do nothing.
4. **A new module `cli/src/analyzers/classifier/`** holds the backend interface, the Clef backend
   ported from the harness, question set `dr-qset-1`, the criteria builder, state rendering, bands,
   cache and the run loop. The harness imports it, as it already imports the card builder.
5. **Every decision is cached** under a key of the rendered card state, the question set, the
   criteria digest and the model id; a per-run cost cap, a concurrency pool, timeouts and a circuit
   breaker bound a run, and any provider failure leaves the run as Tier 0 only, saying so.
6. **The three-band rule changes**: accept, reject (`none` above its threshold) and escalate.
   Nothing is dropped silently; a card Tier 1 is unsure of goes to the agent.

## 1. Where Tier 1 runs

### 1.1 Inside `codebase_extract`

Today the tool runs the extraction (`backend.extract`, which builds every card and its Tier-0
outcome), plans with `planElements`, validates adds, plans relationships and stages
(`codebase-extract.ts`, around the `planElements` call). Tier 1 is a seam in the result
(`tier1: "not wired: ..."`) and in the planner, which cards narrowed symbols with the reason
"Tier 1 is not wired" (`extraction-plan.ts`, `planElements`).

Tier 1 goes between extraction and the final plan:

1. `backend.extract` as now: an `ExtractionGraph` whose `ExtractedSymbol`s carry card, facts and
   `tier0` (`cli/src/analyzers/cards/extract.ts`).
2. A first `planElements` pass. It is pure and fast, and it tells which symbols would become cards
   of kind `narrowed` or `no-rule` (`UndecidedKind` in `extraction-plan.ts`). Only those are Tier 1's
   to ask. The other kinds are not: `needs-attributes` (Tier 0 already decided the type),
   `ambiguous` (a matching question, not a classification), `unhandled-route` (the node mapping fixes
   the type) and `decision-record` (documentation for the upper layers, Tier 2's job). Symbols matched
   to an existing element (`modelled`) are not asked either: someone already decided them, and a
   disagreeing answer would only add `retyped` noise and cost.
3. `classifyTier1` (section 3) answers those symbols from the cache, then from the provider within
   the run's time slice and cost cap, and attaches a `tier1` decision to each `ExtractedSymbol` (a new
   optional field beside `tier0`).
4. A second `planElements` pass. In _stage_ mode an accept-band decision counts as decided, with
   `rule: "tier1:dr-qset-1"`, so it goes through the same code as a Tier-0 decision: matching by
   decided type and id, naming, `deriveAttributes`, `validateAdds` (an add whose attributes don't
   validate becomes a `needs-attributes` card, as Tier-0 adds do), `elementOf` and therefore
   `planRelationships`. A reject-band decision is counted (`unchanged.tier1Rejected`) and not carded.
   Everything else is carded with a `tier1` hint. In _suggest_ mode every asked card is carded with
   its hint.

Staging, the extraction record, paging, `reject` and verify are unchanged apart from the provenance
in section 1.3.

### 1.2 In `dr analyzer classify`

The command refuses to run without `--tier0-only` today (`cli/src/commands/analyzer.ts`, the
`classify` action). With Tier 1 it gets:

- no flag: Tier 0, then Tier 1 when the project opted in; otherwise Tier 0 with a line saying Tier 1
  is off and why;
- `--tier0-only`: as now, no network whatever the config;
- `--json` / `--output`: the report gains a `tier1` summary (the block in section 2.3) and, per
  result, the decision and band.

The command classifies every Tier-0-undecided card (it has no model to match against), so it is
also how the cache is warmed in the background (section 4.4). Its run output goes under
`.dr/analyzers/<analyzer>/classify/<run-id>/` (`decisions.jsonl`, `summary.json`), following the
current `.dr/analyzers/` layout rather than the `documentation-robotics/.analyzer/` path in §6 of
the cascade design. It never writes a changeset (`--changeset` in decision 3 stays unbuilt:
`codebase_extract` stages).

### 1.3 What the agent receives per band

The bands, per card, for question set `dr-qset-1` (thresholds in section 6):

| Band     | Rule                                                                                  | _stage_ mode (after B5)                                               | _suggest_ mode (before B5)              |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| accept   | top layer is not `none`, layer p ≥ T_layer, and the chosen type's p ≥ T_type          | staged as an element, with its mapped relationships; counted, no card | card with the hint, sorted first        |
| reject   | top layer is `none` and its p ≥ T_none                                                | not carded; counted under `unchanged.tier1Rejected`                   | card with the hint, sorted last         |
| escalate | everything else, and any card Tier 1 could not answer (budget, time, provider failed) | card with the hint (or why it has none)                               | card with the hint (or why it has none) |

The card hint (a new optional `tier1` field on `UndecidedCard`), kept small because a response aims
to stay under 28 KB (`RESPONSE_BUDGET_BYTES` in `codebase-extract.ts`):

```json
"tier1": {
  "band": "accept",
  "layer": "application",
  "type": "applicationfunction",
  "p": { "layer": 0.71, "type": 0.46 },
  "alt": ["application.applicationservice 0.31"],
  "significance": 2,
  "concerns": ["data_persistence"]
}
```

(Illustrative values.) At `detail: "compact"` only `band`, `layer`, `type` and `p` stay. Within the
existing ordering (`sortCards`: changed in range first, then kind, label, file), suggest mode sorts
accept before escalate before reject, so the agent reads the easy confirmations together.

**Recommendation: stage the accept band, with provenance, once the thresholds are held-out
verified; until then, suggest.** Reasons:

- **The agent is the bottleneck.** On this repository 4,071 of 4,769 cards go to the agent. Hints
  alone don't shorten that list: at 25 cards a page it is about 160 pages either way. Staging the
  accept band, and not carding the reject band, is what removes work, and staging through the planner
  also gives those elements their edges, which the agent would otherwise get only on a rerun.
- **It is the same trust model as Tier 0.** Tier-0 decisions are staged into an as-built changeset
  that a person reviews before it lands; Tier 1 adds a measured, recorded probability on top of that.
  The gateway decision (Tier 0, Tier 1, then the agent) reads the same way.
- **It makes verify more independent.** `codebase_extract` with `since` builds the as-built side for
  `changeset_verify`, and what Tier 0 can't decide is "only as independent as the agent is careful"
  (docs/CHANGE_MODELING.md, Known limits). Model-decided elements recorded with their probability
  reduce that.
- **But not on in-sample thresholds.** The accept band's end-to-end _type_ precision is 80-86% with
  a layer threshold alone and 88-92% with a type threshold added (section 6), measured on the corpora
  the question set and the Tier-0 rules were designed on. One in eight to one in ten staged elements
  with the wrong type, unmeasured on a new codebase, is a reviewer's problem the cascade shouldn't
  create silently. Suggest mode ships the whole machinery and most of the benefit (the agent confirms
  the accept band in one call) while a person, through the agent, still says yes.

`acceptTier1: true` on `codebase_extract` is that one call: a normal run with the extraction
changeset's `since` and `layers`, with Tier 1 in stage mode for that run only. Answers come from the
cache, so it costs nothing and stages exactly the accept band the agent was shown. The reject band is
left as cards (whether it should be included is an open question).

**Provenance.** The model has no field for "which tier decided this" and adding one is a spec change,
so it goes where extraction already records what it staged: each `StagedBySymbol` in the extraction
record (`.dr/analyzers/extract/<changeset>.json`) gains

```ts
decidedBy?: {
  tier: 1;
  qset: string; // "dr-qset-1"
  model: string; // "@cf/cloudflare/clef"
  p: { layer: number; type: number | null };
  confirmed: "auto" | "agent"; // stage mode, or acceptTier1
};
```

and Tier-0 adds keep their `rule`. The element's source reference stays `provenance: "extracted"`
(the location was read from the code; `inferred` means pattern matching in
`spec/schemas/base/source-references.schema.json`). The run's `tier1` block and
`dr analyzer classify`'s `decisions.jsonl` carry the same fields. Reviewed outcomes of these elements
are the labelled data §9 of the cascade design wants, and the record keeps them recoverable.

## 2. The opt-in

Decision 1 of 2026-10-29: opt-in per project, naming the provider that receives card text, said when
it runs, and environment credentials alone are not enough.

### 2.1 Where: a block in `manifest.yaml` (proposal)

Project settings that travel with the model already live in
`documentation-robotics/model/manifest.yaml` (`codebase_path`, `models:`, `reconciled`). `.dr/` is
gitignored (`.gitignore`, "DR CLI metadata"), so a file there (the pattern of
`.dr/analyzers/<analyzer>/cross-repo.json` in `cli/src/analyzers/cross-model.ts`) would be per
checkout, invisible in review and silently different between teammates. Sending a codebase's text to
a third party is a project decision, and a committed setting makes enabling it a reviewed diff.

```yaml
extraction:
  tier1:
    provider: cloudflare-workers-ai # required: who receives card text
    model: clef # required: clef | clef-flash (provider model ids live in code)
    max_cost_usd: 5 # optional: cap per run, default 5
    concurrency: 4 # optional: cards in flight, default 4, at most 16
```

Rules:

- No `extraction.tier1` block (or `tier1: false`) means off. `provider` and `model` are both
  required; there is no default provider.
- An unknown provider or model, or a value of the wrong type, makes Tier 1 `misconfigured`: the run
  is Tier 0 only and says what is wrong.
- Keys that would hold credentials (`token`, `api_token`, `api_key`, `account_id`, `secret`) are
  refused with "credentials don't go in the manifest; see ...", so nobody commits one by analogy.
- `Manifest`/`ManifestData` (`cli/src/core/manifest.ts`, `cli/src/types/index.ts`) gain an optional
  `extraction` field, loaded beside `codebase_path` in `Model.load` and written in `saveManifest`
  (`cli/src/core/model.ts`). This is required, not cosmetic: `saveManifest` rebuilds the YAML from
  known fields, so an unknown top-level block would be dropped by the next save.
- Turning it on is a human act: an edit to the manifest, or `dr analyzer tier1 enable --provider
cloudflare-workers-ai --model clef` (and `disable`), which prints what will be sent and to whom.
  No MCP tool sets or clears it; `project_status` and `codebase_extract` only report it.

The alternative, a per-checkout `.dr/analyzers/<analyzer>/tier1.json`, is listed in the open
questions.

### 2.2 Credentials

For `cloudflare-workers-ai`, in order:

1. The environment: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with Workers AI
   permission), the names the harness already uses (`cli/scripts/classify-eval/README.md`).
2. The user config `~/.dr-config.yaml` (`cli/src/config.ts`, which already holds
   `mcp.api_key_path`):

   ```yaml
   decision_models:
     cloudflare-workers-ai:
       account_id: "..."
       api_token_path: ~/.dr-cloudflare-token # a 0600 file, like mcp.api_key_path
   ```

The CLI does not read `.env` files (nothing under `cli/src` loads one) and should not start: the
harness keeps its own `loadDotEnv` (`lib/env.ts`) and passes credentials to the backend constructor.
The `dr mcp` server the plugin starts (`integrations/claude_code/.claude-plugin/plugin.json`)
inherits Claude Code's environment, so either source reaches it. The token is never logged or
returned; the account appears only as its last four characters, so the user can tell which account
is billed.

### 2.3 What the tool says

`codebase_extract` replaces its `tier1` string with a block (illustrative values):

```json
"tier1": {
  "state": "on",
  "provider": "cloudflare-workers-ai",
  "model": "@cf/cloudflare/clef",
  "account": "…3f9a",
  "qset": "dr-qset-1",
  "mode": "suggest",
  "thresholds": { "layer": 0.6, "type": 0.4, "none": 0.6, "fit": "in-sample" },
  "cards": 4071,
  "cached": 3659,
  "sent": 412,
  "failed": 0,
  "skipped": 0,
  "bands": { "accept": 903, "reject": 610, "escalate": 2558 },
  "staged": 0,
  "costUsd": 0.47,
  "capUsd": 5,
  "durationMs": 61234,
  "notice": "Sent 412 cards (symbol, signature, docstring, callers, callees, imports and up to 40 source lines each) to Cloudflare Workers AI (@cf/cloudflare/clef), because documentation-robotics/model/manifest.yaml enables extraction.tier1."
}
```

`state` is one of:

- `off`: "not enabled for this project (extraction.tier1 in manifest.yaml)". When Cloudflare
  credentials are set it adds that they are set and unused.
- `misconfigured`: the config error; the run is Tier 0 only.
- `no-credentials`: names the environment variables and the user-config keys it looked for.
- `on`: as above.
- `unavailable`: the provider failed (auth, down, timeouts); how far it got and why. The run is
  Tier 0 for the rest.
- `warming`: the background cache fill is running (section 4.4).

`dr analyzer classify` prints the same notice to stderr before the first request, with the estimate
("about 412 cards, about $0.47, cap $5.00"), and the summary after. `project_status` shows Tier 1's
state in one line beside the index.

### 2.4 What never enables it

Credentials in the environment or in `~/.dr-config.yaml` without the manifest block; a
`codebase_extract` argument (there is none to turn it on: `tier1: false` only turns it off for one
run); the harness's `.env`. A unit test sets the environment variables with no block and asserts no
request is made.

## 3. Module layout: `cli/src/analyzers/classifier/`

Decision 2: the question set lives in code with a version id. Everything Tier 1 needs is ported from
the harness and the harness switches to importing it (section 5).

```text
cli/src/analyzers/classifier/
  index.ts            public API: resolveTier1, classifyTier1, bandOf, types
  types.ts            DecisionBackend, Question, RawAnswer, Tier1Decision, Tier1Hint, Band, Tier1Summary
  config.ts           resolveTier1(): manifest block + credentials -> off | misconfigured | no-credentials | ready
  backends/
    index.ts          providers by name; model aliases to ids and prices ("clef" -> "@cf/cloudflare/clef", $0.24/M)
    cloudflare.ts     Clef over the Workers AI REST API (from backends/clef.ts: callClef, choiceOf, noulOf, scoreOf)
  qset/
    v1.ts             QSET_ID "dr-qset-1": stage-1 and stage-2 questions, KIND_CANDIDATES, concerns, significance
    index.ts          the current qset, and older ids for the harness
  criteria.ts         layer and type criteria from the bundled spec (from lib/spec.ts), criteriaDigest()
  state.ts            renderState(card, options) (from lib/state.ts), 40 source lines
  bands.ts            THRESHOLDS per (qset, model) with fit provenance; bandOf(), modeOf()
  cache.ts            Tier1Cache (section 4.1)
  run.ts              classifyTier1(): cache, cost cap, pool, deadline, retries, circuit breaker
```

**Backend interface.** Backends are request-shape only, so Jev (same shape, decision 2026-10-24) is a
second file in `backends/`; the two-stage logic is in `run.ts`.

```ts
export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

export interface DecisionBackend {
  readonly provider: string; // "cloudflare-workers-ai"
  readonly model: string; // "@cf/cloudflare/clef"
  readonly inputPricePerM: number; // USD per million input tokens
  ask(
    state: string,
    questions: Record<string, Question>,
    signal: AbortSignal
  ): Promise<{
    answers: Record<string, RawAnswer>;
    usage: { inputTokens: number; outputTokens: number };
    reportedModel?: string;
  }>;
}

export class BackendError extends Error {
  kind:
    | "auth"
    | "rate-limit"
    | "unavailable"
    | "bad-request"
    | "timeout"
    | "malformed";
  status?: number;
  retryAfterMs?: number;
}
```

The Cloudflare backend takes `{ accountId, apiToken, model, fetch? }` in its constructor (no
environment reads inside it), posts `{ model, state, questions }` to
`https://api.cloudflare.com/client/v4/accounts/<id>/ai/run/<model id>`, accepts both the wrapped
(`result.answers`) and unwrapped (`answers`) shapes the harness handles, and maps HTTP status to
`BackendError.kind`. Answer parsing (`choiceOf`, `noulOf`, `scoreOf`) moves as is.

**Question set `dr-qset-1`** is exactly the harness configuration the current numbers measure,
`clef@cbm012-kind-tier0` (`classify.ts --kind-narrow --tier0`, full criteria, no facts, no charter):

- stage 1: `layer` (choice over the 13 layers and `none`, restricted to Tier 0's layers when it
  narrowed), `significance` (score, 5 levels), six `concern_*` yes/no questions;
- stage 2, when the layer is not `none` and at least two options remain: `element_type` (choice
  within the layer and `none`), restricted by Tier 0's narrowing, else by `KIND_CANDIDATES` (the kind
  rule, still harness code; moving it into the rule file is a later question-set change);
- the state is `renderState(card, 40)`.

`QSET_ID` changes when anything in `qset/` or `state.ts` changes: wording, the kind rule, the
criteria mode, the rendering. A unit test pins a digest of the question builders' output for fixture
cards to the id, so an edit that forgets the bump fails. The spec criteria and the Tier-0 narrowing
are inputs, not part of the id: they enter the cache key (section 4.1) and are recorded per decision.

**Criteria** come from the CLI's bundled spec through `cli/src/core/spec-loader.ts` (the
`cli/src/schemas/bundled/` files, `spec/dist` in the monorepo), not from `spec/dist` at the
repository root as `lib/spec.ts` does, since an installed CLI has no repository. The builder keeps
the harness's checks (a placeholder layer description is an error) and exports `criteriaDigest()`, a
hash of the layer criteria and every layer's type criteria.

**Bands** (`bands.ts`):

```ts
export interface BandThresholds {
  layer: number; // T_layer
  type: number; // T_type
  none: number; // T_none
  fit: "in-sample" | "held-out";
  fittedOn: { corpora: string[]; askedCards: number; specVersion: string; date: string };
}
export const THRESHOLDS: Record<string, Record<string, BandThresholds>> = {
  "dr-qset-1": { "@cf/cloudflare/clef": { layer: 0.6, type: 0.4, none: 0.6, fit: "in-sample", fittedOn: { ... } } },
};
```

`modeOf` is `stage` only when `fit` is `held-out`; a model with no entry for the question set (say
`clef-flash`) is suggest mode with every card escalated, its hint still shown. Bands are computed at
use, never cached, so new thresholds need no new requests.

## 4. Caching, determinism, cost and failures

### 4.1 Cache

- **Key**: SHA-256 of `[model id, qset id, criteria digest, narrowing, sha256(rendered state)]`,
  where narrowing is the sorted candidate list from Tier 0 or the kind rule. The rendered state is
  the "card content hash": it is a pure function of the card (§1 of the cascade design) and exactly
  what the provider sees, so a change in source, signature, docstring or neighbourhood re-asks and
  nothing else does. The spec version is recorded with each decision, but the criteria digest is
  what keys it: a spec release that leaves the criteria text alone keeps the cache.
- **Value**: the whole card's decision (both stages, since stage 2 depends on stage 1), with the raw
  probabilities, significance, concerns, usage, cost and time.
- **Where**: `.dr/analyzers/<analyzer>/tier1-cache/<qset>/<model slug>.jsonl`, append-only, last
  line for a key wins, read into a map at the start of a run, appended under a short lock of its own
  (not the extraction run lock, which the background fill must not hold for minutes). About 1 KB a
  decision, so about 5 MB for this repository. `dr analyzer classify --prune-cache` keeps only the
  keys the latest run used and removes files of other question sets and models.
- `.dr/` is not committed, so the cache is per checkout; a new clone pays once.

### 4.2 Determinism

Clef has answered deterministically in the harness: the 0.12.1 re-measurement relies on it to
separate the spec effect from the CBM effect (EXTRACTION_STRATEGY.md, "Re-measured on CBM 0.12.1").
With the cache, a rerun at the same commit gives the same decisions byte for byte whatever the
concurrency, and only changed cards are asked. One gap: Workers AI model ids are not versioned, so a
provider-side update would change answers for new cards and not for cached ones. The backend records
the model the response names, if any, and the harness's rerun on the committed corpora (expected: 0
lost, 0 gained in `compare.ts`) is the drift check, run before each release that touches Tier 1.

### 4.3 Cost, concurrency, rate limits, timeouts

- **Scale.** On dr-cli the measured configuration costs $0.0011 a card at a median 739 ms for both
  stages (`data/dr-cli/report.md`, summary row `clef@cbm012-kind-tier0`). This repository's 4,071
  cards are then about $4.50 and, at 4 in flight, about 12.5 minutes cold; a `since` run on 23 to 774
  cards (the ranges measured in EXTRACTION_STRATEGY.md, "`detect_changes` for `since` runs") is
  $0.03 to $0.85 and 4 s to 2.5 min. A warm run costs nothing.
- **Cost cap.** Before asking, the run estimates the misses' cost from the mean cost of cached
  decisions for this question set and model (the harness's $0.0011-0.0017 a card until there are
  any). Over `max_cost_usd`, it asks in card order (changed in range first, then the planner's order)
  up to the cap; the rest are escalated with `skipped: "cost cap"` and the result says what the whole
  run would cost. Actual cost is `inputTokens × price` from the provider's usage, as the harness
  computes it. Each run appends `{date, sent, tokens, costUsd}` to
  `.dr/analyzers/<analyzer>/tier1-runs.jsonl`, so `project_status` can show month-to-date spend.
- **Batching.** The API takes one state per request; all stage-1 questions share one request, stage
  2 is a second. Cards run in a pool of `concurrency` (default 4, the harness's default).
- **Rate limits.** Workers AI's limit for Clef is not in the sources this work has used; the first
  live run measures it. 429 and 5xx are retried with backoff (the harness: four attempts, 1, 2, 4,
  8 s), honouring `Retry-After`, and a 429 halves the pool for the rest of the run (at least 1).
- **Timeouts.** 20 s a request (`AbortSignal.timeout`; the harness sets none), and the run's
  deadline: inside `codebase_extract` Tier 1 gets what is left of the 100 s budget
  (`DEFAULT_BUDGET_MS`) minus a reserve for planning and staging.

### 4.4 Cold caches: the background fill

A cold bootstrap does not fit the 100 s budget, so:

- When `codebase_extract`'s misses fit its time slice (most `since` runs), it asks inline.
- When they don't, it starts the fill in the background, reusing the detached-child machinery of
  `cli/src/analyzers/index-job.ts` (`dr analyzer classify --tier1 --job <id>`, record
  `.dr/analyzers/tier1-job.json`, log beside it), stages nothing, and returns `state: "warming"` with
  the card count, the estimate and how to continue: poll `project_status`, then call
  `codebase_extract` again; or pass `tier1: false` to go on with Tier 0 only now. Stopping avoids
  the agent deciding cards Tier 1 is about to answer.
- When opted in, the `codebase_index` child runs the same fill as its last phase (`classifying`), so
  the usual order (index, then extract) finds a warm cache. Whether reindexing should send code on
  its own is an open question.

### 4.5 Failures

Tier 1 never fails the run and never stages half a card (a decision needs both stages).

| Condition                                      | Behaviour                                                 | `tier1.state`              |
| ---------------------------------------------- | --------------------------------------------------------- | -------------------------- |
| No manifest block                              | Tier 0 only                                               | `off`                      |
| Invalid block                                  | Tier 0 only, the error quoted                             | `misconfigured`            |
| No credentials                                 | Tier 0 only, the variables and keys looked for            | `no-credentials`           |
| 401 or 403                                     | stop at the first; the rest escalate                      | `unavailable` (`auth`)     |
| 5 cards in a row failing after retries, or 5xx | circuit breaker: stop; answers so far are kept and cached | `unavailable` (`provider`) |
| A malformed answer for one card                | that card escalates, `failed` counts it                   | `on`                       |
| Deadline or cost cap reached                   | the rest escalate with `skipped`                          | `on` (or `warming`)        |

## 5. The harness keeps measuring production code

As with cards (`cli/scripts/classify-eval/lib/tier0.ts` imports `src/analyzers/cards/`):

- `backends/clef.ts` becomes an adapter: the CLI's Cloudflare backend, built with credentials from
  the harness's `.env`; the CLI's `dr-qset-1` builders and `renderState`; the harness's `Prediction`
  record unchanged, so `report.ts` and `compare.ts` read old and new runs alike.
- `lib/spec.ts` and `lib/state.ts` re-export the CLI's `criteria.ts` and `state.ts`. The experiment
  flags (`--criteria core`, `--charter`, `--facts`) become options of the CLI's builders that produce
  variant ids (`dr-qset-1+core`), so experiments also run through production code and can't be
  mistaken for the shipped set.
- `report.ts` gains the band report, computed with the CLI's `bandOf` for the current thresholds,
  and the joint layer-and-type and `none` sweeps of section 6. A new `fit-thresholds.ts` prints a
  proposed `THRESHOLDS` entry with its fit record; the maintainer commits it to `bands.ts`.
- **Acceptance for the port**: the request JSON of `classify.ts --dry-run` is byte-identical before
  and after (a fixture test in the CLI), and a rerun of dr-cli with
  `--backend clef --kind-narrow --tier0 --tag cbm012-kind-tier0-port` gives 0 lost and 0 gained
  against `clef@cbm012-kind-tier0` in `compare.ts` (about $0.33).

## 6. Calibration

**Where the numbers stand.** The bands in §3 of the cascade design came from Phase 0 (layer
threshold 0.6: 92-97% layer precision on 36-41% of cards). The configuration that ships is the later
one, so here it is again on the committed predictions, `pred-clef@cbm012-kind-tier0.jsonl` against
`gold.jsonl`, on model-asked cards only (rule-decided cards left out, as `report.ts` does). These
figures were computed for this document; `report.ts` does not produce them yet.

| Corpus    | Asked | Layer ≥ 0.6: cards, layer / type precision | + type ≥ 0.4: cards, type precision | `none` ≥ 0.6: cards, precision |
| --------- | ----- | ------------------------------------------ | ----------------------------------- | ------------------------------ |
| dr-cli    | 300   | 91 (30%), 97.8% / 85.7%                    | 65 (22%), 92.3%                     | 46 (15%), 97.8%                |
| fastapi   | 148   | 55 (37%), 92.7% / 80.0%                    | 43 (29%), 88.4%                     | 21 (14%), 90.5%                |
| petclinic | 73    | 2 (3%), 100% / 100%                        | 2 (3%), 100%                        | 36 (49%), 100%                 |

What it says:

- **A layer threshold alone is not enough for staging**: layer precision is high but one accepted
  card in six or seven has the wrong type. A type threshold now separates: the mean type probability
  on layer-correct asked cards is 0.48, 0.53 and 0.53 on this run (the Phase 2 results report 0.42 to
  0.53 for full criteria), well above the 0.12-0.23 that §3 of the cascade design gives as the reason
  a type threshold was unusable, and adding T_type = 0.4 lifts type precision 6 to 8 points. Pooled,
  (0.6, 0.4) accepts 110 cards at 90.9% type precision, with a 95% Wilson lower bound of about 84%.
- **The reject band carries real weight**: 14-49% of asked cards are a confident `none` at 90-100%
  precision. On petclinic, where Tier 0 decides most elements, Tier 1 is mostly a `none` filter.
- **Nothing should be dropped below 0.5.** §3's "drop below 0.5 unless a concern flag fires" dated
  from a Claude Tier 2 that cost money per card. With the calling agent as Tier 2, dropping an unsure
  card loses recall for nothing; it escalates. The concern questions stay in the set (as hints and for
  later use) but don't affect bands.
- Taken together, about a third of asked cards (dr-cli: 22% accepted plus 15% rejected) would not
  reach the agent in stage mode. The samples exclude test code and differ from a whole repository,
  so that is an order of magnitude, not a forecast.

**How thresholds are fitted** (per question set and model, by `fit-thresholds.ts`):

1. Pool the labelled corpora's model-asked cards, run the question set over them (deterministic, so
   once per question set and model).
2. Accept band: on a grid (T_layer 0.5-0.8, T_type 0-0.6 in steps of 0.05), take the pair with the
   most accepted cards whose pooled end-to-end type precision meets the target P_accept, no corpus
   with at least 30 accepted cards more than 10 points below it, and report the Wilson interval.
3. Reject band: the smallest T_none whose `none` precision meets P_reject, same rules.
4. Record corpora, card counts, spec version, date and `fit: "in-sample"`.

**What can ship before B5**: everything in sections 1 to 5 in suggest mode: the module, the opt-in,
`dr analyzer classify` with Tier 1, the cache and fill, hints on `codebase_extract`'s cards and
`acceptTier1`, with the in-sample thresholds above, labelled as in-sample in every result.

**What must wait for B5** (the held-out corpus: a fourth codebase labelled with `label.ts` and not
read while writing rules or question sets):

- **Stage mode.** The thresholds count as `held-out` only when the fourth corpus, scored with the
  fitted thresholds, meets the targets within its interval. Then `modeOf` returns `stage` and Tier 1
  stages and rejects without the agent.
- **Trust in narrowing.** Tier 1's choices come from Tier 0's narrowing, which is in-sample too
  (Phase 2 results); a narrowing rule that is wrong on a new framework removes the right answer from
  Tier 1's options (the interface narrowing already gives up three dr-cli interfaces). B5 measures
  Tier 0 first, as the strategy doc says.

After B5, every question-set bump reruns all labelled corpora (about 650 cards, about $1) and refits;
reviewed outcomes of staged Tier-1 elements (section 1.3) join the labelled pool over time.

## 7. Test plan

No network in CI. The classifier's tests inject `fetch`, and the default in the test setup throws, so
a request that slips through fails loudly.

**Unit** (`cli/tests/unit/analyzers/classifier/`), with a `FakeDecisionBackend`
(`cli/tests/helpers/fake-decision-backend.ts`: scripted answers by state hash and question, call log,
and injectable 429, 5xx, timeout, auth and malformed responses):

- `qset`: request JSON for fixture cards equals fixtures captured from the harness's `--dry-run`;
  the digest-to-`QSET_ID` pin; narrowing and the kind rule restrict criteria as the harness does.
- `criteria`: built from the bundled spec; `none` present; placeholder descriptions refused; the
  digest changes when a definition does.
- `cloudflare`: URL, headers and body; wrapped and unwrapped responses; map and array probabilities;
  retries on 429 and 5xx with `Retry-After`; no retry on 400, 401, 403; timeout; the token never in
  an error message.
- `bands`: band per thresholds; no entry means escalate; mode from `fit`.
- `cache`: hit and miss; the key changes with state, question set, model, criteria and narrowing; a
  truncated last line is skipped; two writers don't corrupt it.
- `config`: off with credentials set and no block (no request made); `no-credentials`;
  `misconfigured` for an unknown provider and for credential keys in the block; the user config's
  token file; a manifest round trip through `saveManifest` keeps `extraction`.
- `run`: cost cap and deadline stop asking and escalate the rest; circuit breaker; provider down
  means every card escalates and `unavailable`; concurrency halves on 429; output order independent
  of completion order.
- `extraction-plan`: an accept-band decision in stage mode becomes an add with `rule: "tier1:..."`
  and its relationships; suggest mode cards it with the hint; the reject band is counted, not carded,
  in stage mode; a changed answer on a modelled symbol never produces `retyped`.

**Integration** (`cli/tests/integration/`, golden-copy project, the fake backend through
`CodebaseToolDeps`, which already injects the analyzer, git and budget):

- `codebase_extract` off by default: the `tier1` block says `off`, results otherwise unchanged;
- opted in: the notice, hints, ordering, `acceptTier1` staging with `decidedBy` in the record, a
  rerun answered from the cache with zero requests;
- provider failing: Tier-0 results plus `unavailable`;
- a cold cache over the slice: `warming`, the job record, nothing staged;
- `dr analyzer classify` without `--tier0-only` and without opt-in: Tier 0 and the off line.

**Live, manual**: the port's acceptance rerun (section 5), and a first opted-in bootstrap of this
repository recording time, cost and 429s.

## 8. Rollout, as small PRs

1. **Port, no behaviour change.** `classifier/` with backend, question set, criteria, state, bands
   and cache, and their unit tests; the harness switched to import it; the parity fixture and the
   dr-cli rerun as acceptance.
2. **Thresholds in-sample.** `report.ts` band report and sweeps, `fit-thresholds.ts`, the
   `dr-qset-1` entry in `bands.ts` marked `in-sample`.
3. **Opt-in and the command.** Manifest field and round trip, `~/.dr-config.yaml` section,
   `resolveTier1`, `dr analyzer tier1 enable|disable`, `dr analyzer classify` with Tier 1, the run
   loop with cap, pool, timeouts and breaker, the run ledger. Docs: the opt-in in `cli/README.md`.
4. **`codebase_extract` in suggest mode.** Two-pass planning, hints, ordering, the `tier1` block,
   inline asking within the budget, `tier1: false`, `acceptTier1` and `decidedBy`.
   docs/CHANGE_MODELING.md updated (cascade step 2, Known limits).
5. **Background fill.** The job, `warming`, `project_status`, the `codebase_index` phase (if wanted).
6. **After B5: stage mode.** Score the fourth corpus, mark the thresholds `held-out`, update the
   docs and the strategy doc's track B.

## 9. Open questions for the maintainer

1. **Config location**: a committed `extraction.tier1` block in `manifest.yaml` (recommended), or a
   per-checkout `.dr/analyzers/<analyzer>/tier1.json`?
2. **Provider naming and account**: `provider: cloudflare-workers-ai` with `model: clef`, and which
   Cloudflare account backs the first live runs (the strategy doc's next step 6 asks for it)?
3. **The bands**: retire "drop below 0.5" so that unsure cards escalate, and add a type threshold
   to the accept rule (in-sample (0.6, 0.4) gives about 91% pooled type precision)?
4. **Precision targets**: what P_accept and P_reject must the held-out fit meet before stage mode
   (for example 90% and 95%), and is a point estimate enough or must the interval's lower bound meet
   it?
5. **Suggest mode before B5**: is suggest mode with a one-call `acceptTier1` acceptable, and should
   `acceptTier1` also take the reject band (recorded as "not an element" decisions, which persist
   across runs and question sets)?
6. **Cost**: is a $5 default cap per run right, and do you want a monthly cap on top of the ledger?
7. **The index job**: should `codebase_index` fill the Tier-1 cache on its own when opted in (it sends
   code on every reindex, cached cards excepted), or only `codebase_extract` and `dr analyzer
classify`?
8. **B5**: will the fourth corpus serve both Tier 0's and Tier 1's held-out check, and which
   codebase?
9. **Provenance in review**: is the extraction record enough, or should Tier-1 decisions show in the
   changeset viewer (a field on staged changes, and so a viewer change)?
10. **Clef-flash and Jev**: allow `model: clef-flash` now (suggest mode, no thresholds), and is Jev
    still wanted once a TypeSafe key exists?
