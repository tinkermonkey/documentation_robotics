# APM Observability Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Alert](#alert)
  - [Dashboard](#dashboard)
  - [Exporterconfig](#exporterconfig)
  - [Instrumentationconfig](#instrumentationconfig)
  - [Instrumentationscope](#instrumentationscope)
  - [Logconfiguration](#logconfiguration)
  - [Logprocessor](#logprocessor)
  - [Logrecord](#logrecord)
  - [Metricconfiguration](#metricconfiguration)
  - [Metricinstrument](#metricinstrument)
  - [Resource](#resource)
  - [Span](#span)
  - [Spanevent](#spanevent)
  - [Spanlink](#spanlink)
  - [Traceconfiguration](#traceconfiguration)

## Layer Introduction

**Layer 11**: APM
**Standard**: [OpenTelemetry](https://opentelemetry.io/)

Layer 11: APM Observability Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 15    |
| Intra-Layer Relationships | 55    |
| Inter-Layer Relationships | 85    |
| Inbound Relationships     | 10    |
| Outbound Relationships    | 75    |

### Layer Dependencies

**Depends On**: [Application](./04-application-layer-report.md), [API](./06-api-layer-report.md), [Testing](./12-testing-layer-report.md)

**Depended On By**: [Motivation](./01-motivation-layer-report.md), [Business](./02-business-layer-report.md), [Security](./03-security-layer-report.md), [Application](./04-application-layer-report.md), [Technology](./05-technology-layer-report.md), [API](./06-api-layer-report.md), [Data Model](./07-data-model-layer-report.md), [Data Store](./08-data-store-layer-report.md), [UX](./09-ux-layer-report.md), [Navigation](./10-navigation-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph apm
    alert["alert"]
    dashboard["dashboard"]
    exporterconfig["exporterconfig"]
    instrumentationconfig["instrumentationconfig"]
    instrumentationscope["instrumentationscope"]
    logconfiguration["logconfiguration"]
    logprocessor["logprocessor"]
    logrecord["logrecord"]
    metricconfiguration["metricconfiguration"]
    metricinstrument["metricinstrument"]
    resource["resource"]
    span["span"]
    spanevent["spanevent"]
    spanlink["spanlink"]
    traceconfiguration["traceconfiguration"]
    exporterconfig -->|serves| resource
    instrumentationconfig -->|serves| instrumentationscope
    instrumentationconfig -->|serves| resource
    instrumentationscope -->|aggregates| exporterconfig
    instrumentationscope -->|aggregates| metricinstrument
    instrumentationscope -->|aggregates| span
    logconfiguration -->|aggregates| exporterconfig
    logconfiguration -->|aggregates| logprocessor
    logconfiguration -->|depends-on| resource
    logconfiguration -->|flows-to| exporterconfig
    logconfiguration -->|references| traceconfiguration
    logconfiguration -->|serves| logrecord
    logconfiguration -->|serves| resource
    logprocessor -->|flows-to| exporterconfig
    logprocessor -->|flows-to| logprocessor
    logprocessor -->|flows-to| span
    logrecord -->|depends-on| instrumentationscope
    logrecord -->|depends-on| resource
    logrecord -->|flows-to| logprocessor
    logrecord -->|references| span
    metricconfiguration -->|aggregates| exporterconfig
    metricconfiguration -->|aggregates| metricinstrument
    metricconfiguration -->|depends-on| resource
    metricconfiguration -->|references| traceconfiguration
    metricconfiguration -->|serves| instrumentationconfig
    metricconfiguration -->|serves| resource
    metricinstrument -->|depends-on| instrumentationscope
    metricinstrument -->|depends-on| resource
    metricinstrument -->|flows-to| exporterconfig
    metricinstrument -->|flows-to| logprocessor
    metricinstrument -->|flows-to| span
    metricinstrument -->|references| span
    resource -->|aggregates| exporterconfig
    resource -->|aggregates| metricinstrument
    resource -->|aggregates| span
    span -->|aggregates| spanlink
    span -->|composes| metricinstrument
    span -->|composes| spanevent
    span -->|composes| traceconfiguration
    span -->|depends-on| instrumentationscope
    span -->|depends-on| resource
    span -->|flows-to| exporterconfig
    span -->|flows-to| logprocessor
    span -->|flows-to| span
    span -->|references| span
    spanevent -->|depends-on| instrumentationscope
    spanevent -->|depends-on| resource
    spanevent -->|depends-on| traceconfiguration
    spanevent -->|flows-to| exporterconfig
    spanevent -->|references| logrecord
    spanevent -->|triggers| metricinstrument
    spanlink -->|references| span
    traceconfiguration -->|aggregates| exporterconfig
    traceconfiguration -->|aggregates| metricinstrument
    traceconfiguration -->|aggregates| span
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
  class apm current
```

## Inter-Layer Relationships Table

| Relationship ID                                                     | Source Node                                                               | Dest Node                                                                            | Dest Layer                                      | Predicate  | Cardinality | Strength |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------- | ----------- | -------- |
| api.operation.references.apm.traceconfiguration                     | [Operation](./06-api-layer-report.md#operation)                           | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)                    | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| apm.alert.monitors.api.operation                                    | [Alert](./11-apm-layer-report.md#alert)                                   | [Operation](./06-api-layer-report.md#operation)                                      | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.alert.monitors.api.ratelimit                                    | [Alert](./11-apm-layer-report.md#alert)                                   | [Ratelimit](./06-api-layer-report.md#ratelimit)                                      | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.dashboard.monitors.api.operation                                | [Dashboard](./11-apm-layer-report.md#dashboard)                           | [Operation](./06-api-layer-report.md#operation)                                      | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.exporterconfig.depends-on.technology.technologyservice          | [Exporterconfig](./11-apm-layer-report.md#exporterconfig)                 | [Technologyservice](./05-technology-layer-report.md#technologyservice)               | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| apm.exporterconfig.satisfies.motivation.requirement                 | [Exporterconfig](./11-apm-layer-report.md#exporterconfig)                 | [Requirement](./01-motivation-layer-report.md#requirement)                           | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| apm.exporterconfig.satisfies.security.retentionpolicy               | [Exporterconfig](./11-apm-layer-report.md#exporterconfig)                 | [Retentionpolicy](./03-security-layer-report.md#retentionpolicy)                     | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| apm.exporterconfig.serves.data-store.database                       | [Exporterconfig](./11-apm-layer-report.md#exporterconfig)                 | [Database](./08-data-store-layer-report.md#database)                                 | [Data Store](./08-data-store-layer-report.md)   | serves     | many-to-one | medium   |
| apm.instrumentationconfig.monitors.application.applicationcomponent | [Instrumentationconfig](./11-apm-layer-report.md#instrumentationconfig)   | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent)        | [Application](./04-application-layer-report.md) | monitors   | many-to-one | medium   |
| apm.instrumentationconfig.monitors.navigation.route                 | [Instrumentationconfig](./11-apm-layer-report.md#instrumentationconfig)   | [Route](./10-navigation-layer-report.md#route)                                       | [Navigation](./10-navigation-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.instrumentationconfig.monitors.technology.systemsoftware        | [Instrumentationconfig](./11-apm-layer-report.md#instrumentationconfig)   | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)                     | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.instrumentationconfig.satisfies.motivation.constraint           | [Instrumentationconfig](./11-apm-layer-report.md#instrumentationconfig)   | [Constraint](./01-motivation-layer-report.md#constraint)                             | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| apm.instrumentationscope.monitors.data-model.objectschema           | [Instrumentationscope](./11-apm-layer-report.md#instrumentationscope)     | [Objectschema](./07-data-model-layer-report.md#objectschema)                         | [Data Model](./07-data-model-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.instrumentationscope.monitors.ux.uxapplication                  | [Instrumentationscope](./11-apm-layer-report.md#instrumentationscope)     | [Uxapplication](./09-ux-layer-report.md#uxapplication)                               | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.logconfiguration.depends-on.data-store.database                 | [Logconfiguration](./11-apm-layer-report.md#logconfiguration)             | [Database](./08-data-store-layer-report.md#database)                                 | [Data Store](./08-data-store-layer-report.md)   | depends-on | many-to-one | medium   |
| apm.logconfiguration.depends-on.technology.technologyservice        | [Logconfiguration](./11-apm-layer-report.md#logconfiguration)             | [Technologyservice](./05-technology-layer-report.md#technologyservice)               | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| apm.logconfiguration.monitors.business.businessservice              | [Logconfiguration](./11-apm-layer-report.md#logconfiguration)             | [Businessservice](./02-business-layer-report.md#businessservice)                     | [Business](./02-business-layer-report.md)       | monitors   | many-to-one | medium   |
| apm.logconfiguration.satisfies.security.auditconfig                 | [Logconfiguration](./11-apm-layer-report.md#logconfiguration)             | [Auditconfig](./03-security-layer-report.md#auditconfig)                             | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| apm.logprocessor.satisfies.security.securityconstraints             | [Logprocessor](./11-apm-layer-report.md#logprocessor)                     | [Securityconstraints](./03-security-layer-report.md#securityconstraints)             | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| apm.logrecord.monitors.application.applicationservice               | [Logrecord](./11-apm-layer-report.md#logrecord)                           | [Applicationservice](./04-application-layer-report.md#applicationservice)            | [Application](./04-application-layer-report.md) | monitors   | many-to-one | medium   |
| apm.logrecord.references.data-model.objectschema                    | [Logrecord](./11-apm-layer-report.md#logrecord)                           | [Objectschema](./07-data-model-layer-report.md#objectschema)                         | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| apm.logrecord.references.data-model.schemadefinition                | [Logrecord](./11-apm-layer-report.md#logrecord)                           | [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)                 | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| apm.logrecord.references.navigation.route                           | [Logrecord](./11-apm-layer-report.md#logrecord)                           | [Route](./10-navigation-layer-report.md#route)                                       | [Navigation](./10-navigation-layer-report.md)   | references | many-to-one | medium   |
| apm.logrecord.references.ux.view                                    | [Logrecord](./11-apm-layer-report.md#logrecord)                           | [View](./09-ux-layer-report.md#view)                                                 | [UX](./09-ux-layer-report.md)                   | references | many-to-one | medium   |
| apm.logrecord.satisfies.security.accountabilityrequirement          | [Logrecord](./11-apm-layer-report.md#logrecord)                           | [Accountabilityrequirement](./03-security-layer-report.md#accountabilityrequirement) | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| apm.metricconfiguration.references.data-model.jsonschema            | [Metricconfiguration](./11-apm-layer-report.md#metricconfiguration)       | [Jsonschema](./07-data-model-layer-report.md#jsonschema)                             | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| apm.metricinstrument.maps-to.motivation.outcome                     | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Outcome](./01-motivation-layer-report.md#outcome)                                   | [Motivation](./01-motivation-layer-report.md)   | maps-to    | many-to-one | medium   |
| apm.metricinstrument.monitors.api.operation                         | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Operation](./06-api-layer-report.md#operation)                                      | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.api.pathitem                          | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Pathitem](./06-api-layer-report.md#pathitem)                                        | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.application.applicationcomponent      | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent)        | [Application](./04-application-layer-report.md) | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.application.applicationservice        | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Applicationservice](./04-application-layer-report.md#applicationservice)            | [Application](./04-application-layer-report.md) | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.business.businessprocess              | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Businessprocess](./02-business-layer-report.md#businessprocess)                     | [Business](./02-business-layer-report.md)       | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.business.businessservice              | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Businessservice](./02-business-layer-report.md#businessservice)                     | [Business](./02-business-layer-report.md)       | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.data-model.objectschema               | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Objectschema](./07-data-model-layer-report.md#objectschema)                         | [Data Model](./07-data-model-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.data-model.schemadefinition           | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)                 | [Data Model](./07-data-model-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.data-store.collection                 | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Collection](./08-data-store-layer-report.md#collection)                             | [Data Store](./08-data-store-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.data-store.database                   | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Database](./08-data-store-layer-report.md#database)                                 | [Data Store](./08-data-store-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.navigation.navigationtransition       | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Navigationtransition](./10-navigation-layer-report.md#navigationtransition)         | [Navigation](./10-navigation-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.navigation.route                      | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Route](./10-navigation-layer-report.md#route)                                       | [Navigation](./10-navigation-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.security.threat                       | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Threat](./03-security-layer-report.md#threat)                                       | [Security](./03-security-layer-report.md)       | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.technology.technologyservice          | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Technologyservice](./05-technology-layer-report.md#technologyservice)               | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.ux.actioncomponent                    | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                           | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.ux.errorconfig                        | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Errorconfig](./09-ux-layer-report.md#errorconfig)                                   | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.ux.view                               | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [View](./09-ux-layer-report.md#view)                                                 | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.metricinstrument.realizes.motivation.goal                       | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Goal](./01-motivation-layer-report.md#goal)                                         | [Motivation](./01-motivation-layer-report.md)   | realizes   | many-to-one | medium   |
| apm.metricinstrument.satisfies.motivation.requirement               | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)             | [Requirement](./01-motivation-layer-report.md#requirement)                           | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| apm.resource.maps-to.application.applicationcomponent               | [Resource](./11-apm-layer-report.md#resource)                             | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent)        | [Application](./04-application-layer-report.md) | maps-to    | many-to-one | medium   |
| apm.resource.monitors.technology.node                               | [Resource](./11-apm-layer-report.md#resource)                             | [Node](./05-technology-layer-report.md#node)                                         | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.resource.monitors.technology.systemsoftware                     | [Resource](./11-apm-layer-report.md#resource)                             | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)                     | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.resource.references.security.secureresource                     | [Resource](./11-apm-layer-report.md#resource)                             | [Secureresource](./03-security-layer-report.md#secureresource)                       | [Security](./03-security-layer-report.md)       | references | many-to-one | medium   |
| apm.resource.serves.business.businessprocess                        | [Resource](./11-apm-layer-report.md#resource)                             | [Businessprocess](./02-business-layer-report.md#businessprocess)                     | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| apm.span.accesses.data-store.collection                             | [Span](./11-apm-layer-report.md#span)                                     | [Collection](./08-data-store-layer-report.md#collection)                             | [Data Store](./08-data-store-layer-report.md)   | accesses   | many-to-one | medium   |
| apm.span.maps-to.business.businessprocess                           | [Span](./11-apm-layer-report.md#span)                                     | [Businessprocess](./02-business-layer-report.md#businessprocess)                     | [Business](./02-business-layer-report.md)       | maps-to    | many-to-one | medium   |
| apm.span.monitors.api.operation                                     | [Span](./11-apm-layer-report.md#span)                                     | [Operation](./06-api-layer-report.md#operation)                                      | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.span.monitors.application.applicationcomponent                  | [Span](./11-apm-layer-report.md#span)                                     | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent)        | [Application](./04-application-layer-report.md) | monitors   | many-to-one | medium   |
| apm.span.monitors.application.applicationservice                    | [Span](./11-apm-layer-report.md#span)                                     | [Applicationservice](./04-application-layer-report.md#applicationservice)            | [Application](./04-application-layer-report.md) | monitors   | many-to-one | medium   |
| apm.span.monitors.data-model.objectschema                           | [Span](./11-apm-layer-report.md#span)                                     | [Objectschema](./07-data-model-layer-report.md#objectschema)                         | [Data Model](./07-data-model-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.span.monitors.data-store.database                               | [Span](./11-apm-layer-report.md#span)                                     | [Database](./08-data-store-layer-report.md#database)                                 | [Data Store](./08-data-store-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.span.monitors.navigation.navigationflow                         | [Span](./11-apm-layer-report.md#span)                                     | [Navigationflow](./10-navigation-layer-report.md#navigationflow)                     | [Navigation](./10-navigation-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.span.monitors.navigation.navigationguard                        | [Span](./11-apm-layer-report.md#span)                                     | [Navigationguard](./10-navigation-layer-report.md#navigationguard)                   | [Navigation](./10-navigation-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.span.monitors.navigation.route                                  | [Span](./11-apm-layer-report.md#span)                                     | [Route](./10-navigation-layer-report.md#route)                                       | [Navigation](./10-navigation-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.span.monitors.security.secureresource                           | [Span](./11-apm-layer-report.md#span)                                     | [Secureresource](./03-security-layer-report.md#secureresource)                       | [Security](./03-security-layer-report.md)       | monitors   | many-to-one | medium   |
| apm.span.monitors.technology.technologyservice                      | [Span](./11-apm-layer-report.md#span)                                     | [Technologyservice](./05-technology-layer-report.md#technologyservice)               | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.span.monitors.ux.view                                           | [Span](./11-apm-layer-report.md#span)                                     | [View](./09-ux-layer-report.md#view)                                                 | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.span.references.data-model.schemadefinition                     | [Span](./11-apm-layer-report.md#span)                                     | [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)                 | [Data Model](./07-data-model-layer-report.md)   | references | many-to-one | medium   |
| apm.spanevent.monitors.ux.actioncomponent                           | [Spanevent](./11-apm-layer-report.md#spanevent)                           | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                           | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.traceconfiguration.depends-on.data-store.database               | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Database](./08-data-store-layer-report.md#database)                                 | [Data Store](./08-data-store-layer-report.md)   | depends-on | many-to-one | medium   |
| apm.traceconfiguration.depends-on.technology.technologyservice      | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Technologyservice](./05-technology-layer-report.md#technologyservice)               | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| apm.traceconfiguration.monitors.application.applicationservice      | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Applicationservice](./04-application-layer-report.md#applicationservice)            | [Application](./04-application-layer-report.md) | monitors   | many-to-one | medium   |
| apm.traceconfiguration.monitors.business.businessservice            | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Businessservice](./02-business-layer-report.md#businessservice)                     | [Business](./02-business-layer-report.md)       | monitors   | many-to-one | medium   |
| apm.traceconfiguration.monitors.navigation.route                    | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Route](./10-navigation-layer-report.md#route)                                       | [Navigation](./10-navigation-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.traceconfiguration.monitors.ux.uxapplication                    | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Uxapplication](./09-ux-layer-report.md#uxapplication)                               | [UX](./09-ux-layer-report.md)                   | monitors   | many-to-one | medium   |
| apm.traceconfiguration.references.api.operation                     | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Operation](./06-api-layer-report.md#operation)                                      | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| apm.traceconfiguration.references.api.server                        | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Server](./06-api-layer-report.md#server)                                            | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| apm.traceconfiguration.satisfies.motivation.requirement             | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Requirement](./01-motivation-layer-report.md#requirement)                           | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| apm.traceconfiguration.satisfies.security.securitypolicy            | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                       | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| application.applicationservice.references.apm.traceconfiguration    | [Applicationservice](./04-application-layer-report.md#applicationservice) | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)                    | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| testing.coveragerequirement.references.apm.metricinstrument         | [Coveragerequirement](./12-testing-layer-report.md#coveragerequirement)   | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                        | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| testing.environmentfactor.references.apm.instrumentationconfig      | [Environmentfactor](./12-testing-layer-report.md#environmentfactor)       | [Instrumentationconfig](./11-apm-layer-report.md#instrumentationconfig)              | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| testing.testcasesketch.references.apm.logconfiguration              | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)             | [Logconfiguration](./11-apm-layer-report.md#logconfiguration)                        | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| testing.testcasesketch.references.apm.span                          | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)             | [Span](./11-apm-layer-report.md#span)                                                | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| testing.testcasesketch.tests.apm.metricinstrument                   | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)             | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                        | [APM](./11-apm-layer-report.md)                 | tests      | many-to-one | medium   |
| testing.testcoveragemodel.references.apm.instrumentationscope       | [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)       | [Instrumentationscope](./11-apm-layer-report.md#instrumentationscope)                | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| testing.testcoveragemodel.references.apm.traceconfiguration         | [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)       | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)                    | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| testing.testcoveragetarget.references.apm.metricinstrument          | [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)     | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                        | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |

## Node Reference

### Alert {#alert}

**Spec Node ID**: `apm.alert`

A named alerting rule that evaluates a condition against observed signals (metrics, traces, logs) on a schedule and fires a notification when the condition is met. Represents the alert definition in the monitoring backend (e.g., Prometheus alertmanager, Grafana alerting, Datadog monitors), not an individual alert event.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Inter-Layer Relationships

| Related Node                                    | Layer                           | Predicate | Direction | Cardinality |
| ----------------------------------------------- | ------------------------------- | --------- | --------- | ----------- |
| [Operation](./06-api-layer-report.md#operation) | [API](./06-api-layer-report.md) | monitors  | outbound  | many-to-one |
| [Ratelimit](./06-api-layer-report.md#ratelimit) | [API](./06-api-layer-report.md) | monitors  | outbound  | many-to-one |

[Back to Index](#report-index)

### Dashboard {#dashboard}

**Spec Node ID**: `apm.dashboard`

A named monitoring dashboard that groups visualizations of APM signals (metrics, traces, logs) to provide operational visibility into system behavior. Represents the dashboard definition in the monitoring platform (e.g., Grafana, Datadog, CloudWatch), serving as the primary observability artifact teams consult during incidents and reviews.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 1

#### Inter-Layer Relationships

| Related Node                                    | Layer                           | Predicate | Direction | Cardinality |
| ----------------------------------------------- | ------------------------------- | --------- | --------- | ----------- |
| [Operation](./06-api-layer-report.md#operation) | [API](./06-api-layer-report.md) | monitors  | outbound  | many-to-one |

[Back to Index](#report-index)

### Exporterconfig {#exporterconfig}

**Spec Node ID**: `apm.exporterconfig`

Configuration for telemetry data export destinations, specifying protocol (OTLP, Jaeger, Prometheus), endpoints, authentication, batching, and retry policies. Controls where observability data is sent.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [Resource](#resource)                         | serves     | outbound  | many-to-many |
| [Instrumentationscope](#instrumentationscope) | aggregates | inbound   | many-to-many |
| [Logconfiguration](#logconfiguration)         | aggregates | inbound   | many-to-one  |
| [Logconfiguration](#logconfiguration)         | flows-to   | inbound   | many-to-one  |
| [Logprocessor](#logprocessor)                 | flows-to   | inbound   | many-to-many |
| [Metricconfiguration](#metricconfiguration)   | aggregates | inbound   | many-to-one  |
| [Metricinstrument](#metricinstrument)         | flows-to   | inbound   | many-to-many |
| [Resource](#resource)                         | aggregates | inbound   | many-to-many |
| [Span](#span)                                 | flows-to   | inbound   | many-to-many |
| [Spanevent](#spanevent)                       | flows-to   | inbound   | many-to-one  |
| [Traceconfiguration](#traceconfiguration)     | aggregates | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                           | Layer                                         | Predicate  | Direction | Cardinality |
| ---------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Technologyservice](./05-technology-layer-report.md#technologyservice) | [Technology](./05-technology-layer-report.md) | depends-on | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)             | [Motivation](./01-motivation-layer-report.md) | satisfies  | outbound  | many-to-one |
| [Retentionpolicy](./03-security-layer-report.md#retentionpolicy)       | [Security](./03-security-layer-report.md)     | satisfies  | outbound  | many-to-one |
| [Database](./08-data-store-layer-report.md#database)                   | [Data Store](./08-data-store-layer-report.md) | serves     | outbound  | many-to-one |

[Back to Index](#report-index)

### Instrumentationconfig {#instrumentationconfig}

**Spec Node ID**: `apm.instrumentationconfig`

Configuration for OTel instrumentation of application code. Auto-instrumentation uses SDK contrib plugin libraries (e.g., opentelemetry-instrumentation-express) that hook into frameworks transparently at SDK bootstrap time. Manual instrumentation uses direct OTel API calls (Tracer.startSpan, Meter.createCounter) embedded in application code. This node controls which libraries or code paths are instrumented and whether instrumentation is enabled.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 2
- **Inter-Layer**: Inbound: 1 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                                  | Predicate | Direction | Cardinality  |
| --------------------------------------------- | --------- | --------- | ------------ |
| [Instrumentationscope](#instrumentationscope) | serves    | outbound  | many-to-one  |
| [Resource](#resource)                         | serves    | outbound  | many-to-many |
| [Metricconfiguration](#metricconfiguration)   | serves    | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | monitors   | outbound  | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Environmentfactor](./12-testing-layer-report.md#environmentfactor)           | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Instrumentationscope {#instrumentationscope}

**Spec Node ID**: `apm.instrumentationscope`

Named instrumented library or component that identifies the source of telemetry across all three OTel signal types (traces, metrics, logs), enabling attribution and filtering of signals by their origin.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 3
- **Inter-Layer**: Inbound: 1 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                                    | Predicate  | Direction | Cardinality  |
| ----------------------------------------------- | ---------- | --------- | ------------ |
| [Instrumentationconfig](#instrumentationconfig) | serves     | inbound   | many-to-one  |
| [Exporterconfig](#exporterconfig)               | aggregates | outbound  | many-to-many |
| [Metricinstrument](#metricinstrument)           | aggregates | outbound  | many-to-many |
| [Span](#span)                                   | aggregates | outbound  | many-to-many |
| [Logrecord](#logrecord)                         | depends-on | inbound   | many-to-many |
| [Metricinstrument](#metricinstrument)           | depends-on | inbound   | many-to-many |
| [Span](#span)                                   | depends-on | inbound   | many-to-many |
| [Spanevent](#spanevent)                         | depends-on | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                        | Layer                                         | Predicate  | Direction | Cardinality |
| ------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Objectschema](./07-data-model-layer-report.md#objectschema)        | [Data Model](./07-data-model-layer-report.md) | monitors   | outbound  | many-to-one |
| [Uxapplication](./09-ux-layer-report.md#uxapplication)              | [UX](./09-ux-layer-report.md)                 | monitors   | outbound  | many-to-one |
| [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel) | [Testing](./12-testing-layer-report.md)       | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Logconfiguration {#logconfiguration}

**Spec Node ID**: `apm.logconfiguration`

OTel LoggerProvider configuration, covering the LogRecordProcessor pipeline, LogRecordExporter wiring, and minimum severity filtering for log emission.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 7
- **Inter-Layer**: Inbound: 1 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                              | Predicate  | Direction | Cardinality |
| ----------------------------------------- | ---------- | --------- | ----------- |
| [Exporterconfig](#exporterconfig)         | aggregates | outbound  | many-to-one |
| [Logprocessor](#logprocessor)             | aggregates | outbound  | many-to-one |
| [Resource](#resource)                     | depends-on | outbound  | many-to-one |
| [Exporterconfig](#exporterconfig)         | flows-to   | outbound  | many-to-one |
| [Traceconfiguration](#traceconfiguration) | references | outbound  | many-to-one |
| [Logrecord](#logrecord)                   | serves     | outbound  | many-to-one |
| [Resource](#resource)                     | serves     | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                           | Layer                                         | Predicate  | Direction | Cardinality |
| ---------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Database](./08-data-store-layer-report.md#database)                   | [Data Store](./08-data-store-layer-report.md) | depends-on | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice) | [Technology](./05-technology-layer-report.md) | depends-on | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)       | [Business](./02-business-layer-report.md)     | monitors   | outbound  | many-to-one |
| [Auditconfig](./03-security-layer-report.md#auditconfig)               | [Security](./03-security-layer-report.md)     | satisfies  | outbound  | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)          | [Testing](./12-testing-layer-report.md)       | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Logprocessor {#logprocessor}

**Spec Node ID**: `apm.logprocessor`

A processing pipeline component for log records, enabling filtering, transformation, enrichment, or routing of logs before export. Customizes log processing behavior.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                          | Predicate  | Direction | Cardinality  |
| ------------------------------------- | ---------- | --------- | ------------ |
| [Logconfiguration](#logconfiguration) | aggregates | inbound   | many-to-one  |
| [Exporterconfig](#exporterconfig)     | flows-to   | outbound  | many-to-many |
| [Logprocessor](#logprocessor)         | flows-to   | outbound  | many-to-many |
| [Span](#span)                         | flows-to   | outbound  | many-to-many |
| [Logrecord](#logrecord)               | flows-to   | inbound   | many-to-one  |
| [Metricinstrument](#metricinstrument) | flows-to   | inbound   | many-to-many |
| [Span](#span)                         | flows-to   | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                             | Layer                                     | Predicate | Direction | Cardinality |
| ------------------------------------------------------------------------ | ----------------------------------------- | --------- | --------- | ----------- |
| [Securityconstraints](./03-security-layer-report.md#securityconstraints) | [Security](./03-security-layer-report.md) | satisfies | outbound  | many-to-one |

[Back to Index](#report-index)

### Logrecord {#logrecord}

**Spec Node ID**: `apm.logrecord`

Structured log record in the OTel data model, capturing an event with dual timestamps (timeUnixNano for event occurrence, observedTimeUnixNano for ingestion), a 1–24 severity scale, and an unstructured body. Supports trace context correlation to link logs to distributed traces.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 6

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [Logconfiguration](#logconfiguration)         | serves     | inbound   | many-to-one  |
| [Instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-many |
| [Resource](#resource)                         | depends-on | outbound  | many-to-many |
| [Logprocessor](#logprocessor)                 | flows-to   | outbound  | many-to-one  |
| [Span](#span)                                 | references | outbound  | many-to-many |
| [Spanevent](#spanevent)                       | references | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                                         | Layer                                           | Predicate  | Direction | Cardinality |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Applicationservice](./04-application-layer-report.md#applicationservice)            | [Application](./04-application-layer-report.md) | monitors   | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)                         | [Data Model](./07-data-model-layer-report.md)   | references | outbound  | many-to-one |
| [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)                 | [Data Model](./07-data-model-layer-report.md)   | references | outbound  | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                       | [Navigation](./10-navigation-layer-report.md)   | references | outbound  | many-to-one |
| [View](./09-ux-layer-report.md#view)                                                 | [UX](./09-ux-layer-report.md)                   | references | outbound  | many-to-one |
| [Accountabilityrequirement](./03-security-layer-report.md#accountabilityrequirement) | [Security](./03-security-layer-report.md)       | satisfies  | outbound  | many-to-one |

[Back to Index](#report-index)

### Metricconfiguration {#metricconfiguration}

**Spec Node ID**: `apm.metricconfiguration`

OTel MeterProvider-level (global) metrics SDK configuration, covering export intervals, cardinality limits, and exemplar filtering. Distinct from per-meter configuration in MeterConfig.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                                    | Predicate  | Direction | Cardinality |
| ----------------------------------------------- | ---------- | --------- | ----------- |
| [Exporterconfig](#exporterconfig)               | aggregates | outbound  | many-to-one |
| [Metricinstrument](#metricinstrument)           | aggregates | outbound  | many-to-one |
| [Resource](#resource)                           | depends-on | outbound  | many-to-one |
| [Traceconfiguration](#traceconfiguration)       | references | outbound  | many-to-one |
| [Instrumentationconfig](#instrumentationconfig) | serves     | outbound  | many-to-one |
| [Resource](#resource)                           | serves     | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                             | Layer                                         | Predicate  | Direction | Cardinality |
| -------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Jsonschema](./07-data-model-layer-report.md#jsonschema) | [Data Model](./07-data-model-layer-report.md) | references | outbound  | many-to-one |

[Back to Index](#report-index)

### Metricinstrument {#metricinstrument}

**Spec Node ID**: `apm.metricinstrument`

Defines a specific metric measurement instrument (Counter, Gauge, Histogram, etc.) with its name, unit, description, and attributes. The fundamental unit of metric collection.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 6
- **Inter-Layer**: Inbound: 3 | Outbound: 20

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [Instrumentationscope](#instrumentationscope) | aggregates | inbound   | many-to-many |
| [Metricconfiguration](#metricconfiguration)   | aggregates | inbound   | many-to-one  |
| [Instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-many |
| [Resource](#resource)                         | depends-on | outbound  | many-to-many |
| [Exporterconfig](#exporterconfig)             | flows-to   | outbound  | many-to-many |
| [Logprocessor](#logprocessor)                 | flows-to   | outbound  | many-to-many |
| [Span](#span)                                 | flows-to   | outbound  | many-to-many |
| [Span](#span)                                 | references | outbound  | many-to-one  |
| [Resource](#resource)                         | aggregates | inbound   | many-to-many |
| [Span](#span)                                 | composes   | inbound   | many-to-many |
| [Spanevent](#spanevent)                       | triggers   | inbound   | many-to-one  |
| [Traceconfiguration](#traceconfiguration)     | aggregates | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Outcome](./01-motivation-layer-report.md#outcome)                            | [Motivation](./01-motivation-layer-report.md)   | maps-to    | outbound  | many-to-one |
| [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | monitors   | outbound  | many-to-one |
| [Pathitem](./06-api-layer-report.md#pathitem)                                 | [API](./06-api-layer-report.md)                 | monitors   | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | monitors   | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | monitors   | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | monitors   | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | monitors   | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)          | [Data Model](./07-data-model-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Database](./08-data-store-layer-report.md#database)                          | [Data Store](./08-data-store-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Navigationtransition](./10-navigation-layer-report.md#navigationtransition)  | [Navigation](./10-navigation-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Threat](./03-security-layer-report.md#threat)                                | [Security](./03-security-layer-report.md)       | monitors   | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                    | [UX](./09-ux-layer-report.md)                   | monitors   | outbound  | many-to-one |
| [Errorconfig](./09-ux-layer-report.md#errorconfig)                            | [UX](./09-ux-layer-report.md)                   | monitors   | outbound  | many-to-one |
| [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | monitors   | outbound  | many-to-one |
| [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Coveragerequirement](./12-testing-layer-report.md#coveragerequirement)       | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                 | [Testing](./12-testing-layer-report.md)         | tests      | inbound   | many-to-one |
| [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)         | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Resource {#resource}

**Spec Node ID**: `apm.resource`

Immutable set of attributes identifying the entity (service, host, process) that produces telemetry. Resource attributes are merged into all signals (traces, metrics, logs) emitted by a process at the SDK level, making accurate resource definition critical for cross-signal correlation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 5

#### Intra-Layer Relationships

| Related Node                                    | Predicate  | Direction | Cardinality  |
| ----------------------------------------------- | ---------- | --------- | ------------ |
| [Exporterconfig](#exporterconfig)               | serves     | inbound   | many-to-many |
| [Instrumentationconfig](#instrumentationconfig) | serves     | inbound   | many-to-many |
| [Logconfiguration](#logconfiguration)           | depends-on | inbound   | many-to-one  |
| [Logconfiguration](#logconfiguration)           | serves     | inbound   | many-to-one  |
| [Logrecord](#logrecord)                         | depends-on | inbound   | many-to-many |
| [Metricconfiguration](#metricconfiguration)     | depends-on | inbound   | many-to-one  |
| [Metricconfiguration](#metricconfiguration)     | serves     | inbound   | many-to-one  |
| [Metricinstrument](#metricinstrument)           | depends-on | inbound   | many-to-many |
| [Exporterconfig](#exporterconfig)               | aggregates | outbound  | many-to-many |
| [Metricinstrument](#metricinstrument)           | aggregates | outbound  | many-to-many |
| [Span](#span)                                   | aggregates | outbound  | many-to-many |
| [Span](#span)                                   | depends-on | inbound   | many-to-many |
| [Spanevent](#spanevent)                         | depends-on | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | maps-to    | outbound  | many-to-one |
| [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |

[Back to Index](#report-index)

### Span {#span}

**Spec Node ID**: `apm.span`

Unit of work in distributed tracing

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 10
- **Inter-Layer**: Inbound: 1 | Outbound: 14

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [Instrumentationscope](#instrumentationscope) | aggregates | inbound   | many-to-many |
| [Logprocessor](#logprocessor)                 | flows-to   | inbound   | many-to-many |
| [Logrecord](#logrecord)                       | references | inbound   | many-to-many |
| [Metricinstrument](#metricinstrument)         | flows-to   | inbound   | many-to-many |
| [Metricinstrument](#metricinstrument)         | references | inbound   | many-to-one  |
| [Resource](#resource)                         | aggregates | inbound   | many-to-many |
| [Spanlink](#spanlink)                         | aggregates | outbound  | one-to-many  |
| [Metricinstrument](#metricinstrument)         | composes   | outbound  | many-to-many |
| [Spanevent](#spanevent)                       | composes   | outbound  | many-to-many |
| [Traceconfiguration](#traceconfiguration)     | composes   | outbound  | many-to-many |
| [Instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-many |
| [Resource](#resource)                         | depends-on | outbound  | many-to-many |
| [Exporterconfig](#exporterconfig)             | flows-to   | outbound  | many-to-many |
| [Logprocessor](#logprocessor)                 | flows-to   | outbound  | many-to-many |
| [Span](#span)                                 | flows-to   | outbound  | many-to-many |
| [Span](#span)                                 | references | outbound  | many-to-many |
| [Spanlink](#spanlink)                         | references | inbound   | many-to-many |
| [Traceconfiguration](#traceconfiguration)     | aggregates | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | accesses   | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | maps-to    | outbound  | many-to-one |
| [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | monitors   | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | monitors   | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | monitors   | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Database](./08-data-store-layer-report.md#database)                          | [Data Store](./08-data-store-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Navigationflow](./10-navigation-layer-report.md#navigationflow)              | [Navigation](./10-navigation-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Navigationguard](./10-navigation-layer-report.md#navigationguard)            | [Navigation](./10-navigation-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | monitors   | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | monitors   | outbound  | many-to-one |
| [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | monitors   | outbound  | many-to-one |
| [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)          | [Data Model](./07-data-model-layer-report.md)   | references | outbound  | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                 | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Spanevent {#spanevent}

**Spec Node ID**: `apm.spanevent`

Timestamped annotation within a span's lifetime, used to record significant moments such as exceptions (OTel semantic convention: name='exception' with exception.type, exception.message, and exception.stacktrace attributes) or state transitions.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 1

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [Span](#span)                                 | composes   | inbound   | many-to-many |
| [Instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-one  |
| [Resource](#resource)                         | depends-on | outbound  | many-to-one  |
| [Traceconfiguration](#traceconfiguration)     | depends-on | outbound  | many-to-one  |
| [Exporterconfig](#exporterconfig)             | flows-to   | outbound  | many-to-one  |
| [Logrecord](#logrecord)                       | references | outbound  | many-to-one  |
| [Metricinstrument](#metricinstrument)         | triggers   | outbound  | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                               | Layer                         | Predicate | Direction | Cardinality |
| ---------------------------------------------------------- | ----------------------------- | --------- | --------- | ----------- |
| [Actioncomponent](./09-ux-layer-report.md#actioncomponent) | [UX](./09-ux-layer-report.md) | monitors  | outbound  | many-to-one |

[Back to Index](#report-index)

### Spanlink {#spanlink}

**Spec Node ID**: `apm.spanlink`

Non-hierarchical causality link to a span in a different trace or batch context (e.g., async message consumer linking to producer spans). Distinct from parent-child relationships, which are expressed via the parentSpanId attribute on the Span.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node  | Predicate  | Direction | Cardinality  |
| ------------- | ---------- | --------- | ------------ |
| [Span](#span) | aggregates | inbound   | one-to-many  |
| [Span](#span) | references | outbound  | many-to-many |

[Back to Index](#report-index)

### Traceconfiguration {#traceconfiguration}

**Spec Node ID**: `apm.traceconfiguration`

OTel TracerProvider configuration covering sampler selection, context propagation formats, and span processor pipeline. Service identity attributes (serviceName, serviceVersion, deploymentEnvironment) are OTel Resource semantic conventions and belong on the Resource node.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 3
- **Inter-Layer**: Inbound: 3 | Outbound: 10

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [Logconfiguration](#logconfiguration)       | references | inbound   | many-to-one  |
| [Metricconfiguration](#metricconfiguration) | references | inbound   | many-to-one  |
| [Span](#span)                               | composes   | inbound   | many-to-many |
| [Spanevent](#spanevent)                     | depends-on | inbound   | many-to-one  |
| [Exporterconfig](#exporterconfig)           | aggregates | outbound  | many-to-many |
| [Metricinstrument](#metricinstrument)       | aggregates | outbound  | many-to-many |
| [Span](#span)                               | aggregates | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate  | Direction | Cardinality |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Operation](./06-api-layer-report.md#operation)                           | [API](./06-api-layer-report.md)                 | references | inbound   | many-to-one |
| [Database](./08-data-store-layer-report.md#database)                      | [Data Store](./08-data-store-layer-report.md)   | depends-on | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)    | [Technology](./05-technology-layer-report.md)   | depends-on | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | monitors   | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | monitors   | outbound  | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                            | [Navigation](./10-navigation-layer-report.md)   | monitors   | outbound  | many-to-one |
| [Uxapplication](./09-ux-layer-report.md#uxapplication)                    | [UX](./09-ux-layer-report.md)                   | monitors   | outbound  | many-to-one |
| [Operation](./06-api-layer-report.md#operation)                           | [API](./06-api-layer-report.md)                 | references | outbound  | many-to-one |
| [Server](./06-api-layer-report.md#server)                                 | [API](./06-api-layer-report.md)                 | references | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)            | [Security](./03-security-layer-report.md)       | satisfies  | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | references | inbound   | many-to-one |
| [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)       | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |

[Back to Index](#report-index)

---

_Generated: 2026-03-14T21:19:00.190Z | Spec Version: 0.8.3 | Generator: generate-layer-reports.ts_
