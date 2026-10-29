# Classification eval report: dr-cli

Generated 2026-10-29T12:36:20.422Z. Cards: 300. Gold labels: 300.

## Gold label distribution

| layer       | n   |
| ----------- | --- |
| application | 191 |
| none        | 90  |
| data-model  | 8   |
| security    | 4   |
| apm         | 4   |
| testing     | 2   |
| technology  | 1   |

Significance histogram (0..4): 55 / 91 / 92 / 59 / 3. Gold labels with a type id not in the spec: 2.

## Summary

| backend                             | n   | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| ----------------------------------- | --- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| clef@v2-kind-tier0                  | 300 | 88.0%     | 75.0%                 | 85.2%                | 0.42    | 93.3%        | 0.294     | 687 ms         | $0.301     | $0.0010     |
| claude-haiku                        | 300 | 59.0%     | 50.7%                 | 85.9%                | 0.36    | 99.0%        | 0.120     | 1395 ms        | $0.113     | $0.0004     |
| clef@v2-kind-core                   | 300 | 77.3%     | 61.7%                 | 79.7%                | 0.40    | 95.0%        | 0.226     | 673 ms         | $0.297     | $0.0010     |
| clef                                | 300 | 77.3%     | 53.0%                 | 68.5%                | 0.40    | 95.0%        | 0.226     | 654 ms         | $0.269     | $0.0009     |
| clef@enriched-v1-kind-charter-short | 300 | 57.3%     | 50.0%                 | 87.2%                | 0.48    | 92.0%        | 0.078     | 593 ms         | $0.295     | $0.0010     |
| clef@enriched-v1-kind               | 300 | 77.3%     | 63.7%                 | 82.3%                | 0.40    | 95.0%        | 0.226     | 754 ms         | $0.321     | $0.0011     |
| clef@enriched-v1-kind-charter       | 300 | 37.0%     | 36.0%                 | 97.3%                | 0.62    | 80.3%        | 0.314     | 557 ms         | $0.346     | $0.0012     |
| clef@v2-kind-tier0-facts-core       | 300 | 86.3%     | 71.7%                 | 83.0%                | 0.59    | 81.3%        | 0.266     | 660 ms         | $0.276     | $0.0009     |
| clef-flash                          | 300 | 60.3%     | 46.7%                 | 77.3%                | 0.57    | 85.7%        | 0.169     | 979 ms         | $0.094     | $0.0003     |
| clef@enriched-v1                    | 300 | 77.3%     | 61.0%                 | 78.9%                | 0.40    | 95.0%        | 0.226     | 824 ms         | $0.358     | $0.0012     |
| claude-sonnet                       | 300 | 77.7%     | 66.7%                 | 85.8%                | 0.21    | 99.7%        | 0.115     | 1498 ms        | $2.221     | $0.0074     |
| clef@enriched-v2-kind               | 300 | 77.3%     | 64.3%                 | 83.2%                | 0.40    | 95.0%        | 0.226     | 929 ms         | $0.322     | $0.0011     |
| clef@enriched-v2                    | 300 | 77.3%     | 60.3%                 | 78.0%                | 0.40    | 95.0%        | 0.226     | 973 ms         | $0.360     | $0.0012     |
| clef@v2-kind-tier0-facts            | 300 | 86.3%     | 73.7%                 | 85.3%                | 0.59    | 81.3%        | 0.266     | 734 ms         | $0.305     | $0.0010     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

## clef@v2-kind-tier0

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 86.9%  | 171         |
| none        | 90     | 94.4%  | 105         |
| data-model  | 8      | 50.0%  | 12          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 19    |
| application → data-model | 6     |
| data-model → application | 2     |
| none → application       | 2     |
| none → apm               | 2     |
| data-model → security    | 1     |
| none → data-model        | 1     |
| data-model → none        | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.3-0.4        | 14  | 0.37      | 0.50     | 0.13 |
| 0.4-0.5        | 50  | 0.45      | 0.78     | 0.33 |
| 0.5-0.6        | 107 | 0.55      | 0.87     | 0.32 |
| 0.6-0.7        | 84  | 0.66      | 0.95     | 0.30 |
| 0.7-0.8        | 35  | 0.73      | 1.00     | 0.27 |
| 0.8-0.9        | 10  | 0.83      | 1.00     | 0.17 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 78.7%    | 92.4%             |
| ≥0.60     | 43.0%    | 96.9%             |
| ≥0.70     | 15.0%    | 100.0%            |
| ≥0.80     | 3.3%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.69      | 0.32   | 0.44       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                                        | gold                            | predicted (conf)              | gold rationale                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints                 | application/applicationfunction | none/- (0.37)                 | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.types.BackupManifest                                            | data-model/objectschema         | application/dataobject (0.66) | An exported type definition describing the shape of a backup manifest (a list of files plus a timestamp). It is a domain data structure with no behaviour, so it |
| Module src.integrations.hash-utils                                            | application/applicationfunction | none/- (0.61)                 | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates          | application/applicationfunction | none/- (0.42)                 | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Interface src.core.staging-area.CommitOptions                                 | application/dataobject          | none/- (0.61)                 | A small options interface holding three boolean flags (force, validate, dryRun) for the staging-area commit operation. It is a passive data structure with no be |
| Interface src.commands.visualize.VisualizeOptions                             | application/dataobject          | none/- (0.53)                 | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Module src.schemas.bundled.security                                           | data-model/jsonschema           | security/securitymodel (0.39) | A bundled JSON Schema document that defines the node schemas for the spec's security layer, covering its node types and their attributes. In this codebase it is |
| Method src.validators.validation-formatter.ValidationFormatter.calculateStats | application/applicationfunction | none/- (0.45)                 | A static method that computes model statistics: element counts per layer, relationship counts by predicate, and orphan detection. It is internal behaviour of th |
| Interface src.utils.errors.ErrorContext                                       | application/dataobject          | none/- (0.53)                 | A small passive TypeScript interface that carries optional error metadata: operation, context, related elements and partial progress. It lives in the errors uti |
| Method src.core.dependency-tracker.DependencyTracker.getMetrics               | application/applicationfunction | none/- (0.53)                 | A method of DependencyTracker that computes graph statistics: node and edge counts, cycles and weakly connected components. It has no callers and is a minor int |

## claude-haiku

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 47.6%  | 104         |
| none        | 90     | 81.1%  | 139         |
| data-model  | 8      | 25.0%  | 11          |
| apm         | 4      | 100.0% | 11          |
| security    | 4      | 100.0% | 5           |
| testing     | 2      | 100.0% | 9           |
| technology  | 1      | 100.0% | 9           |
| api         | 0      | n/a    | 8           |
| data-store  | 0      | n/a    | 2           |
| product     | 0      | n/a    | 2           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 63    |
| none → application       | 12    |
| application → data-model | 9     |
| application → technology | 8     |
| application → testing    | 6     |
| application → api        | 6     |
| application → apm        | 5     |
| data-model → none        | 3     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.0-0.1        | 5   | 0.06      | 0.00     | -0.06 |
| 0.1-0.2        | 3   | 0.11      | 0.00     | -0.11 |
| 0.2-0.3        | 9   | 0.20      | 0.00     | -0.20 |
| 0.3-0.4        | 17  | 0.32      | 0.06     | -0.26 |
| 0.4-0.5        | 9   | 0.45      | 0.44     | -0.01 |
| 0.5-0.6        | 27  | 0.51      | 0.74     | 0.23  |
| 0.6-0.7        | 115 | 0.60      | 0.66     | 0.06  |
| 0.7-0.8        | 21  | 0.70      | 0.48     | -0.23 |
| 0.8-0.9        | 89  | 0.81      | 0.69     | -0.12 |
| 0.9-1.0        | 5   | 0.90      | 1.00     | 0.10  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 85.7%    | 66.9%             |
| ≥0.60     | 76.7%    | 66.1%             |
| ≥0.70     | 38.3%    | 66.1%             |
| ≥0.80     | 31.3%    | 70.2%             |
| ≥0.90     | 1.7%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 1.00      | 1.00   | 1.00       |
| data_persistence     | 53             | 0.88      | 0.68   | 0.77       |
| external_integration | 24             | 0.70      | 0.67   | 0.68       |
| observability        | 34             | 0.72      | 0.62   | 0.67       |
| user_interface       | 31             | 0.83      | 0.77   | 0.80       |

### Sample layer disagreements

| symbol                                                          | gold                             | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module src.schemas.bundled.testing                              | data-model/jsonschema            | testing/testcoveragemodel (0.80)       | This is the bundled JSON Schema (draft-07) for the testing layer of the specification itself. It defines node schemas such as contextvariation and coverageexclu |
| Class src.export.graphml-exporter.GraphMLExporter               | application/applicationcomponent | technology/artifact (0.30)             | A pluggable Exporter implementation that serializes the model to GraphML. It is a cohesive, replaceable unit used by the export command and the MCP export tool. |
| Function src.commands.relationship.getRelationshipConstraints   | application/applicationfunction  | none/- (0.60)                          | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Class src.audit.relationships.analysis.gap-analyzer.GapAnalyzer | application/applicationcomponent | testing/- (0.12)                       | GapAnalyzer is a cohesive analysis class within the relationship audit subsystem. The AuditOrchestrator instantiates it, and it compares layer templates against |
| Function src.integrations.hash-utils.scanDir                    | none/-                           | application/applicationfunction (0.50) | A nested recursive helper inside computeDirectoryHashes that walks a directory and hashes the files in it. It is a private implementation detail of the hashing  |
| Module src.audit.relationships.analysis.layer-templates         | application/dataobject           | none/- (0.85)                          | A static configuration module declaring the LayerTemplate interface and per-layer expected relationship patterns, used as reference data for audit gap analysis. |
| Interface src.core.stats-collector.ValidationInfo               | application/dataobject           | none/- (0.60)                          | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Method src.core.graph-model.GraphModel.traverse                 | application/applicationfunction  | none/- (0.80)                          | BFS traversal over the in-memory graph model, optionally filtered by predicate and bounded by depth. It is a notable internal capability of the GraphModel compo |
| Method src.analyzers.cbm-analyzer.CbmAnalyzer.shapeRoute        | none/-                           | application/applicationfunction (0.60) | An @internal data-shaping helper that normalizes a raw CBM graph node into a route record with default values. It is extracted only for testability and has a si |
| Class src.core.relationship-catalog.RelationshipCatalog         | application/applicationcomponent | technology/- (0.20)                    | Core class that loads the predicate and relationship schema catalog from bundled JSON files on disk and exposes relationship type lookups. It is used by CLI com |

## clef@v2-kind-core

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 70.7%  | 138         |
| none        | 90     | 90.0%  | 99          |
| data-model  | 8      | 87.5%  | 50          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |
| api         | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 38    |
| application → none       | 18    |
| none → data-model        | 4     |
| none → apm               | 2     |
| none → application       | 2     |
| data-model → security    | 1     |
| none → api               | 1     |
| technology → data-model  | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 3   | 0.28      | 0.00     | -0.28 |
| 0.3-0.4        | 36  | 0.36      | 0.39     | 0.03  |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27  |
| 0.5-0.6        | 89  | 0.55      | 0.82     | 0.27  |
| 0.6-0.7        | 73  | 0.66      | 0.90     | 0.25  |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22  |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 87.2%             |
| ≥0.60     | 35.7%    | 91.6%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.69      | 0.32   | 0.44       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Interface src.core.relationship-registry.RelationshipTypeMetadata    | application/dataobject          | data-model/objectschema (0.68) | A passive TypeScript interface that holds relationship-type metadata (predicate, inverse, category) for the relationship registry. It has no behaviour and no ca |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface holding three boolean flags (force, validate, dryRun) for the staging-area commit operation. It is a passive data structure with no be |
| Interface src.commands.visualize.VisualizeOptions                    | application/dataobject          | none/- (0.37)                  | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Module src.schemas.bundled.security                                  | data-model/jsonschema           | security/securitymodel (0.39)  | A bundled JSON Schema document that defines the node schemas for the spec's security layer, covering its node types and their attributes. In this codebase it is |

## clef

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 70.7%  | 138         |
| none        | 90     | 90.0%  | 99          |
| data-model  | 8      | 87.5%  | 50          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |
| api         | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 38    |
| application → none       | 18    |
| none → data-model        | 4     |
| none → apm               | 2     |
| none → application       | 2     |
| data-model → security    | 1     |
| none → api               | 1     |
| technology → data-model  | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 3   | 0.28      | 0.00     | -0.28 |
| 0.3-0.4        | 36  | 0.36      | 0.39     | 0.03  |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27  |
| 0.5-0.6        | 89  | 0.55      | 0.82     | 0.27  |
| 0.6-0.7        | 73  | 0.66      | 0.90     | 0.25  |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22  |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 87.2%             |
| ≥0.60     | 35.7%    | 91.6%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.69      | 0.32   | 0.44       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Interface src.core.relationship-registry.RelationshipTypeMetadata    | application/dataobject          | data-model/objectschema (0.68) | A passive TypeScript interface that holds relationship-type metadata (predicate, inverse, category) for the relationship registry. It has no behaviour and no ca |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface holding three boolean flags (force, validate, dryRun) for the staging-area commit operation. It is a passive data structure with no be |
| Interface src.commands.visualize.VisualizeOptions                    | application/dataobject          | none/- (0.37)                  | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Module src.schemas.bundled.security                                  | data-model/jsonschema           | security/securitymodel (0.39)  | A bundled JSON Schema document that defines the node schemas for the spec's security layer, covering its node types and their attributes. In this codebase it is |

## clef@enriched-v1-kind-charter-short

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 36.6%  | 70          |
| none        | 90     | 100.0% | 196         |
| data-model  | 8      | 62.5%  | 26          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 75.0%  | 3           |
| testing     | 2      | 0.0%   | 0           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 101   |
| application → data-model | 20    |
| data-model → none        | 2     |
| testing → none           | 2     |
| data-model → security    | 1     |
| technology → data-model  | 1     |
| apm → none               | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.30      | 0.00     | -0.30 |
| 0.3-0.4        | 25  | 0.37      | 0.24     | -0.13 |
| 0.4-0.5        | 80  | 0.45      | 0.45     | -0.00 |
| 0.5-0.6        | 69  | 0.54      | 0.58     | 0.04  |
| 0.6-0.7        | 62  | 0.65      | 0.52     | -0.13 |
| 0.7-0.8        | 44  | 0.75      | 0.89     | 0.13  |
| 0.8-0.9        | 19  | 0.84      | 1.00     | 0.16  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.7%    | 67.0%             |
| ≥0.60     | 41.7%    | 72.0%             |
| ≥0.70     | 21.0%    | 92.1%             |
| ≥0.80     | 6.3%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.28   | 0.44       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.72      | 0.38   | 0.50       |
| user_interface       | 31             | 0.83      | 0.61   | 0.70       |

### Sample layer disagreements

| symbol                                                          | gold                             | predicted (conf)               | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class src.export.graphml-exporter.GraphMLExporter               | application/applicationcomponent | none/- (0.44)                  | A pluggable Exporter implementation that serializes the model to GraphML. It is a cohesive, replaceable unit used by the export command and the MCP export tool. |
| Interface src.core.virtual-projection.ModelDiff                 | application/dataobject           | none/- (0.37)                  | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Function src.commands.relationship.getRelationshipConstraints   | application/applicationfunction  | none/- (0.62)                  | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Module src.schemas.bundled.testing                              | data-model/jsonschema            | none/- (0.35)                  | This is the bundled JSON Schema (draft-07) for the testing layer of the specification itself. It defines node schemas such as contextvariation and coverageexclu |
| Module src.audit.relationships.analysis.layer-templates         | application/dataobject           | none/- (0.55)                  | A static configuration module declaring the LayerTemplate interface and per-layer expected relationship patterns, used as reference data for audit gap analysis. |
| Class src.audit.relationships.analysis.gap-analyzer.GapAnalyzer | application/applicationcomponent | none/- (0.60)                  | GapAnalyzer is a cohesive analysis class within the relationship audit subsystem. The AuditOrchestrator instantiates it, and it compares layer templates against |
| Method src.core.graph-model.GraphModel.traverse                 | application/applicationfunction  | none/- (0.62)                  | BFS traversal over the in-memory graph model, optionally filtered by predicate and bounded by depth. It is a notable internal capability of the GraphModel compo |
| Module src.integrations.hash-utils                              | application/applicationfunction  | none/- (0.74)                  | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Interface src.core.stats-collector.ValidationInfo               | application/dataobject           | data-model/objectschema (0.40) | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Interface src.core.spec-loader.CompiledBase                     | application/dataobject           | none/- (0.38)                  | A small TypeScript interface that only describes the shape of compiled spec data (version, schemas, predicates) used by the spec loader. As a passive state carr |

## clef@enriched-v1-kind

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 70.7%  | 138         |
| none        | 90     | 90.0%  | 99          |
| data-model  | 8      | 87.5%  | 50          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |
| api         | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 38    |
| application → none       | 18    |
| none → data-model        | 4     |
| none → apm               | 2     |
| none → application       | 2     |
| data-model → security    | 1     |
| none → api               | 1     |
| technology → data-model  | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 3   | 0.28      | 0.00     | -0.28 |
| 0.3-0.4        | 36  | 0.36      | 0.39     | 0.03  |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27  |
| 0.5-0.6        | 89  | 0.55      | 0.82     | 0.27  |
| 0.6-0.7        | 73  | 0.66      | 0.90     | 0.25  |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22  |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 87.2%             |
| ≥0.60     | 35.7%    | 91.6%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.69      | 0.32   | 0.44       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Interface src.core.relationship-registry.RelationshipTypeMetadata    | application/dataobject          | data-model/objectschema (0.68) | A passive TypeScript interface that holds relationship-type metadata (predicate, inverse, category) for the relationship registry. It has no behaviour and no ca |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface holding three boolean flags (force, validate, dryRun) for the staging-area commit operation. It is a passive data structure with no be |
| Interface src.commands.visualize.VisualizeOptions                    | application/dataobject          | none/- (0.37)                  | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Interface src.core.virtual-projection.ProjectedModel                 | application/dataobject          | data-model/objectschema (0.40) | A passive TypeScript interface holding the state of a virtual projected model (manifest, layers, relationships) produced when changesets are applied over the ba |

## clef@enriched-v1-kind-charter

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 7.9%   | 16          |
| none        | 90     | 100.0% | 274         |
| data-model  | 8      | 25.0%  | 5           |
| security    | 4      | 25.0%  | 2           |
| apm         | 4      | 75.0%  | 3           |
| testing     | 2      | 0.0%   | 0           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 174   |
| data-model → none        | 4     |
| security → none          | 3     |
| application → data-model | 2     |
| testing → none           | 2     |
| data-model → security    | 1     |
| data-model → application | 1     |
| technology → data-model  | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.3-0.4        | 8   | 0.36      | 0.25     | -0.11 |
| 0.4-0.5        | 44  | 0.45      | 0.30     | -0.16 |
| 0.5-0.6        | 42  | 0.56      | 0.10     | -0.46 |
| 0.6-0.7        | 60  | 0.65      | 0.07     | -0.58 |
| 0.7-0.8        | 65  | 0.76      | 0.31     | -0.45 |
| 0.8-0.9        | 71  | 0.85      | 0.82     | -0.03 |
| 0.9-1.0        | 10  | 0.91      | 1.00     | 0.09  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 82.7%    | 38.7%             |
| ≥0.60     | 68.7%    | 44.7%             |
| ≥0.70     | 48.7%    | 60.3%             |
| ≥0.80     | 27.0%    | 84.0%             |
| ≥0.90     | 3.3%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 1.00      | 1.00   | 1.00       |
| data_persistence     | 53             | 1.00      | 0.25   | 0.39       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.75      | 0.35   | 0.48       |
| user_interface       | 31             | 0.87      | 0.65   | 0.74       |

### Sample layer disagreements

| symbol                                                          | gold                             | predicted (conf) | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints   | application/applicationfunction  | none/- (0.77)    | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.core.virtual-projection.ModelDiff                 | application/dataobject           | none/- (0.58)    | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Class src.export.graphml-exporter.GraphMLExporter               | application/applicationcomponent | none/- (0.62)    | A pluggable Exporter implementation that serializes the model to GraphML. It is a cohesive, replaceable unit used by the export command and the MCP export tool. |
| Module src.schemas.bundled.testing                              | data-model/jsonschema            | none/- (0.42)    | This is the bundled JSON Schema (draft-07) for the testing layer of the specification itself. It defines node schemas such as contextvariation and coverageexclu |
| Interface src.types.BackupManifest                              | data-model/objectschema          | none/- (0.40)    | An exported type definition describing the shape of a backup manifest (a list of files plus a timestamp). It is a domain data structure with no behaviour, so it |
| Module src.audit.relationships.analysis.layer-templates         | application/dataobject           | none/- (0.68)    | A static configuration module declaring the LayerTemplate interface and per-layer expected relationship patterns, used as reference data for audit gap analysis. |
| Class src.audit.relationships.analysis.gap-analyzer.GapAnalyzer | application/applicationcomponent | none/- (0.72)    | GapAnalyzer is a cohesive analysis class within the relationship audit subsystem. The AuditOrchestrator instantiates it, and it compares layer templates against |
| Interface src.core.stats-collector.ValidationInfo               | application/dataobject           | none/- (0.64)    | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Method src.core.graph-model.GraphModel.traverse                 | application/applicationfunction  | none/- (0.73)    | BFS traversal over the in-memory graph model, optionally filtered by predicate and bounded by depth. It is a notable internal capability of the GraphModel compo |
| Interface src.core.spec-loader.CompiledBase                     | application/dataobject           | none/- (0.62)    | A small TypeScript interface that only describes the shape of compiled spec data (version, schemas, predicates) used by the spec loader. As a passive state carr |

## clef@v2-kind-tier0-facts-core

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 88.0%  | 182         |
| none        | 90     | 85.6%  | 95          |
| data-model  | 8      | 62.5%  | 12          |
| security    | 4      | 100.0% | 4           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 18    |
| none → application       | 10    |
| application → data-model | 5     |
| data-model → application | 3     |
| none → apm               | 2     |
| none → data-model        | 1     |
| technology → data-model  | 1     |
| testing → application    | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.3-0.4        | 10  | 0.37      | 0.60     | 0.23 |
| 0.4-0.5        | 52  | 0.45      | 0.67     | 0.22 |
| 0.5-0.6        | 82  | 0.55      | 0.83     | 0.28 |
| 0.6-0.7        | 100 | 0.65      | 0.95     | 0.30 |
| 0.7-0.8        | 49  | 0.74      | 0.98     | 0.23 |
| 0.8-0.9        | 7   | 0.83      | 1.00     | 0.17 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 79.3%    | 91.6%             |
| ≥0.60     | 52.0%    | 96.2%             |
| ≥0.70     | 18.7%    | 98.2%             |
| ≥0.80     | 2.3%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.75   | 0.86       |
| observability        | 34             | 0.74      | 0.41   | 0.53       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                                                   | gold                            | predicted (conf)              | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints                            | application/applicationfunction | none/- (0.41)                 | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.types.BackupManifest                                                       | data-model/objectschema         | application/dataobject (0.75) | An exported type definition describing the shape of a backup manifest (a list of files plus a timestamp). It is a domain data structure with no behaviour, so it |
| Module src.integrations.hash-utils                                                       | application/applicationfunction | none/- (0.51)                 | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates                     | application/applicationfunction | none/- (0.46)                 | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Method src.coding-agents.agents.claude-code.ClaudeCodeAgent.monitorProcess               | application/applicationfunction | none/- (0.41)                 | A private method of ClaudeCodeAgent that consumes a spawned Claude Code subprocess's stdout and stderr, parses streamed events and resolves the result. This is  |
| Interface src.validators.validation-formatter.ValidationStats                            | none/-                          | application/dataobject (0.61) | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.commands.visualize.VisualizeOptions                                        | application/dataobject          | none/- (0.66)                 | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Method src.audit.relationships.spec.orchestrator.AuditOrchestrator.runDuplicateDetection | application/applicationfunction | none/- (0.37)                 | Thin orchestrator step that delegates to DuplicateDetector, optionally scoped to a single layer. It is a minor internal unit of behaviour within AuditOrchestrat |
| Interface src.validators.relationship-schema-validator.ManifestDistFile                  | none/-                          | application/dataobject (0.55) | A tiny local type describing the shape of a parsed manifest file inside the relationship schema validator. It has no callers or callees. It is an implementation |
| Method src.core.dependency-tracker.DependencyTracker.getMetrics                          | application/applicationfunction | none/- (0.50)                 | A method of DependencyTracker that computes graph statistics: node and edge counts, cycles and weakly connected components. It has no callers and is a minor int |

## clef-flash

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 47.1%  | 100         |
| none        | 90     | 91.1%  | 169         |
| data-model  | 8      | 50.0%  | 23          |
| security    | 4      | 25.0%  | 2           |
| apm         | 4      | 100.0% | 4           |
| testing     | 2      | 0.0%   | 1           |
| technology  | 1      | 0.0%   | 0           |
| product     | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 84    |
| application → data-model | 17    |
| none → application       | 6     |
| none → data-model        | 2     |
| security → application   | 2     |
| testing → none           | 2     |
| data-model → testing     | 1     |
| security → none          | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 21  | 0.28      | 0.29     | 0.01 |
| 0.3-0.4        | 113 | 0.35      | 0.48     | 0.12 |
| 0.4-0.5        | 88  | 0.44      | 0.65     | 0.20 |
| 0.5-0.6        | 49  | 0.53      | 0.80     | 0.26 |
| 0.6-0.7        | 22  | 0.64      | 0.82     | 0.18 |
| 0.7-0.8        | 6   | 0.75      | 1.00     | 0.25 |
| 0.8-0.9        | 1   | 0.80      | 1.00     | 0.20 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 26.0%    | 82.1%             |
| ≥0.60     | 9.7%     | 86.2%             |
| ≥0.70     | 2.3%     | 100.0%            |
| ≥0.80     | 0.3%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 0.50   | 0.67       |
| authorization        | 2              | n/a       | 0.00   | n/a        |
| data_persistence     | 53             | 1.00      | 0.25   | 0.39       |
| external_integration | 24             | 0.89      | 0.33   | 0.48       |
| observability        | 34             | 0.64      | 0.21   | 0.31       |
| user_interface       | 31             | 0.73      | 0.26   | 0.38       |

### Sample layer disagreements

| symbol                                                          | gold                             | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.core.virtual-projection.ModelDiff                 | application/dataobject           | none/- (0.32)                          | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Class src.export.graphml-exporter.GraphMLExporter               | application/applicationcomponent | none/- (0.33)                          | A pluggable Exporter implementation that serializes the model to GraphML. It is a cohesive, replaceable unit used by the export command and the MCP export tool. |
| Module src.schemas.bundled.testing                              | data-model/jsonschema            | testing/- (0.63)                       | This is the bundled JSON Schema (draft-07) for the testing layer of the specification itself. It defines node schemas such as contextvariation and coverageexclu |
| Module src.audit.relationships.analysis.layer-templates         | application/dataobject           | none/- (0.43)                          | A static configuration module declaring the LayerTemplate interface and per-layer expected relationship patterns, used as reference data for audit gap analysis. |
| Function src.integrations.hash-utils.scanDir                    | none/-                           | application/applicationfunction (0.37) | A nested recursive helper inside computeDirectoryHashes that walks a directory and hashes the files in it. It is a private implementation detail of the hashing  |
| Interface src.core.stats-collector.ValidationInfo               | application/dataobject           | none/- (0.38)                          | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Class src.audit.relationships.analysis.gap-analyzer.GapAnalyzer | application/applicationcomponent | none/- (0.41)                          | GapAnalyzer is a cohesive analysis class within the relationship audit subsystem. The AuditOrchestrator instantiates it, and it compares layer templates against |
| Method src.core.graph-model.GraphModel.traverse                 | application/applicationfunction  | none/- (0.35)                          | BFS traversal over the in-memory graph model, optionally filtered by predicate and bounded by depth. It is a notable internal capability of the GraphModel compo |
| Class src.core.relationship-catalog.RelationshipCatalog         | application/applicationcomponent | none/- (0.29)                          | Core class that loads the predicate and relationship schema catalog from bundled JSON files on disk and exposes relationship type lookups. It is used by CLI com |
| Module src.integrations.hash-utils                              | application/applicationfunction  | none/- (0.55)                          | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |

## clef@enriched-v1

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 70.7%  | 138         |
| none        | 90     | 90.0%  | 99          |
| data-model  | 8      | 87.5%  | 50          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |
| api         | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 38    |
| application → none       | 18    |
| none → data-model        | 4     |
| none → apm               | 2     |
| none → application       | 2     |
| data-model → security    | 1     |
| none → api               | 1     |
| technology → data-model  | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 3   | 0.28      | 0.00     | -0.28 |
| 0.3-0.4        | 36  | 0.36      | 0.39     | 0.03  |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27  |
| 0.5-0.6        | 89  | 0.55      | 0.82     | 0.27  |
| 0.6-0.7        | 73  | 0.66      | 0.90     | 0.25  |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22  |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 87.2%             |
| ≥0.60     | 35.7%    | 91.6%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.69      | 0.32   | 0.44       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Interface src.core.relationship-registry.RelationshipTypeMetadata    | application/dataobject          | data-model/objectschema (0.68) | A passive TypeScript interface that holds relationship-type metadata (predicate, inverse, category) for the relationship registry. It has no behaviour and no ca |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface holding three boolean flags (force, validate, dryRun) for the staging-area commit operation. It is a passive data structure with no be |
| Interface src.commands.visualize.VisualizeOptions                    | application/dataobject          | none/- (0.37)                  | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Module src.schemas.bundled.security                                  | data-model/jsonschema           | security/securitymodel (0.39)  | A bundled JSON Schema document that defines the node schemas for the spec's security layer, covering its node types and their attributes. In this codebase it is |

## claude-sonnet

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 90.6%  | 216         |
| none        | 90     | 51.1%  | 50          |
| data-model  | 8      | 62.5%  | 21          |
| security    | 4      | 100.0% | 4           |
| apm         | 4      | 100.0% | 5           |
| testing     | 2      | 0.0%   | 0           |
| technology  | 1      | 100.0% | 1           |
| api         | 0      | n/a    | 3           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 41    |
| application → data-model | 15    |
| data-model → none        | 3     |
| application → api        | 2     |
| testing → application    | 2     |
| none → apm               | 1     |
| none → data-model        | 1     |
| none → api               | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.4-0.5        | 5   | 0.40      | 0.40     | 0.00  |
| 0.5-0.6        | 24  | 0.51      | 0.17     | -0.34 |
| 0.6-0.7        | 91  | 0.60      | 0.75     | 0.15  |
| 0.7-0.8        | 23  | 0.71      | 0.83     | 0.12  |
| 0.8-0.9        | 146 | 0.82      | 0.89     | 0.07  |
| 0.9-1.0        | 11  | 0.90      | 0.91     | 0.01  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 98.3%    | 78.3%             |
| ≥0.60     | 90.3%    | 83.8%             |
| ≥0.70     | 60.0%    | 88.3%             |
| ≥0.80     | 52.3%    | 89.2%             |
| ≥0.90     | 3.7%     | 90.9%             |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 1.00      | 1.00   | 1.00       |
| data_persistence     | 53             | 0.89      | 0.45   | 0.60       |
| external_integration | 24             | 0.87      | 0.83   | 0.85       |
| observability        | 34             | 0.89      | 0.24   | 0.37       |
| user_interface       | 31             | 1.00      | 0.65   | 0.78       |

### Sample layer disagreements

| symbol                                                            | gold                   | predicted (conf)                       | gold rationale                                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module src.schemas.bundled.testing                                | data-model/jsonschema  | none/- (0.50)                          | This is the bundled JSON Schema (draft-07) for the testing layer of the specification itself. It defines node schemas such as contextvariation and coverageexclu |
| Method src.analyzers.cbm-analyzer.CbmAnalyzer.shapeRoute          | none/-                 | application/applicationfunction (0.80) | An @internal data-shaping helper that normalizes a raw CBM graph node into a route record with default values. It is extracted only for testability and has a si |
| Interface src.core.stats-collector.ValidationInfo                 | application/dataobject | data-model/objectschema (0.50)         | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Interface src.core.spec-loader.CompiledBase                       | application/dataobject | data-model/objectschema (0.50)         | A small TypeScript interface that only describes the shape of compiled spec data (version, schemas, predicates) used by the spec loader. As a passive state carr |
| Method src.utils.errors.CLIError.format                           | none/-                 | application/applicationfunction (0.60) | A formatting method that builds a colorized CLI error message string from the error's context and suggestions. It is a presentation helper on an error class, be |
| Interface src.core.relationship-registry.RelationshipTypeMetadata | application/dataobject | data-model/objectschema (0.50)         | A passive TypeScript interface that holds relationship-type metadata (predicate, inverse, category) for the relationship registry. It has no behaviour and no ca |
| Interface src.validators.validation-formatter.ValidationStats     | none/-                 | application/dataobject (0.60)          | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Function src.commands.reports.hasLayerReports                     | none/-                 | application/applicationfunction (0.85) | Small helper that checks whether markdown report files exist in the project's reports directory. It reads the filesystem directory listing and is used by the up |
| Module src.schemas.bundled.security                               | data-model/jsonschema  | none/- (0.60)                          | A bundled JSON Schema document that defines the node schemas for the spec's security layer, covering its node types and their attributes. In this codebase it is |
| Module src.schemas.bundled.application                            | data-model/jsonschema  | none/- (0.50)                          | A bundled JSON Schema document defining the node schemas for the Application Layer's nine element types (ArchiMate-derived). It is a schema contract the CLI val |

## clef@enriched-v2-kind

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 70.7%  | 138         |
| none        | 90     | 90.0%  | 99          |
| data-model  | 8      | 87.5%  | 50          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |
| api         | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 38    |
| application → none       | 18    |
| none → data-model        | 4     |
| none → apm               | 2     |
| none → application       | 2     |
| data-model → security    | 1     |
| none → api               | 1     |
| technology → data-model  | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 3   | 0.28      | 0.00     | -0.28 |
| 0.3-0.4        | 36  | 0.36      | 0.39     | 0.03  |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27  |
| 0.5-0.6        | 89  | 0.55      | 0.82     | 0.27  |
| 0.6-0.7        | 73  | 0.66      | 0.90     | 0.25  |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22  |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 87.2%             |
| ≥0.60     | 35.7%    | 91.6%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.69      | 0.32   | 0.44       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Interface src.core.relationship-registry.RelationshipTypeMetadata    | application/dataobject          | data-model/objectschema (0.68) | A passive TypeScript interface that holds relationship-type metadata (predicate, inverse, category) for the relationship registry. It has no behaviour and no ca |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface holding three boolean flags (force, validate, dryRun) for the staging-area commit operation. It is a passive data structure with no be |
| Interface src.commands.visualize.VisualizeOptions                    | application/dataobject          | none/- (0.37)                  | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Module src.schemas.bundled.security                                  | data-model/jsonschema           | security/securitymodel (0.39)  | A bundled JSON Schema document that defines the node schemas for the spec's security layer, covering its node types and their attributes. In this codebase it is |

## clef@enriched-v2

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 70.7%  | 138         |
| none        | 90     | 90.0%  | 99          |
| data-model  | 8      | 87.5%  | 50          |
| security    | 4      | 100.0% | 5           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |
| api         | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 38    |
| application → none       | 18    |
| none → data-model        | 4     |
| none → apm               | 2     |
| none → application       | 2     |
| data-model → security    | 1     |
| none → api               | 1     |
| technology → data-model  | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 3   | 0.28      | 0.00     | -0.28 |
| 0.3-0.4        | 36  | 0.36      | 0.39     | 0.03  |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27  |
| 0.5-0.6        | 89  | 0.55      | 0.82     | 0.27  |
| 0.6-0.7        | 73  | 0.66      | 0.90     | 0.25  |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22  |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 87.2%             |
| ≥0.60     | 35.7%    | 91.6%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.63   | 0.77       |
| observability        | 34             | 0.69      | 0.32   | 0.44       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is a passive, exported data structure. It holds the additions, modifications and deletions computed when a changeset is projected onto the model. It h |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that holds validation summary state (validity flag, timestamp, error and warning counts) inside the stats collector. It is |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Interface src.core.relationship-registry.RelationshipTypeMetadata    | application/dataobject          | data-model/objectschema (0.68) | A passive TypeScript interface that holds relationship-type metadata (predicate, inverse, category) for the relationship registry. It has no behaviour and no ca |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface holding three boolean flags (force, validate, dryRun) for the staging-area commit operation. It is a passive data structure with no be |
| Interface src.commands.visualize.VisualizeOptions                    | application/dataobject          | none/- (0.37)                  | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Module src.schemas.bundled.security                                  | data-model/jsonschema           | security/securitymodel (0.39)  | A bundled JSON Schema document that defines the node schemas for the spec's security layer, covering its node types and their attributes. In this codebase it is |

## clef@v2-kind-tier0-facts

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 191    | 88.0%  | 182         |
| none        | 90     | 85.6%  | 95          |
| data-model  | 8      | 62.5%  | 12          |
| security    | 4      | 100.0% | 4           |
| apm         | 4      | 100.0% | 6           |
| testing     | 2      | 50.0%  | 1           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 18    |
| none → application       | 10    |
| application → data-model | 5     |
| data-model → application | 3     |
| none → apm               | 2     |
| none → data-model        | 1     |
| technology → data-model  | 1     |
| testing → application    | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.3-0.4        | 10  | 0.37      | 0.60     | 0.23 |
| 0.4-0.5        | 52  | 0.45      | 0.67     | 0.22 |
| 0.5-0.6        | 82  | 0.55      | 0.83     | 0.28 |
| 0.6-0.7        | 100 | 0.65      | 0.95     | 0.30 |
| 0.7-0.8        | 49  | 0.74      | 0.98     | 0.23 |
| 0.8-0.9        | 7   | 0.83      | 1.00     | 0.17 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 79.3%    | 91.6%             |
| ≥0.60     | 52.0%    | 96.2%             |
| ≥0.70     | 18.7%    | 98.2%             |
| ≥0.80     | 2.3%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 53             | 1.00      | 0.32   | 0.49       |
| external_integration | 24             | 1.00      | 0.75   | 0.86       |
| observability        | 34             | 0.74      | 0.41   | 0.53       |
| user_interface       | 31             | 0.81      | 0.55   | 0.65       |

### Sample layer disagreements

| symbol                                                                                   | gold                            | predicted (conf)              | gold rationale                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints                            | application/applicationfunction | none/- (0.41)                 | Small exported helper inside the relationship command module. It looks up the catalog entry for a source-predicate-destination triple and returns that relations |
| Interface src.types.BackupManifest                                                       | data-model/objectschema         | application/dataobject (0.75) | An exported type definition describing the shape of a backup manifest (a list of files plus a timestamp). It is a domain data structure with no behaviour, so it |
| Module src.integrations.hash-utils                                                       | application/applicationfunction | none/- (0.51)                 | Utility module providing SHA256 file and directory hashing to detect changes in installed integration files. It is a small internal helper capability that reads |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates                     | application/applicationfunction | none/- (0.46)                 | A public method on SpecDataService that looks up which relationship predicates are valid between two spec node types. This is the lookup the CLI uses to validat |
| Method src.coding-agents.agents.claude-code.ClaudeCodeAgent.monitorProcess               | application/applicationfunction | none/- (0.41)                 | A private method of ClaudeCodeAgent that consumes a spawned Claude Code subprocess's stdout and stderr, parses streamed events and resolves the result. This is  |
| Interface src.validators.validation-formatter.ValidationStats                            | none/-                          | application/dataobject (0.61) | A small internal type holding summary counts for the validation formatter's output. It has no callers and no behaviour, and sits below the granularity a maintai |
| Interface src.commands.visualize.VisualizeOptions                                        | application/dataobject          | none/- (0.66)                 | A plain options interface holding the CLI flags for the visualize command (port, auth token, browser toggle). It is a passive data structure with no behaviour o |
| Method src.audit.relationships.spec.orchestrator.AuditOrchestrator.runDuplicateDetection | application/applicationfunction | none/- (0.37)                 | Thin orchestrator step that delegates to DuplicateDetector, optionally scoped to a single layer. It is a minor internal unit of behaviour within AuditOrchestrat |
| Interface src.validators.relationship-schema-validator.ManifestDistFile                  | none/-                          | application/dataobject (0.55) | A tiny local type describing the shape of a parsed manifest file inside the relationship schema validator. It has no callers or callees. It is an implementation |
| Method src.core.dependency-tracker.DependencyTracker.getMetrics                          | application/applicationfunction | none/- (0.50)                 | A method of DependencyTracker that computes graph statistics: node and edge counts, cycles and weakly connected components. It has no callers and is a minor int |
