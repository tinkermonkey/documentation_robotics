# Spec enrichment pipeline (Phase 1)

Direction A of [docs/EXTRACTION_STRATEGY.md](../../../docs/EXTRACTION_STRATEGY.md): use the
Claude Message Batches API to give every element type an operational definition, every
attribute a description, and every relationship a meaning and an evidence statement. The
measurable target is **type-given-layer accuracy** in the classification eval harness
(`../classify-eval`): better definitions should let a decision model pick the right element
type more often from the same state cards and gold labels.

Self-contained bun package (own `package.json`); shares env, IO and Claude helpers with the
eval harness via relative imports.

## Pipeline

```
inventory.ts               measure thin descriptions / missing attribute docs / boilerplate relationships
propose-nodes.ts           per type: definition, distinctions from siblings, standard reference,
                           3 code-evidence signals, descriptions for undocumented attributes
propose-relationships.ts   per source type: one meaning sentence + one evidence sentence per relationship
apply.ts                   write proposals into spec/schemas/** (dry-run shows the diff)
```

Then rebuild (`npm run build:spec` at the repo root, `npm run build` in `cli/`) and measure:

```bash
cd ../classify-eval
bun classify.ts --corpus dr-cli --backend clef --tag enriched-v1 --force
bun report.ts --corpus dr-cli            # compare clef vs clef@enriched-v1
```

## Usage

```bash
bun inventory.ts                                  # table + data/inventory.json
bun propose-nodes.ts --layer application --sync   # pilot: direct calls
bun propose-nodes.ts --submit                     # all layers via Batch API (half price)
bun propose-nodes.ts --status / --fetch
bun propose-relationships.ts --submit             # uses enriched node definitions when present
bun apply.ts --layer application --dry-run
bun apply.ts --layer application
```

Proposals live in `data/proposals/{nodes,relationships}/<layer>/*.json` and keep the previous
description, so the diff is always reviewable. Batch ids are in `data/batches/`.

## What apply writes

Node schemas:

- `description` <- the definition followed by "Use <Sibling> instead when ..." sentences
- `x-dr-standard` <- standard reference (string)
- `x-dr-evidence` <- three code-evidence signals (array)
- `x-dr-distinguish` <- sibling type id -> distinguishing clause
- attribute `description` filled where missing (never overwritten unless `--overwrite-attributes`)

Relationship schemas:

- `description` <- the meaning sentence (replaces `Defines relationship: ...`)
- `x-dr-evidence` <- `[evidence sentence]`

`spec/scripts/build-spec.ts` passes relationship `description` and `evidence` through to
`spec/dist` (previously relationships compiled to flat data with no description at all). AJV in
the CLI runs with `strict: false`, so the `x-dr-*` keywords on node schemas are tolerated.

## Triage loop (maintainer notes -> decisions)

Every proposal carries free-text `notes`. The triage loop turns them into decisions and is
meant to be re-run as models change:

```
split-notes.ts      Claude splits each compound note into atomic claims  -> data/triage/claims.jsonl
triage.ts           a backend decides validity / category / severity / fix scope per claim
                    (clef, clef-flash, claude-haiku, claude-sonnet, claude-opus; --evidence adds a
                    deterministic fact pack; --tag keeps configurations apart)  -> decisions-<backend>[@tag].jsonl
triage-report.ts    per-layer tables for one configuration                     -> report-<backend>.md
triage-bench.ts     scores every configuration against human gold              <- bench-gold.jsonl
```

`bench-gold.jsonl` holds adjudicated claims (validity, category, severity, fix scope, rationale);
add to it as you review layers, and re-run `triage-bench.ts` to see how each backend tracks you.
`--evidence` appends, per claim, how every type in the layer declares a named attribute and the
exact relationship schemas between the named types; on the first ten adjudicated claims it took
Clef from 40% to 70% validity agreement at the same cost. `--charter short` (the default) prepends
the one-paragraph summary from `spec/DESIGN_CHARTER.md`; `full` prepends the whole charter, which
measured slightly worse on accuracy, and `none` disables it.

### Reflection: the sorting questions

For a claim about a relationship `src pred dst`, a maintainer's natural check is "if `src`
does not `pred` `dst`, then what does?". `triage-reflect.ts` asks a decision model exactly
that before it judges the claim:

```
triage-reflect.ts   stage 1: three sorting questions per relationship claim
                      source_for    which type is the best source of 'pred dst'?
                      target_for    what does 'src pred' best point to?
                      predicate_for which predicate best relates src to dst (incl. 'reverse:p')?
                    each offered the current answer, the catalog's other answers, the siblings of
                    the current answer (capped, --top 8) and 'none'
                    stage 2: the normal triage questions with the answers appended to the state
                    -> decisions/<backend>@reflect/<layer>.jsonl  and  reflect/<backend>/<layer>.jsonl
                    --extra-triples: second pass over the further relationships a claim names,
                    re-deciding the claim with every reflection -> decisions/<backend>@reflect2/
reflect-summary.ts  outcome (reproduced / no_better / alternative) x validity, the transitions
                    against a baseline configuration, and every concrete alternative found
reflect-plan.ts     groups the alternatives per catalog triple and classifies the implied schema
                    change (remove-duplicate, rename-predicate, reverse, retarget, compound,
                    conflict) with a probability threshold sweep -> reflect/<backend>/plan-<backend>.{json,md}
apply-reflect-plan.ts  applies selected kinds above a probability (--select remove-duplicate:0.6,reverse:0.7,
                    rename-predicate:0.7): renames write the new schema and delete the old, reversals
                    write the swapped schema unless it exists, duplicates are deleted once the replacement
                    is confirmed; every action is recorded in reflect/<backend>/applied-<record>.json,
                    the input for the model migration. Retargets, compound changes and conflicts are
                    never applied automatically.
apply-walk.ts       applies a maintainer's per-layer walk of those rows (--layer <id>), read from
                    reflect/clef/walk-<layer>.jsonl: one line per row with decision keep | delete |
                    rename | retarget | reverse, the replacement triple, optional extra triples to add,
                    and the rationale; writes reflect/clef/applied-walk-<layer>.json in the tier format
```

The walk file doubles as adjudicated gold for the relationship claims it covers: each line names
the triple, the decision and why, and who decided.

Deciding in bulk: `sheet-export.py` writes `reflect/clef/walk-sheet.xlsx`, one sheet per
unwalked layer and one row per plan row, with the framing (current relationship and description,
the catalog's other predicates between the pair in both directions, the claims, Clef's three
sorting answers, the plan's replacement, a mechanical suggestion) in read-only columns and four
yellow columns to fill: Outcome (dropdown: keep, delete, rename, reverse, retarget, defer),
Replacement, Also delete, Notes. `sheet-import.py --layer <id>` turns the filled rows into
`walk-<layer>.jsonl` (rows already decided there are pre-filled in the sheet and keep their
numbers), and `apply-walk.ts --layer <id>` applies them. Both Python scripts need `openpyxl`
(`python3 -m venv .venv && .venv/bin/pip install openpyxl`).

Context Studio as the review queue (tinkermonkey/context-studio#1366, Gate B #1370):
`proposal-export.ts --layer <id>` writes `reflect/clef/proposals/<layer>.json`, a change
proposal in Context Studio's shape (format `dr-reflection-plan/1`): one operation per plan row,
delete / update / create on the relationship's property definition (identified by the DR
relationship id), the claims and sorting answers as evidence (`claim_id`), the plan's p as
probability, status always pending and scope null (Context Studio computes it), and a `dr`
block Context Studio ignores. A row whose replacement already exists as a schema is exported as a
delete, since Context Studio has no merge. Rows already decided in the walk file carry the
operations their decision implies, still pending, with the decision in `dr.walk_decision`.
`proposal-import.ts --layer <id> --decisions <file>` joins Context Studio's decision export
({seq, status, reason, ...}) to the proposal by seq and writes `walk-<layer>.jsonl` (applied
delete -> delete, applied update -> rename / reverse / retarget by what changed, applied create
-> add, rejected -> keep; undecided skipped); `--simulate-walk` does the same from
`dr.walk_decision` as a round-trip check. The contract is in the header of `proposal-export.ts`;
the api layer is the fixture (`proposals/api.json`, 64 operations).

The outcome is the useful signal: `reproduced` (all three answers are the current triple) and
`no_better` (the alternatives were `none` or the current value) argue for keeping the
relationship, `alternative` names a concrete different source, destination or predicate to weigh
against the claim's proposed change. Claims without a relationship id among `affected_ids` are
skipped; only Clef backends are supported.

## Governance

Proposals are reviewed per layer and land as spec PRs with a changelog entry. The `notes`
field in each proposal collects the model's concerns about the type or relationship itself
(overlaps, misnamed attributes, redundant predicates); read them before applying.
