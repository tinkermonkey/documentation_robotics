# Assessment pass: results

Results of the experiments in [SELF_ASSESSMENT_DESIGN.md](SELF_ASSESSMENT_DESIGN.md), newest
last. The harness is `cli/scripts/assess-eval/`; its README has the commands. Nothing here used a
model call.

## 1. The ledger and the free finders' volume (2026-11-20)

Experiment 1, without its two control runs of the manual prompt, which need model spend and have
not been run. Four models from the local checkouts, spec 0.14.0, code indexes refreshed the same
day. Full tables: `cli/scripts/assess-eval/data/ledger-report.md`.

| Model          | Commit   | Elements | Relationships | Layers | Linked pairs, both populated | Empty | Cross-layer types instantiable | Unused | Low | Open, with an edge route | Open, no edge route |
| -------------- | -------- | -------- | ------------- | ------ | ---------------------------- | ----- | ------------------------------ | ------ | --- | ------------------------ | ------------------- |
| viewer         | 42839b2  | 1,124    | 1,567         | 13     | 70                           | 33    | 228                            | 163    | 19  | 96                       | 86                  |
| context-studio | 25484715 | 1,313    | 2,807         | 13     | 70                           | 31    | 180                            | 101    | 26  | 62                       | 65                  |
| heimdall       | 5d20eb9  | 131      | 185           | 9      | 33                           | 25    | 56                             | 43     | 3   | 29                       | 17                  |
| stagecraft     | 0566406  | 1,970    | 623           | 4      | 6                            | 3     | 12                             | 5      | 3   | 6                        | 2                   |

"Low" is a relationship type that under a fifth of its source type's elements have. "Open" is
unused or low. Following the mapping's preference order, a mapped CBM edge can produce 183 of the
393 cross-layer relationship types.

What each free finder reports on the models as they stand. These findings are not validated; the
count is what a reviewer or a model would be handed.

| Model          | Empty pairs | Open types | Peer pattern | Fleet prior | Review checks | Name join | Same symbol | Edge probe | Path probe |
| -------------- | ----------- | ---------- | ------------ | ----------- | ------------- | --------- | ----------- | ---------- | ---------- |
| viewer         | 33          | 182        | 15           | 28          | 172           | 1         | 2           | 103        | 112        |
| context-studio | 31          | 127        | 141          | 30          | 557           | 63        | 2           | 21         | 369        |
| heimdall       | 25          | 46         | 1            | 43          | 63            | 8         | 2           | 6          | 6          |
| stagecraft     | 3           | 8          | 11           | 11          | 119           | 0         | 0           | 57         | 197        |

How much of each model the code index can be tied to, through source references:

| Model          | Elements with a source reference | Tied to index nodes |
| -------------- | -------------------------------- | ------------------- |
| viewer         | 1,062                            | 149                 |
| context-studio | 1,082                            | 921                 |
| heimdall       | 120                              | 61                  |
| stagecraft     | 1,968                            | 143                 |

The viewer and stagecraft are low for one reason: their test cases (824 and 1,806 elements) are
`it()` callbacks, which have no node in the index. In the viewer a further 63 elements share a
file with more than three other file-level elements and are left untied.

## 2. Seeded gaps: what the free finders recover (2026-11-20)

Experiment 3. A trial cuts one hole in a model: every relationship between two layers, every
relationship of one type, a tenth or a half of one type, or one element with its relationships.
Every free finder runs on what is left. Only findings the hole caused are scored (a finding the
finder already made on the uncut model is left out). 827 trials on the four models as they are,
and 610 more after first removing a random half of each model's relationships.
Full tables: `cli/scripts/assess-eval/data/seeded-report.md`.

A removed relationship counts as recovered at one of three levels:

- **exact**: a finding names the relationship (source, predicate, target);
- **link**: a finding names the two elements, with the removed type among the candidates;
- **shape**: a finding names one end, the predicate and the other end's type ("this operation has
  no `realizes` to an application function").

Percentages are means over trials, so one large hole counts once.

### Between layers

The maintainer's question reproduced: all relationships between two layers removed.

| Model          | Trials | Ledger flags the pair | Ledger flags the type | Fleet prior flags the type | Free finders: shape | Free finders: exact |
| -------------- | ------ | --------------------- | --------------------- | -------------------------- | ------------------- | ------------------- |
| viewer         | 24     | 100%                  | 69%                   | 28%                        | 25%                 | 9%                  |
| context-studio | 31     | 100%                  | 79%                   | 23%                        | 28%                 | 16%                 |
| heimdall       | 4      | 100%                  | 80%                   | 51%                        | 32%                 | 0%                  |
| stagecraft     | 3      | 100%                  | 67%                   | 64%                        | 34%                 | 1%                  |

All four kinds of hole between layers, by whether a mapped edge can produce the removed type.
Each cell is shape / exact.

| Model          | Edge route | Trials | Review checks | Name join | Edge probe | Path probe | Peer pattern | Any of them |
| -------------- | ---------- | ------ | ------------- | --------- | ---------- | ---------- | ------------ | ----------- |
| viewer         | yes        | 76     | 15% / 0%      | 5% / 4%   | 3% / 2%    | 2% / 1%    | 0% / 0%      | 23% / 8%    |
| viewer         | no         | 33     | 6% / 0%       | 4% / 4%   | 0% / 0%    | 0% / 0%    | 0% / 0%      | 10% / 4%    |
| context-studio | yes        | 69     | 29% / 0%      | 4% / 3%   | 0% / 0%    | 11% / 10%  | 3% / 0%      | 40% / 12%   |
| context-studio | no         | 95     | 11% / 0%      | 13% / 13% | 0% / 0%    | 2% / 1%    | 8% / 0%      | 24% / 15%   |
| heimdall       | yes        | 12     | 63% / 0%      | 0% / 0%   | 0% / 0%    | 0% / 0%    | 0% / 0%      | 63% / 0%    |
| heimdall       | no         | 3      | 0% / 0%       | 0% / 0%   | 0% / 0%    | 0% / 0%    | 0% / 0%      | 0% / 0%     |
| stagecraft     | yes        | 23     | 15% / 0%      | 0% / 0%   | 1% / 1%    | 0% / 0%    | 5% / 0%      | 20% / 1%    |

### Within a layer

| Model          | Edge route | Trials | Review checks | Edge probe | Path probe | Peer pattern | Any of them |
| -------------- | ---------- | ------ | ------------- | ---------- | ---------- | ------------ | ----------- |
| viewer         | yes        | 50     | 20% / 0%      | 27% / 21%  | 5% / 0%    | 6% / 0%      | 47% / 21%   |
| viewer         | no         | 14     | 43% / 0%      | 0% / 0%    | 4% / 1%    | 11% / 0%     | 47% / 1%    |
| context-studio | yes        | 83     | 17% / 0%      | 0% / 0%    | 7% / 1%    | 10% / 0%     | 28% / 1%    |
| context-studio | no         | 80     | 6% / 0%       | 0% / 0%    | 7% / 2%    | 21% / 0%     | 31% / 2%    |
| heimdall       | yes        | 17     | 12% / 0%      | 24% / 21%  | 4% / 0%    | 0% / 0%      | 37% / 21%   |
| heimdall       | no         | 15     | 0% / 0%       | 0% / 0%    | 0% / 0%    | 13% / 0%     | 13% / 0%    |
| stagecraft     | yes        | 22     | 5% / 0%       | 17% / 13%  | 42% / 0%   | 9% / 0%      | 56% / 13%   |
| stagecraft     | no         | 5      | 0% / 0%       | 0% / 0%    | 0% / 0%    | 40% / 0%     | 40% / 0%    |

### Removed elements

240 trials on the models as they are; in 129 the removed element was tied to index nodes.

| Finder         | Removed element's code in the top 20 | Top 50 | Top 100 |
| -------------- | ------------------------------------ | ------ | ------- |
| Frontier probe | 8 of 129                             | 11     | 14      |
| Residual       | 1 of 129                             | 3      | 5       |

In 59 of the 240 trials a neighbour of the removed element was flagged as lacking the kind of
link it had lost.

### Of the new findings a hole caused, the share that point at it

Pooled over every trial. This is not precision: it says a finder reacts to the hole and to little
else, and nothing about the findings it makes on the uncut model.

| Finder         | New findings | Point at the hole |
| -------------- | ------------ | ----------------- |
| Same symbol    | 69           | 100%              |
| Peer pattern   | 372          | 96%               |
| Name join      | 341          | 95%               |
| Path probe     | 886          | 78%               |
| Edge probe     | 589          | 77%               |
| Review checks  | 3,732        | 59%               |
| Frontier probe | 303          | 10%               |

### What it shows

- **The ledger asks the right question every time.** An emptied layer pair is flagged in all 62
  trials, and the type behind it in 67% to 80%. The misses are types that were already open
  before the cut.
- **The free finders do not answer it.** For an emptied layer pair they name the relationship
  itself for 0% to 16% of what was removed, and one end with the kind of link for 25% to 34%. The
  design's hope that "the free finders recover most seeded gaps" is not met. Between layers, the
  model-call strategies carry most of the work, and their budget should be planned on that basis.
- **Review checks find the most and need the most care.** They are the largest single
  contributor between layers, they never name the other end, and 14 questions produce 63 to 557
  findings on the uncut models. The bank was written after reading the viewer and Context Studio
  models, so their numbers there are in-sample; heimdall and stagecraft are not.
- **Name joins work where nothing else can.** On Context Studio's types with no edge route a
  name join names the exact relationship in 13% of trials, and 95% of the findings a hole causes
  point at it. That is the `maps-to` case from the design, measured.
- **The edge probe works within a layer on models extraction built, and nowhere else.** It names
  21% of removed relationships exactly in the viewer and heimdall and 13% in stagecraft, and
  none in Context Studio. The reason is in the next section.
- **Peer patterns only see small holes.** When a tenth of a type goes missing they flag 24% to
  48% of it within a layer and 0% to 23% between layers. They flag nothing once a type or a pair
  is emptied, or once the model is thinned by half.
- **Missing elements are not found.** A ranked list of unmodelled code puts a removed element's
  code in its top 100 in 14 of 129 trials. Ranking the whole codebase is the wrong shape for
  this; re-running extraction and reading the cards it would add is the obvious thing to try
  next, and is not built.
- **Same-symbol joins and the dependants ranking add almost nothing** and can be dropped.
- **Thinning the model by half changes little** apart from silencing peer patterns: review
  checks and the probes hold or rise slightly.

## 3. What the edge probe found about the models (2026-11-20)

Running extraction's edge lookup over the elements each model already has, on the uncut models:

| Model          | Relationships | Of an edge-route type, both ends tied to code | The edge lookup produces the same relationship | It produces one the model lacks | Edge and element-pair combinations with no catalog type |
| -------------- | ------------- | --------------------------------------------- | ---------------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| viewer         | 1,567         | 191                                           | 88                                             | 103                             | 2,544                                                   |
| context-studio | 2,807         | 554                                           | 0                                              | 21                              | 1,854                                                   |

- **Context Studio's relationships are not the ones the code graph gives.** Of 554 relationships
  that a mapped edge could in principle produce, between elements the index can see, the lookup
  reproduces none. That model was written by agents reading the code, and its links are sound to
  a reader, but they are not edge-shaped: elements are placed on symbols whose edges land on types
  the catalog does not link that way. A seeded gap in such a model tests agreement with what an
  agent wrote, which a code probe cannot be expected to recover.
- **Most code edges between modelled elements have no relationship type to become.** The largest
  groups in the viewer: a sub-view calling an application component (117 edges), an application
  service calling an application interface (104), a component using a sub-view (96). In Context
  Studio: a data config using another (114), a view calling a data config (63). Each is either a
  missing catalog type, a missing preference in the edge mapping, or elements given the wrong
  type. They have not been read one by one.

## Limits

- The removed relationships are whatever the models hold. Nothing checks that they are right.
- The review checks are in-sample for the viewer and Context Studio.
- "Tied to index nodes" depends on source references; where they name only a file shared by many
  elements, the element is invisible to the code finders.
- The findings on the uncut models (the second table of section 1) are counted, not judged.
  Their precision is the pooled-adjudication experiment's to measure.
- The fleet prior has three other models to draw on.

## Not done

- Experiment 1's control: the cost of the manual prompt on two models (model spend).
- Experiment 2: the maintainer's labels for the 64 empty pairs. The sheet is
  `cli/scripts/assess-eval/data/pair-labels.csv`.
- Scenario threads (S5), which overlap the path probe and were left for after it was measured.
