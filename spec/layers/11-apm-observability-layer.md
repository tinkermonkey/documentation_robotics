# APM/Observability Layer - OpenTelemetry Standard

## Overview

The APM/Observability Layer defines distributed tracing, logging, and metrics using the industry-standard OpenTelemetry specification. This layer leverages comprehensive existing standards rather than inventing custom observability formats.

## Layer Characteristics

- **Standard**: OpenTelemetry 1.0+ (OTLP), W3C Trace Context
- **Custom Extensions**: Minimal (configuration and cross-references only)
- **Validation**: OpenTelemetry validators, schema validators
- **Tooling**: OpenTelemetry SDKs, collectors, backends (Jaeger, Zipkin, Prometheus, etc.)

## Why OpenTelemetry?

OpenTelemetry is the industry standard for observability:
- **Complete Coverage**: Traces, metrics, and logs in one specification
- **Vendor Neutral**: Works with any observability backend
- **Industry Standard**: CNCF project with broad adoption
- **Rich Ecosystem**: SDKs in all major languages
- **Context Propagation**: W3C Trace Context standard
- **No Custom Invention Needed**: Comprehensive and proven

## Three Pillars of Observability

### 1. Distributed Tracing
Track requests across services

### 2. Metrics
Measure system performance and behavior

### 3. Logging
Capture detailed event information

## Core OpenTelemetry Entities

### Span
```yaml
Span:
  description: "Unit of work in distributed tracing"
  attributes:
    traceId: string (hex, 16 bytes) # Globally unique trace identifier
    spanId: string (hex, 8 bytes) # Unique span identifier within trace
    traceState: string (optional, W3C format) # Vendor-specific trace state
    parentSpanId: string (hex, 8 bytes, optional) # Parent span for nesting
    name: string # Operation name (e.g., "getProduct", "db.query")
    spanKind: SpanKind [enum]
    startTimeUnixNano: uint64 # Start time in nanoseconds since epoch
    endTimeUnixNano: uint64 # End time in nanoseconds since epoch
    droppedAttributesCount: uint32
    droppedEventsCount: uint32
    droppedLinksCount: uint32

  contains:
    - attributes: Attribute[] (0..*) # Key-value metadata
    - events: SpanEvent[] (0..*) # Timestamped events during span
    - links: SpanLink[] (0..*) # Links to other spans
    - status: SpanStatus (1..1) # Span outcome

  # Cross-layer integration
  references:
    - operationId: string (OpenAPI operationId, optional)
    - archimateService: Element.id (ApplicationService, optional)
    - businessProcess: Element.id (BusinessProcess, optional)
    - processStepName: string (specific step within business process, optional)

  enums:
    SpanKind:
      - INTERNAL      # Internal operation
      - SERVER        # Synchronous server request
      - CLIENT        # Synchronous client request
      - PRODUCER      # Asynchronous producer
      - CONSUMER      # Asynchronous consumer

  examples:
    # HTTP server span
    - traceId: "5b8aa5a2d2c872e8321cf37308d69df2"
      spanId: "051581bf3cb55c13"
      name: "GET /products/:id"
      spanKind: SERVER
      startTimeUnixNano: 1633024800000000000
      endTimeUnixNano: 1633024800050000000
      attributes:
        - key: "http.method"
          value: "GET"
        - key: "http.route"
          value: "/products/:id"
        - key: "http.status_code"
          value: 200
      status:
        code: OK

    # Database client span
    - traceId: "5b8aa5a2d2c872e8321cf37308d69df2"
      spanId: "5fb397be161d6b8c"
      parentSpanId: "051581bf3cb55c13"
      name: "SELECT products"
      spanKind: CLIENT
      attributes:
        - key: "db.system"
          value: "postgresql"
        - key: "db.statement"
          value: "SELECT * FROM products WHERE id = $1"
        - key: "db.name"
          value: "product_db"
```

### SpanEvent
```yaml
SpanEvent:
  description: "Timestamped event during span execution"
  attributes:
    timeUnixNano: uint64 # Event timestamp
    name: string # Event name
    droppedAttributesCount: uint32

  contains:
    - attributes: Attribute[] (0..*) # Event-specific attributes

  examples:
    # Exception event
    - timeUnixNano: 1633024800025000000
      name: "exception"
      attributes:
        - key: "exception.type"
          value: "DatabaseError"
        - key: "exception.message"
          value: "Connection timeout"
        - key: "exception.stacktrace"
          value: "..."

    # Custom business event
    - timeUnixNano: 1633024800030000000
      name: "product.viewed"
      attributes:
        - key: "product.id"
          value: "550e8400-e29b-41d4-a716-446655440000"
        - key: "user.id"
          value: "user-123"
```

### SpanLink
```yaml
SpanLink:
  description: "Link to related span (different trace or parent)"
  attributes:
    traceId: string (hex, 16 bytes)
    spanId: string (hex, 8 bytes)
    traceState: string (optional)
    droppedAttributesCount: uint32

  contains:
    - attributes: Attribute[] (0..*) # Link-specific attributes

  examples:
    # Link to batch processing span
    - traceId: "1f2e3d4c5b6a7c8d9e0f1a2b3c4d5e6f"
      spanId: "a1b2c3d4e5f67890"
      attributes:
        - key: "link.type"
          value: "batch_job"
        - key: "link.description"
          value: "Triggered batch processing"
```

### SpanStatus
```yaml
SpanStatus:
  description: "Outcome of span execution"
  attributes:
    code: StatusCode [enum]
    message: string (optional) # Error message if ERROR

  enums:
    StatusCode:
      - UNSET   # Default, no explicit status
      - OK      # Success
      - ERROR   # Failure

  examples:
    # Success
    - code: OK

    # Error with message
    - code: ERROR
      message: "Product not found"
```

### LogRecord
```yaml
LogRecord:
  description: "OpenTelemetry log entry"
  attributes:
    timeUnixNano: uint64 # Log creation time
    observedTimeUnixNano: uint64 # Time log was observed by collector
    severityNumber: SeverityNumber [enum]
    severityText: string (optional) # Human-readable severity
    body: AnyValue # Log message/payload
    flags: uint32 # Flags (e.g., sampled)
    droppedAttributesCount: uint32

  contains:
    - attributes: Attribute[] (0..*) # Log-specific attributes
    - resource: Resource (1..1) # Resource that generated log
    - instrumentationScope: InstrumentationScope (1..1) # Instrumentation info

  # Trace correlation
  traceContext:
    traceId: string (hex, 16 bytes, optional) # Associated trace
    spanId: string (hex, 8 bytes, optional) # Associated span

  enums:
    SeverityNumber:
      - UNSPECIFIED: 0
      - TRACE: 1
      - TRACE2: 2
      - TRACE3: 3
      - TRACE4: 4
      - DEBUG: 5
      - DEBUG2: 6
      - DEBUG3: 7
      - DEBUG4: 8
      - INFO: 9
      - INFO2: 10
      - INFO3: 11
      - INFO4: 12
      - WARN: 13
      - WARN2: 14
      - WARN3: 15
      - WARN4: 16
      - ERROR: 17
      - ERROR2: 18
      - ERROR3: 19
      - ERROR4: 20
      - FATAL: 21
      - FATAL2: 22
      - FATAL3: 23
      - FATAL4: 24

  examples:
    # Info log with trace context
    - timeUnixNano: 1633024800040000000
      severityNumber: 9
      severityText: "INFO"
      body: "Processing product request"
      traceId: "5b8aa5a2d2c872e8321cf37308d69df2"
      spanId: "051581bf3cb55c13"
      attributes:
        - key: "product.id"
          value: "550e8400-e29b-41d4-a716-446655440000"
        - key: "user.id"
          value: "user-123"

    # Error log
    - timeUnixNano: 1633024800045000000
      severityNumber: 17
      severityText: "ERROR"
      body: "Failed to connect to database"
      attributes:
        - key: "error.type"
          value: "ConnectionError"
        - key: "db.host"
          value: "db.example.com"
```

### Resource
```yaml
Resource:
  description: "Immutable representation of entity producing telemetry"
  attributes:
    schemaUrl: string (optional) # Schema version URL
    droppedAttributesCount: uint32

  contains:
    - attributes: Attribute[] (1..*) # Resource attributes

  # Standard semantic conventions
  standardAttributes:
    # Service
    - service.name: string [required]
    - service.namespace: string
    - service.instance.id: string
    - service.version: string

    # Deployment
    - deployment.environment: string

    # Host
    - host.name: string
    - host.type: string
    - host.arch: string
    - host.image.name: string
    - host.image.id: string

    # Container
    - container.name: string
    - container.id: string
    - container.image.name: string
    - container.runtime: string

    # Kubernetes
    - k8s.cluster.name: string
    - k8s.namespace.name: string
    - k8s.pod.name: string
    - k8s.pod.uid: string
    - k8s.deployment.name: string
    - k8s.node.name: string

    # Cloud
    - cloud.provider: string
    - cloud.account.id: string
    - cloud.region: string
    - cloud.availability_zone: string
    - cloud.platform: string

    # Technology Layer Integration
    - technology.component.id: string (reference to Technology Layer component)
    - technology.framework: string (e.g., "react", "spring-boot", "express")
    - technology.runtime: string (e.g., "node-18", "java-17", "python-3.11")
    - cloud.cost-center: string (cost attribution for FinOps)

  examples:
    # Kubernetes deployment
    - attributes:
        - key: "service.name"
          value: "product-service"
        - key: "service.version"
          value: "2.1.0"
        - key: "deployment.environment"
          value: "production"
        - key: "k8s.namespace.name"
          value: "ecommerce"
        - key: "k8s.pod.name"
          value: "product-service-7f8c9d4b-xk2p7"
        - key: "k8s.deployment.name"
          value: "product-service"
        - key: "cloud.provider"
          value: "aws"
        - key: "cloud.region"
          value: "us-east-1"
```

### InstrumentationScope
```yaml
InstrumentationScope:
  description: "Logical unit of code that generates telemetry"
  attributes:
    name: string # Instrumentation library name
    version: string (optional) # Library version
    schemaUrl: string (optional)
    droppedAttributesCount: uint32

  contains:
    - attributes: Attribute[] (0..*) # Scope-specific attributes

  examples:
    - name: "@opentelemetry/instrumentation-http"
      version: "0.27.0"

    - name: "product-service.custom"
      version: "1.0.0"
```

### Attribute
```yaml
Attribute:
  description: "Key-value pair metadata"
  attributes:
    key: string # Attribute name
    value: AnyValue # Attribute value

  # AnyValue types
  valueTypes:
    - stringValue: string
    - boolValue: boolean
    - intValue: int64
    - doubleValue: double
    - arrayValue: AnyValue[] # Array of values
    - kvlistValue: KeyValue[] # Key-value list
    - bytesValue: bytes # Binary data

  # Semantic conventions (examples)
  semanticConventions:
    # HTTP
    - http.method: string (GET, POST, etc.)
    - http.url: string
    - http.target: string (path + query)
    - http.route: string (route template)
    - http.status_code: integer
    - http.request.header.*: string
    - http.response.header.*: string

    # Database
    - db.system: string (postgresql, mysql, mongodb, etc.)
    - db.connection_string: string
    - db.user: string
    - db.name: string (database name)
    - db.statement: string (SQL query)
    - db.operation: string (SELECT, INSERT, etc.)

    # RPC
    - rpc.system: string (grpc, thrift, etc.)
    - rpc.service: string
    - rpc.method: string

    # Messaging
    - messaging.system: string (kafka, rabbitmq, etc.)
    - messaging.destination: string (topic/queue name)
    - messaging.operation: string (publish, receive, etc.)

    # User
    - enduser.id: string
    - enduser.role: string
    - enduser.scope: string

  examples:
    # String attribute
    - key: "http.method"
      value:
        stringValue: "GET"

    # Integer attribute
    - key: "http.status_code"
      value:
        intValue: 200

    # Array attribute
    - key: "http.request.headers"
      value:
        arrayValue:
          - stringValue: "Content-Type: application/json"
          - stringValue: "Authorization: Bearer ..."
```

## Metrics (OpenTelemetry Metrics)

### Metric Types
```yaml
MetricTypes:
  Counter:
    description: "Monotonically increasing value"
    examples:
      - http.server.requests (total requests)
      - product.views (total product views)
      - errors.count (total errors)

  UpDownCounter:
    description: "Value that can increase or decrease"
    examples:
      - active.connections (current connections)
      - queue.size (current queue size)

  Gauge:
    description: "Current value at a point in time"
    examples:
      - cpu.usage (current CPU %)
      - memory.used (current memory)
      - temperature (current temp)

  Histogram:
    description: "Statistical distribution of values"
    examples:
      - http.server.duration (request latency distribution)
      - db.query.duration (query time distribution)
      - file.size (file size distribution)
```

## APM Configuration

### APMConfiguration
```yaml
APMConfiguration:
  description: "Complete APM configuration for an application"
  attributes:
    version: string (config version)
    application: string (application identifier)

  contains:
    - tracing: TraceConfiguration (1..1)
    - logging: LogConfiguration (1..1)
    - metrics: MetricConfiguration (0..1)
    - dataQuality: DataQualityMetrics (0..1)

  references:
    - archimateElement: Element.id (ApplicationComponent or TechnologyService)

  # Motivation Layer Integration
  motivationMapping:
    governedByPrinciples: string[] (Principle IDs that govern observability decisions, optional)
```

### TraceConfiguration
```yaml
TraceConfiguration:
  description: "Distributed tracing configuration"
  attributes:
    serviceName: string # Service name for traces
    serviceVersion: string (optional)
    deploymentEnvironment: string (optional)

  sampler:
    type: SamplerType [enum]
    config: object (sampler-specific configuration)
    governedByPrinciples: string[] (Principle IDs, optional)
    rationale: string (explanation for sampling decision, optional)

  propagators:
    - PropagatorType[] (1..*) # Context propagation formats

  exporters:
    - ExporterConfig[] (1..*) # Where to send traces

  instrumentations:
    - InstrumentationConfig[] (0..*) # Auto-instrumentation

  enums:
    SamplerType:
      - always_on            # Sample everything
      - always_off           # Sample nothing
      - traceidratio         # Sample by trace ID ratio
      - parentbased_always_on
      - parentbased_always_off
      - parentbased_traceidratio

    PropagatorType:
      - w3c-trace-context    # W3C Trace Context (recommended)
      - w3c-baggage          # W3C Baggage
      - b3                   # Zipkin B3
      - jaeger               # Jaeger
      - xray                 # AWS X-Ray
      - ottrace              # OpenTracing

  examples:
    serviceName: "product-service"
    serviceVersion: "2.1.0"
    deploymentEnvironment: "production"
    sampler:
      type: parentbased_traceidratio
      config:
        ratio: 0.1  # Sample 10% of traces
    propagators:
      - w3c-trace-context
      - w3c-baggage
    exporters:
      - type: otlp
        endpoint: "http://otel-collector:4317"
        protocol: grpc
        headers:
          api-key: "${OTLP_API_KEY}"
    instrumentations:
      - type: http
        config:
          recordRequestHeaders: ["x-request-id", "x-tenant-id"]
          recordResponseHeaders: ["x-response-time"]
      - type: database
        config:
          recordQueries: true
          sanitizeStatements: true
```

### LogConfiguration
```yaml
LogConfiguration:
  description: "Logging configuration"
  attributes:
    serviceName: string
    logLevel: LogLevel [enum]

  schema:
    $ref: string (path to JSON Schema for log structure)

  processors:
    - LogProcessor[] (0..*)

  exporters:
    - ExporterConfig[] (1..*)

  # Security Layer Integration
  auditConfiguration:
    accountabilityRequirementRefs: string[] (AccountabilityRequirement IDs, optional)
    retentionPeriod: string (e.g., "7years", driven by requirements)
    nonRepudiation: boolean (cryptographic proof of log integrity, default: false)

  enums:
    LogLevel:
      - TRACE
      - DEBUG
      - INFO
      - WARN
      - ERROR
      - FATAL

  examples:
    serviceName: "product-service"
    logLevel: INFO
    schema:
      $ref: "specs/log-schema.json"
    processors:
      - type: batch
        config:
          maxQueueSize: 2048
          scheduledDelayMillis: 5000
          exportTimeoutMillis: 30000
      - type: resource
        config:
          attributes:
            environment: "production"
            version: "2.1.0"
    exporters:
      - type: otlp
        endpoint: "http://otel-collector:4317"
      - type: console
        enabled: false
```

### MetricConfiguration
```yaml
MetricConfiguration:
  description: "Metrics configuration"
  attributes:
    serviceName: string
    exportIntervalMillis: integer (default: 60000)

  meters:
    - MeterConfig[] (1..*)

  exporters:
    - ExporterConfig[] (1..*)

  examples:
    serviceName: "product-service"
    exportIntervalMillis: 60000
    meters:
      - name: "http.server"
        instruments:
          - type: histogram
            name: "request.duration"
            unit: "ms"
            description: "HTTP request duration"
            buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
          - type: counter
            name: "requests.total"
            unit: "1"
            description: "Total HTTP requests"
      - name: "business"
        instruments:
          - type: counter
            name: "product.views"
            unit: "1"
            description: "Product view count"
            attributes: ["product.id", "product.category"]
            # Motivation Layer Integration
            motivationMapping:
              contributesToGoal: "goal-customer-engagement"
              measuresOutcome: "outcome-increased-product-discovery"
              kpiFormula: "COUNT(product.views) GROUP BY product.category"
          - type: gauge
            name: "inventory.level"
            unit: "1"
            description: "Current inventory level"
            # Motivation Layer Integration
            motivationMapping:
              contributesToGoal: "goal-inventory-accuracy"
              measuresOutcome: "outcome-reduced-stockouts"
    exporters:
      - type: otlp
        endpoint: "http://otel-collector:4317"
      - type: prometheus
        endpoint: "http://localhost:9090"
```

### DataQualityMetrics
```yaml
DataQualityMetrics:
  description: "Data quality monitoring metrics (referenced by Data Model Layer x-apm-data-quality-metrics)"
  attributes:
    schemaRef: string (reference to Data Model Layer schema ID)
    monitoringEnabled: boolean (default: true)

  contains:
    - metrics: DataQualityMetric[] (1..*)

  references:
    - dataModelSchemaId: string (JSON Schema $id)

DataQualityMetric:
  description: "Individual data quality metric"
  attributes:
    type: DataQualityType [enum]
    name: string
    description: string (optional)
    measurement: string (how quality is measured)
    threshold: string (acceptable quality level)
    alertOnViolation: boolean (default: true)

  # Motivation Layer Integration
  motivationMapping:
    contributesToGoal: string (Goal ID, optional)
    governedByPrinciples: string[] (Principle IDs, optional)
    fulfillsRequirements: string[] (Requirement IDs, optional)

  enums:
    DataQualityType:
      - completeness      # % of required fields populated
      - accuracy          # % of records passing validation
      - freshness         # Age of most recent data
      - consistency       # % of cross-schema constraint violations
      - uniqueness        # % of duplicate records
      - validity          # % conforming to business rules
      - timeliness        # Data arrival within expected timeframe
      - integrity         # Referential integrity violations

  examples:
    # Completeness metric
    - type: completeness
      name: "product.data.completeness"
      description: "Percentage of products with all required fields"
      measurement: "COUNT(products WHERE all_required_fields_present) / COUNT(products)"
      threshold: ">= 95%"
      alertOnViolation: true
      schemaRef: "product-schema"
      motivationMapping:
        contributesToGoal: "goal-data-governance"
        governedByPrinciples: ["principle-data-quality"]
        fulfillsRequirements: ["req-product-data-completeness"]

    # Accuracy metric
    - type: accuracy
      name: "product.price.accuracy"
      description: "Percentage of products with valid price data"
      measurement: "COUNT(products WHERE price > 0 AND price < max_price) / COUNT(products)"
      threshold: ">= 99%"
      alertOnViolation: true
      schemaRef: "product-schema"
      motivationMapping:
        contributesToGoal: "goal-pricing-accuracy"
        fulfillsRequirements: ["req-price-validation"]

    # Freshness metric
    - type: freshness
      name: "inventory.data.freshness"
      description: "Age of most recent inventory update"
      measurement: "MAX(now() - last_updated)"
      threshold: "< 5 minutes"
      alertOnViolation: true
      schemaRef: "inventory-schema"
      motivationMapping:
        contributesToGoal: "goal-inventory-accuracy"
        fulfillsRequirements: ["req-real-time-inventory"]

    # Consistency metric
    - type: consistency
      name: "order.referential.integrity"
      description: "Percentage of orders with valid product references"
      measurement: "COUNT(orders WHERE product_id IN products) / COUNT(orders)"
      threshold: ">= 99.9%"
      alertOnViolation: true
      schemaRef: "order-schema"
      motivationMapping:
        contributesToGoal: "goal-data-integrity"
        governedByPrinciples: ["principle-referential-integrity"]
```

## Application Log Schema (JSON Schema)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/schemas/application-log.json",
  "title": "ApplicationLogEntry",
  "description": "Standard application log entry format",

  "type": "object",
  "required": ["timestamp", "level", "message"],

  "properties": {
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp"
    },

    "level": {
      "type": "string",
      "enum": ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]
    },

    "message": {
      "type": "string",
      "description": "Human-readable log message"
    },

    "logger": {
      "type": "string",
      "description": "Logger name (e.g., class name)"
    },

    "context": {
      "type": "object",
      "description": "Contextual data",
      "properties": {
        "traceId": {"type": "string"},
        "spanId": {"type": "string"},
        "userId": {"type": "string"},
        "tenantId": {"type": "string"},
        "requestId": {"type": "string"},
        "sessionId": {"type": "string"},
        "correlationId": {"type": "string"}
      }
    },

    "request": {
      "type": "object",
      "description": "HTTP request details",
      "properties": {
        "method": {"type": "string"},
        "path": {"type": "string"},
        "queryParams": {"type": "object"},
        "headers": {"type": "object"},
        "remoteAddr": {"type": "string"},
        "userAgent": {"type": "string"}
      }
    },

    "response": {
      "type": "object",
      "description": "HTTP response details",
      "properties": {
        "statusCode": {"type": "integer"},
        "durationMs": {"type": "number"},
        "bytesWritten": {"type": "integer"}
      }
    },

    "error": {
      "type": "object",
      "description": "Error details if applicable",
      "properties": {
        "type": {"type": "string"},
        "message": {"type": "string"},
        "stackTrace": {"type": "string"}
      }
    },

    "performance": {
      "type": "object",
      "description": "Performance metrics",
      "properties": {
        "cpuTimeMs": {"type": "number"},
        "memoryUsedBytes": {"type": "integer"},
        "dbQueriesCount": {"type": "integer"},
        "dbTimeMs": {"type": "number"}
      }
    }
  },

  "x-otel-mapping": {
    "description": "Mapping to OpenTelemetry LogRecord",
    "mappings": {
      "timestamp": "timeUnixNano",
      "level": "severityText",
      "message": "body",
      "context.traceId": "traceId",
      "context.spanId": "spanId",
      "context.userId": "attributes[enduser.id]",
      "request.method": "attributes[http.request.method]",
      "request.path": "attributes[http.route]",
      "response.statusCode": "attributes[http.response.status_code]",
      "response.durationMs": "attributes[http.request.duration]"
    }
  }
}
```

## Complete Example: Product Service APM Config

```yaml
# File: specs/apm/product-service-apm.yaml
version: "2.0.0"
application: "product-service"

# Motivation Layer Integration - Governance
motivationMapping:
  governedByPrinciples:
    - "principle-observability-first"
    - "principle-cost-optimization"
    - "principle-privacy-by-design"

# ============================================================
# Tracing
# ============================================================
tracing:
  serviceName: "product-service"
  serviceVersion: "${SERVICE_VERSION}"
  deploymentEnvironment: "${ENVIRONMENT}"

  # Sampling strategy
  sampler:
    type: parentbased_traceidratio
    config:
      ratio: 0.1  # Sample 10% of root spans
    governedByPrinciples:
      - "principle-cost-optimization"
      - "principle-privacy-by-design"
    rationale: "10% sampling balances observability needs with cost and privacy concerns"

  # Context propagation
  propagators:
    - w3c-trace-context  # Primary propagator
    - w3c-baggage        # For baggage propagation

  # Trace export
  exporters:
    - type: otlp
      endpoint: "${OTEL_COLLECTOR_ENDPOINT}"
      protocol: grpc
      headers:
        api-key: "${OTEL_API_KEY}"
      compression: gzip
      timeout: 10000

  # Auto-instrumentation
  instrumentations:
    - type: http
      config:
        captureHeaders: true
        recordRequestHeaders:
          - x-request-id
          - x-tenant-id
          - x-user-id
        recordResponseHeaders:
          - x-response-time
          - x-ratelimit-remaining

    - type: database
      config:
        recordQueries: true
        sanitizeStatements: true
        maxStatementLength: 500

    - type: redis
      config:
        recordCommands: true

# ============================================================
# Logging
# ============================================================
logging:
  serviceName: "product-service"
  logLevel: "${LOG_LEVEL:INFO}"

  # Log structure schema
  schema:
    $ref: "specs/schemas/application-log.json"

  # Security Layer Integration - Audit Configuration
  auditConfiguration:
    accountabilityRequirementRefs:
      - "acct-product-access"
      - "acct-price-changes"
    retentionPeriod: "7years"
    nonRepudiation: true

  # Log processing pipeline
  processors:
    - type: batch
      config:
        maxQueueSize: 2048
        scheduledDelayMillis: 5000
        exportTimeoutMillis: 30000
        maxExportBatchSize: 512

    - type: resource
      config:
        attributes:
          environment: "${ENVIRONMENT}"
          version: "${SERVICE_VERSION}"
          deployment.name: "${DEPLOYMENT_NAME}"

  # Log export
  exporters:
    - type: otlp
      endpoint: "${OTEL_COLLECTOR_ENDPOINT}"
      protocol: grpc

    - type: console
      enabled: "${CONSOLE_LOGS:false}"
      format: json

# ============================================================
# Metrics
# ============================================================
metrics:
  serviceName: "product-service"
  exportIntervalMillis: 60000

  # Metric instruments
  meters:
    # HTTP server metrics
    - name: "http.server"
      instruments:
        - type: histogram
          name: "request.duration"
          unit: "ms"
          description: "HTTP request duration"
          buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
          # Motivation Layer - Requirements Fulfillment
          motivationMapping:
            fulfillsRequirements:
              - "req-api-latency-under-200ms"
              - "req-p95-response-time"
            validationCriteria:
              requirementId: "req-api-latency-under-200ms"
              threshold: "p95 < 200ms"
              alertOnViolation: true

        - type: gauge
          name: "availability"
          unit: "1"
          description: "Service availability percentage"
          # Motivation Layer - Requirements Fulfillment
          motivationMapping:
            fulfillsRequirements:
              - "req-99-9-availability"
            validationCriteria:
              requirementId: "req-99-9-availability"
              threshold: ">= 99.9%"
              alertOnViolation: true

        - type: counter
          name: "requests.total"
          unit: "1"
          description: "Total HTTP requests"
          attributes: ["http.method", "http.route", "http.status_code"]

        - type: counter
          name: "errors.total"
          unit: "1"
          description: "Total errors"
          attributes: ["error.type", "http.route"]

    # Database metrics
    - name: "database"
      instruments:
        - type: histogram
          name: "query.duration"
          unit: "ms"
          description: "Database query duration"
          buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000]

        - type: counter
          name: "queries.total"
          unit: "1"
          description: "Total database queries"
          attributes: ["db.operation", "db.table"]

        - type: gauge
          name: "connections.active"
          unit: "1"
          description: "Active database connections"

    # Business metrics
    - name: "business"
      instruments:
        - type: counter
          name: "product.views"
          unit: "1"
          description: "Product view count"
          attributes: ["product.id", "product.category", "user.authenticated"]
          # Motivation Layer Integration
          motivationMapping:
            contributesToGoal: "goal-customer-engagement"
            measuresOutcome: "outcome-increased-product-discovery"
            kpiFormula: "COUNT(product.views) WHERE time > goal.target-date"

        - type: counter
          name: "product.created"
          unit: "1"
          description: "Products created"
          attributes: ["product.category"]
          # Motivation Layer Integration
          motivationMapping:
            contributesToGoal: "goal-product-catalog-expansion"
            measuresOutcome: "outcome-catalog-growth"

        - type: gauge
          name: "inventory.level"
          unit: "1"
          description: "Current inventory level"
          attributes: ["product.id"]
          # Motivation Layer Integration
          motivationMapping:
            contributesToGoal: "goal-inventory-accuracy"
            measuresOutcome: "outcome-reduced-stockouts"
            kpiFormula: "AVG(inventory.level) BY product.category"

        - type: counter
          name: "inventory.low"
          unit: "1"
          description: "Low inventory alerts"
          attributes: ["product.id", "product.category"]
          # Motivation Layer Integration
          motivationMapping:
            contributesToGoal: "goal-inventory-optimization"
            measuresOutcome: "outcome-improved-reorder-timing"

    # Business Process Metrics
    - name: "business-process"
      instruments:
        - type: histogram
          name: "order-fulfillment.duration"
          unit: "ms"
          description: "Order fulfillment process duration"
          buckets: [60000, 300000, 600000, 1800000, 3600000, 7200000]
          # Business Layer Integration
          businessProcessRef: "order-fulfillment-process"
          processStepName: "complete-fulfillment"
          # Motivation Layer Integration
          motivationMapping:
            contributesToGoal: "goal-operational-efficiency"
            measuresOutcome: "outcome-faster-fulfillment"
            fulfillsRequirements: ["req-order-fulfillment-2hours"]
            validationCriteria:
              requirementId: "req-order-fulfillment-2hours"
              threshold: "p95 < 2 hours"
              alertOnViolation: true

        - type: counter
          name: "process.step.completed"
          unit: "1"
          description: "Process step completion count"
          attributes: ["process.name", "step.name", "status"]
          businessProcessRef: "order-fulfillment-process"

    # Security Metrics
    - name: "security"
      instruments:
        - type: counter
          name: "failed-auth-attempts"
          unit: "1"
          description: "Failed authentication attempts"
          attributes: ["source.ip", "user.id"]
          # Security Layer Integration
          securityThreatRef: "threat-brute-force-attack"
          securityControlRef: "control-rate-limiting"
          alertThreshold: "> 10 per minute"

        - type: counter
          name: "unauthorized-access-attempts"
          unit: "1"
          description: "Unauthorized access attempts"
          attributes: ["resource", "user.role"]
          securityThreatRef: "threat-unauthorized-access"
          securityControlRef: "control-rbac"

        - type: counter
          name: "sensitive-data-access"
          unit: "1"
          description: "Sensitive data access events"
          attributes: ["data.classification", "user.id", "purpose"]
          # Links to accountability requirements
          securityAccountabilityRef: "acct-sensitive-data-access"

    # UX Performance Metrics (Real User Monitoring)
    - name: "ux-performance"
      instruments:
        - type: histogram
          name: "page.load-time"
          unit: "ms"
          description: "Page load time"
          buckets: [100, 500, 1000, 2000, 2500, 3000, 5000]
          attributes: ["page.route", "device.type"]
          # UX Layer Integration
          uxComponentRef: "product-list-screen"
          # Core Web Vitals
          webVitals:
            - metric: "LCP"  # Largest Contentful Paint
              threshold: "< 2.5s"
            - metric: "FID"  # First Input Delay
              threshold: "< 100ms"
            - metric: "CLS"  # Cumulative Layout Shift
              threshold: "< 0.1"
          motivationMapping:
            contributesToGoal: "goal-user-experience"
            fulfillsRequirements: ["req-fast-page-loads"]

        - type: counter
          name: "user-interaction-errors"
          unit: "1"
          description: "User interaction errors"
          attributes: ["component.name", "error.type"]
          uxComponentRef: "product-form"

    # Navigation Flow Metrics
    - name: "navigation"
      instruments:
        - type: histogram
          name: "route.transition-time"
          unit: "ms"
          description: "Navigation route transition time"
          buckets: [10, 50, 100, 200, 500, 1000]
          attributes: ["from.route", "to.route"]
          # Navigation Layer Integration
          navigationRouteRef: "/products/:id"

        - type: counter
          name: "navigation.guard-execution"
          unit: "1"
          description: "Navigation guard execution count"
          attributes: ["guard.name", "route", "result"]
          navigationRouteRef: "/admin/*"

        - type: counter
          name: "navigation.errors"
          unit: "1"
          description: "Navigation errors"
          attributes: ["route", "error.type"]

  # Metric export
  exporters:
    - type: otlp
      endpoint: "${OTEL_COLLECTOR_ENDPOINT}"
      protocol: grpc

    - type: prometheus
      endpoint: "0.0.0.0:9090"
      path: "/metrics"

# ============================================================
# Data Quality Monitoring
# ============================================================
dataQuality:
  schemaRef: "product-schema"
  monitoringEnabled: true

  metrics:
    - type: completeness
      name: "product.data.completeness"
      description: "Percentage of products with all required fields"
      measurement: "COUNT(products WHERE all_required_fields_present) / COUNT(products)"
      threshold: ">= 95%"
      alertOnViolation: true
      motivationMapping:
        contributesToGoal: "goal-data-governance"
        governedByPrinciples: ["principle-data-quality"]
        fulfillsRequirements: ["req-product-data-completeness"]

    - type: accuracy
      name: "product.price.accuracy"
      description: "Percentage of products with valid price data"
      measurement: "COUNT(products WHERE price > 0 AND price < max_price) / COUNT(products)"
      threshold: ">= 99%"
      alertOnViolation: true
      motivationMapping:
        contributesToGoal: "goal-pricing-accuracy"
        fulfillsRequirements: ["req-price-validation"]

    - type: freshness
      name: "inventory.data.freshness"
      description: "Age of most recent inventory update"
      measurement: "MAX(now() - last_updated)"
      threshold: "< 5 minutes"
      alertOnViolation: true
      motivationMapping:
        contributesToGoal: "goal-inventory-accuracy"
        fulfillsRequirements: ["req-real-time-inventory"]
```

## Integration Points

### To Motivation Layer (Enhanced)
**Goals & Outcomes:**
- `motivationMapping.contributesToGoal` - Metrics link to Goals they measure
- `motivationMapping.measuresOutcome` - Metrics track Outcome achievement
- `motivationMapping.kpiFormula` - Defines goal achievement calculation

**Requirements Fulfillment (NEW):**
- `motivationMapping.fulfillsRequirements` - Metrics validate Requirements (especially NFRs)
- `motivationMapping.validationCriteria` - SLA/NFR threshold validation
- Examples: API latency requirements, availability SLAs, data quality requirements

**Principle Governance (NEW):**
- `APMConfiguration.motivationMapping.governedByPrinciples` - Observability strategy governed by Principles
- `TraceConfiguration.sampler.governedByPrinciples` - Sampling decisions driven by Principles
- `DataQualityMetric.motivationMapping.governedByPrinciples` - Data quality governed by Principles
- Examples: Cost optimization, privacy by design, observability-first principles

**Traceability Benefits:**
- Proves goal achievement through quantitative measurement
- Validates NFR compliance with real-time metrics
- Demonstrates architectural principle adherence

### To Business Layer (Enhanced)
**Business Process Performance (NEW):**
- `Span.businessProcess` - Traces link to BusinessProcess
- `Span.processStepName` - Specific process step tracking
- `MetricInstrument.businessProcessRef` - Metrics measure process performance
- `MetricInstrument.processStepName` - Step-level process metrics
- Enables business process mining and end-to-end process optimization

**Business Service Monitoring:**
- BusinessProcess KPI targets validated by metrics
- Business metrics track service-level performance

### To ArchiMate Application Layer
- TraceConfiguration references ApplicationService
- Span names map to ApplicationFunction operations
- Resource attributes identify ApplicationComponent

### To Technology Layer (NEW)
**Infrastructure Attribution:**
- `Resource.technology.component.id` - Links to Technology Layer components
- `Resource.technology.framework` - Framework identification (React, Spring Boot, etc.)
- `Resource.technology.runtime` - Runtime environment tracking
- `Resource.cloud.cost-center` - FinOps cost attribution
- Enables infrastructure performance analysis and cost allocation

### To API Layer (OpenAPI)
- Span names match OpenAPI operationIds
- HTTP attributes follow OpenAPI parameters
- Enables automatic instrumentation of APIs
- API operation SLA targets validated by metrics

### To Data Model Layer (Enhanced)
**Data Quality Monitoring (NEW - Critical):**
- `DataQualityMetrics.dataModelSchemaId` - Links to JSON Schema definitions
- `DataQualityMetric` types: completeness, accuracy, freshness, consistency, integrity
- Closes the loop on Data Model Layer's `x-apm-data-quality-metrics` reference
- Enables data governance and quality validation

### To UX Layer (Enhanced)
**Real User Monitoring (NEW):**
- `MetricInstrument.uxComponentRef` - Links to UX Layer screens/components
- `webVitals` metrics - Core Web Vitals (LCP, FID, CLS)
- Page load time metrics per UX component
- User interaction error tracking
- Enables UX performance optimization and user journey analysis

**End-to-End Tracing:**
- Frontend traces link to backend traces
- User interactions generate client spans
- End-to-end transaction tracing

### To Navigation Layer (NEW)
**Navigation Flow Performance:**
- `MetricInstrument.navigationRouteRef` - Links to Navigation routes
- Route transition time metrics
- Navigation guard execution performance
- Navigation error tracking
- Enables identification of UX bottlenecks in navigation flows

### To Data Store Layer
- Database spans track query performance
- Connection pool metrics
- Query optimization insights

### To Security Layer (Enhanced)
**Accountability & Audit (NEW):**
- `LogConfiguration.auditConfiguration.accountabilityRequirementRefs` - Links to AccountabilityRequirements
- `LogConfiguration.auditConfiguration.retentionPeriod` - Driven by security requirements
- `LogConfiguration.auditConfiguration.nonRepudiation` - Cryptographic audit integrity

**Threat Detection (NEW):**
- `MetricInstrument.securityThreatRef` - Metrics linked to Threats they detect
- `MetricInstrument.securityControlRef` - Metrics monitor security Controls
- `MetricInstrument.securityAccountabilityRef` - Links to accountability requirements
- Examples: Failed auth attempts → brute force threat, unauthorized access → RBAC control

**Security Monitoring:**
- Audit logs include trace context
- Security events tracked in spans
- Anomaly detection via metrics

## Best Practices

### Core Observability Practices
1. **Sampling**: Use intelligent sampling in production (10-20%)
2. **Cardinality**: Limit attribute cardinality to avoid metric explosion
3. **Correlation**: Always include trace context in logs
4. **Semantic Conventions**: Follow OpenTelemetry semantic conventions
5. **Resource Attributes**: Define comprehensive resource attributes
6. **Error Tracking**: Record exceptions as span events
7. **Business Metrics**: Track business KPIs alongside technical metrics
8. **Distributed Context**: Propagate context across service boundaries
9. **Performance**: Use batch processors to reduce overhead
10. **Security**: Sanitize sensitive data from traces and logs

### Cross-Layer Integration Practices (NEW)
11. **Requirements Validation**: Link SLA/NFR metrics to Requirements for compliance proof
12. **Principle Governance**: Document which Principles govern observability decisions
13. **Business Process Mining**: Track process-level metrics to enable end-to-end optimization
14. **Data Quality First**: Implement data quality metrics for all critical schemas
15. **Security Monitoring**: Link security metrics to Threats and Controls they monitor
16. **Accountability Tracing**: Ensure audit logs reference AccountabilityRequirements
17. **UX Performance**: Measure Core Web Vitals and link to UX components
18. **Cost Attribution**: Use technology component references for FinOps cost allocation
19. **Goal-Driven Metrics**: Every business metric should support at least one Goal
20. **Upward Traceability**: Maintain upward references from implementation to motivation

## Tooling Ecosystem

```yaml
SDKs:
  - JavaScript/TypeScript
  - Python
  - Java
  - Go
  - .NET
  - Ruby
  - PHP
  - Rust

Collectors:
  - OpenTelemetry Collector
  - Jaeger
  - Zipkin

Backends:
  - Jaeger (tracing)
  - Zipkin (tracing)
  - Prometheus (metrics)
  - Grafana (visualization)
  - Elasticsearch (logs)
  - Datadog
  - New Relic
  - Dynatrace
  - Honeycomb
  - Lightstep
```

## Code Generation

APM configs enable generation of:

```yaml
Instrumentation:
  - Automatic trace creation
  - Span lifecycle management
  - Context propagation
  - Error recording

Logging:
  - Structured loggers
  - Trace context injection
  - Log aggregation

Metrics:
  - Metric recorders
  - Custom instruments
  - Dashboards

Monitoring:
  - Alerts
  - SLO dashboards
  - Error tracking
```

This APM/Observability Layer leverages the comprehensive OpenTelemetry standard, providing distributed tracing, logging, and metrics with minimal custom invention while maximizing interoperability and tooling support.
