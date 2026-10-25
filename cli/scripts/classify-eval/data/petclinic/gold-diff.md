# Gold diff: petclinic, baseline vs charter

Cards labelled in both: 106 (A 106, B 106)
Layer agreement: 95/106 (89.6%). Layer+type agreement: 92/106 (86.8%)
Mean significance: baseline 1.41, charter 1.33

## Layer changes (baseline -> charter)

| transition                | n   |
| ------------------------- | --- |
| api -> application        | 3   |
| technology -> none        | 2   |
| data-model -> application | 2   |
| application -> none       | 2   |
| data-model -> none        | 1   |
| technology -> application | 1   |

## Layer changes by symbol kind

| kind      | changed | of  |
| --------- | ------- | --- |
| Class     | 6       | 21  |
| Route     | 0       | 15  |
| Interface | 0       | 3   |
| Method    | 5       | 67  |

## Prediction files scored against each gold (layer acc / type acc)

| backend          | vs baseline   | vs charter    |
| ---------------- | ------------- | ------------- |
| claude-haiku     | 59.4% / 52.8% | 59.4% / 51.9% |
| claude-sonnet    | 84.0% / 82.1% | 84.0% / 81.1% |
| clef-flash       | 65.1% / 45.3% | 69.8% / 50.9% |
| clef             | 84.0% / 73.6% | 86.8% / 78.3% |
| clef@enriched-v1 | 84.0% / 72.6% | 86.8% / 77.4% |

## Sample of relabelled symbols

| symbol                                                                                            | baseline                         | charter                          | charter rationale                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Class src.main.java.org.springframework.samples.petclinic.system.CrashController                  | api/operation                    | application/applicationinterface | A Spring MVC controller exposing a single demo endpoint (/oups) that throws an exception to showcase error-page handling. It is a mounted controller a |
| Method src.main.java.org.springframework.samples.petclinic.system.WebConfiguration.localeResolver | technology/artifact              | none/-                           | A Spring @Bean factory method that configures a session-based locale resolver defaulting to English. It is framework wiring boilerplate for i18n, not  |
| Method src.main.java.org.springframework.samples.petclinic.vet.Vet.getSpecialties                 | data-model/schemaproperty        | none/-                           | This is a simple accessor on the Vet entity that returns its specialties sorted by name, with an @XmlElement serialization annotation. It is an access |
| Class src.main.java.org.springframework.samples.petclinic.owner.PetController                     | api/pathitem                     | application/applicationinterface | A Spring MVC @Controller mounted at /owners/{ownerId}. It is the HTTP access point for pet create and update forms: it binds and validates form input, |
| Class src.main.java.org.springframework.samples.petclinic.PetClinicRuntimeHints                   | technology/artifact              | none/-                           | GraalVM native-image runtime hints registrar. This is build/runtime configuration boilerplate that registers resource patterns and reflection types. I |
| Method src.main.java.org.springframework.samples.petclinic.owner.Owner.addPet                     | data-model/schemaproperty        | application/applicationfunction  | Entity method on the Owner aggregate that adds a pet to the in-memory collection with duplicate checks. It is minor domain behaviour inside a JPA enti |
| Class src.main.java.org.springframework.samples.petclinic.vet.Vets                                | data-model/objectschema          | application/dataobject           | Vets is a simple JAXB-annotated wrapper around a list of Vet, used as a response payload for XML/JSON marshalling. It has no behaviour beyond a lazy a |
| Class src.main.java.org.springframework.samples.petclinic.system.WelcomeController                | api/operation                    | application/applicationinterface | A Spring MVC @Controller that maps GET / to the server-rendered 'welcome' view. It is a web access point (controller binding) rather than a JSON API c |
| Method src.main.java.org.springframework.samples.petclinic.PetClinicApplication.main              | application/applicationcomponent | none/-                           | Standard Spring Boot main method boilerplate that only delegates to SpringApplication.run. The architecturally meaningful element is the PetClinicAppl |
| Method src.main.java.org.springframework.samples.petclinic.owner.PetTypeFormatter.parse           | application/applicationfunction  | none/-                           | A Spring Formatter parse method that converts form text into a PetType by looking it up through the repository. It is framework boilerplate, an implem |
| Class src.main.java.org.springframework.samples.petclinic.system.WebConfiguration                 | technology/artifact              | application/applicationcomponent | Spring @Configuration class wiring i18n: a session-based locale resolver and a request interceptor for ?lang switching. It is a notable configuration  |
