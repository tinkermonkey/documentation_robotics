# Model review runbook

The protocol for track C of
[SELF_ASSESSMENT_ROADMAP.md](../../../docs/analyzers/SELF_ASSESSMENT_ROADMAP.md): one repository's
model reviewed with the question bank (`questions.json`, explained in
[REVIEW_QUESTION_BANK.md](../../../docs/analyzers/REVIEW_QUESTION_BANK.md)), then reviewed openly,
then judged by the maintainer. Any MCP-capable coding agent can follow it: everything it needs is
the dr MCP server, the codebase-memory MCP server, the source, and the files named here.

`<model>` below is the short name used with `--models` (for example `heimdall`). The files under
`data/<model>/` name the repository's elements and files and stay local (`data/.gitignore`).

## 0. Freeze

1. In the target repository, the working tree is clean, no changeset is active, and the model is
   at the spec version this harness reads (`project_status`).
2. Tag the starting point: `git tag assess/before-<YYYY-MM-DD>`.
3. Refresh the code index: `codebase_index` with `wait: 30`, then `status: true` until it is done.
4. Note the bank version in use (`questions.json`, `version`). It does not change during a round.
5. From this directory:

   ```bash
   bun witnesses.ts --models <model>=<repository path>
   ```

   This writes `data/<model>/witnesses.md`, the step A input.

## Step A: the questions

Work through the bank and nothing else. Do not fix what no question or ledger row asks about. Note
it in the log as `outside`, so step B and the maintainer can see it.

1. **Open the changeset.** `changeset_create`, named `review-questions`, with the intent "Answers
   to review question bank <version>". Confirm the name with the maintainer first.
2. **Pre-pass P0.** Run `codebase_extract` with no `since`. It stages the element cards extraction
   would add. List the cards the model lacks, then `changeset_discard` the as-built changeset and
   `changeset_activate` `review-questions` again. Group the missing cards by layer. Each group is
   worked through under the question whose layers cover it (Q4 for application, Q7 for data, Q9
   for technology, and so on), not on its own.
3. **Each question, Q1 to Q13 in order:**
   1. Write a `begin` line to the log (below).
   2. Check that it applies. `witnesses.md` says "Applies", "Does not apply", or "Applies if the
      code shows it: …". For the last, check the code. If the question does not apply, log
      `not-applicable` and move on.
   3. Run the code witnesses: the CBM query, compared with the model.
   4. For every fired witness item, every code-witness difference, every ledger row assigned to the
      question and every P0 card in its group, find the evidence and decide.
      - Stage what is missing: `model_add` for elements and `relationship_add` for relationships,
        batched (`elements: [...]`, `relationships: [...]`). Check each type with `spec_type`, and
        follow the layer's modelling rules.
      - Give every staged element a source reference. Use `sourceProvenance: "extracted"` when it
        points at the code that is the element. Use `"inferred"` when the element is concluded
        rather than read, for example goals, outcomes, capabilities, personas and threats. Such
        intent may be proposed without a document naming it, and the log says why.
      - Large lists, for example hundreds of test cases with no coverage target: work by file or
        module, and log one line per group.
   5. Write an `end` line to the log.
4. **Close.** Run `changeset_brief` and resolve whatever it counts as unwired. Then
   `changeset_deactivate`.

### The answer log

`data/<model>/answers.jsonl`, one JSON object per line:

```json
{"t":"2026-11-21T10:04:00Z","q":"Q7","event":"begin"}
{"t":"…","q":"Q7","witness":"collection-accessed","item":"data-store.collection.users","verdict":"wired","staged":["application.applicationfunction.save-user accesses data-store.collection.users"],"provenance":"extracted","evidence":["src/db/users.ts:42"],"note":""}
{"t":"…","q":"Q7","ledger":"type data-store.collection.maps-to.api.response (unused)","verdict":"expected-absent","evidence":[],"note":"no API returns a stored view directly"}
{"t":"…","q":"Q7","p0":"data-store.collection.sessions","verdict":"added","staged":["data-store.collection.sessions"],"provenance":"extracted","evidence":["migrations/004.sql"]}
{"t":"…","q":"Q7","event":"end"}
```

Each item has exactly one of `witness`, `ledger` and `p0`. The `verdict` is one of:

| Verdict           | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `wired`           | Relationships staged between existing elements                             |
| `added`           | Elements staged (with their relationships)                                 |
| `expected-absent` | The system genuinely has none; `note` says why                             |
| `blind-spot`      | The code cannot tell; `note` says what would                               |
| `spec-gap`        | The spec has no type or triple for it: a candidate Context Studio proposal |
| `unsure`          | Undecided; `note` says what is in doubt                                    |
| `not-applicable`  | The question does not apply (question level only)                          |
| `outside`         | Something noticed that no question asked about; not staged in step A       |

The `begin` and `end` timestamps attribute the session's token use to each question afterwards,
from the session transcript.

## Step B: open review

A fresh session that has not seen step A's reasoning.

1. Read step A's proposals with `changeset_show` on `review-questions`, so as not to repeat
   them. Then `changeset_create` `review-open`: step B stages there.
2. The prompt is the manual one, with no bank:

   > Review this architecture model against the code as an experienced software architect. Make it
   > complete: whatever the system has that the model lacks, and whatever the model gets wrong.
   > The changeset `review-questions` already proposes changes; don't repeat them.

3. Log in `data/<model>/open.jsonl`, in the same format with `q` set to a short category of your own
   choosing (for example `"deployment"` or `"error handling"`). The categories show what the bank
   is missing.
4. Record the session's total tokens at the end. This is experiment 1's control: the cost of the
   manual prompt.

## Step C: maintainer review

The maintainer reviews both changesets in the viewer (`review_open`), not one item per turn.
Accepted items land; rejected ones are noted with a reason. Then:

1. Tag the result: `git tag assess/after-<YYYY-MM-DD>`.
2. Score the run (the scoring script is not written yet): per question, precision (accepted over proposed) and its share of everything
   accepted from steps A and B; per verdict, the count. Step B's categories that no question
   covers are candidates for the next bank version.
