---
name: dr_change_planning
description: Plan a code change as a staged DR changeset through the dr MCP server, pressure-test it against the model, build from its brief, and verify the build against it. Use when asked to plan, design or scope a change in a project with a DR model.
triggers:
  [
    "plan this change",
    "plan the change",
    "plan a change",
    "plan this feature",
    "how should we build",
    "scope this change",
    "design this change",
    "draft a changeset",
    "changeset brief"
  ]
---

# Plan a change as a DR changeset

In a project with a DR model (`documentation-robotics/model/`), a plan is a staged changeset, not a
prose document. The changeset says what the change will build. The model says what is built. The
graph checks the plan for you. The full design is `docs/CHANGE_MODELING.md` in the DR repository.

## Before you start

- You need the `dr` MCP server. Its tools show up as `mcp__plugin_dr_dr__<tool>` from the `dr`
  plugin, or `mcp__dr__<tool>` when the server is registered by hand as `dr`. If they are missing,
  tell the user to install the `dr` plugin (see `integrations/claude_code/docs/MCP_SERVER.md`)
  and stop. Don't fall back to prose.
- Staging writes files under `documentation-robotics/changesets/`. If the session is in plan mode,
  say that the plan will be a changeset and leave plan mode before staging.
- If the project has no model yet, propose a name and confirm it with the human before
  `project_init`. Then ask whether to bootstrap the model from the code now or let it grow with
  each change, and wait for their answer.
- When `codebase_extract` returns more cards than a page, they come grouped (`undecided.groups`,
  `byKind`), not listed. Decide by group first: `decide: [{where, as, reason}]` with `preview: true`
  returns each item's count and a sample; show the developer the rules you propose, then apply them.
  `keep: true` records a rule in `documentation-robotics/extraction-rules.yaml`: commit that file.
  A `none` rule leaves what Tier 0 decided as an element to Tier 0 unless it says
  `overrideTier0: true`; `ruleWarnings`, at the top of the answer, names each rule and how many such
  symbols it matched, so read it before applying. A rule kept before CLI 0.9.0 that should go on
  rejecting them needs `overrideTier0: true` added in the rules file: the warning names the rule. `where.name` matches the bare name, `where.symbol`
  the card's `symbol` (`Class.method`), and `where.file` a path exactly, with no folder or glob
  (`app/users/[id]/page.tsx` names only itself; `where.files` takes a path, folder or glob). A typed
  item takes `attributes` for what its type requires
  and the code can't give. Add `view` to the call to get the cards it leaves. A page of cards states a
  candidate list several cards share once, in `undecided.candidateLists`, and each such card names
  it in `candidateList` instead of listing `candidates`.
  Read what is left with `view`.
- When `codebase_extract` returns cards (in a bootstrap, or when you verify), ask the developer about
  the ones you can't place with confidence: whether a card is a model element at all, which type it
  is, or whether to reject it. Don't guess. Collect them and ask once, in one short list (the card,
  your best guess, the question), then stage or reject from the answers. `reject` takes `{card}`,
  `{files: "docs/**"}` for every card in a folder that isn't product code, or
  `{relationship: {source, predicate, target}}` for a relationship extraction staged that the code
  doesn't have; each needs a `reason`, and later runs leave them out. Recorded rejections are this
  checkout's (`.dr/` is not in git); `keep: true` on an item writes it as a rule in the rules file
  instead. A `files` item skips cards an element names and those its `except` lists, and with
  `decide` in the same call it covers only the cards the decide items leave. `preview: true` with
  `reject` says what it would record and records nothing. When the checkout opted in to
  Tier 1, cards carry its suggestion (`tier1`: band, layer, type, p), accept band first: show the
  developer those layers and types, and once they agree call `codebase_extract` with `acceptTier1: true`
  to stage the accept band (reject the ones they disagree with first). Tell them what `tier1.notice`
  says (who received code, and the month's spend). If `tier1.mode` is `stage` (the model's
  thresholds are verified on held-out labels), the run has already staged the accept band itself
  (`origin.confirmed: "auto"`) and hidden the not-element band: tell the developer how many of each
  (`tier1.staged`, `unchanged.tier1NotElement`, names in `unchanged.tier1NotElementCards`) and let
  them review the staged elements (`changeset_unstage` the ones they disagree with). To see the
  hidden cards, call the run again with `tier1: false`; the developer can switch stage mode off
  with `dr analyzer tier1 set mode suggest`. Don't pass `acceptTier1` then: it is ignored. When `next` suggests folders
  for `.cbmignore`, ask the developer before adding them, and have them commit the file
  (`git add -f .cbmignore`: DR's local exclude hides it until it is tracked), so every checkout
  and clone indexes the same files; DR never edits a tracked `.cbmignore`. When a `since` run reports `range` (it
  reaches far back), check the range with the developer before working through its cards;
  `preview: true` counts a narrower `since` without staging anything.
- `codebase_extract` cards come from the declarations the code index reports (classes, interfaces,
  functions, methods, routes, types). A file is never a card: it is where an element was found,
  recorded as its source reference. So no card arrives for what has no declaration: an entry point
  made of top-level statements (`Program.cs`, `main.tsx`), a file-based route (a Next.js page), a
  top-level constant that holds a store or a schema, or a buildable project (a build manifest). In
  a bootstrap, read the code for these and stage what you find with `model_add`, with `sourceFile`
  and, where there is one, `sourceSymbol`. Never stage an element for a file as such.
- Cards carry documentation evidence when the code has it. A `decision-record` card is an
  architecture decision record: propose the motivation element it states (a principle, constraint or
  assessment, named for what it decides), sourced to the record, or reject it; superseded records
  get no card. A card's `docs` are doc sections that mention its code: write its description from
  them, and use them as evidence for features and requirements. `documentation.describe` lists
  staged elements with no description that the docs describe.
- You never land or discard the plan on your own. Land it (`changeset_commit`) only when the
  human asks you to; git and the PR are the gate, so there is no dialog or token. Apply is not an
  MCP tool. Discard only when they agree.

## The loop

1. **Frame.** `project_status` with `task: "plan"` (code drift is then information, not the step),
   then `changeset_list`: if a changeset for this change exists, `changeset_activate` it and
   continue. Otherwise propose a short kebab-case `name` and the change's `intent`, and confirm both
   with the human before you call `changeset_create` with them (the intent is stored as the
   changeset's description; `description` is accepted for it too). Write the intent as markdown,
   which the viewer and `dr changeset show` keep as written, in this shape:

   ```markdown
   One or two sentences: what the change is for.

   **In scope**

   - `product.feature.order-export`, and the services that realize it
   - the export endpoint and its response schema

   **Done when** an order can be exported as CSV, and the export endpoint is in the API layer.
   ```

   Wait for their answer. Find the goal,
   requirement or feature it serves (`model_search` in motivation, business, product). If there is
   none, stage one, or ask the human what the change is for.

2. **Orient.** `model_search` / `model_show` / `model_trace` for the elements the change touches.
   Inside a changeset these read the plan as it stands (each result carries a change status).
   `model_search` with `excludeLayers: ["testing"]` leaves test sketches out, and with
   `fields: ["name", "description"]` finds words in descriptions; `model_show` with `ids: [...]`
   reads several elements in one call.
   `spec_type` for a type you will add: its required attributes, enums, and the relationships the
   catalog allows to and from it. Within reason, every connection the spec models for a type is
   expected, though not every one will exist: treat the catalog's list as the checklist for each
   element the change adds or alters.
3. **Draft.** Stage the change in every layer it reaches: `model_add`, `model_update`,
   `model_delete`, `relationship_add`, `relationship_delete`. Relationships may join elements that
   exist only in the changeset. When you wire several, use the lists: `model_add` with
   `elements: [...]` (plus `relationships` that may name elements added in the same call), and
   `relationship_add` with `relationships: [{source, predicate, target, properties?}]`. Each list is
   staged in one write; an invalid item is skipped and reported. The result leads with `counts`,
   then `causes`: the items that need attention grouped by what is wrong, each with its true count
   (one missing element named by many links is one cause). Fix each cause and send the whole list
   again: what is already there comes back `unchanged`, so nothing is staged twice (`verbose: true`
   lists every item). `idNotes` says once what id derivation did to some names. A large batch goes
   in a JSON file passed as `file`, not in the call. `model_update` takes a list too
   (`updates: [...]`), and so do `model_delete` (`ids: [...]`) and `relationship_delete`
   (`relationships: [{source, target, predicate?}]`): use them to move or remove several links or
   elements in one call. To put a product workflow step between two others, send it to `model_add`
   with `after` (or `before`): it rewires the `flows-to` links and renumbers `sequence` for you. For
   a planned element with no code yet, send no source fields. Pass `sourceFile` and `sourceSymbol`
   (with `sourceProvenance: "manual"`) only when you know where the code goes. On `model_update`,
   `sourceFile` replaces the element's locations; `addSourceLocation` adds one beside them and
   `removeSourceLocation` removes one.
   Change one attribute with `model_update` `attributePatch`, not by repeating every attribute. Fix a
   mistake with `changeset_unstage` (one element, one relationship, or `source` or `target` alone for
   every staged connection at that end), not by staging the reverse. To drop several, send them as
   `changes: [...]`: one call, one write, a result per item.
4. **Pressure-test.** `changeset_brief`, then `changeset_impact` for anything the brief questions.
   The brief is compact by default; pass `detail: "full"` only when you need every section in full.
   Steps 3 and 4 are a loop: a plan comes into focus over many passes. Each pass, stage a little,
   then:
   - Pass the last brief's `revisionToken` as `since`; read the `delta` first. It covers unstages
     too (`unstaged`). If it warns (a hand-edited `changes.yaml`, or a reach back past the last 200
     unstages), read the brief itself.
   - Work through `unwired` for each element you added or changed. It counts only the links an
     element of that type is expected to have (required, high-strength, or carried by existing elements of the type); the other
     catalog triples come as a separate `optional` count and are not listed by default. An updated
     element whose type and relationships the change leaves alone is counted apart as `preexisting`:
     not this change's gap. The default brief only counts per layer, and `sections` returns only the
     sections it names, so list the expected links with
     `sections: ["unwired"], unwiredLayers: [<the layers the change reaches>]`, narrowed further with
     `layers` or `ids` if you like; it pages with a true total. Where `existingCount` is above 0,
     link an existing element; otherwise decide whether the change needs a new one.
   - Walk `changeset_impact` with `from` set to what you just added, not the whole changeset.
   - Read the plan with `changeset_show`: one line per change by default, narrowed with `layers`,
     `types` or `operations` and paged with `limit` and `offset`; not `detail: "full"`, which
     carries every snapshot.

   Read the brief's gaps:
   - `peer-pattern`: most elements like this one have a connection it lacks.
   - `unconnected`: an added element with no relationships.
   - Intent: a change that reaches no motivation, business or product element.
   - Layers not reached: a new API operation with nothing in data model, testing or APM is a small
     change or an unfinished plan. Decide which.
   - Connections the brief can't flag: for each changed element, compare what `spec_type` says its
     type can connect to with what the plan has. Stage the ones the change needs; leave the ones it
     doesn't, but don't skip the comparison.

   For each gap, either stage what is missing or accept it. Accept a gap with `gap_accept`: the
   element, the triple as the brief names it (`direction`: `outgoing` or `incoming`, `predicate`,
   `otherType`) and the reason. It is staged in the changeset, so the human approves it when the
   plan lands, and it stays on the element after that: later briefs list it under `acceptedGaps`
   (and under `accepted` in `unwired`) instead of as open, and extraction and verification report
   it as contradicted if the code turns out to have the connection. `gap_reopen` takes one back. A
   relationship the catalog marks required can't be accepted. `model_show`, and `spec_type` with
   `element`, show an element's accepted gaps. `model_validate` should pass on the projected model
   (accepted gaps are informational there, never errors).

5. **Review.** Stop and show the human the brief: changes by layer, gaps fixed and gaps accepted,
   impact, code touched. Call `review_open` and give them its `url`: it opens the plan on the graph
   in the viewer, reusing the viewer already running for the project or starting one. The human
   comments on elements there, including ones the plan adds. Read their comments with
   `annotation_list`, answer with `annotation_reply`, revise, and run the brief again. Don't start building until they agree.
   Which changeset is active is per checkout (`.dr/active-changeset`, which git ignores), so it is
   not shared through git: a reviewer who checks out the PR's branch finds the plan staged but not
   active. They read it with `changeset_brief` (`changeset: "<name>"`) or open it with `review_open`
   rather than expect it active; `project_status` with `task: "review"` points at it.
6. **Build.** Build from the brief. At the start of the build, read it with
   `sections: ["changes"]`: each changed element's attributes and changed fields, and its
   connections as `predicate → id` lines. For a large plan, read one layer at a time with
   `sections: ["changes"], layers: ["<layer>"]`, taking the layers from the default brief's
   `byLayer`. A long list comes a page at a time: `page` gives each list's total (`totals`) and how
   many items the answer holds (`returned`), so while `page` has a `nextOffset`, repeat the call with
   `offset` set to it (`more` names the call) until it has none. The default brief's "code touched" list is what you will edit or must not
   break. Keep the changeset staged and commit only the plan's own directory
   (`documentation-robotics/changesets/<id>/`, with the id `changeset_show` reports) on the branch
   with the code. Don't add the whole `changesets/` directory.
   The as-built verification record is created in Verify, after this build commit. If the build has
   to differ from the plan,
   change the plan to match and say why. Don't verify during the build: no `codebase_extract`, no
   as-built changeset and no `changeset_verify` until the build is committed. Verify is the next
   step, on its own.
7. **Verify.** Verify as its own step, after the build (the code and the plan's directory) is
   committed, not in the turn that builds it. Extract what was built, separately from the plan. The
   as-built changeset comes from `codebase_extract` and the code. Never hand-write it, and never copy
   plan elements into it: name each element after its card (the code's symbol), not after the plan's
   element, and don't add planned elements extraction can't see (tests, intent) to make the verdict
   match. Re-index the code once the build is committed: `codebase_index` with `wait: 30` (it re-indexes when source files changed since the last
   index, committed or not), then `status: true` and `wait: 30` until the job is done; don't call it
   in a quick loop. DR's own `.cbmignore` (it keeps DR's folders out of the index) is hidden from git,
   so there is nothing to commit; if the result reports `ignoreFile.missing`, the developer's own
   `.cbmignore` lacks those lines: ask them to add them. Then `codebase_extract`
   with `since` set to the branch the work started from (e.g. `main`) and
   `changeset: "<name>-as-built"`. It stages what the rules decide in the changed files and leaves
   `<name>-as-built` active. If it staged nothing, it makes no changeset: `changeset_create` with the
   name it gives before you `model_add` its cards. For each card it returns that is a model element, stage it with
   `model_add` (`sourceFile` and `sourceSymbol` from the card, `sourceProvenance: "extracted"`),
   reading the code, not the plan, and ask the developer about the cards you can't place, in one short
   list. Stage at the plan's granularity: one element for each planned element, with the symbols of
   its file as its locations, not one symbol picked to stand for the file. One code file can back
   several elements in different layers (an application component and a UX sub-view), and staging
   one doesn't cover the other;
   `planCoverage` lists the planned elements that have no as-built element yet, with the cards that
   could be them, and a card whose symbol a planned element names says `planned` (`view: {planned: true}`):
   stage a card that is the planned element with `decide: [{card, as, reason}]` (`card` takes the
   cardId or `file#symbol`);
   then call `codebase_extract` again to stage their relationships. A `since` run stages the deletes
   whose evidence is unambiguous (`staged.deleted`: a deleted file, a symbol gone from a file that had
   it); `model_delete` the other `candidateDeletes` that are really gone. Pass `plan: "<plan id or
name>"` to compare with a plan without activating it: the active changeset is left alone. Then `changeset_verify` with `changeset: <name>` and
   `against: {"changeset": "<name>-as-built"}`. It returns a compact report: the verdict and
   counts; missing, divergent and probable matches one line each; unverifiable items one line per
   reason; unplanned changes counted per type; and `sourceReferences`. `sections: [...]` returns
   only some sections in full (`["unplanned"]` lists the unplanned items, `["matched"]` every match
   with its notes), narrowed with `layers` or `ids`; `detail: "full"` returns the whole report.
   Fix each missing, unplanned or divergent item in the code or in the plan. `unverifiable` items are planned parts extraction can't see (motivation,
   re-exports, TypeScript tests), and `notes` are description-only differences: neither needs a
   plan edit. Never edit the plan to match extracted placeholder text. A verdict of `unverifiable`
   means the plan has nothing extraction can check; say so rather than call it a failure. If the
   report warns that the as-built changeset is thin (most missing relationships have an end with no
   as-built element), the as-built side is the weak part, not the code: stage the elements it lacks
   from their cards, extract again for their relationships, and verify again before you report
   anything missing. Look for missing connections in the as-built too: for each element,
   compare what the spec models for its type with what was staged, and look for evidence of each
   absent one in the code (and the analyzer's graph, `dr analyzer callers` / `callees`). Confirm or
   reject every `probable` match. Then carry the code's source references into the plan: the
   plan's code-level elements were drawn before the code existed, so they have no `sourceFile` or
   `sourceSymbol`. When the report has `sourceReferences`, its `missing` list names the matched plan
   elements whose as-built match has a source reference the plan lacks; call
   `changeset_adopt_source_references` with the same `changeset` and `against` to stage them into
   the plan. Without them the landed model can't tie those elements to the code, and the next
   `codebase_extract` offers their symbols again. It copies exact matches only: confirm a
   `probable` one in the code, then pass its planned id in `ids`. A match marked `builtByAgent` is
   not copied: confirm it in the code and set `sourceFile` and `sourceSymbol` with `model_update`.
   Its `unreferenced` list names planned adds with no source reference and no as-built match, so
   nothing can copy one (a product feature extraction can't see, say), with `candidates`, the build's
   files that name it: for each one the build has code for, confirm the file in the code and pass
   `{id, sourceFile, sourceSymbol}` in `references` to `changeset_adopt_source_references`.
   `changeset_activate` the plan again afterwards (the extract
   result's `previousActive`; not needed when you passed `plan`). After verify, the plan is what lands (step 8), not the as-built
   changeset: it is the plan's verification record, and `changeset_commit` refuses to land it,
   `force` or not. Ask the human whether to discard the as-built changeset or keep it as a
   record, and discard it only when they agree. To discard it, call
   `changeset_discard` with `confirm: true`. To keep it, leave it staged and
   commit its directory with the plan's directory on the same branch and in the same PR. Landing
   the plan then moves the record to `recorded` (kept, no longer staged work; there is no tool for
   it, and discarding stays your explicit move). The record is never landed, so it doesn't
   reconcile code drift (for that, `codebase_extract` with no plan active, and `since` set to the
   commit `project_status` says the model was last reconciled with: any other `since` makes a
   verification record). Until they decide, add only the plan's directory when you commit fixes.
   If an as-built changeset was landed before DR refused it,
   `against: {"base": true, "extracted": true}` compares the plan with the model, with extraction's blind spots applied.
8. **Land.** The PR carries the code and the staged plan, and a person approves the plan there, not the
   as-built changeset. When they ask you to land it, call `changeset_commit` with its name (`changesets:
[...]` lands several in order and stops at the first refusal). No dialog and no token:
   `changeset_commit_preview` is the read-only dry run, if you want its `summary` first. Drift doesn't
   refuse it: the result lists each staged change the base overlapped and what landing did about it, so
   tell them that (`force` is ignored; `changeset_update` with `rebaseline: true` re-baselines a plan
   Part of a plan can land while the rest stays planned (what is built, say): choose it with `ids`, `milestone`
   or `withSourceReference` on `changeset_commit_preview` (it lists the staged links that cross the boundary;
   `crossing: "include"` brings their far ends, `"leave"` keeps those links staged), then call `changeset_commit`
   with the same arguments. The part lands as its own committed changeset; the plan stays staged with the rest.
   whose base moved). Then commit the result's `filesToCommit`: the model's changed files, the manifest
   and the changeset's folder, with the code on the branch (`project_status` warns when a landed
   changeset's folder is untracked). A validation error refuses it, and so does a changeset-only
   (DrBot) session: there the user lands it in the viewer (`review_open`, then Apply on the changeset).
   Never point them to the `dr` CLI. Once the model has an as-built landing
   (a bootstrap, or a keep-as-built changeset from `codebase_extract`), landing the plan doesn't
   reconcile the model with the code: `project_status` keeps counting code drift from that landing.
   A model with none yet counts drift from its last commit, so committing the landed plan resets
   it. `changeset_commit`'s `codeDrift` says which applies.

## Tolerance

Tools report odd input and carry on instead of failing. Read the report each time:

- `relationship_add` reports a duplicate, or restores a relationship the plan had deleted. In a
  list, an element or relationship already there as sent is `unchanged`; one already there with other
  content is refused, naming what differs (`model_update` changes it).
- Once the changeset you were writing into is landed (by you, or by the user in the viewer), writes
  are refused, naming it, instead of going to the base model. To keep planning, `changeset_create`
  (or `changeset_activate` another staged changeset: a landed one can't be reopened); to write the
  base model, `changeset_deactivate` first. A write that
  arrives while it is landing is refused the same way: send it again into the next changeset.
  `changeset_commit_preview` on a changeset that is already landed answers `already-landed`: there
  is nothing to do.
- `changeset_unstage` reports `not-staged` when there was nothing to drop.
- In a changeset-only session (DrBot with `--with-changesets`), a write with no active changeset is
  refused. Call `changeset_create` or `changeset_activate` and retry.
- `changeset_commit` is refused on a validation error, for a verification or upgrade record, and in
  DrBot, which has neither it nor `changeset_commit_preview`. Nothing is written; in DrBot the
  human lands it in the viewer (`review_open`, then Apply).
- DrBot cannot write annotations (`annotation_create` and `annotation_reply` are not among its
  tools). There, accept gaps with `gap_accept` and answer the human's comments in the chat.
- `project_status` reports a leftover `documentation-robotics/changesets/.active`, the marker from
  before it moved to `.dr/`, as `changesets.legacyMarker`: while git still tracks it, commit its
  deletion. Once `.dr/` has a marker, the old file is never read.
- `gap_accept` and `gap_reopen` are refused with no active changeset, and `gap_accept` for a triple
  the catalog doesn't define or marks required, or a connection the element already has.
- DrBot has no `review_open`: it runs in the viewer, so the human already has the plan in front
  of them. Point them to the changeset in the viewer's Changesets view instead.

## Keep it short

Model at the grain of the change. One function, one operation and one test sketch beat a
speculative tree. Add detail as the build firms up.
