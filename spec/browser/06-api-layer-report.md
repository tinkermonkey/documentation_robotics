# API Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Callback](#callback)
  - [Components](#components)
  - [Contact](#contact)
  - [Encoding](#encoding)
  - [Example](#example)
  - [Externaldocumentation](#externaldocumentation)
  - [Header](#header)
  - [Info](#info)
  - [License](#license)
  - [Link node](#link)
  - [Mediatype](#mediatype)
  - [Oauthflow](#oauthflow)
  - [Oauthflows](#oauthflows)
  - [Openapidocument](#openapidocument)
  - [Operation](#operation)
  - [Parameter](#parameter)
  - [Pathitem](#pathitem)
  - [Paths](#paths)
  - [Ratelimit](#ratelimit)
  - [Requestbody](#requestbody)
  - [Response](#response)
  - [Responses](#responses)
  - [Schema](#schema)
  - [Securityscheme](#securityscheme)
  - [Server](#server)
  - [Servervariable](#servervariable)
  - [Tag](#tag)

## Layer Introduction

**Layer 6**: API
**Standard**: [OpenAPI 3.0](https://spec.openapis.org/oas/v3.0.0)

Layer 6: API Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 27    |
| Intra-Layer Relationships | 130   |
| Inter-Layer Relationships | 100   |
| Inbound Relationships     | 47    |
| Outbound Relationships    | 53    |

### Layer Dependencies

**Depends On**: [Data Model](./07-data-model-layer-report.md), [Data Store](./08-data-store-layer-report.md), [UX](./09-ux-layer-report.md), [Navigation](./10-navigation-layer-report.md), [APM](./11-apm-layer-report.md), [Testing](./12-testing-layer-report.md)

**Depended On By**: [Motivation](./01-motivation-layer-report.md), [Business](./02-business-layer-report.md), [Security](./03-security-layer-report.md), [Application](./04-application-layer-report.md), [Technology](./05-technology-layer-report.md), [Data Store](./08-data-store-layer-report.md), [APM](./11-apm-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph api
    callback["callback"]
    components["components"]
    contact["contact"]
    encoding["encoding"]
    example["example"]
    externaldocumentation["externaldocumentation"]
    header["header"]
    info["info"]
    license["license"]
    link["link"]
    mediatype["mediatype"]
    oauthflow["oauthflow"]
    oauthflows["oauthflows"]
    openapidocument["openapidocument"]
    operation["operation"]
    parameter["parameter"]
    pathitem["pathitem"]
    paths["paths"]
    ratelimit["ratelimit"]
    requestbody["requestbody"]
    response["response"]
    responses["responses"]
    schema["schema"]
    securityscheme["securityscheme"]
    server["server"]
    servervariable["servervariable"]
    tag["tag"]
    callback -->|aggregates| pathitem
    components -->|aggregates| callback
    components -->|aggregates| example
    components -->|aggregates| link
    components -->|aggregates| requestbody
    components -->|aggregates| response
    components -->|composes| header
    components -->|composes| parameter
    components -->|composes| paths
    components -->|composes| response
    components -->|composes| responses
    components -->|composes| schema
    components -->|composes| securityscheme
    contact -->|associated-with| openapidocument
    encoding -->|associated-with| mediatype
    encoding -->|associated-with| parameter
    encoding -->|composes| header
    encoding -->|references| header
    encoding -->|references| schema
    example -->|associated-with| operation
    example -->|references| schema
    header -->|associated-with| securityscheme
    header -->|references| example
    header -->|references| schema
    header -->|specializes| parameter
    info -->|aggregates| contact
    info -->|aggregates| license
    info -->|associated-with| openapidocument
    license -->|associated-with| openapidocument
    link -->|references| operation
    link -->|references| schema
    link -->|references| tag
    mediatype -->|aggregates| encoding
    mediatype -->|aggregates| example
    mediatype -->|associated-with| header
    mediatype -->|composes| encoding
    mediatype -->|composes| schema
    mediatype -->|references| example
    mediatype -->|references| schema
    mediatype -->|serves| requestbody
    mediatype -->|serves| response
    oauthflow -->|aggregates| tag
    oauthflow -->|associated-with| oauthflows
    oauthflow -->|associated-with| ratelimit
    oauthflow -->|references| server
    oauthflow -->|serves| operation
    oauthflow -->|serves| securityscheme
    oauthflows -->|aggregates| oauthflow
    oauthflows -->|associated-with| components
    oauthflows -->|associated-with| operation
    oauthflows -->|composes| oauthflow
    oauthflows -->|serves| securityscheme
    openapidocument -->|aggregates| server
    openapidocument -->|aggregates| tag
    openapidocument -->|composes| components
    openapidocument -->|composes| info
    openapidocument -->|composes| paths
    openapidocument -->|composes| responses
    openapidocument -->|composes| schema
    operation -->|aggregates| parameter
    operation -->|aggregates| requestbody
    operation -->|aggregates| server
    operation -->|aggregates| tag
    operation -->|composes| paths
    operation -->|composes| responses
    operation -->|composes| schema
    operation -->|delivers| response
    operation -->|references| operation
    operation -->|references| schema
    operation -->|references| tag
    operation -->|triggers| callback
    operation -->|uses| securityscheme
    parameter -->|references| example
    parameter -->|references| operation
    parameter -->|references| schema
    parameter -->|references| tag
    pathitem -->|aggregates| parameter
    pathitem -->|aggregates| server
    pathitem -->|composes| operation
    pathitem -->|references| externaldocumentation
    pathitem -->|references| pathitem
    paths -->|aggregates| pathitem
    paths -->|aggregates| server
    paths -->|associated-with| ratelimit
    paths -->|composes| pathitem
    paths -->|references| externaldocumentation
    paths -->|references| tag
    paths -->|serves| operation
    ratelimit -->|associated-with| header
    ratelimit -->|associated-with| securityscheme
    ratelimit -->|governs| operation
    ratelimit -->|serves| operation
    ratelimit -->|serves| pathitem
    ratelimit -->|specializes| ratelimit
    ratelimit -->|triggers| response
    requestbody -->|aggregates| example
    requestbody -->|aggregates| mediatype
    requestbody -->|associated-with| encoding
    requestbody -->|composes| mediatype
    requestbody -->|references| schema
    requestbody -->|serves| operation
    response -->|aggregates| header
    response -->|aggregates| mediatype
    response -->|aggregates| schema
    response -->|composes| header
    response -->|composes| link
    response -->|composes| mediatype
    response -->|references| example
    response -->|references| schema
    responses -->|aggregates| header
    responses -->|aggregates| schema
    responses -->|associated-with| ratelimit
    responses -->|composes| response
    responses -->|references| link
    responses -->|references| schema
    schema -->|references| operation
    schema -->|references| schema
    schema -->|references| tag
    schema -->|specializes| schema
    securityscheme -->|composes| oauthflows
    securityscheme -->|serves| operation
    server -->|aggregates| servervariable
    server -->|associated-with| ratelimit
    server -->|references| securityscheme
    server -->|serves| pathitem
    tag -->|aggregates| operation
    tag -->|associated-with| schema
    tag -->|associated-with| securityscheme
    tag -->|references| externaldocumentation
    tag -->|serves| operation
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
  class api current
```

## Inter-Layer Relationships Table

| Relationship ID                                                | Source Node                                                             | Dest Node                                                                     | Dest Layer                                      | Predicate  | Cardinality | Strength |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | ----------- | -------- |
| api.openapidocument.depends-on.technology.technologyservice    | [Openapidocument](./06-api-layer-report.md#openapidocument)             | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| api.openapidocument.realizes.application.applicationservice    | [Openapidocument](./06-api-layer-report.md#openapidocument)             | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | realizes   | many-to-one | medium   |
| api.openapidocument.realizes.business.businessservice          | [Openapidocument](./06-api-layer-report.md#openapidocument)             | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| api.openapidocument.serves.application.applicationcomponent    | [Openapidocument](./06-api-layer-report.md#openapidocument)             | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| api.openapidocument.serves.motivation.stakeholder              | [Openapidocument](./06-api-layer-report.md#openapidocument)             | [Stakeholder](./01-motivation-layer-report.md#stakeholder)                    | [Motivation](./01-motivation-layer-report.md)   | serves     | many-to-one | medium   |
| api.operation.realizes.application.applicationfunction         | [Operation](./06-api-layer-report.md#operation)                         | [Applicationfunction](./04-application-layer-report.md#applicationfunction)   | [Application](./04-application-layer-report.md) | realizes   | many-to-one | medium   |
| api.operation.realizes.business.businessprocess                | [Operation](./06-api-layer-report.md#operation)                         | [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| api.operation.realizes.motivation.goal                         | [Operation](./06-api-layer-report.md#operation)                         | [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | many-to-one | medium   |
| api.operation.realizes.motivation.outcome                      | [Operation](./06-api-layer-report.md#operation)                         | [Outcome](./01-motivation-layer-report.md#outcome)                            | [Motivation](./01-motivation-layer-report.md)   | realizes   | many-to-one | medium   |
| api.operation.references.apm.traceconfiguration                | [Operation](./06-api-layer-report.md#operation)                         | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)             | [APM](./11-apm-layer-report.md)                 | references | many-to-one | medium   |
| api.operation.references.application.applicationservice        | [Operation](./06-api-layer-report.md#operation)                         | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | references | many-to-one | medium   |
| api.operation.references.business.businessinterface            | [Operation](./06-api-layer-report.md#operation)                         | [Businessinterface](./02-business-layer-report.md#businessinterface)          | [Business](./02-business-layer-report.md)       | references | many-to-one | medium   |
| api.operation.references.business.businessservice              | [Operation](./06-api-layer-report.md#operation)                         | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | references | many-to-one | medium   |
| api.operation.references.security.secureresource               | [Operation](./06-api-layer-report.md#operation)                         | [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | many-to-one | medium   |
| api.operation.references.security.threat                       | [Operation](./06-api-layer-report.md#operation)                         | [Threat](./03-security-layer-report.md#threat)                                | [Security](./03-security-layer-report.md)       | references | many-to-one | medium   |
| api.operation.requires.security.permission                     | [Operation](./06-api-layer-report.md#operation)                         | [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| api.operation.requires.security.securitypolicy                 | [Operation](./06-api-layer-report.md#operation)                         | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| api.operation.satisfies.motivation.constraint                  | [Operation](./06-api-layer-report.md#operation)                         | [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| api.operation.satisfies.motivation.requirement                 | [Operation](./06-api-layer-report.md#operation)                         | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| api.operation.satisfies.security.countermeasure                | [Operation](./06-api-layer-report.md#operation)                         | [Countermeasure](./03-security-layer-report.md#countermeasure)                | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| api.operation.serves.business.businessrole                     | [Operation](./06-api-layer-report.md#operation)                         | [Businessrole](./02-business-layer-report.md#businessrole)                    | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| api.operation.triggers.application.applicationevent            | [Operation](./06-api-layer-report.md#operation)                         | [Applicationevent](./04-application-layer-report.md#applicationevent)         | [Application](./04-application-layer-report.md) | triggers   | many-to-one | medium   |
| api.operation.triggers.business.businessprocess                | [Operation](./06-api-layer-report.md#operation)                         | [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | triggers   | many-to-one | medium   |
| api.operation.uses.application.applicationinterface            | [Operation](./06-api-layer-report.md#operation)                         | [Applicationinterface](./04-application-layer-report.md#applicationinterface) | [Application](./04-application-layer-report.md) | uses       | many-to-one | medium   |
| api.operation.uses.technology.technologyservice                | [Operation](./06-api-layer-report.md#operation)                         | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| api.pathitem.depends-on.technology.technologyservice           | [Pathitem](./06-api-layer-report.md#pathitem)                           | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| api.pathitem.realizes.business.businessfunction                | [Pathitem](./06-api-layer-report.md#pathitem)                           | [Businessfunction](./02-business-layer-report.md#businessfunction)            | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| api.pathitem.requires.security.securitypolicy                  | [Pathitem](./06-api-layer-report.md#pathitem)                           | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| api.pathitem.serves.application.applicationcomponent           | [Pathitem](./06-api-layer-report.md#pathitem)                           | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| api.ratelimit.implements.security.countermeasure               | [Ratelimit](./06-api-layer-report.md#ratelimit)                         | [Countermeasure](./03-security-layer-report.md#countermeasure)                | [Security](./03-security-layer-report.md)       | implements | many-to-one | medium   |
| api.ratelimit.satisfies.motivation.constraint                  | [Ratelimit](./06-api-layer-report.md#ratelimit)                         | [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| api.ratelimit.uses.technology.systemsoftware                   | [Ratelimit](./06-api-layer-report.md#ratelimit)                         | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| api.requestbody.maps-to.business.businessobject                | [Requestbody](./06-api-layer-report.md#requestbody)                     | [Businessobject](./02-business-layer-report.md#businessobject)                | [Business](./02-business-layer-report.md)       | maps-to    | many-to-one | medium   |
| api.schema.maps-to.business.businessobject                     | [Schema](./06-api-layer-report.md#schema)                               | [Businessobject](./02-business-layer-report.md#businessobject)                | [Business](./02-business-layer-report.md)       | maps-to    | many-to-one | medium   |
| api.schema.maps-to.data-store.collection                       | [Schema](./06-api-layer-report.md#schema)                               | [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | maps-to    | many-to-one | medium   |
| api.schema.maps-to.data-store.field                            | [Schema](./06-api-layer-report.md#schema)                               | [Field](./08-data-store-layer-report.md#field)                                | [Data Store](./08-data-store-layer-report.md)   | maps-to    | many-to-one | medium   |
| api.securityscheme.implements.security.securitypolicy          | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | implements | many-to-one | medium   |
| api.securityscheme.maps-to.data-store.collection               | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | maps-to    | many-to-one | medium   |
| api.securityscheme.maps-to.security.actor                      | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Actor](./03-security-layer-report.md#actor)                                  | [Security](./03-security-layer-report.md)       | maps-to    | many-to-one | medium   |
| api.securityscheme.references.application.applicationcomponent | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | references | many-to-one | medium   |
| api.securityscheme.references.application.applicationservice   | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | references | many-to-one | medium   |
| api.securityscheme.references.business.businessinterface       | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Businessinterface](./02-business-layer-report.md#businessinterface)          | [Business](./02-business-layer-report.md)       | references | many-to-one | medium   |
| api.securityscheme.references.business.businessservice         | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | references | many-to-one | medium   |
| api.securityscheme.references.security.secureresource          | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | many-to-one | medium   |
| api.securityscheme.requires.security.permission                | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | many-to-one | medium   |
| api.securityscheme.satisfies.motivation.principle              | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Principle](./01-motivation-layer-report.md#principle)                        | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| api.securityscheme.satisfies.motivation.requirement            | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| api.securityscheme.serves.business.businessrole                | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Businessrole](./02-business-layer-report.md#businessrole)                    | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| api.securityscheme.uses.technology.systemsoftware              | [Securityscheme](./06-api-layer-report.md#securityscheme)               | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| api.server.depends-on.technology.node                          | [Server](./06-api-layer-report.md#server)                               | [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| api.server.satisfies.security.securitypolicy                   | [Server](./06-api-layer-report.md#server)                               | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| api.server.serves.application.applicationcomponent             | [Server](./06-api-layer-report.md#server)                               | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| api.server.uses.technology.systemsoftware                      | [Server](./06-api-layer-report.md#server)                               | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| apm.alert.monitors.api.operation                               | [Alert](./11-apm-layer-report.md#alert)                                 | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.alert.monitors.api.ratelimit                               | [Alert](./11-apm-layer-report.md#alert)                                 | [Ratelimit](./06-api-layer-report.md#ratelimit)                               | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.dashboard.monitors.api.operation                           | [Dashboard](./11-apm-layer-report.md#dashboard)                         | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.api.operation                    | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)           | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.metricinstrument.monitors.api.pathitem                     | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)           | [Pathitem](./06-api-layer-report.md#pathitem)                                 | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.span.monitors.api.operation                                | [Span](./11-apm-layer-report.md#span)                                   | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | monitors   | many-to-one | medium   |
| apm.traceconfiguration.references.api.operation                | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)       | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| apm.traceconfiguration.references.api.server                   | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)       | [Server](./06-api-layer-report.md#server)                                     | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| data-model.arrayschema.maps-to.api.response                    | [Arrayschema](./07-data-model-layer-report.md#arrayschema)              | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-model.jsonschema.realizes.api.schema                      | [Jsonschema](./07-data-model-layer-report.md#jsonschema)                | [Schema](./06-api-layer-report.md#schema)                                     | [API](./06-api-layer-report.md)                 | realizes   | many-to-one | medium   |
| data-model.objectschema.maps-to.api.requestbody                | [Objectschema](./07-data-model-layer-report.md#objectschema)            | [Requestbody](./06-api-layer-report.md#requestbody)                           | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-model.objectschema.maps-to.api.response                   | [Objectschema](./07-data-model-layer-report.md#objectschema)            | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-model.reference.maps-to.api.schema                        | [Reference](./07-data-model-layer-report.md#reference)                  | [Schema](./06-api-layer-report.md#schema)                                     | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-model.schemadefinition.maps-to.api.schema                 | [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)    | [Schema](./06-api-layer-report.md#schema)                                     | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-model.schemadefinition.serves.api.operation               | [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)    | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | serves     | many-to-one | medium   |
| data-model.schemaproperty.maps-to.api.parameter                | [Schemaproperty](./07-data-model-layer-report.md#schemaproperty)        | [Parameter](./06-api-layer-report.md#parameter)                               | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-store.accesspattern.maps-to.api.operation                 | [Accesspattern](./08-data-store-layer-report.md#accesspattern)          | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-store.collection.maps-to.api.requestbody                  | [Collection](./08-data-store-layer-report.md#collection)                | [Requestbody](./06-api-layer-report.md#requestbody)                           | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-store.collection.realizes.api.schema                      | [Collection](./08-data-store-layer-report.md#collection)                | [Schema](./06-api-layer-report.md#schema)                                     | [API](./06-api-layer-report.md)                 | realizes   | many-to-one | medium   |
| data-store.collection.serves.api.operation                     | [Collection](./08-data-store-layer-report.md#collection)                | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | serves     | many-to-one | medium   |
| data-store.field.maps-to.api.parameter                         | [Field](./08-data-store-layer-report.md#field)                          | [Parameter](./06-api-layer-report.md#parameter)                               | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| data-store.storedlogic.serves.api.operation                    | [Storedlogic](./08-data-store-layer-report.md#storedlogic)              | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | serves     | many-to-one | medium   |
| data-store.view.realizes.api.response                          | [View](./08-data-store-layer-report.md#view)                            | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | realizes   | many-to-one | medium   |
| navigation.contextvariable.maps-to.api.parameter               | [Contextvariable](./10-navigation-layer-report.md#contextvariable)      | [Parameter](./06-api-layer-report.md#parameter)                               | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| navigation.flowstep.accesses.api.operation                     | [Flowstep](./10-navigation-layer-report.md#flowstep)                    | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | accesses   | many-to-one | medium   |
| navigation.navigationguard.accesses.api.operation              | [Navigationguard](./10-navigation-layer-report.md#navigationguard)      | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | accesses   | many-to-one | medium   |
| navigation.navigationguard.uses.api.securityscheme             | [Navigationguard](./10-navigation-layer-report.md#navigationguard)      | [Securityscheme](./06-api-layer-report.md#securityscheme)                     | [API](./06-api-layer-report.md)                 | uses       | many-to-one | medium   |
| navigation.route.accesses.api.operation                        | [Route](./10-navigation-layer-report.md#route)                          | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | accesses   | many-to-one | medium   |
| navigation.route.maps-to.api.pathitem                          | [Route](./10-navigation-layer-report.md#route)                          | [Pathitem](./06-api-layer-report.md#pathitem)                                 | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| navigation.route.requires.api.securityscheme                   | [Route](./10-navigation-layer-report.md#route)                          | [Securityscheme](./06-api-layer-report.md#securityscheme)                     | [API](./06-api-layer-report.md)                 | requires   | many-to-one | medium   |
| navigation.routemeta.references.api.operation                  | [Routemeta](./10-navigation-layer-report.md#routemeta)                  | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| testing.coveragerequirement.references.api.operation           | [Coveragerequirement](./12-testing-layer-report.md#coveragerequirement) | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| testing.inputspacepartition.references.api.parameter           | [Inputspacepartition](./12-testing-layer-report.md#inputspacepartition) | [Parameter](./06-api-layer-report.md#parameter)                               | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| testing.targetinputfield.references.api.parameter              | [Targetinputfield](./12-testing-layer-report.md#targetinputfield)       | [Parameter](./06-api-layer-report.md#parameter)                               | [API](./06-api-layer-report.md)                 | references | many-to-one | medium   |
| testing.testcasesketch.accesses.api.requestbody                | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)           | [Requestbody](./06-api-layer-report.md#requestbody)                           | [API](./06-api-layer-report.md)                 | accesses   | many-to-one | medium   |
| testing.testcasesketch.tests.api.operation                     | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)           | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | tests      | many-to-one | medium   |
| testing.testcasesketch.validates.api.response                  | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)           | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | validates  | many-to-one | medium   |
| testing.testcoveragemodel.covers.api.openapidocument           | [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)     | [Openapidocument](./06-api-layer-report.md#openapidocument)                   | [API](./06-api-layer-report.md)                 | covers     | many-to-one | medium   |
| testing.testcoveragetarget.tests.api.operation                 | [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)   | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | tests      | many-to-one | medium   |
| ux.actioncomponent.triggers.api.operation                      | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)              | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | triggers   | many-to-one | medium   |
| ux.dataconfig.maps-to.api.requestbody                          | [Dataconfig](./09-ux-layer-report.md#dataconfig)                        | [Requestbody](./06-api-layer-report.md#requestbody)                           | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.dataconfig.maps-to.api.response                             | [Dataconfig](./09-ux-layer-report.md#dataconfig)                        | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.dataconfig.maps-to.api.schema                               | [Dataconfig](./09-ux-layer-report.md#dataconfig)                        | [Schema](./06-api-layer-report.md#schema)                                     | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.errorconfig.maps-to.api.response                            | [Errorconfig](./09-ux-layer-report.md#errorconfig)                      | [Response](./06-api-layer-report.md#response)                                 | [API](./06-api-layer-report.md)                 | maps-to    | many-to-one | medium   |
| ux.stateaction.triggers.api.operation                          | [Stateaction](./09-ux-layer-report.md#stateaction)                      | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | triggers   | many-to-one | medium   |
| ux.view.accesses.api.operation                                 | [View](./09-ux-layer-report.md#view)                                    | [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | accesses   | many-to-one | medium   |
| ux.view.uses.api.securityscheme                                | [View](./09-ux-layer-report.md#view)                                    | [Securityscheme](./06-api-layer-report.md#securityscheme)                     | [API](./06-api-layer-report.md)                 | uses       | many-to-one | medium   |

## Node Reference

### Callback {#callback}

**Spec Node ID**: `api.callback`

Defines a callback where the API sends asynchronous notifications to an external URL derived at runtime. A callback maps a Runtime Expression (e.g., $request.body#/callbackUrl) to a full PathItem object, meaning the callback specifies the complete HTTP interaction — method, headers, and expected response — not just a target URL. Enables event-driven integrations and async workflows.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node              | Predicate  | Direction | Cardinality  |
| ------------------------- | ---------- | --------- | ------------ |
| [Pathitem](#pathitem)     | aggregates | outbound  | many-to-one  |
| [Components](#components) | aggregates | inbound   | many-to-many |
| [Operation](#operation)   | triggers   | inbound   | many-to-many |

[Back to Index](#report-index)

### Components {#components}

**Spec Node ID**: `api.components`

A named registry for reusable API definition objects (schemas, responses, parameters, examples, requestBodies, headers, securitySchemes, links, callbacks) that enables $ref referencing throughout the specification. Component entries are not rendered directly — they must be referenced by operations, parameters, or schemas to take effect. Component name keys must match the pattern ^[a-zA-Z0-9.\-_]+$ per OpenAPI 3.0 — arbitrary strings are not valid component identifiers.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 12
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [Callback](#callback)               | aggregates      | outbound  | many-to-many |
| [Example](#example)                 | aggregates      | outbound  | many-to-one  |
| [Link node](#link)                  | aggregates      | outbound  | many-to-many |
| [Requestbody](#requestbody)         | aggregates      | outbound  | many-to-many |
| [Response](#response)               | aggregates      | outbound  | many-to-one  |
| [Header](#header)                   | composes        | outbound  | many-to-one  |
| [Parameter](#parameter)             | composes        | outbound  | many-to-one  |
| [Paths](#paths)                     | composes        | outbound  | many-to-many |
| [Response](#response)               | composes        | outbound  | many-to-one  |
| [Responses](#responses)             | composes        | outbound  | many-to-many |
| [Schema](#schema)                   | composes        | outbound  | many-to-many |
| [Securityscheme](#securityscheme)   | composes        | outbound  | many-to-one  |
| [Oauthflows](#oauthflows)           | associated-with | inbound   | many-to-one  |
| [Openapidocument](#openapidocument) | composes        | inbound   | many-to-one  |

[Back to Index](#report-index)

### Contact {#contact}

**Spec Node ID**: `api.contact`

Contact information for the API owner or maintainer, including name, email, and URL. Enables consumers to reach out for support or collaboration.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [Openapidocument](#openapidocument) | associated-with | outbound  | many-to-many |
| [Info](#info)                       | aggregates      | inbound   | many-to-one  |

[Back to Index](#report-index)

### Encoding {#encoding}

**Spec Node ID**: `api.encoding`

Specifies serialization details for multipart request body properties, including content-type, headers, and encoding style. Handles complex content negotiation. Note: a Content-Type header placed in the Encoding object's 'headers' map is ignored — use the 'contentType' attribute to set the MIME type for a multipart section.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                | Predicate       | Direction | Cardinality |
| --------------------------- | --------------- | --------- | ----------- |
| [Mediatype](#mediatype)     | associated-with | outbound  | many-to-one |
| [Parameter](#parameter)     | associated-with | outbound  | many-to-one |
| [Header](#header)           | composes        | outbound  | many-to-one |
| [Header](#header)           | references      | outbound  | many-to-one |
| [Schema](#schema)           | references      | outbound  | many-to-one |
| [Mediatype](#mediatype)     | aggregates      | inbound   | many-to-one |
| [Mediatype](#mediatype)     | composes        | inbound   | many-to-one |
| [Requestbody](#requestbody) | associated-with | inbound   | many-to-one |

[Back to Index](#report-index)

### Example {#example}

**Spec Node ID**: `api.example`

Provides sample values for request bodies, responses, or parameters. Improves documentation clarity and enables automated testing or mocking.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 7 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                | Predicate       | Direction | Cardinality |
| --------------------------- | --------------- | --------- | ----------- |
| [Components](#components)   | aggregates      | inbound   | many-to-one |
| [Operation](#operation)     | associated-with | outbound  | many-to-one |
| [Schema](#schema)           | references      | outbound  | many-to-one |
| [Header](#header)           | references      | inbound   | many-to-one |
| [Mediatype](#mediatype)     | aggregates      | inbound   | many-to-one |
| [Mediatype](#mediatype)     | references      | inbound   | many-to-one |
| [Parameter](#parameter)     | references      | inbound   | many-to-one |
| [Requestbody](#requestbody) | aggregates      | inbound   | many-to-one |
| [Response](#response)       | references      | inbound   | many-to-one |

[Back to Index](#report-index)

### Externaldocumentation {#externaldocumentation}

**Spec Node ID**: `api.externaldocumentation`

A reference to external documentation resources (URLs, wikis, guides) that provide additional context beyond the inline API specification. Can be attached to the root OpenAPI document, individual Tags, Operations, and Schema objects.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node          | Predicate  | Direction | Cardinality |
| --------------------- | ---------- | --------- | ----------- |
| [Pathitem](#pathitem) | references | inbound   | many-to-one |
| [Paths](#paths)       | references | inbound   | many-to-one |
| [Tag](#tag)           | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Header {#header}

**Spec Node ID**: `api.header`

Defines a reusable HTTP header for responses or request components. The header name is derived from its map key — the OpenAPI 3.0 Header Object does not include a 'name' field (use the 'name' attribute as a local identifier only). The 'in' location is implicitly 'header' and must not be specified, distinguishing Header from Parameter.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate       | Direction | Cardinality |
| --------------------------------- | --------------- | --------- | ----------- |
| [Components](#components)         | composes        | inbound   | many-to-one |
| [Encoding](#encoding)             | composes        | inbound   | many-to-one |
| [Encoding](#encoding)             | references      | inbound   | many-to-one |
| [Securityscheme](#securityscheme) | associated-with | outbound  | many-to-one |
| [Example](#example)               | references      | outbound  | many-to-one |
| [Schema](#schema)                 | references      | outbound  | many-to-one |
| [Parameter](#parameter)           | specializes     | outbound  | many-to-one |
| [Mediatype](#mediatype)           | associated-with | inbound   | many-to-one |
| [Ratelimit](#ratelimit)           | associated-with | inbound   | many-to-one |
| [Response](#response)             | aggregates      | inbound   | many-to-one |
| [Response](#response)             | composes        | inbound   | many-to-one |
| [Responses](#responses)           | aggregates      | inbound   | many-to-one |

[Back to Index](#report-index)

### Info {#info}

**Spec Node ID**: `api.info`

Required root-level metadata describing the API identity, version, legal terms, and maintainer contact. The 'title' and 'version' fields are required per OpenAPI 3.0. Consumed by documentation generators, API gateways, and developer portals.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality |
| ----------------------------------- | --------------- | --------- | ----------- |
| [Contact](#contact)                 | aggregates      | outbound  | many-to-one |
| [License](#license)                 | aggregates      | outbound  | many-to-one |
| [Openapidocument](#openapidocument) | associated-with | outbound  | many-to-one |
| [Openapidocument](#openapidocument) | composes        | inbound   | many-to-one |

[Back to Index](#report-index)

### License {#license}

**Spec Node ID**: `api.license`

Specifies the legal license under which the API is provided, including license name and URL to full terms. Clarifies usage rights for API consumers.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [Info](#info)                       | aggregates      | inbound   | many-to-one  |
| [Openapidocument](#openapidocument) | associated-with | outbound  | many-to-many |

[Back to Index](#report-index)

### Link {#link}

**Spec Node ID**: `api.link`

Describes a relationship between API responses and subsequent operations, enabling hypermedia-driven API navigation. Supports HATEOAS design patterns.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node              | Predicate  | Direction | Cardinality  |
| ------------------------- | ---------- | --------- | ------------ |
| [Components](#components) | aggregates | inbound   | many-to-many |
| [Operation](#operation)   | references | outbound  | many-to-many |
| [Schema](#schema)         | references | outbound  | many-to-many |
| [Tag](#tag)               | references | outbound  | many-to-many |
| [Response](#response)     | composes   | inbound   | many-to-one  |
| [Responses](#responses)   | references | inbound   | many-to-one  |

[Back to Index](#report-index)

### Mediatype {#mediatype}

**Spec Node ID**: `api.mediatype`

Describes the schema, examples, and encoding for a specific MIME type within a request body or response content map. Keyed by media type string (e.g., application/json).

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 9
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                | Predicate       | Direction | Cardinality |
| --------------------------- | --------------- | --------- | ----------- |
| [Encoding](#encoding)       | associated-with | inbound   | many-to-one |
| [Encoding](#encoding)       | aggregates      | outbound  | many-to-one |
| [Example](#example)         | aggregates      | outbound  | many-to-one |
| [Header](#header)           | associated-with | outbound  | many-to-one |
| [Encoding](#encoding)       | composes        | outbound  | many-to-one |
| [Schema](#schema)           | composes        | outbound  | many-to-one |
| [Example](#example)         | references      | outbound  | many-to-one |
| [Schema](#schema)           | references      | outbound  | many-to-one |
| [Requestbody](#requestbody) | serves          | outbound  | many-to-one |
| [Response](#response)       | serves          | outbound  | many-to-one |
| [Requestbody](#requestbody) | aggregates      | inbound   | many-to-one |
| [Requestbody](#requestbody) | composes        | inbound   | many-to-one |
| [Response](#response)       | aggregates      | inbound   | many-to-one |
| [Response](#response)       | composes        | inbound   | many-to-one |

[Back to Index](#report-index)

### Oauthflow {#oauthflow}

**Spec Node ID**: `api.oauthflow`

Configuration for a single OAuth 2.0 grant type (implicit, password, clientCredentials, or authorizationCode). authorizationUrl is required for implicit and authorizationCode flows; tokenUrl is required for password, clientCredentials, and authorizationCode flows; scopes is required for all flows. The flow type is not an explicit field — it is implied by which attribute of the parent OAuthFlows object references this OAuthFlow.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate       | Direction | Cardinality |
| --------------------------------- | --------------- | --------- | ----------- |
| [Tag](#tag)                       | aggregates      | outbound  | many-to-one |
| [Oauthflows](#oauthflows)         | associated-with | outbound  | many-to-one |
| [Ratelimit](#ratelimit)           | associated-with | outbound  | many-to-one |
| [Server](#server)                 | references      | outbound  | many-to-one |
| [Operation](#operation)           | serves          | outbound  | many-to-one |
| [Securityscheme](#securityscheme) | serves          | outbound  | many-to-one |
| [Oauthflows](#oauthflows)         | aggregates      | inbound   | many-to-one |
| [Oauthflows](#oauthflows)         | composes        | inbound   | many-to-one |

[Back to Index](#report-index)

### Oauthflows {#oauthflows}

**Spec Node ID**: `api.oauthflows`

Configuration for OAuth 2.0 authentication flows (implicit, password, clientCredentials, authorizationCode), specifying authorization URLs, token URLs, and scopes. At least one flow attribute must be specified. Always nested within a SecurityScheme where type is 'oauth2' — cannot be used independently.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                      | Predicate       | Direction | Cardinality |
| --------------------------------- | --------------- | --------- | ----------- |
| [Oauthflow](#oauthflow)           | associated-with | inbound   | many-to-one |
| [Oauthflow](#oauthflow)           | aggregates      | outbound  | many-to-one |
| [Components](#components)         | associated-with | outbound  | many-to-one |
| [Operation](#operation)           | associated-with | outbound  | many-to-one |
| [Oauthflow](#oauthflow)           | composes        | outbound  | many-to-one |
| [Securityscheme](#securityscheme) | serves          | outbound  | many-to-one |
| [Securityscheme](#securityscheme) | composes        | inbound   | one-to-one  |

[Back to Index](#report-index)

### Openapidocument {#openapidocument}

**Spec Node ID**: `api.openapidocument`

The root document object of an OpenAPI 3.0 specification. Required fields are openapi (semver string, e.g. '3.0.3'), info, and paths. Serves as the entry point for all tooling, gateways, and documentation generators.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 7
- **Inter-Layer**: Inbound: 1 | Outbound: 5

#### Intra-Layer Relationships

| Related Node              | Predicate       | Direction | Cardinality  |
| ------------------------- | --------------- | --------- | ------------ |
| [Contact](#contact)       | associated-with | inbound   | many-to-many |
| [Info](#info)             | associated-with | inbound   | many-to-one  |
| [License](#license)       | associated-with | inbound   | many-to-many |
| [Server](#server)         | aggregates      | outbound  | many-to-many |
| [Tag](#tag)               | aggregates      | outbound  | many-to-many |
| [Components](#components) | composes        | outbound  | many-to-one  |
| [Info](#info)             | composes        | outbound  | many-to-one  |
| [Paths](#paths)           | composes        | outbound  | many-to-many |
| [Responses](#responses)   | composes        | outbound  | many-to-many |
| [Schema](#schema)         | composes        | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | realizes   | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Stakeholder](./01-motivation-layer-report.md#stakeholder)                    | [Motivation](./01-motivation-layer-report.md)   | serves     | outbound  | many-to-one |
| [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)           | [Testing](./12-testing-layer-report.md)         | covers     | inbound   | many-to-one |

[Back to Index](#report-index)

### Operation {#operation}

**Spec Node ID**: `api.operation`

Defines a single HTTP method bound to a path, specifying its contract: parameters, request body, possible responses, security requirements, and tags. Operation-level security overrides global API security requirements; an empty security array ([]) explicitly removes all security enforcement for the operation. The primary unit of API surface area in OpenAPI 3.0.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 15 | Outbound: 13
- **Inter-Layer**: Inbound: 19 | Outbound: 20

#### Intra-Layer Relationships

| Related Node                      | Predicate       | Direction | Cardinality  |
| --------------------------------- | --------------- | --------- | ------------ |
| [Example](#example)               | associated-with | inbound   | many-to-one  |
| [Link node](#link)                | references      | inbound   | many-to-many |
| [Oauthflow](#oauthflow)           | serves          | inbound   | many-to-one  |
| [Oauthflows](#oauthflows)         | associated-with | inbound   | many-to-one  |
| [Parameter](#parameter)           | aggregates      | outbound  | many-to-one  |
| [Requestbody](#requestbody)       | aggregates      | outbound  | many-to-one  |
| [Server](#server)                 | aggregates      | outbound  | many-to-many |
| [Tag](#tag)                       | aggregates      | outbound  | many-to-many |
| [Paths](#paths)                   | composes        | outbound  | many-to-many |
| [Responses](#responses)           | composes        | outbound  | many-to-many |
| [Schema](#schema)                 | composes        | outbound  | many-to-many |
| [Response](#response)             | delivers        | outbound  | many-to-one  |
| [Operation](#operation)           | references      | outbound  | many-to-many |
| [Schema](#schema)                 | references      | outbound  | many-to-many |
| [Tag](#tag)                       | references      | outbound  | many-to-many |
| [Callback](#callback)             | triggers        | outbound  | many-to-many |
| [Securityscheme](#securityscheme) | uses            | outbound  | many-to-one  |
| [Parameter](#parameter)           | references      | inbound   | many-to-many |
| [Pathitem](#pathitem)             | composes        | inbound   | many-to-one  |
| [Paths](#paths)                   | serves          | inbound   | many-to-one  |
| [Ratelimit](#ratelimit)           | governs         | inbound   | many-to-one  |
| [Ratelimit](#ratelimit)           | serves          | inbound   | many-to-one  |
| [Requestbody](#requestbody)       | serves          | inbound   | many-to-one  |
| [Schema](#schema)                 | references      | inbound   | many-to-many |
| [Securityscheme](#securityscheme) | serves          | inbound   | many-to-many |
| [Tag](#tag)                       | aggregates      | inbound   | many-to-one  |
| [Tag](#tag)                       | serves          | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Applicationfunction](./04-application-layer-report.md#applicationfunction)   | [Application](./04-application-layer-report.md) | realizes   | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | outbound  | many-to-one |
| [Outcome](./01-motivation-layer-report.md#outcome)                            | [Motivation](./01-motivation-layer-report.md)   | realizes   | outbound  | many-to-one |
| [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)             | [APM](./11-apm-layer-report.md)                 | references | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | references | outbound  | many-to-one |
| [Businessinterface](./02-business-layer-report.md#businessinterface)          | [Business](./02-business-layer-report.md)       | references | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | references | outbound  | many-to-one |
| [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | outbound  | many-to-one |
| [Threat](./03-security-layer-report.md#threat)                                | [Security](./03-security-layer-report.md)       | references | outbound  | many-to-one |
| [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Countermeasure](./03-security-layer-report.md#countermeasure)                | [Security](./03-security-layer-report.md)       | satisfies  | outbound  | many-to-one |
| [Businessrole](./02-business-layer-report.md#businessrole)                    | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Applicationevent](./04-application-layer-report.md#applicationevent)         | [Application](./04-application-layer-report.md) | triggers   | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | triggers   | outbound  | many-to-one |
| [Applicationinterface](./04-application-layer-report.md#applicationinterface) | [Application](./04-application-layer-report.md) | uses       | outbound  | many-to-one |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | outbound  | many-to-one |
| [Alert](./11-apm-layer-report.md#alert)                                       | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Dashboard](./11-apm-layer-report.md#dashboard)                               | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                 | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Span](./11-apm-layer-report.md#span)                                         | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)             | [APM](./11-apm-layer-report.md)                 | references | inbound   | many-to-one |
| [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)          | [Data Model](./07-data-model-layer-report.md)   | serves     | inbound   | many-to-one |
| [Accesspattern](./08-data-store-layer-report.md#accesspattern)                | [Data Store](./08-data-store-layer-report.md)   | maps-to    | inbound   | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | serves     | inbound   | many-to-one |
| [Storedlogic](./08-data-store-layer-report.md#storedlogic)                    | [Data Store](./08-data-store-layer-report.md)   | serves     | inbound   | many-to-one |
| [Flowstep](./10-navigation-layer-report.md#flowstep)                          | [Navigation](./10-navigation-layer-report.md)   | accesses   | inbound   | many-to-one |
| [Navigationguard](./10-navigation-layer-report.md#navigationguard)            | [Navigation](./10-navigation-layer-report.md)   | accesses   | inbound   | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | accesses   | inbound   | many-to-one |
| [Routemeta](./10-navigation-layer-report.md#routemeta)                        | [Navigation](./10-navigation-layer-report.md)   | references | inbound   | many-to-one |
| [Coveragerequirement](./12-testing-layer-report.md#coveragerequirement)       | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                 | [Testing](./12-testing-layer-report.md)         | tests      | inbound   | many-to-one |
| [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)         | [Testing](./12-testing-layer-report.md)         | tests      | inbound   | many-to-one |
| [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                    | [UX](./09-ux-layer-report.md)                   | triggers   | inbound   | many-to-one |
| [Stateaction](./09-ux-layer-report.md#stateaction)                            | [UX](./09-ux-layer-report.md)                   | triggers   | inbound   | many-to-one |
| [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | accesses   | inbound   | many-to-one |

[Back to Index](#report-index)

### Parameter {#parameter}

**Spec Node ID**: `api.parameter`

Defines an input to an API operation by location, name, and schema. Parameters can appear in four locations: 'path' (always required, name must match the {placeholder} in the path template), 'query' (case-sensitive name, appended to the URL), 'header' (case-insensitive name), and 'cookie'. The 'schema' and 'content' attributes are mutually exclusive; 'content' requires exactly one map entry.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 4
- **Inter-Layer**: Inbound: 5 | Outbound: 0

#### Intra-Layer Relationships

| Related Node              | Predicate       | Direction | Cardinality  |
| ------------------------- | --------------- | --------- | ------------ |
| [Components](#components) | composes        | inbound   | many-to-one  |
| [Encoding](#encoding)     | associated-with | inbound   | many-to-one  |
| [Header](#header)         | specializes     | inbound   | many-to-one  |
| [Operation](#operation)   | aggregates      | inbound   | many-to-one  |
| [Example](#example)       | references      | outbound  | many-to-one  |
| [Operation](#operation)   | references      | outbound  | many-to-many |
| [Schema](#schema)         | references      | outbound  | many-to-many |
| [Tag](#tag)               | references      | outbound  | many-to-many |
| [Pathitem](#pathitem)     | aggregates      | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                            | Layer                                         | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Schemaproperty](./07-data-model-layer-report.md#schemaproperty)        | [Data Model](./07-data-model-layer-report.md) | maps-to    | inbound   | many-to-one |
| [Field](./08-data-store-layer-report.md#field)                          | [Data Store](./08-data-store-layer-report.md) | maps-to    | inbound   | many-to-one |
| [Contextvariable](./10-navigation-layer-report.md#contextvariable)      | [Navigation](./10-navigation-layer-report.md) | maps-to    | inbound   | many-to-one |
| [Inputspacepartition](./12-testing-layer-report.md#inputspacepartition) | [Testing](./12-testing-layer-report.md)       | references | inbound   | many-to-one |
| [Targetinputfield](./12-testing-layer-report.md#targetinputfield)       | [Testing](./12-testing-layer-report.md)       | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Pathitem {#pathitem}

**Spec Node ID**: `api.pathitem`

Groups all HTTP operations available under a single URL path pattern (e.g., /users/{userId}). Path-level parameters apply to all operations under the path and can be overridden by matching name+in at the operation level, but cannot be removed. Individual HTTP methods are represented as operation references. Supports $ref at the PathItem level, enabling shared path definitions to be reused across multiple OpenAPI specifications.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 5
- **Inter-Layer**: Inbound: 2 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                                    | Predicate  | Direction | Cardinality |
| ----------------------------------------------- | ---------- | --------- | ----------- |
| [Callback](#callback)                           | aggregates | inbound   | many-to-one |
| [Parameter](#parameter)                         | aggregates | outbound  | many-to-one |
| [Server](#server)                               | aggregates | outbound  | many-to-one |
| [Operation](#operation)                         | composes   | outbound  | many-to-one |
| [Externaldocumentation](#externaldocumentation) | references | outbound  | many-to-one |
| [Pathitem](#pathitem)                           | references | outbound  | many-to-one |
| [Paths](#paths)                                 | aggregates | inbound   | many-to-one |
| [Paths](#paths)                                 | composes   | inbound   | many-to-one |
| [Ratelimit](#ratelimit)                         | serves     | inbound   | many-to-one |
| [Server](#server)                               | serves     | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | outbound  | many-to-one |
| [Businessfunction](./02-business-layer-report.md#businessfunction)            | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                 | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | maps-to    | inbound   | many-to-one |

[Back to Index](#report-index)

### Paths {#paths}

**Spec Node ID**: `api.paths`

A map of URL path patterns to PathItem objects defining the API surface. Path keys use OpenAPI path templating (e.g., /users/{id}) and must begin with '/'. Individual path entries are modeled as relationships to api.pathitem nodes.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 7
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate       | Direction | Cardinality  |
| ----------------------------------------------- | --------------- | --------- | ------------ |
| [Components](#components)                       | composes        | inbound   | many-to-many |
| [Openapidocument](#openapidocument)             | composes        | inbound   | many-to-many |
| [Operation](#operation)                         | composes        | inbound   | many-to-many |
| [Pathitem](#pathitem)                           | aggregates      | outbound  | many-to-one  |
| [Server](#server)                               | aggregates      | outbound  | many-to-one  |
| [Ratelimit](#ratelimit)                         | associated-with | outbound  | many-to-one  |
| [Pathitem](#pathitem)                           | composes        | outbound  | many-to-one  |
| [Externaldocumentation](#externaldocumentation) | references      | outbound  | many-to-one  |
| [Tag](#tag)                                     | references      | outbound  | many-to-one  |
| [Operation](#operation)                         | serves          | outbound  | many-to-one  |

[Back to Index](#report-index)

### Ratelimit {#ratelimit}

**Spec Node ID**: `api.ratelimit`

Defines throttling constraints for API or service access, specifying maximum request counts, time windows, and actions to take when limits are exceeded. Protects resources from abuse and ensures fair usage across consumers.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 7
- **Inter-Layer**: Inbound: 1 | Outbound: 3

#### Intra-Layer Relationships

| Related Node                      | Predicate       | Direction | Cardinality |
| --------------------------------- | --------------- | --------- | ----------- |
| [Oauthflow](#oauthflow)           | associated-with | inbound   | many-to-one |
| [Paths](#paths)                   | associated-with | inbound   | many-to-one |
| [Header](#header)                 | associated-with | outbound  | many-to-one |
| [Securityscheme](#securityscheme) | associated-with | outbound  | many-to-one |
| [Operation](#operation)           | governs         | outbound  | many-to-one |
| [Operation](#operation)           | serves          | outbound  | many-to-one |
| [Pathitem](#pathitem)             | serves          | outbound  | many-to-one |
| [Ratelimit](#ratelimit)           | specializes     | outbound  | many-to-one |
| [Response](#response)             | triggers        | outbound  | many-to-one |
| [Responses](#responses)           | associated-with | inbound   | many-to-one |
| [Server](#server)                 | associated-with | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                     | Layer                                         | Predicate  | Direction | Cardinality |
| ---------------------------------------------------------------- | --------------------------------------------- | ---------- | --------- | ----------- |
| [Countermeasure](./03-security-layer-report.md#countermeasure)   | [Security](./03-security-layer-report.md)     | implements | outbound  | many-to-one |
| [Constraint](./01-motivation-layer-report.md#constraint)         | [Motivation](./01-motivation-layer-report.md) | satisfies  | outbound  | many-to-one |
| [Systemsoftware](./05-technology-layer-report.md#systemsoftware) | [Technology](./05-technology-layer-report.md) | uses       | outbound  | many-to-one |
| [Alert](./11-apm-layer-report.md#alert)                          | [APM](./11-apm-layer-report.md)               | monitors   | inbound   | many-to-one |

[Back to Index](#report-index)

### Requestbody {#requestbody}

**Spec Node ID**: `api.requestbody`

Defines the request body for an operation as a map of MIME types to MediaType objects. The 'content' field is required and must contain at least one entry per OpenAPI 3.0. The 'required' field defaults to false. Can be placed in api.components requestBodies and referenced via $ref for reuse across multiple operations.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 6
- **Inter-Layer**: Inbound: 4 | Outbound: 1

#### Intra-Layer Relationships

| Related Node              | Predicate       | Direction | Cardinality  |
| ------------------------- | --------------- | --------- | ------------ |
| [Components](#components) | aggregates      | inbound   | many-to-many |
| [Mediatype](#mediatype)   | serves          | inbound   | many-to-one  |
| [Operation](#operation)   | aggregates      | inbound   | many-to-one  |
| [Example](#example)       | aggregates      | outbound  | many-to-one  |
| [Mediatype](#mediatype)   | aggregates      | outbound  | many-to-one  |
| [Encoding](#encoding)     | associated-with | outbound  | many-to-one  |
| [Mediatype](#mediatype)   | composes        | outbound  | many-to-one  |
| [Schema](#schema)         | references      | outbound  | many-to-one  |
| [Operation](#operation)   | serves          | outbound  | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                   | Layer                                         | Predicate | Direction | Cardinality |
| -------------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Businessobject](./02-business-layer-report.md#businessobject) | [Business](./02-business-layer-report.md)     | maps-to   | outbound  | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)   | [Data Model](./07-data-model-layer-report.md) | maps-to   | inbound   | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)       | [Data Store](./08-data-store-layer-report.md) | maps-to   | inbound   | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)  | [Testing](./12-testing-layer-report.md)       | accesses  | inbound   | many-to-one |
| [Dataconfig](./09-ux-layer-report.md#dataconfig)               | [UX](./09-ux-layer-report.md)                 | maps-to   | inbound   | many-to-one |

[Back to Index](#report-index)

### Response {#response}

**Spec Node ID**: `api.response`

Defines a single HTTP response returned by an operation, including its description, body content (keyed by MIME type), response headers, and optional hypermedia links. The 'content' field may be omitted entirely for responses with no body (e.g., 204 No Content). Header map keys are case-insensitive per the HTTP specification.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 8
- **Inter-Layer**: Inbound: 6 | Outbound: 0

#### Intra-Layer Relationships

| Related Node              | Predicate  | Direction | Cardinality |
| ------------------------- | ---------- | --------- | ----------- |
| [Components](#components) | aggregates | inbound   | many-to-one |
| [Components](#components) | composes   | inbound   | many-to-one |
| [Mediatype](#mediatype)   | serves     | inbound   | many-to-one |
| [Operation](#operation)   | delivers   | inbound   | many-to-one |
| [Ratelimit](#ratelimit)   | triggers   | inbound   | many-to-one |
| [Header](#header)         | aggregates | outbound  | many-to-one |
| [Mediatype](#mediatype)   | aggregates | outbound  | many-to-one |
| [Schema](#schema)         | aggregates | outbound  | many-to-one |
| [Header](#header)         | composes   | outbound  | many-to-one |
| [Link node](#link)        | composes   | outbound  | many-to-one |
| [Mediatype](#mediatype)   | composes   | outbound  | many-to-one |
| [Example](#example)       | references | outbound  | many-to-one |
| [Schema](#schema)         | references | outbound  | many-to-one |
| [Responses](#responses)   | composes   | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                  | Layer                                         | Predicate | Direction | Cardinality |
| ------------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Arrayschema](./07-data-model-layer-report.md#arrayschema)    | [Data Model](./07-data-model-layer-report.md) | maps-to   | inbound   | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)  | [Data Model](./07-data-model-layer-report.md) | maps-to   | inbound   | many-to-one |
| [View](./08-data-store-layer-report.md#view)                  | [Data Store](./08-data-store-layer-report.md) | realizes  | inbound   | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch) | [Testing](./12-testing-layer-report.md)       | validates | inbound   | many-to-one |
| [Dataconfig](./09-ux-layer-report.md#dataconfig)              | [UX](./09-ux-layer-report.md)                 | maps-to   | inbound   | many-to-one |
| [Errorconfig](./09-ux-layer-report.md#errorconfig)            | [UX](./09-ux-layer-report.md)                 | maps-to   | inbound   | many-to-one |

[Back to Index](#report-index)

### Responses {#responses}

**Spec Node ID**: `api.responses`

A map of HTTP status codes (e.g., 200, 404, default) to Response objects describing each possible outcome of an operation. At least one response must be defined per OpenAPI 3.0. Status code ranges (e.g., 2XX) are not supported — only specific numeric codes and 'default' are valid keys.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [Components](#components)           | composes        | inbound   | many-to-many |
| [Openapidocument](#openapidocument) | composes        | inbound   | many-to-many |
| [Operation](#operation)             | composes        | inbound   | many-to-many |
| [Header](#header)                   | aggregates      | outbound  | many-to-one  |
| [Schema](#schema)                   | aggregates      | outbound  | many-to-one  |
| [Ratelimit](#ratelimit)             | associated-with | outbound  | many-to-one  |
| [Response](#response)               | composes        | outbound  | many-to-one  |
| [Link node](#link)                  | references      | outbound  | many-to-one  |
| [Schema](#schema)                   | references      | outbound  | many-to-one  |

[Back to Index](#report-index)

### Schema {#schema}

**Spec Node ID**: `api.schema`

Inline data type definition using a subset of JSON Schema Draft 7, used within API operations to describe request/response data shapes. For reusable canonical types, reference data-model layer entities instead. OpenAPI 3.0 restriction: a '$ref' within a Schema ignores all sibling keywords — unlike JSON Schema where $ref can be merged with other constraints.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 19 | Outbound: 4
- **Inter-Layer**: Inbound: 5 | Outbound: 3

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [Components](#components)           | composes        | inbound   | many-to-many |
| [Encoding](#encoding)               | references      | inbound   | many-to-one  |
| [Example](#example)                 | references      | inbound   | many-to-one  |
| [Header](#header)                   | references      | inbound   | many-to-one  |
| [Link node](#link)                  | references      | inbound   | many-to-many |
| [Mediatype](#mediatype)             | composes        | inbound   | many-to-one  |
| [Mediatype](#mediatype)             | references      | inbound   | many-to-one  |
| [Openapidocument](#openapidocument) | composes        | inbound   | many-to-many |
| [Operation](#operation)             | composes        | inbound   | many-to-many |
| [Operation](#operation)             | references      | inbound   | many-to-many |
| [Parameter](#parameter)             | references      | inbound   | many-to-many |
| [Requestbody](#requestbody)         | references      | inbound   | many-to-one  |
| [Response](#response)               | aggregates      | inbound   | many-to-one  |
| [Response](#response)               | references      | inbound   | many-to-one  |
| [Responses](#responses)             | aggregates      | inbound   | many-to-one  |
| [Responses](#responses)             | references      | inbound   | many-to-one  |
| [Operation](#operation)             | references      | outbound  | many-to-many |
| [Schema](#schema)                   | references      | outbound  | many-to-many |
| [Tag](#tag)                         | references      | outbound  | many-to-many |
| [Schema](#schema)                   | specializes     | outbound  | many-to-many |
| [Tag](#tag)                         | associated-with | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                         | Layer                                         | Predicate | Direction | Cardinality |
| -------------------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Businessobject](./02-business-layer-report.md#businessobject)       | [Business](./02-business-layer-report.md)     | maps-to   | outbound  | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)             | [Data Store](./08-data-store-layer-report.md) | maps-to   | outbound  | many-to-one |
| [Field](./08-data-store-layer-report.md#field)                       | [Data Store](./08-data-store-layer-report.md) | maps-to   | outbound  | many-to-one |
| [Jsonschema](./07-data-model-layer-report.md#jsonschema)             | [Data Model](./07-data-model-layer-report.md) | realizes  | inbound   | many-to-one |
| [Reference](./07-data-model-layer-report.md#reference)               | [Data Model](./07-data-model-layer-report.md) | maps-to   | inbound   | many-to-one |
| [Schemadefinition](./07-data-model-layer-report.md#schemadefinition) | [Data Model](./07-data-model-layer-report.md) | maps-to   | inbound   | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)             | [Data Store](./08-data-store-layer-report.md) | realizes  | inbound   | many-to-one |
| [Dataconfig](./09-ux-layer-report.md#dataconfig)                     | [UX](./09-ux-layer-report.md)                 | maps-to   | inbound   | many-to-one |

[Back to Index](#report-index)

### Securityscheme {#securityscheme}

**Spec Node ID**: `api.securityscheme`

Defines an authentication/authorization mechanism for the API. Supports four scheme types: apiKey (name+in required), http (scheme required), oauth2 (flows required), and openIdConnect (openIdConnectUrl required). Only 'type' is universally required. Note: SecurityScheme defines the mechanism; it is referenced by name string key in Operation.security or the root security array — those references are security requirement objects, not SecurityScheme instances.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 2
- **Inter-Layer**: Inbound: 3 | Outbound: 13

#### Intra-Layer Relationships

| Related Node              | Predicate       | Direction | Cardinality  |
| ------------------------- | --------------- | --------- | ------------ |
| [Components](#components) | composes        | inbound   | many-to-one  |
| [Header](#header)         | associated-with | inbound   | many-to-one  |
| [Oauthflow](#oauthflow)   | serves          | inbound   | many-to-one  |
| [Oauthflows](#oauthflows) | serves          | inbound   | many-to-one  |
| [Operation](#operation)   | uses            | inbound   | many-to-one  |
| [Ratelimit](#ratelimit)   | associated-with | inbound   | many-to-one  |
| [Oauthflows](#oauthflows) | composes        | outbound  | one-to-one   |
| [Operation](#operation)   | serves          | outbound  | many-to-many |
| [Server](#server)         | references      | inbound   | many-to-one  |
| [Tag](#tag)               | associated-with | inbound   | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | implements | outbound  | many-to-one |
| [Collection](./08-data-store-layer-report.md#collection)                      | [Data Store](./08-data-store-layer-report.md)   | maps-to    | outbound  | many-to-one |
| [Actor](./03-security-layer-report.md#actor)                                  | [Security](./03-security-layer-report.md)       | maps-to    | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | references | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | references | outbound  | many-to-one |
| [Businessinterface](./02-business-layer-report.md#businessinterface)          | [Business](./02-business-layer-report.md)       | references | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | references | outbound  | many-to-one |
| [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | references | outbound  | many-to-one |
| [Permission](./03-security-layer-report.md#permission)                        | [Security](./03-security-layer-report.md)       | requires   | outbound  | many-to-one |
| [Principle](./01-motivation-layer-report.md#principle)                        | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Businessrole](./02-business-layer-report.md#businessrole)                    | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | outbound  | many-to-one |
| [Navigationguard](./10-navigation-layer-report.md#navigationguard)            | [Navigation](./10-navigation-layer-report.md)   | uses       | inbound   | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | requires   | inbound   | many-to-one |
| [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | uses       | inbound   | many-to-one |

[Back to Index](#report-index)

### Server {#server}

**Spec Node ID**: `api.server`

Defines a server URL (optionally templated with {variable} placeholders) where the API is deployed. Supports multiple server entries for different environments (production, staging, dev). The 'url' field is required. A 'servers' array can appear at three levels: root document, PathItem, and Operation — each level overrides the previous for that scope.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 4
- **Inter-Layer**: Inbound: 1 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [Oauthflow](#oauthflow)             | references      | inbound   | many-to-one  |
| [Openapidocument](#openapidocument) | aggregates      | inbound   | many-to-many |
| [Operation](#operation)             | aggregates      | inbound   | many-to-many |
| [Pathitem](#pathitem)               | aggregates      | inbound   | many-to-one  |
| [Paths](#paths)                     | aggregates      | inbound   | many-to-one  |
| [Servervariable](#servervariable)   | aggregates      | outbound  | many-to-one  |
| [Ratelimit](#ratelimit)             | associated-with | outbound  | many-to-one  |
| [Securityscheme](#securityscheme)   | references      | outbound  | many-to-one  |
| [Pathitem](#pathitem)               | serves          | outbound  | many-to-one  |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | depends-on | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | outbound  | many-to-one |
| [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)             | [APM](./11-apm-layer-report.md)                 | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Servervariable {#servervariable}

**Spec Node ID**: `api.servervariable`

A variable placeholder in server URL templates that can be substituted at runtime. Enables dynamic server addressing for different environments or tenants.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node      | Predicate  | Direction | Cardinality |
| ----------------- | ---------- | --------- | ----------- |
| [Server](#server) | aggregates | inbound   | many-to-one |

[Back to Index](#report-index)

### Tag {#tag}

**Spec Node ID**: `api.tag`

A metadata label used to group and categorize API operations for documentation organization. Root-level Tag objects provide supplementary metadata (description, externalDocs) for tag names referenced in operations — they do not control which tags are permitted. Tags used in operations but not declared at root level are implicitly valid in OpenAPI 3.0 but will lack descriptions and externalDocs. Duplicate tag names at root level are invalid per OpenAPI 3.0.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate       | Direction | Cardinality  |
| ----------------------------------------------- | --------------- | --------- | ------------ |
| [Link node](#link)                              | references      | inbound   | many-to-many |
| [Oauthflow](#oauthflow)                         | aggregates      | inbound   | many-to-one  |
| [Openapidocument](#openapidocument)             | aggregates      | inbound   | many-to-many |
| [Operation](#operation)                         | aggregates      | inbound   | many-to-many |
| [Operation](#operation)                         | references      | inbound   | many-to-many |
| [Parameter](#parameter)                         | references      | inbound   | many-to-many |
| [Paths](#paths)                                 | references      | inbound   | many-to-one  |
| [Schema](#schema)                               | references      | inbound   | many-to-many |
| [Operation](#operation)                         | aggregates      | outbound  | many-to-one  |
| [Schema](#schema)                               | associated-with | outbound  | many-to-one  |
| [Securityscheme](#securityscheme)               | associated-with | outbound  | many-to-one  |
| [Externaldocumentation](#externaldocumentation) | references      | outbound  | many-to-one  |
| [Operation](#operation)                         | serves          | outbound  | many-to-one  |

[Back to Index](#report-index)

---

_Generated: 2026-03-14T21:04:51.697Z | Spec Version: 0.8.2 | Generator: generate-layer-reports.ts_
