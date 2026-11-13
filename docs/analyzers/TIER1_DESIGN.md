# Tier 1 (decision model): implementation design (draft, 2026-11-13)

Status: **draft for maintainer review**. Design only; no code has changed. This is the build plan
for step 3 of [CASCADE_DESIGN.md](CASCADE_DESIGN.md) ("Build order") and track B step B6 of
[EXTRACTION_STRATEGY.md](../EXTRACTION_STRATEGY.md). It takes §3 of the cascade design (backend
interface, two question stages, bands) and the maintainer's decisions of 2026-10-29 as given, and
fits them to what changed since: production extraction runs through the `codebase_extract` MCP tool
(`cli/src/mcp/tools/codebase-extract.ts`, planned by `cli/src/analyzers/extraction-plan.ts`), and
the gateway decision of 2026-11-09 is that it runs Tier 0, then Tier 1 only if the project opted in,
then the calling agent.

Revisions on the same day: Tier 1 talks to a provider-agnostic `DecisionModel` interface (first
review), and the maintainer's answers to the open questions are folded in as decisions (below), with
the body changed to match. Provider facts are cited in "Sources"; anything not verified is marked so.

## Decisions (maintainer, 2026-11-13)

Answers to the fifteen open questions of the previous revision, and where each one landed in this
document.

1. **Config location: per checkout, `.dr/analyzers/<analyzer>/tier1.json`**, because it holds API
   keys. Section 2 designs it: mode 0600, refused if git tracks it, a `.gitignore` written beside it
   so it is ignored in users' repositories too, environment variables as the alternative to keys in
   the file, and no MCP tool writes it.
2. **Provider `cloudflare-workers-ai`, model `clef`**; the account is whichever one the credentials
   name.
3. **The drop band is retired, and the accept rule gains a type threshold.** The maintainer's first
   wording ("yes, return the drop below 0.5") was read in an earlier revision as keeping the band; the
   maintainer corrected that the intent was to agree with removing it. So there is no "drop under
   50%" rule: the bands are accept, not-element and escalate, and nothing is dropped silently.
4. **Precision targets: measure first.** Section 6 describes the measurement that will set them; no
   numbers are fixed here.
5. **Suggest mode with a one-call `acceptTier1`: yes.** Applying the not-element band is a debug and
   tuning feature, not shown to end users (section 1.3).
6. **Cost: a monthly cap, no per-run cap.** Spend is readable over MCP and REST, and the tooling and
   the viewer show it (section 4.3; viewer work in section 7).
7. **`codebase_index` fills the Tier-1 cache when opted in: yes.** Its time and cost are estimated in
   section 4.4.
8. **B5 (the held-out corpus) is the viewer codebase**, tinkermonkey/documentation_robotics_viewer.
9. **Decision models only for the first pass.** The token-logprob mechanism of the previous revision
   is dropped, with a "later" note in section 3.4.
10. **First targets: Cloudflare Workers AI and OpenRouter** (amended by the maintainer: the earlier
    "Bedrock, with Jev" answer is replaced by Workers AI). Jev is reachable through OpenRouter's
    Decisions API (verified in OpenRouter's catalog, section 3.2); it is not expected on Workers AI.
11. **OpenRouter upstreams are user-configured, with a way to test the configuration**; the
    Decisions API's alpha status is acceptable and is told to users when they configure it
    (sections 2.4 and 3.2).
12. **Thresholds are shared across providers**: DR ships recommended defaults per question set and
    model, not per provider or upstream (section 6).
13. **No separate TypeSafe adapter now**: broad adapters first, which with answer 10 are Workers AI
    and OpenRouter.
14. **Tier-1 decisions show in the changeset viewer**: a provenance field on staged changes
    (section 7), with the viewer change in its own repository.
15. **The AWS SDK dependency and its lazy install are moot**: Bedrock is out of this pass, and the
    two adapters need nothing beyond `fetch`.

## Recommendations in brief

1. **Tier 1 runs inside `codebase_extract`**, between Tier 0 and the agent, on the cards Tier 0
   narrowed or left open, in `dr analyzer classify`, and as the last phase of the `codebase_index`
   job (cache fill). It asks nothing about symbols that already have an element.
2. **Bands: accept, not-element, escalate; nothing is dropped.** Accepted cards are staged like
   Tier-0 decisions (same planner path, so they also get their mapped relationships), with
   provenance on the staged change. **Until a model's thresholds are verified on held-out labels (B5, the viewer codebase),
   Tier 1 runs in _suggest_ mode**: cards carry Tier 1's answer and band, nothing is staged or hidden
   by Tier 1 alone, and the agent takes the accept band in one call (`acceptTier1`).
3. **Tier 1 talks only to a `DecisionModel` interface** (a Jev-style state plus choice, score and
   yes/no questions in; per-option probabilities out). Two adapters, both native decision models:
   `cloudflare-workers-ai` (Clef, Clef-flash) and `openrouter` (the Decisions API, alpha: Clef from
   user-chosen upstreams, Jev from TypeSafe).
4. **Thresholds are per question set and model, shared across providers**, with DR's recommended
   defaults; a model without defaults runs suggest-only with no bands. The harness runs every adapter.
5. **The opt-in is a per-checkout `tier1.json`** that names provider and model and may hold keys,
   guarded against being committed; environment variables work instead of keys in the file; no MCP
   tool writes it. The run notice names every party that received code, for OpenRouter including the
   upstream.
6. **Spend has a monthly cap** kept in a per-checkout ledger and readable through `project_status`,
   a `tier1_status` MCP tool, a REST endpoint on the visualization server, and the viewer.
7. **Every decision is cached** under a key of provider, model, upstream, question set, criteria
   digest, narrowing and the rendered card state; any provider failure leaves the run as Tier 0 only,
   saying so.

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
3. `classifyTier1` (section 3) answers those symbols from the cache, then from the decision model
   within the run's time slice and the month's remaining budget, and attaches a `tier1` decision to
   each `ExtractedSymbol` (a new optional field beside `tier0`).
4. A second `planElements` pass. In _stage_ mode an accept-band decision counts as decided, with
   `rule: "tier1:dr-qset-1"`, so it goes through the same code as a Tier-0 decision: matching by
   decided type and id, naming, `deriveAttributes`, `validateAdds` (an add whose attributes don't
   validate becomes a `needs-attributes` card, as Tier-0 adds do), `elementOf` and therefore
   `planRelationships`. Not-element decisions are counted (`unchanged.tier1NotElement`) and not
   carded. Escalated cards are carded with a `tier1` hint. In
   _suggest_ mode every asked card is carded with its hint.

Staging, the extraction record, paging, `reject` and verify are unchanged apart from the provenance
in section 7.

### 1.2 In `dr analyzer classify` and the index job

The command refuses to run without `--tier0-only` today (`cli/src/commands/analyzer.ts`, the
`classify` action). With Tier 1 it gets:

- no flag: Tier 0, then Tier 1 when the checkout opted in; otherwise Tier 0 with a line saying Tier 1
  is off and why;
- `--tier0-only`: as now, no network whatever the config;
- `--json` / `--output`: the report gains a `tier1` summary (the block in section 2.3) and, per
  result, the decision and band.

It classifies every Tier-0-undecided card (it has no model to match against), so the same code is
the cache fill the `codebase_index` job runs as its last phase (section 4.4). Run output goes under
`.dr/analyzers/<analyzer>/classify/<run-id>/` (`decisions.jsonl`, `summary.json`), following the
current `.dr/analyzers/` layout rather than the `documentation-robotics/.analyzer/` path in §6 of
the cascade design. It never writes a changeset (`--changeset` in decision 3 of 2026-10-29 stays
unbuilt: `codebase_extract` stages).

### 1.3 What the agent receives per band

The bands, per card, for question set `dr-qset-1` (default thresholds for Clef in section 6;
T_layer 0.6, T_type 0.4, T_none 0.6):

| Band        | Rule                                                                                                     | _stage_ mode (held-out verified)                                      | _suggest_ mode (otherwise)              |
| ----------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| accept      | top layer is not `none`, layer p ≥ T_layer, and the chosen type's p ≥ T_type                             | staged as an element, with its mapped relationships; counted, no card | card with the hint, sorted first        |
| not-element | top layer is `none` and its p ≥ T_none                                                                   | not carded; counted                                                   | card with the hint, sorted last         |
| escalate    | everything else (including an accept-level layer with a low type p), and any card Tier 1 couldn't answer | card with the hint (or why it has none)                               | card with the hint (or why it has none) |

A model with no default thresholds has no bands: every card is an escalate card with its hint. A
card Tier 1 is unsure of (a low top-layer probability) escalates; it is never dropped.

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
accept, escalate, then not-element, so the agent reads the easy confirmations together.

**Staging the accept band, with provenance, once held-out verified; suggest until then.** The agent
is the bottleneck (4,071 of 4,769 cards on this repository, about 160 pages of 25); staging through
the planner also gives the accepted elements their edges; and model-decided elements recorded with
their probability make `changeset_verify`'s as-built side less dependent on the agent
(docs/CHANGE_MODELING.md, Known limits). But in-sample thresholds would put roughly one wrong type in
ten into changesets (section 6), so a person, through the agent, says yes first.

**`acceptTier1: true`** on `codebase_extract` is that yes: a normal run with the extraction
changeset's `since` and `layers`, with the accept band staged for that run only. Answers come from
the cache, so it costs nothing and stages exactly what the agent was shown. It is refused for a model
with no thresholds (there is no accept band).

**Debug and tuning only** (decision 5): applying the not-element band, and listing what it hid, is
not in the MCP tool's schema. It is `debug.applyNotElement: true` in `tier1.json`, which makes
`acceptTier1` also record the not-element band as "not an element" decisions and lets
`dr analyzer classify --bands` list every band's cards. End users see counts only.

## 2. The opt-in: `tier1.json`

Decision 1 of 2026-10-29 (opt-in, naming the provider that receives card text, said when it runs,
environment credentials alone not enough) and decision 1 above (per checkout, may hold keys).

### 2.1 The file

`.dr/analyzers/<analyzer>/tier1.json`, beside the analyzer's other per-checkout state
(`cross-repo.json` in `cli/src/analyzers/cross-model.ts` is the same pattern):

```json
{
  "version": 1,
  "provider": "cloudflare-workers-ai",
  "model": "clef",
  "credentials": { "accountId": "…", "apiToken": "…" },
  "monthlyCapUsd": 20,
  "concurrency": 4
}
```

```json
{
  "version": 1,
  "provider": "openrouter",
  "model": "cloudflare/clef",
  "credentials": { "apiKey": "…" },
  "openrouter": {
    "only": ["cloudflare"],
    "allowFallbacks": false,
    "dataCollection": "deny",
    "zdr": false
  },
  "monthlyCapUsd": 20
}
```

- `provider` and `model` are required; there is no default provider. `credentials` is optional
  (section 2.2). `monthlyCapUsd` defaults to 20 (an open question), `concurrency` to 4 (at most 16).
- `openrouter.only` is required: the user names the upstreams allowed to receive card text
  (decision 11); `allowFallbacks` defaults to false and `dataCollection` to `deny`.
- `thresholds` (optional, advanced) overrides the shipped defaults for the configured model;
  `debug` holds the tuning switches of section 1.3.
- An unknown provider or model, a missing `only`, or a wrong type makes Tier 1 `misconfigured`: the
  run is Tier 0 only and says what is wrong.
- Without the file, Tier 1 is off, whatever credentials the environment holds.

### 2.2 Keeping keys safe

Keys may live in the file, so DR checks it every time it reads it, and refuses keys it can't trust:

- **Permissions.** `dr analyzer tier1 enable` creates it with mode 0600 (owner read and write).
  When the file holds credentials and is readable by group or others, Tier 1 refuses to use it
  (`misconfigured`: "tier1.json holds keys and is readable by others: chmod 600 it"). Without
  credentials in it, a looser mode is a warning. Windows has no POSIX mode bits; there the check is
  skipped and the result says so.
- **Not tracked.** `git ls-files --error-unmatch` on the file, from the project root (and from the
  codebase root when it differs): if git tracks it, Tier 1 refuses ("tier1.json is tracked by git:
  `git rm --cached` it, and rotate the keys, which are in the history").
- **Ignored, in users' repositories too.** This repository's `.gitignore` ignores `.dr/`, but `dr init`
  writes no ignore rule into a user's repository (`cli/src/core/project-init.ts`), and the docs
  disagree on whether `.dr/` is committed: `cli/README.md` says it "should be git-ignored", while the
  `.cbmignore` code (`ensureCbmIgnore` in `cli/src/analyzers/cbm-analyzer.ts`) and
  docs/CHANGE_MODELING.md say DR's folders are committed. So DR doesn't rely on the root
  `.gitignore`: whenever it writes `tier1.json` it also writes `.dr/analyzers/<analyzer>/.gitignore`
  listing `tier1.json`, `tier1-cache/` and `tier1-spend.jsonl`, and confirms with `git check-ignore`.
  If the file still isn't ignored (a negation elsewhere), it refuses as above. The doc disagreement
  about `.dr/` is worth settling separately.
- **Written by a person, not an agent.** `dr analyzer tier1 enable --provider <name> --model <id>`
  (and `disable`, which deletes the file) prompts for keys without echoing them, or records that the
  environment supplies them. No MCP tool writes, reads back or returns `tier1.json` or any key;
  `project_status` and `tier1_status` report only its state.

### 2.3 Credentials

In order: the keys in `tier1.json`; else the environment. For `cloudflare-workers-ai`,
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with Workers AI permission), the names
the harness already uses (`cli/scripts/classify-eval/README.md`); for `openrouter`,
`OPENROUTER_API_KEY`. The CLI does not read `.env` files and should not start (the harness keeps its
own `loadDotEnv` and passes keys to the adapter). The `dr mcp` server the plugin starts
(`integrations/claude_code/.claude-plugin/plugin.json`) inherits Claude Code's environment, so both
sources reach it. Keys are never logged or returned; the notice shows only the Cloudflare account
id's last four characters.

### 2.4 What the tool says, and testing a configuration

`codebase_extract` replaces its `tier1` string with a block (illustrative values):

```json
"tier1": {
  "state": "on",
  "provider": "openrouter",
  "model": "cloudflare/clef",
  "routing": { "only": ["cloudflare"], "allowFallbacks": false, "dataCollection": "deny" },
  "servedBy": { "Cloudflare": 412 },
  "qset": "dr-qset-1",
  "mode": "suggest",
  "thresholds": { "layer": 0.6, "type": 0.4, "none": 0.6, "source": "default", "fit": "in-sample" },
  "cards": 4071,
  "cached": 3659,
  "sent": 412,
  "failed": 0,
  "skipped": 0,
  "bands": { "accept": 903, "notElement": 610, "escalate": 2558 },
  "staged": 0,
  "costUsd": 0.47,
  "month": { "spentUsd": 6.12, "capUsd": 20, "resetsAt": "2026-12-01T00:00:00Z" },
  "durationMs": 61234,
  "notice": "Sent 412 cards (symbol, signature, docstring, callers, callees, imports and up to 40 source lines each) to OpenRouter, which forwarded them to Cloudflare (412), because .dr/analyzers/cbm/tier1.json enables Tier 1. OpenRouter's Decisions API is in alpha and may change."
}
```

The notice names every party that received card text: "Cloudflare Workers AI
(`@cf/cloudflare/clef`, account …3f9a)", or "OpenRouter, which forwarded them to <upstream> (<count>)"
per upstream the responses named (the Decisions API returns `provider`). For OpenRouter it always
carries the alpha sentence (decision 11).

`state` is one of `off` (no `tier1.json`; when provider credentials are in the environment it adds
that they are set and unused), `misconfigured`, `no-credentials`, `on`, `unavailable` (the provider
failed; how far it got and why), `capped` (the month's cap is reached; section 4.3) and `warming`
(the cache fill is running; section 4.4). `dr analyzer classify` prints the same notice to stderr
before the first request and the summary after; `project_status` shows the state and the month's
spend in one line.

**Testing a configuration** (decision 11): `dr analyzer tier1 test` and the MCP tool
`tier1_status` with `probe: true` send a probe, a fixed synthetic card shipped with DR (no project
code), through the configured adapter. For OpenRouter they send one probe per upstream in `only`,
pinned to that upstream, so a user can compare them. They report per probe the upstream that served,
the model the response named, latency, the layer probabilities and cost, and flag an upstream that
failed, answered a different model, or (for Clef) differs from the expected probabilities by more
than a tolerance. `enable` runs the test once and prints the alpha notice for OpenRouter. The probes'
cost goes into the ledger.

## 3. The decision-model layer and the module layout

Decision 2 of 2026-10-29: the question set lives in code with a version id. Everything DR-specific
(question set, criteria, state rendering, bands, cache, run loop, spend) is provider-independent and
talks to a `DecisionModel`; providers are adapters behind it.

### 3.1 The interface

The request is the Jev shape the harness already sends to Clef (`backends/clef.ts`); the adapter
normalises the response, so the run loop never sees a provider's wire format.

```ts
export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

export type Answer =
  | { type: "choice"; probabilities: Record<string, number> } // over the criteria keys
  | { type: "score"; distribution: number[] } // over the levels
  | { type: "noul"; probability: number } // P(yes)
  | { type: "refusal" };

export interface DecisionModel {
  readonly id: {
    provider: string; // "cloudflare-workers-ai" | "openrouter"
    model: string; // provider model id: "@cf/cloudflare/clef", "cloudflare/clef", "typesafe/jev-1.14"
    canonicalModel: string; // what thresholds key on: "clef", "clef-flash", "jev-1.14"
    upstream?: string; // OpenRouter: the pinned upstream, when exactly one is allowed
  };
  readonly pricing: { inputPerM: number };
  ask(
    state: string,
    questions: Record<string, Question>,
    options: { signal: AbortSignal; upstream?: string } // upstream: pin one request (probes)
  ): Promise<{
    answers: Record<string, Answer>;
    usage: { inputTokens: number; costUsd?: number };
    servedBy: { upstream?: string; model?: string };
  }>;
}

export class DecisionModelError extends Error {
  kind:
    | "auth"
    | "rate-limit"
    | "unavailable"
    | "bad-request"
    | "timeout"
    | "malformed"
    | "routing";
  status?: number;
  retryAfterMs?: number;
}
```

The run loop keeps the two stages (layer, significance and concerns; then type within the layer).

### 3.2 Providers

Both adapters are native decision models: the probabilities come from the model, not from token
log probabilities.

- **`cloudflare-workers-ai`** (`adapters/cloudflare-workers-ai.ts`): Clef (`@cf/cloudflare/clef`) and
  Clef-flash on Workers AI. Clef's probabilities come from a trained head over a Qwen3.8-27B
  backbone, "one logit per option ... a softmax per question", in one pass with no generation (model
  card). The adapter is the harness's `callClef` and its parsers (`choiceOf`, `noulOf`, `scoreOf`),
  ported as is. Jev is not expected on Workers AI: its weights are proprietary per third-party
  coverage, and the Workers AI catalog was not checked for it.
- **`openrouter`** (`adapters/openrouter.ts`): the Decisions API, `POST /api/alpha/decisions`
  ("Alpha: the shape may change"). It takes `model`, `state` and `questions` (`noul`, `choice`,
  `score`), accepts the routing object (`only`, `allow_fallbacks`, `data_collection`, `zdr`,
  `quantizations`), and returns per-option `probabilities`, the `provider` that served and
  `usage.cost`. OpenRouter's decision catalog (`GET /api/v1/models?output_modalities=decisions`,
  read 2026-11-13) lists, among about forty decision models:
  - `cloudflare/clef` from Cloudflare and PrimeIntellect ($0.24 per million input tokens) and
    DeepInfra (fp8, $0.192), and `cloudflare/clef-flash` from the same three;
  - **Jev**: `typesafe/jev-1.13`, `typesafe/jev-1.14` and the alias `~typesafe/jev-latest`, served by
    TypeSafe, $0.042 per million input tokens, 262,144-token context. So Jev is reachable through
    this adapter, and decision 13's "no separate TypeSafe adapter" costs nothing.

  The adapter sends `provider: { only, allow_fallbacks: false, data_collection: "deny", zdr? }` from
  `tier1.json`, records the response's `provider` per card for the notice and provenance, and stops
  with `routing` if an upstream outside `only` ever answers. Because the API is alpha, the response
  fields it reads are pinned in a schema; a change makes Tier 1 `unavailable` with a clear reason,
  never a crash or a silent misread. The catalog advises pinning a versioned id rather than an alias,
  so `enable` warns on `~typesafe/jev-latest`.

The upstream matters for answers even though thresholds are shared (decision 12): DeepInfra serves
Clef at fp8, which may move probabilities. The cache keys on the upstream (section 4.1), the probe
shows differences (section 2.4), and the harness can measure an upstream when a user asks why
results differ.

### 3.3 Module layout: `cli/src/analyzers/classifier/`

```text
cli/src/analyzers/classifier/
  index.ts                 public API: resolveTier1, classifyTier1, probeTier1, bandOf, types
  types.ts                 Tier1Decision, Tier1Hint, Band, Tier1Summary, ChangeOrigin
  config.ts                tier1.json: read, validate, permission / tracked / ignored checks, credentials
  decision-model/          provider-agnostic decision-model layer
    types.ts               DecisionModel, Question, Answer, DecisionModelError
    registry.ts            provider -> adapter factory; model ids -> canonical model, price
    jev-answers.ts         normalising Jev-shaped answers (from the harness's choiceOf, noulOf, scoreOf)
    probe.ts               the synthetic probe card and its expected Clef answers
    adapters/
      cloudflare-workers-ai.ts   Clef, Clef-flash
      openrouter.ts              Decisions API: Clef (any upstream), Jev, other decision models
  qset/
    v1.ts                  QSET_ID "dr-qset-1": stage-1 and stage-2 questions, KIND_CANDIDATES, concerns, significance
    index.ts               the current qset, and older ids for the harness
  criteria.ts              layer and type criteria from the bundled spec (from lib/spec.ts), criteriaDigest()
  state.ts                 renderState(card, options) (from lib/state.ts), 40 source lines
  bands.ts                 DEFAULT_THRESHOLDS per (qset, canonical model); bandOf(), modeOf()
  cache.ts                 Tier1Cache (section 4.1)
  spend.ts                 the ledger, monthly window and cap (section 4.3)
  run.ts                   classifyTier1(): cache, budget, pool, deadline, retries, circuit breaker
```

Nothing outside `decision-model/` imports an adapter; `run.ts` gets a `DecisionModel` from
`registry.ts`, and tests pass a fake. Both adapters use `fetch` only: no new dependency.

**Question set `dr-qset-1`** is exactly the harness configuration the current numbers measure,
`clef@cbm012-kind-tier0` (`classify.ts --kind-narrow --tier0`, full criteria, no facts, no charter):

- stage 1: `layer` (choice over the 13 layers and `none`, restricted to Tier 0's layers when it
  narrowed), `significance` (score, 5 levels), six `concern_*` yes/no questions;
- stage 2, when the layer is not `none` and at least two options remain: `element_type` (choice
  within the layer and `none`), restricted by Tier 0's narrowing, else by `KIND_CANDIDATES` (the kind
  rule, still harness code; moving it into the rule file is a later question-set change);
- the state is `renderState(card, 40)`.

`QSET_ID` changes when anything in `qset/` or `state.ts` changes. A unit test pins a digest of the
question builders' output for fixture cards to the id, so an edit that forgets the bump fails. The
spec criteria and the Tier-0 narrowing are inputs, not part of the id: they enter the cache key and
are recorded per decision.

**Criteria** come from the CLI's bundled spec through `cli/src/core/spec-loader.ts` (the
`cli/src/schemas/bundled/` files), not from `spec/dist` at the repository root as `lib/spec.ts` does,
since an installed CLI has no repository. The builder keeps the harness's checks (a placeholder
layer description is an error) and exports `criteriaDigest()`.

### 3.4 Considered and left for later

- **Generic LLMs through token log probabilities** (decision 9): one single-token question per
  request with `logprobs`/`top_logprobs`, renormalised over the options. Dropped for the first pass:
  RLHF-tuned models' token probabilities are overconfident (Tian et al. 2023), `top_logprobs` stops
  at 20 while the `security`, `api` and `ux` type questions have 22-29 options, and our own Phase 0
  found no clean accept band in an LLM's confidence. The interface leaves room for it.
- **Amazon Bedrock**: no decision model was found in Bedrock's catalog, and Custom Model Import can't
  take Clef (only listed architectures, for Qwen3 only `Qwen3ForCausalLM`/`Qwen3MoeForCausalLM`, on
  transformers 4.51.3; Clef needs its custom head and transformers 5.10.2), so the only route would
  have been token log probabilities from an imported model. Dropped with the item above.

## 4. Caching, determinism, spend and failures

### 4.1 Cache

- **Key**: SHA-256 of provider, model, upstream, qset id, criteria digest, narrowing and
  `sha256(rendered state)`, where narrowing is the sorted candidate list from Tier 0 or the kind rule
  and upstream is the pinned one (OpenRouter with one `only` entry) or `any`. The rendered state is
  the "card content hash": a pure function of the card (§1 of the cascade design) and exactly what the
  provider sees.
- **Value**: the whole card's decision (both stages), with the normalised answers, the upstream and
  model the response named, usage, cost and time. Bands are computed at use, never cached.
- **Where**: `.dr/analyzers/<analyzer>/tier1-cache/<qset>/<provider>/<model slug>.jsonl`,
  append-only, last line for a key wins, appended under a short lock of its own (not the extraction
  run lock). About 1 KB a decision, about 5 MB for this repository.
  `dr analyzer classify --prune-cache` keeps only the keys the latest run used.
- Per checkout (ignored by the `.gitignore` of section 2.2); a new clone pays once.

### 4.2 Determinism

Clef has answered deterministically in the harness (the 0.12.1 re-measurement relies on it,
EXTRACTION_STRATEGY.md). With the cache, a rerun at the same commit gives the same decisions byte for
byte whatever the concurrency. Hosted model ids are not versioned on Workers AI, so a provider-side
update would change answers for new cards only; adapters record the model the response names, and
the harness's rerun on the committed corpora (expected: 0 lost, 0 gained in `compare.ts`) is the
drift check before each release that touches Tier 1. On OpenRouter, pin versioned ids
(`typesafe/jev-1.14`, not `~typesafe/jev-latest`).

### 4.3 Spend: the monthly cap, the ledger, MCP and REST

Decision 6: a monthly cap, no per-run cap, and spend visible to tools and the viewer.

- **Ledger**: `.dr/analyzers/<analyzer>/tier1-spend.jsonl`, one line per batch of requests with
  `at`, `source` (`extract`, `index`, `classify` or `probe`), `provider`, `model`, `upstream`,
  `cards`, `inputTokens` and `costUsd`. Cost is the response's own (`usage.cost` on OpenRouter) when given, else
  tokens times the adapter's price (Clef on Workers AI: $0.24 per million input tokens, the
  harness's figure).
- **Window**: the calendar month in UTC; the month's total is summed on read.
- **Cap**: `monthlyCapUsd` in `tier1.json`. Before asking, a run estimates its misses' cost from the
  mean cost of cached decisions for this provider and model (the harness's $0.0011-0.0017 a card for
  Clef until there are any) and asks, in card order (changed in range first), only what the month's
  remainder covers. At the cap Tier 1 sends nothing more; cached answers are still used, the rest
  escalate, and `state` is `capped` with the spend, the cap and when it resets. Raising the cap is an
  edit to `tier1.json`.
- **Scope**: the ledger is per checkout, so it can't see spend from other clones or machines on the
  same account; the docs say so, and suggest a provider-side spending limit where the provider offers
  one (not researched here).
- **MCP**: `project_status` gains a `tier1` field with `state`, `provider`, `model` and `month`
  (`spentUsd`, `capUsd`, `remainingUsd`, `resetsAt`, `cards`); `codebase_extract`'s `tier1` block carries `month`; a new
  read-only tool `tier1_status` returns the same plus the last runs, and with `probe: true` runs the
  configuration test of section 2.4. Neither returns keys.
- **REST**: `GET /api/tier1` on the visualization server (`cli/src/server/server.ts`, a
  `createRoute` route like `/api/changesets`, tag `Extraction`, bearer auth like the others), with the
  `tier1_status` body, its schema in `cli/src/server/schemas.ts` and the generated
  `docs/api-spec.yaml`. The viewer reads it (section 7).

### 4.4 The cache fill in the `codebase_index` job (decision 7)

When opted in, the index child (`cli/src/analyzers/index-job.ts`) runs `dr analyzer classify`'s Tier-1
pass as a last phase, `classifying`, after indexing. The index counts as fresh when indexing ends, so
extraction isn't blocked; a `codebase_extract` that finds the fill running and has more misses than
its 100 s budget allows returns `warming` (stage nothing, poll `project_status`, or pass
`tier1: false` to go on with Tier 0 only). The fill uses the month's budget like any run.

**Estimated cost and time** (Clef on Workers AI, at the measured $0.0011 a card and a median 739 ms
for both stages, dr-cli in `data/dr-cli/report.md`; 4 cards in flight):

| Reindex                                    | Cards built for the changed files | Tier-1 misses (≈85% of them) | Cache hits | Cost  | Added time |
| ------------------------------------------ | --------------------------------- | ---------------------------- | ---------- | ----- | ---------- |
| First fill, this repository                | 4,769                             | 4,071                        | 0%         | $4.50 | ~12.5 min  |
| A small range (16-18 files, e.g. `HEAD~2`) | 236-238                           | ~200                         | ~95%       | $0.22 | ~37 s      |
| A medium range (39 files, `2c30d582`)      | 469                               | ~400                         | ~90%       | $0.44 | ~74 s      |
| A large range (136 files, `6f350bb5`)      | 1,379                             | ~1,170                       | ~71%       | $1.29 | ~3.6 min   |

How the rows are derived: the card counts are the `since` measurements in EXTRACTION_STRATEGY.md
("`detect_changes` for `since` runs"); 85% is this repository's share of cards that reach the agent
(4,071 of 4,769). Every card in a changed file is counted as a miss, because the rendered state
carries the symbol's line numbers, which shift below any edit; cards in other files whose callers or
callees lists changed are extra misses, not measured, so the rows are lower bounds. What it means:

- **Time**: the first fill roughly adds 12.5 minutes to that index run; later reindexes add seconds
  to a few minutes. CBM's own indexing time isn't recorded in the docs, so the ratio isn't known.
- **Cost**: about $4.50 once, then about $0.20-1.30 a reindex. With a $20 monthly cap, that is the
  first fill plus about 70 small reindexes a month on this repository; an agent that reindexes after
  every commit on a busy repository would reach the cap, which then stops Tier 1 for the month.
- **Cheaper later**: dropping line numbers from the rendered state would turn most "shifted" cards
  into hits, but it changes `dr-qset-1` and has to be measured (open question).

### 4.5 Concurrency, rate limits, timeouts

A Jev-shaped request takes one state and a stage's questions; cards run in a pool of `concurrency`
(default 4, the harness's default). Provider rate limits for these models were not established; the
first live run of each adapter measures them. 429 and 5xx are retried with backoff (the harness:
four attempts, 1, 2, 4, 8 s), honouring `Retry-After`, and a 429 halves the pool for the rest of the
run. 20 s a request (`AbortSignal.timeout`), and inside `codebase_extract` what is left of the 100 s
budget (`DEFAULT_BUDGET_MS`) minus a reserve for planning and staging.

### 4.6 Failures

Tier 1 never fails the run and never stages half a card.

| Condition                                                | Behaviour                                                 | `tier1.state`              |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------------------- |
| No `tier1.json`                                          | Tier 0 only                                               | `off`                      |
| Invalid file, keys readable by others, or tracked by git | Tier 0 only, the reason quoted                            | `misconfigured`            |
| No credentials                                           | Tier 0 only, the variables looked for                     | `no-credentials`           |
| Monthly cap reached                                      | cached answers used, the rest escalate                    | `capped`                   |
| 401 or 403                                               | stop at the first; the rest escalate                      | `unavailable` (`auth`)     |
| 5 cards in a row failing after retries, or 5xx           | circuit breaker: stop; answers so far are kept and cached | `unavailable` (`provider`) |
| OpenRouter served an upstream outside `only`             | stop; the run says which upstream answered                | `unavailable` (`routing`)  |
| The alpha Decisions API changed shape                    | stop; the fields that didn't match                        | `unavailable` (`api`)      |
| A malformed or refused answer for one card               | that card escalates, `failed` counts it                   | `on`                       |
| Deadline reached                                         | the rest escalate with `skipped`                          | `on` (or `warming`)        |

## 5. The harness keeps measuring production code

As with cards (`cli/scripts/classify-eval/lib/tier0.ts` imports `src/analyzers/cards/`):

- `classify.ts --backend` takes any registered adapter: `cloudflare:clef`, `cloudflare:clef-flash`
  (with today's `clef` and `clef-flash` kept as aliases, so committed `pred-clef*.jsonl` names stay
  valid) and `openrouter:<model>@<upstream>` (one pinned upstream). The Claude backends stay
  harness-only (Tier 2 baselines). Keys come from the harness's `.env` (`OPENROUTER_API_KEY` beside
  the Cloudflare pair).
- `backends/clef.ts` becomes a thin adapter over the CLI's registry; the harness's `Prediction`
  gains `provider` and `upstream`, so `report.ts` and `compare.ts` keep runs from different adapters
  apart.
- `lib/spec.ts` and `lib/state.ts` re-export the CLI's `criteria.ts` and `state.ts`. The experiment
  flags (`--criteria core`, `--charter`, `--facts`) become builder options that produce variant ids
  (`dr-qset-1+core`).
- `report.ts` gains the band report with the CLI's `bandOf`, and the sweeps of section 6. A new
  `fit-thresholds.ts --backend <id>` prints proposed default thresholds for a (question set, model)
  with its fit record; the maintainer commits them to `bands.ts`.
- **Acceptance for the port**: `classify.ts --dry-run` request JSON byte-identical before and after
  (a CLI fixture test), and a dr-cli rerun with `--backend cloudflare:clef --kind-narrow --tier0`
  giving 0 lost and 0 gained against `clef@cbm012-kind-tier0` in `compare.ts` (about $0.33).
- **For OpenRouter**: runs of `cloudflare/clef` pinned to Cloudflare (expected identical to Workers
  AI) and to DeepInfra (fp8), and of `typesafe/jev-1.14`, so defaults for Jev can be proposed.

## 6. Calibration

Thresholds key on question set and canonical model (`clef`, `clef-flash`, `jev-1.14`), shared by every
provider and upstream that serves that model (decision 12). DR ships recommended defaults in
`bands.ts`; `tier1.json` may override them. A model with no defaults runs suggest-only with no bands
until the harness has measured it.

**Defaults for `dr-qset-1` and Clef**: T_layer 0.6, T_type 0.4, T_none 0.6, in-sample.
From the committed predictions `pred-clef@cbm012-kind-tier0.jsonl` against `gold.jsonl`, model-asked
cards only (computed for this document; `report.ts` doesn't produce these yet):

| Corpus    | Asked | Layer ≥ 0.6: cards, layer / type precision | + type ≥ 0.4: cards, type precision | `none` ≥ 0.6: cards, precision |
| --------- | ----- | ------------------------------------------ | ----------------------------------- | ------------------------------ |
| dr-cli    | 300   | 91 (30%), 97.8% / 85.7%                    | 65 (22%), 92.3%                     | 46 (15%), 97.8%                |
| fastapi   | 148   | 55 (37%), 92.7% / 80.0%                    | 43 (29%), 88.4%                     | 21 (14%), 90.5%                |
| petclinic | 73    | 2 (3%), 100% / 100%                        | 2 (3%), 100%                        | 36 (49%), 100%                 |

What it says:

- **The type threshold earns its place** (decision 3): a layer threshold alone accepts one card in
  six or seven with the wrong type; T_type 0.4 lifts type precision 6 to 8 points. Pooled, (0.6, 0.4)
  accepts 110 cards at 90.9% type precision, Wilson 95% lower bound about 84%. The mean type
  probability on layer-correct asked cards is 0.48-0.53, so §3's "type-level threshold not usable"
  (0.12-0.23) no longer holds.
- **The not-element band is precise**: 14-49% of asked cards at 90-100%.
- **Why there is no drop band** (decision 3): 23% of asked cards have a top layer probability below
  0.5, and dropping them unseen would have hidden about 12% of asked cards that gold calls elements
  (60 of 521, after a concern-flag rescue), so they escalate.

**The measurement that will set precision targets** (decision 4), run by `report.ts` per
(question set, model) on the three corpora and then B5:

1. For each band, a precision and coverage curve over its threshold (accept: a grid of T_layer
   0.5-0.8 by T_type 0-0.6; not-element: T_none),
   with Wilson intervals, pooled and per corpus.
2. Beside each point, what it means for the agent: cards removed from its list, wrong elements
   staged (accept), real elements hidden (not-element), per 1,000 asked cards.
3. The maintainer picks the targets from those curves; `fit-thresholds.ts` then picks the thresholds
   that meet them with the most coverage, and records corpora, card counts, spec version, date and
   `fit`.

**B5 is the viewer codebase** (decision 8): tinkermonkey/documentation_robotics_viewer, labelled with
`label.ts` and not read while writing rules or question sets. Before it, everything ships in suggest
mode with the in-sample defaults, labelled in-sample in every result. After it, a model's defaults
count as `held-out` when the viewer corpus, scored with them, meets the targets within its interval;
`modeOf` then returns `stage` for that model, and Tier 1 stages and hides without the agent. B5 also
checks Tier 0's rules, whose narrowing Tier 1 builds on (Phase 2 results).

## 7. Provenance and spend in the changeset viewer

Decision 14: Tier-1 decisions show in the changeset viewer.

- **Staged changes gain `origin`** (`Change` in `cli/src/core/changeset.ts`), optional, so existing
  changesets read as before:

  ```ts
  origin?: {
    by: "tier0" | "tier1" | "agent";
    rule?: string; // Tier 0: the rule; Tier 1: "tier1:dr-qset-1"
    provider?: string; // Tier 1
    model?: string; // Tier 1, as the response named it
    upstream?: string; // Tier 1 through OpenRouter
    p?: { layer: number; type: number | null }; // Tier 1
    confirmed?: "auto" | "agent"; // Tier 1: stage mode, or acceptTier1
  };
  ```

  `codebase_extract` sets it on the adds and relationship-adds it stages (relationships inherit the
  origin of the decision that created their end). It lives in the changeset's `changes.yaml`, never
  in the model: it sits beside `after`, not in it, so landing the changeset never writes it to an
  element, and no spec change is needed.
  It contains no secret. `compactChange` keeps it in unstage tombstones. The extraction record's
  `StagedBySymbol` keeps the same fields for verify and `reject`.

- **REST**: `ChangesetDetailSchema` (`cli/src/server/schemas.ts`) gains `origin` on each change, and
  `GET /api/tier1` serves the spend (section 4.3).
- **Viewer** (a separate change in tinkermonkey/documentation_robotics_viewer): a badge on each
  staged change showing who decided it, with model and probabilities on hover, a filter by origin,
  and a Tier-1 panel with state, provider, model and the month's spend against the cap from
  `GET /api/tier1`.

## 8. Test plan

No network in CI. Adapters take an injected `fetch`, and the test setup's default throws, so a
request that slips through fails loudly.

**Unit** (`cli/tests/unit/analyzers/classifier/`), with a `FakeDecisionModel`
(`cli/tests/helpers/fake-decision-model.ts`: scripted answers by state hash and question, call log,
injectable 429, 5xx, timeout, auth, malformed and routing responses):

- `qset`, `criteria`: request JSON equals fixtures from the harness's `--dry-run`; the digest pin;
  narrowing; `none` present; placeholder descriptions refused.
- `cloudflare-workers-ai`: URL, headers and body; wrapped and unwrapped responses; retries on 429
  and 5xx with `Retry-After`; no retry on 400, 401, 403; timeout; the token never in an error.
- `openrouter`: the routing object always carries `only`, `allow_fallbacks: false` and
  `data_collection: "deny"`; `provider` read into `servedBy`; an upstream outside `only` stops the
  run; a changed response shape is `unavailable` (`api`); `refusal` answers escalate; probes pin one
  upstream each.
- `config`: off with every provider's environment set and no file (no request made); keys refused
  at mode 0644 and accepted at 0600; refused when `git ls-files` tracks the file; the nested
  `.gitignore` written and `git check-ignore` confirming it, in a temporary repository whose root
  `.gitignore` doesn't mention `.dr/`; `misconfigured` for an unknown provider or missing `only`.
- `bands`: the three bands, and a low-confidence card escalating, never dropped; defaults by
  canonical model, so Clef on Workers AI and on OpenRouter get the same; no defaults means no bands; overrides from the file.
- `cache`: the key changes with provider, model, upstream, state, question set, criteria and
  narrowing; a truncated last line is skipped; two writers don't corrupt it.
- `spend`: monthly window at a month boundary (UTC); the cap stops asking and serves the cache;
  estimate-limited asking; probes counted.
- `run`: deadline; circuit breaker; provider down means every card escalates and `unavailable`;
  concurrency halves on 429; the notice names every upstream.
- `extraction-plan`: an accept-band decision in stage mode becomes an add with `rule: "tier1:..."`,
  its relationships and `origin`; suggest mode cards it; the not-element band is counted, not
  carded, in stage mode; a changed answer on a modelled symbol never produces `retyped`.

**Integration** (`cli/tests/integration/`, golden-copy project, the fake model through
`CodebaseToolDeps`): `codebase_extract` off by default; opted in, the notice, hints, ordering,
`acceptTier1` staging with `origin`, a rerun answered from the cache; provider failing; `capped`;
`warming`; `tier1_status` (with a probe) and `project_status` showing spend and never keys;
`GET /api/tier1` and `origin` in `GET /api/changesets/:id`; `dr analyzer classify` without opt-in.

**Live, manual**: the port's acceptance rerun, each OpenRouter harness run, and a first opted-in
bootstrap of this repository per adapter recording time, cost, throttling and the upstreams that
served.

## 9. Rollout, as small PRs

1. **Decision-model interface and the Workers AI adapter, no behaviour change.** `decision-model/`
   with the interface, registry and `cloudflare-workers-ai` adapter; `qset/`, criteria, state, bands
   and cache; unit tests with the fake; the harness switched to import it; the parity fixture and the
   dr-cli rerun as acceptance.
2. **Default thresholds and the measurement.** `report.ts` band report and curves (section 6),
   `fit-thresholds.ts`, Clef's in-sample defaults in `bands.ts`.
3. **Opt-in and spend.** `tier1.json` with its permission, tracked and ignored checks,
   `dr analyzer tier1 enable|disable|test`, the probe, the run loop, the spend ledger and monthly cap,
   `dr analyzer classify` with Tier 1. Docs: the opt-in in `cli/README.md`.
4. **`codebase_extract` in suggest mode, with provenance.** Two-pass planning, hints, ordering, the
   `tier1` block, `tier1: false`, `acceptTier1`, `origin` on staged changes and in the extraction
   record, the debug option, `tier1_status` and the `project_status` field. docs/CHANGE_MODELING.md
   updated (cascade step 2, Known limits).
5. **REST, then the viewer.** `GET /api/tier1`, `origin` in the changeset schema, `docs/api-spec.yaml`;
   then the viewer PR in tinkermonkey/documentation_robotics_viewer (badge, filter, spend panel).
6. **OpenRouter adapter, with harness measurements.** The Decisions API adapter, routing options, the
   per-upstream probe and the alpha notice; harness runs of Clef through Cloudflare and DeepInfra and
   of Jev 1.14, and proposed Jev defaults if the curves support them.
7. **Cache fill in the index job.** The `classifying` phase, `warming`, `project_status`.
8. **B5 on the viewer codebase, then stage mode.** Label the viewer corpus, score each model's
   defaults, mark those that pass `held-out`, update the docs and the strategy doc's track B.

## 10. Open questions for the maintainer

1. **Default monthly cap**: is $20 a sensible default (the first fill on this repository is about
   $4.50, then about $0.20-1.30 a reindex)?
2. **Line numbers in the rendered state**: worth a `dr-qset-2` without them, to raise the reindex
   cache-hit rate, measured against `dr-qset-1` first?
3. **`.dr/` in users' repositories**: `cli/README.md` says ignore it, the `.cbmignore` code and
   docs/CHANGE_MODELING.md say it is committed. The nested `.gitignore` protects `tier1.json` either
   way; which statement should the docs keep?

## Sources

Checked on 2026-11-13 unless marked otherwise.

- Clef model card (architecture, head, serving, request shape): <https://huggingface.co/Cloudflare/Clef>
- Clef-flash model card: <https://huggingface.co/cloudflare/clef-flash>
- Cloudflare, "Introducing Clef" (listed in EXTRACTION_STRATEGY.md's sources): <https://blog.cloudflare.com/clef-decision-models>
- OpenRouter Decisions API reference (`POST /api/alpha/decisions`, routing object, `provider` and `usage.cost` in the response): <https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md>
- OpenRouter decision-model catalog (Jev 1.13 and 1.14 from TypeSafe; Clef; prices; context): <https://openrouter.ai/api/v1/models?output_modalities=decisions>
- OpenRouter endpoints per model (upstreams, fp8 on DeepInfra): <https://openrouter.ai/api/v1/models/cloudflare/clef/endpoints>, <https://openrouter.ai/api/v1/models/typesafe/jev-1.14/endpoints>
- OpenRouter decisions skill (catalog query, pin versioned ids): <https://openrouter.ai/skills/openrouter-decisions>
- OpenRouter provider selection (`only`, `allow_fallbacks`, `data_collection`, `zdr`): <https://openrouter.ai/docs/guides/routing/provider-selection.md>
- Section 3.4 only: OpenRouter parameters (`top_logprobs` 0-20): <https://openrouter.ai/docs/api/reference/parameters.md>; Amazon Bedrock Custom Model Import (architectures, transformers 4.51.3): <https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html>; Tian et al., "Just Ask for Calibration": <https://arxiv.org/abs/2305.14975>
- In-house: EXTRACTION_STRATEGY.md, "Phase 0 results", "Re-measured on CBM 0.12.1" and "`detect_changes` for `since` runs".
