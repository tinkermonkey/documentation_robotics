---
name: LAYER_11_APM
description: Expert knowledge for APM (Observability) Layer modeling in Documentation Robotics
triggers:
  [
    "APM",
    "observability",
    "monitoring",
    "metrics",
    "spans",
    "traces",
    "logs",
    "OpenTelemetry",
    "telemetry"
  ]
version: 0.8.3
---

# APM Layer Skill

**Layer Number:** 11
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines observability using OpenTelemetry 1.0+, specifying traces, metrics, logs, and instrumentation.

---

## Layer Overview

The APM Layer captures **application performance monitoring**:

- **TRACES** - Distributed tracing with spans
- **METRICS** - Performance and business metrics
- **LOGS** - Structured logging
- **INSTRUMENTATION** - Code instrumentation configuration
- **RESOURCES** - Telemetry resource attributes
- **ALERTING** - Alert rules and monitoring dashboards

This layer uses **OpenTelemetry 1.0+** (industry standard for observability).

**Central Entity:** The **Span** (unit of work in trace) is the core modeling unit.

---

## Pre-Extraction Verification

Before extracting APM elements, verify what level of observability the codebase ACTUALLY implements. Do not model aspirational instrumentation.

### Step 1: Check for OTel SDK

```bash
grep "@opentelemetry" package.json
```

**If NO OTel SDK found:**

- Do NOT add `MetricInstrument`, `Span`, `TraceConfiguration`, or `ExporterConfig` elements as if they are implemented
- ONLY model what exists: browser console logging (`LogConfiguration`), UI-displayed metrics (describe in element description that export is absent)
- Mark all elements `provenance: inferred` and add a note in the description: "Metric concept identified; no OTel export implemented."

**If OTel SDK IS found:**

- Proceed with full extraction of all APM types

### Step 2: Identify what observability actually exists

Even without OTel, codebases may have:

- Browser console error logging → `apm.logconfiguration`
- UI-visible token/usage counters → `apm.metricinstrument` (with note: display-only, not exported)
- Error tracking utilities → `apm.instrumentationconfig` (type: manual)
- In-memory state tracking → `apm.metricinstrument` (inferred, note: in-memory only)

### In-UI Observability vs. OTel Instrumentation

| Pattern                         | Model as                                  | provenance |
| ------------------------------- | ----------------------------------------- | ---------- |
| `console.error()` logging       | `logconfiguration`                        | extracted  |
| UI badge showing token count    | `metricinstrument` (note: display-only)   | inferred   |
| Store tracks reconnection count | `metricinstrument` (note: in-memory only) | inferred   |
| `opentelemetry.createCounter()` | `metricinstrument`                        | extracted  |
| Prometheus export endpoint      | `exporterconfig`                          | extracted  |

---

## Entity Types

> **CLI Introspection:** Run `dr schema types apm` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

### Core APM Entities (15 entities)

| Entity Type               | Description                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| **TraceConfiguration**    | Distributed tracing configuration                                 |
| **Span**                  | Unit of work in distributed trace                                 |
| **SpanEvent**             | Timestamped event within span                                     |
| **SpanLink**              | Link between spans from different traces                          |
| **MetricConfiguration**   | Metrics collection configuration                                  |
| **MetricInstrument**      | Specific metric instrument (Counter, Gauge, Histogram, etc.)      |
| **LogConfiguration**      | Structured logging configuration                                  |
| **LogRecord**             | Individual log record                                             |
| **LogProcessor**          | Log processing pipeline step (simple, batch, custom)              |
| **Resource**              | Telemetry resource attributes                                     |
| **InstrumentationScope**  | Scope of instrumentation                                          |
| **InstrumentationConfig** | Code instrumentation configuration (library, auto/manual type)    |
| **ExporterConfig**        | Telemetry exporter configuration (OTLP, Jaeger, Prometheus, etc.) |
| **Alert**                 | Alert rule with severity, condition, and notification channels    |
| **Dashboard**             | Monitoring dashboard definition (Grafana, Datadog, etc.)          |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any APM element.

- Is this an alert rule with severity and condition? → `apm.alert`
- Is this a monitoring dashboard definition (Grafana, Datadog, etc.)? → `apm.dashboard`
- Is this an exporter configuration (OTLP, Jaeger, Prometheus endpoint)? → `apm.exporterconfig`
- Is this a code instrumentation configuration (library name, auto/manual)? → `apm.instrumentationconfig`
- Is this the instrumentation scope (library version, schema URL)? → `apm.instrumentationscope`
- Is this logging pipeline configuration (service name, minimum severity)? → `apm.logconfiguration`
- Is this a log processor step (batch, simple, custom)? → `apm.logprocessor`
- Is this an individual structured log record with body and severity? → `apm.logrecord`
- Is this a metrics collection configuration (export interval, cardinality limit)? → `apm.metricconfiguration`
- Is this a specific metric instrument (counter, gauge, histogram, observable)? → `apm.metricinstrument`
- Is this a telemetry resource (service name, deployment environment attributes)? → `apm.resource`
- Is this a unit of work/operation in a distributed trace? → `apm.span`
- Is this an event that occurred within a span? → `apm.spanevent`
- Is this a link between spans from different traces? → `apm.spanlink`
- Is this distributed tracing configuration (sampler type, propagators)? → `apm.traceconfiguration`

---

## When to Use This Skill

Activate when the user:

- Mentions "APM", "observability", "monitoring", "telemetry"
- Wants to add tracing, metrics, or logging
- Asks about performance monitoring or SLOs
- Needs to instrument code or track business metrics
- Wants to link observability to application services

---

## Cross-Layer Relationships

**Outgoing (APM → Other Layers):**

- `instrumented-service` → Application Layer (which service is being monitored?)
- `business-metrics` → Business Layer (business KPIs)

**Incoming (Other Layers → APM):**

- Application Layer → APM (services reference metrics)
- API Layer → APM (operations set SLA targets)
- Business Layer → APM (processes reference business metrics)
- Data Model Layer → APM (metric instruments tracking data quality KPIs)
- Data Store Layer → APM (query performance metrics)

---

## Observability Best Practices

1. **Traces** - Add spans for critical operations
2. **Metrics** - Track both technical and business metrics
3. **Logs** - Use structured logging (JSON)
4. **Context** - Propagate trace context across services
5. **Sampling** - Configure appropriate sampling rates
6. **SLOs** - Define service level objectives
7. **Alerting** - Set up alerts for critical metrics
8. **Cardinality** - Avoid high-cardinality attributes

---

## Common Commands

```bash
# Add span
dr add apm span "Process Order"

# Add metric instrument
dr add apm metricinstrument "order_rate" --description "Order processing rate counter"

# Add log record
dr add apm logrecord "Error Log"

# List APM elements
dr list apm --type span

# Validate APM layer
dr validate --layers apm

# Export APM configuration
dr export markdown --layers apm
```

---

## Example: Order Processing Span

```yaml
id: apm.span.process-order
name: "Process Order Span"
type: span
properties:
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736"
  spanId: "00f067aa0ba902b7"
  traceState: ""
  parentSpanId: "b9c7c989f97918e1"
  spanKind: INTERNAL
  startTimeUnixNano: "1544712660000000000"
  endTimeUnixNano: "1544712661000000000"
  droppedAttributesCount: 0
  droppedEventsCount: 0
  droppedLinksCount: 0
  statusCode: OK
  attributes:
    order.id: "ord-12345"
    order.total: 99.99
    customer.id: "cust-67890"
```

---

## Example: Business Metrics

```yaml
id: apm.metricinstrument.order-rate
name: "Order Rate Metric"
type: metricinstrument
properties:
  type: Counter
  unit: orders
  description: "Number of orders processed per minute"
  enabled: true
```

---

## Coverage Completeness Checklist

Before declaring APM layer extraction complete, verify each type was considered:

- [ ] `apm.alert` — Alert rule with severity and notification channels
- [ ] `apm.dashboard` — Monitoring dashboard (Grafana, Datadog, etc.)
- [ ] `apm.exporterconfig` — Telemetry exporter configuration (OTLP, Prometheus, etc.)
- [ ] `apm.instrumentationconfig` — Code instrumentation configuration
- [ ] `apm.instrumentationscope` — Instrumentation scope (library version and schema URL)
- [ ] `apm.logconfiguration` — Logging configuration per service
- [ ] `apm.logprocessor` — Log processing pipeline step
- [ ] `apm.logrecord` — Individual structured log record
- [ ] `apm.metricconfiguration` — Metrics collection configuration per service
- [ ] `apm.metricinstrument` — Specific metric instrument (Counter, Gauge, Histogram, etc.)
- [ ] `apm.resource` — Telemetry resource attributes (service name, environment)
- [ ] `apm.span` — Unit of work in a distributed trace
- [ ] `apm.spanevent` — Timestamped event within a span
- [ ] `apm.spanlink` — Link between spans from different traces
- [ ] `apm.traceconfiguration` — Distributed tracing configuration

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.

---

## Pitfalls to Avoid

- ❌ Not propagating trace context across services
- ❌ High-cardinality attributes (e.g., unique IDs in tags)
- ❌ Missing business metrics (only technical metrics)
- ❌ Not setting SLOs/SLAs
- ❌ Over-instrumentation (too many spans)
- ❌ Missing cross-layer links to instrumented services
