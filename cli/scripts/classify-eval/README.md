# Classification eval harness

Experimental tooling for Phase 0 of [docs/EXTRACTION_STRATEGY.md](../../../docs/EXTRACTION_STRATEGY.md):
can a decision model (Cloudflare Clef, Jev) or a small Claude model classify code symbols
into Documentation Robotics layers and element types from a graph-derived "state card",
and how well calibrated are its probabilities?

It is a self-contained package (own `package.json`, run with `bun`) so it can track the
current Anthropic SDK without touching the CLI's dependencies. It imports the CLI's
`StdioClient` to talk to codebase-memory-mcp (CBM).

## Pipeline

```
cards.ts     CBM graph  ->  data/<corpus>/cards.jsonl      symbol state cards
label.ts     Claude     ->  data/<corpus>/gold.jsonl       gold labels (full context, Batch API)
classify.ts  backend    ->  data/<corpus>/pred-<b>.jsonl   predictions from a state card
report.ts               ->  data/<corpus>/report.md        accuracy, calibration, thresholds, cost
```

Cards and gold labels are committed: they are the dataset. Corpora are cloned under
`eval-corpus/` at the repo root (gitignored).

## Setup

```bash
cd cli/scripts/classify-eval && bun install
```

Credentials come from the repo-root `.env` (gitignored):

- `ANTHROPIC_API_KEY` for `label.ts` and the `claude-*` backends
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Workers AI permission) for `clef` / `clef-flash`

`codebase-memory-mcp` must be on `PATH`.

## Usage

```bash
# 1. Build cards (indexes the repo with CBM if needed)
bun cards.ts --corpus dr-cli --root /abs/path/to/documentation_robotics/cli --include "src/**" --limit 300
bun cards.ts --corpus fastapi --root /abs/path/to/eval-corpus/full-stack-fastapi-template --limit 200

# 2. Gold labels (Opus, high effort, Batch API at half price)
bun label.ts --corpus dr-cli --submit
bun label.ts --corpus dr-cli --status
bun label.ts --corpus dr-cli --fetch
bun label.ts --corpus dr-cli --sync --limit 5     # direct calls, for testing prompts

# 3. Classify with each backend (only cards that have gold labels, resumable)
bun classify.ts --corpus dr-cli --backend clef-flash
bun classify.ts --corpus dr-cli --backend clef
bun classify.ts --corpus dr-cli --backend claude-haiku --effort low

# 4. Report
bun report.ts --corpus dr-cli

# Tier 0 (Phase 2): structural facts per card, the cbm analyzer's rules against gold, rules in the run
bun facts.ts --corpus fastapi                     # decorators, importers, methods, usage -> facts.jsonl
bun tier0-report.ts                               # free: each rule's agreement with gold -> data/tier0-report.md
bun classify.ts --corpus fastapi --backend clef --kind-narrow --tier0 --tag v2-kind-tier0
```

Further `classify.ts` flags: `--tier0` applies the Tier-0 rules from `spec/dist/analyzers/cbm.json`
(engine: `cli/src/analyzers/tier0-rules.ts`), so a deciding rule answers without a model call and a
narrowing rule restricts the layer and type choices; `--facts` adds the `facts.jsonl` facts and a
placement line to the state; `--criteria core` drops the "Use X instead when" sentences from the
element-type criteria (they remain in `x-dr-distinguish`). Facts live beside the cards, not in
them, so adding facts never resamples cards and the gold labels stay valid.

## What a card contains

Symbol kind, name, qualified name, file and lines, signature, docstring, flags (exported,
entry point, complexity), inheritance, callers and callees (from CALLS edges), the file's
imports, environment variables read, routes handled, HTTP calls made, and a source excerpt.
`renderState()` in `lib/state.ts` turns a card into the text every backend sees, capped at
`--source-lines` (40 for classifiers, the full stored excerpt for gold labeling).

## Questions asked

- **layer** (choice over the 13 layers plus `none`), criteria from `lib/spec.ts`
- **element_type** (choice over the predicted layer's types plus `none`), criteria from the
  spec node-schema descriptions
- **significance** (score, 5 levels)
- six **concern** yes/no questions: authentication, authorization, data_persistence,
  external_integration, observability, user_interface

Layer criteria are the `description` of each layer in `spec/dist/*.json` (the layer
definitions added to `spec/layers/*.layer.json` in October 2026); the harness refuses to run
against a placeholder description. Element-type criteria are the node-schema descriptions.

## Notes

- CBM 0.10.x returns text tables from `query_graph` unless `format: "json"` is passed, and
  its Cypher dialect ignores `LIMIT` and aggregations, so the harness pulls whole edge sets
  and joins in memory.
- Gold labels come from Claude, so "accuracy" measures agreement with a strong model that
  saw more context, not ground truth. Spot-check `report.md`'s disagreement table.
- `gold.jsonl` is the charter-labelled set (Opus 5.5 with `spec/DESIGN_CHARTER.md` in context,
  October 2026). The earlier set without the charter is kept as `gold@baseline.jsonl`;
  `gold-diff.md` per corpus compares them, and `report.ts --gold baseline` scores against it.
