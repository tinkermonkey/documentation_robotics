# Classification eval report: petclinic

Generated 2026-10-28T19:12:26.133Z. Cards: 106. Gold labels: 106.

## Gold label distribution

| layer       | n   |
| ----------- | --- |
| none        | 51  |
| api         | 24  |
| application | 13  |
| data-model  | 9   |
| data-store  | 7   |
| technology  | 2   |

Significance histogram (0..4): 38 / 19 / 26 / 22 / 1. Gold labels with a type id not in the spec: 0.

## Summary

| backend               | n   | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| --------------------- | --- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| claude-haiku          | 106 | 59.4%     | 51.9%                 | 87.3%                | 0.25    | 99.1%        | 0.152     | 1666 ms        | $0.050     | $0.0005     |
| clef                  | 106 | 86.8%     | 78.3%                 | 90.2%                | 0.39    | 95.3%        | 0.287     | 642 ms         | $0.099     | $0.0009     |
| clef-flash            | 106 | 69.8%     | 50.9%                 | 73.0%                | 0.67    | 88.7%        | 0.265     | 1097 ms        | $0.037     | $0.0003     |
| clef@enriched-v1      | 106 | 86.8%     | 77.4%                 | 89.1%                | 0.39    | 95.3%        | 0.287     | 621 ms         | $0.105     | $0.0010     |
| claude-sonnet         | 106 | 84.0%     | 81.1%                 | 96.6%                | 0.20    | 99.1%        | 0.145     | 1560 ms        | $0.902     | $0.0085     |
| clef@enriched-v2-kind | 106 | 86.8%     | 76.4%                 | 88.0%                | 0.39    | 95.3%        | 0.287     | 1225 ms        | $0.146     | $0.0014     |
| clef@enriched-v2      | 106 | 86.8%     | 77.4%                 | 89.1%                | 0.39    | 95.3%        | 0.287     | 891 ms         | $0.149     | $0.0014     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

## claude-haiku

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 39.2%  | 20          |
| api         | 24     | 95.8%  | 24          |
| application | 13     | 61.5%  | 32          |
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
| data-model → data-store  | 5     |
| none → data-model        | 5     |
| application → ux         | 3     |
| none → technology        | 2     |
| none → security          | 1     |
| application → technology | 1     |
| application → api        | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.20      | 0.00     | -0.20 |
| 0.3-0.4        | 8   | 0.34      | 0.13     | -0.22 |
| 0.4-0.5        | 4   | 0.44      | 0.00     | -0.44 |
| 0.5-0.6        | 16  | 0.51      | 0.38     | -0.14 |
| 0.6-0.7        | 32  | 0.60      | 0.44     | -0.16 |
| 0.7-0.8        | 4   | 0.70      | 1.00     | 0.30  |
| 0.8-0.9        | 33  | 0.82      | 0.91     | 0.09  |
| 0.9-1.0        | 8   | 0.90      | 1.00     | 0.10  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 87.7%    | 66.7%             |
| ≥0.60     | 72.6%    | 72.7%             |
| ≥0.70     | 42.5%    | 93.3%             |
| ≥0.80     | 38.7%    | 92.7%             |
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

| symbol                                                                                                  | gold                             | predicted (conf)                       | gold rationale                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method src.main.java.org.springframework.samples.petclinic.owner.VisitController.setAllowedFields       | none/-                           | security/permission (0.50)             | Spring @InitBinder boilerplate that stops request binding from setting 'id' fields, a small mass-assignment safeguard. It is framework configuration inside Visi |
| Class src.main.java.org.springframework.samples.petclinic.system.WebConfiguration                       | application/applicationcomponent | technology/technologyservice (0.20)    | Spring @Configuration class wiring i18n: a session-based locale resolver and a request interceptor for ?lang switching. It is a notable configuration component  |
| Class src.main.java.org.springframework.samples.petclinic.owner.Owner                                   | data-model/objectschema          | data-store/collection (0.50)           | Owner is a core JPA domain entity with validated properties (address, city, telephone) and a one-to-many relationship to Pet. It is an entity/schema definition, |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                        | application/applicationcomponent | ux/componentinstance (0.35)            | A Spring @Component Formatter that converts between PetType and its string form for MVC binding, looking up types through an injected repository. It is a depend |
| Method src.main.java.org.springframework.samples.petclinic.owner.Pet.getBirthDate                       | none/-                           | data-model/schemaproperty (0.35)       | A trivial getter on the Pet entity that returns a field. It is an accessor, not an architectural element. The Pet entity itself would be modelled in the data-mo |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetValidator.supports                  | none/-                           | application/applicationfunction (0.60) | Boilerplate override of Spring's Validator.supports that performs a one-line type check for Pet. It is an implementation detail of PetValidator, not an architec |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated              | none/-                           | application/applicationfunction (0.60) | A private helper inside VetController. It builds a PageRequest and delegates to VetRepository.findAll. This is pagination plumbing below modelling granularity.  |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                        | application/applicationinterface | api/controller (0.60)                  | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vet                                       | data-model/objectschema          | data-store/collection (0.60)           | Vet is a JPA entity and core domain object (a veterinarian with a many-to-many set of specialties). As an entity class describing domain data, it maps to a data |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.cacheConfiguration | none/-                           | application/applicationfunction (0.50) | This is a private helper that builds a JCache MutableConfiguration with statistics enabled, and its only caller is the cache customizer bean. It is an implement |

## clef

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| api         | 24     | 95.8%  | 28          |
| application | 13     | 38.5%  | 9           |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 5     |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| api → application        | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.73     | 0.37  |
| 0.4-0.5        | 26  | 0.46      | 0.73     | 0.27  |
| 0.5-0.6        | 25  | 0.55      | 0.96     | 0.41  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 95.6%             |
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
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                           | api/operation                    | application/applicationinterface (0.37) | A Spring MVC handler bound to GET /owners. It implements the owner search operation: it normalises the last-name query, paginates the results and either redirec |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |
| Class src.main.java.org.springframework.samples.petclinic.vet.VetController                                                | application/applicationinterface | api/paths (0.43)                        | A Spring MVC @Controller that serves the vets HTML page, with pagination, and a JSON vets resource. As the access point exposing vet-listing behaviour over HTTP |

## clef-flash

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 64.7%  | 33          |
| api         | 24     | 83.3%  | 21          |
| application | 13     | 92.3%  | 43          |
| data-model  | 9      | 100.0% | 9           |
| data-store  | 7      | 0.0%   | 0           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 18    |
| data-store → application | 7     |
| api → application        | 4     |
| technology → application | 2     |
| application → api        | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 3   | 0.28      | 0.33     | 0.05 |
| 0.3-0.4        | 35  | 0.37      | 0.51     | 0.15 |
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

| symbol                                                                                                          | gold                         | predicted (conf)                        | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                 | data-store/accesspattern     | application/- (0.42)                    | Spring Data repository interface defining read access to Vet records (findAll, paged findAll) with transactional and cache annotations. It is the persistence ac |
| Interface src.main.java.org.springframework.samples.petclinic.owner.PetTypeRepository                           | data-store/accesspattern     | application/- (0.38)                    | Spring Data JPA repository for PetType. It is the persistence access layer and defines a custom JPQL query that reads pet types ordered by name. That makes it a |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                             | data-store/accesspattern     | application/- (0.42)                    | A Spring Data JPA repository for Owner entities. It defines the persistence query layer (lookup by last-name prefix with paging, lookup by id). Repository/DAO c |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetValidator.supports                          | none/-                       | application/applicationfunction (0.40)  | Boilerplate override of Spring's Validator.supports that performs a one-line type check for Pet. It is an implementation detail of PetValidator, not an architec |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated                      | none/-                       | application/applicationfunction (0.29)  | A private helper inside VetController. It builds a PageRequest and delegates to VetRepository.findAll. This is pagination plumbing below modelling granularity.  |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                | api/operation                | application/applicationinterface (0.36) | A Spring MVC handler bound to GET /owners. It implements the owner search operation: it normalises the last-name query, paginates the results and either redirec |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.findPaginatedForOwnersLastName | none/-                       | application/applicationfunction (0.35)  | Private helper in OwnerController that builds a fixed-size PageRequest and delegates to the repository query. It is an implementation detail of processFindForm, |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.cacheConfiguration         | none/-                       | application/applicationfunction (0.40)  | This is a private helper that builds a JCache MutableConfiguration with statistics enabled, and its only caller is the cache customizer bean. It is an implement |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetRepository.findAll                            | data-store/accesspattern     | application/- (0.33)                    | This is a Spring Data repository query method that reads Vet records from the data store in pages. It is transactional and cached. As a repository read operatio |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                             | technology/technologyservice | application/applicationcomponent (0.38) | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |

## clef@enriched-v1

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| api         | 24     | 95.8%  | 28          |
| application | 13     | 38.5%  | 9           |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 5     |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| api → application        | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.73     | 0.37  |
| 0.4-0.5        | 26  | 0.46      | 0.73     | 0.27  |
| 0.5-0.6        | 25  | 0.55      | 0.96     | 0.41  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 95.6%             |
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
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                           | api/operation                    | application/applicationinterface (0.37) | A Spring MVC handler bound to GET /owners. It implements the owner search operation: it normalises the last-name query, paginates the results and either redirec |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |
| Class src.main.java.org.springframework.samples.petclinic.vet.VetController                                                | application/applicationinterface | api/paths (0.43)                        | A Spring MVC @Controller that serves the vets HTML page, with pagination, and a JSON vets resource. As the access point exposing vet-listing behaviour over HTTP |

## claude-sonnet

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 72.5%  | 37          |
| api         | 24     | 100.0% | 26          |
| application | 13     | 76.9%  | 20          |
| data-model  | 9      | 100.0% | 11          |
| data-store  | 7      | 100.0% | 7           |
| technology  | 2      | 100.0% | 5           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 10    |
| none → technology        | 3     |
| application → api        | 2     |
| application → data-model | 1     |
| none → data-model        | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.4-0.5        | 3   | 0.40      | 0.33     | -0.07 |
| 0.5-0.6        | 13  | 0.51      | 0.77     | 0.26  |
| 0.6-0.7        | 38  | 0.60      | 0.79     | 0.19  |
| 0.7-0.8        | 7   | 0.70      | 1.00     | 0.30  |
| 0.8-0.9        | 30  | 0.83      | 0.87     | 0.04  |
| 0.9-1.0        | 15  | 0.91      | 1.00     | 0.09  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 97.2%    | 85.4%             |
| ≥0.60     | 84.9%    | 86.7%             |
| ≥0.70     | 49.1%    | 92.3%             |
| ≥0.80     | 42.5%    | 91.1%             |
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
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                              | application/dataobject           | data-model/objectschema (0.60)         | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated                      | none/-                           | application/applicationfunction (0.80) | A private helper inside VetController. It builds a PageRequest and delegates to VetRepository.findAll. This is pagination plumbing below modelling granularity.  |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                | application/applicationinterface | api/operation (0.50)                   | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.findPaginatedForOwnersLastName | none/-                           | application/applicationfunction (0.80) | Private helper in OwnerController that builds a fixed-size PageRequest and delegates to the repository query. It is an implementation detail of processFindForm, |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicRuntimeHints                                 | none/-                           | technology/artifact (0.50)             | GraalVM native-image runtime hints registrar. This is build/runtime configuration boilerplate that registers resource patterns and reflection types. It is not a |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.cacheConfiguration         | none/-                           | technology/artifact (0.40)             | This is a private helper that builds a JCache MutableConfiguration with statistics enabled, and its only caller is the cache customizer bean. It is an implement |
| Method src.main.java.org.springframework.samples.petclinic.PetClinicRuntimeHints.registerHints                  | none/-                           | technology/technologyfunction (0.40)   | Framework callback that registers GraalVM native-image resource and reflection hints. It is build and runtime configuration boilerplate, not an architectural el |
| Class src.main.java.org.springframework.samples.petclinic.vet.VetController                                     | application/applicationinterface | api/pathitem (0.50)                    | A Spring MVC @Controller that serves the vets HTML page, with pagination, and a JSON vets resource. As the access point exposing vet-listing behaviour over HTTP |
| Method src.main.java.org.springframework.samples.petclinic.system.WebConfiguration.localeChangeInterceptor      | none/-                           | application/applicationfunction (0.60) | Spring bean factory method that configures a framework LocaleChangeInterceptor to read a 'lang' parameter. It is configuration boilerplate wiring an i18n featur |

## clef@enriched-v2-kind

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| api         | 24     | 95.8%  | 28          |
| application | 13     | 38.5%  | 9           |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 5     |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| api → application        | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.73     | 0.37  |
| 0.4-0.5        | 26  | 0.46      | 0.73     | 0.27  |
| 0.5-0.6        | 25  | 0.55      | 0.96     | 0.41  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 95.6%             |
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
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                                         | application/dataobject           | data-model/- (0.29)                     | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy accessor, s |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                           | api/operation                    | application/applicationinterface (0.37) | A Spring MVC handler bound to GET /owners. It implements the owner search operation: it normalises the last-name query, paginates the results and either redirec |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |
| Class src.main.java.org.springframework.samples.petclinic.vet.VetController                                                | application/applicationinterface | api/operation (0.43)                    | A Spring MVC @Controller that serves the vets HTML page, with pagination, and a JSON vets resource. As the access point exposing vet-listing behaviour over HTTP |

## clef@enriched-v2

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 51     | 98.0%  | 54          |
| api         | 24     | 95.8%  | 28          |
| application | 13     | 38.5%  | 9           |
| data-model  | 9      | 100.0% | 10          |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 2      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → api        | 5     |
| data-store → application | 2     |
| application → none       | 2     |
| technology → none        | 2     |
| application → data-model | 1     |
| api → application        | 1     |
| none → application       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.29      | 0.00     | -0.29 |
| 0.3-0.4        | 11  | 0.36      | 0.73     | 0.37  |
| 0.4-0.5        | 26  | 0.46      | 0.73     | 0.27  |
| 0.5-0.6        | 25  | 0.55      | 0.96     | 0.41  |
| 0.6-0.7        | 13  | 0.64      | 0.85     | 0.20  |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25  |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 95.6%             |
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
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                           | application/applicationinterface | api/operation (0.36)                    | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller access poin |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                           | api/operation                    | application/applicationinterface (0.37) | A Spring MVC handler bound to GET /owners. It implements the owner search operation: it normalises the last-name query, paginates the results and either redirec |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration that enables JCache caching and creates the 'vets' cache with statistics exposed over JMX. It is infrastructure/platform setup, a caching t |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | This Spring @Bean registers a JCache customizer that creates the 'vets' cache. It is infrastructure configuration for the caching platform service, not business |
| Class src.main.java.org.springframework.samples.petclinic.vet.VetController                                                | application/applicationinterface | api/operation (0.43)                    | A Spring MVC @Controller that serves the vets HTML page, with pagination, and a JSON vets resource. As the access point exposing vet-listing behaviour over HTTP |
