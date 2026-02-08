# Layer 11: APM Observability Layer

Layer 11: APM Observability Layer

**Standard**: [OpenTelemetry 1.0](https://opentelemetry.io/)

---

## Overview

Layer 11: APM Observability Layer

This layer defines **35** node types that represent various aspects of the architecture.

## Node Types

### SamplerType

**ID**: `apm.samplertype`

SamplerType element in APM Observability Layer


### LogProcessor

**ID**: `apm.logprocessor`

A processing pipeline component for log records, enabling filtering, transformation, enrichment, or routing of logs before export. Customizes log processing behavior.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `order`: integer
- `enabled`: boolean

### LogProcessorType

**ID**: `apm.logprocessortype`

LogProcessorType element in APM Observability Layer


### SpanKind

**ID**: `apm.spankind`

SpanKind element in APM Observability Layer


### LogLevel

**ID**: `apm.loglevel`

LogLevel element in APM Observability Layer


### InstrumentationType

**ID**: `apm.instrumentationtype`

InstrumentationType element in APM Observability Layer


### CompressionType

**ID**: `apm.compressiontype`

CompressionType element in APM Observability Layer


### SpanEvent

**ID**: `apm.spanevent`

Timestamped event during span execution

**Attributes**:

- `id`: string (uuid) (required)
- `timeUnixNano`: string (required)
- `name`: string (required)
- `droppedAttributesCount`: string (required)
- `attributes`: array
  - Contains relationship

### AuthType

**ID**: `apm.authtype`

AuthType element in APM Observability Layer


### Attribute

**ID**: `apm.attribute`

Key-value pair metadata

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `key`: string (required)
- `value`: string (required)

### DataQualityMetric

**ID**: `apm.dataqualitymetric`

Individual data quality metric

**Attributes**:

- `type`: string (required)
- `name`: string (required)
- `description`: string
- `measurement`: string (required)
- `threshold`: string (required)
- `alertOnViolation`: boolean

### Span

**ID**: `apm.span`

Unit of work in distributed tracing

**Attributes**:

- `id`: string (uuid) (required)
- `traceId`: string (required)
- `spanId`: string (required)
- `traceState`: string (required)
- `parentSpanId`: string (required)
- `name`: string (required)
- `spanKind`: string (required)
- `startTimeUnixNano`: string (required)
- `endTimeUnixNano`: string (required)
- `droppedAttributesCount`: string (required)
- `droppedEventsCount`: string (required)
- `droppedLinksCount`: string (required)
- `attributes`: array
  - Contains relationship
- `events`: array
  - Contains relationship
- `links`: array
  - Contains relationship

### SpanLink

**ID**: `apm.spanlink`

Link to related span (different trace or parent)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `traceId`: string (required)
- `spanId`: string (required)
- `traceState`: string
- `droppedAttributesCount`: string (required)
- `attributes`: array
  - Contains relationship

### AggregationTemporality

**ID**: `apm.aggregationtemporality`

AggregationTemporality element in APM Observability Layer


### ExporterType

**ID**: `apm.exportertype`

ExporterType element in APM Observability Layer


### LogRecord

**ID**: `apm.logrecord`

OpenTelemetry log entry

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `timeUnixNano`: string (required)
- `observedTimeUnixNano`: string (required)
- `severityNumber`: string (required)
- `severityText`: string
- `body`: string (required)
- `flags`: string (required)
- `droppedAttributesCount`: string (required)
- `attributes`: array
  - Contains relationship

### MeterConfig

**ID**: `apm.meterconfig`

Configuration for metric collection meters, specifying aggregation temporality, cardinality limits, and collection intervals. Controls how metrics are gathered and aggregated.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `version`: string
- `schemaUrl`: string
- `instruments`: array
  - Contains relationship

### ExporterProtocol

**ID**: `apm.exporterprotocol`

ExporterProtocol element in APM Observability Layer


### MetricConfiguration

**ID**: `apm.metricconfiguration`

Metrics configuration

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `serviceName`: string (required)
- `exportIntervalMillis`: integer

### DataQualityType

**ID**: `apm.dataqualitytype`

DataQualityType element in APM Observability Layer


### InstrumentType

**ID**: `apm.instrumenttype`

InstrumentType element in APM Observability Layer


### LogConfiguration

**ID**: `apm.logconfiguration`

Logging configuration

**Attributes**:

- `name`: string (required)
- `id`: string (uuid) (required)
- `serviceName`: string (required)
- `logLevel`: string (required)

### InstrumentationScope

**ID**: `apm.instrumentationscope`

Logical unit of code that generates telemetry

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string
- `schemaUrl`: string
- `droppedAttributesCount`: string (required)
- `attributes`: array
  - Contains relationship

### Resource

**ID**: `apm.resource`

Immutable representation of entity producing telemetry

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `schemaUrl`: string
- `droppedAttributesCount`: string (required)
- `attributes`: array
  - Contains relationship

### TransformOperation

**ID**: `apm.transformoperation`

TransformOperation element in APM Observability Layer


### DataQualityMetrics

**ID**: `apm.dataqualitymetrics`

Data quality monitoring metrics (referenced by Data Model Layer x-apm-data-quality-metrics)

**Attributes**:

- `schemaRef`: string (required)
- `monitoringEnabled`: boolean
- `metrics`: array
  - Contains relationship

### TraceConfiguration

**ID**: `apm.traceconfiguration`

Distributed tracing configuration

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `serviceName`: string (required)
- `serviceVersion`: string
- `deploymentEnvironment`: string
- `source`: object
  - Source code reference for trace configuration

### InstrumentationConfig

**ID**: `apm.instrumentationconfig`

Configuration for automatic or manual instrumentation of application code, specifying which libraries, frameworks, or code paths to instrument and capture telemetry from.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `enabled`: boolean
- `description`: string

### MetricInstrument

**ID**: `apm.metricinstrument`

Defines a specific metric measurement instrument (Counter, Gauge, Histogram, etc.) with its name, unit, description, and attributes. The fundamental unit of metric collection.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `unit`: string (required)
- `description`: string
- `enabled`: boolean
- `source`: object
  - Source code reference for code-defined metrics

### ExporterConfig

**ID**: `apm.exporterconfig`

Configuration for telemetry data export destinations, specifying protocol (OTLP, Jaeger, Prometheus), endpoints, authentication, batching, and retry policies. Controls where observability data is sent.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `enabled`: boolean
- `endpoint`: string (required)
- `protocol`: string

### SpanStatus

**ID**: `apm.spanstatus`

Outcome of span execution

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `code`: string (required)
- `message`: string

### APMConfiguration

**ID**: `apm.apmconfiguration`

Complete APM configuration for an application

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string (required)
- `application`: string (required)

### SeverityNumber

**ID**: `apm.severitynumber`

SeverityNumber element in APM Observability Layer


### PropagatorType

**ID**: `apm.propagatortype`

PropagatorType element in APM Observability Layer


### StatusCode

**ID**: `apm.statuscode`

StatusCode element in APM Observability Layer



## References

- [OpenTelemetry 1.0](https://opentelemetry.io/)
