# Gold diff: dr-cli, baseline vs

Cards labelled in both: 300 (A 300, B 300)
Layer agreement: 268/300 (89.3%). Layer+type agreement: 246/300 (82.0%)
Mean significance: baseline 1.64, 1.55

## Layer changes (baseline -> )

| transition                | n   |
| ------------------------- | --- |
| data-model -> application | 20  |
| application -> none       | 6   |
| api -> none               | 1   |
| apm -> application        | 1   |
| none -> application       | 1   |
| security -> none          | 1   |
| data-store -> application | 1   |
| data-model -> none        | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Interface | 21      | 60  |
| Function  | 2       | 60  |
| Module    | 4       | 60  |
| Method    | 3       | 60  |
| Class     | 2       | 60  |

## Prediction files scored against each gold (layer acc / type acc)

| backend                             | vs baseline   | vs            |
| ----------------------------------- | ------------- | ------------- |
| claude-haiku                        | 60.3% / 49.3% | 59.0% / 50.7% |
| claude-sonnet                       | 78.3% / 68.3% | 77.7% / 66.7% |
| clef-flash                          | 61.7% / 50.3% | 60.3% / 46.7% |
| clef                                | 81.3% / 57.3% | 77.3% / 53.0% |
| clef@enriched-v1-kind-charter-short | 56.7% / 48.0% | 57.3% / 50.0% |
| clef@enriched-v1-kind-charter       | 34.3% / 32.0% | 37.0% / 36.0% |
| clef@enriched-v1-kind               | 81.3% / 60.7% | 77.3% / 63.7% |
| clef@enriched-v1                    | 81.3% / 58.0% | 77.3% / 61.0% |

## Sample of relabelled symbols

| symbol                                                                    | baseline                        |                        | rationale                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interface src.core.annotation-store.AnnotationCreateInput                 | data-model/objectschema         | application/dataobject | A plain input DTO interface for creating annotations in the annotation store. It is a passive data structure with no behaviour, consumed only within t |
| Interface src.analyzers.registry.RegistryManifest                         | data-model/objectschema         | application/dataobject | A small TypeScript interface describing the shape of the analyzer registry manifest: a spec version and a list of analyzer metadata. It is a passive d |
| Interface src.validators.relationship-schema-validator.LayerDistFile      | data-model/objectschema         | application/dataobject | Internal TypeScript interface describing the shape of a layer distribution file's relationship schemas, as consumed by the validator. It is a passive  |
| Module src.mcp.tools.annotation-shared                                    | api/schema                      | none/-                 | A small module of shared zod field schemas reused by the annotation MCP tools. These are input-validation fragments that sit below the level a maintai |
| Interface src.core.relationship-catalog.RelationshipType                  | data-model/objectschema         | application/dataobject | A passive TypeScript interface that holds the definition of a relationship predicate in the catalog (predicate, inverse, category, semantics). It is a |
| Module src.audit.types                                                    | data-model/objectschema         | application/dataobject | This module defines the passive data structures for the relationship audit system: coverage metrics, duplicate and gap candidates, balance assessments |
| Interface src.commands.conformance.ConformanceIssue                       | application/dataobject          | none/-                 | A tiny two-field local type (severity plus message) used inside the conformance command file to carry issue results. It is an implementation detail be |
| Method src.analyzers.verify-engine.VerifyEngine.assembleReport            | application/applicationfunction | none/-                 | Private helper that only assembles a VerifyReport object from precomputed buckets and computes summary counts. It is called solely by computeReport an |
| Interface src.analyzers.types.GraphOnlyEntry                              | data-model/objectschema         | application/dataobject | A passive TypeScript interface that holds analyzer result data: a route entry found only in the code graph, with its id, HTTP method, path and source  |
| Module src.integrations.types                                             | data-model/objectschema         | application/dataobject | Module defining the core data structures (ComponentConfig, VersionData, FileChange, ObsoleteFile) for the integration manager, plus a light validator. |
| Method src.export.markdown-generator.MarkdownGenerator.generateLayerGraph | application/applicationfunction | none/-                 | A private formatting helper that builds a Mermaid graph string from nodes and intra-layer edges for the markdown export. It is an implementation detai |
| Interface src.core.virtual-projection.CacheMetrics                        | apm/metricinstrument            | application/dataobject | A small internal data structure that holds cache hit, miss and invalidation counters for the virtual projection cache. It is a passive state carrier,  |
