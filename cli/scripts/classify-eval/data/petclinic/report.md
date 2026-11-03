# Classification eval report: petclinic

Generated 2026-11-03T14:03:55.316Z. Cards: 106. Gold labels: 106.

## Gold label distribution

| layer       | n   |
| ----------- | --- |
| none        | 51  |
| application | 22  |
| api         | 15  |
| data-model  | 9   |
| data-store  | 7   |
| technology  | 2   |

Significance histogram (0..4): 38 / 19 / 26 / 22 / 1. Gold labels with a type id not in the spec: 0.

## Summary

| backend                       | n                | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| ----------------------------- | ---------------- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| clef@v2-kind-base             | 106              | 80.2%     | 68.9%                 | 85.9%                | 0.39    | 95.3%        | 0.221     | 840 ms         | $0.146     | $0.0014     |
| clef@v2-kind-tier0            | 106 (33 by rule) | 96.2%     | 94.3%                 | 98.0%                | 0.34    | 95.9%        | 0.316     | 465 ms         | $0.089     | $0.0008     |
| claude-haiku                  | 106              | 50.9%     | 43.4%                 | 85.2%                | 0.25    | 99.1%        | 0.162     | 1666 ms        | $0.050     | $0.0005     |
| clef@v2-kind-core             | 106              | 80.2%     | 68.9%                 | 85.9%                | 0.39    | 95.3%        | 0.221     | 654 ms         | $0.123     | $0.0012     |
| clef                          | 106              | 80.2%     | 70.8%                 | 88.2%                | 0.39    | 95.3%        | 0.221     | 642 ms         | $0.099     | $0.0009     |
| clef@v2-kind-tier0-facts-core | 106 (33 by rule) | 96.2%     | 94.3%                 | 98.0%                | 0.33    | 95.9%        | 0.308     | 572 ms         | $0.077     | $0.0007     |
| clef-flash                    | 106              | 68.9%     | 46.2%                 | 67.1%                | 0.67    | 88.7%        | 0.256     | 1097 ms        | $0.037     | $0.0003     |
| clef@enriched-v1              | 106              | 80.2%     | 69.8%                 | 87.1%                | 0.39    | 95.3%        | 0.221     | 621 ms         | $0.105     | $0.0010     |
| claude-sonnet                 | 106              | 75.5%     | 72.6%                 | 96.3%                | 0.20    | 99.1%        | 0.072     | 1560 ms        | $0.902     | $0.0085     |
| clef@enriched-v2-kind         | 106              | 80.2%     | 68.9%                 | 85.9%                | 0.39    | 95.3%        | 0.221     | 1225 ms        | $0.146     | $0.0014     |
| clef@enriched-v2              | 106              | 80.2%     | 69.8%                 | 87.1%                | 0.39    | 95.3%        | 0.221     | 891 ms         | $0.149     | $0.0014     |
| clef@v2-kind-tier0-facts      | 106 (33 by rule) | 96.2%     | 94.3%                 | 98.0%                | 0.33    | 95.9%        | 0.308     | 525 ms         | $0.090     | $0.0008     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

## clef@v2-kind-base

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| application | 22     | 27.3%  | 9           |
| api         | 15     | 100.0% | 28          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 13    |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.36     | 0.00  |
| 0.4-0.5        | 26  | 0.46      | 0.65     | 0.20  |
| 0.5-0.6        | 25  | 0.55      | 0.92     | 0.37  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 94.1%             |
| ≥0.60     | 40.6%    | 95.3%             |
| ≥0.70     | 28.3%    | 100.0%            |
| ≥0.80     | 17.0%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 1.00      | 0.31   | 0.47       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | n/a       | 0.00   | n/a        |

### Sample layer disagreements

| symbol                                                                                                                     | gold                             | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                            | data-store/accesspattern         | application/applicationinterface (0.42) | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                           | application/applicationcomponent | none/- (0.64)                           | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                                        | data-store/accesspattern         | application/applicationinterface (0.37) | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                              | application/applicationfunction  | api/operation (0.35)                    | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicApplication                                             | application/applicationcomponent | none/- (0.44)                           | This is the Spring Boot application entry point: the @SpringBootApplication class whose main method bootstraps the whole PetClinic deployable unit. It is best m |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList                          | application/applicationfunction  | api/operation (0.59)                    | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |

## clef@v2-kind-tier0

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 52          |
| application | 22     | 95.5%  | 22          |
| api         | 15     | 100.0% | 15          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 100.0% | 7           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| technology → none        | 2     |
| application → data-model | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 2   | 0.33      | 1.00     | 0.67  |
| 0.4-0.5        | 13  | 0.46      | 0.92     | 0.46  |
| 0.5-0.6        | 18  | 0.55      | 0.94     | 0.40  |
| 0.6-0.7        | 10  | 0.64      | 0.90     | 0.26  |
| 0.7-0.8        | 11  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 78.1%    | 96.5%             |
| ≥0.60     | 53.4%    | 97.4%             |
| ≥0.70     | 39.7%    | 100.0%            |
| ≥0.80     | 24.7%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 7              | 1.00      | 0.14   | 0.25       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 14             | n/a       | 0.00   | n/a        |

Calibration, threshold sweep, concerns, significance and latency are over the 73 model-asked cards; 33 cards were decided by a Tier-0 rule.

### Sample layer disagreements

| symbol                                                                                                                     | gold                         | predicted (conf)                       | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject       | data-model/- (0.29)                    | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice | none/- (0.47)                          | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice | none/- (0.67)                          | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |
| Method src.main.java.org.springframework.samples.petclinic.owner.Owner.addVisit                                            | none/-                       | application/applicationfunction (0.51) | A small domain method on the Owner entity that validates its arguments, looks up a pet and delegates to Pet.addVisit. It does no persistence or I/O itself. This |

## claude-haiku

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 39.2%  | 20          |
| application | 22     | 36.4%  | 32          |
| api         | 15     | 93.3%  | 24          |
| data-model  | 9      | 44.4%  | 9           |
| data-store  | 7      | 100.0% | 12          |
| technology  | 2      | 50.0%  | 4           |
| security    | 0      | n/a    | 1           |
| ux          | 0      | n/a    | 3           |
| navigation  | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 23    |
| application → api        | 10    |
| data-model → data-store  | 5     |
| none → data-model        | 5     |
| application → ux         | 3     |
| none → technology        | 2     |
| none → security          | 1     |
| application → technology | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.20      | 0.00     | -0.20 |
| 0.3-0.4        | 8   | 0.34      | 0.13     | -0.22 |
| 0.4-0.5        | 4   | 0.44      | 0.00     | -0.44 |
| 0.5-0.6        | 16  | 0.51      | 0.31     | -0.20 |
| 0.6-0.7        | 32  | 0.60      | 0.31     | -0.29 |
| 0.7-0.8        | 4   | 0.70      | 0.75     | 0.05  |
| 0.8-0.9        | 33  | 0.82      | 0.82     | -0.00 |
| 0.9-1.0        | 8   | 0.90      | 1.00     | 0.10  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 87.7%    | 57.0%             |
| ≥0.60     | 72.6%    | 62.3%             |
| ≥0.70     | 42.5%    | 84.4%             |
| ≥0.80     | 38.7%    | 85.4%             |
| ≥0.90     | 7.5%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 0.55      | 0.85   | 0.67       |
| external_integration | 0              | 0.00      | n/a    | n/a        |
| observability        | 1              | 0.00      | 0.00   | n/a        |
| user_interface       | 25             | 0.69      | 1.00   | 0.82       |

### Sample layer disagreements

| symbol                                                                                            | gold                             | predicted (conf)                       | gold rationale                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method src.main.java.org.springframework.samples.petclinic.owner.VisitController.setAllowedFields | none/-                           | security/permission (0.50)             | Spring @InitBinder boilerplate that stops request binding from setting 'id' fields, a small mass-assignment safeguard. It is framework configuration inside Visi |
| Class src.main.java.org.springframework.samples.petclinic.system.WebConfiguration                 | application/applicationcomponent | technology/technologyservice (0.20)    | Spring @Configuration class wiring i18n: a session-based locale resolver and a request interceptor for ?lang switching. It is a notable configuration component  |
| Class src.main.java.org.springframework.samples.petclinic.owner.Owner                             | data-model/objectschema          | data-store/collection (0.50)           | Owner is a core JPA domain entity with validated properties (address, city, telephone) and a one-to-many relationship to Pet. It is an entity/schema definition, |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                  | application/applicationcomponent | ux/componentinstance (0.35)            | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Method src.main.java.org.springframework.samples.petclinic.owner.Pet.getBirthDate                 | none/-                           | data-model/schemaproperty (0.35)       | A trivial getter on the Pet entity that returns a field. It is an accessor, not an architectural element. The Pet entity itself would be modelled in the data-mo |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetValidator.supports            | none/-                           | application/applicationfunction (0.60) | Boilerplate override of Spring's Validator.supports that performs a one-line type check for Pet. It is an implementation detail of PetValidator, not an architec |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm     | application/applicationfunction  | api/operation (0.55)                   | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated        | none/-                           | application/applicationfunction (0.60) | A private helper inside VetController. It builds a PageRequest and delegates to VetRepository.findAll. This is pagination plumbing below modelling granularity.  |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm  | application/applicationfunction  | api/operation (0.60)                   | A Spring MVC handler bound to GET /owners. It implements the owner search operation: it normalises the last-name query, paginates the results and either redirec |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                  | application/applicationinterface | api/controller (0.60)                  | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |

## clef@v2-kind-core

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| application | 22     | 27.3%  | 9           |
| api         | 15     | 100.0% | 28          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 13    |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.36     | 0.00  |
| 0.4-0.5        | 26  | 0.46      | 0.65     | 0.20  |
| 0.5-0.6        | 25  | 0.55      | 0.92     | 0.37  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 94.1%             |
| ≥0.60     | 40.6%    | 95.3%             |
| ≥0.70     | 28.3%    | 100.0%            |
| ≥0.80     | 17.0%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 1.00      | 0.31   | 0.47       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | n/a       | 0.00   | n/a        |

### Sample layer disagreements

| symbol                                                                                                                     | gold                             | predicted (conf)     | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                            | data-store/accesspattern         | application/- (0.42) | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                           | application/applicationcomponent | none/- (0.64)        | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                                        | data-store/accesspattern         | application/- (0.37) | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicApplication                                             | application/applicationcomponent | none/- (0.44)        | This is the Spring Boot application entry point: the @SpringBootApplication class whose main method bootstraps the whole PetClinic deployable unit. It is best m |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                              | application/applicationfunction  | api/operation (0.35) | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)  | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36) | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList                          | application/applicationfunction  | api/operation (0.59) | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)        | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)        | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |

## clef

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| application | 22     | 27.3%  | 9           |
| api         | 15     | 100.0% | 28          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 13    |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.36     | 0.00  |
| 0.4-0.5        | 26  | 0.46      | 0.65     | 0.20  |
| 0.5-0.6        | 25  | 0.55      | 0.92     | 0.37  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 94.1%             |
| ≥0.60     | 40.6%    | 95.3%             |
| ≥0.70     | 28.3%    | 100.0%            |
| ≥0.80     | 17.0%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 1.00      | 0.31   | 0.47       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | n/a       | 0.00   | n/a        |

### Sample layer disagreements

| symbol                                                                                                                     | gold                             | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                            | data-store/accesspattern         | application/applicationinterface (0.42) | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                           | application/applicationcomponent | none/- (0.64)                           | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                                        | data-store/accesspattern         | application/applicationinterface (0.37) | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                              | application/applicationfunction  | api/operation (0.35)                    | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicApplication                                             | application/applicationcomponent | none/- (0.44)                           | This is the Spring Boot application entry point: the @SpringBootApplication class whose main method bootstraps the whole PetClinic deployable unit. It is best m |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList                          | application/applicationfunction  | api/operation (0.59)                    | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |

## clef@v2-kind-tier0-facts-core

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 51          |
| application | 22     | 95.5%  | 23          |
| api         | 15     | 100.0% | 15          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 100.0% | 7           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 1     |
| technology → application | 1     |
| technology → none        | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 1   | 0.30      | 1.00     | 0.70 |
| 0.3-0.4        | 4   | 0.35      | 0.75     | 0.40 |
| 0.4-0.5        | 12  | 0.45      | 0.83     | 0.38 |
| 0.5-0.6        | 16  | 0.56      | 1.00     | 0.44 |
| 0.6-0.7        | 12  | 0.66      | 0.92     | 0.26 |
| 0.7-0.8        | 12  | 0.77      | 1.00     | 0.23 |
| 0.8-0.9        | 16  | 0.83      | 1.00     | 0.17 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 76.7%    | 98.2%             |
| ≥0.60     | 54.8%    | 97.5%             |
| ≥0.70     | 38.4%    | 100.0%            |
| ≥0.80     | 21.9%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 7              | 1.00      | 0.29   | 0.44       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 14             | n/a       | 0.00   | n/a        |

Calibration, threshold sweep, concerns, significance and latency are over the 73 model-asked cards; 33 cards were decided by a Tier-0 rule.

### Sample layer disagreements

| symbol                                                                                                                     | gold                         | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject       | data-model/- (0.34)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice | application/applicationcomponent (0.43) | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice | none/- (0.66)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |
| Method src.main.java.org.springframework.samples.petclinic.owner.Owner.addVisit                                            | none/-                       | application/applicationfunction (0.48)  | A small domain method on the Owner entity that validates its arguments, looks up a pet and delegates to Pet.addVisit. It does no persistence or I/O itself. This |

## clef-flash

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 64.7%  | 33          |
| application | 22     | 72.7%  | 43          |
| api         | 15     | 100.0% | 21          |
| data-model  | 9      | 100.0% | 9           |
| data-store  | 7      | 0.0%   | 0           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 18    |
| data-store → application | 7     |
| application → api        | 6     |
| technology → application | 2     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 3   | 0.28      | 0.33     | 0.05 |
| 0.3-0.4        | 35  | 0.37      | 0.49     | 0.12 |
| 0.4-0.5        | 50  | 0.45      | 0.76     | 0.31 |
| 0.5-0.6        | 14  | 0.53      | 0.93     | 0.40 |
| 0.6-0.7        | 3   | 0.62      | 1.00     | 0.38 |
| 0.7-0.8        | 1   | 0.72      | 1.00     | 0.28 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 17.0%    | 94.4%             |
| ≥0.60     | 3.8%     | 100.0%            |
| ≥0.70     | 0.9%     | 100.0%            |
| ≥0.80     | 0.0%     | n/a               |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 1.00      | 0.31   | 0.47       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | 0.67      | 0.16   | 0.26       |

### Sample layer disagreements

| symbol                                                                                                          | gold                            | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                 | data-store/accesspattern        | application/- (0.42)                   | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Interface src.main.java.org.springframework.samples.petclinic.owner.PetTypeRepository                           | data-store/accesspattern        | application/- (0.38)                   | Spring Data JPA repository for PetType. It is the persistence access layer and defines a custom JPQL query that reads pet types ordered by name. That makes it a |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                             | data-store/accesspattern        | application/- (0.42)                   | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                   | application/applicationfunction | api/operation (0.26)                   | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetValidator.supports                          | none/-                          | application/applicationfunction (0.40) | Boilerplate override of Spring's Validator.supports that performs a one-line type check for Pet. It is an implementation detail of PetValidator, not an architec |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated                      | none/-                          | application/applicationfunction (0.29) | A private helper inside VetController. It builds a PageRequest and delegates to VetRepository.findAll. This is pagination plumbing below modelling granularity.  |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.findPaginatedForOwnersLastName | none/-                          | application/applicationfunction (0.35) | Private helper in OwnerController that builds a fixed-size PageRequest and delegates to the repository query. It is an implementation detail of processFindForm, |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.cacheConfiguration         | none/-                          | application/applicationfunction (0.40) | This is a private helper that builds a JCache MutableConfiguration with statistics enabled, and its only caller is the cache customizer bean. It is an implement |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList               | application/applicationfunction | api/operation (0.38)                   | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetRepository.findAll                            | data-store/accesspattern        | application/- (0.33)                   | This is a Spring Data repository query method that reads Vet records from the data store in pages. It is transactional and cached. As a repository read operatio |

## clef@enriched-v1

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| application | 22     | 27.3%  | 9           |
| api         | 15     | 100.0% | 28          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 13    |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.36     | 0.00  |
| 0.4-0.5        | 26  | 0.46      | 0.65     | 0.20  |
| 0.5-0.6        | 25  | 0.55      | 0.92     | 0.37  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 94.1%             |
| ≥0.60     | 40.6%    | 95.3%             |
| ≥0.70     | 28.3%    | 100.0%            |
| ≥0.80     | 17.0%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 1.00      | 0.31   | 0.47       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | n/a       | 0.00   | n/a        |

### Sample layer disagreements

| symbol                                                                                                                     | gold                             | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                            | data-store/accesspattern         | application/applicationcomponent (0.42) | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                           | application/applicationcomponent | none/- (0.64)                           | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                              | application/applicationfunction  | api/operation (0.35)                    | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                                        | data-store/accesspattern         | application/applicationcomponent (0.37) | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicApplication                                             | application/applicationcomponent | none/- (0.44)                           | This is the Spring Boot application entry point: the @SpringBootApplication class whose main method bootstraps the whole PetClinic deployable unit. It is best m |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList                          | application/applicationfunction  | api/operation (0.59)                    | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |

## claude-sonnet

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 72.5%  | 37          |
| application | 22     | 45.5%  | 20          |
| api         | 15     | 100.0% | 26          |
| data-model  | 9      | 100.0% | 11          |
| data-store  | 7      | 100.0% | 7           |
| technology  | 2      | 100.0% | 5           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 11    |
| none → application       | 10    |
| none → technology        | 3     |
| application → data-model | 1     |
| none → data-model        | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.4-0.5        | 3   | 0.40      | 0.33     | -0.07 |
| 0.5-0.6        | 13  | 0.51      | 0.46     | -0.05 |
| 0.6-0.7        | 38  | 0.60      | 0.68     | 0.08  |
| 0.7-0.8        | 7   | 0.70      | 1.00     | 0.30  |
| 0.8-0.9        | 30  | 0.83      | 0.83     | 0.00  |
| 0.9-1.0        | 15  | 0.91      | 1.00     | 0.09  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 97.2%    | 76.7%             |
| ≥0.60     | 84.9%    | 81.1%             |
| ≥0.70     | 49.1%    | 90.4%             |
| ≥0.80     | 42.5%    | 88.9%             |
| ≥0.90     | 14.2%    | 100.0%            |
| ≥0.95     | 0.9%     | 100.0%            |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 0.88      | 0.54   | 0.67       |
| external_integration | 0              | 0.00      | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | 0.83      | 0.20   | 0.32       |

### Sample layer disagreements

| symbol                                                                                                          | gold                             | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method src.main.java.org.springframework.samples.petclinic.owner.VisitController.setAllowedFields               | none/-                           | application/applicationfunction (0.60) | Spring @InitBinder boilerplate that stops request binding from setting 'id' fields, a small mass-assignment safeguard. It is framework configuration inside Visi |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                   | application/applicationfunction  | api/operation (0.50)                   | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                              | application/dataobject           | data-model/objectschema (0.60)         | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated                      | none/-                           | application/applicationfunction (0.80) | A private helper inside VetController. It builds a PageRequest and delegates to VetRepository.findAll. This is pagination plumbing below modelling granularity.  |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                | application/applicationinterface | api/operation (0.50)                   | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                | application/applicationfunction  | api/operation (0.60)                   | A Spring MVC handler bound to GET /owners. It implements the owner search operation: it normalises the last-name query, paginates the results and either redirec |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.findPaginatedForOwnersLastName | none/-                           | application/applicationfunction (0.80) | Private helper in OwnerController that builds a fixed-size PageRequest and delegates to the repository query. It is an implementation detail of processFindForm, |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicRuntimeHints                                 | none/-                           | technology/artifact (0.50)             | GraalVM native-image runtime hints registrar. This is build/runtime configuration boilerplate that registers resource patterns and reflection types. It is not a |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.cacheConfiguration         | none/-                           | technology/artifact (0.40)             | This is a private helper that builds a JCache MutableConfiguration with statistics enabled, and its only caller is the cache customizer bean. It is an implement |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList               | application/applicationfunction  | api/operation (0.85)                   | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |

## clef@enriched-v2-kind

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| application | 22     | 27.3%  | 9           |
| api         | 15     | 100.0% | 28          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 13    |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.36     | 0.00  |
| 0.4-0.5        | 26  | 0.46      | 0.65     | 0.20  |
| 0.5-0.6        | 25  | 0.55      | 0.92     | 0.37  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 94.1%             |
| ≥0.60     | 40.6%    | 95.3%             |
| ≥0.70     | 28.3%    | 100.0%            |
| ≥0.80     | 17.0%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 1.00      | 0.31   | 0.47       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | n/a       | 0.00   | n/a        |

### Sample layer disagreements

| symbol                                                                                                                     | gold                             | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                            | data-store/accesspattern         | application/applicationinterface (0.42) | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                           | application/applicationcomponent | none/- (0.64)                           | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                                        | data-store/accesspattern         | application/applicationinterface (0.37) | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicApplication                                             | application/applicationcomponent | none/- (0.44)                           | This is the Spring Boot application entry point: the @SpringBootApplication class whose main method bootstraps the whole PetClinic deployable unit. It is best m |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                              | application/applicationfunction  | api/operation (0.35)                    | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList                          | application/applicationfunction  | api/operation (0.59)                    | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |

## clef@enriched-v2

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| application | 22     | 27.3%  | 9           |
| api         | 15     | 100.0% | 28          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 13    |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.36     | 0.00  |
| 0.4-0.5        | 26  | 0.46      | 0.65     | 0.20  |
| 0.5-0.6        | 25  | 0.55      | 0.92     | 0.37  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 94.1%             |
| ≥0.60     | 40.6%    | 95.3%             |
| ≥0.70     | 28.3%    | 100.0%            |
| ≥0.80     | 17.0%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 13             | 1.00      | 0.31   | 0.47       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 25             | n/a       | 0.00   | n/a        |

### Sample layer disagreements

| symbol                                                                                                                     | gold                             | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                            | data-store/accesspattern         | application/applicationcomponent (0.42) | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                           | application/applicationcomponent | none/- (0.64)                           | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                                        | data-store/accesspattern         | application/applicationcomponent (0.37) | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicApplication                                             | application/applicationcomponent | none/- (0.44)                           | This is the Spring Boot application entry point: the @SpringBootApplication class whose main method bootstraps the whole PetClinic deployable unit. It is best m |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.initFindForm                              | application/applicationfunction  | api/operation (0.35)                    | A Spring MVC GET /owners/find handler that returns the find-owners view name. As an HTTP route handler it is best modelled as an API operation. It is simple, wi |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.showResourcesVetList                          | application/applicationfunction  | api/operation (0.59)                    | An HTTP GET /vets route handler that returns a JSON/XML response body (@ResponseBody), so it is an API operation on the system boundary. Persistence is delegate |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |

## clef@v2-kind-tier0-facts

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 51          |
| application | 22     | 95.5%  | 23          |
| api         | 15     | 100.0% | 15          |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 100.0% | 7           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → data-model | 1     |
| technology → application | 1     |
| technology → none        | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 1   | 0.30      | 1.00     | 0.70 |
| 0.3-0.4        | 4   | 0.35      | 0.75     | 0.40 |
| 0.4-0.5        | 12  | 0.45      | 0.83     | 0.38 |
| 0.5-0.6        | 16  | 0.56      | 1.00     | 0.44 |
| 0.6-0.7        | 12  | 0.66      | 0.92     | 0.26 |
| 0.7-0.8        | 12  | 0.77      | 1.00     | 0.23 |
| 0.8-0.9        | 16  | 0.83      | 1.00     | 0.17 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 76.7%    | 98.2%             |
| ≥0.60     | 54.8%    | 97.5%             |
| ≥0.70     | 38.4%    | 100.0%            |
| ≥0.80     | 21.9%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 7              | 1.00      | 0.29   | 0.44       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 14             | n/a       | 0.00   | n/a        |

Calibration, threshold sweep, concerns, significance and latency are over the 73 model-asked cards; 33 cards were decided by a Tier-0 rule.

### Sample layer disagreements

| symbol                                                                                                                     | gold                         | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject       | data-model/- (0.34)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice | application/applicationcomponent (0.43) | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice | none/- (0.66)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |
| Method src.main.java.org.springframework.samples.petclinic.owner.Owner.addVisit                                            | none/-                       | application/applicationfunction (0.48)  | A small domain method on the Owner entity that validates its arguments, looks up a pet and delegates to Pet.addVisit. It does no persistence or I/O itself. This |
