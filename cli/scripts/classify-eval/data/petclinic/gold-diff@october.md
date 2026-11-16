# Gold diff: petclinic, october vs

Cards labelled in both: 106 (A 106, B 106)
Layer agreement: 102/106 (96.2%). Layer+type agreement: 102/106 (96.2%)
Mean significance: october 1.33, 1.29

## Layer changes (october -> )

| transition                | n   |
| ------------------------- | --- |
| application -> api        | 2   |
| application -> data-model | 1   |
| application -> none       | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Method    | 1       | 67  |
| Class     | 3       | 21  |
| Route     | 0       | 15  |
| Interface | 0       | 3   |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs october    | vs            |
| ---------------------------------------------- | ------------- | ------------- |
| claude-haiku                                   | 50.9% / 43.4% | 49.1% / 41.5% |
| claude-sonnet                                  | 75.5% / 72.6% | 75.5% / 73.6% |
| clef-flash                                     | 68.9% / 46.2% | 67.0% / 43.4% |
| clef                                           | 80.2% / 70.8% | 82.1% / 71.7% |
| clef@cbm010-kind-base                          | 81.1% / 78.3% | 82.1% / 79.2% |
| clef@cbm010-kind-tier0                         | 96.2% / 94.3% | 93.4% / 91.5% |
| clef@cbm012-kind-base                          | 84.0% / 80.2% | 84.0% / 80.2% |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 96.2% / 94.3% | 94.3% / 92.5% |
| clef@cbm012-kind-tier0-qset2-spec012           | 93.4% / 92.5% | 92.5% / 91.5% |
| clef@cbm012-kind-tier0-qset2                   | 96.2% / 94.3% | 94.3% / 92.5% |
| clef@cbm012-kind-tier0                         | 96.2% / 94.3% | 94.3% / 92.5% |
| clef@enriched-v1                               | 80.2% / 69.8% | 82.1% / 70.8% |
| clef@enriched-v2-kind                          | 80.2% / 68.9% | 82.1% / 69.8% |
| clef@enriched-v2                               | 80.2% / 69.8% | 82.1% / 70.8% |
| clef@v2-kind-base                              | 80.2% / 68.9% | 82.1% / 69.8% |
| clef@v2-kind-core                              | 80.2% / 68.9% | 82.1% / 69.8% |
| clef@v2-kind-tier0-facts-core                  | 96.2% / 94.3% | 94.3% / 91.5% |
| clef@v2-kind-tier0-facts                       | 96.2% / 94.3% | 94.3% / 91.5% |
| clef@v2-kind-tier0                             | 96.2% / 94.3% | 94.3% / 91.5% |

## Sample of relabelled symbols

| symbol                                                                             | october                          |                         | rationale                                                                                                                                              |
| ---------------------------------------------------------------------------------- | -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController   | application/applicationinterface | api/operation           | Spring MVC controller exposing GET /oups, which deliberately throws an exception to showcase error-page handling. It is an HTTP route handler, so it b |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                 | application/dataobject           | data-model/objectschema | Vets is a JAXB-annotated wrapper type whose shape is published as the XML/JSON response payload of the /vets resource endpoint. It is a serialized, sc |
| Class src.main.java.org.springframework.samples.petclinic.system.WelcomeController | application/applicationinterface | api/operation           | A Spring MVC controller whose only member is the GET / route handler, which returns the 'welcome' template name. It is best modelled as one HTTP opera |
| Method src.main.java.org.springframework.samples.petclinic.owner.Owner.addPet      | application/applicationfunction  | none/-                  | Collection-mutator method on the Owner entity that adds a pet while avoiding duplicates. It is an entity accessor-level helper, below the granularity  |
