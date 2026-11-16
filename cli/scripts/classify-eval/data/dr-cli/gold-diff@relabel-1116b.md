# Gold diff: dr-cli, relabel-1116 vs relabel-1116b

Cards labelled in both: 17 (A 17, B 17)
Layer agreement: 17/17 (100.0%). Layer+type agreement: 17/17 (100.0%)
Mean significance: relabel-1116 1.47, relabel-1116b 1.41

## Layer changes (relabel-1116 -> relabel-1116b)

| transition | n   |
| ---------- | --- |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Class     | 0       | 4   |
| Method    | 0       | 3   |
| Function  | 0       | 3   |
| Interface | 0       | 4   |
| Module    | 0       | 3   |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs relabel-1116 | vs relabel-1116b |
| ---------------------------------------------- | --------------- | ---------------- |
| claude-haiku                                   | 29.4% / 29.4%   | 29.4% / 29.4%    |
| claude-sonnet                                  | 64.7% / 58.8%   | 64.7% / 58.8%    |
| clef-flash                                     | 41.2% / 41.2%   | 41.2% / 41.2%    |
| clef                                           | 70.6% / 58.8%   | 70.6% / 58.8%    |
| clef@cbm010-kind-base                          | 76.5% / 70.6%   | 76.5% / 70.6%    |
| clef@cbm010-kind-tier0                         | 94.1% / 88.2%   | 94.1% / 88.2%    |
| clef@cbm012-kind-base                          | 76.5% / 70.6%   | 76.5% / 70.6%    |
| clef@cbm012-kind-tier0-port                    | 94.1% / 88.2%   | 94.1% / 88.2%    |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 94.1% / 88.2%   | 94.1% / 88.2%    |
| clef@cbm012-kind-tier0-qset2-spec012           | 76.5% / 76.5%   | 76.5% / 76.5%    |
| clef@cbm012-kind-tier0-qset2                   | 100.0% / 94.1%  | 100.0% / 94.1%   |
| clef@cbm012-kind-tier0                         | 94.1% / 88.2%   | 94.1% / 88.2%    |
| clef@diag-spec012-norules                      | 94.1% / 88.2%   | 94.1% / 88.2%    |
| clef@enriched-v1-kind-charter-short            | 47.1% / 47.1%   | 47.1% / 47.1%    |
| clef@enriched-v1-kind-charter                  | 47.1% / 47.1%   | 47.1% / 47.1%    |
| clef@enriched-v1-kind                          | 70.6% / 64.7%   | 70.6% / 64.7%    |
| clef@enriched-v1                               | 70.6% / 58.8%   | 70.6% / 58.8%    |
| clef@enriched-v2-kind                          | 70.6% / 64.7%   | 70.6% / 64.7%    |
| clef@enriched-v2                               | 70.6% / 58.8%   | 70.6% / 58.8%    |
| clef@v2-kind-base                              | 70.6% / 64.7%   | 70.6% / 64.7%    |
| clef@v2-kind-core                              | 70.6% / 64.7%   | 70.6% / 64.7%    |
| clef@v2-kind-tier0-facts-core                  | 88.2% / 82.4%   | 88.2% / 82.4%    |
| clef@v2-kind-tier0-facts                       | 88.2% / 82.4%   | 88.2% / 82.4%    |
| clef@v2-kind-tier0                             | 88.2% / 82.4%   | 88.2% / 82.4%    |
