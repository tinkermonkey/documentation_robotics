# Classification eval report: dr-cli

Generated 2026-10-24T23:30:50.691Z. Cards: 300. Gold labels: 300.

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

| backend    | n   | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| ---------- | --- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| clef       | 300 | 81.3%     | 57.3%                 | 70.5%                | 0.37    | 96.7%        | 0.261     | 654 ms         | $0.269     | $0.0009     |
| clef-flash | 300 | 61.7%     | 50.3%                 | 81.6%                | 0.51    | 90.7%        | 0.182     | 979 ms         | $0.094     | $0.0003     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

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
