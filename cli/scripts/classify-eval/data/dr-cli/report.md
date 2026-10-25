# Classification eval report: dr-cli

Generated 2026-10-25T14:53:05.654Z. Cards: 300. Gold labels: 300.

## Gold label distribution

| layer       | n   |
| ----------- | --- |
| application | 174 |
| none        | 82  |
| data-model  | 29  |
| security    | 5   |
| apm         | 5   |
| testing     | 2   |
| api         | 1   |
| technology  | 1   |
| data-store  | 1   |

Significance histogram (0..4): 44 / 90 / 99 / 65 / 2. Gold labels with a type id not in the spec: 2.

## Summary

| backend                       | n   | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| ----------------------------- | --- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| claude-haiku                  | 300 | 60.3%     | 49.3%                 | 81.8%                | 0.33    | 99.0%        | 0.140     | 1395 ms        | $0.113     | $0.0004     |
| clef                          | 300 | 81.3%     | 57.3%                 | 70.5%                | 0.37    | 96.7%        | 0.261     | 654 ms         | $0.269     | $0.0009     |
| clef@enriched-v1-kind         | 300 | 81.3%     | 60.7%                 | 74.6%                | 0.37    | 96.7%        | 0.261     | 754 ms         | $0.321     | $0.0011     |
| clef@enriched-v1-kind-charter | 300 | 34.3%     | 32.0%                 | 93.2%                | 0.68    | 77.0%        | 0.341     | 557 ms         | $0.346     | $0.0012     |
| clef-flash                    | 300 | 61.7%     | 50.3%                 | 81.6%                | 0.51    | 90.7%        | 0.182     | 979 ms         | $0.094     | $0.0003     |
| clef@enriched-v1              | 300 | 81.3%     | 58.0%                 | 71.3%                | 0.37    | 96.7%        | 0.261     | 824 ms         | $0.358     | $0.0012     |
| claude-sonnet                 | 300 | 78.3%     | 68.3%                 | 87.2%                | 0.16    | 99.7%        | 0.067     | 1498 ms        | $2.221     | $0.0074     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

## claude-haiku

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 174    | 51.7%  | 104         |
| none        | 82     | 84.1%  | 139         |
| data-model  | 29     | 27.6%  | 11          |
| apm         | 5      | 100.0% | 11          |
| security    | 5      | 100.0% | 5           |
| testing     | 2      | 100.0% | 9           |
| technology  | 1      | 100.0% | 9           |
| api         | 1      | 0.0%   | 8           |
| data-store  | 1      | 100.0% | 2           |
| product     | 0      | n/a    | 2           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 55    |
| data-model → none        | 14    |
| none → application       | 9     |
| application → technology | 8     |
| application → testing    | 6     |
| application → api        | 6     |
| data-model → application | 5     |
| application → apm        | 4     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.0-0.1        | 5   | 0.06      | 0.00     | -0.06 |
| 0.1-0.2        | 3   | 0.11      | 0.00     | -0.11 |
| 0.2-0.3        | 9   | 0.20      | 0.00     | -0.20 |
| 0.3-0.4        | 17  | 0.32      | 0.12     | -0.21 |
| 0.4-0.5        | 9   | 0.45      | 0.56     | 0.11  |
| 0.5-0.6        | 27  | 0.51      | 0.74     | 0.23  |
| 0.6-0.7        | 115 | 0.60      | 0.70     | 0.10  |
| 0.7-0.8        | 21  | 0.70      | 0.43     | -0.27 |
| 0.8-0.9        | 89  | 0.81      | 0.67     | -0.13 |
| 0.9-1.0        | 5   | 0.90      | 1.00     | 0.10  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 85.7%    | 67.7%             |
| ≥0.60     | 76.7%    | 67.0%             |
| ≥0.70     | 38.3%    | 64.3%             |
| ≥0.80     | 31.3%    | 69.1%             |
| ≥0.90     | 1.7%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 1.00      | 1.00   | 1.00       |
| data_persistence     | 56             | 0.88      | 0.64   | 0.74       |
| external_integration | 25             | 0.74      | 0.68   | 0.71       |
| observability        | 35             | 0.76      | 0.63   | 0.69       |
| user_interface       | 29             | 0.79      | 0.79   | 0.79       |

### Sample layer disagreements

| symbol                                                          | gold                             | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module src.schemas.bundled.testing                              | data-model/jsonschema            | testing/testcoveragemodel (0.80)       | A bundled JSON Schema document defining the node schemas for the testing layer in the Documentation Robotics spec. It is a canonical schema contract consumed by |
| Class src.export.graphml-exporter.GraphMLExporter               | application/applicationcomponent | technology/artifact (0.30)             | A pluggable Exporter implementation that serializes the architecture model to GraphML. It is one of several format exporters used by the export command and MCP  |
| Function src.commands.relationship.getRelationshipConstraints   | application/applicationfunction  | none/- (0.60)                          | A small lookup helper in the relationship CLI command module. It queries the relationship catalog for the cardinality and strength constraints of a source/predi |
| Class src.audit.relationships.analysis.gap-analyzer.GapAnalyzer | application/applicationcomponent | testing/- (0.12)                       | GapAnalyzer is a domain analysis class used by AuditOrchestrator. It compares layer relationship templates against existing relationships to find missing ones a |
| Function src.integrations.hash-utils.scanDir                    | none/-                           | application/applicationfunction (0.50) | Nested recursive helper inside computeDirectoryHashes that walks a directory and hashes files. It is an implementation detail of a hashing utility, not an archi |
| Module src.audit.relationships.analysis.layer-templates         | application/dataobject           | none/- (0.85)                          | A static configuration module holding per-layer relationship templates (expected source/destination/predicate patterns) that the audit gap analysis uses for sta |
| Interface src.core.stats-collector.ValidationInfo               | application/dataobject           | none/- (0.60)                          | A small exported TypeScript interface that describes the validation summary within the stats collector's output (validity flag, timestamp, error and warning cou |
| Method src.core.graph-model.GraphModel.traverse                 | application/applicationfunction  | none/- (0.80)                          | A BFS traversal over the in-memory graph model. It is a notable internal capability of the core GraphModel component, exposed upward through Model.traverse, but |
| Method src.analyzers.cbm-analyzer.CbmAnalyzer.shapeRoute        | none/-                           | application/applicationfunction (0.60) | A data-shaping helper that normalizes a raw CBM graph node into a route record with defaults. It is called only by verify() and was extracted for testability. I |
| Class src.core.relationship-catalog.RelationshipCatalog         | application/applicationcomponent | technology/- (0.20)                    | Core component that loads relationship predicates and per-layer relationship schemas from bundled JSON files and exposes a catalog of relationship types. It is  |

## clef

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 174    | 76.4%  | 138         |
| none        | 82     | 92.7%  | 99          |
| data-model  | 29     | 89.7%  | 50          |
| security    | 5      | 80.0%  | 5           |
| apm         | 5      | 80.0%  | 6           |
| testing     | 2      | 50.0%  | 1           |
| api         | 1      | 0.0%   | 1           |
| data-store  | 1      | 0.0%   | 0           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 22    |
| application → data-model | 19    |
| data-model → application | 2     |
| none → data-model        | 2     |
| none → apm               | 2     |
| data-model → security    | 1     |
| api → data-model         | 1     |
| data-store → application | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 3   | 0.28      | 0.33     | 0.06 |
| 0.3-0.4        | 36  | 0.36      | 0.44     | 0.08 |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27 |
| 0.5-0.6        | 89  | 0.55      | 0.87     | 0.32 |
| 0.6-0.7        | 73  | 0.66      | 0.97     | 0.31 |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22 |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 91.8%             |
| ≥0.60     | 35.7%    | 96.3%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 56             | 1.00      | 0.30   | 0.47       |
| external_integration | 25             | 1.00      | 0.60   | 0.75       |
| observability        | 35             | 0.81      | 0.37   | 0.51       |
| user_interface       | 29             | 0.76      | 0.55   | 0.64       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | A small lookup helper in the relationship CLI command module. It queries the relationship catalog for the cardinality and strength constraints of a source/predi |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is an exported TypeScript interface that describes the computed difference between a base model and a virtual projection: additions, modifications and |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that describes the validation summary within the stats collector's output (validity flag, timestamp, error and warning cou |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module that computes SHA256 file and directory hashes for change detection of integration files. It reads files from disk, which counts as data persiste |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | Small query method on SpecDataService that derives the unique relationship predicates valid between two spec node types using in-memory loader data. It is inter |
| Interface src.core.spec-loader.CompiledBase                          | data-model/objectschema         | application/dataobject (0.33)  | A small structural type describing the shape of a compiled spec bundle: version, schemas and predicates. It is a data-shape definition used internally by the sp |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal stats shape that the validation formatter uses to summarise element and relationship counts for output. It is a local helper type with no calle |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface configuring the staging-area commit operation (force, validate, dryRun). It is a passive parameter shape that matters only within the  |
| Function src.commands.reports.hasLayerReports                        | application/applicationfunction | none/- (0.47)                  | Small helper that reads the reports directory on disk to check for existing markdown layer reports; used only by the upgrade command. It is a minor internal fun |
| Module src.schemas.bundled.security                                  | data-model/jsonschema           | security/securitymodel (0.39)  | Bundled JSON Schema (draft-07) document defining the node schemas for the security layer of the Documentation Robotics spec. It is a canonical data contract use |

## clef@enriched-v1-kind

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 174    | 76.4%  | 138         |
| none        | 82     | 92.7%  | 99          |
| data-model  | 29     | 89.7%  | 50          |
| security    | 5      | 80.0%  | 5           |
| apm         | 5      | 80.0%  | 6           |
| testing     | 2      | 50.0%  | 1           |
| api         | 1      | 0.0%   | 1           |
| data-store  | 1      | 0.0%   | 0           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 22    |
| application → data-model | 19    |
| data-model → application | 2     |
| none → data-model        | 2     |
| none → apm               | 2     |
| data-model → security    | 1     |
| api → data-model         | 1     |
| data-store → application | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 3   | 0.28      | 0.33     | 0.06 |
| 0.3-0.4        | 36  | 0.36      | 0.44     | 0.08 |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27 |
| 0.5-0.6        | 89  | 0.55      | 0.87     | 0.32 |
| 0.6-0.7        | 73  | 0.66      | 0.97     | 0.31 |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22 |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 91.8%             |
| ≥0.60     | 35.7%    | 96.3%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 56             | 1.00      | 0.30   | 0.47       |
| external_integration | 25             | 1.00      | 0.60   | 0.75       |
| observability        | 35             | 0.81      | 0.37   | 0.51       |
| user_interface       | 29             | 0.76      | 0.55   | 0.64       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | A small lookup helper in the relationship CLI command module. It queries the relationship catalog for the cardinality and strength constraints of a source/predi |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is an exported TypeScript interface that describes the computed difference between a base model and a virtual projection: additions, modifications and |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that describes the validation summary within the stats collector's output (validity flag, timestamp, error and warning cou |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module that computes SHA256 file and directory hashes for change detection of integration files. It reads files from disk, which counts as data persiste |
| Interface src.core.spec-loader.CompiledBase                          | data-model/objectschema         | application/dataobject (0.33)  | A small structural type describing the shape of a compiled spec bundle: version, schemas and predicates. It is a data-shape definition used internally by the sp |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | Small query method on SpecDataService that derives the unique relationship predicates valid between two spec node types using in-memory loader data. It is inter |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal stats shape that the validation formatter uses to summarise element and relationship counts for output. It is a local helper type with no calle |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface configuring the staging-area commit operation (force, validate, dryRun). It is a passive parameter shape that matters only within the  |
| Function src.commands.reports.hasLayerReports                        | application/applicationfunction | none/- (0.47)                  | Small helper that reads the reports directory on disk to check for existing markdown layer reports; used only by the upgrade command. It is a minor internal fun |
| Interface src.core.virtual-projection.ProjectedModel                 | application/dataobject          | data-model/objectschema (0.40) | Interface defining the shape of a virtual projection of the architecture model (manifest, layers, relationships) with staged changes applied. It is an in-memory |

## clef@enriched-v1-kind-charter

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 174    | 8.6%   | 16          |
| none        | 82     | 100.0% | 274         |
| data-model  | 29     | 6.9%   | 5           |
| security    | 5      | 20.0%  | 2           |
| apm         | 5      | 60.0%  | 3           |
| testing     | 2      | 0.0%   | 0           |
| api         | 1      | 0.0%   | 0           |
| data-store  | 1      | 0.0%   | 0           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 157   |
| data-model → none        | 25    |
| security → none          | 4     |
| application → data-model | 2     |
| testing → none           | 2     |
| apm → none               | 2     |
| data-model → security    | 1     |
| data-model → application | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.3-0.4        | 8   | 0.36      | 0.25     | -0.11 |
| 0.4-0.5        | 44  | 0.45      | 0.30     | -0.16 |
| 0.5-0.6        | 42  | 0.56      | 0.10     | -0.46 |
| 0.6-0.7        | 60  | 0.65      | 0.05     | -0.60 |
| 0.7-0.8        | 65  | 0.76      | 0.25     | -0.51 |
| 0.8-0.9        | 71  | 0.85      | 0.77     | -0.07 |
| 0.9-1.0        | 10  | 0.91      | 1.00     | 0.09  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 82.7%    | 35.5%             |
| ≥0.60     | 68.7%    | 40.8%             |
| ≥0.70     | 48.7%    | 55.5%             |
| ≥0.80     | 27.0%    | 80.2%             |
| ≥0.90     | 3.3%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 1.00      | 1.00   | 1.00       |
| data_persistence     | 56             | 1.00      | 0.23   | 0.38       |
| external_integration | 25             | 1.00      | 0.60   | 0.75       |
| observability        | 35             | 0.81      | 0.37   | 0.51       |
| user_interface       | 29             | 0.83      | 0.66   | 0.73       |

### Sample layer disagreements

| symbol                                                          | gold                             | predicted (conf) | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function src.commands.relationship.getRelationshipConstraints   | application/applicationfunction  | none/- (0.77)    | A small lookup helper in the relationship CLI command module. It queries the relationship catalog for the cardinality and strength constraints of a source/predi |
| Interface src.core.virtual-projection.ModelDiff                 | application/dataobject           | none/- (0.58)    | ModelDiff is an exported TypeScript interface that describes the computed difference between a base model and a virtual projection: additions, modifications and |
| Class src.export.graphml-exporter.GraphMLExporter               | application/applicationcomponent | none/- (0.62)    | A pluggable Exporter implementation that serializes the architecture model to GraphML. It is one of several format exporters used by the export command and MCP  |
| Module src.schemas.bundled.testing                              | data-model/jsonschema            | none/- (0.42)    | A bundled JSON Schema document defining the node schemas for the testing layer in the Documentation Robotics spec. It is a canonical schema contract consumed by |
| Interface src.types.BackupManifest                              | data-model/objectschema          | none/- (0.40)    | An exported type definition describing the shape of a backup manifest: a list of backed-up files plus a creation timestamp. It is a domain record schema, so it  |
| Module src.audit.relationships.analysis.layer-templates         | application/dataobject           | none/- (0.68)    | A static configuration module holding per-layer relationship templates (expected source/destination/predicate patterns) that the audit gap analysis uses for sta |
| Class src.audit.relationships.analysis.gap-analyzer.GapAnalyzer | application/applicationcomponent | none/- (0.72)    | GapAnalyzer is a domain analysis class used by AuditOrchestrator. It compares layer relationship templates against existing relationships to find missing ones a |
| Interface src.core.stats-collector.ValidationInfo               | application/dataobject           | none/- (0.64)    | A small exported TypeScript interface that describes the validation summary within the stats collector's output (validity flag, timestamp, error and warning cou |
| Method src.core.graph-model.GraphModel.traverse                 | application/applicationfunction  | none/- (0.73)    | A BFS traversal over the in-memory graph model. It is a notable internal capability of the core GraphModel component, exposed upward through Model.traverse, but |
| Interface src.core.spec-loader.CompiledBase                     | data-model/objectschema          | none/- (0.62)    | A small structural type describing the shape of a compiled spec bundle: version, schemas and predicates. It is a data-shape definition used internally by the sp |

## clef-flash

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 174    | 51.1%  | 100         |
| none        | 82     | 92.7%  | 169         |
| data-model  | 29     | 51.7%  | 23          |
| security    | 5      | 20.0%  | 2           |
| apm         | 5      | 80.0%  | 4           |
| testing     | 2      | 0.0%   | 1           |
| api         | 1      | 0.0%   | 0           |
| data-store  | 1      | 0.0%   | 0           |
| technology  | 1      | 0.0%   | 0           |
| product     | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 78    |
| data-model → none        | 10    |
| application → data-model | 7     |
| none → application       | 6     |
| security → none          | 2     |
| security → application   | 2     |
| testing → none           | 2     |
| data-model → testing     | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 21  | 0.28      | 0.29     | 0.01 |
| 0.3-0.4        | 113 | 0.35      | 0.49     | 0.13 |
| 0.4-0.5        | 88  | 0.44      | 0.69     | 0.25 |
| 0.5-0.6        | 49  | 0.53      | 0.80     | 0.26 |
| 0.6-0.7        | 22  | 0.64      | 0.77     | 0.13 |
| 0.7-0.8        | 6   | 0.75      | 1.00     | 0.25 |
| 0.8-0.9        | 1   | 0.80      | 1.00     | 0.20 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 26.0%    | 80.8%             |
| ≥0.60     | 9.7%     | 82.8%             |
| ≥0.70     | 2.3%     | 100.0%            |
| ≥0.80     | 0.3%     | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 0.50   | 0.67       |
| authorization        | 2              | n/a       | 0.00   | n/a        |
| data_persistence     | 56             | 1.00      | 0.23   | 0.38       |
| external_integration | 25             | 1.00      | 0.36   | 0.53       |
| observability        | 35             | 0.82      | 0.26   | 0.39       |
| user_interface       | 29             | 0.64      | 0.24   | 0.35       |

### Sample layer disagreements

| symbol                                                          | gold                             | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.core.virtual-projection.ModelDiff                 | application/dataobject           | none/- (0.32)                          | ModelDiff is an exported TypeScript interface that describes the computed difference between a base model and a virtual projection: additions, modifications and |
| Class src.export.graphml-exporter.GraphMLExporter               | application/applicationcomponent | none/- (0.33)                          | A pluggable Exporter implementation that serializes the architecture model to GraphML. It is one of several format exporters used by the export command and MCP  |
| Module src.schemas.bundled.testing                              | data-model/jsonschema            | testing/- (0.63)                       | A bundled JSON Schema document defining the node schemas for the testing layer in the Documentation Robotics spec. It is a canonical schema contract consumed by |
| Module src.audit.relationships.analysis.layer-templates         | application/dataobject           | none/- (0.43)                          | A static configuration module holding per-layer relationship templates (expected source/destination/predicate patterns) that the audit gap analysis uses for sta |
| Function src.integrations.hash-utils.scanDir                    | none/-                           | application/applicationfunction (0.37) | Nested recursive helper inside computeDirectoryHashes that walks a directory and hashes files. It is an implementation detail of a hashing utility, not an archi |
| Interface src.core.stats-collector.ValidationInfo               | application/dataobject           | none/- (0.38)                          | A small exported TypeScript interface that describes the validation summary within the stats collector's output (validity flag, timestamp, error and warning cou |
| Class src.audit.relationships.analysis.gap-analyzer.GapAnalyzer | application/applicationcomponent | none/- (0.41)                          | GapAnalyzer is a domain analysis class used by AuditOrchestrator. It compares layer relationship templates against existing relationships to find missing ones a |
| Method src.core.graph-model.GraphModel.traverse                 | application/applicationfunction  | none/- (0.35)                          | A BFS traversal over the in-memory graph model. It is a notable internal capability of the core GraphModel component, exposed upward through Model.traverse, but |
| Class src.core.relationship-catalog.RelationshipCatalog         | application/applicationcomponent | none/- (0.29)                          | Core component that loads relationship predicates and per-layer relationship schemas from bundled JSON files and exposes a catalog of relationship types. It is  |
| Module src.integrations.hash-utils                              | application/applicationfunction  | none/- (0.55)                          | Utility module that computes SHA256 file and directory hashes for change detection of integration files. It reads files from disk, which counts as data persiste |

## clef@enriched-v1

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 174    | 76.4%  | 138         |
| none        | 82     | 92.7%  | 99          |
| data-model  | 29     | 89.7%  | 50          |
| security    | 5      | 80.0%  | 5           |
| apm         | 5      | 80.0%  | 6           |
| testing     | 2      | 50.0%  | 1           |
| api         | 1      | 0.0%   | 1           |
| data-store  | 1      | 0.0%   | 0           |
| technology  | 1      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 22    |
| application → data-model | 19    |
| data-model → application | 2     |
| none → data-model        | 2     |
| none → apm               | 2     |
| data-model → security    | 1     |
| api → data-model         | 1     |
| data-store → application | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 3   | 0.28      | 0.33     | 0.06 |
| 0.3-0.4        | 36  | 0.36      | 0.44     | 0.08 |
| 0.4-0.5        | 65  | 0.45      | 0.72     | 0.27 |
| 0.5-0.6        | 89  | 0.55      | 0.87     | 0.32 |
| 0.6-0.7        | 73  | 0.66      | 0.97     | 0.31 |
| 0.7-0.8        | 25  | 0.74      | 0.96     | 0.22 |
| 0.8-0.9        | 9   | 0.83      | 0.89     | 0.06 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 65.3%    | 91.8%             |
| ≥0.60     | 35.7%    | 96.3%             |
| ≥0.70     | 11.3%    | 94.1%             |
| ≥0.80     | 3.0%     | 88.9%             |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 0.67      | 1.00   | 0.80       |
| data_persistence     | 56             | 1.00      | 0.30   | 0.47       |
| external_integration | 25             | 1.00      | 0.60   | 0.75       |
| observability        | 35             | 0.81      | 0.37   | 0.51       |
| user_interface       | 29             | 0.76      | 0.55   | 0.64       |

### Sample layer disagreements

| symbol                                                               | gold                            | predicted (conf)               | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.core.virtual-projection.ModelDiff                      | application/dataobject          | data-model/objectschema (0.51) | ModelDiff is an exported TypeScript interface that describes the computed difference between a base model and a virtual projection: additions, modifications and |
| Function src.commands.relationship.getRelationshipConstraints        | application/applicationfunction | none/- (0.37)                  | A small lookup helper in the relationship CLI command module. It queries the relationship catalog for the cardinality and strength constraints of a source/predi |
| Interface src.core.stats-collector.ValidationInfo                    | application/dataobject          | data-model/objectschema (0.36) | A small exported TypeScript interface that describes the validation summary within the stats collector's output (validity flag, timestamp, error and warning cou |
| Module src.integrations.hash-utils                                   | application/applicationfunction | none/- (0.61)                  | Utility module that computes SHA256 file and directory hashes for change detection of integration files. It reads files from disk, which counts as data persiste |
| Method src.core.spec-data-service.SpecDataService.getValidPredicates | application/applicationfunction | none/- (0.42)                  | Small query method on SpecDataService that derives the unique relationship predicates valid between two spec node types using in-memory loader data. It is inter |
| Interface src.core.spec-loader.CompiledBase                          | data-model/objectschema         | application/dataobject (0.33)  | A small structural type describing the shape of a compiled spec bundle: version, schemas and predicates. It is a data-shape definition used internally by the sp |
| Interface src.validators.validation-formatter.ValidationStats        | none/-                          | data-model/- (0.31)            | A small internal stats shape that the validation formatter uses to summarise element and relationship counts for output. It is a local helper type with no calle |
| Interface src.core.staging-area.CommitOptions                        | application/dataobject          | none/- (0.35)                  | A small options interface configuring the staging-area commit operation (force, validate, dryRun). It is a passive parameter shape that matters only within the  |
| Function src.commands.reports.hasLayerReports                        | application/applicationfunction | none/- (0.47)                  | Small helper that reads the reports directory on disk to check for existing markdown layer reports; used only by the upgrade command. It is a minor internal fun |
| Module src.schemas.bundled.security                                  | data-model/jsonschema           | security/securitymodel (0.39)  | Bundled JSON Schema (draft-07) document defining the node schemas for the security layer of the Documentation Robotics spec. It is a canonical data contract use |

## claude-sonnet

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| application | 174    | 95.4%  | 216         |
| none        | 82     | 53.7%  | 50          |
| data-model  | 29     | 55.2%  | 21          |
| security    | 5      | 80.0%  | 4           |
| apm         | 5      | 80.0%  | 5           |
| testing     | 2      | 0.0%   | 0           |
| api         | 1      | 0.0%   | 3           |
| data-store  | 1      | 0.0%   | 0           |
| technology  | 1      | 100.0% | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 35    |
| data-model → application | 9     |
| data-model → none        | 4     |
| application → data-model | 4     |
| application → api        | 2     |
| application → none       | 2     |
| testing → application    | 2     |
| none → apm               | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.4-0.5        | 5   | 0.40      | 0.60     | 0.20 |
| 0.5-0.6        | 24  | 0.51      | 0.58     | 0.07 |
| 0.6-0.7        | 91  | 0.60      | 0.65     | 0.05 |
| 0.7-0.8        | 23  | 0.71      | 0.78     | 0.08 |
| 0.8-0.9        | 146 | 0.82      | 0.90     | 0.08 |
| 0.9-1.0        | 11  | 0.90      | 0.91     | 0.01 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 98.3%    | 78.6%             |
| ≥0.60     | 90.3%    | 80.4%             |
| ≥0.70     | 60.0%    | 88.3%             |
| ≥0.80     | 52.3%    | 89.8%             |
| ≥0.90     | 3.7%     | 90.9%             |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 2              | 1.00      | 1.00   | 1.00       |
| authorization        | 2              | 1.00      | 1.00   | 1.00       |
| data_persistence     | 56             | 0.93      | 0.45   | 0.60       |
| external_integration | 25             | 0.91      | 0.84   | 0.87       |
| observability        | 35             | 0.89      | 0.23   | 0.36       |
| user_interface       | 29             | 1.00      | 0.69   | 0.82       |

### Sample layer disagreements

| symbol                                                                | gold                   | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module src.schemas.bundled.testing                                    | data-model/jsonschema  | none/- (0.50)                          | A bundled JSON Schema document defining the node schemas for the testing layer in the Documentation Robotics spec. It is a canonical schema contract consumed by |
| Method src.analyzers.cbm-analyzer.CbmAnalyzer.shapeRoute              | none/-                 | application/applicationfunction (0.80) | A data-shaping helper that normalizes a raw CBM graph node into a route record with defaults. It is called only by verify() and was extracted for testability. I |
| Interface src.core.stats-collector.ValidationInfo                     | application/dataobject | data-model/objectschema (0.50)         | A small exported TypeScript interface that describes the validation summary within the stats collector's output (validity flag, timestamp, error and warning cou |
| Method src.utils.errors.CLIError.format                               | none/-                 | application/applicationfunction (0.60) | Formatting method that builds a colored CLI error message string from the error's context and suggestions. It is a presentation helper on an error class, with n |
| Interface src.validators.validation-formatter.ValidationStats         | none/-                 | application/dataobject (0.60)          | A small internal stats shape that the validation formatter uses to summarise element and relationship counts for output. It is a local helper type with no calle |
| Interface src.commands.visualize.VisualizeOptions                     | none/-                 | application/dataobject (0.60)          | A CLI options bag interface for the visualize command. It is a plain parameter type that only shapes command input and holds no architectural behaviour of its o |
| Module src.schemas.bundled.security                                   | data-model/jsonschema  | none/- (0.60)                          | Bundled JSON Schema (draft-07) document defining the node schemas for the security layer of the Documentation Robotics spec. It is a canonical data contract use |
| Module src.schemas.bundled.application                                | data-model/jsonschema  | none/- (0.50)                          | A bundled JSON Schema document that defines the node schemas for the Application layer in the Documentation Robotics spec. It is a canonical schema contract con |
| Function src.mcp.tools.shared.logToolError                            | none/-                 | apm/- (0.40)                           | Small helper that writes MCP tool failures to stderr for operator visibility. It does logging work, so observability applies, but it is a trivial internal utili |
| Method src.core.virtual-projection.VirtualProjectionEngine.cloneLayer | none/-                 | application/applicationfunction (0.85) | Private helper that shallow-copies a Layer and its elements for read-only projection. It is an implementation detail of VirtualProjectionEngine, has a single ca |
