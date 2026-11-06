# Change Modeling with DR

_The design for using a DR changeset as the spec for a change. The vision and the reasons are in
`docs/VISION.md`; this document is the working design for the tools. Update it as tools land._

## The loop

```text
Frame ─▶ Draft ─▶ Pressure-test ─▶ Review ─▶ Build ─▶ Verify ─▶ Land
  │        │            │              │         │        │        │
  │        │            │              │         │        │        └ human commits the changeset in the PR
  │        │            │              │         │        └ extraction over the branch vs the changeset (later)
  │        │            │              │         └ Claude builds from changeset_brief
  │        │            │              └ viewer overlay, annotations, DrBot
  │        │            └ changeset_impact, changeset_brief (reach, gaps, intent), model_validate
  │        └ model_add / model_update / model_delete / relationship_add / relationship_delete
  └ changeset_create (activates), spec_type, model_search
```

A changeset stays staged from Frame to Land. The base model describes what is built; the changeset
describes what this change will build.

## Tools

All tools are on `dr mcp` (stdio and HTTP) and take an optional `rootPath`. Mutation tools stage
into the active changeset when there is one and write the base model when there isn't, the same as
the CLI. Planning a change therefore always starts with `changeset_create`.

| Stage         | Tool                                                         | Status   | What it does                                                                                                                                         |
| ------------- | ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame         | `changeset_create`                                           | new      | Create a changeset from a name and the change's intent, and activate it.                                                                             |
| Frame         | `changeset_activate`                                         | new      | Make an existing staged changeset the one mutations stage into.                                                                                      |
| Frame         | `changeset_deactivate`                                       | new      | Stop staging; mutations write the base model again.                                                                                                  |
| Frame         | `changeset_list`                                             | existing | All changesets and which is active.                                                                                                                  |
| Orient        | `spec_type`                                                  | new      | A node type's definition, attributes (required, enums) and the relationships the catalog allows to and from it.                                      |
| Orient        | `model_search` / `model_show` / `model_trace` / `model_list` | existing | Find and read existing elements. (Base model, or base + active changeset for elements.)                                                              |
| Draft         | `model_add` / `model_update` / `model_delete`                | existing | Stage element changes.                                                                                                                               |
| Draft         | `relationship_add`                                           | new      | Stage a relationship, validated against the catalog; works between elements that exist only in the changeset.                                        |
| Draft         | `relationship_delete`                                        | new      | Stage a relationship removal, or drop a relationship this changeset added.                                                                           |
| Pressure-test | `changeset_impact`                                           | new      | Walk the projected graph outward from every changed element; list the existing elements reached, by layer, with their source files.                  |
| Pressure-test | `changeset_brief`                                            | new      | The changeset as a spec: changes by layer with their connections, layers reached and not, gaps, intent trace, code touched, open annotations, drift. |
| Pressure-test | `model_validate`                                             | existing | Validate the model (base + active changeset).                                                                                                        |
| Review        | `annotation_*`                                               | existing | Read and answer the human's comments on elements.                                                                                                    |
| Build         | `changeset_brief`                                            | new      | The same brief is the build's input.                                                                                                                 |
| Verify        | `changeset_verify`                                           | planned  | Compare an extraction changeset over the branch with this one. Waits on the extraction cascade.                                                      |
| Land          | —                                                            | human    | Commit in the viewer or with `dr changeset commit`. Not exposed over MCP on purpose.                                                                 |

### The projected graph

`changeset_impact` and `changeset_brief` read a changeset through one view (`ChangesetGraph`,
`cli/src/core/changeset-graph.ts`): the base model's elements and relationships with the
changeset's changes applied in sequence. Every element and relationship carries a status: `added`,
`updated`, `deleted` or `unchanged`. Unlike the per-layer projection the CLI uses for elements, it
includes staged relationships, so a traversal sees the connections the change adds and the ones it
removes. It works on any changeset by id or name, active or not.

### What `changeset_brief` reports

- **Changes by layer.** Each added, updated or deleted element with its type, description,
  attributes (and for updates, the fields that changed), and its connections in the projected graph.
- **Reach.** Layers the change touches, and layers it does not.
- **Gaps.**
  - `unconnected`: an added element with no relationships at all.
  - `missing-required`: an added element lacks a relationship the catalog marks `required`. No
    relationship schema is marked `required` yet, so this finds nothing until the spec says which
    connections are expected (open question in the vision).
  - `peer-pattern`: the model's own convention. Peers are existing elements of the same type that
    relate to one of the added element's neighbours the same way (another layout function that
    also realizes the layout service). A connection at least half the peers have (and at least
    two), that the added element lacks, and that the catalog still allows, is reported with up to
    three examples. On heimdall, planning a new layout function this way reports that its sibling
    functions each have an API operation realizing them and a test sketch testing them.
- **Intent.** Changed elements outside the motivation, business and product layers that reach no
  element in those layers within four hops. A change that serves no stated intent is a question for
  the human.
- **Code touched.** Source files of the changed elements and of the existing elements one hop away.
  These are the files the build is likely to edit or must not break.
- **Feedback.** Unresolved annotations on changed elements and their neighbours.
- **Drift.** Whether the base model changed since the changeset was created.

## Using it from Claude Code

Register the server once per project (`.mcp.json`). `dr mcp` prints its API key to stderr on
start; the client must pass it back:

```json
{
  "mcpServers": {
    "dr": {
      "command": "dr",
      "args": ["mcp"],
      "env": { "DR_MCP_API_KEY": "<key>" }
    }
  }
}
```

Keep the key out of the repository (use a user-scope MCP config, or an environment variable the
config references).

Then planning a change is:

1. `changeset_create` with the change's name and intent.
2. `model_search` for what exists; `spec_type` for what a new element must carry and may connect to.
3. Stage elements and relationships across every layer the change reaches.
4. `changeset_brief`, then `changeset_impact` for anything the brief's reach or gaps question.
   Revise until the gaps are answered or accepted.
5. Ask the human to review it in the viewer (`dr visualize`), read their annotations, revise.
6. Build from the brief. Keep the changeset staged on the branch.
7. The human commits the changeset in the PR that ships the code.

A skill or command that makes this the default way to plan a change is step 6 of the vision's
sequencing, after the tools have been used on real changes.

## Known limits

- `model_trace` reads base relationships only; use `changeset_impact` for a changeset.
- Staging does not deduplicate. `relationship_add` checks the projected graph before staging so
  a repeated call is reported as a duplicate, but the CLI's `dr relationship add` does not.
- Impact walks relationships in both directions and does not weigh predicates. Whether, say, a
  `serves` edge carries impact upstream or downstream is a refinement for after real use.
