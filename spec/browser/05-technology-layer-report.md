# Technology Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
  - [Artifact](#artifact)
  - [Communicationnetwork](#communicationnetwork)
  - [Device](#device)
  - [Node](#node)
  - [Path](#path)
  - [Systemsoftware](#systemsoftware)
  - [Technologycollaboration](#technologycollaboration)
  - [Technologyevent](#technologyevent)
  - [Technologyfunction](#technologyfunction)
  - [Technologyinteraction](#technologyinteraction)
  - [Technologyinterface](#technologyinterface)
  - [Technologyprocess](#technologyprocess)
  - [Technologyservice](#technologyservice)

## Layer Introduction

**Layer 5**: Technology
**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

Layer 5: Technology Layer

### Statistics

| Metric                    | Count |
| ------------------------- | ----- |
| Node Types                | 13    |
| Intra-Layer Relationships | 85    |
| Inter-Layer Relationships | 76    |
| Inbound Relationships     | 45    |
| Outbound Relationships    | 31    |

### Layer Dependencies

**Depends On**: [API](./06-api-layer-report.md), [Data Model](./07-data-model-layer-report.md), [Data Store](./08-data-store-layer-report.md), [UX](./09-ux-layer-report.md), [Navigation](./10-navigation-layer-report.md), [APM](./11-apm-layer-report.md), [Testing](./12-testing-layer-report.md)

**Depended On By**: [Motivation](./01-motivation-layer-report.md), [Business](./02-business-layer-report.md), [Security](./03-security-layer-report.md), [Application](./04-application-layer-report.md)

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph technology
    artifact["artifact"]
    communicationnetwork["communicationnetwork"]
    device["device"]
    node["node"]
    path["path"]
    systemsoftware["systemsoftware"]
    technologycollaboration["technologycollaboration"]
    technologyevent["technologyevent"]
    technologyfunction["technologyfunction"]
    technologyinteraction["technologyinteraction"]
    technologyinterface["technologyinterface"]
    technologyprocess["technologyprocess"]
    technologyservice["technologyservice"]
    communicationnetwork -->|aggregates| communicationnetwork
    communicationnetwork -->|aggregates| path
    communicationnetwork -->|assigned-to| technologycollaboration
    communicationnetwork -->|associated-with| systemsoftware
    communicationnetwork -->|provides| technologyinterface
    communicationnetwork -->|serves| device
    communicationnetwork -->|serves| node
    communicationnetwork -->|supports| technologyservice
    device -->|composes| node
    node -->|assigned-to| technologyfunction
    node -->|composes| artifact
    node -->|composes| device
    node -->|composes| systemsoftware
    node -->|composes| technologyinterface
    path -->|assigned-to| technologyinterface
    path -->|composes| path
    path -->|flows-to| technologyservice
    path -->|realizes| technologyservice
    path -->|serves| device
    path -->|serves| node
    path -->|triggers| technologyevent
    systemsoftware -->|accesses| artifact
    systemsoftware -->|assigned-to| technologyfunction
    systemsoftware -->|composes| artifact
    systemsoftware -->|depends-on| device
    systemsoftware -->|depends-on| systemsoftware
    systemsoftware -->|provides| technologyinterface
    systemsoftware -->|realizes| technologyservice
    systemsoftware -->|serves| technologyfunction
    systemsoftware -->|triggers| technologyevent
    systemsoftware -->|uses| communicationnetwork
    systemsoftware -->|uses| path
    technologycollaboration -->|accesses| artifact
    technologycollaboration -->|aggregates| node
    technologycollaboration -->|aggregates| technologyinterface
    technologycollaboration -->|associated-with| technologycollaboration
    technologycollaboration -->|performs| technologyinteraction
    technologycollaboration -->|realizes| technologyservice
    technologycollaboration -->|triggers| technologyevent
    technologycollaboration -->|uses| communicationnetwork
    technologycollaboration -->|uses| path
    technologyevent -->|associated-with| technologyservice
    technologyevent -->|flows-to| artifact
    technologyevent -->|flows-to| technologyprocess
    technologyevent -->|triggers| technologyfunction
    technologyevent -->|triggers| technologyinteraction
    technologyevent -->|triggers| technologyprocess
    technologyfunction -->|accesses| artifact
    technologyfunction -->|composes| technologyfunction
    technologyfunction -->|flows-to| technologyprocess
    technologyfunction -->|realizes| technologyservice
    technologyfunction -->|serves| technologyinteraction
    technologyfunction -->|triggers| technologyevent
    technologyfunction -->|triggers| technologyprocess
    technologyfunction -->|uses| technologyinterface
    technologyinteraction -->|accesses| artifact
    technologyinteraction -->|composes| technologyfunction
    technologyinteraction -->|flows-to| technologyinteraction
    technologyinteraction -->|realizes| technologycollaboration
    technologyinteraction -->|realizes| technologyservice
    technologyinteraction -->|triggers| technologyevent
    technologyinteraction -->|triggers| technologyprocess
    technologyinteraction -->|uses| technologyinterface
    technologyinterface -->|assigned-to| node
    technologyinterface -->|assigned-to| systemsoftware
    technologyinterface -->|assigned-to| technologyservice
    technologyinterface -->|serves| technologycollaboration
    technologyinterface -->|serves| technologyfunction
    technologyinterface -->|serves| technologyprocess
    technologyinterface -->|uses| communicationnetwork
    technologyinterface -->|uses| path
    technologyprocess -->|realizes| technologyservice
    technologyprocess -->|triggers| technologyevent
    technologyprocess -->|uses| path
    technologyservice -->|aggregates| technologyfunction
    technologyservice -->|associated-with| technologycollaboration
    technologyservice -->|consumes| artifact
    technologyservice -->|depends-on| communicationnetwork
    technologyservice -->|depends-on| node
    technologyservice -->|flows-to| technologyservice
    technologyservice -->|provides| technologyinterface
    technologyservice -->|serves| technologyinterface
    technologyservice -->|serves| technologyservice
    technologyservice -->|triggers| technologyevent
    technologyservice -->|uses| systemsoftware
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
  class technology current
```

## Inter-Layer Relationships Table

| Relationship ID                                                      | Source Node                                                              | Dest Node                                                                     | Dest Layer                                      | Predicate  | Cardinality | Strength |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | ----------- | -------- |
| api.openapidocument.depends-on.technology.technologyservice          | [Openapidocument](./06-api-layer-report.md#openapidocument)              | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| api.operation.uses.technology.technologyservice                      | [Operation](./06-api-layer-report.md#operation)                          | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| api.pathitem.depends-on.technology.technologyservice                 | [Pathitem](./06-api-layer-report.md#pathitem)                            | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| api.ratelimit.uses.technology.systemsoftware                         | [Ratelimit](./06-api-layer-report.md#ratelimit)                          | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| api.securityscheme.uses.technology.systemsoftware                    | [Securityscheme](./06-api-layer-report.md#securityscheme)                | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| api.server.depends-on.technology.node                                | [Server](./06-api-layer-report.md#server)                                | [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| api.server.uses.technology.systemsoftware                            | [Server](./06-api-layer-report.md#server)                                | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| apm.exporterconfig.depends-on.technology.technologyservice           | [Exporterconfig](./11-apm-layer-report.md#exporterconfig)                | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| apm.instrumentationconfig.monitors.technology.systemsoftware         | [Instrumentationconfig](./11-apm-layer-report.md#instrumentationconfig)  | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.logconfiguration.depends-on.technology.technologyservice         | [Logconfiguration](./11-apm-layer-report.md#logconfiguration)            | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| apm.metricinstrument.monitors.technology.technologyservice           | [Metricinstrument](./11-apm-layer-report.md#metricinstrument)            | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.resource.monitors.technology.node                                | [Resource](./11-apm-layer-report.md#resource)                            | [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.resource.monitors.technology.systemsoftware                      | [Resource](./11-apm-layer-report.md#resource)                            | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.span.monitors.technology.technologyservice                       | [Span](./11-apm-layer-report.md#span)                                    | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | monitors   | many-to-one | medium   |
| apm.traceconfiguration.depends-on.technology.technologyservice       | [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)        | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| data-model.jsonschema.depends-on.technology.systemsoftware           | [Jsonschema](./07-data-model-layer-report.md#jsonschema)                 | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| data-model.jsonschema.maps-to.technology.artifact                    | [Jsonschema](./07-data-model-layer-report.md#jsonschema)                 | [Artifact](./05-technology-layer-report.md#artifact)                          | [Technology](./05-technology-layer-report.md)   | maps-to    | many-to-one | medium   |
| data-model.jsonschema.uses.technology.technologyservice              | [Jsonschema](./07-data-model-layer-report.md#jsonschema)                 | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| data-model.objectschema.depends-on.technology.systemsoftware         | [Objectschema](./07-data-model-layer-report.md#objectschema)             | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| data-model.schemadefinition.depends-on.technology.systemsoftware     | [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)     | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| data-store.database.depends-on.technology.node                       | [Database](./08-data-store-layer-report.md#database)                     | [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| data-store.database.depends-on.technology.systemsoftware             | [Database](./08-data-store-layer-report.md#database)                     | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| data-store.database.uses.technology.technologyservice                | [Database](./08-data-store-layer-report.md#database)                     | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| data-store.retentionpolicy.uses.technology.technologyservice         | [Retentionpolicy](./08-data-store-layer-report.md#retentionpolicy)       | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| data-store.storedlogic.depends-on.technology.systemsoftware          | [Storedlogic](./08-data-store-layer-report.md#storedlogic)               | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| data-store.storedlogic.uses.technology.technologyservice             | [Storedlogic](./08-data-store-layer-report.md#storedlogic)               | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| navigation.navigationflow.uses.technology.systemsoftware             | [Navigationflow](./10-navigation-layer-report.md#navigationflow)         | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| navigation.navigationgraph.uses.technology.systemsoftware            | [Navigationgraph](./10-navigation-layer-report.md#navigationgraph)       | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| navigation.navigationguard.uses.technology.systemsoftware            | [Navigationguard](./10-navigation-layer-report.md#navigationguard)       | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| navigation.route.depends-on.technology.technologyservice             | [Route](./10-navigation-layer-report.md#route)                           | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| navigation.route.uses.technology.systemsoftware                      | [Route](./10-navigation-layer-report.md#route)                           | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| navigation.route.uses.technology.technologyfunction                  | [Route](./10-navigation-layer-report.md#route)                           | [Technologyfunction](./05-technology-layer-report.md#technologyfunction)      | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| technology.device.satisfies.security.securitypolicy                  | [Device](./05-technology-layer-report.md#device)                         | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| technology.device.serves.application.applicationcomponent            | [Device](./05-technology-layer-report.md#device)                         | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| technology.node.satisfies.motivation.constraint                      | [Node](./05-technology-layer-report.md#node)                             | [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| technology.node.satisfies.security.securitypolicy                    | [Node](./05-technology-layer-report.md#node)                             | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| technology.node.serves.application.applicationcomponent              | [Node](./05-technology-layer-report.md#node)                             | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| technology.node.serves.business.businessprocess                      | [Node](./05-technology-layer-report.md#node)                             | [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| technology.systemsoftware.implements.motivation.principle            | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Principle](./01-motivation-layer-report.md#principle)                        | [Motivation](./01-motivation-layer-report.md)   | implements | many-to-one | medium   |
| technology.systemsoftware.implements.security.countermeasure         | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Countermeasure](./03-security-layer-report.md#countermeasure)                | [Security](./03-security-layer-report.md)       | implements | many-to-one | medium   |
| technology.systemsoftware.mitigates.security.threat                  | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Threat](./03-security-layer-report.md#threat)                                | [Security](./03-security-layer-report.md)       | mitigates  | many-to-one | medium   |
| technology.systemsoftware.realizes.application.applicationservice    | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | realizes   | many-to-one | medium   |
| technology.systemsoftware.realizes.business.businessservice          | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| technology.systemsoftware.realizes.motivation.goal                   | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | many-to-one | medium   |
| technology.systemsoftware.realizes.security.securitypolicy           | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | realizes   | many-to-one | medium   |
| technology.systemsoftware.satisfies.motivation.constraint            | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| technology.systemsoftware.satisfies.motivation.requirement           | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| technology.systemsoftware.serves.application.applicationcomponent    | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| technology.systemsoftware.serves.business.businessprocess            | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)         | [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| technology.technologyfunction.implements.security.countermeasure     | [Technologyfunction](./05-technology-layer-report.md#technologyfunction) | [Countermeasure](./03-security-layer-report.md#countermeasure)                | [Security](./03-security-layer-report.md)       | implements | many-to-one | medium   |
| technology.technologyfunction.serves.application.applicationfunction | [Technologyfunction](./05-technology-layer-report.md#technologyfunction) | [Applicationfunction](./04-application-layer-report.md#applicationfunction)   | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| technology.technologyfunction.serves.business.businessservice        | [Technologyfunction](./05-technology-layer-report.md#technologyfunction) | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| technology.technologyservice.accesses.security.secureresource        | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | accesses   | many-to-one | medium   |
| technology.technologyservice.realizes.business.businessservice       | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | realizes   | many-to-one | medium   |
| technology.technologyservice.realizes.motivation.goal                | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | many-to-one | medium   |
| technology.technologyservice.satisfies.motivation.requirement        | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | many-to-one | medium   |
| technology.technologyservice.satisfies.security.securitypolicy       | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | many-to-one | medium   |
| technology.technologyservice.serves.application.applicationcomponent | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| technology.technologyservice.serves.application.applicationservice   | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | serves     | many-to-one | medium   |
| technology.technologyservice.serves.business.businessfunction        | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Businessfunction](./02-business-layer-report.md#businessfunction)            | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| technology.technologyservice.serves.business.businessprocess         | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| technology.technologyservice.serves.business.businessservice         | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | serves     | many-to-one | medium   |
| technology.technologyservice.serves.motivation.stakeholder           | [Technologyservice](./05-technology-layer-report.md#technologyservice)   | [Stakeholder](./01-motivation-layer-report.md#stakeholder)                    | [Motivation](./01-motivation-layer-report.md)   | serves     | many-to-one | medium   |
| testing.environmentfactor.references.technology.node                 | [Environmentfactor](./12-testing-layer-report.md#environmentfactor)      | [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | references | many-to-one | medium   |
| testing.environmentfactor.references.technology.systemsoftware       | [Environmentfactor](./12-testing-layer-report.md#environmentfactor)      | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | references | many-to-one | medium   |
| testing.testcasesketch.requires.technology.systemsoftware            | [Testcasesketch](./12-testing-layer-report.md#testcasesketch)            | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | requires   | many-to-one | medium   |
| testing.testcoveragemodel.tests.technology.systemsoftware            | [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)      | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | tests      | many-to-one | medium   |
| testing.testcoveragemodel.tests.technology.technologyservice         | [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)      | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | tests      | many-to-one | medium   |
| testing.testcoveragetarget.references.technology.node                | [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)    | [Node](./05-technology-layer-report.md#node)                                  | [Technology](./05-technology-layer-report.md)   | references | many-to-one | medium   |
| testing.testcoveragetarget.references.technology.systemsoftware      | [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)    | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | references | many-to-one | medium   |
| testing.testcoveragetarget.references.technology.technologyservice   | [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)    | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | references | many-to-one | medium   |
| ux.actioncomponent.uses.technology.technologyservice                 | [Actioncomponent](./09-ux-layer-report.md#actioncomponent)               | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | uses       | many-to-one | medium   |
| ux.librarycomponent.depends-on.technology.systemsoftware             | [Librarycomponent](./09-ux-layer-report.md#librarycomponent)             | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| ux.librarycomponent.requires.technology.technologyservice            | [Librarycomponent](./09-ux-layer-report.md#librarycomponent)             | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | requires   | many-to-one | medium   |
| ux.view.depends-on.technology.systemsoftware                         | [View](./09-ux-layer-report.md#view)                                     | [Systemsoftware](./05-technology-layer-report.md#systemsoftware)              | [Technology](./05-technology-layer-report.md)   | depends-on | many-to-one | medium   |
| ux.view.requires.technology.technologyservice                        | [View](./09-ux-layer-report.md#view)                                     | [Technologyservice](./05-technology-layer-report.md#technologyservice)        | [Technology](./05-technology-layer-report.md)   | requires   | many-to-one | medium   |

## Node Reference

### Artifact {#artifact}

**Spec Node ID**: `technology.artifact`

A piece of data that is used or produced in a software development process, or by the deployment and operation of an IT system, such as a source file, executable, script, or configuration file.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 0
- **Inter-Layer**: Inbound: 1 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate | Direction | Cardinality |
| --------------------------------------------------- | --------- | --------- | ----------- |
| [Node](#node)                                       | composes  | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)                   | accesses  | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)                   | composes  | inbound   | many-to-one |
| [Technologycollaboration](#technologycollaboration) | accesses  | inbound   | many-to-one |
| [Technologyevent](#technologyevent)                 | flows-to  | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)           | accesses  | inbound   | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | accesses  | inbound   | many-to-one |
| [Technologyservice](#technologyservice)             | consumes  | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                             | Layer                                         | Predicate | Direction | Cardinality |
| -------------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------- |
| [Jsonschema](./07-data-model-layer-report.md#jsonschema) | [Data Model](./07-data-model-layer-report.md) | maps-to   | inbound   | many-to-one |

[Back to Index](#report-index)

### Communicationnetwork {#communicationnetwork}

**Spec Node ID**: `technology.communicationnetwork`

A set of structures that connects nodes for the purpose of transmission, routing, and reception of data, such as a LAN, WAN, or VPN.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 8
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate       | Direction | Cardinality |
| --------------------------------------------------- | --------------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork)       | aggregates      | outbound  | many-to-one |
| [Path](#path)                                       | aggregates      | outbound  | many-to-one |
| [Technologycollaboration](#technologycollaboration) | assigned-to     | outbound  | many-to-one |
| [Systemsoftware](#systemsoftware)                   | associated-with | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)         | provides        | outbound  | many-to-one |
| [Device](#device)                                   | serves          | outbound  | many-to-one |
| [Node](#node)                                       | serves          | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | supports        | outbound  | many-to-one |
| [Systemsoftware](#systemsoftware)                   | uses            | inbound   | many-to-one |
| [Technologycollaboration](#technologycollaboration) | uses            | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)         | uses            | inbound   | many-to-one |
| [Technologyservice](#technologyservice)             | depends-on      | inbound   | many-to-one |

[Back to Index](#report-index)

### Device {#device}

**Spec Node ID**: `technology.device`

A physical IT resource upon which system software and artifacts may be stored or deployed for execution, such as a server, workstation, mobile device, or IoT sensor.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality |
| --------------------------------------------- | ---------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork) | serves     | inbound   | many-to-one |
| [Node](#node)                                 | composes   | outbound  | many-to-one |
| [Node](#node)                                 | composes   | inbound   | many-to-one |
| [Path](#path)                                 | serves     | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)             | depends-on | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | --------- | --------- | ----------- |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves    | outbound  | many-to-one |

[Back to Index](#report-index)

### Node {#node}

**Spec Node ID**: `technology.node`

A computational or physical resource that hosts, manipulates, or interacts with other computational or physical resources, such as a server cluster, virtual machine host, or container runtime.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 5
- **Inter-Layer**: Inbound: 5 | Outbound: 4

#### Intra-Layer Relationships

| Related Node                                        | Predicate   | Direction | Cardinality |
| --------------------------------------------------- | ----------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork)       | serves      | inbound   | many-to-one |
| [Device](#device)                                   | composes    | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)           | assigned-to | outbound  | many-to-one |
| [Artifact](#artifact)                               | composes    | outbound  | many-to-one |
| [Device](#device)                                   | composes    | outbound  | many-to-one |
| [Systemsoftware](#systemsoftware)                   | composes    | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)         | composes    | outbound  | many-to-one |
| [Path](#path)                                       | serves      | inbound   | many-to-one |
| [Technologycollaboration](#technologycollaboration) | aggregates  | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)         | assigned-to | inbound   | many-to-one |
| [Technologyservice](#technologyservice)             | depends-on  | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Server](./06-api-layer-report.md#server)                                     | [API](./06-api-layer-report.md)                 | depends-on | inbound   | many-to-one |
| [Resource](./11-apm-layer-report.md#resource)                                 | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Database](./08-data-store-layer-report.md#database)                          | [Data Store](./08-data-store-layer-report.md)   | depends-on | inbound   | many-to-one |
| [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Environmentfactor](./12-testing-layer-report.md#environmentfactor)           | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |
| [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)         | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |

[Back to Index](#report-index)

### Path {#path}

**Spec Node ID**: `technology.path`

A link between two or more nodes through which those nodes can exchange data, representing a logical communication channel such as a network route, API connection, or message channel.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 7
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate   | Direction | Cardinality |
| --------------------------------------------------- | ----------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork)       | aggregates  | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)         | assigned-to | outbound  | many-to-one |
| [Path](#path)                                       | composes    | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | flows-to    | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | realizes    | outbound  | many-to-one |
| [Device](#device)                                   | serves      | outbound  | many-to-one |
| [Node](#node)                                       | serves      | outbound  | many-to-one |
| [Technologyevent](#technologyevent)                 | triggers    | outbound  | many-to-one |
| [Systemsoftware](#systemsoftware)                   | uses        | inbound   | many-to-one |
| [Technologycollaboration](#technologycollaboration) | uses        | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)         | uses        | inbound   | many-to-one |
| [Technologyprocess](#technologyprocess)             | uses        | inbound   | many-to-one |

[Back to Index](#report-index)

### Systemsoftware {#systemsoftware}

**Spec Node ID**: `technology.systemsoftware`

Software that provides or contributes to an environment for storing, executing, and using other software or data deployed within it, such as an operating system, container runtime, database engine, or middleware platform.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 11
- **Inter-Layer**: Inbound: 20 | Outbound: 11

#### Intra-Layer Relationships

| Related Node                                  | Predicate       | Direction | Cardinality |
| --------------------------------------------- | --------------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork) | associated-with | inbound   | many-to-one |
| [Node](#node)                                 | composes        | inbound   | many-to-one |
| [Artifact](#artifact)                         | accesses        | outbound  | many-to-one |
| [Technologyfunction](#technologyfunction)     | assigned-to     | outbound  | many-to-one |
| [Artifact](#artifact)                         | composes        | outbound  | many-to-one |
| [Device](#device)                             | depends-on      | outbound  | many-to-one |
| [Systemsoftware](#systemsoftware)             | depends-on      | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)   | provides        | outbound  | many-to-one |
| [Technologyservice](#technologyservice)       | realizes        | outbound  | many-to-one |
| [Technologyfunction](#technologyfunction)     | serves          | outbound  | many-to-one |
| [Technologyevent](#technologyevent)           | triggers        | outbound  | many-to-one |
| [Communicationnetwork](#communicationnetwork) | uses            | outbound  | many-to-one |
| [Path](#path)                                 | uses            | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)   | assigned-to     | inbound   | many-to-one |
| [Technologyservice](#technologyservice)       | uses            | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Ratelimit](./06-api-layer-report.md#ratelimit)                               | [API](./06-api-layer-report.md)                 | uses       | inbound   | many-to-one |
| [Securityscheme](./06-api-layer-report.md#securityscheme)                     | [API](./06-api-layer-report.md)                 | uses       | inbound   | many-to-one |
| [Server](./06-api-layer-report.md#server)                                     | [API](./06-api-layer-report.md)                 | uses       | inbound   | many-to-one |
| [Instrumentationconfig](./11-apm-layer-report.md#instrumentationconfig)       | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Resource](./11-apm-layer-report.md#resource)                                 | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Jsonschema](./07-data-model-layer-report.md#jsonschema)                      | [Data Model](./07-data-model-layer-report.md)   | depends-on | inbound   | many-to-one |
| [Objectschema](./07-data-model-layer-report.md#objectschema)                  | [Data Model](./07-data-model-layer-report.md)   | depends-on | inbound   | many-to-one |
| [Schemadefinition](./07-data-model-layer-report.md#schemadefinition)          | [Data Model](./07-data-model-layer-report.md)   | depends-on | inbound   | many-to-one |
| [Database](./08-data-store-layer-report.md#database)                          | [Data Store](./08-data-store-layer-report.md)   | depends-on | inbound   | many-to-one |
| [Storedlogic](./08-data-store-layer-report.md#storedlogic)                    | [Data Store](./08-data-store-layer-report.md)   | depends-on | inbound   | many-to-one |
| [Navigationflow](./10-navigation-layer-report.md#navigationflow)              | [Navigation](./10-navigation-layer-report.md)   | uses       | inbound   | many-to-one |
| [Navigationgraph](./10-navigation-layer-report.md#navigationgraph)            | [Navigation](./10-navigation-layer-report.md)   | uses       | inbound   | many-to-one |
| [Navigationguard](./10-navigation-layer-report.md#navigationguard)            | [Navigation](./10-navigation-layer-report.md)   | uses       | inbound   | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | uses       | inbound   | many-to-one |
| [Principle](./01-motivation-layer-report.md#principle)                        | [Motivation](./01-motivation-layer-report.md)   | implements | outbound  | many-to-one |
| [Countermeasure](./03-security-layer-report.md#countermeasure)                | [Security](./03-security-layer-report.md)       | implements | outbound  | many-to-one |
| [Threat](./03-security-layer-report.md#threat)                                | [Security](./03-security-layer-report.md)       | mitigates  | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | realizes   | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Constraint](./01-motivation-layer-report.md#constraint)                      | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Environmentfactor](./12-testing-layer-report.md#environmentfactor)           | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |
| [Testcasesketch](./12-testing-layer-report.md#testcasesketch)                 | [Testing](./12-testing-layer-report.md)         | requires   | inbound   | many-to-one |
| [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)           | [Testing](./12-testing-layer-report.md)         | tests      | inbound   | many-to-one |
| [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)         | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |
| [Librarycomponent](./09-ux-layer-report.md#librarycomponent)                  | [UX](./09-ux-layer-report.md)                   | depends-on | inbound   | many-to-one |
| [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | depends-on | inbound   | many-to-one |

[Back to Index](#report-index)

### Technologycollaboration {#technologycollaboration}

**Spec Node ID**: `technology.technologycollaboration`

An aggregate of two or more technology active structure elements that work together to perform collective technology behavior, such as a cluster of servers, a distributed cache, or a microservice mesh.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 9
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate       | Direction | Cardinality |
| --------------------------------------------------- | --------------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork)       | assigned-to     | inbound   | many-to-one |
| [Artifact](#artifact)                               | accesses        | outbound  | many-to-one |
| [Node](#node)                                       | aggregates      | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)         | aggregates      | outbound  | many-to-one |
| [Technologycollaboration](#technologycollaboration) | associated-with | outbound  | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | performs        | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | realizes        | outbound  | many-to-one |
| [Technologyevent](#technologyevent)                 | triggers        | outbound  | many-to-one |
| [Communicationnetwork](#communicationnetwork)       | uses            | outbound  | many-to-one |
| [Path](#path)                                       | uses            | outbound  | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | realizes        | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)         | serves          | inbound   | many-to-one |
| [Technologyservice](#technologyservice)             | associated-with | inbound   | many-to-one |

[Back to Index](#report-index)

### Technologyevent {#technologyevent}

**Spec Node ID**: `technology.technologyevent`

A technology behavior element that denotes a state change in the technology layer that triggers or results from technology behavior, such as a system alert, infrastructure notification, scheduled job trigger, or deployment completion signal.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 7 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate       | Direction | Cardinality |
| --------------------------------------------------- | --------------- | --------- | ----------- |
| [Path](#path)                                       | triggers        | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)                   | triggers        | inbound   | many-to-one |
| [Technologycollaboration](#technologycollaboration) | triggers        | inbound   | many-to-one |
| [Technologyservice](#technologyservice)             | associated-with | outbound  | many-to-one |
| [Artifact](#artifact)                               | flows-to        | outbound  | many-to-one |
| [Technologyprocess](#technologyprocess)             | flows-to        | outbound  | many-to-one |
| [Technologyfunction](#technologyfunction)           | triggers        | outbound  | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | triggers        | outbound  | many-to-one |
| [Technologyprocess](#technologyprocess)             | triggers        | outbound  | many-to-one |
| [Technologyfunction](#technologyfunction)           | triggers        | inbound   | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | triggers        | inbound   | many-to-one |
| [Technologyprocess](#technologyprocess)             | triggers        | inbound   | many-to-one |
| [Technologyservice](#technologyservice)             | triggers        | inbound   | many-to-one |

[Back to Index](#report-index)

### Technologyfunction {#technologyfunction}

**Spec Node ID**: `technology.technologyfunction`

A collection of technology behavior that can be performed by a node, representing an internal automated capability such as data replication, load balancing, or log rotation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 8
- **Inter-Layer**: Inbound: 1 | Outbound: 3

#### Intra-Layer Relationships

| Related Node                                    | Predicate   | Direction | Cardinality |
| ----------------------------------------------- | ----------- | --------- | ----------- |
| [Node](#node)                                   | assigned-to | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)               | assigned-to | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)               | serves      | inbound   | many-to-one |
| [Technologyevent](#technologyevent)             | triggers    | inbound   | many-to-one |
| [Artifact](#artifact)                           | accesses    | outbound  | many-to-one |
| [Technologyfunction](#technologyfunction)       | composes    | outbound  | many-to-one |
| [Technologyprocess](#technologyprocess)         | flows-to    | outbound  | many-to-one |
| [Technologyservice](#technologyservice)         | realizes    | outbound  | many-to-one |
| [Technologyinteraction](#technologyinteraction) | serves      | outbound  | many-to-one |
| [Technologyevent](#technologyevent)             | triggers    | outbound  | many-to-one |
| [Technologyprocess](#technologyprocess)         | triggers    | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)     | uses        | outbound  | many-to-one |
| [Technologyinteraction](#technologyinteraction) | composes    | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)     | serves      | inbound   | many-to-one |
| [Technologyservice](#technologyservice)         | aggregates  | inbound   | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                | Layer                                           | Predicate  | Direction | Cardinality |
| --------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Route](./10-navigation-layer-report.md#route)                              | [Navigation](./10-navigation-layer-report.md)   | uses       | inbound   | many-to-one |
| [Countermeasure](./03-security-layer-report.md#countermeasure)              | [Security](./03-security-layer-report.md)       | implements | outbound  | many-to-one |
| [Applicationfunction](./04-application-layer-report.md#applicationfunction) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)            | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |

[Back to Index](#report-index)

### Technologyinteraction {#technologyinteraction}

**Spec Node ID**: `technology.technologyinteraction`

A unit of collective technology behavior performed by two or more collaborating nodes, such as a distributed transaction, inter-service handshake, or cluster failover protocol.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 8
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate | Direction | Cardinality |
| --------------------------------------------------- | --------- | --------- | ----------- |
| [Technologycollaboration](#technologycollaboration) | performs  | inbound   | many-to-one |
| [Technologyevent](#technologyevent)                 | triggers  | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)           | serves    | inbound   | many-to-one |
| [Artifact](#artifact)                               | accesses  | outbound  | many-to-one |
| [Technologyfunction](#technologyfunction)           | composes  | outbound  | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | flows-to  | outbound  | many-to-one |
| [Technologycollaboration](#technologycollaboration) | realizes  | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | realizes  | outbound  | many-to-one |
| [Technologyevent](#technologyevent)                 | triggers  | outbound  | many-to-one |
| [Technologyprocess](#technologyprocess)             | triggers  | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)         | uses      | outbound  | many-to-one |

[Back to Index](#report-index)

### Technologyinterface {#technologyinterface}

**Spec Node ID**: `technology.technologyinterface`

Point of access where technology services are available

#### Relationship Metrics

- **Intra-Layer**: Inbound: 9 | Outbound: 8
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                        | Predicate   | Direction | Cardinality |
| --------------------------------------------------- | ----------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork)       | provides    | inbound   | many-to-one |
| [Node](#node)                                       | composes    | inbound   | many-to-one |
| [Path](#path)                                       | assigned-to | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)                   | provides    | inbound   | many-to-one |
| [Technologycollaboration](#technologycollaboration) | aggregates  | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)           | uses        | inbound   | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | uses        | inbound   | many-to-one |
| [Node](#node)                                       | assigned-to | outbound  | many-to-one |
| [Systemsoftware](#systemsoftware)                   | assigned-to | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | assigned-to | outbound  | many-to-one |
| [Technologycollaboration](#technologycollaboration) | serves      | outbound  | many-to-one |
| [Technologyfunction](#technologyfunction)           | serves      | outbound  | many-to-one |
| [Technologyprocess](#technologyprocess)             | serves      | outbound  | many-to-one |
| [Communicationnetwork](#communicationnetwork)       | uses        | outbound  | many-to-one |
| [Path](#path)                                       | uses        | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | provides    | inbound   | many-to-one |
| [Technologyservice](#technologyservice)             | serves      | inbound   | many-to-one |

[Back to Index](#report-index)

### Technologyprocess {#technologyprocess}

**Spec Node ID**: `technology.technologyprocess`

A sequence of technology behaviors that achieves a specific technology result, such as a deployment pipeline, backup job, certificate renewal workflow, or container orchestration sequence.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate | Direction | Cardinality |
| ----------------------------------------------- | --------- | --------- | ----------- |
| [Technologyevent](#technologyevent)             | flows-to  | inbound   | many-to-one |
| [Technologyevent](#technologyevent)             | triggers  | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)       | flows-to  | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)       | triggers  | inbound   | many-to-one |
| [Technologyinteraction](#technologyinteraction) | triggers  | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)     | serves    | inbound   | many-to-one |
| [Technologyservice](#technologyservice)         | realizes  | outbound  | many-to-one |
| [Technologyevent](#technologyevent)             | triggers  | outbound  | many-to-one |
| [Path](#path)                                   | uses      | outbound  | many-to-one |

[Back to Index](#report-index)

### Technologyservice {#technologyservice}

**Spec Node ID**: `technology.technologyservice`

Externally visible unit of technology functionality

#### Relationship Metrics

- **Intra-Layer**: Inbound: 12 | Outbound: 11
- **Inter-Layer**: Inbound: 18 | Outbound: 11

#### Intra-Layer Relationships

| Related Node                                        | Predicate       | Direction | Cardinality |
| --------------------------------------------------- | --------------- | --------- | ----------- |
| [Communicationnetwork](#communicationnetwork)       | supports        | inbound   | many-to-one |
| [Path](#path)                                       | flows-to        | inbound   | many-to-one |
| [Path](#path)                                       | realizes        | inbound   | many-to-one |
| [Systemsoftware](#systemsoftware)                   | realizes        | inbound   | many-to-one |
| [Technologycollaboration](#technologycollaboration) | realizes        | inbound   | many-to-one |
| [Technologyevent](#technologyevent)                 | associated-with | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)           | realizes        | inbound   | many-to-one |
| [Technologyinteraction](#technologyinteraction)     | realizes        | inbound   | many-to-one |
| [Technologyinterface](#technologyinterface)         | assigned-to     | inbound   | many-to-one |
| [Technologyprocess](#technologyprocess)             | realizes        | inbound   | many-to-one |
| [Technologyfunction](#technologyfunction)           | aggregates      | outbound  | many-to-one |
| [Technologycollaboration](#technologycollaboration) | associated-with | outbound  | many-to-one |
| [Artifact](#artifact)                               | consumes        | outbound  | many-to-one |
| [Communicationnetwork](#communicationnetwork)       | depends-on      | outbound  | many-to-one |
| [Node](#node)                                       | depends-on      | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | flows-to        | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)         | provides        | outbound  | many-to-one |
| [Technologyinterface](#technologyinterface)         | serves          | outbound  | many-to-one |
| [Technologyservice](#technologyservice)             | serves          | outbound  | many-to-one |
| [Technologyevent](#technologyevent)                 | triggers        | outbound  | many-to-one |
| [Systemsoftware](#systemsoftware)                   | uses            | outbound  | many-to-one |

#### Inter-Layer Relationships

| Related Node                                                                  | Layer                                           | Predicate  | Direction | Cardinality |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [Openapidocument](./06-api-layer-report.md#openapidocument)                   | [API](./06-api-layer-report.md)                 | depends-on | inbound   | many-to-one |
| [Operation](./06-api-layer-report.md#operation)                               | [API](./06-api-layer-report.md)                 | uses       | inbound   | many-to-one |
| [Pathitem](./06-api-layer-report.md#pathitem)                                 | [API](./06-api-layer-report.md)                 | depends-on | inbound   | many-to-one |
| [Exporterconfig](./11-apm-layer-report.md#exporterconfig)                     | [APM](./11-apm-layer-report.md)                 | depends-on | inbound   | many-to-one |
| [Logconfiguration](./11-apm-layer-report.md#logconfiguration)                 | [APM](./11-apm-layer-report.md)                 | depends-on | inbound   | many-to-one |
| [Metricinstrument](./11-apm-layer-report.md#metricinstrument)                 | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Span](./11-apm-layer-report.md#span)                                         | [APM](./11-apm-layer-report.md)                 | monitors   | inbound   | many-to-one |
| [Traceconfiguration](./11-apm-layer-report.md#traceconfiguration)             | [APM](./11-apm-layer-report.md)                 | depends-on | inbound   | many-to-one |
| [Jsonschema](./07-data-model-layer-report.md#jsonschema)                      | [Data Model](./07-data-model-layer-report.md)   | uses       | inbound   | many-to-one |
| [Database](./08-data-store-layer-report.md#database)                          | [Data Store](./08-data-store-layer-report.md)   | uses       | inbound   | many-to-one |
| [Retentionpolicy](./08-data-store-layer-report.md#retentionpolicy)            | [Data Store](./08-data-store-layer-report.md)   | uses       | inbound   | many-to-one |
| [Storedlogic](./08-data-store-layer-report.md#storedlogic)                    | [Data Store](./08-data-store-layer-report.md)   | uses       | inbound   | many-to-one |
| [Route](./10-navigation-layer-report.md#route)                                | [Navigation](./10-navigation-layer-report.md)   | depends-on | inbound   | many-to-one |
| [Secureresource](./03-security-layer-report.md#secureresource)                | [Security](./03-security-layer-report.md)       | accesses   | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | realizes   | outbound  | many-to-one |
| [Goal](./01-motivation-layer-report.md#goal)                                  | [Motivation](./01-motivation-layer-report.md)   | realizes   | outbound  | many-to-one |
| [Requirement](./01-motivation-layer-report.md#requirement)                    | [Motivation](./01-motivation-layer-report.md)   | satisfies  | outbound  | many-to-one |
| [Securitypolicy](./03-security-layer-report.md#securitypolicy)                | [Security](./03-security-layer-report.md)       | satisfies  | outbound  | many-to-one |
| [Applicationcomponent](./04-application-layer-report.md#applicationcomponent) | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Applicationservice](./04-application-layer-report.md#applicationservice)     | [Application](./04-application-layer-report.md) | serves     | outbound  | many-to-one |
| [Businessfunction](./02-business-layer-report.md#businessfunction)            | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Businessprocess](./02-business-layer-report.md#businessprocess)              | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Businessservice](./02-business-layer-report.md#businessservice)              | [Business](./02-business-layer-report.md)       | serves     | outbound  | many-to-one |
| [Stakeholder](./01-motivation-layer-report.md#stakeholder)                    | [Motivation](./01-motivation-layer-report.md)   | serves     | outbound  | many-to-one |
| [Testcoveragemodel](./12-testing-layer-report.md#testcoveragemodel)           | [Testing](./12-testing-layer-report.md)         | tests      | inbound   | many-to-one |
| [Testcoveragetarget](./12-testing-layer-report.md#testcoveragetarget)         | [Testing](./12-testing-layer-report.md)         | references | inbound   | many-to-one |
| [Actioncomponent](./09-ux-layer-report.md#actioncomponent)                    | [UX](./09-ux-layer-report.md)                   | uses       | inbound   | many-to-one |
| [Librarycomponent](./09-ux-layer-report.md#librarycomponent)                  | [UX](./09-ux-layer-report.md)                   | requires   | inbound   | many-to-one |
| [View](./09-ux-layer-report.md#view)                                          | [UX](./09-ux-layer-report.md)                   | requires   | inbound   | many-to-one |

[Back to Index](#report-index)

---

_Generated: 2026-03-14T21:04:51.692Z | Spec Version: 0.8.2 | Generator: generate-layer-reports.ts_
