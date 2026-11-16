# Gold diff: petclinic, baseline vs relabel-full

Cards labelled in both: 106 (A 106, B 106)
Layer agreement: 93/106 (87.7%). Layer+type agreement: 93/106 (87.7%)
Mean significance: baseline 1.33, relabel-full 1.29

## Layer changes (baseline -> relabel-full)

| transition                | n   |
| ------------------------- | --- |
| application -> api        | 11  |
| application -> data-model | 1   |
| application -> none       | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Method    | 10      | 67  |
| Class     | 3       | 21  |
| Route     | 0       | 15  |
| Interface | 0       | 3   |

## Prediction files scored against each gold (layer acc / type acc)

| backend                                        | vs baseline   | vs relabel-full |
| ---------------------------------------------- | ------------- | --------------- |
| claude-haiku                                   | 50.9% / 43.4% | 57.5% / 50.0%   |
| claude-sonnet                                  | 75.5% / 72.6% | 84.0% / 82.1%   |
| clef-flash                                     | 68.9% / 46.2% | 67.9% / 48.1%   |
| clef                                           | 80.2% / 70.8% | 88.7% / 79.2%   |
| clef@cbm010-kind-base                          | 81.1% / 78.3% | 88.7% / 86.8%   |
| clef@cbm010-kind-tier0                         | 96.2% / 94.3% | 84.9% / 83.0%   |
| clef@cbm012-kind-base                          | 84.0% / 80.2% | 88.7% / 86.8%   |
| clef@cbm012-kind-tier0-qset2-spec012-layercrit | 96.2% / 94.3% | 85.8% / 84.0%   |
| clef@cbm012-kind-tier0-qset2-spec012           | 93.4% / 92.5% | 84.0% / 83.0%   |
| clef@cbm012-kind-tier0-qset2                   | 96.2% / 94.3% | 85.8% / 84.0%   |
| clef@cbm012-kind-tier0                         | 96.2% / 94.3% | 85.8% / 84.0%   |
| clef@enriched-v1                               | 80.2% / 69.8% | 88.7% / 78.3%   |
| clef@enriched-v2-kind                          | 80.2% / 68.9% | 88.7% / 77.4%   |
| clef@enriched-v2                               | 80.2% / 69.8% | 88.7% / 78.3%   |
| clef@v2-kind-base                              | 80.2% / 68.9% | 88.7% / 77.4%   |
| clef@v2-kind-core                              | 80.2% / 68.9% | 88.7% / 77.4%   |
| clef@v2-kind-tier0-facts-core                  | 96.2% / 94.3% | 85.8% / 83.0%   |
| clef@v2-kind-tier0-facts                       | 96.2% / 94.3% | 85.8% / 83.0%   |
| clef@v2-kind-tier0                             | 96.2% / 94.3% | 85.8% / 83.0%   |

## Sample of relabelled symbols

| symbol                                                                                               | baseline                         | relabel-full            | relabel-full rationale                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Method src.main.java.org.springframework.samples.petclinic.system.CrashController.triggerException   | application/applicationfunction  | api/operation           | Handler bound to GET /oups. That makes it an HTTP operation, but it is only a demo endpoint that deliberately throws a RuntimeException to showcase er |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                     | application/applicationinterface | api/operation           | Spring MVC controller exposing GET /oups, which deliberately throws an exception to showcase error-page handling. It is an HTTP route handler, so it b |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm     | application/applicationfunction  | api/operation           | Spring MVC handler bound to GET /owners. It is an HTTP operation contract that searches owners by last name with pagination, then selects a view or re |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm        | application/applicationfunction  | api/operation           | Spring MVC handler bound to GET /owners/find, so it is one method-path HTTP operation of the server-side surface. It only returns the 'owners/findOwne |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetController.initUpdateForm        | application/applicationfunction  | api/operation           | Spring MVC GET handler bound to /owners/{ownerId}/pets/{petId}/edit; one method-path pair is an API operation. It returns the pet create/update form v |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                   | application/dataobject           | data-model/objectschema | Vets is a JAXB-annotated wrapper type whose shape is published as the XML/JSON response payload of the /vets resource endpoint. It is a serialized, sc |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showVetList             | application/applicationfunction  | api/operation           | Spring MVC handler bound to GET /vets.html. A route handler bound to a distinct method and path is an API operation. It drives the server-rendered vet |
| Method src.main.java.org.springframework.samples.petclinic.owner.VisitController.processNewVisitForm | application/applicationfunction  | api/operation           | HTTP POST route handler for /owners/{ownerId}/pets/{petId}/visits/new. It is a distinct method-path contract, so it is modelled as an API operation. I |
| Class src.main.java.org.springframework.samples.petclinic.system.WelcomeController                   | application/applicationinterface | api/operation           | A Spring MVC controller whose only member is the GET / route handler, which returns the 'welcome' template name. It is best modelled as one HTTP opera |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetController.processCreationForm   | application/applicationfunction  | api/operation           | Spring MVC POST handler for /owners/{ownerId}/pets/new: an HTTP method-path contract, so it is an API operation. It validates the pet, persists it thr |
| Method src.main.java.org.springframework.samples.petclinic.owner.Owner.addPet                        | application/applicationfunction  | none/-                  | Collection-mutator method on the Owner entity that adds a pet while avoiding duplicates. It is an entity accessor-level helper, below the granularity  |
| Method src.main.java.org.springframework.samples.petclinic.system.WelcomeController.welcome          | application/applicationfunction  | api/operation           | A Spring MVC handler bound to GET /, so it is modelled as an HTTP operation. It returns the 'welcome' view name, rendering the server-side home page,  |
