# Gold diff: dr-cli, baseline vs relabel-1116

Cards labelled in both: 17 (A 300, B 17)
Layer agreement: 14/17 (82.4%). Layer+type agreement: 14/17 (82.4%)
Mean significance: baseline 1.47, relabel-1116 1.47

## Layer changes (baseline -> relabel-1116)

| transition                | n   |
| ------------------------- | --- |
| application -> none       | 2   |
| data-model -> application | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Function  | 0       | 3   |
| Method    | 0       | 3   |
| Class     | 0       | 4   |
| Interface | 2       | 4   |
| Module    | 1       | 3   |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs baseline   | vs relabel-1116 |
| ---------------------------------------------- | ------------- | --------------- |
| claude-haiku                                   | 59.0% / 50.7% | 29.4% / 29.4%   |
| claude-sonnet                                  | 77.7% / 66.7% | 64.7% / 58.8%   |
| clef-flash                                     | 60.3% / 46.7% | 41.2% / 41.2%   |
| clef                                           | 77.3% / 53.0% | 70.6% / 58.8%   |
| clef@cbm010-kind-base                          | 79.3% / 65.7% | 76.5% / 70.6%   |
| clef@cbm010-kind-tier0                         | 89.7% / 76.0% | 94.1% / 88.2%   |
| clef@cbm012-kind-base                          | 81.0% / 68.3% | 76.5% / 70.6%   |
| clef@cbm012-kind-tier0-port                    | 91.3% / 78.3% | 94.1% / 88.2%   |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 88.0% / 74.7% | 94.1% / 88.2%   |
| clef@cbm012-kind-tier0-qset2-spec012           | 73.7% / 63.7% | 76.5% / 76.5%   |
| clef@cbm012-kind-tier0-qset2                   | 89.7% / 77.3% | 100.0% / 94.1%  |
| clef@cbm012-kind-tier0                         | 91.3% / 78.3% | 94.1% / 88.2%   |
| clef@diag-spec012-norules                      | 88.0% / 74.7% | 94.1% / 88.2%   |
| clef@enriched-v1-kind-charter-short            | 57.3% / 50.0% | 47.1% / 47.1%   |
| clef@enriched-v1-kind-charter                  | 37.0% / 36.0% | 47.1% / 47.1%   |
| clef@enriched-v1-kind                          | 77.3% / 63.7% | 70.6% / 64.7%   |
| clef@enriched-v1                               | 77.3% / 61.0% | 70.6% / 58.8%   |
| clef@enriched-v2-kind                          | 77.3% / 64.3% | 70.6% / 64.7%   |
| clef@enriched-v2                               | 77.3% / 60.3% | 70.6% / 58.8%   |
| clef@v2-kind-base                              | 77.3% / 64.3% | 70.6% / 64.7%   |
| clef@v2-kind-core                              | 77.3% / 61.7% | 70.6% / 64.7%   |
| clef@v2-kind-tier0-facts-core                  | 86.3% / 71.7% | 88.2% / 82.4%   |
| clef@v2-kind-tier0-facts                       | 86.3% / 73.7% | 88.2% / 82.4%   |
| clef@v2-kind-tier0                             | 88.0% / 75.0% | 88.2% / 82.4%   |

## Sample of relabelled symbols

| symbol                                      | baseline                        | relabel-1116           | relabel-1116 rationale                                                                                                                                 |
| ------------------------------------------- | ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Interface src.core.spec-loader.CompiledBase | application/dataobject          | none/-                 | A small internal type describing the base shape of compiled spec data (specVersion, schemas, predicates) used inside the spec loader. It is a structur |
| Interface src.types.BackupManifest          | data-model/objectschema         | application/dataobject | A readonly TypeScript interface that holds backup manifest state (the list of files and a timestamp). It has no behaviour of its own and is not publis |
| Module src.integrations.hash-utils          | application/applicationfunction | none/-                 | Utility module providing SHA256 file hashing for change detection of integration files. It is a generic helper below the granularity of an architectur |
