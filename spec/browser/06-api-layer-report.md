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
  - [Link](#link)
  - [Mediatype](#mediatype)
  - [Oauthflow](#oauthflow)
  - [Oauthflows](#oauthflows)
  - [Openapidocument](#openapidocument)
  - [Operation](#operation)
  - [Parameter](#parameter)
  - [Parameterlocation](#parameterlocation)
  - [Parameterstyle](#parameterstyle)
  - [Pathitem](#pathitem)
  - [Paths](#paths)
  - [Requestbody](#requestbody)
  - [Response](#response)
  - [Responses](#responses)
  - [Schema](#schema)
  - [Securityscheme](#securityscheme)
  - [Securitytype](#securitytype)
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
| Node Types                | 29    |
| Intra-Layer Relationships | 30    |
| Inter-Layer Relationships | 22    |
| Inbound Relationships     | 0     |
| Outbound Relationships    | 22    |

### Layer Dependencies

**Depends On**: None

**Depended On By**: [Business](./02-business-layer-report.md), [Security](./03-security-layer-report.md), [Application](./04-application-layer-report.md), [Data Store](./08-data-store-layer-report.md), [APM](./11-apm-layer-report.md)

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
    parameterlocation["parameterlocation"]
    parameterstyle["parameterstyle"]
    pathitem["pathitem"]
    paths["paths"]
    requestbody["requestbody"]
    response["response"]
    responses["responses"]
    schema["schema"]
    securityscheme["securityscheme"]
    securitytype["securitytype"]
    server["server"]
    servervariable["servervariable"]
    tag["tag"]
    components -->|composes| paths
    components -->|composes| responses
    components -->|composes| schema
    contact -->|associated-with| openapidocument
    license -->|associated-with| openapidocument
    link -->|references| operation
    link -->|references| schema
    link -->|references| tag
    openapidocument -->|aggregates| server
    openapidocument -->|aggregates| tag
    openapidocument -->|composes| paths
    openapidocument -->|composes| responses
    openapidocument -->|composes| schema
    operation -->|aggregates| server
    operation -->|aggregates| tag
    operation -->|composes| paths
    operation -->|composes| responses
    operation -->|composes| schema
    operation -->|references| operation
    operation -->|references| schema
    operation -->|references| tag
    operation -->|triggers| callback
    parameter -->|references| operation
    parameter -->|references| schema
    parameter -->|references| tag
    schema -->|references| operation
    schema -->|references| schema
    schema -->|references| tag
    schema -->|specializes| schema
    securityscheme -->|serves| operation
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
  technology --> security
  data_model --> business
  data_model --> application
  testing --> motivation
  business --> motivation
  business --> security
  business --> application
  business --> data_model
  application --> apm
  application --> motivation
  api --> security
  api --> business
  api --> data_store
  api --> application
  api --> apm
  class api current
```

## Inter-Layer Relationships Table

| Relationship ID                                                      | Source Node                                               | Dest Node                                                                 | Dest Layer                                      | Predicate              | Cardinality  | Strength |
| -------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------- | ------------ | -------- |
| api.operation.apm-trace.apm.traceconfiguration                       | [operation](./06-api-layer-report.md#operation)           | [traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [APM](./11-apm-layer-report.md)                 | apm-trace              | many-to-one  | medium   |
| api.operation.archimate-ref.application.applicationservice           | [operation](./06-api-layer-report.md#operation)           | [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref          | many-to-one  | medium   |
| api.operation.business-interface-ref.business.businessinterface      | [operation](./06-api-layer-report.md#operation)           | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | business-interface-ref | many-to-one  | medium   |
| api.operation.business-service-ref.business.businessservice          | [operation](./06-api-layer-report.md#operation)           | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | business-service-ref   | many-to-one  | medium   |
| api.operation.referenced-by.business.businessinterface               | [operation](./06-api-layer-report.md#operation)           | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | referenced-by          | many-to-one  | medium   |
| api.operation.referenced-by.business.businessservice                 | [operation](./06-api-layer-report.md#operation)           | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | referenced-by          | many-to-one  | medium   |
| api.operation.referenced-by.security.permission                      | [operation](./06-api-layer-report.md#operation)           | [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | referenced-by          | many-to-many | medium   |
| api.operation.referenced-by.security.secureresource                  | [operation](./06-api-layer-report.md#operation)           | [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | referenced-by          | many-to-one  | medium   |
| api.operation.required-permissions.security.permission               | [operation](./06-api-layer-report.md#operation)           | [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | required-permissions   | many-to-many | critical |
| api.operation.security-resource.security.secureresource              | [operation](./06-api-layer-report.md#operation)           | [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | security-resource      | many-to-one  | critical |
| api.schema.database-column.data-store.column                         | [schema](./06-api-layer-report.md#schema)                 | [column](./08-data-store-layer-report.md#column)                          | [Data Store](./08-data-store-layer-report.md)   | database-column        | many-to-one  | medium   |
| api.schema.database-table.data-store.table                           | [schema](./06-api-layer-report.md#schema)                 | [table](./08-data-store-layer-report.md#table)                            | [Data Store](./08-data-store-layer-report.md)   | database-table         | many-to-one  | medium   |
| api.securityscheme.archimate-ref.application.applicationservice      | [securityscheme](./06-api-layer-report.md#securityscheme) | [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref          | many-to-one  | medium   |
| api.securityscheme.business-interface-ref.business.businessinterface | [securityscheme](./06-api-layer-report.md#securityscheme) | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | business-interface-ref | many-to-one  | medium   |
| api.securityscheme.business-service-ref.business.businessservice     | [securityscheme](./06-api-layer-report.md#securityscheme) | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | business-service-ref   | many-to-one  | medium   |
| api.securityscheme.database-table.data-store.table                   | [securityscheme](./06-api-layer-report.md#securityscheme) | [table](./08-data-store-layer-report.md#table)                            | [Data Store](./08-data-store-layer-report.md)   | database-table         | many-to-one  | medium   |
| api.securityscheme.referenced-by.business.businessinterface          | [securityscheme](./06-api-layer-report.md#securityscheme) | [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | referenced-by          | many-to-one  | medium   |
| api.securityscheme.referenced-by.business.businessservice            | [securityscheme](./06-api-layer-report.md#securityscheme) | [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | referenced-by          | many-to-one  | medium   |
| api.securityscheme.referenced-by.security.permission                 | [securityscheme](./06-api-layer-report.md#securityscheme) | [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | referenced-by          | many-to-many | medium   |
| api.securityscheme.referenced-by.security.secureresource             | [securityscheme](./06-api-layer-report.md#securityscheme) | [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | referenced-by          | many-to-one  | medium   |
| api.securityscheme.required-permissions.security.permission          | [securityscheme](./06-api-layer-report.md#securityscheme) | [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | required-permissions   | many-to-many | critical |
| api.securityscheme.security-resource.security.secureresource         | [securityscheme](./06-api-layer-report.md#securityscheme) | [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | security-resource      | many-to-one  | critical |

## Node Reference

### Callback {#callback}

**Spec Node ID**: `api.callback`

Defines a webhook or callback URL pattern where the API will send asynchronous notifications. Enables event-driven integrations and async workflows.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node            | Predicate | Direction | Cardinality  |
| ----------------------- | --------- | --------- | ------------ |
| [operation](#operation) | triggers  | inbound   | many-to-many |

[Back to Index](#report-index)

### Components {#components}

**Spec Node ID**: `api.components`

Reusable component definitions

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node            | Predicate | Direction | Cardinality  |
| ----------------------- | --------- | --------- | ------------ |
| [schema](#schema)       | composes  | outbound  | many-to-many |
| [responses](#responses) | composes  | outbound  | many-to-many |
| [paths](#paths)         | composes  | outbound  | many-to-many |

[Back to Index](#report-index)

### Contact {#contact}

**Spec Node ID**: `api.contact`

Contact information for the API owner or maintainer, including name, email, and URL. Enables consumers to reach out for support or collaboration.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [openapidocument](#openapidocument) | associated-with | outbound  | many-to-many |

[Back to Index](#report-index)

### Encoding {#encoding}

**Spec Node ID**: `api.encoding`

Specifies serialization details for multipart request body properties, including content-type, headers, and encoding style. Handles complex content negotiation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Example {#example}

**Spec Node ID**: `api.example`

Provides sample values for request bodies, responses, or parameters. Improves documentation clarity and enables automated testing or mocking.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Externaldocumentation {#externaldocumentation}

**Spec Node ID**: `api.externaldocumentation`

A reference to external documentation resources (URLs, wikis, guides) that provide additional context beyond the inline API specification. Links API elements to comprehensive documentation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Header {#header}

**Spec Node ID**: `api.header`

Defines HTTP header parameters for requests or responses, specifying name, schema, required status, and description. Documents header-based communication requirements.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Info {#info}

**Spec Node ID**: `api.info`

Metadata about the API

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### License {#license}

**Spec Node ID**: `api.license`

Specifies the legal license under which the API is provided, including license name and URL to full terms. Clarifies usage rights for API consumers.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate       | Direction | Cardinality  |
| ----------------------------------- | --------------- | --------- | ------------ |
| [openapidocument](#openapidocument) | associated-with | outbound  | many-to-many |

[Back to Index](#report-index)

### Link {#link}

**Spec Node ID**: `api.link`

Describes a relationship between API responses and subsequent operations, enabling hypermedia-driven API navigation. Supports HATEOAS design patterns.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node            | Predicate  | Direction | Cardinality  |
| ----------------------- | ---------- | --------- | ------------ |
| [tag](#tag)             | references | outbound  | many-to-many |
| [schema](#schema)       | references | outbound  | many-to-many |
| [operation](#operation) | references | outbound  | many-to-many |

[Back to Index](#report-index)

### Mediatype {#mediatype}

**Spec Node ID**: `api.mediatype`

Media type and schema for request/response body

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Oauthflow {#oauthflow}

**Spec Node ID**: `api.oauthflow`

Individual OAuth 2.0 flow configuration

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Oauthflows {#oauthflows}

**Spec Node ID**: `api.oauthflows`

Configuration for OAuth 2.0 authentication flows (implicit, password, clientCredentials, authorizationCode), specifying authorization URLs, token URLs, and scopes. Defines OAuth security implementation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Openapidocument {#openapidocument}

**Spec Node ID**: `api.openapidocument`

Root of an OpenAPI specification file

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 5
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node            | Predicate       | Direction | Cardinality  |
| ----------------------- | --------------- | --------- | ------------ |
| [schema](#schema)       | composes        | outbound  | many-to-many |
| [responses](#responses) | composes        | outbound  | many-to-many |
| [paths](#paths)         | composes        | outbound  | many-to-many |
| [tag](#tag)             | aggregates      | outbound  | many-to-many |
| [server](#server)       | aggregates      | outbound  | many-to-many |
| [license](#license)     | associated-with | inbound   | many-to-many |
| [contact](#contact)     | associated-with | inbound   | many-to-many |

[Back to Index](#report-index)

### Operation {#operation}

**Spec Node ID**: `api.operation`

Single API operation (HTTP method on a path)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 9
- **Inter-Layer**: Inbound: 0 | Outbound: 10

#### Intra-Layer Relationships

| Related Node                      | Predicate  | Direction | Cardinality  |
| --------------------------------- | ---------- | --------- | ------------ |
| [securityscheme](#securityscheme) | serves     | inbound   | many-to-many |
| [schema](#schema)                 | references | inbound   | many-to-many |
| [parameter](#parameter)           | references | inbound   | many-to-many |
| [callback](#callback)             | triggers   | outbound  | many-to-many |
| [tag](#tag)                       | references | outbound  | many-to-many |
| [schema](#schema)                 | references | outbound  | many-to-many |
| [operation](#operation)           | references | outbound  | many-to-many |
| [schema](#schema)                 | composes   | outbound  | many-to-many |
| [responses](#responses)           | composes   | outbound  | many-to-many |
| [paths](#paths)                   | composes   | outbound  | many-to-many |
| [tag](#tag)                       | aggregates | outbound  | many-to-many |
| [server](#server)                 | aggregates | outbound  | many-to-many |
| [link](#link)                     | references | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate              | Direction | Cardinality  |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------- | --------- | ------------ |
| [traceconfiguration](./11-apm-layer-report.md#traceconfiguration)         | [APM](./11-apm-layer-report.md)                 | apm-trace              | outbound  | many-to-one  |
| [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref          | outbound  | many-to-one  |
| [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | business-interface-ref | outbound  | many-to-one  |
| [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | business-service-ref   | outbound  | many-to-one  |
| [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | referenced-by          | outbound  | many-to-one  |
| [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | referenced-by          | outbound  | many-to-one  |
| [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | referenced-by          | outbound  | many-to-many |
| [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | referenced-by          | outbound  | many-to-one  |
| [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | required-permissions   | outbound  | many-to-many |
| [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | security-resource      | outbound  | many-to-one  |

[Back to Index](#report-index)

### Parameter {#parameter}

**Spec Node ID**: `api.parameter`

Parameter for an operation

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node            | Predicate  | Direction | Cardinality  |
| ----------------------- | ---------- | --------- | ------------ |
| [tag](#tag)             | references | outbound  | many-to-many |
| [schema](#schema)       | references | outbound  | many-to-many |
| [operation](#operation) | references | outbound  | many-to-many |

[Back to Index](#report-index)

### Parameterlocation {#parameterlocation}

**Spec Node ID**: `api.parameterlocation`

ParameterLocation element in API Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Parameterstyle {#parameterstyle}

**Spec Node ID**: `api.parameterstyle`

ParameterStyle element in API Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Pathitem {#pathitem}

**Spec Node ID**: `api.pathitem`

Operations available on a path

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Paths {#paths}

**Spec Node ID**: `api.paths`

Available API endpoints and operations

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate | Direction | Cardinality  |
| ----------------------------------- | --------- | --------- | ------------ |
| [operation](#operation)             | composes  | inbound   | many-to-many |
| [openapidocument](#openapidocument) | composes  | inbound   | many-to-many |
| [components](#components)           | composes  | inbound   | many-to-many |

[Back to Index](#report-index)

### Requestbody {#requestbody}

**Spec Node ID**: `api.requestbody`

Request payload for an operation

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Response {#response}

**Spec Node ID**: `api.response`

Single response definition

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Responses {#responses}

**Spec Node ID**: `api.responses`

Possible responses from an operation

#### Relationship Metrics

- **Intra-Layer**: Inbound: 3 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate | Direction | Cardinality  |
| ----------------------------------- | --------- | --------- | ------------ |
| [operation](#operation)             | composes  | inbound   | many-to-many |
| [openapidocument](#openapidocument) | composes  | inbound   | many-to-many |
| [components](#components)           | composes  | inbound   | many-to-many |

[Back to Index](#report-index)

### Schema {#schema}

**Spec Node ID**: `api.schema`

Data type definition (JSON Schema subset)

#### Relationship Metrics

- **Intra-Layer**: Inbound: 8 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 2

#### Intra-Layer Relationships

| Related Node                        | Predicate   | Direction | Cardinality  |
| ----------------------------------- | ----------- | --------- | ------------ |
| [schema](#schema)                   | specializes | outbound  | many-to-many |
| [tag](#tag)                         | references  | outbound  | many-to-many |
| [schema](#schema)                   | references  | outbound  | many-to-many |
| [operation](#operation)             | references  | outbound  | many-to-many |
| [parameter](#parameter)             | references  | inbound   | many-to-many |
| [operation](#operation)             | references  | inbound   | many-to-many |
| [operation](#operation)             | composes    | inbound   | many-to-many |
| [openapidocument](#openapidocument) | composes    | inbound   | many-to-many |
| [link](#link)                       | references  | inbound   | many-to-many |
| [components](#components)           | composes    | inbound   | many-to-many |

#### Inter-Layer Relationships

| Related Node                                     | Layer                                         | Predicate       | Direction | Cardinality |
| ------------------------------------------------ | --------------------------------------------- | --------------- | --------- | ----------- |
| [column](./08-data-store-layer-report.md#column) | [Data Store](./08-data-store-layer-report.md) | database-column | outbound  | many-to-one |
| [table](./08-data-store-layer-report.md#table)   | [Data Store](./08-data-store-layer-report.md) | database-table  | outbound  | many-to-one |

[Back to Index](#report-index)

### Securityscheme {#securityscheme}

**Spec Node ID**: `api.securityscheme`

Security mechanism for the API

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 10

#### Intra-Layer Relationships

| Related Node            | Predicate | Direction | Cardinality  |
| ----------------------- | --------- | --------- | ------------ |
| [operation](#operation) | serves    | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate              | Direction | Cardinality  |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------- | --------- | ------------ |
| [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | archimate-ref          | outbound  | many-to-one  |
| [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | business-interface-ref | outbound  | many-to-one  |
| [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | business-service-ref   | outbound  | many-to-one  |
| [table](./08-data-store-layer-report.md#table)                            | [Data Store](./08-data-store-layer-report.md)   | database-table         | outbound  | many-to-one  |
| [businessinterface](./02-business-layer-report.md#businessinterface)      | [Business](./02-business-layer-report.md)       | referenced-by          | outbound  | many-to-one  |
| [businessservice](./02-business-layer-report.md#businessservice)          | [Business](./02-business-layer-report.md)       | referenced-by          | outbound  | many-to-one  |
| [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | referenced-by          | outbound  | many-to-many |
| [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | referenced-by          | outbound  | many-to-one  |
| [permission](./03-security-layer-report.md#permission)                    | [Security](./03-security-layer-report.md)       | required-permissions   | outbound  | many-to-many |
| [secureresource](./03-security-layer-report.md#secureresource)            | [Security](./03-security-layer-report.md)       | security-resource      | outbound  | many-to-one  |

[Back to Index](#report-index)

### Securitytype {#securitytype}

**Spec Node ID**: `api.securitytype`

SecurityType element in API Layer

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Server {#server}

**Spec Node ID**: `api.server`

Server where the API is available

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate  | Direction | Cardinality  |
| ----------------------------------- | ---------- | --------- | ------------ |
| [operation](#operation)             | aggregates | inbound   | many-to-many |
| [openapidocument](#openapidocument) | aggregates | inbound   | many-to-many |

[Back to Index](#report-index)

### Servervariable {#servervariable}

**Spec Node ID**: `api.servervariable`

A variable placeholder in server URL templates that can be substituted at runtime. Enables dynamic server addressing for different environments or tenants.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

[Back to Index](#report-index)

### Tag {#tag}

**Spec Node ID**: `api.tag`

A metadata label used to group and categorize API operations for documentation organization. Enables logical grouping of endpoints in generated API documentation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 0
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                        | Predicate  | Direction | Cardinality  |
| ----------------------------------- | ---------- | --------- | ------------ |
| [schema](#schema)                   | references | inbound   | many-to-many |
| [parameter](#parameter)             | references | inbound   | many-to-many |
| [operation](#operation)             | references | inbound   | many-to-many |
| [operation](#operation)             | aggregates | inbound   | many-to-many |
| [openapidocument](#openapidocument) | aggregates | inbound   | many-to-many |
| [link](#link)                       | references | inbound   | many-to-many |

[Back to Index](#report-index)

---

_Generated: 2026-02-13T12:04:30.782Z | Spec Version: 0.8.0 | Commit: 4c0d881 | Generator: generate-layer-reports.ts_
