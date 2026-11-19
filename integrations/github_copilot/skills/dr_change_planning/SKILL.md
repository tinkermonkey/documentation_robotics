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

- You need the `dr` MCP server (`dr mcp`, registered in Copilot's MCP configuration; see
  `integrations/claude_code/docs/MCP_SERVER.md`). The
  tool names below are the server's own; Copilot may show them with a server prefix. If the tools
  are missing, tell the user to register the server and stop. Don't fall back to prose.
- Staging writes files under `documentation-robotics/changesets/`.
- If the project has no model yet, propose a name and confirm it with the human before
  `project_init`. Then ask whether to bootstrap the model from the code now or let it grow with
  each change, and wait for their answer.
- When `codebase_extract` returns cards (in a bootstrap, or when you verify), ask the developer about
  the ones you can't place with confidence: whether a card is a model element at all, which type it
  is, or whether to reject it. Don't guess. Collect them and ask once, in one short list (the card,
  your best guess, the question), then stage or reject from the answers. `reject` takes `{card}`,
  `{files: "docs/**"}` for every card in a folder that isn't product code, or
  `{relationship: {source, predicate, target}}` for a relationship extraction staged that the code
  doesn't have; each needs a `reason`, and later runs leave them out. When `next` suggests folders
  for `.cbmignore`, ask the developer before adding them. When a `since` run reports `range` (it
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
- You never land or discard the plan on your own. Commit it (`changeset_commit`) only when the
  human asks you to land it; they confirm it in a dialog. Apply is not an MCP tool. Discard only when
  they agree.

## The loop

1. **Frame.** `changeset_list` first: if a changeset for this change exists, `changeset_activate` it
   and continue. Otherwise propose a short kebab-case `name` and a `description` that states the
   intent (what the change is for and what done looks like), and confirm both with the human before
   you call `changeset_create` with them. Wait for their answer. Find the goal,
   requirement or feature it serves (`model_search` in motivation, business, product). If there is
   none, stage one, or ask the human what the change is for.
2. **Orient.** `model_search` / `model_show` / `model_trace` for the elements the change touches.
   Inside a changeset these read the plan as it stands (each result carries a change status).
   `spec_type` for a type you will add: its required attributes, enums, and the relationships the
   catalog allows to and from it. Within reason, every connection the spec models for a type is
   expected, though not every one will exist: treat the catalog's list as the checklist for each
   element the change adds or alters.
3. **Draft.** Stage the change in every layer it reaches: `model_add`, `model_update`,
   `model_delete`, `relationship_add`, `relationship_delete`. Relationships may join elements that
   exist only in the changeset. When you wire several, use the lists: `model_add` with
   `elements: [...]` (plus `relationships` that may name elements added in the same call), and
   `relationship_add` with `relationships: [{source, predicate, target, properties?}]`. Each list is
   staged in one write; an invalid item is skipped and reported, so read the per-item results. For
   a planned element with no code yet, send no source fields. Pass `sourceFile` and `sourceSymbol`
   (with `sourceProvenance: "manual"`) only when you know where the code goes.
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
   - Work through `unwired` for each element you added or changed. The default brief only counts
     it per layer, and `sections` returns only the sections it names, so list the entries with
     `sections: ["unwired"], unwiredLayers: [<the layers the change reaches>]`, narrowed further with
     `layers` or `ids` if you like. Always pass a filter: unfiltered it runs to hundreds of KB on a
     large model. Where `existingCount` is above 0, link an existing element; otherwise decide
     whether the change needs a new one.
   - Walk `changeset_impact` with `from` set to what you just added, not the whole changeset.
   - Read the plan with `changeset_show` `detail: "summary"`, not the full snapshots.

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
6. **Build.** Build from the brief. At the start of the build, read it with
   `sections: ["changes"]`: each changed element's attributes and changed fields, and its
   connections as `predicate → id` lines. For a large plan, read one layer at a time with
   `sections: ["changes"], layers: ["<layer>"]`, taking the layers from the default brief's
   `byLayer`. The default brief's "code touched" list is what you will edit or must not
   break. Keep the changeset staged and commit only the plan's own directory
   (`documentation-robotics/changesets/<id>/`, with the id `changeset_show` reports) on the branch
   with the code. Don't add the whole `changesets/` directory: any `<name>-as-built` changeset
   stays out of the commit. If the build has to differ from the plan,
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
   in a quick loop. If the result reports `ignoreFile` (the `.cbmignore` it wrote so DR's own folders
   aren't indexed), tell the developer to commit that file. Then `codebase_extract`
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
   then call `codebase_extract` again to stage their relationships, and `model_delete` the
   `candidateDeletes` that are really gone. Then `changeset_verify` with `changeset: <name>` and
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
   nothing can copy one (a product feature extraction can't see, say): for each one the build has
   code for, set `sourceFile` and `sourceSymbol` with `model_update` (`sourceProvenance: "manual"`).
   `changeset_activate` the plan again afterwards (the extract
   result's `previousActive`). After verify, the plan is what lands (step 8), not the as-built
   changeset: it is the plan's verification record, and `changeset_commit` refuses to land it,
   `force` or not. Ask the human whether to discard the as-built changeset (`changeset_discard`,
   `confirm: true`) or keep it as a record, and discard it only when they agree. A kept record
   stays staged, and its directory is committed to git with the plan's, as the record of what was
   built; it is never landed, so it doesn't reconcile code drift (for that, `codebase_extract`
   with no plan active). Until they decide, add only the plan's directory when you commit fixes.
   If an as-built changeset was landed before DR refused it,
   `against: {"base": true, "extracted": true}` compares the plan with the model, with extraction's blind spots applied.
8. **Land.** The PR carries the code and the staged plan, and the human commits the plan in it, not
   the as-built changeset. When they ask you to land it, call `changeset_commit` with its name. The server asks them
   to confirm in a dialog that shows the name, intent, counts by operation, layers and drift, and
   commits only if they confirm; if they decline, leave it staged. If it is refused for drift, show
   them what drifted (`changeset_brief`) and pass `force: true` only if they still want it. Then add
   the model's changed files and the changeset's directory to the branch. If it is refused, they land
   it in the viewer (`review_open`, then Apply on the changeset), or you call it again from an
   interactive session. Never point them to the `dr` CLI. Once the model has an as-built landing
   (a bootstrap, or a keep-as-built changeset from `codebase_extract`), landing the plan doesn't
   reconcile the model with the code: `project_status` keeps counting code drift from that landing.
   A model with none yet counts drift from its last commit, so committing the landed plan resets
   it. `changeset_commit`'s `codeDrift` says which applies.

## Tolerance

Tools report odd input and carry on instead of failing. Read the report each time:

- `relationship_add` reports a duplicate, or restores a relationship the plan had deleted.
- `changeset_unstage` reports `not-staged` when there was nothing to drop.
- In a changeset-only session (DrBot with `--with-changesets`), a write with no active changeset is
  refused. Call `changeset_create` or `changeset_activate` and retry.
- `changeset_commit` is refused when the human declines or cancels the dialog, when the client
  can't show one (no MCP elicitation), and in DrBot, which doesn't have it. Nothing is written; the
  human lands it in the viewer (`review_open`, then Apply), or from an interactive session.
- DrBot cannot write annotations (`annotation_create` and `annotation_reply` are not among its
  tools). There, accept gaps with `gap_accept` and answer the human's comments in the chat.
- `gap_accept` and `gap_reopen` are refused with no active changeset, and `gap_accept` for a triple
  the catalog doesn't define or marks required, or a connection the element already has.
- DrBot has no `review_open`: it runs in the viewer, so the human already has the plan in front
  of them. Point them to the changeset in the viewer's Changesets view instead.

## Keep it short

Model at the grain of the change. One function, one operation and one test sketch beat a
speculative tree. Add detail as the build firms up.
