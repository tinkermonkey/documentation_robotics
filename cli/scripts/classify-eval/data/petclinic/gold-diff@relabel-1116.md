# Gold diff: petclinic, baseline vs relabel-1116

Cards labelled in both: 16 (A 106, B 16)
Layer agreement: 14/16 (87.5%). Layer+type agreement: 14/16 (87.5%)
Mean significance: baseline 2.06, relabel-1116 2.13

## Layer changes (baseline -> relabel-1116)

| transition                | n   |
| ------------------------- | --- |
| application -> api        | 1   |
| application -> data-model | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Method    | 1       | 4   |
| Interface | 0       | 3   |
| Route     | 0       | 4   |
| Class     | 1       | 5   |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs baseline   | vs relabel-1116 |
| ---------------------------------------------- | ------------- | --------------- |
| claude-haiku                                   | 50.9% / 43.4% | 56.3% / 43.8%   |
| claude-sonnet                                  | 75.5% / 72.6% | 93.8% / 93.8%   |
| clef-flash                                     | 68.9% / 46.2% | 68.8% / 37.5%   |
| clef                                           | 80.2% / 70.8% | 75.0% / 62.5%   |
| clef@cbm010-kind-base                          | 81.1% / 78.3% | 75.0% / 75.0%   |
| clef@cbm010-kind-tier0                         | 96.2% / 94.3% | 87.5% / 87.5%   |
| clef@cbm012-kind-base                          | 84.0% / 80.2% | 87.5% / 87.5%   |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 96.2% / 94.3% | 93.8% / 93.8%   |
| clef@cbm012-kind-tier0-qset2-spec012           | 93.4% / 92.5% | 87.5% / 87.5%   |
| clef@cbm012-kind-tier0-qset2                   | 96.2% / 94.3% | 93.8% / 93.8%   |
| clef@cbm012-kind-tier0                         | 96.2% / 94.3% | 93.8% / 93.8%   |
| clef@enriched-v1                               | 80.2% / 69.8% | 75.0% / 62.5%   |
| clef@enriched-v2-kind                          | 80.2% / 68.9% | 75.0% / 62.5%   |
| clef@enriched-v2                               | 80.2% / 69.8% | 75.0% / 62.5%   |
| clef@v2-kind-base                              | 80.2% / 68.9% | 75.0% / 62.5%   |
| clef@v2-kind-core                              | 80.2% / 68.9% | 75.0% / 62.5%   |
| clef@v2-kind-tier0-facts-core                  | 96.2% / 94.3% | 93.8% / 87.5%   |
| clef@v2-kind-tier0-facts                       | 96.2% / 94.3% | 93.8% / 87.5%   |
| clef@v2-kind-tier0                             | 96.2% / 94.3% | 93.8% / 87.5%   |

## Sample of relabelled symbols

| symbol                                                                                        | baseline                        | relabel-1116            | relabel-1116 rationale                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm | application/applicationfunction | api/operation           | A Spring MVC handler bound to GET /owners/find, so it is one method-path HTTP operation. It contains no logic: it only returns the 'owners/findOwners' |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                            | application/dataobject          | data-model/objectschema | Vets is a JAXB-annotated wrapper whose shape is published as the XML/JSON payload of the vets resource endpoint. Because it is a serialized response s |
