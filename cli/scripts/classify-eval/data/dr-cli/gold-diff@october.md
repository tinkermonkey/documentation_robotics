# Gold diff: dr-cli, october vs

Cards labelled in both: 300 (A 300, B 300)
Layer agreement: 287/300 (95.7%). Layer+type agreement: 272/300 (90.7%)
Mean significance: october 1.55, 1.53

## Layer changes (october -> )

| transition                | n   |
| ------------------------- | --- |
| application -> none       | 8   |
| application -> data-model | 3   |
| none -> security          | 1   |
| data-model -> application | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Method    | 2       | 60  |
| Function  | 3       | 60  |
| Module    | 2       | 60  |
| Class     | 2       | 60  |
| Interface | 4       | 60  |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs october    | vs            |
| ---------------------------------------------- | ------------- | ------------- |
| claude-haiku                                   | 59.0% / 50.7% | 60.7% / 54.0% |
| claude-sonnet                                  | 77.7% / 66.7% | 75.0% / 66.7% |
| clef-flash                                     | 60.3% / 46.7% | 61.3% / 50.0% |
| clef                                           | 77.3% / 53.0% | 78.0% / 55.0% |
| clef@cbm010-kind-base                          | 79.3% / 65.7% | 79.3% / 64.0% |
| clef@cbm010-kind-tier0                         | 89.7% / 76.0% | 89.3% / 74.0% |
| clef@cbm012-kind-base                          | 81.0% / 68.3% | 81.0% / 66.7% |
| clef@cbm012-kind-tier0-port                    | 91.3% / 78.3% | 91.0% / 76.3% |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 88.0% / 74.7% | 87.7% / 74.0% |
| clef@cbm012-kind-tier0-qset2-spec012           | 73.7% / 63.7% | 76.0% / 65.7% |
| clef@cbm012-kind-tier0-qset2                   | 89.7% / 77.3% | 89.3% / 75.7% |
| clef@cbm012-kind-tier0                         | 91.3% / 78.3% | 91.0% / 76.3% |
| clef@diag-spec012-norules                      | 88.0% / 74.7% | 87.7% / 74.0% |
| clef@enriched-v1-kind-charter-short            | 57.3% / 50.0% | 59.7% / 53.0% |
| clef@enriched-v1-kind-charter                  | 37.0% / 36.0% | 39.3% / 38.0% |
| clef@enriched-v1-kind                          | 77.3% / 63.7% | 78.0% / 62.7% |
| clef@enriched-v1                               | 77.3% / 61.0% | 78.0% / 60.0% |
| clef@enriched-v2-kind                          | 77.3% / 64.3% | 78.0% / 63.0% |
| clef@enriched-v2                               | 77.3% / 60.3% | 78.0% / 60.0% |
| clef@v2-kind-base                              | 77.3% / 64.3% | 78.0% / 63.0% |
| clef@v2-kind-core                              | 77.3% / 61.7% | 78.0% / 60.7% |
| clef@v2-kind-tier0-facts-core                  | 86.3% / 71.7% | 86.0% / 69.7% |
| clef@v2-kind-tier0-facts                       | 86.3% / 73.7% | 86.0% / 71.3% |
| clef@v2-kind-tier0                             | 88.0% / 75.0% | 88.3% / 73.3% |

## Sample of relabelled symbols

| symbol                                                                         | october                         |                         | rationale                                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Class src.core.element.Element                                                 | application/dataobject          | data-model/objectschema | Central domain entity of the architecture model: the Element class mirrors spec-node.schema.json (id, type, layer_id, attributes, source_reference, re |
| Interface src.mcp.http-transport.SessionData                                   | application/dataobject          | none/-                  | A small internal type pairing an MCP server instance with its HTTP transport for session bookkeeping inside the HTTP transport module. It is an implem |
| Function src.analyzers.session-state.validateAnalyzerName                      | none/-                          | security/validationrule | An input-validation check rejecting path traversal characters in analyzer names, used only by getStateDir. It is evidence for a security validation ru |
| Method src.core.dependency-tracker.DependencyTracker.getTransitiveDependencies | application/applicationfunction | none/-                  | A small query method on DependencyTracker that wraps graph descent to list transitive dependencies. It has no callers and is a thin accessor below the |
| Function src.commands.relationship.getRelationshipConstraints                  | application/applicationfunction | none/-                  | Small lookup helper that wraps the relationship catalog query and extracts cardinality and strength for a triple. It serves the relationship command,  |
| Interface src.types.BackupManifest                                             | data-model/objectschema         | application/dataobject  | A readonly TypeScript interface whose only job is to carry backup state (a file list and a timestamp). It is passive data with no behaviour and is not |
| Module src.utils.globals                                                       | application/applicationfunction | none/-                  | Utility module holding global CLI option state with trivial getters/setters and conditional console logging helpers. It is scaffolding/configuration p |
| Function src.commands.upgrade.executeIntegrationUpdate                         | application/applicationfunction | none/-                  | A small wrapper inside the upgrade command. It runs a supplied update callback, prints CLI progress and error lines, and records an 'upgrade.integrati |
| Module src.integrations.hash-utils                                             | application/applicationfunction | none/-                  | A utility module of file-hashing helpers used for change detection of integration files. It reads files from disk, but it is a low-level helper below  |
| Method src.core.graph-model.GraphModel.removeEdge                              | application/applicationfunction | none/-                  | An in-memory mutation method on GraphModel that removes an edge and maintains its source, destination and predicate indices. It is an implementation d |
| Class src.core.manifest.Manifest                                               | application/dataobject          | data-model/objectschema | Manifest is a central entity class that defines the persisted shape of the model's manifest file: project metadata, changeset history and external mod |
| Interface src.integrations.types.VersionData                                   | application/dataobject          | data-model/objectschema | Defines the shape of a persisted YAML version file (.dr-version), documented as its schema. A persisted file-format structure maps to a data-model obj |
