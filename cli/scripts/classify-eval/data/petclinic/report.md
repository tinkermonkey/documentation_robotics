# Classification eval report: petclinic

Generated 2026-10-24T20:34:36.727Z. Cards: 106. Gold labels: 106.

## Gold label distribution

| layer       | n   |
| ----------- | --- |
| none        | 46  |
| api         | 27  |
| data-model  | 12  |
| application | 9   |
| data-store  | 7   |
| technology  | 5   |

Significance histogram (0..4): 35 / 20 / 25 / 25 / 1. Gold labels with a type id not in the spec: 0.

## Summary

| backend       | n   | layer acc | type acc (end-to-end) | type acc given layer | sig MAE | sig within 1 | layer ECE | median latency | total cost | cost / card |
| ------------- | --- | --------- | --------------------- | -------------------- | ------- | ------------ | --------- | -------------- | ---------- | ----------- |
| claude-haiku  | 106 | 59.4%     | 52.8%                 | 88.9%                | 0.25    | 99.1%        | 0.167     | 1666 ms        | $0.050     | $0.0005     |
| clef          | 106 | 84.0%     | 73.6%                 | 87.6%                | 0.42    | 92.5%        | 0.254     | 642 ms         | $0.099     | $0.0009     |
| clef-flash    | 106 | 65.1%     | 45.3%                 | 69.6%                | 0.65    | 88.7%        | 0.218     | 1097 ms        | $0.037     | $0.0003     |
| claude-sonnet | 106 | 84.0%     | 82.1%                 | 97.8%                | 0.16    | 99.1%        | 0.145     | 1560 ms        | $0.902     | $0.0085     |

Type accuracy is exact match on the element type id. ECE = expected calibration error of the predicted layer's confidence (lower is better). Costs use list prices; Claude costs include cache reads at 0.1x.

## claude-haiku

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 46     | 41.3%  | 20          |
| api         | 27     | 88.9%  | 24          |
| data-model  | 12     | 33.3%  | 9           |
| application | 9      | 66.7%  | 32          |
| data-store  | 7      | 100.0% | 12          |
| technology  | 5      | 60.0%  | 4           |
| security    | 0      | n/a    | 1           |
| ux          | 0      | n/a    | 3           |
| navigation  | 0      | n/a    | 1           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 20    |
| data-model → data-store  | 5     |
| none → data-model        | 5     |
| application → ux         | 3     |
| data-model → application | 2     |
| technology → application | 2     |
| api → application        | 2     |
| none → security          | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.2-0.3        | 1   | 0.20      | 1.00     | 0.80  |
| 0.3-0.4        | 8   | 0.34      | 0.13     | -0.22 |
| 0.4-0.5        | 4   | 0.44      | 0.25     | -0.19 |
| 0.5-0.6        | 16  | 0.51      | 0.19     | -0.32 |
| 0.6-0.7        | 32  | 0.60      | 0.47     | -0.13 |
| 0.7-0.8        | 4   | 0.70      | 0.75     | 0.05  |
| 0.8-0.9        | 33  | 0.82      | 0.94     | 0.12  |
| 0.9-1.0        | 8   | 0.90      | 1.00     | 0.10  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 87.7%    | 64.5%             |
| ≥0.60     | 72.6%    | 74.0%             |
| ≥0.70     | 42.5%    | 93.3%             |
| ≥0.80     | 38.7%    | 95.1%             |
| ≥0.90     | 7.5%     | 100.0%            |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 16             | 0.60      | 0.75   | 0.67       |
| external_integration | 0              | 0.00      | n/a    | n/a        |
| observability        | 1              | 0.00      | 0.00   | n/a        |
| user_interface       | 26             | 0.72      | 1.00   | 0.84       |

### Sample layer disagreements

| symbol                                                                                                          | gold                            | predicted (conf)                       | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method src.main.java.org.springframework.samples.petclinic.owner.VisitController.setAllowedFields               | none/-                          | security/permission (0.50)             | Spring @InitBinder hook that stops 'id' fields from being bound from the request, a guard against mass assignment. It is a one-line, controller-local configurat |
| Class src.main.java.org.springframework.samples.petclinic.owner.Owner                                           | data-model/objectschema         | data-store/collection (0.50)           | Owner is a core JPA domain entity with validated properties and a one-to-many relationship to Pet. It is the canonical entity schema for owners, central to the  |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                | application/applicationfunction | ux/componentinstance (0.35)            | Spring MVC formatter component that converts PetType values to and from strings for form binding. It looks pet types up through the repository, but persistence  |
| Method src.main.java.org.springframework.samples.petclinic.owner.Pet.getBirthDate                               | none/-                          | data-model/schemaproperty (0.35)       | A trivial JavaBean getter on the Pet entity that returns the birthDate field. It is part of the entity's data shape, but it is not an architectural element on i |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetValidator.supports                          | none/-                          | application/applicationfunction (0.60) | Trivial Spring Validator boilerplate override that checks whether a class is assignable to Pet. It is an implementation detail of PetValidator, not an architect |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                              | data-model/objectschema         | application/dataobject (0.60)          | A JAXB-annotated wrapper DTO holding a list of Vet entities, used to serialize the vets resource response. It is a simple response data shape with minor signifi |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated                      | none/-                          | application/applicationfunction (0.60) | A private helper in VetController that builds a Pageable with a fixed page size and delegates to VetRepository.findAll. It is a pagination implementation detail |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vet                                               | data-model/objectschema         | data-store/collection (0.60)           | Vet is a core JPA domain entity in the petclinic model, inheriting Person and holding a many-to-many relationship to Specialty. It defines a domain record shape |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.cacheConfiguration         | none/-                          | application/applicationfunction (0.50) | A private helper that builds a JCache MutableConfiguration with statistics enabled and is used only by the cache customizer. The enclosing CacheConfiguration cl |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.findPaginatedForOwnersLastName | none/-                          | application/applicationfunction (0.60) | A private controller helper that builds a fixed-size Pageable and delegates to OwnerRepository. It is a small pagination implementation detail, used only by pro |

## clef

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 46     | 97.8%  | 54          |
| api         | 27     | 96.3%  | 28          |
| data-model  | 12     | 83.3%  | 10          |
| application | 9      | 33.3%  | 9           |
| data-store  | 7      | 71.4%  | 5           |
| technology  | 5      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| application → none       | 4     |
| technology → none        | 4     |
| data-store → application | 2     |
| application → api        | 2     |
| technology → application | 1     |
| api → application        | 1     |
| data-model → none        | 1     |
| data-model → application | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 1   | 0.29      | 1.00     | 0.71 |
| 0.3-0.4        | 11  | 0.36      | 0.82     | 0.46 |
| 0.4-0.5        | 26  | 0.46      | 0.73     | 0.27 |
| 0.5-0.6        | 25  | 0.55      | 0.84     | 0.29 |
| 0.6-0.7        | 13  | 0.64      | 0.69     | 0.05 |
| 0.7-0.8        | 12  | 0.75      | 1.00     | 0.25 |
| 0.8-0.9        | 18  | 0.83      | 1.00     | 0.17 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 64.2%    | 88.2%             |
| ≥0.60     | 40.6%    | 90.7%             |
| ≥0.70     | 28.3%    | 100.0%            |
| ≥0.80     | 17.0%    | 100.0%            |
| ≥0.90     | 0.0%     | n/a               |
| ≥0.95     | 0.0%     | n/a               |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 16             | 1.00      | 0.25   | 0.40       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 26             | n/a       | 0.00   | n/a        |

### Sample layer disagreements

| symbol                                                                                                                     | gold                             | predicted (conf)                        | gold rationale                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class src.main.java.org.springframework.samples.petclinic.system.WebConfiguration                                          | technology/artifact              | application/applicationcomponent (0.49) | A Spring @Configuration class wiring the i18n framework infrastructure: a session-based locale resolver and a locale-change interceptor. It is framework configu |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                            | data-store/accesspattern         | application/applicationinterface (0.42) | Spring Data repository interface defining the read-only, cached query access to Vet records (findAll, paged findAll). It is the persistence access layer for the |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter                                           | application/applicationfunction  | none/- (0.64)                           | Spring MVC formatter component that converts PetType values to and from strings for form binding. It looks pet types up through the repository, but persistence  |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                                        | data-store/accesspattern         | application/applicationinterface (0.37) | Spring Data JPA repository for Owner entities defining query methods (last-name prefix search with paging, find by id). It is the persistence access layer for o |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicApplication                                             | application/applicationcomponent | none/- (0.44)                           | This is the Spring Boot application entry point (main method plus @SpringBootApplication) that bootstraps the whole PetClinic system. It represents the deployab |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicRuntimeHints                                            | technology/artifact              | none/- (0.61)                           | GraalVM native-image runtime hints registrar: build/deployment configuration that registers resource patterns and reflection types for AOT compilation. It is pl |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                           | api/operation                    | application/applicationinterface (0.37) | Spring MVC GET /owners route handler implementing the owner search operation: it normalizes the last name, queries paginated results, and selects a view or redi |
| Class src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration                                        | technology/technologyservice     | none/- (0.47)                           | Spring configuration enabling JCache caching and creating the 'vets' cache with JMX statistics. This is infrastructure/platform configuration providing a cachin |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.petclinicCacheConfigurationCustomizer | technology/technologyservice     | none/- (0.67)                           | A Spring @Bean that registers the 'vets' JCache cache via a JCacheManagerCustomizer. It is infrastructure configuration for the caching technology service, name |
| Class src.main.java.org.springframework.samples.petclinic.vet.VetController                                                | application/applicationcomponent | api/paths (0.43)                        | Spring MVC controller for the vet domain. It serves an HTML vet list view with pagination and a JSON /vets resource endpoint. As a class grouping several handle |

## clef-flash

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 46     | 67.4%  | 33          |
| api         | 27     | 77.8%  | 21          |
| data-model  | 12     | 75.0%  | 9           |
| application | 9      | 88.9%  | 43          |
| data-store  | 7      | 0.0%   | 0           |
| technology  | 5      | 0.0%   | 0           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 15    |
| data-store → application | 7     |
| api → application        | 6     |
| technology → application | 4     |
| data-model → application | 3     |
| technology → none        | 1     |
| application → none       | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap  |
| -------------- | --- | --------- | -------- | ---- |
| 0.2-0.3        | 3   | 0.28      | 0.33     | 0.05 |
| 0.3-0.4        | 35  | 0.37      | 0.40     | 0.03 |
| 0.4-0.5        | 50  | 0.45      | 0.76     | 0.31 |
| 0.5-0.6        | 14  | 0.53      | 0.86     | 0.33 |
| 0.6-0.7        | 3   | 0.62      | 1.00     | 0.38 |
| 0.7-0.8        | 1   | 0.72      | 1.00     | 0.28 |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 17.0%    | 88.9%             |
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
| data_persistence     | 16             | 1.00      | 0.25   | 0.40       |
| external_integration | 0              | n/a       | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 26             | 0.83      | 0.19   | 0.31       |

### Sample layer disagreements

| symbol                                                                                                          | gold                     | predicted (conf)                        | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class src.main.java.org.springframework.samples.petclinic.system.WebConfiguration                               | technology/artifact      | application/applicationcomponent (0.39) | A Spring @Configuration class wiring the i18n framework infrastructure: a session-based locale resolver and a locale-change interceptor. It is framework configu |
| Interface src.main.java.org.springframework.samples.petclinic.vet.VetRepository                                 | data-store/accesspattern | application/- (0.42)                    | Spring Data repository interface defining the read-only, cached query access to Vet records (findAll, paged findAll). It is the persistence access layer for the |
| Interface src.main.java.org.springframework.samples.petclinic.owner.PetTypeRepository                           | data-store/accesspattern | application/- (0.38)                    | A Spring Data JPA repository for PetType entities, with a custom JPQL query that retrieves pet types ordered by name. It is the persistence access layer for a d |
| Interface src.main.java.org.springframework.samples.petclinic.owner.OwnerRepository                             | data-store/accesspattern | application/- (0.42)                    | Spring Data JPA repository for Owner entities defining query methods (last-name prefix search with paging, find by id). It is the persistence access layer for o |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetValidator.supports                          | none/-                   | application/applicationfunction (0.40)  | Trivial Spring Validator boilerplate override that checks whether a class is assignable to Pet. It is an implementation detail of PetValidator, not an architect |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                              | data-model/objectschema  | application/dataobject (0.34)           | A JAXB-annotated wrapper DTO holding a list of Vet entities, used to serialize the vets resource response. It is a simple response data shape with minor signifi |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated                      | none/-                   | application/applicationfunction (0.29)  | A private helper in VetController that builds a Pageable with a fixed page size and delegates to VetRepository.findAll. It is a pagination implementation detail |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.processFindForm                | api/operation            | application/applicationinterface (0.36) | Spring MVC GET /owners route handler implementing the owner search operation: it normalizes the last name, queries paginated results, and selects a view or redi |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                                | api/operation            | application/applicationinterface (0.31) | Spring MVC controller exposing a single GET /oups endpoint that deliberately throws an exception to demonstrate the error view. It is part of the HTTP surface,  |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.findPaginatedForOwnersLastName | none/-                   | application/applicationfunction (0.35)  | A private controller helper that builds a fixed-size Pageable and delegates to OwnerRepository. It is a small pagination implementation detail, used only by pro |

## claude-sonnet

### Per-layer recall

| layer       | gold n | recall | predicted n |
| ----------- | ------ | ------ | ----------- |
| none        | 46     | 78.3%  | 37          |
| api         | 27     | 92.6%  | 26          |
| data-model  | 12     | 83.3%  | 11          |
| application | 9      | 88.9%  | 20          |
| data-store  | 7      | 100.0% | 7           |
| technology  | 5      | 60.0%  | 5           |

### Top confusions (layer)

| gold → predicted         | count |
| ------------------------ | ----- |
| none → application       | 7     |
| technology → application | 2     |
| none → technology        | 2     |
| api → application        | 2     |
| application → api        | 1     |
| data-model → none        | 1     |
| data-model → application | 1     |
| none → data-model        | 1     |

### Calibration of layer confidence

| confidence bin | n   | mean conf | accuracy | gap   |
| -------------- | --- | --------- | -------- | ----- |
| 0.4-0.5        | 3   | 0.40      | 0.33     | -0.07 |
| 0.5-0.6        | 13  | 0.51      | 0.77     | 0.26  |
| 0.6-0.7        | 38  | 0.60      | 0.82     | 0.22  |
| 0.7-0.8        | 7   | 0.70      | 0.71     | 0.01  |
| 0.8-0.9        | 30  | 0.83      | 0.90     | 0.07  |
| 0.9-1.0        | 15  | 0.91      | 1.00     | 0.09  |

### Threshold sweep (auto-accept layer when confidence ≥ t)

| threshold | coverage | precision (layer) |
| --------- | -------- | ----------------- |
| ≥0.50     | 97.2%    | 85.4%             |
| ≥0.60     | 84.9%    | 86.7%             |
| ≥0.70     | 49.1%    | 90.4%             |
| ≥0.80     | 42.5%    | 93.3%             |
| ≥0.90     | 14.2%    | 100.0%            |
| ≥0.95     | 0.9%     | 100.0%            |

### Cross-cutting concerns

| concern              | gold positives | precision | recall | F1 (p≥0.5) |
| -------------------- | -------------- | --------- | ------ | ---------- |
| authentication       | 0              | n/a       | n/a    | n/a        |
| authorization        | 0              | n/a       | n/a    | n/a        |
| data_persistence     | 16             | 0.88      | 0.44   | 0.58       |
| external_integration | 0              | 0.00      | n/a    | n/a        |
| observability        | 1              | n/a       | 0.00   | n/a        |
| user_interface       | 26             | 1.00      | 0.23   | 0.38       |

### Sample layer disagreements

| symbol                                                                                                          | gold                             | predicted (conf)                        | gold rationale                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Class src.main.java.org.springframework.samples.petclinic.system.WebConfiguration                               | technology/artifact              | application/applicationcomponent (0.70) | A Spring @Configuration class wiring the i18n framework infrastructure: a session-based locale resolver and a locale-change interceptor. It is framework configu |
| Method src.main.java.org.springframework.samples.petclinic.owner.VisitController.setAllowedFields               | none/-                           | application/applicationfunction (0.60)  | Spring @InitBinder hook that stops 'id' fields from being bound from the request, a guard against mass assignment. It is a one-line, controller-local configurat |
| Method src.main.java.org.springframework.samples.petclinic.vet.VetController.findPaginated                      | none/-                           | application/applicationfunction (0.80)  | A private helper in VetController that builds a Pageable with a fixed page size and delegates to VetRepository.findAll. It is a pagination implementation detail |
| Method src.main.java.org.springframework.samples.petclinic.owner.OwnerController.findPaginatedForOwnersLastName | none/-                           | application/applicationfunction (0.80)  | A private controller helper that builds a fixed-size Pageable and delegates to OwnerRepository. It is a small pagination implementation detail, used only by pro |
| Method src.main.java.org.springframework.samples.petclinic.system.CacheConfiguration.cacheConfiguration         | none/-                           | technology/artifact (0.40)              | A private helper that builds a JCache MutableConfiguration with statistics enabled and is used only by the cache customizer. The enclosing CacheConfiguration cl |
| Method src.main.java.org.springframework.samples.petclinic.PetClinicRuntimeHints.registerHints                  | none/-                           | technology/technologyfunction (0.40)    | This is GraalVM native-image runtime hints registration boilerplate. It registers resource patterns and reflection types for AOT compilation. It is build and ru |
| Class src.main.java.org.springframework.samples.petclinic.vet.VetController                                     | application/applicationcomponent | api/pathitem (0.50)                     | Spring MVC controller for the vet domain. It serves an HTML vet list view with pagination and a JSON /vets resource endpoint. As a class grouping several handle |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetController                                   | api/pathitem                     | application/applicationcomponent (0.50) | Spring MVC controller mapped to /owners/{ownerId} that exposes the pet create and update HTTP endpoints. It drives server-rendered form views and delegates pers |
| Class src.main.java.org.springframework.samples.petclinic.system.WelcomeController                              | api/operation                    | application/applicationcomponent (0.50) | Spring MVC controller exposing GET / that returns the 'welcome' view name. It is an HTTP route handler and thus an API operation. Its role is simple but it is t |
| Method src.main.java.org.springframework.samples.petclinic.system.WebConfiguration.localeChangeInterceptor      | none/-                           | application/applicationfunction (0.60)  | A Spring @Bean factory method that configures the framework's LocaleChangeInterceptor with the 'lang' parameter. This is small framework configuration boilerpla |
