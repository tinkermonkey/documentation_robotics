# Tier 1 (decision model): implementation design (draft, 2026-11-13)

Status: **draft for maintainer review**. Design only; no code has changed. This is the build plan
for step 3 of [CASCADE_DESIGN.md](CASCADE_DESIGN.md) ("Build order") and track B step B6 of
[EXTRACTION_STRATEGY.md](../EXTRACTION_STRATEGY.md). It takes §3 of the cascade design (backend
interface, two question stages, bands) and the maintainer's decisions of 2026-10-29 as given, and
fits them to what changed since: production extraction runs through the `codebase_extract` MCP tool
(`cli/src/mcp/tools/codebase-extract.ts`, planned by `cli/src/analyzers/extraction-plan.ts`), and
the gateway decision of 2026-11-09 is that it runs Tier 0, then Tier 1 only if the project opted in,
then the calling agent.

Revised the same day after maintainer review: Tier 1 talks to a provider-agnostic `DecisionModel`
interface, with adapters for Cloudflare Workers AI, OpenRouter and Amazon Bedrock (section 3).
Provider facts are researched and cited (section 3.2, "Sources" at the end); anything not verified
is marked so.

## Recommendations in brief

1. **Tier 1 runs inside `codebase_extract`**, between Tier 0 and the agent, on the cards Tier 0
   narrowed or left open, and in `dr analyzer classify`. It asks nothing about symbols that already
   have an element.
2. **Accepted cards are staged like Tier-0 decisions** (same planner path, so they also get their
   mapped relationships), with the tier, question set, provider, model and probabilities recorded in
   the extraction record, not in the model. **Until a (question set, provider, model) has thresholds
   verified on held-out labels (B5), Tier 1 runs in _suggest_ mode** for it: every card carries
   Tier 1's answer and band, nothing is staged or hidden by Tier 1 alone, and the agent can take the
   accept band in one call (`acceptTier1`).
3. **Tier 1 talks only to a `DecisionModel` interface**: a Jev-style request (a state plus named
   choice, score and yes/no questions) in, per-option probabilities out. Providers are adapters behind
   it. The question set, criteria, bands, cache and run loop don't know which provider answered.
4. **Three adapters, each with the probability mechanism its provider actually offers**:
   - `cloudflare-workers-ai`: Clef and Clef-flash, native decision-model probabilities (today's
     harness client);
   - `openrouter`: OpenRouter's Decisions API (alpha), which serves Clef (and, by third-party
     reports, Jev) with native probabilities and returns the upstream provider; pinned to one
     upstream. A chat-completions token-logprob mode is a measured option, not the default;
   - `amazon-bedrock`: Bedrock has no decision model and can't import Clef, so the adapter reads token
     logprobs from a Custom Model Import model through `InvokeModel`. Converse and Bedrock's own
     foundation models return no logprobs, and that path is unsupported.
5. **Calibration is per (question set, provider, model)**, and per upstream for OpenRouter. Clef's
   thresholds don't carry over; a combination with no fitted thresholds runs suggest-only with no
   bands. The harness runs every adapter (`classify.ts --backend`), so each is measured against gold.
6. **The opt-in is a committed block in `documentation-robotics/model/manifest.yaml`**
   (`extraction.tier1`: `provider`, `model` and provider options such as Bedrock's region or
   OpenRouter's routing). Credentials stay out of it: Cloudflare and OpenRouter from the environment
   or `~/.dr-config.yaml`, Bedrock from the AWS credential chain. The run notice names where code
   went, for OpenRouter including the upstream that served it.
7. **Every decision is cached** under a key of provider, model, upstream, question set, criteria
   digest, narrowing and the rendered card state; a per-run cost cap, a concurrency pool, timeouts
   and a circuit breaker bound a run, and any provider failure leaves the run as Tier 0 only, saying
   so.
8. **The three-band rule changes**: accept, reject (`none` above its threshold) and escalate.
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
3. `classifyTier1` (section 3) answers those symbols from the cache, then from the decision model
   within the run's time slice and cost cap, and attaches a `tier1` decision to each `ExtractedSymbol`
   (a new optional field beside `tier0`).
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

| Band     | Rule                                                                                  | _stage_ mode (fitted held-out)                                        | _suggest_ mode (otherwise)              |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| accept   | top layer is not `none`, layer p ≥ T_layer, and the chosen type's p ≥ T_type          | staged as an element, with its mapped relationships; counted, no card | card with the hint, sorted first        |
| reject   | top layer is `none` and its p ≥ T_none                                                | not carded; counted under `unchanged.tier1Rejected`                   | card with the hint, sorted last         |
| escalate | everything else, and any card Tier 1 could not answer (budget, time, provider failed) | card with the hint (or why it has none)                               | card with the hint (or why it has none) |

A (question set, provider, model) with no fitted thresholds has no bands at all: every card is an
escalate card with its hint, in suggest mode.

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
cache, so it costs nothing and stages exactly the accept band the agent was shown. It is refused for
a combination with no fitted thresholds (there is no accept band). The reject band is left as cards
(whether it should be included is an open question).

**Provenance.** The model has no field for "which tier decided this" and adding one is a spec change,
so it goes where extraction already records what it staged: each `StagedBySymbol` in the extraction
record (`.dr/analyzers/extract/<changeset>.json`) gains

```ts
decidedBy?: {
  tier: 1;
  qset: string; // "dr-qset-1"
  provider: string; // "cloudflare-workers-ai" | "openrouter" | "amazon-bedrock"
  model: string; // "@cf/cloudflare/clef"
  upstream?: string; // OpenRouter only: the provider that served it, e.g. "Cloudflare"
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

One block, with `provider` and `model` required and an options object named after the provider:

```yaml
# Cloudflare Workers AI: Clef or Clef-flash
extraction:
  tier1:
    provider: cloudflare-workers-ai
    model: clef # clef | clef-flash (provider model ids live in code)
    max_cost_usd: 5 # optional, every provider: cap per run, default 5
    concurrency: 4 # optional, every provider: cards in flight, default 4, at most 16
```

```yaml
# OpenRouter: the Decisions API, pinned to one upstream
extraction:
  tier1:
    provider: openrouter
    model: cloudflare/clef # an OpenRouter model id
    openrouter:
      api: decisions # decisions (default) | chat-logprobs (section 3.2)
      only: [cloudflare] # required: the upstream(s) allowed to receive card text
      allow_fallbacks: false # default false: never route outside `only`
      data_collection: deny # default deny
      zdr: false # optional: zero-data-retention endpoints only
```

```yaml
# Amazon Bedrock: an imported model, token logprobs
extraction:
  tier1:
    provider: amazon-bedrock
    model: arn:aws:bedrock:us-east-1:123456789012:imported-model/abcdef123456
    bedrock:
      region: us-east-1 # required; Custom Model Import runs in eu-central-1, us-east-1, us-east-2, us-west-2
```

Rules:

- No `extraction.tier1` block (or `tier1: false`) means off. There is no default provider.
- An unknown provider or model, a missing required option (OpenRouter's `only`, Bedrock's `region`)
  or a value of the wrong type makes Tier 1 `misconfigured`: the run is Tier 0 only and says what is
  wrong.
- Keys that would hold credentials (`token`, `api_token`, `api_key`, `account_id`, `secret`,
  `access_key_id`, `secret_access_key`, `profile`) are refused with "credentials don't go in the
  manifest; see ...", so nobody commits one by analogy. An AWS profile name is not a secret, but it is
  per user, so it goes in the user config.
- For OpenRouter, `only` is required so that the project names who receives code, not just the
  router; a list of several upstreams is allowed (it is still a named list), but thresholds are per
  upstream (section 6).
- `Manifest`/`ManifestData` (`cli/src/core/manifest.ts`, `cli/src/types/index.ts`) gain an optional
  `extraction` field, loaded beside `codebase_path` in `Model.load` and written in `saveManifest`
  (`cli/src/core/model.ts`). This is required, not cosmetic: `saveManifest` rebuilds the YAML from
  known fields, so an unknown top-level block would be dropped by the next save.
- Turning it on is a human act: an edit to the manifest, or
  `dr analyzer tier1 enable --provider <name> --model <id>` with the provider's options (and
  `disable`), which prints what will be sent and to whom. No MCP tool sets or clears it;
  `project_status` and `codebase_extract` only report it.

The alternative, a per-checkout `.dr/analyzers/<analyzer>/tier1.json`, is listed in the open
questions.

### 2.2 Credentials

Never in the manifest. Per provider:

- **`cloudflare-workers-ai`**: the environment, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
  (a token with Workers AI permission), the names the harness already uses
  (`cli/scripts/classify-eval/README.md`); else `~/.dr-config.yaml`.
- **`openrouter`**: `OPENROUTER_API_KEY`; else `~/.dr-config.yaml`.
- **`amazon-bedrock`**: the AWS SDK's default credential chain (environment variables, shared
  config and credentials files with `AWS_PROFILE`, IAM Identity Center (SSO), container and instance
  roles), so whatever already works for the `aws` CLI works here. An optional `profile` in
  `~/.dr-config.yaml` selects a named profile. The adapter needs `bedrock:InvokeModel` on the model
  ARN.

The user config (`cli/src/config.ts`, which already holds `mcp.api_key_path`) gains:

```yaml
decision_models:
  cloudflare-workers-ai:
    account_id: "..."
    api_token_path: ~/.dr-cloudflare-token # a 0600 file, like mcp.api_key_path
  openrouter:
    api_key_path: ~/.dr-openrouter-key # a 0600 file
  amazon-bedrock:
    profile: my-sso-profile # optional; otherwise the default chain
```

The CLI does not read `.env` files (nothing under `cli/src` loads one) and should not start: the
harness keeps its own `loadDotEnv` (`lib/env.ts`) and passes credentials to the adapter constructor.
The `dr mcp` server the plugin starts (`integrations/claude_code/.claude-plugin/plugin.json`)
inherits Claude Code's environment, so the environment, the user config and AWS profiles all reach
it. Secrets are never logged or returned. The notice identifies the account without the secret: the
Cloudflare account id's last four characters, the AWS account from the model ARN and the region, the
OpenRouter key's label is not shown (OpenRouter keys have no public account id).

### 2.3 What the tool says

`codebase_extract` replaces its `tier1` string with a block (illustrative values):

```json
"tier1": {
  "state": "on",
  "provider": "openrouter",
  "model": "cloudflare/clef",
  "routing": { "only": ["cloudflare"], "allow_fallbacks": false, "data_collection": "deny" },
  "servedBy": { "Cloudflare": 412 },
  "qset": "dr-qset-1",
  "mode": "suggest",
  "thresholds": null,
  "cards": 4071,
  "cached": 3659,
  "sent": 412,
  "failed": 0,
  "skipped": 0,
  "bands": null,
  "staged": 0,
  "costUsd": 0.47,
  "capUsd": 5,
  "durationMs": 61234,
  "notice": "Sent 412 cards (symbol, signature, docstring, callers, callees, imports and up to 40 source lines each) to OpenRouter, which forwarded them to Cloudflare (412), because documentation-robotics/model/manifest.yaml enables extraction.tier1. No thresholds are fitted for this provider and model, so nothing was banded."
}
```

The notice always names every party that received card text:

- `cloudflare-workers-ai`: "Cloudflare Workers AI (`@cf/cloudflare/clef`, account …3f9a)".
- `openrouter`: "OpenRouter, which forwarded them to <upstream> (<count>)", one entry per upstream
  the responses named (the Decisions API returns `provider`; section 3.2). A response with no upstream
  is counted as "an upstream OpenRouter did not name", and the run says so; with `only` set, that can
  only be one of the listed upstreams.
- `amazon-bedrock`: "Amazon Bedrock (`<model ARN>`, account 123456789012, us-east-1)".

`state` is one of:

- `off`: "not enabled for this project (extraction.tier1 in manifest.yaml)". When credentials for
  some provider are set it adds that they are set and unused.
- `misconfigured`: the config error; the run is Tier 0 only.
- `no-credentials`: names the environment variables, user-config keys or AWS chain it tried.
- `on`: as above.
- `unavailable`: the provider failed (auth, down, timeouts, logprobs missing); how far it got and
  why. The run is Tier 0 for the rest.
- `warming`: the background cache fill is running (section 4.4).

`dr analyzer classify` prints the same notice to stderr before the first request (for OpenRouter,
the allowed upstreams), with the estimate ("about 412 cards, about $0.47, cap $5.00"), and the
summary with the upstreams that actually served after. `project_status` shows Tier 1's state in one
line beside the index.

### 2.4 What never enables it

Credentials in the environment, in `~/.dr-config.yaml` or in an AWS profile without the manifest
block; a `codebase_extract` argument (there is none to turn it on: `tier1: false` only turns it off
for one run); the harness's `.env`. A unit test sets every provider's environment variables with no
block and asserts no request is made.

## 3. The decision-model layer and the module layout

Decision 2: the question set lives in code with a version id. Tier 1 is split in two: everything
DR-specific (question set, criteria, state rendering, bands, cache, run loop) is provider-independent,
and talks to a `DecisionModel`. Providers are adapters behind that interface.

### 3.1 The interface

The request is the Jev shape the harness already sends to Clef (`backends/clef.ts`); the response is
normalised by the adapter, so the run loop never sees a provider's wire format.

```ts
export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

export type Answer =
  | { type: "choice"; probabilities: Record<string, number> } // over the criteria keys, sums to 1
  | { type: "score"; distribution: number[] } // over the levels, sums to 1
  | { type: "noul"; probability: number } // P(yes)
  | { type: "refusal" };

export interface DecisionModel {
  /** Identity for cache keys, thresholds and the notice. */
  readonly id: {
    provider: string; // "cloudflare-workers-ai" | "openrouter" | "amazon-bedrock"
    model: string; // provider model id or ARN
    upstream?: string; // OpenRouter: the pinned upstream when exactly one is allowed
    mechanism: "native" | "token-logprobs";
  };
  /** Questions per request the adapter can answer (Clef: all; token-logprobs: one). */
  readonly questionsPerRequest: "many" | "one";
  /** USD per million input tokens (and output, for logprob adapters), for estimates. */
  readonly pricing: { inputPerM: number; outputPerM: number };
  ask(
    state: string,
    questions: Record<string, Question>,
    signal: AbortSignal
  ): Promise<{
    answers: Record<string, Answer>;
    usage: { inputTokens: number; outputTokens: number; costUsd?: number };
    servedBy: { upstream?: string; model?: string }; // what the response said served it
    /** token-logprobs only: probability mass outside the options, per question. */
    offMass?: Record<string, number>;
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
    | "unsupported";
  status?: number;
  retryAfterMs?: number;
}
```

The run loop keeps the two stages (layer, significance and concerns; then type within the layer) and
batches them according to `questionsPerRequest`. `unsupported` is raised when a response lacks what
the mechanism needs (no logprobs, an option missing from the top logprobs, a `box`-only provider) and
counts like a provider failure: it never silently degrades to a different mechanism.

### 3.2 Providers: how each returns per-option probabilities

What the research found (sources at the end; "unverified" marks what could not be confirmed from a
primary source):

**A native decision model (Jev-shaped) is the only mechanism with measured calibration.** Clef's
probabilities come from a trained head over the backbone's hidden states: "one logit per option ...
a softmax per question gives probabilities", in a single prefill pass with no generation (Hugging
Face model card). The harness
measured it: underconfident but monotonic, and a usable accept band (EXTRACTION_STRATEGY.md, Phase 0).

**Token logprobs from a generic LLM are a weaker substitute.** Ask one question per request, offer
the options as single-token labels (A, B, C... for a choice; Yes/No; 0-4 for a score), generate one
token, request the top log probabilities, and renormalise over the option tokens; the mass on other
tokens is reported as `offMass`. Known limits: post-training (RLHF) makes token probabilities
overconfident (Tian et al. 2023 report verbalised confidence calibrating better than token
probabilities for RLHF models; the GPT-4 technical report shows calibration degrading after
post-training: cited from the paper, not re-checked here); one request per question (9 per card for
`dr-qset-1` against Clef's 2) multiplies input tokens unless the provider caches the shared prefix
(unverified per provider); `top_logprobs` is capped at 20 on OpenRouter, so a choice with more than
20 options can't be read in one pass: the layer question has 14 options, but the type question for
`security` (29 types plus `none`), `api` (27) and `ux` (22) has more, and so does the 26-letter label
alphabet for `security` and `api`. A token-logprob adapter escalates those type questions unless a
split question is designed and measured for it; and constrained decoding may change the reported logprobs (whether they are
taken before or after the constraint mask is engine-specific and unverified for these hosts).

**Fallbacks without logprobs are not adopted.** k-sample voting needs k requests per question and
gives probabilities in steps of 1/k; verbalised confidence was measured in-house: Sonnet's
self-reported confidence was calibrated on average (ECE 0.07-0.14) but discriminated poorly
(precision only 79% to 90% from 0.5 to 0.8 on dr-cli, "no clean auto-accept band") and Haiku's was
"not usable as a gate" (EXTRACTION_STRATEGY.md, Phase 0). Neither is offered as an adapter mode.

Per provider:

| Provider                | Native decision model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Clef weights elsewhere                                                                                                                                                                                                                                                                                                                                                                                     | Token logprobs                                                                                                                                                                                                                                                                                                                      | Adapter uses                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `cloudflare-workers-ai` | Yes: Clef (`@cf/cloudflare/clef`) and Clef-flash on Workers AI, Jev-compatible request, per-option probabilities (today's harness client)                                                                                                                                                                                                                                                                                                                                                                                                                                                 | n/a                                                                                                                                                                                                                                                                                                                                                                                                        | Not needed                                                                                                                                                                                                                                                                                                                          | native                                                                           |
| `openrouter`            | Yes: the Decisions API, `POST /api/alpha/decisions` ("Alpha: the shape may change"), takes `model`, `state`, `questions` (`noul`, `choice`, `score`), returns per-option `probabilities`, `provider` and `usage.cost`; it accepts the same `provider` routing object (`only`, `data_collection`, `allow_fallbacks`, `zdr`, `quantizations`, `require_parameters`). `cloudflare/clef` is served by Cloudflare, PrimeIntellect and DeepInfra (DeepInfra at fp8), $0.192-0.24 per million input tokens (endpoints API, 2026-11-13). Jev on OpenRouter: third-party reports only (unverified) | Through the same listing (PrimeIntellect, DeepInfra host the open weights)                                                                                                                                                                                                                                                                                                                                 | Chat completions accept `logprobs` and `top_logprobs` (0-20); support depends on the upstream. `provider.require_parameters: true` routes only to upstreams that support every parameter sent. Whether every such upstream really returns them is unverified, so a missing value is `unsupported`                                   | native (Decisions API), pinned with `only`; `chat-logprobs` as a measured option |
| `amazon-bedrock`        | No: no decision model in the Bedrock catalog was found, and a third-party guide states Jev is not a Bedrock model (unverified against an AWS source)                                                                                                                                                                                                                                                                                                                                                                                                                                      | No: Custom Model Import takes listed architectures only (for Qwen3, only `Qwen3ForCausalLM` and `Qwen3MoeForCausalLM`), on transformers 4.51.3. Clef is a Qwen3.8-27B backbone with a vision encoder plus a custom joint-schema head, tested on transformers 5.10.2 and served from a custom SGLang image, so it can't be imported; the backbone alone would lose the head that produces the probabilities | Converse has no logprob field. Custom Model Import models imported after 2025-11-11 return them through `InvokeModel`: `"return_logprobs": true` (BedrockCompletion, top-1 only), or `logprobs`/`top_logprobs` (OpenAI chat format). Logprobs for Bedrock's own foundation models through `InvokeModel` were not found (unverified) | token-logprobs on an imported model, OpenAI chat format                          |

What follows for each adapter:

- **`cloudflare-workers-ai`** (`adapters/cloudflare-workers-ai.ts`): the harness's `callClef` and its
  answer parsers (`choiceOf`, `noulOf`, `scoreOf`), ported as is. Models: `clef`, `clef-flash`.
- **`openrouter`** (`adapters/openrouter.ts`):
  - default `api: decisions`: the same request shape as Workers AI, sent to the Decisions API with
    `provider: { only, allow_fallbacks: false, data_collection: "deny", zdr? }`. The response's
    `provider` is recorded per card and drives the notice. Because the API is alpha, the adapter pins
    the response fields it reads in a schema and reports `unavailable` (not a crash) if they change.
    The upstream matters for calibration: DeepInfra serves Clef at fp8, so its probabilities may
    differ from Cloudflare's, and thresholds are per upstream.
  - `api: chat-logprobs`: the token-logprob mechanism on a chat model, with
    `logprobs: true, top_logprobs: 20, max_tokens: 1, temperature: 0` and
    `provider: { only, require_parameters: true, data_collection: "deny", allow_fallbacks: false }`.
    `require_parameters` keeps the request off upstreams that don't take the logprob parameters; a
    response without them is `unsupported`.
- **`amazon-bedrock`** (`adapters/amazon-bedrock.ts`): `InvokeModel` on an imported model's ARN,
  OpenAI chat format, `logprobs: true, top_logprobs: N, max_tokens: 1`, one question per request,
  through the token-logprob mechanism. Through `@aws-sdk/client-bedrock-runtime` (a new dependency,
  loaded lazily so projects that don't use Bedrock never load it) with the default credential chain.
  `ModelNotReadyException` (an imported model that was scaled to zero is restored on first call,
  documented as taking minutes) is retried within the run's deadline, then `unavailable`. Unsupported:
  Bedrock foundation models and Converse (no logprobs); importing Clef. Custom Model Import has its
  own pricing (per model copy and time active; not checked here), which the adapter's estimate can't
  derive from tokens, so `max_cost_usd` counts only what token usage shows and the notice says so.

`mechanism` is part of each adapter's identity, so a token-logprob answer can never be mistaken for
a native one in the cache, the thresholds or the provenance.

### 3.3 Module layout: `cli/src/analyzers/classifier/`

```text
cli/src/analyzers/classifier/
  index.ts                 public API: resolveTier1, classifyTier1, bandOf, types
  types.ts                 Tier1Decision, Tier1Hint, Band, Tier1Summary
  config.ts                resolveTier1(): manifest block + credentials -> off | misconfigured | no-credentials | ready
  decision-model/          provider-agnostic decision-model layer
    types.ts               DecisionModel, Question, Answer, DecisionModelError
    registry.ts            provider name -> adapter factory; model aliases, prices, mechanism
    jev-answers.ts         normalising Jev-shaped answers (from the harness's choiceOf, noulOf, scoreOf)
    token-logprobs.ts      one question -> single-token prompt; logprobs -> Answer, offMass
    adapters/
      cloudflare-workers-ai.ts   Clef, Clef-flash: native
      openrouter.ts              Decisions API: native; chat-logprobs: token-logprobs
      amazon-bedrock.ts          InvokeModel on an imported model: token-logprobs
  qset/
    v1.ts                  QSET_ID "dr-qset-1": stage-1 and stage-2 questions, KIND_CANDIDATES, concerns, significance
    index.ts               the current qset, and older ids for the harness
  criteria.ts              layer and type criteria from the bundled spec (from lib/spec.ts), criteriaDigest()
  state.ts                 renderState(card, options) (from lib/state.ts), 40 source lines
  bands.ts                 THRESHOLDS per (qset, provider, model, upstream) with fit provenance; bandOf(), modeOf()
  cache.ts                 Tier1Cache (section 4.1)
  run.ts                   classifyTier1(): cache, cost cap, pool, deadline, retries, circuit breaker
```

Nothing outside `decision-model/` imports an adapter; `run.ts` gets a `DecisionModel` from
`registry.ts`, and tests pass a fake.

**Question set `dr-qset-1`** is exactly the harness configuration the current numbers measure,
`clef@cbm012-kind-tier0` (`classify.ts --kind-narrow --tier0`, full criteria, no facts, no charter):

- stage 1: `layer` (choice over the 13 layers and `none`, restricted to Tier 0's layers when it
  narrowed), `significance` (score, 5 levels), six `concern_*` yes/no questions;
- stage 2, when the layer is not `none` and at least two options remain: `element_type` (choice
  within the layer and `none`), restricted by Tier 0's narrowing, else by `KIND_CANDIDATES` (the kind
  rule, still harness code; moving it into the rule file is a later question-set change);
- the state is `renderState(card, 40)`.

The question set is the same for every provider; how a token-logprob adapter phrases one question
as a single-token prompt is the adapter's business and part of its identity (`mechanism`), not a
different question set.

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
/** qset id -> "provider|model|upstream" (upstream "-" when none) -> thresholds */
export const THRESHOLDS: Record<string, Record<string, BandThresholds>> = {
  "dr-qset-1": {
    "cloudflare-workers-ai|@cf/cloudflare/clef|-": { layer: 0.6, type: 0.4, none: 0.6, fit: "in-sample", fittedOn: { ... } },
  },
};
```

A combination with no entry has no bands: every card escalates with its hint (suggest mode, no
accept or reject). `modeOf` is `stage` only when `fit` is `held-out`. Bands are computed at use, never
cached, so new thresholds need no new requests. OpenRouter with several upstreams in `only` looks up
each card's thresholds by the upstream that answered it.

## 4. Caching, determinism, cost and failures

### 4.1 Cache

- **Key**: SHA-256 of provider, model, upstream, mechanism, qset id, criteria digest, narrowing
  and `sha256(rendered state)`, where narrowing is the sorted candidate list from Tier 0 or the kind rule
  and upstream is the pinned one (OpenRouter with exactly one `only` entry) or `any`. The rendered
  state is the "card content hash": it is a pure function of the card (§1 of the cascade design) and
  exactly what the provider sees, so a change in source, signature, docstring or neighbourhood re-asks
  and nothing else does. The spec version is recorded with each decision, but the criteria digest is
  what keys it.
- **Value**: the whole card's decision (both stages, since stage 2 depends on stage 1), with the
  normalised answers, the upstream and model the response named, `offMass` for token-logprob answers,
  usage, cost and time.
- **Where**: `.dr/analyzers/<analyzer>/tier1-cache/<qset>/<provider>/<model slug>.jsonl`,
  append-only, last line for a key wins, read into a map at the start of a run, appended under a short
  lock of its own (not the extraction run lock, which the background fill must not hold for minutes).
  About 1 KB a decision, so about 5 MB for this repository. `dr analyzer classify --prune-cache` keeps
  only the keys the latest run used and removes files of other question sets, providers and models.
- `.dr/` is not committed, so the cache is per checkout; a new clone pays once.

### 4.2 Determinism

Clef has answered deterministically in the harness: the 0.12.1 re-measurement relies on it to
separate the spec effect from the CBM effect (EXTRACTION_STRATEGY.md, "Re-measured on CBM 0.12.1").
With the cache, a rerun at the same commit gives the same decisions byte for byte whatever the
concurrency, and only changed cards are asked. Two gaps:

- Hosted model ids are not versioned (Workers AI's `@cf/cloudflare/clef`, OpenRouter's
  `cloudflare/clef`), so a provider-side update would change answers for new cards and not for cached
  ones. Adapters record the model the response names, and the harness's rerun on the committed corpora
  (expected: 0 lost, 0 gained in `compare.ts`) is the drift check, per adapter, before each release
  that touches Tier 1.
- Token-logprob adapters run at temperature 0 with one generated token, but batch-dependent numerics
  on the host can still move a probability in its last digits; whether the answers are reproducible
  is one of the things the harness measures for those adapters.

### 4.3 Cost, concurrency, rate limits, timeouts

- **Scale.** On dr-cli the measured configuration (Clef on Workers AI) costs $0.0011 a card at a
  median 739 ms for both stages (`data/dr-cli/report.md`, summary row `clef@cbm012-kind-tier0`).
  This repository's 4,071 cards are then about $4.50 and, at 4 in flight, about 12.5 minutes cold; a
  `since` run on 23 to 774 cards (the ranges measured in EXTRACTION_STRATEGY.md, "`detect_changes`
  for `since` runs") is $0.03 to $0.85 and 4 s to 2.5 min. A warm run costs nothing. OpenRouter's
  Clef endpoints list $0.192-0.24 per million input tokens and nothing for output; a token-logprob
  adapter sends the state once per question (9 requests a card), so expect several times the input
  tokens unless prefix caching applies. Each adapter's real cost per card is a harness measurement.
- **Cost cap.** Before asking, the run estimates the misses' cost from the mean cost of cached
  decisions for this provider and model (the harness's $0.0011-0.0017 a card for Clef until there are
  any; for a new adapter, from token counts and its `pricing`). Over `max_cost_usd`, it asks in card
  order (changed in range first, then the planner's order) up to the cap; the rest are escalated with
  `skipped: "cost cap"` and the result says what the whole run would cost. Actual cost is the
  response's own cost when it gives one (OpenRouter's `usage.cost`), else tokens times price. Each run
  appends `{date, provider, model, sent, tokens, costUsd}` to
  `.dr/analyzers/<analyzer>/tier1-runs.jsonl`, so `project_status` can show month-to-date spend.
  Bedrock Custom Model Import also bills for the imported model's active time, which tokens don't
  show; the notice says the figure excludes it.
- **Batching.** A Jev-shaped request takes one state and all of a stage's questions; a
  token-logprob request takes one question. Cards run in a pool of `concurrency` (default 4, the
  harness's default).
- **Rate limits.** Provider limits for these models were not established in this research; the
  first live run of each adapter measures them. 429, 5xx and Bedrock's `ThrottlingException` are
  retried with backoff (the harness: four attempts, 1, 2, 4, 8 s), honouring `Retry-After`, and a
  throttle halves the pool for the rest of the run (at least 1).
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

| Condition                                                                    | Behaviour                                                 | `tier1.state`                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| No manifest block                                                            | Tier 0 only                                               | `off`                                  |
| Invalid block                                                                | Tier 0 only, the error quoted                             | `misconfigured`                        |
| No credentials                                                               | Tier 0 only, the variables, keys or AWS chain tried       | `no-credentials`                       |
| 401 or 403, or AWS `AccessDeniedException`                                   | stop at the first; the rest escalate                      | `unavailable` (`auth`)                 |
| 5 cards in a row failing after retries, or 5xx                               | circuit breaker: stop; answers so far are kept and cached | `unavailable` (`provider`)             |
| Logprobs missing, or an option absent from the top logprobs (token-logprobs) | that card escalates; 5 in a row trips the breaker         | `on`, or `unavailable` (`unsupported`) |
| OpenRouter served an upstream outside `only` (should not happen)             | stop; the run says which upstream answered                | `unavailable` (`routing`)              |
| A malformed answer for one card                                              | that card escalates, `failed` counts it                   | `on`                                   |
| Deadline or cost cap reached                                                 | the rest escalate with `skipped`                          | `on` (or `warming`)                    |

## 5. The harness keeps measuring production code

As with cards (`cli/scripts/classify-eval/lib/tier0.ts` imports `src/analyzers/cards/`):

- `classify.ts --backend` takes any registered adapter: `cloudflare:clef` and `cloudflare:clef-flash`
  (with today's `clef` and `clef-flash` kept as aliases, so committed `pred-clef*.jsonl` names stay
  valid), `openrouter:<model>@<upstream>` (Decisions API, one pinned upstream),
  `openrouter-logprobs:<model>@<upstream>` and `bedrock:<model ARN>`. The Claude backends stay
  harness-only (they are Tier 2 baselines). Credentials come from the harness's `.env`
  (`OPENROUTER_API_KEY` beside the Cloudflare pair) or, for Bedrock, the AWS chain.
- `backends/clef.ts` becomes a thin adapter over the CLI's registry; the harness's `Prediction`
  record gains `provider`, `upstream` and `mechanism`, so `report.ts` and `compare.ts` read old and
  new runs alike and keep runs from different adapters apart.
- `lib/spec.ts` and `lib/state.ts` re-export the CLI's `criteria.ts` and `state.ts`. The experiment
  flags (`--criteria core`, `--charter`, `--facts`) become options of the CLI's builders that produce
  variant ids (`dr-qset-1+core`), so experiments also run through production code and can't be
  mistaken for the shipped set.
- `report.ts` gains the band report, computed with the CLI's `bandOf` for the current thresholds,
  the joint layer-and-type and `none` sweeps of section 6, and for token-logprob runs the `offMass`
  distribution. A new `fit-thresholds.ts --backend <id>` prints a proposed `THRESHOLDS` entry for that
  (question set, provider, model, upstream) with its fit record; the maintainer commits it.
- **Acceptance for the port**: the request JSON of `classify.ts --dry-run` is byte-identical before
  and after (a fixture test in the CLI), and a rerun of dr-cli with
  `--backend cloudflare:clef --kind-narrow --tier0 --tag cbm012-kind-tier0-port` gives 0 lost and 0
  gained against `clef@cbm012-kind-tier0` in `compare.ts` (about $0.33).
- **Acceptance for each new adapter**: a run over all three corpora, its report and `compare.ts`
  against the Workers AI Clef run. For OpenRouter's Clef pinned to Cloudflare, identical answers are
  the expected result; for DeepInfra (fp8) and any token-logprob model, the report is the evidence for
  or against fitting thresholds at all.

## 6. Calibration

Calibration is per (question set, provider, model), and per upstream for OpenRouter. The same Clef
weights at fp8 on another host, or a different model behind the same interface, are different
probability sources; thresholds fitted for Clef on Workers AI apply to that combination only. A
combination without its own fit runs suggest-only with no bands (section 3.3). Whether identical
answers on two hosts may share a fit is an open question.

**Where the numbers stand.** The bands in §3 of the cascade design came from Phase 0 (layer
threshold 0.6: 92-97% layer precision on 36-41% of cards). The configuration that ships is the later
one, so here it is again on the committed predictions, `pred-clef@cbm012-kind-tier0.jsonl` (Clef on
Workers AI) against `gold.jsonl`, on model-asked cards only (rule-decided cards left out, as
`report.ts` does). These figures were computed for this document; `report.ts` does not produce them
yet.

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

**How thresholds are fitted** (per question set, provider, model and upstream, by
`fit-thresholds.ts`):

1. Pool the labelled corpora's model-asked cards, run the question set over them through the adapter
   (once per combination; the cache makes reruns free).
2. Accept band: on a grid (T_layer 0.5-0.8, T_type 0-0.6 in steps of 0.05), take the pair with the
   most accepted cards whose pooled end-to-end type precision meets the target P_accept, no corpus
   with at least 30 accepted cards more than 10 points below it, and report the Wilson interval.
3. Reject band: the smallest T_none whose `none` precision meets P_reject, same rules.
4. A combination where no pair meets the targets gets no entry, and stays suggest-only. For
   token-logprob adapters, a high share of cards with large `offMass` is a reason not to fit at all.
5. Record corpora, card counts, spec version, date and `fit: "in-sample"`.

**What can ship before B5**: everything in sections 1 to 5 in suggest mode: the decision-model layer
and all three adapters, the opt-in, `dr analyzer classify` with Tier 1, the cache and fill, hints on
`codebase_extract`'s cards and `acceptTier1` (for combinations with in-sample thresholds), labelled as
in-sample in every result.

**What must wait for B5** (the held-out corpus: a fourth codebase labelled with `label.ts` and not
read while writing rules or question sets):

- **Stage mode, per combination.** A combination's thresholds count as `held-out` only when the
  fourth corpus, scored through that adapter with the fitted thresholds, meets the targets within its
  interval. Then `modeOf` returns `stage` for it and Tier 1 stages and rejects without the agent.
- **Trust in narrowing.** Tier 1's choices come from Tier 0's narrowing, which is in-sample too
  (Phase 2 results); a narrowing rule that is wrong on a new framework removes the right answer from
  Tier 1's options (the interface narrowing already gives up three dr-cli interfaces). B5 measures
  Tier 0 first, as the strategy doc says.

After B5, every question-set bump reruns all labelled corpora through each configured combination
(about 650 cards; about $1 for Clef) and refits; reviewed outcomes of staged Tier-1 elements (section
1.3) join the labelled pool over time.

## 7. Test plan

No network in CI. Adapters take an injected `fetch` (Cloudflare, OpenRouter) or an injected AWS
client (Bedrock), and the test setup's defaults throw, so a request that slips through fails loudly.

**Unit** (`cli/tests/unit/analyzers/classifier/`), with a `FakeDecisionModel`
(`cli/tests/helpers/fake-decision-model.ts`: scripted answers by state hash and question, call log,
and injectable 429, 5xx, timeout, auth, malformed and missing-logprob responses):

- `qset`: request JSON for fixture cards equals fixtures captured from the harness's `--dry-run`;
  the digest-to-`QSET_ID` pin; narrowing and the kind rule restrict criteria as the harness does.
- `criteria`: built from the bundled spec; `none` present; placeholder descriptions refused; the
  digest changes when a definition does.
- Adapters, against recorded response fixtures:
  - `cloudflare-workers-ai`: URL, headers and body; wrapped and unwrapped responses; map and array
    probabilities; retries on 429 and 5xx with `Retry-After`; no retry on 400, 401, 403; timeout;
    the token never in an error message.
  - `openrouter` (decisions): the routing object always carries `only`, `allow_fallbacks: false` and
    `data_collection: "deny"`; `provider` read into `servedBy`; an upstream outside `only` stops the
    run; `refusal` answers escalate; an unexpected response shape is `unavailable`, not a crash.
  - `openrouter` (chat-logprobs) and `token-logprobs`: one question per request; option labels
    mapped back to criteria keys; renormalisation and `offMass`; an option missing from the top
    logprobs, or no logprobs, is `unsupported`; `require_parameters: true` always sent.
  - `amazon-bedrock`: the OpenAI chat body with `logprobs` and `top_logprobs`; `ModelNotReadyException`
    retried within the deadline; `ThrottlingException` halves the pool; `AccessDeniedException` is
    `auth`; region and ARN from the config.
- `bands`: band per thresholds; no entry means no bands; lookup by provider, model and upstream;
  mode from `fit`.
- `cache`: hit and miss; the key changes with provider, model, upstream, mechanism, state, question
  set, criteria and narrowing; a truncated last line is skipped; two writers don't corrupt it.
- `config`: off with every provider's credentials set and no block (no request made);
  `no-credentials`; `misconfigured` for an unknown provider, a missing `only` or `region`, and
  credential keys in the block; the user config's key files and AWS profile; a manifest round trip
  through `saveManifest` keeps `extraction`.
- `run`: cost cap and deadline stop asking and escalate the rest; circuit breaker; provider down
  means every card escalates and `unavailable`; concurrency halves on a throttle; output order
  independent of completion order; the notice names every upstream that answered.
- `extraction-plan`: an accept-band decision in stage mode becomes an add with `rule: "tier1:..."`
  and its relationships; suggest mode cards it with the hint; the reject band is counted, not carded,
  in stage mode; no thresholds means no bands; a changed answer on a modelled symbol never produces
  `retyped`.

**Integration** (`cli/tests/integration/`, golden-copy project, the fake model through
`CodebaseToolDeps`, which already injects the analyzer, git and budget):

- `codebase_extract` off by default: the `tier1` block says `off`, results otherwise unchanged;
- opted in: the notice, hints, ordering, `acceptTier1` staging with `decidedBy` in the record, a
  rerun answered from the cache with zero requests;
- provider failing: Tier-0 results plus `unavailable`;
- a cold cache over the slice: `warming`, the job record, nothing staged;
- `dr analyzer classify` without `--tier0-only` and without opt-in: Tier 0 and the off line.

**Live, manual**: the port's acceptance rerun and each adapter's harness measurement (section 5),
and a first opted-in bootstrap of this repository per adapter recording time, cost, throttling and
the upstreams that served.

## 8. Rollout, as small PRs

1. **Decision-model interface and the Cloudflare adapter, no behaviour change.** `decision-model/`
   with the interface, registry and `cloudflare-workers-ai` adapter; `qset/`, criteria, state, bands
   and cache; unit tests with the fake; the harness switched to import it; the parity fixture and the
   dr-cli rerun as acceptance.
2. **Thresholds in-sample for Clef on Workers AI.** `report.ts` band report and sweeps,
   `fit-thresholds.ts`, the `dr-qset-1` entry in `bands.ts` marked `in-sample`.
3. **Opt-in and the command.** Manifest field and round trip, `~/.dr-config.yaml` section,
   `resolveTier1`, `dr analyzer tier1 enable|disable`, `dr analyzer classify` with Tier 1, the run
   loop with cap, pool, timeouts and breaker, the run ledger. Cloudflare is the only provider the
   registry offers so far. Docs: the opt-in in `cli/README.md`.
4. **`codebase_extract` in suggest mode.** Two-pass planning, hints, ordering, the `tier1` block,
   inline asking within the budget, `tier1: false`, `acceptTier1` and `decidedBy`.
   docs/CHANGE_MODELING.md updated (cascade step 2, Known limits).
5. **OpenRouter adapter (Decisions API), with a harness measurement.** The adapter, routing options
   and the upstream in the notice; harness runs of `cloudflare/clef` pinned to Cloudflare (expected
   identical to Workers AI) and to DeepInfra (fp8); thresholds only where the report supports them.
6. **Token-logprob mechanism and the Bedrock adapter, with harness measurements.**
   `token-logprobs.ts`, OpenRouter's `chat-logprobs` mode and the Bedrock adapter (the AWS SDK
   dependency); harness runs of the chosen OpenRouter chat model and Bedrock imported model; a written
   verdict per model on whether to fit thresholds at all. This step depends on the answers to open
   questions 9 and 10.
7. **Background fill.** The job, `warming`, `project_status`, the `codebase_index` phase (if wanted).
8. **After B5: stage mode.** Score the fourth corpus per configured combination, mark the thresholds
   that pass `held-out`, update the docs and the strategy doc's track B.

## 9. Open questions for the maintainer

1. **Config location**: a committed `extraction.tier1` block in `manifest.yaml` (recommended), or a
   per-checkout `.dr/analyzers/<analyzer>/tier1.json`?
2. **Cloudflare account**: which account backs the first live runs (the strategy doc's next step 6
   asks for it)?
3. **The bands**: retire "drop below 0.5" so that unsure cards escalate, and add a type threshold
   to the accept rule (in-sample (0.6, 0.4) gives about 91% pooled type precision for Clef)?
4. **Precision targets**: what P_accept and P_reject must the held-out fit meet before stage mode
   (for example 90% and 95%), and is a point estimate enough or must the interval's lower bound meet
   it?
5. **Suggest mode before B5**: is suggest mode with a one-call `acceptTier1` acceptable, and should
   `acceptTier1` also take the reject band (recorded as "not an element" decisions, which persist
   across runs and question sets)?
6. **Cost**: is a $5 default cap per run right, and do you want a monthly cap on top of the ledger?
7. **The index job**: should `codebase_index` fill the Tier-1 cache on its own when opted in (it
   sends code on every reindex, cached cards excepted), or only `codebase_extract` and
   `dr analyzer classify`?
8. **B5**: will the fourth corpus serve both Tier 0's and Tier 1's held-out check, and which
   codebase?
9. **Only true decision models, or generic LLMs too?** Is a token-logprob adapter (OpenRouter chat
   models, Bedrock imported models) acceptable as a Tier-1 provider, given that our own Phase 0 found
   no clean accept band in an LLM's confidence, or should Tier 1 accept only native decision models
   (Clef, Jev) and Bedrock wait for one?
10. **First Bedrock target**: if token logprobs are acceptable, which model to import first
    (Custom Model Import takes `Qwen3ForCausalLM`, Llama 3.x, Mistral and others; it can't take
    Clef), in which region, and is the Custom Model Import running cost acceptable for this use?
11. **OpenRouter upstreams**: which upstreams may receive card text (Cloudflare only, or also
    PrimeIntellect and DeepInfra, whose Clef is fp8), and should `zdr: true` be the default? Is relying
    on an alpha API (the Decisions API) acceptable for a shipped adapter?
12. **Sharing a fit**: if the harness shows OpenRouter's Clef pinned to Cloudflare answering
    byte-identically to Workers AI on all corpora, may it share Workers AI's thresholds, or must every
    combination be fitted on its own?
13. **Jev**: is Jev still wanted, and through OpenRouter's Decisions API or TypeSafe's own endpoint
    (a fourth adapter)?
14. **Provenance in review**: is the extraction record enough, or should Tier-1 decisions show in the
    changeset viewer (a field on staged changes, and so a viewer change)?
15. **New dependency**: is `@aws-sdk/client-bedrock-runtime` (lazy-loaded) acceptable in the CLI's
    dependencies?

## Sources

Checked on 2026-11-13 unless marked otherwise.

- Clef model card (architecture, head, serving, request shape): <https://huggingface.co/Cloudflare/Clef>
- Clef-flash model card: <https://huggingface.co/cloudflare/clef-flash>
- Cloudflare, "Introducing Clef" (listed in EXTRACTION_STRATEGY.md's sources): <https://blog.cloudflare.com/clef-decision-models>
- OpenRouter Decisions API reference (`POST /api/alpha/decisions`, routing object, `provider` in the response): <https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md>
- OpenRouter endpoints for `cloudflare/clef` (upstreams, prices, fp8 on DeepInfra): <https://openrouter.ai/api/v1/models/cloudflare/clef/endpoints>
- OpenRouter parameters (`logprobs`, `top_logprobs` 0-20, support per provider): <https://openrouter.ai/docs/api/reference/parameters.md>
- OpenRouter provider selection (`require_parameters`, `data_collection`, `only`, `allow_fallbacks`, `zdr`): <https://openrouter.ai/docs/guides/routing/provider-selection.md>
- Amazon Bedrock Custom Model Import (supported architectures, transformers 4.51.3, regions, size limits): <https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html>
- Bedrock, invoking an imported model (API formats, Converse limits, `ModelNotReadyException`): <https://docs.aws.amazon.com/bedrock/latest/userguide/invoke-imported-model.html>
- Bedrock, advanced features for imported models (`return_logprobs`, `logprobs`/`top_logprobs`, `structured_outputs` choice): <https://docs.aws.amazon.com/bedrock/latest/userguide/custom-model-import-advanced-features.html>
- Bedrock Converse API reference (no logprob field in request or response): <https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html>
- Jev not a Bedrock model (third-party, unverified against AWS): <https://www.factualminds.com/blog/jev-typesafe-ai-aws-guide-2026/>
- Tian et al., "Just Ask for Calibration" (verbalised confidence vs token probabilities in RLHF models): <https://arxiv.org/abs/2305.14975>
- OpenAI, "GPT-4 Technical Report" (calibration after post-training; cited from the paper, not re-checked here): <https://arxiv.org/abs/2303.08774>
- In-house: EXTRACTION_STRATEGY.md, "Phase 0 results" (Clef calibration; Sonnet and Haiku self-reported confidence).
