# UX Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Actioncomponent](#actioncomponent)
  - [Actionpattern](#actionpattern)
  - [Chartseries](#chartseries)
  - [Componentinstance](#componentinstance)
  - [Componentreference](#componentreference)
  - [Dataconfig](#dataconfig)
  - [Errorconfig](#errorconfig)
  - [Experiencestate](#experiencestate)
  - [Layoutconfig](#layoutconfig)
  - [Librarycomponent](#librarycomponent)
  - [Librarysubview](#librarysubview)
  - [Stateaction](#stateaction)
  - [Stateactiontemplate](#stateactiontemplate)
  - [Statepattern](#statepattern)
  - [Statetransition](#statetransition)
  - [Subview](#subview)
  - [Tablecolumn](#tablecolumn)
  - [Transitiontemplate](#transitiontemplate)
  - [Uxapplication](#uxapplication)
  - [Uxlibrary](#uxlibrary)
  - [Uxspec](#uxspec)
  - [View](#view)

## Layer Introduction

**Layer 9**: UX
**Standard**: [HTML 5.3](https://html.spec.whatwg.org/)

Layer 9: UX Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 22    |
| Intra-Layer Relationships | 123   |
| Inter-Layer Relationships | 84    |
| Inbound Relationships     | 24    |
| Outbound Relationships    | 60    |

### Layer Dependencies

**Depends On**: [Navigation](./10-navigation-layer-report.md), [APM](./11-apm-layer-report.md), [Testing](./12-testing-layer-report.md)

**Depended On By**: [Motivation](./01-motivation-layer-report.md), [Business](./02-business-layer-report.md), [Security](./03-security-layer-report.md), [Application](./04-application-layer-report.md), [Technology](./05-technology-layer-report.md), [API](./06-api-layer-report.md), [Data Model](./07-data-model-layer-report.md), [Data Store](./08-data-store-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph ux
    actioncomponent["actioncomponent"]
    actionpattern["actionpattern"]
    chartseries["chartseries"]
    componentinstance["componentinstance"]
    componentreference["componentreference"]
    dataconfig["dataconfig"]
    errorconfig["errorconfig"]
    experiencestate["experiencestate"]
    layoutconfig["layoutconfig"]
    librarycomponent["librarycomponent"]
    librarysubview["librarysubview"]
    stateaction["stateaction"]
    stateactiontemplate["stateactiontemplate"]
    statepattern["statepattern"]
    statetransition["statetransition"]
    subview["subview"]
    tablecolumn["tablecolumn"]
    transitiontemplate["transitiontemplate"]
    uxapplication["uxapplication"]
    uxlibrary["uxlibrary"]
    uxspec["uxspec"]
    view["view"]
    actioncomponent -->|binds-to| dataconfig
    actioncomponent -->|implements| actionpattern
    actioncomponent -->|navigates-to| view
    actioncomponent -->|renders| actioncomponent
    actioncomponent -->|renders| componentinstance
    actioncomponent -->|renders| componentreference
    actioncomponent -->|renders| librarycomponent
    actioncomponent -->|triggers| statetransition
    actioncomponent -->|uses| errorconfig
    actionpattern -->|associated-with| statepattern
    actionpattern -->|governs| actioncomponent
    actionpattern -->|governs| stateaction
    actionpattern -->|triggers| statetransition
    actionpattern -->|uses| transitiontemplate
    chartseries -->|binds-to| dataconfig
    chartseries -->|references| librarycomponent
    chartseries -->|uses| experiencestate
    componentinstance -->|aggregates| chartseries
    componentinstance -->|aggregates| componentreference
    componentinstance -->|aggregates| tablecolumn
    componentinstance -->|binds-to| dataconfig
    componentinstance -->|implements| librarycomponent
    componentinstance -->|realizes| librarycomponent
    componentinstance -->|renders| actioncomponent
    componentinstance -->|renders| componentinstance
    componentinstance -->|renders| componentreference
    componentinstance -->|renders| layoutconfig
    componentinstance -->|renders| librarycomponent
    componentinstance -->|uses| errorconfig
    componentreference -->|implements| librarycomponent
    componentreference -->|renders| actioncomponent
    componentreference -->|renders| componentinstance
    componentreference -->|renders| componentreference
    componentreference -->|renders| librarycomponent
    componentreference -->|uses| layoutconfig
    dataconfig -->|aggregates| errorconfig
    dataconfig -->|binds-to| componentinstance
    dataconfig -->|binds-to| librarycomponent
    dataconfig -->|binds-to| subview
    dataconfig -->|binds-to| view
    dataconfig -->|composes| chartseries
    dataconfig -->|provides| tablecolumn
    dataconfig -->|realizes| statepattern
    errorconfig -->|associated-with| dataconfig
    errorconfig -->|governs| actioncomponent
    errorconfig -->|governs| componentinstance
    errorconfig -->|governs| experiencestate
    errorconfig -->|governs| view
    experiencestate -->|flows-to| statetransition
    experiencestate -->|governs| view
    experiencestate -->|navigates-to| experiencestate
    experiencestate -->|renders| view
    experiencestate -->|specializes| statepattern
    experiencestate -->|triggers| stateaction
    experiencestate -->|uses| stateactiontemplate
    layoutconfig -->|associated-with| librarycomponent
    layoutconfig -->|composes| layoutconfig
    layoutconfig -->|governs| view
    layoutconfig -->|provides| subview
    layoutconfig -->|provides| view
    librarycomponent -->|composes| actioncomponent
    librarycomponent -->|composes| librarycomponent
    librarycomponent -->|renders| actioncomponent
    librarycomponent -->|renders| componentinstance
    librarycomponent -->|renders| componentreference
    librarycomponent -->|renders| librarycomponent
    librarycomponent -->|specializes| librarycomponent
    librarycomponent -->|uses| actionpattern
    librarycomponent -->|uses| statepattern
    librarysubview -->|composes| componentinstance
    librarysubview -->|uses| actionpattern
    librarysubview -->|uses| dataconfig
    librarysubview -->|uses| layoutconfig
    stateaction -->|flows-to| statetransition
    stateaction -->|specializes| stateactiontemplate
    stateaction -->|uses| actionpattern
    stateactiontemplate -->|associated-with| statepattern
    stateactiontemplate -->|governs| statetransition
    stateactiontemplate -->|implements| stateaction
    stateactiontemplate -->|provides| stateaction
    statepattern -->|aggregates| experiencestate
    statepattern -->|governs| experiencestate
    statepattern -->|specializes| statepattern
    statepattern -->|uses| stateactiontemplate
    statepattern -->|uses| transitiontemplate
    statetransition -->|associated-with| actioncomponent
    statetransition -->|navigates-to| experiencestate
    statetransition -->|triggers| stateaction
    statetransition -->|uses| transitiontemplate
    subview -->|aggregates| componentinstance
    subview -->|binds-to| dataconfig
    subview -->|realizes| librarysubview
    subview -->|renders| componentinstance
    subview -->|uses| errorconfig
    subview -->|uses| layoutconfig
    subview -->|uses| librarysubview
    tablecolumn -->|binds-to| dataconfig
    tablecolumn -->|references| actionpattern
    tablecolumn -->|renders| componentinstance
    tablecolumn -->|uses| layoutconfig
    transitiontemplate -->|flows-to| experiencestate
    transitiontemplate -->|flows-to| subview
    transitiontemplate -->|governs| statetransition
    transitiontemplate -->|navigates-to| view
    transitiontemplate -->|specializes| transitiontemplate
    transitiontemplate -->|triggers| stateaction
    uxapplication -->|aggregates| uxspec
    uxlibrary -->|aggregates| librarycomponent
    uxlibrary -->|aggregates| librarysubview
    uxlibrary -->|provides| librarycomponent
    uxlibrary -->|provides| librarysubview
    uxlibrary -->|uses| uxlibrary
    uxspec -->|aggregates| experiencestate
    uxspec -->|aggregates| view
    uxspec -->|governs| errorconfig
    uxspec -->|uses| uxlibrary
    view -->|aggregates| actioncomponent
    view -->|aggregates| subview
    view -->|binds-to| dataconfig
    view -->|composes| subview
    view -->|renders| componentinstance
    view -->|requires| errorconfig
    view -->|uses| layoutconfig
  end
```

## Inter-Layer Dependencies

```mermaid
flowchart TB
  classDef current fill:#f9f,stroke:#333,stroke-width:2px
  motivation["Motivation"]
  business["Business"]
  security["Security"]
  application["Application"]
  technology["Technology"]
  api["API"]
  data_model["Data Model"]
  data_store["Data Store"]
  ux["UX"]
  navigation["Navigation"]
  apm["APM"]
  testing["Testing"]
  api --> apm
  api --> application
  api --> business
  api --> data_store
  api --> motivation
  api --> security
  api --> technology
  apm --> api
  apm --> application
  apm --> business
  apm --> data_model
  apm --> data_store
  apm --> motivation
  apm --> navigation
  apm --> security
  apm --> technology
  apm --> ux
  application --> apm
  application --> business
  application --> motivation
  application --> security
  business --> application
  business --> motivation
  business --> security
  data_model --> api
  data_model --> application
  data_model --> business
  data_model --> motivation
  data_model --> security
  data_model --> technology
  data_store --> api
  data_store --> application
  data_store --> business
  data_store --> motivation
  data_store --> security
  data_store --> technology
  navigation --> api
  navigation --> application
  navigation --> business
  navigation --> data_model
  navigation --> data_store
  navigation --> motivation
  navigation --> security
  navigation --> technology
  navigation --> ux
  security --> business
  security --> motivation
  technology --> application
  technology --> business
  technology --> motivation
  technology --> security
  testing --> api
  testing --> apm
  testing --> application
  testing --> business
  testing --> data_model
  testing --> data_store
  testing --> motivation
  testing --> navigation
  testing --> security
  testing --> technology
  testing --> ux
  ux --> api
  ux --> application
  ux --> business
  ux --> data_model
  ux --> data_store
  ux --> motivation
  ux --> security
  ux --> technology
  class ux current
```

## Inter-Layer Relationships Table

| Relationship ID                                              | Source Node                                                                  | Dest Node                                                                     | Dest Layer                                      | Predicate  | Cardinality | Strength |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | ----------- | -------- |
| apm.instrumentationscope.monitors.ux.uxapplication           | [Instrumentationscope](./11-apm-layer-report.md#instrumentationscope)        | [Uxapplication](./09-ux-layer-report.md#uxapplication)                        | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.logrecord.references.ux.view                             | [Logrecord](./11-apm-layer-report.md#logrecord)                              | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | references | many-to-one | medium   |
| apm.metricinstrument.monitors.ux.actioncomponent             | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                    | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.ux.errorconfig                 | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                | [Errorconfig](./09-ux-layer-report.md#errorconfig)                            | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.ux.view                        | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.span.monitors.ux.view                                    | [Span](./11-apm-layer-report.md#span)                                        | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.spanevent.monitors.ux.actioncomponent                    | [Spanevent](./11-apm-layer-report.md#spanevent)                              | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                    | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.traceconfiguration.monitors.ux.uxapplication             | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)            | [Uxapplication](./09-ux-layer-report.md#uxapplication)                        | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| navigation.flowstep.maps-to.ux.view                          | [Flowstep](./10-navigation-layer-report.md#flowstep)                         | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | maps-to    | many-to-one | medium   |
| navigation.navigationflow.accesses.ux.view                   | [Navigationflow](./10-navigation-layer-report.md#navigationflow)             | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | accesses   | many-to-one | medium   |
| navigation.navigationguard.triggers.ux.experiencestate       | [Navigationguard](./10-navigation-layer-report.md#navigationguard)           | [Experiencestate](./09-ux-layer-report.md#experiencestate)                    | [UX](./09-ux-layer-report.md)                   | triggers   | many-to-one | medium   |
| navigation.navigationtransition.triggers.ux.statetransition  | [Navigationtransition](./10-navigation-layer-report.md#navigationtransition) | [Statetransition](./09-ux-layer-report.md#statetransition)                    | [UX](./09-ux-layer-report.md)                   | triggers   | many-to-one | medium   |
| navigation.route.maps-to.ux.view                             | [Route](./10-navigation-layer-report.md#route)                               | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | maps-to    | many-to-one | medium   |
| navigation.route.uses.ux.errorconfig                         | [Route](./10-navigation-layer-report.md#route)                               | [Errorconfig](./09-ux-layer-report.md#errorconfig)                            | [UX](./09-ux-layer-report.md)                   | uses       | many-to-one | medium   |
| navigation.route.uses.ux.layoutconfig                        | [Route](./10-navigation-layer-report.md#route)                               | [Layoutconfig](./09-ux-layer-report.md#layoutconfig)                          | [UX](./09-ux-layer-report.md)                   | uses       | many-to-one | medium   |
| navigation.routemeta.uses.ux.layoutconfig                    | [Routemeta](./10-navigation-layer-report.md#routemeta)                       | [Layoutconfig](./09-ux-layer-report.md#layoutconfig)                          | [UX](./09-ux-layer-report.md)                   | uses       | many-to-one | medium   |
| testing.coveragerequirement.covers.ux.experiencestate        | [Coveragerequirement](./12-testing-layer-report.md#coveragerequirement)      | [Experiencestate](./09-ux-layer-report.md#experiencestate)                    | [UX](./09-ux-layer-report.md)                   | covers     | many-to-one | medium   |
| testing.targetinputfield.maps-to.ux.actioncomponent          | [Targetinputfield](./12-testing-layer-report.md#targetinputfield)            | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                    | [UX](./09-ux-layer-report.md)                   | maps-to    | many-to-one | medium   |
| testing.testcasesketch.tests.ux.actioncomponent              | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                    | [UX](./09-ux-layer-report.md)                   | tests      | many-to-one | medium   |
| testing.testcasesketch.tests.ux.librarycomponent             | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                | [Librarycomponent](./09-ux-layer-report.md#librarycomponent)                  | [UX](./09-ux-layer-report.md)                   | tests      | many-to-one | medium   |
| testing.testcasesketch.tests.ux.view                         | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | tests      | many-to-one | medium   |
| testing.testcoveragemodel.covers.ux.uxapplication            | [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)          | [Uxapplication](./09-ux-layer-report.md#uxapplication)                        | [UX](./09-ux-layer-report.md)                   | covers     | many-to-one | medium   |
| testing.testcoveragetarget.covers.ux.subview                 | [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)        | [Subview](./09-ux-layer-report.md#subview)                                    | [UX](./09-ux-layer-report.md)                   | covers     | many-to-one | medium   |
| testing.testcoveragetarget.covers.ux.view                    | [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)        | [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | covers     | many-to-one | medium   |
| ux.actioncomponent.accesses.data-store.collection            | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | accesses   | many-to-one | medium   |
| ux.actioncomponent.realizes.business.businessfunction        | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Businessfunction](./02-business-layer-report.md#businessfunction)            | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| ux.actioncomponent.references.security.secureresource        | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | many-to-one | medium   |
| ux.actioncomponent.requires.security.permission              | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| ux.actioncomponent.satisfies.motivation.requirement          | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| ux.actioncomponent.triggers.api.operation                    | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | triggers   | many-to-one | medium   |
| ux.actioncomponent.triggers.application.applicationservice   | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | triggers   | many-to-one | medium   |
| ux.actioncomponent.triggers.business.businessevent           | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Businessevent](./02-business-layer-report.md#businessevent)                  | [Business](./02-business-layer-report.md)       | triggers   | many-to-one | medium   |
| ux.actioncomponent.triggers.data-store.storedlogic           | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Storedlogic](./08-data-store-layer-report.md#storedlogic)                    | [Data Store](./08-data-store-layer-report.md)   | triggers   | many-to-one | medium   |
| ux.actioncomponent.uses.application.applicationfunction      | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Applicationfunction](./04-application-layer-report.md#applicationfunction)   | [Application](./04-application-layer-report.md) | uses       | many-to-one | medium   |
| ux.actioncomponent.uses.technology.technologyservice         | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                   | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| ux.chartseries.accesses.data-store.collection                | [Chartseries](./09-ux-layer-report.md#chartseries)                           | [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | accesses   | many-to-one | medium   |
| ux.chartseries.maps-to.data-model.arrayschema                | [Chartseries](./09-ux-layer-report.md#chartseries)                           | [Arrayschema](./07-data-model-layer-report.md#arrayschema)                    | [Data Model](./07-data-model-layer-report.md)   | maps-to    | many-to-one | medium   |
| ux.componentinstance.accesses.application.applicationservice | [Componentinstance](./09-ux-layer-report.md#componentinstance)               | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | accesses   | many-to-one | medium   |
| ux.componentinstance.maps-to.data-model.objectschema         | [Componentinstance](./09-ux-layer-report.md#componentinstance)               | [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | maps-to    | many-to-one | medium   |
| ux.dataconfig.accesses.data-store.collection                 | [Dataconfig](./09-ux-layer-report.md#dataconfig)                             | [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | accesses   | many-to-one | medium   |
| ux.dataconfig.maps-to.api.requestbody                        | [Dataconfig](./09-ux-layer-report.md#dataconfig)                             | [Requestbody](./06-api-layer-report.md#requestbody)                           | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.dataconfig.maps-to.api.response                           | [Dataconfig](./09-ux-layer-report.md#dataconfig)                             | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.dataconfig.maps-to.api.schema                             | [Dataconfig](./09-ux-layer-report.md#dataconfig)                             | [Schema](./06-api-layer-report.md#schema)                                     | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.dataconfig.maps-to.data-model.objectschema                | [Dataconfig](./09-ux-layer-report.md#dataconfig)                             | [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | maps-to    | many-to-one | medium   |
| ux.dataconfig.references.data-model.schemadefinition         | [Dataconfig](./09-ux-layer-report.md#dataconfig)                             | [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)          | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| ux.errorconfig.maps-to.api.response                          | [Errorconfig](./09-ux-layer-report.md#errorconfig)                           | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.errorconfig.references.data-model.objectschema            | [Errorconfig](./09-ux-layer-report.md#errorconfig)                           | [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| ux.librarycomponent.depends-on.technology.systemsoftware     | [Librarycomponent](./09-ux-layer-report.md#librarycomponent)                 | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| ux.librarycomponent.requires.technology.technologyservice    | [Librarycomponent](./09-ux-layer-report.md#librarycomponent)                 | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | requires   | many-to-one | medium   |
| ux.librarycomponent.satisfies.motivation.principle           | [Librarycomponent](./09-ux-layer-report.md#librarycomponent)                 | [Principle](./01-motivation-layer-report.md#principle)                        | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| ux.librarycomponent.satisfies.motivation.requirement         | [Librarycomponent](./09-ux-layer-report.md#librarycomponent)                 | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| ux.stateaction.triggers.api.operation                        | [Stateaction](./09-ux-layer-report.md#stateaction)                           | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | triggers   | many-to-one | medium   |
| ux.subview.accesses.data-store.collection                    | [Subview](./09-ux-layer-report.md#subview)                                   | [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | accesses   | many-to-one | medium   |
| ux.subview.realizes.business.businessprocess                 | [Subview](./09-ux-layer-report.md#subview)                                   | [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| ux.subview.references.data-model.objectschema                | [Subview](./09-ux-layer-report.md#subview)                                   | [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| ux.subview.requires.security.permission                      | [Subview](./09-ux-layer-report.md#subview)                                   | [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| ux.subview.serves.application.applicationservice             | [Subview](./09-ux-layer-report.md#subview)                                   | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| ux.tablecolumn.maps-to.data-model.schemaproperty             | [Tablecolumn](./09-ux-layer-report.md#tablecolumn)                           | [Schemaproperty](./07-data-model-layer-report.md#schemaproperty)              | [Data Model](./07-data-model-layer-report.md)   | maps-to    | many-to-one | medium   |
| ux.tablecolumn.maps-to.data-store.field                      | [Tablecolumn](./09-ux-layer-report.md#tablecolumn)                           | [Field](./08-data-store-layer-report.md#field)                                | [Data Store](./08-data-store-layer-report.md)   | maps-to    | many-to-one | medium   |
| ux.tablecolumn.references.security.fieldaccesscontrol        | [Tablecolumn](./09-ux-layer-report.md#tablecolumn)                           | [Fieldaccesscontrol](./03-security-layer-report.md#fieldaccesscontrol)        | [Security](./03-security-layer-report.md)       | references | many-to-one | medium   |
| ux.uxspec.satisfies.motivation.requirement                   | [Uxspec](./09-ux-layer-report.md#uxspec)                                     | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| ux.view.accesses.api.operation                               | [View](./09-ux-layer-report.md#view)                                         | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | accesses   | many-to-one | medium   |
| ux.view.accesses.application.applicationcomponent            | [View](./09-ux-layer-report.md#view)                                         | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | accesses   | many-to-one | medium   |
| ux.view.accesses.data-store.collection                       | [View](./09-ux-layer-report.md#view)                                         | [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | accesses   | many-to-one | medium   |
| ux.view.accesses.data-store.view                             | [View](./09-ux-layer-report.md#view)                                         | [View](./08-data-store-layer-report.md#view)                                  | [Data Store](./08-data-store-layer-report.md)   | accesses   | many-to-one | medium   |
| ux.view.depends-on.technology.systemsoftware                 | [View](./09-ux-layer-report.md#view)                                         | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| ux.view.maps-to.business.businessobject                      | [View](./09-ux-layer-report.md#view)                                         | [Businessobject](./02-business-layer-report.md#businessobject)                | [Business](./02-business-layer-report.md)       | maps-to    | many-to-one | medium   |
| ux.view.maps-to.motivation.outcome                           | [View](./09-ux-layer-report.md#view)                                         | [Outcome](./01-motivation-layer-report.md#outcome)                            | [Motivation](./01-motivation-layer-report.md)   | maps-to    | many-to-one | medium   |
| ux.view.realizes.application.applicationinterface            | [View](./09-ux-layer-report.md#view)                                         | [Applicationinterface](./04-application-layer-report.md#applicationinterface) | [Application](./04-application-layer-report.md) | realizes   | many-to-one | medium   |
| ux.view.realizes.business.businessprocess                    | [View](./09-ux-layer-report.md#view)                                         | [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| ux.view.realizes.motivation.goal                             | [View](./09-ux-layer-report.md#view)                                         | [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | many-to-one | medium   |
| ux.view.references.data-model.objectschema                   | [View](./09-ux-layer-report.md#view)                                         | [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| ux.view.references.security.secureresource                   | [View](./09-ux-layer-report.md#view)                                         | [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | many-to-one | medium   |
| ux.view.requires.security.permission                         | [View](./09-ux-layer-report.md#view)                                         | [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| ux.view.requires.security.role                               | [View](./09-ux-layer-report.md#view)                                         | [Role](./03-security-layer-report.md#role)                                    | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| ux.view.requires.technology.technologyservice                | [View](./09-ux-layer-report.md#view)                                         | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | requires   | many-to-one | medium   |
| ux.view.satisfies.motivation.requirement                     | [View](./09-ux-layer-report.md#view)                                         | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| ux.view.satisfies.security.securitypolicy                    | [View](./09-ux-layer-report.md#view)                                         | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| ux.view.serves.application.applicationservice                | [View](./09-ux-layer-report.md#view)                                         | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| ux.view.serves.business.businessrole                         | [View](./09-ux-layer-report.md#view)                                         | [Businessrole](./02-business-layer-report.md#businessrole)                    | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| ux.view.serves.business.businessservice                      | [View](./09-ux-layer-report.md#view)                                         | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| ux.view.serves.motivation.stakeholder                        | [View](./09-ux-layer-report.md#view)                                         | [Stakeholder](./01-motivation-layer-report.md#stakeholder)                    | [Motivation](./01-motivation-layer-report.md)   | serves     | many-to-one | medium   |
| ux.view.uses.api.securityscheme                              | [View](./09-ux-layer-report.md#view)                                         | [Securityscheme](./06-api-layer-report.md#securityscheme)                     | [API](./06-api-layer-report.md)                 | uses       | many-to-one | medium   |
| ux.view.uses.application.applicationevent                    | [View](./09-ux-layer-report.md#view)                                         | [Applicationevent](./04-application-layer-report.md#applicationevent)         | [Application](./04-application-layer-report.md) | uses       | many-to-one | medium   |

## Node Reference

### Actioncomponent {#actioncomponent}

**Spec Node ID**: `ux.actioncomponent`

Interactive element that triggers actions (button, menu, link, voice command)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 9 | Outbound: 9
- **Inter-Layer**: Inbound: 4 | Outbound: 11

#### Intra-Layer Relationships

| Related Node                              | Predicate       | Direction | Cardinality |
| ----------------------------------------- | --------------- | --------- | ----------- |
| [Dataconfig](#dataconfig)                 | binds-to        | outbound  | many-to-one |
| [Actionpattern](#actionpattern)           | implements      | outbound  | many-to-one |
| [View](#view)                             | navigates-to    | outbound  | many-to-one |
| [Actioncomponent](#actioncomponent)       | renders         | outbound  | many-to-one |
| [Componentinstance](#componentinstance)   | renders         | outbound  | many-to-one |
| [Componentreference](#componentreference) | renders         | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | renders         | outbound  | many-to-one |
| [Statetransition](#statetransition)       | triggers        | outbound  | many-to-one |
| [Errorconfig](#errorconfig)               | uses            | outbound  | many-to-one |
| [Actionpattern](#actionpattern)           | governs         | inbound   | many-to-one |
| [Componentinstance](#componentinstance)   | renders         | inbound   | many-to-one |
| [Componentreference](#componentreference) | renders         | inbound   | many-to-one |
| [Errorconfig](#errorconfig)               | governs         | inbound   | many-to-one |
| [Librarycomponent](#librarycomponent)     | composes        | inbound   | many-to-one |
| [Librarycomponent](#librarycomponent)     | renders         | inbound   | many-to-one |
| [Statetransition](#statetransition)       | associated-with | inbound   | many-to-one |
| [View](#view)                             | aggregates      | inbound   | one-to-many |

#### Inter-Layer Relationships

| Related Node                                                                | Layer                                           | Predicate  | Direction | Cardinality |
| --------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Metricinstrument](./11-apm-layer-report.md#metricinstrument)               | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Spanevent](./11-apm-layer-report.md#spanevent)                             | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Targetinputfield](./12-testing-layer-report.md#targetinputfield)           | [Testing](./12-testing-layer-report.md)         | maps-to    | inbound   | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)               | [Testing](./12-testing-layer-report.md)         | tests      | inbound   | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)                    | [Data Store](./08-data-store-layer-report.md)   | accesses   | outbound  | many-to-one |
| [Businessfunction](./02-business-layer-report.md#businessfunction)          | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Secureresource](./03-security-layer-report.md#secureresource)              | [Security](./03-security-layer-report.md)       | references | outbound  | many-to-one |
| [Permission](./03-security-layer-report.md#permission)                      | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                  | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Operation](./06-api-layer-report.md#operation)                             | [API](./06-api-layer-report.md)                 | triggers   | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)   | [Application](./04-application-layer-report.md) | triggers   | outbound  | many-to-one |
| [Businessevent](./02-business-layer-report.md#businessevent)                | [Business](./02-business-layer-report.md)       | triggers   | outbound  | many-to-one |
| [Storedlogic](./08-data-store-layer-report.md#storedlogic)                  | [Data Store](./08-data-store-layer-report.md)   | triggers   | outbound  | many-to-one |
| [Applicationfunction](./04-application-layer-report.md#applicationfunction) | [Application](./04-application-layer-report.md) | uses       | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)      | [Technology](./05-technology-layer-report.md)   | uses       | outbound  | many-to-one |

[Back to Index](#report-index)

### Actionpattern {#actionpattern}

**Spec Node ID**: `ux.actionpattern`

Reusable action configuration for common user interactions. Defines the trigger, feedback mechanism, and optional target for recurring UX patterns. Example: 'confirm-and-delete' pattern — trigger: click on delete button, feedback: confirmation modal then success toast, targetRef: the item being deleted.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate       | Direction | Cardinality |
| ----------------------------------------- | --------------- | --------- | ----------- |
| [Actioncomponent](#actioncomponent)       | implements      | inbound   | many-to-one |
| [Statepattern](#statepattern)             | associated-with | outbound  | many-to-one |
| [Actioncomponent](#actioncomponent)       | governs         | outbound  | many-to-one |
| [Stateaction](#stateaction)               | governs         | outbound  | many-to-one |
| [Statetransition](#statetransition)       | triggers        | outbound  | many-to-one |
| [Transitiontemplate](#transitiontemplate) | uses            | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | uses            | inbound   | many-to-one |
| [Librarysubview](#librarysubview)         | uses            | inbound   | many-to-one |
| [Stateaction](#stateaction)               | uses            | inbound   | many-to-one |
| [Tablecolumn](#tablecolumn)               | references      | inbound   | many-to-one |

[Back to Index](#report-index)

### Chartseries {#chartseries}

**Spec Node ID**: `ux.chartseries`

Configuration for a data series within a chart component, specifying data source, visualization type, colors, and legend properties. Defines how data is visualized in charts.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                            | Predicate  | Direction | Cardinality |
| --------------------------------------- | ---------- | --------- | ----------- |
| [Dataconfig](#dataconfig)               | binds-to   | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)   | references | outbound  | many-to-one |
| [Experiencestate](#experiencestate)     | uses       | outbound  | many-to-one |
| [Componentinstance](#componentinstance) | aggregates | inbound   | many-to-one |
| [Dataconfig](#dataconfig)               | composes   | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                               | Layer                                         | Predicate | Direction | Cardinality |
| ---------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Collection](./08-data-store-layer-report.md#collection)   | [Data Store](./08-data-store-layer-report.md) | accesses  | outbound  | many-to-one |
| [Arrayschema](./07-data-model-layer-report.md#arrayschema) | [Data Model](./07-data-model-layer-report.md) | maps-to   | outbound  | many-to-one |

[Back to Index](#report-index)

### Componentinstance {#componentinstance}

**Spec Node ID**: `ux.componentinstance`

Instance of a LibraryComponent with application-specific configuration

#### Relationship Metrics

- **Intra-Layer**: Inbound: 11 | Outbound: 12
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                              | Predicate  | Direction | Cardinality |
| ----------------------------------------- | ---------- | --------- | ----------- |
| [Actioncomponent](#actioncomponent)       | renders    | inbound   | many-to-one |
| [Chartseries](#chartseries)               | aggregates | outbound  | many-to-one |
| [Componentreference](#componentreference) | aggregates | outbound  | many-to-one |
| [Tablecolumn](#tablecolumn)               | aggregates | outbound  | many-to-one |
| [Dataconfig](#dataconfig)                 | binds-to   | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | implements | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | realizes   | outbound  | many-to-one |
| [Actioncomponent](#actioncomponent)       | renders    | outbound  | many-to-one |
| [Componentinstance](#componentinstance)   | renders    | outbound  | many-to-one |
| [Componentreference](#componentreference) | renders    | outbound  | many-to-one |
| [Layoutconfig](#layoutconfig)             | renders    | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | renders    | outbound  | many-to-one |
| [Errorconfig](#errorconfig)               | uses       | outbound  | many-to-one |
| [Componentreference](#componentreference) | renders    | inbound   | many-to-one |
| [Dataconfig](#dataconfig)                 | binds-to   | inbound   | many-to-one |
| [Errorconfig](#errorconfig)               | governs    | inbound   | many-to-one |
| [Librarycomponent](#librarycomponent)     | renders    | inbound   | many-to-one |
| [Librarysubview](#librarysubview)         | composes   | inbound   | many-to-one |
| [Subview](#subview)                       | aggregates | inbound   | many-to-one |
| [Subview](#subview)                       | renders    | inbound   | many-to-one |
| [Tablecolumn](#tablecolumn)               | renders    | inbound   | many-to-one |
| [View](#view)                             | renders    | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate | Direction | Cardinality |
| ------------------------------------------------------------------------- | ----------------------------------------------- | --------- | --------- | ----------- |
| [Applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | accesses  | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)              | [Data Model](./07-data-model-layer-report.md)   | maps-to   | outbound  | many-to-one |

[Back to Index](#report-index)

### Componentreference {#componentreference}

**Spec Node ID**: `ux.componentreference`

A declarative placeholder in a parent component's named slot, pointing to another component to be rendered there. Unlike ComponentInstance (a concrete rendered occurrence), ComponentReference is a composition declaration that says 'render this component in this slot of the parent', analogous to the HTML slot element.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate  | Direction | Cardinality |
| ----------------------------------------- | ---------- | --------- | ----------- |
| [Actioncomponent](#actioncomponent)       | renders    | inbound   | many-to-one |
| [Componentinstance](#componentinstance)   | aggregates | inbound   | many-to-one |
| [Componentinstance](#componentinstance)   | renders    | inbound   | many-to-one |
| [Librarycomponent](#librarycomponent)     | implements | outbound  | many-to-one |
| [Actioncomponent](#actioncomponent)       | renders    | outbound  | many-to-one |
| [Componentinstance](#componentinstance)   | renders    | outbound  | many-to-one |
| [Componentreference](#componentreference) | renders    | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | renders    | outbound  | many-to-one |
| [Layoutconfig](#layoutconfig)             | uses       | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | renders    | inbound   | many-to-one |

[Back to Index](#report-index)

### Dataconfig {#dataconfig}

**Spec Node ID**: `ux.dataconfig`

Configuration for data binding and state management within UI components, defining data sources, transformation pipelines, and update triggers. Manages component data flow.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 8
- **Inter-Layer**: Inbound: 0 | Outbound: 6

#### Intra-Layer Relationships

| Related Node                            | Predicate       | Direction | Cardinality |
| --------------------------------------- | --------------- | --------- | ----------- |
| [Actioncomponent](#actioncomponent)     | binds-to        | inbound   | many-to-one |
| [Chartseries](#chartseries)             | binds-to        | inbound   | many-to-one |
| [Componentinstance](#componentinstance) | binds-to        | inbound   | many-to-one |
| [Errorconfig](#errorconfig)             | aggregates      | outbound  | many-to-one |
| [Componentinstance](#componentinstance) | binds-to        | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)   | binds-to        | outbound  | many-to-one |
| [Subview](#subview)                     | binds-to        | outbound  | many-to-one |
| [View](#view)                           | binds-to        | outbound  | many-to-one |
| [Chartseries](#chartseries)             | composes        | outbound  | many-to-one |
| [Tablecolumn](#tablecolumn)             | provides        | outbound  | many-to-one |
| [Statepattern](#statepattern)           | realizes        | outbound  | many-to-one |
| [Errorconfig](#errorconfig)             | associated-with | inbound   | many-to-one |
| [Librarysubview](#librarysubview)       | uses            | inbound   | many-to-one |
| [Subview](#subview)                     | binds-to        | inbound   | many-to-one |
| [Tablecolumn](#tablecolumn)             | binds-to        | inbound   | many-to-one |
| [View](#view)                           | binds-to        | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                         | Layer                                         | Predicate  | Direction | Cardinality |
| -------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Collection](./08-data-store-layer-report.md#collection)             | [Data Store](./08-data-store-layer-report.md) | accesses   | outbound  | many-to-one |
| [Requestbody](./06-api-layer-report.md#requestbody)                  | [API](./06-api-layer-report.md)               | maps-to    | outbound  | many-to-one |
| [Response](./06-api-layer-report.md#response)                        | [API](./06-api-layer-report.md)               | maps-to    | outbound  | many-to-one |
| [Schema](./06-api-layer-report.md#schema)                            | [API](./06-api-layer-report.md)               | maps-to    | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)         | [Data Model](./07-data-model-layer-report.md) | maps-to    | outbound  | many-to-one |
| [Schemadefinition](./07-data-model-layer-report.md#schemadefinition) | [Data Model](./07-data-model-layer-report.md) | references | outbound  | many-to-one |

[Back to Index](#report-index)

### Errorconfig {#errorconfig}

**Spec Node ID**: `ux.errorconfig`

Configuration for error handling and display within UI components, specifying error message formats, retry behavior, fallback content, and user guidance. Ensures consistent error UX.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 5
- **Inter-Layer**: Inbound: 2 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                            | Predicate       | Direction | Cardinality |
| --------------------------------------- | --------------- | --------- | ----------- |
| [Actioncomponent](#actioncomponent)     | uses            | inbound   | many-to-one |
| [Componentinstance](#componentinstance) | uses            | inbound   | many-to-one |
| [Dataconfig](#dataconfig)               | aggregates      | inbound   | many-to-one |
| [Dataconfig](#dataconfig)               | associated-with | outbound  | many-to-one |
| [Actioncomponent](#actioncomponent)     | governs         | outbound  | many-to-one |
| [Componentinstance](#componentinstance) | governs         | outbound  | many-to-one |
| [Experiencestate](#experiencestate)     | governs         | outbound  | many-to-one |
| [View](#view)                           | governs         | outbound  | many-to-one |
| [Subview](#subview)                     | uses            | inbound   | many-to-one |
| [Uxspec](#uxspec)                       | governs         | inbound   | many-to-one |
| [View](#view)                           | requires        | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                  | Layer                                         | Predicate  | Direction | Cardinality |
| ------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Metricinstrument](./11-apm-layer-report.md#metricinstrument) | [APM](./11-apm-layer-report.md)               | monitors   | inbound   | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                | [Navigation](./10-navigation-layer-report.md) | uses       | inbound   | many-to-one |
| [Response](./06-api-layer-report.md#response)                 | [API](./06-api-layer-report.md)               | maps-to    | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)  | [Data Model](./07-data-model-layer-report.md) | references | outbound  | many-to-one |

[Back to Index](#report-index)

### Experiencestate {#experiencestate}

**Spec Node ID**: `ux.experiencestate`

Distinct state that the experience can be in (works across all channels)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 7
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate    | Direction | Cardinality |
| ------------------------------------------- | ------------ | --------- | ----------- |
| [Chartseries](#chartseries)                 | uses         | inbound   | many-to-one |
| [Errorconfig](#errorconfig)                 | governs      | inbound   | many-to-one |
| [Statetransition](#statetransition)         | flows-to     | outbound  | many-to-one |
| [View](#view)                               | governs      | outbound  | many-to-one |
| [Experiencestate](#experiencestate)         | navigates-to | outbound  | many-to-one |
| [View](#view)                               | renders      | outbound  | many-to-one |
| [Statepattern](#statepattern)               | specializes  | outbound  | many-to-one |
| [Stateaction](#stateaction)                 | triggers     | outbound  | many-to-one |
| [Stateactiontemplate](#stateactiontemplate) | uses         | outbound  | many-to-one |
| [Statepattern](#statepattern)               | aggregates   | inbound   | many-to-one |
| [Statepattern](#statepattern)               | governs      | inbound   | many-to-one |
| [Statetransition](#statetransition)         | navigates-to | inbound   | many-to-one |
| [Transitiontemplate](#transitiontemplate)   | flows-to     | inbound   | many-to-one |
| [Uxspec](#uxspec)                           | aggregates   | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                            | Layer                                         | Predicate | Direction | Cardinality |
| ----------------------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Navigationguard](./10-navigation-layer-report.md#navigationguard)      | [Navigation](./10-navigation-layer-report.md) | triggers  | inbound   | many-to-one |
| [Coveragerequirement](./12-testing-layer-report.md#coveragerequirement) | [Testing](./12-testing-layer-report.md)       | covers    | inbound   | many-to-one |

[Back to Index](#report-index)

### Layoutconfig {#layoutconfig}

**Spec Node ID**: `ux.layoutconfig`

Configuration for UI layout structure, defining grid systems, responsive breakpoints, spacing rules, and component arrangement patterns. Controls visual organization of the interface.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 7 | Outbound: 5
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate       | Direction | Cardinality |
| ----------------------------------------- | --------------- | --------- | ----------- |
| [Componentinstance](#componentinstance)   | renders         | inbound   | many-to-one |
| [Componentreference](#componentreference) | uses            | inbound   | many-to-one |
| [Librarycomponent](#librarycomponent)     | associated-with | outbound  | many-to-one |
| [Layoutconfig](#layoutconfig)             | composes        | outbound  | many-to-one |
| [View](#view)                             | governs         | outbound  | many-to-one |
| [Subview](#subview)                       | provides        | outbound  | many-to-one |
| [View](#view)                             | provides        | outbound  | many-to-one |
| [Librarysubview](#librarysubview)         | uses            | inbound   | many-to-one |
| [Subview](#subview)                       | uses            | inbound   | many-to-one |
| [Tablecolumn](#tablecolumn)               | uses            | inbound   | many-to-one |
| [View](#view)                             | uses            | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                           | Layer                                         | Predicate | Direction | Cardinality |
| ------------------------------------------------------ | --------------------------------------------- | --------- | --------- | ----------- |
| [Route](./10-navigation-layer-report.md#route)         | [Navigation](./10-navigation-layer-report.md) | uses      | inbound   | many-to-one |
| [Routemeta](./10-navigation-layer-report.md#routemeta) | [Navigation](./10-navigation-layer-report.md) | uses      | inbound   | many-to-one |

[Back to Index](#report-index)

### Librarycomponent {#librarycomponent}

**Spec Node ID**: `ux.librarycomponent`

Reusable UI component definition that can be instantiated in multiple UXSpecs

#### Relationship Metrics

- **Intra-Layer**: Inbound: 14 | Outbound: 9
- **Inter-Layer**: Inbound: 1 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                              | Predicate       | Direction | Cardinality |
| ----------------------------------------- | --------------- | --------- | ----------- |
| [Actioncomponent](#actioncomponent)       | renders         | inbound   | many-to-one |
| [Chartseries](#chartseries)               | references      | inbound   | many-to-one |
| [Componentinstance](#componentinstance)   | implements      | inbound   | many-to-one |
| [Componentinstance](#componentinstance)   | realizes        | inbound   | many-to-one |
| [Componentinstance](#componentinstance)   | renders         | inbound   | many-to-one |
| [Componentreference](#componentreference) | implements      | inbound   | many-to-one |
| [Componentreference](#componentreference) | renders         | inbound   | many-to-one |
| [Dataconfig](#dataconfig)                 | binds-to        | inbound   | many-to-one |
| [Layoutconfig](#layoutconfig)             | associated-with | inbound   | many-to-one |
| [Actioncomponent](#actioncomponent)       | composes        | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | composes        | outbound  | many-to-one |
| [Actioncomponent](#actioncomponent)       | renders         | outbound  | many-to-one |
| [Componentinstance](#componentinstance)   | renders         | outbound  | many-to-one |
| [Componentreference](#componentreference) | renders         | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | renders         | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent)     | specializes     | outbound  | many-to-one |
| [Actionpattern](#actionpattern)           | uses            | outbound  | many-to-one |
| [Statepattern](#statepattern)             | uses            | outbound  | many-to-one |
| [Uxlibrary](#uxlibrary)                   | aggregates      | inbound   | many-to-one |
| [Uxlibrary](#uxlibrary)                   | provides        | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                           | Layer                                         | Predicate  | Direction | Cardinality |
| ---------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)          | [Testing](./12-testing-layer-report.md)       | tests      | inbound   | many-to-one |
| [Systemsoftware](./05-technology-layer-report.md#systemsoftware)       | [Technology](./05-technology-layer-report.md) | depends-on | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice) | [Technology](./05-technology-layer-report.md) | requires   | outbound  | many-to-one |
| [Principle](./01-motivation-layer-report.md#principle)                 | [Motivation](./01-motivation-layer-report.md) | satisfies  | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)             | [Motivation](./01-motivation-layer-report.md) | satisfies  | outbound  | many-to-one |

[Back to Index](#report-index)

### Librarysubview {#librarysubview}

**Spec Node ID**: `ux.librarysubview`

Reusable, non-routable grouping of components intended to be composed into Views or other SubViews. Unlike View, LibrarySubView has no route and cannot be navigated to directly. It exists purely as a reusable composition unit, analogous to an HTML template element.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                            | Predicate  | Direction | Cardinality |
| --------------------------------------- | ---------- | --------- | ----------- |
| [Componentinstance](#componentinstance) | composes   | outbound  | many-to-one |
| [Actionpattern](#actionpattern)         | uses       | outbound  | many-to-one |
| [Dataconfig](#dataconfig)               | uses       | outbound  | many-to-one |
| [Layoutconfig](#layoutconfig)           | uses       | outbound  | many-to-one |
| [Subview](#subview)                     | realizes   | inbound   | many-to-one |
| [Subview](#subview)                     | uses       | inbound   | many-to-one |
| [Uxlibrary](#uxlibrary)                 | aggregates | inbound   | many-to-one |
| [Uxlibrary](#uxlibrary)                 | provides   | inbound   | many-to-one |

[Back to Index](#report-index)

### Stateaction {#stateaction}

**Spec Node ID**: `ux.stateaction`

A concrete action bound to a specific ExperienceState lifecycle event. Instances are bound to a state and lifecycle hook; for reusable parameterizable definitions use StateActionTemplate. Examples: scroll-to-top (lifecycle: on-enter), focus-first-field (lifecycle: on-enter), dispatch-analytics-event (lifecycle: on-exit).

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                                | Predicate   | Direction | Cardinality |
| ------------------------------------------- | ----------- | --------- | ----------- |
| [Actionpattern](#actionpattern)             | governs     | inbound   | many-to-one |
| [Experiencestate](#experiencestate)         | triggers    | inbound   | many-to-one |
| [Statetransition](#statetransition)         | flows-to    | outbound  | many-to-one |
| [Stateactiontemplate](#stateactiontemplate) | specializes | outbound  | many-to-one |
| [Actionpattern](#actionpattern)             | uses        | outbound  | many-to-one |
| [Stateactiontemplate](#stateactiontemplate) | implements  | inbound   | many-to-one |
| [Stateactiontemplate](#stateactiontemplate) | provides    | inbound   | many-to-one |
| [Statetransition](#statetransition)         | triggers    | inbound   | many-to-one |
| [Transitiontemplate](#transitiontemplate)   | triggers    | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                    | Layer                           | Predicate | Direction | Cardinality |
| ----------------------------------------------- | ------------------------------- | --------- | --------- | ----------- |
| [Operation](./06-api-layer-report.md#operation) | [API](./06-api-layer-report.md) | triggers  | outbound  | many-to-one |

[Back to Index](#report-index)

### Stateactiontemplate {#stateactiontemplate}

**Spec Node ID**: `ux.stateactiontemplate`

A parameterizable, reusable definition of an action to execute during state transitions. StateActionTemplate is the definition; StateAction is the concrete usage bound to a specific ExperienceState and lifecycle hook. Example: a 'scroll-to-top' template with a 'targetId' parameter, instantiated as a StateAction on multiple states.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality |
| ----------------------------------- | --------------- | --------- | ----------- |
| [Experiencestate](#experiencestate) | uses            | inbound   | many-to-one |
| [Stateaction](#stateaction)         | specializes     | inbound   | many-to-one |
| [Statepattern](#statepattern)       | associated-with | outbound  | many-to-one |
| [Statetransition](#statetransition) | governs         | outbound  | many-to-one |
| [Stateaction](#stateaction)         | implements      | outbound  | many-to-one |
| [Stateaction](#stateaction)         | provides        | outbound  | many-to-one |
| [Statepattern](#statepattern)       | uses            | inbound   | many-to-one |

[Back to Index](#report-index)

### Statepattern {#statepattern}

**Spec Node ID**: `ux.statepattern`

Reusable state machine template for common UX interaction flows, composed of named ExperienceStates and transitions. Canonical examples: 'wizard' — multi-step form with back/next/submit transitions; 'optimistic-update' — loading → success/error with retry; 'tab-panel' — N peer states with tab-driven transitions; 'authenticated-route' — unauthenticated → redirect/login → authenticated.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate       | Direction | Cardinality |
| ------------------------------------------- | --------------- | --------- | ----------- |
| [Actionpattern](#actionpattern)             | associated-with | inbound   | many-to-one |
| [Dataconfig](#dataconfig)                   | realizes        | inbound   | many-to-one |
| [Experiencestate](#experiencestate)         | specializes     | inbound   | many-to-one |
| [Librarycomponent](#librarycomponent)       | uses            | inbound   | many-to-one |
| [Stateactiontemplate](#stateactiontemplate) | associated-with | inbound   | many-to-one |
| [Experiencestate](#experiencestate)         | aggregates      | outbound  | many-to-one |
| [Experiencestate](#experiencestate)         | governs         | outbound  | many-to-one |
| [Statepattern](#statepattern)               | specializes     | outbound  | many-to-one |
| [Stateactiontemplate](#stateactiontemplate) | uses            | outbound  | many-to-one |
| [Transitiontemplate](#transitiontemplate)   | uses            | outbound  | many-to-one |

[Back to Index](#report-index)

### Statetransition {#statetransition}

**Spec Node ID**: `ux.statetransition`

A directed edge in the ExperienceState machine, owned by its source ExperienceState. Specifies the trigger event, destination state, optional guard condition, and side-effect actions. The 'from' state is implicitly the ExperienceState that contains this transition via relationship.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 4
- **Inter-Layer**: Inbound: 1 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate       | Direction | Cardinality |
| ------------------------------------------- | --------------- | --------- | ----------- |
| [Actioncomponent](#actioncomponent)         | triggers        | inbound   | many-to-one |
| [Actionpattern](#actionpattern)             | triggers        | inbound   | many-to-one |
| [Experiencestate](#experiencestate)         | flows-to        | inbound   | many-to-one |
| [Stateaction](#stateaction)                 | flows-to        | inbound   | many-to-one |
| [Stateactiontemplate](#stateactiontemplate) | governs         | inbound   | many-to-one |
| [Actioncomponent](#actioncomponent)         | associated-with | outbound  | many-to-one |
| [Experiencestate](#experiencestate)         | navigates-to    | outbound  | many-to-one |
| [Stateaction](#stateaction)                 | triggers        | outbound  | many-to-one |
| [Transitiontemplate](#transitiontemplate)   | uses            | outbound  | many-to-one |
| [Transitiontemplate](#transitiontemplate)   | governs         | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                 | Layer                                         | Predicate | Direction | Cardinality |
| ---------------------------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Navigationtransition](./10-navigation-layer-report.md#navigationtransition) | [Navigation](./10-navigation-layer-report.md) | triggers  | inbound   | many-to-one |

[Back to Index](#report-index)

### Subview {#subview}

**Spec Node ID**: `ux.subview`

A non-routable UI fragment embedded within a parent View. Two usage modes: (1) Library instance — 'ref' is populated with a ux.librarysubview specNodeId, rendering that reusable fragment; (2) Inline definition — 'ref' is absent and the SubView defines its own composition inline. SubViews are not independently routable; use View for routable pages.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 7
- **Inter-Layer**: Inbound: 1 | Outbound: 5

#### Intra-Layer Relationships

| Related Node                              | Predicate  | Direction | Cardinality |
| ----------------------------------------- | ---------- | --------- | ----------- |
| [Dataconfig](#dataconfig)                 | binds-to   | inbound   | many-to-one |
| [Layoutconfig](#layoutconfig)             | provides   | inbound   | many-to-one |
| [Componentinstance](#componentinstance)   | aggregates | outbound  | many-to-one |
| [Dataconfig](#dataconfig)                 | binds-to   | outbound  | many-to-one |
| [Librarysubview](#librarysubview)         | realizes   | outbound  | many-to-one |
| [Componentinstance](#componentinstance)   | renders    | outbound  | many-to-one |
| [Errorconfig](#errorconfig)               | uses       | outbound  | many-to-one |
| [Layoutconfig](#layoutconfig)             | uses       | outbound  | many-to-one |
| [Librarysubview](#librarysubview)         | uses       | outbound  | many-to-one |
| [Transitiontemplate](#transitiontemplate) | flows-to   | inbound   | many-to-one |
| [View](#view)                             | aggregates | inbound   | many-to-one |
| [View](#view)                             | composes   | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate  | Direction | Cardinality |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)     | [Testing](./12-testing-layer-report.md)         | covers     | inbound   | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)                  | [Data Store](./08-data-store-layer-report.md)   | accesses   | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)          | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)              | [Data Model](./07-data-model-layer-report.md)   | references | outbound  | many-to-one |
| [Permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |

[Back to Index](#report-index)

### Tablecolumn {#tablecolumn}

**Spec Node ID**: `ux.tablecolumn`

Configuration for a single column within a data table component, specifying header, data binding, sorting, filtering, and rendering options. Defines table structure and behavior.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 3

#### Intra-Layer Relationships

| Related Node                            | Predicate  | Direction | Cardinality |
| --------------------------------------- | ---------- | --------- | ----------- |
| [Componentinstance](#componentinstance) | aggregates | inbound   | many-to-one |
| [Dataconfig](#dataconfig)               | provides   | inbound   | many-to-one |
| [Dataconfig](#dataconfig)               | binds-to   | outbound  | many-to-one |
| [Actionpattern](#actionpattern)         | references | outbound  | many-to-one |
| [Componentinstance](#componentinstance) | renders    | outbound  | many-to-one |
| [Layoutconfig](#layoutconfig)           | uses       | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                           | Layer                                         | Predicate  | Direction | Cardinality |
| ---------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Schemaproperty](./07-data-model-layer-report.md#schemaproperty)       | [Data Model](./07-data-model-layer-report.md) | maps-to    | outbound  | many-to-one |
| [Field](./08-data-store-layer-report.md#field)                         | [Data Store](./08-data-store-layer-report.md) | maps-to    | outbound  | many-to-one |
| [Fieldaccesscontrol](./03-security-layer-report.md#fieldaccesscontrol) | [Security](./03-security-layer-report.md)     | references | outbound  | many-to-one |

[Back to Index](#report-index)

### Transitiontemplate {#transitiontemplate}

**Spec Node ID**: `ux.transitiontemplate`

Defines reusable animation and transition patterns for state changes, page navigation, or component lifecycle events. Ensures consistent motion design across the application.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate    | Direction | Cardinality |
| ----------------------------------------- | ------------ | --------- | ----------- |
| [Actionpattern](#actionpattern)           | uses         | inbound   | many-to-one |
| [Statepattern](#statepattern)             | uses         | inbound   | many-to-one |
| [Statetransition](#statetransition)       | uses         | inbound   | many-to-one |
| [Experiencestate](#experiencestate)       | flows-to     | outbound  | many-to-one |
| [Subview](#subview)                       | flows-to     | outbound  | many-to-one |
| [Statetransition](#statetransition)       | governs      | outbound  | many-to-one |
| [View](#view)                             | navigates-to | outbound  | many-to-one |
| [Transitiontemplate](#transitiontemplate) | specializes  | outbound  | many-to-one |
| [Stateaction](#stateaction)               | triggers     | outbound  | many-to-one |

[Back to Index](#report-index)

### Uxapplication {#uxapplication}

**Spec Node ID**: `ux.uxapplication`

Application-level UX configuration that groups UXSpecs and defines shared settings

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 3 | Outbound: 0

#### Intra-Layer Relationships

| Related Node      | Predicate  | Direction | Cardinality |
| ----------------- | ---------- | --------- | ----------- |
| [Uxspec](#uxspec) | aggregates | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                          | Layer                                   | Predicate | Direction | Cardinality |
| --------------------------------------------------------------------- | --------------------------------------- | --------- | --------- | ----------- |
| [Instrumentationscope](./11-apm-layer-report.md#instrumentationscope) | [APM](./11-apm-layer-report.md)         | monitors  | inbound   | many-to-one |
| [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)     | [APM](./11-apm-layer-report.md)         | monitors  | inbound   | many-to-one |
| [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)   | [Testing](./12-testing-layer-report.md) | covers    | inbound   | many-to-one |

[Back to Index](#report-index)

### Uxlibrary {#uxlibrary}

**Spec Node ID**: `ux.uxlibrary`

Collection of reusable UI components and sub-views that can be shared across applications

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                          | Predicate  | Direction | Cardinality |
| ------------------------------------- | ---------- | --------- | ----------- |
| [Librarycomponent](#librarycomponent) | aggregates | outbound  | many-to-one |
| [Librarysubview](#librarysubview)     | aggregates | outbound  | many-to-one |
| [Librarycomponent](#librarycomponent) | provides   | outbound  | many-to-one |
| [Librarysubview](#librarysubview)     | provides   | outbound  | many-to-one |
| [Uxlibrary](#uxlibrary)               | uses       | outbound  | many-to-one |
| [Uxspec](#uxspec)                     | uses       | inbound   | many-to-one |

[Back to Index](#report-index)

### Uxspec {#uxspec}

**Spec Node ID**: `ux.uxspec`

Complete UX specification for a single experience (visual, voice, chat, SMS)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                        | Predicate  | Direction | Cardinality |
| ----------------------------------- | ---------- | --------- | ----------- |
| [Uxapplication](#uxapplication)     | aggregates | inbound   | many-to-one |
| [Experiencestate](#experiencestate) | aggregates | outbound  | many-to-one |
| [View](#view)                       | aggregates | outbound  | many-to-one |
| [Errorconfig](#errorconfig)         | governs    | outbound  | many-to-one |
| [Uxlibrary](#uxlibrary)             | uses       | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                               | Layer                                         | Predicate | Direction | Cardinality |
| ---------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Requirement](./01-motivation-layer-report.md#requirement) | [Motivation](./01-motivation-layer-report.md) | satisfies | outbound  | many-to-one |

[Back to Index](#report-index)

### View {#view}

**Spec Node ID**: `ux.view`

Routable grouping of components (a complete user experience)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 9 | Outbound: 7
- **Inter-Layer**: Inbound: 8 | Outbound: 23

#### Intra-Layer Relationships

| Related Node                              | Predicate    | Direction | Cardinality |
| ----------------------------------------- | ------------ | --------- | ----------- |
| [Actioncomponent](#actioncomponent)       | navigates-to | inbound   | many-to-one |
| [Dataconfig](#dataconfig)                 | binds-to     | inbound   | many-to-one |
| [Errorconfig](#errorconfig)               | governs      | inbound   | many-to-one |
| [Experiencestate](#experiencestate)       | governs      | inbound   | many-to-one |
| [Experiencestate](#experiencestate)       | renders      | inbound   | many-to-one |
| [Layoutconfig](#layoutconfig)             | governs      | inbound   | many-to-one |
| [Layoutconfig](#layoutconfig)             | provides     | inbound   | many-to-one |
| [Transitiontemplate](#transitiontemplate) | navigates-to | inbound   | many-to-one |
| [Uxspec](#uxspec)                         | aggregates   | inbound   | many-to-one |
| [Actioncomponent](#actioncomponent)       | aggregates   | outbound  | one-to-many |
| [Subview](#subview)                       | aggregates   | outbound  | many-to-one |
| [Dataconfig](#dataconfig)                 | binds-to     | outbound  | many-to-one |
| [Subview](#subview)                       | composes     | outbound  | many-to-one |
| [Componentinstance](#componentinstance)   | renders      | outbound  | many-to-one |
| [Errorconfig](#errorconfig)               | requires     | outbound  | many-to-one |
| [Layoutconfig](#layoutconfig)             | uses         | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Logrecord](./11-apm-layer-report.md#logrecord)                               | [APM](./11-apm-layer-report.md)                 | references | inbound   | many-to-one |
| [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                 | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Span](./11-apm-layer-report.md#span)                                         | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Flowstep](./10-navigation-layer-report.md#flowstep)                          | [Navigation](./10-navigation-layer-report.md)   | maps-to    | inbound   | many-to-one |
| [Navigationflow](./10-navigation-layer-report.md#navigationflow)              | [Navigation](./10-navigation-layer-report.md)   | accesses   | inbound   | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | maps-to    | inbound   | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                 | [Testing](./12-testing-layer-report.md)         | tests      | inbound   | many-to-one |
| [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)         | [Testing](./12-testing-layer-report.md)         | covers     | inbound   | many-to-one |
| [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | accesses   | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | accesses   | outbound  | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | accesses   | outbound  | many-to-one |
| [View](./08-data-store-layer-report.md#view)                                  | [Data Store](./08-data-store-layer-report.md)   | accesses   | outbound  | many-to-one |
| [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | outbound  | many-to-one |
| [Businessobject](./02-business-layer-report.md#businessobject)                | [Business](./02-business-layer-report.md)       | maps-to    | outbound  | many-to-one |
| [Outcome](./01-motivation-layer-report.md#outcome)                            | [Motivation](./01-motivation-layer-report.md)   | maps-to    | outbound  | many-to-one |
| [Applicationinterface](./04-application-layer-report.md#applicationinterface) | [Application](./04-application-layer-report.md) | realizes   | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | references | outbound  | many-to-one |
| [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | outbound  | many-to-one |
| [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Role](./03-security-layer-report.md#role)                                    | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | requires   | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Businessrole](./02-business-layer-report.md#businessrole)                    | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Stakeholder](./01-motivation-layer-report.md#stakeholder)                    | [Motivation](./01-motivation-layer-report.md)   | serves     | outbound  | many-to-one |
| [Securityscheme](./06-api-layer-report.md#securityscheme)                     | [API](./06-api-layer-report.md)                 | uses       | outbound  | many-to-one |
| [Applicationevent](./04-application-layer-report.md#applicationevent)         | [Application](./04-application-layer-report.md) | uses       | outbound  | many-to-one |

[Back to Index](#report-index)

---

_Generated: 2026-03-14T21:04:51.706Z | Spec Version: 0.8.2 | Generator: generate-layer-reports.ts_
