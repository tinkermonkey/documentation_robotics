# APM Observability Layer

## Report Index

- [Layer Introduction](#layer-introduction)
- [Intra-Layer Relationships](#intra-layer-relationships)
- [Inter-Layer Dependencies](#inter-layer-dependencies)
- [Inter-Layer Relationships Table](#inter-layer-relationships-table)
- [Node Reference](#node-reference)
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
| Node Types                | 13    |
| Intra-Layer Relationships | 55    |
| Inter-Layer Relationships | 2     |
| Inbound Relationships     | 2     |
| Outbound Relationships    | 0     |

### Layer Dependencies

**Depends On**: [Application](./04-application-layer-report.md), [API](./06-api-layer-report.md)

**Depended On By**: None

## Intra-Layer Relationships

```mermaid
flowchart LR
  subgraph apm
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
  api --> security
  application --> apm
  application --> business
  application --> motivation
  business --> application
  business --> motivation
  business --> security
  data_model --> application
  data_model --> business
  testing --> motivation
  class apm current
```

## Inter-Layer Relationships Table

| Relationship ID                                                  | Source Node                                                               | Dest Node                                                         | Dest Layer                      | Predicate  | Cardinality | Strength |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- | ---------- | ----------- | -------- |
| api.operation.references.apm.traceconfiguration                  | [operation](./06-api-layer-report.md#operation)                           | [traceconfiguration](./11-apm-layer-report.md#traceconfiguration) | [APM](./11-apm-layer-report.md) | references | many-to-one | medium   |
| application.applicationservice.references.apm.traceconfiguration | [applicationservice](./04-application-layer-report.md#applicationservice) | [traceconfiguration](./11-apm-layer-report.md#traceconfiguration) | [APM](./11-apm-layer-report.md) | references | many-to-one | medium   |

## Node Reference

### Exporterconfig {#exporterconfig}

**Spec Node ID**: `apm.exporterconfig`

Configuration for telemetry data export destinations, specifying protocol (OTLP, Jaeger, Prometheus), endpoints, authentication, batching, and retry policies. Controls where observability data is sent.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 1
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [resource](#resource)                         | serves     | outbound  | many-to-many |
| [instrumentationscope](#instrumentationscope) | aggregates | inbound   | many-to-many |
| [logconfiguration](#logconfiguration)         | aggregates | inbound   | many-to-one  |
| [logconfiguration](#logconfiguration)         | flows-to   | inbound   | many-to-one  |
| [logprocessor](#logprocessor)                 | flows-to   | inbound   | many-to-many |
| [metricconfiguration](#metricconfiguration)   | aggregates | inbound   | many-to-one  |
| [metricinstrument](#metricinstrument)         | flows-to   | inbound   | many-to-many |
| [resource](#resource)                         | aggregates | inbound   | many-to-many |
| [span](#span)                                 | flows-to   | inbound   | many-to-many |
| [spanevent](#spanevent)                       | flows-to   | inbound   | many-to-one  |
| [traceconfiguration](#traceconfiguration)     | aggregates | inbound   | many-to-many |

[Back to Index](#report-index)

### Instrumentationconfig {#instrumentationconfig}

**Spec Node ID**: `apm.instrumentationconfig`

Configuration for OTel instrumentation of application code. Auto-instrumentation uses SDK contrib plugin libraries (e.g., opentelemetry-instrumentation-express) that hook into frameworks transparently at SDK bootstrap time. Manual instrumentation uses direct OTel API calls (Tracer.startSpan, Meter.createCounter) embedded in application code. This node controls which libraries or code paths are instrumented and whether instrumentation is enabled.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 2
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate | Direction | Cardinality  |
| --------------------------------------------- | --------- | --------- | ------------ |
| [instrumentationscope](#instrumentationscope) | serves    | outbound  | many-to-one  |
| [resource](#resource)                         | serves    | outbound  | many-to-many |
| [metricconfiguration](#metricconfiguration)   | serves    | inbound   | many-to-one  |

[Back to Index](#report-index)

### Instrumentationscope {#instrumentationscope}

**Spec Node ID**: `apm.instrumentationscope`

Named instrumented library or component that identifies the source of telemetry across all three OTel signal types (traces, metrics, logs), enabling attribution and filtering of signals by their origin.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate  | Direction | Cardinality  |
| ----------------------------------------------- | ---------- | --------- | ------------ |
| [instrumentationconfig](#instrumentationconfig) | serves     | inbound   | many-to-one  |
| [exporterconfig](#exporterconfig)               | aggregates | outbound  | many-to-many |
| [metricinstrument](#metricinstrument)           | aggregates | outbound  | many-to-many |
| [span](#span)                                   | aggregates | outbound  | many-to-many |
| [logrecord](#logrecord)                         | depends-on | inbound   | many-to-many |
| [metricinstrument](#metricinstrument)           | depends-on | inbound   | many-to-many |
| [span](#span)                                   | depends-on | inbound   | many-to-many |
| [spanevent](#spanevent)                         | depends-on | inbound   | many-to-one  |

[Back to Index](#report-index)

### Logconfiguration {#logconfiguration}

**Spec Node ID**: `apm.logconfiguration`

OTel LoggerProvider configuration, covering the LogRecordProcessor pipeline, LogRecordExporter wiring, and minimum severity filtering for log emission.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 7
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                              | Predicate  | Direction | Cardinality |
| ----------------------------------------- | ---------- | --------- | ----------- |
| [exporterconfig](#exporterconfig)         | aggregates | outbound  | many-to-one |
| [logprocessor](#logprocessor)             | aggregates | outbound  | many-to-one |
| [resource](#resource)                     | depends-on | outbound  | many-to-one |
| [exporterconfig](#exporterconfig)         | flows-to   | outbound  | many-to-one |
| [traceconfiguration](#traceconfiguration) | references | outbound  | many-to-one |
| [logrecord](#logrecord)                   | serves     | outbound  | many-to-one |
| [resource](#resource)                     | serves     | outbound  | many-to-one |

[Back to Index](#report-index)

### Logprocessor {#logprocessor}

**Spec Node ID**: `apm.logprocessor`

A processing pipeline component for log records, enabling filtering, transformation, enrichment, or routing of logs before export. Customizes log processing behavior.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 5 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                          | Predicate  | Direction | Cardinality  |
| ------------------------------------- | ---------- | --------- | ------------ |
| [logconfiguration](#logconfiguration) | aggregates | inbound   | many-to-one  |
| [exporterconfig](#exporterconfig)     | flows-to   | outbound  | many-to-many |
| [logprocessor](#logprocessor)         | flows-to   | outbound  | many-to-many |
| [span](#span)                         | flows-to   | outbound  | many-to-many |
| [logrecord](#logrecord)               | flows-to   | inbound   | many-to-one  |
| [metricinstrument](#metricinstrument) | flows-to   | inbound   | many-to-many |
| [span](#span)                         | flows-to   | inbound   | many-to-many |

[Back to Index](#report-index)

### Logrecord {#logrecord}

**Spec Node ID**: `apm.logrecord`

Structured log record in the OTel data model, capturing an event with dual timestamps (timeUnixNano for event occurrence, observedTimeUnixNano for ingestion), a 1–24 severity scale, and an unstructured body. Supports trace context correlation to link logs to distributed traces.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 2 | Outbound: 4
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [logconfiguration](#logconfiguration)         | serves     | inbound   | many-to-one  |
| [instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-many |
| [resource](#resource)                         | depends-on | outbound  | many-to-many |
| [logprocessor](#logprocessor)                 | flows-to   | outbound  | many-to-one  |
| [span](#span)                                 | references | outbound  | many-to-many |
| [spanevent](#spanevent)                       | references | inbound   | many-to-one  |

[Back to Index](#report-index)

### Metricconfiguration {#metricconfiguration}

**Spec Node ID**: `apm.metricconfiguration`

OTel MeterProvider-level (global) metrics SDK configuration, covering export intervals, cardinality limits, and exemplar filtering. Distinct from per-meter configuration in MeterConfig.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 0 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate  | Direction | Cardinality |
| ----------------------------------------------- | ---------- | --------- | ----------- |
| [exporterconfig](#exporterconfig)               | aggregates | outbound  | many-to-one |
| [metricinstrument](#metricinstrument)           | aggregates | outbound  | many-to-one |
| [resource](#resource)                           | depends-on | outbound  | many-to-one |
| [traceconfiguration](#traceconfiguration)       | references | outbound  | many-to-one |
| [instrumentationconfig](#instrumentationconfig) | serves     | outbound  | many-to-one |
| [resource](#resource)                           | serves     | outbound  | many-to-one |

[Back to Index](#report-index)

### Metricinstrument {#metricinstrument}

**Spec Node ID**: `apm.metricinstrument`

Defines a specific metric measurement instrument (Counter, Gauge, Histogram, etc.) with its name, unit, description, and attributes. The fundamental unit of metric collection.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 6 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [instrumentationscope](#instrumentationscope) | aggregates | inbound   | many-to-many |
| [metricconfiguration](#metricconfiguration)   | aggregates | inbound   | many-to-one  |
| [instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-many |
| [resource](#resource)                         | depends-on | outbound  | many-to-many |
| [exporterconfig](#exporterconfig)             | flows-to   | outbound  | many-to-many |
| [logprocessor](#logprocessor)                 | flows-to   | outbound  | many-to-many |
| [span](#span)                                 | flows-to   | outbound  | many-to-many |
| [span](#span)                                 | references | outbound  | many-to-one  |
| [resource](#resource)                         | aggregates | inbound   | many-to-many |
| [span](#span)                                 | composes   | inbound   | many-to-many |
| [spanevent](#spanevent)                       | triggers   | inbound   | many-to-one  |
| [traceconfiguration](#traceconfiguration)     | aggregates | inbound   | many-to-many |

[Back to Index](#report-index)

### Resource {#resource}

**Spec Node ID**: `apm.resource`

Immutable set of attributes identifying the entity (service, host, process) that produces telemetry. Resource attributes are merged into all signals (traces, metrics, logs) emitted by a process at the SDK level, making accurate resource definition critical for cross-signal correlation.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 3
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                    | Predicate  | Direction | Cardinality  |
| ----------------------------------------------- | ---------- | --------- | ------------ |
| [exporterconfig](#exporterconfig)               | serves     | inbound   | many-to-many |
| [instrumentationconfig](#instrumentationconfig) | serves     | inbound   | many-to-many |
| [logconfiguration](#logconfiguration)           | depends-on | inbound   | many-to-one  |
| [logconfiguration](#logconfiguration)           | serves     | inbound   | many-to-one  |
| [logrecord](#logrecord)                         | depends-on | inbound   | many-to-many |
| [metricconfiguration](#metricconfiguration)     | depends-on | inbound   | many-to-one  |
| [metricconfiguration](#metricconfiguration)     | serves     | inbound   | many-to-one  |
| [metricinstrument](#metricinstrument)           | depends-on | inbound   | many-to-many |
| [exporterconfig](#exporterconfig)               | aggregates | outbound  | many-to-many |
| [metricinstrument](#metricinstrument)           | aggregates | outbound  | many-to-many |
| [span](#span)                                   | aggregates | outbound  | many-to-many |
| [span](#span)                                   | depends-on | inbound   | many-to-many |
| [spanevent](#spanevent)                         | depends-on | inbound   | many-to-one  |

[Back to Index](#report-index)

### Span {#span}

**Spec Node ID**: `apm.span`

Unit of work in distributed tracing

#### Relationship Metrics

- **Intra-Layer**: Inbound: 10 | Outbound: 10
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [instrumentationscope](#instrumentationscope) | aggregates | inbound   | many-to-many |
| [logprocessor](#logprocessor)                 | flows-to   | inbound   | many-to-many |
| [logrecord](#logrecord)                       | references | inbound   | many-to-many |
| [metricinstrument](#metricinstrument)         | flows-to   | inbound   | many-to-many |
| [metricinstrument](#metricinstrument)         | references | inbound   | many-to-one  |
| [resource](#resource)                         | aggregates | inbound   | many-to-many |
| [spanlink](#spanlink)                         | aggregates | outbound  | one-to-many  |
| [metricinstrument](#metricinstrument)         | composes   | outbound  | many-to-many |
| [spanevent](#spanevent)                       | composes   | outbound  | many-to-many |
| [traceconfiguration](#traceconfiguration)     | composes   | outbound  | many-to-many |
| [instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-many |
| [resource](#resource)                         | depends-on | outbound  | many-to-many |
| [exporterconfig](#exporterconfig)             | flows-to   | outbound  | many-to-many |
| [logprocessor](#logprocessor)                 | flows-to   | outbound  | many-to-many |
| [span](#span)                                 | flows-to   | outbound  | many-to-many |
| [span](#span)                                 | references | outbound  | many-to-many |
| [spanlink](#spanlink)                         | references | inbound   | many-to-many |
| [traceconfiguration](#traceconfiguration)     | aggregates | inbound   | many-to-many |

[Back to Index](#report-index)

### Spanevent {#spanevent}

**Spec Node ID**: `apm.spanevent`

Timestamped annotation within a span's lifetime, used to record significant moments such as exceptions (OTel semantic convention: name='exception' with exception.type, exception.message, and exception.stacktrace attributes) or state transitions.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 1 | Outbound: 6
- **Inter-Layer**: Inbound: 0 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                  | Predicate  | Direction | Cardinality  |
| --------------------------------------------- | ---------- | --------- | ------------ |
| [span](#span)                                 | composes   | inbound   | many-to-many |
| [instrumentationscope](#instrumentationscope) | depends-on | outbound  | many-to-one  |
| [resource](#resource)                         | depends-on | outbound  | many-to-one  |
| [traceconfiguration](#traceconfiguration)     | depends-on | outbound  | many-to-one  |
| [exporterconfig](#exporterconfig)             | flows-to   | outbound  | many-to-one  |
| [logrecord](#logrecord)                       | references | outbound  | many-to-one  |
| [metricinstrument](#metricinstrument)         | triggers   | outbound  | many-to-one  |

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
| [span](#span) | aggregates | inbound   | one-to-many  |
| [span](#span) | references | outbound  | many-to-many |

[Back to Index](#report-index)

### Traceconfiguration {#traceconfiguration}

**Spec Node ID**: `apm.traceconfiguration`

OTel TracerProvider configuration covering sampler selection, context propagation formats, and span processor pipeline. Service identity attributes (serviceName, serviceVersion, deploymentEnvironment) are OTel Resource semantic conventions and belong on the Resource node.

#### Relationship Metrics

- **Intra-Layer**: Inbound: 4 | Outbound: 3
- **Inter-Layer**: Inbound: 2 | Outbound: 0

#### Intra-Layer Relationships

| Related Node                                | Predicate  | Direction | Cardinality  |
| ------------------------------------------- | ---------- | --------- | ------------ |
| [logconfiguration](#logconfiguration)       | references | inbound   | many-to-one  |
| [metricconfiguration](#metricconfiguration) | references | inbound   | many-to-one  |
| [span](#span)                               | composes   | inbound   | many-to-many |
| [spanevent](#spanevent)                     | depends-on | inbound   | many-to-one  |
| [exporterconfig](#exporterconfig)           | aggregates | outbound  | many-to-many |
| [metricinstrument](#metricinstrument)       | aggregates | outbound  | many-to-many |
| [span](#span)                               | aggregates | outbound  | many-to-many |

#### Inter-Layer Relationships

| Related Node                                                              | Layer                                           | Predicate  | Direction | Cardinality |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ---------- | --------- | ----------- |
| [operation](./06-api-layer-report.md#operation)                           | [API](./06-api-layer-report.md)                 | references | inbound   | many-to-one |
| [applicationservice](./04-application-layer-report.md#applicationservice) | [Application](./04-application-layer-report.md) | references | inbound   | many-to-one |

[Back to Index](#report-index)

---

_Generated: 2026-02-28T12:48:58.614Z | Spec Version: 0.8.0 | Generator: generate-layer-reports.ts_
