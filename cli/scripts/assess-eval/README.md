# assess-eval

Experimental harness for the assessment pass: a stage after extraction that asks whether the
model it produced is complete. Design and experiment plan:
[docs/analyzers/SELF_ASSESSMENT_DESIGN.md](../../../docs/analyzers/SELF_ASSESSMENT_DESIGN.md).
Results: [docs/analyzers/SELF_ASSESSMENT_RESULTS.md](../../../docs/analyzers/SELF_ASSESSMENT_RESULTS.md).

Not a `dr` command. Nothing here calls a model or writes to a DR model: it reads model YAML, the
compiled spec (`spec/dist`), the CBM edge mapping, and, when codebase-memory-mcp has an index for
the model's repository, the code graph.

## Run

From this directory, with the CLI's dependencies installed (`cd cli && npm install`):

```bash
M="viewer=~/workspace/documentation_robotics_viewer,context-studio=~/workspace/context-studio,heimdall=~/workspace/heimdall,stagecraft=~/workspace/stagecraft"
bun ledger.ts --models $M        # experiment 1: the ledger and each finder's volume
bun seeded.ts --models $M        # experiment 3: seeded gaps
bun label-sheet.ts --models viewer=~/workspace/documentation_robotics_viewer,context-studio=~/workspace/context-studio   # experiment 2: the sheet to fill in
bun witnesses.ts --models $M     # track B: the question bank's witnesses (--check validates questions.json only)
bun score.ts --model heimdall --repo ~/workspace/heimdall   # track C: score a model review (RUNBOOK.md step C)
```

`score.ts` reads one repository's review: its `assess/before-*` and `assess/after-*` tags (latest
by default, or `--before`, `--after`), the `review-questions` and `review-open` changesets as
staged, the logs in `data/<model>/`, and the session transcripts under `~/.claude/projects` for
token use (`--no-transcripts` skips them).

`--models` takes `name=path` pairs; a path is a repository root or a model directory.
`DR_ASSESS_MODELS` is read when the flag is absent. `--no-code` skips the code index. The reports
record each model's commit, so a run can be tied to the model it read.

The code finders need a current index. They do not build one: index the repository first
(`dr analyzer index`, or the `codebase_index` MCP tool).

## Files

| File             | What it does                                                                     |
| ---------------- | -------------------------------------------------------------------------------- |
| `catalog.ts`     | The relationship catalog, and which types a mapped CBM edge can produce          |
| `model.ts`       | A model as plain data, and `ablate` to cut holes in it                           |
| `ledger-core.ts` | The gap ledger: layer-pair rows and relationship-type rows                       |
| `finders.ts`     | Finders that need only the model: peer patterns, fleet prior, checks, name joins |
| `checks.json`    | The starter question bank, each question as a deterministic check                |
| `code-graph.ts`  | Finders that read the code index: edge, path and frontier probes, the residual   |
| `run.ts`         | Flags, model loading, one pass of every finder                                   |
| `ledger.ts`      | Experiment 1 report                                                              |
| `seeded.ts`      | Experiment 3: trials, scoring and report                                         |
| `label-sheet.ts` | Experiment 2 sheet (`data/pair-labels.csv`); keeps verdicts already filled in    |
| `questions.json` | The review question bank (track B), with its witnesses                           |
| `witnesses.ts`   | Validates the bank against the spec; writes each model's witnesses for the agent |
| `RUNBOOK.md`     | The model review protocol the agent follows (track C, steps A to C)              |
| `score.ts`       | Track C: precision, verdicts, spec gaps and tokens per question of a review      |

## Data

- `data/ledger-report.md`: experiment 1. The per-model dumps beside it (`data/<model>/ledger.json`,
  `data/<model>/findings.json`) name elements and files of the repositories assessed, so
  `data/.gitignore` keeps them local.
- `data/seeded-report.md`, `data/seeded-results.json`: experiment 3.
- `data/pair-labels.csv`: experiment 2, filled in by the maintainer.
- `data/witness-report.md`: the bank's witness counts per model. The per-model
  `data/<model>/witnesses.*`, `answers.jsonl` and `open.jsonl` stay local.
- `data/<model>/score-report.md`, `data/<model>/score.json`: `score.ts`, local like the logs it
  reads (`answers.jsonl`, `open.jsonl`, `rejected-by-rule.jsonl`, and `spec-gaps.json`, which
  places spec-gap verdicts on the roadmap's register rows when the log does not name one).

## Reading a finding

Each finder reports at the precision it has: a `relationship` (source, predicate, target), a
`link` (two elements and the relationship types the catalog allows between them), a `shape` (an
element lacking a relationship of some predicate to some type), a `type` (a relationship type the
model does not use), a `pair` (two layers with nothing between them), or an `element` (code that
may be a missing element). The seeded-gap scoring credits a finder at its own level and every
coarser one.
