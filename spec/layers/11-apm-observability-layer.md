# Layer 11: APM/Observability Layer

Defines distributed tracing, logging, and metrics instrumentation using OpenTelemetry standards for application performance monitoring and observability.

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

## Entity Definitions

### Span

```yaml
Span:
  description: "Unit of work in distributed tracing"
  attributes:
    id: string (UUID) [PK]
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

  # Cross-layer integration
  references:
    - operationId: string (OpenAPI operationId, optional)
    - archimateService: Element.id (ApplicationService, optional)
    - businessProcess: Element.id (BusinessProcess, optional)
    - processStepName: string (specific step within business process, optional)

  enums:
    SpanKind:
      - INTERNAL # Internal operation
      - SERVER # Synchronous server request
      - CLIENT # Synchronous client request
      - PRODUCER # Asynchronous producer
      - CONSUMER # Asynchronous consumer

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
    id: string (UUID) [PK]
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
    id: string (UUID) [PK]
    name: string
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
    id: string (UUID) [PK]
    name: string
    code: StatusCode [enum]
    message: string (optional) # Error message if ERROR

  enums:
    StatusCode:
      - UNSET # Default, no explicit status
      - OK # Success
      - ERROR # Failure

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
    id: string (UUID) [PK]
    name: string
    timeUnixNano: uint64 # Log creation time
    observedTimeUnixNano: uint64 # Time log was observed by collector
    severityNumber: SeverityNumber [enum]
    severityText: string (optional) # Human-readable severity
    body: AnyValue # Log message/payload
    flags: uint32 # Flags (e.g., sampled)
    droppedAttributesCount: uint32

  contains:
    - attributes: Attribute[] (0..*) # Log-specific attributes
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
    id: string (UUID) [PK]
    name: string
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
    id: string (UUID) [PK]
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
      version: "0.1.1"
```

### ExporterConfig

```yaml
ExporterConfig:
  description: "Configuration for telemetry data export destinations, specifying protocol (OTLP, Jaeger, Prometheus), endpoints, authentication, batching, and retry policies. Controls where observability data is sent."
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ExporterType [enum]
    enabled: boolean (optional) # default: true
    endpoint: string (required for network exporters)
    protocol: ExporterProtocol [enum] (optional)

  authentication:
    type: AuthType [enum] (optional)
    headers: object (optional) # key-value headers
    credentials: string (optional) # credential reference

  transport:
    timeout: integer (optional) # timeout in milliseconds
    compression: CompressionType [enum] (optional)
    insecure: boolean (optional) # allow insecure connections, default: false
    certificatePath: string (optional) # path to TLS certificate

  batching:
    enabled: boolean (optional) # default: true
    maxQueueSize: integer (optional)
    maxExportBatchSize: integer (optional)
    scheduledDelayMillis: integer (optional)
    exportTimeoutMillis: integer (optional)

  retry:
    enabled: boolean (optional)
    maxAttempts: integer (optional)
    initialIntervalMillis: integer (optional)
    maxIntervalMillis: integer (optional)
    multiplier: number (optional)

  enums:
    ExporterType:
      - otlp # OpenTelemetry Protocol
      - jaeger # Jaeger native
      - zipkin # Zipkin native
      - prometheus # Prometheus scrape endpoint
      - console # Console/stdout output
      - file # File-based output
      - logging # Logging framework
      - noop # No-op (disabled)

    ExporterProtocol:
      - grpc # gRPC protocol (default for OTLP)
      - http # HTTP/protobuf
      - http/json # HTTP/JSON

    CompressionType:
      - none
      - gzip
      - zstd

    AuthType:
      - none
      - api-key
      - bearer
      - basic
      - oauth2
      - mTLS

  examples:
    # OTLP gRPC exporter
    - name: "otlp-traces"
      type: otlp
      endpoint: "http://otel-collector:4317"
      protocol: grpc
      authentication:
        type: api-key
        headers:
          api-key: "${OTEL_API_KEY}"
      transport:
        timeout: 10000
        compression: gzip
      batching:
        maxQueueSize: 2048
        scheduledDelayMillis: 5000

    # Prometheus metrics exporter
    - name: "prometheus-metrics"
      type: prometheus
      endpoint: "0.0.0.0:9090"
      enabled: true

    # Jaeger exporter
    - name: "jaeger-traces"
      type: jaeger
      endpoint: "http://jaeger:14268/api/traces"
      protocol: http
      transport:
        timeout: 5000

    # Console exporter (development)
    - name: "console-debug"
      type: console
      enabled: "${DEBUG_TRACES:false}"
```

### InstrumentationConfig

```yaml
InstrumentationConfig:
  description: "Configuration for automatic or manual instrumentation of application code, specifying which libraries, frameworks, or code paths to instrument and capture telemetry from."
  attributes:
    id: string (UUID) [PK]
    name: string
    type: InstrumentationType [enum]
    enabled: boolean (optional) # default: true
    description: string (optional)

  config: object (optional) # type-specific configuration

  # Specific configurations by type
  httpConfig:
    captureHeaders: boolean (optional)
    recordRequestHeaders: string[] (optional)
    recordResponseHeaders: string[] (optional)
    ignoreRoutes: string[] (optional) # routes to skip
    propagateContext: boolean (optional) # default: true

  databaseConfig:
    recordQueries: boolean (optional)
    sanitizeStatements: boolean (optional)
    maxStatementLength: integer (optional)
    captureParameters: boolean (optional)

  messagingConfig:
    capturePayload: boolean (optional)
    maxPayloadSize: integer (optional)
    propagateContext: boolean (optional)

  grpcConfig:
    recordMetadata: boolean (optional)
    captureMessages: boolean (optional)

  redisConfig:
    recordCommands: boolean (optional)
    recordArguments: boolean (optional)
    maxArgumentLength: integer (optional)

  enums:
    InstrumentationType:
      - http # HTTP client/server
      - database # Database queries (SQL, NoSQL)
      - redis # Redis operations
      - grpc # gRPC calls
      - messaging # Message queues (Kafka, RabbitMQ)
      - graphql # GraphQL operations
      - aws-sdk # AWS SDK calls
      - mongodb # MongoDB operations
      - elasticsearch # Elasticsearch operations
      - fs # File system operations
      - dns # DNS lookups
      - net # Network operations
      - custom # Custom instrumentation

  examples:
    # HTTP instrumentation
    - name: "http-instrumentation"
      type: http
      enabled: true
      httpConfig:
        captureHeaders: true
        recordRequestHeaders:
          - x-request-id
          - x-tenant-id
          - x-user-id
        recordResponseHeaders:
          - x-response-time
          - x-ratelimit-remaining
        ignoreRoutes:
          - "/health"
          - "/metrics"
        propagateContext: true

    # Database instrumentation
    - name: "database-instrumentation"
      type: database
      enabled: true
      databaseConfig:
        recordQueries: true
        sanitizeStatements: true
        maxStatementLength: 500
        captureParameters: false

    # Redis instrumentation
    - name: "redis-instrumentation"
      type: redis
      enabled: true
      redisConfig:
        recordCommands: true
        recordArguments: false

    # Kafka instrumentation
    - name: "kafka-instrumentation"
      type: messaging
      enabled: true
      messagingConfig:
        capturePayload: false
        propagateContext: true
```

### LogProcessor

```yaml
LogProcessor:
  description: "A processing pipeline component for log records, enabling filtering, transformation, enrichment, or routing of logs before export. Customizes log processing behavior."
  attributes:
    id: string (UUID) [PK]
    name: string
    type: LogProcessorType [enum]
    order: integer (optional) # processing order
    enabled: boolean (optional) # default: true

  config: object (optional) # processor-specific configuration

  # Batch processor config
  batchConfig:
    maxQueueSize: integer (optional)
    scheduledDelayMillis: integer (optional)
    exportTimeoutMillis: integer (optional)
    maxExportBatchSize: integer (optional)

  # Resource processor config
  resourceConfig:
    attributes: object (optional) # key-value attributes to add

  # Filter processor config
  filterConfig:
    include:
      severityMin: SeverityNumber (optional)
      severityMax: SeverityNumber (optional)
      bodyRegex: string (optional)
      attributeMatch: object (optional)
    exclude:
      severityMin: SeverityNumber (optional)
      severityMax: SeverityNumber (optional)
      bodyRegex: string (optional)
      attributeMatch: object (optional)

  # Transform processor config
  transformConfig:
    operations:
      - type: TransformOperation [enum]
        config: object

  # Sampling processor config
  samplingConfig:
    ratio: number (optional) # 0.0 to 1.0
    seed: integer (optional) # for deterministic sampling

  enums:
    LogProcessorType:
      - batch # Batch logs before export
      - resource # Add resource attributes
      - filter # Filter logs by criteria
      - transform # Transform log content
      - sampling # Sample logs
      - redact # Redact sensitive data
      - routing # Route to different exporters
      - memory-limiter # Limit memory usage
      - custom # Custom processor

    TransformOperation:
      - set-attribute # Set/add attribute
      - delete-attribute # Remove attribute
      - rename-attribute # Rename attribute
      - hash-attribute # Hash attribute value
      - truncate-body # Truncate log body
      - extract-attribute # Extract from body to attribute
      - convert-severity # Convert severity format

  examples:
    # Batch processor
    - name: "batch-processor"
      type: batch
      order: 1
      batchConfig:
        maxQueueSize: 2048
        scheduledDelayMillis: 5000
        exportTimeoutMillis: 30000
        maxExportBatchSize: 512

    # Resource enrichment processor
    - name: "resource-processor"
      type: resource
      order: 2
      resourceConfig:
        attributes:
          environment: "${ENVIRONMENT}"
          version: "${SERVICE_VERSION}"
          deployment.name: "${DEPLOYMENT_NAME}"

    # Filter processor (exclude debug logs in production)
    - name: "production-filter"
      type: filter
      order: 3
      filterConfig:
        exclude:
          severityMax: DEBUG4

    # Redaction processor
    - name: "pii-redactor"
      type: redact
      order: 4
      transformConfig:
        operations:
          - type: hash-attribute
            config:
              attributes: ["user.email", "user.phone"]
              algorithm: "sha256"
          - type: delete-attribute
            config:
              attributes: ["password", "credit_card"]

    # Sampling processor
    - name: "debug-sampler"
      type: sampling
      order: 5
      samplingConfig:
        ratio: 0.1 # Sample 10% of debug logs
```

### MeterConfig

```yaml
MeterConfig:
  description: "Configuration for metric collection meters, specifying aggregation temporality, cardinality limits, and collection intervals. Controls how metrics are gathered and aggregated."
  attributes:
    id: string (UUID) [PK]
    name: string (meter name, e.g., "http.server", "database", "business")
    description: string (optional)
    version: string (optional)
    schemaUrl: string (optional)

  aggregation:
    temporality: AggregationTemporality [enum] (optional)
    histogramBoundaries: number[] (optional) # default bucket boundaries

  cardinality:
    maxAttributes: integer (optional) # max attributes per metric
    maxCardinality: integer (optional) # max unique label combinations
    overflowAttribute: string (optional) # attribute to use when cardinality exceeded

  collection:
    intervalMillis: integer (optional)
    timeoutMillis: integer (optional)

  contains:
    - instruments: MetricInstrument[] (1..*)

  enums:
    AggregationTemporality:
      - delta # Changes since last report
      - cumulative # Total since start

  examples:
    # HTTP server meter
    - name: "http.server"
      description: "HTTP server metrics"
      aggregation:
        temporality: cumulative
        histogramBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
      cardinality:
        maxAttributes: 10
        maxCardinality: 1000
        overflowAttribute: "overflow"
      collection:
        intervalMillis: 60000
      instruments:
        - type: histogram
          name: "request.duration"
          unit: "ms"
          description: "HTTP request duration"
        - type: counter
          name: "requests.total"
          unit: "1"
          description: "Total HTTP requests"

    # Database meter
    - name: "database"
      description: "Database metrics"
      aggregation:
        temporality: cumulative
        histogramBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000]
      instruments:
        - type: histogram
          name: "query.duration"
          unit: "ms"
          description: "Database query duration"
        - type: gauge
          name: "connections.active"
          unit: "1"
          description: "Active database connections"

    # Business metrics meter
    - name: "business"
      description: "Business domain metrics"
      aggregation:
        temporality: cumulative
      cardinality:
        maxCardinality: 10000
      instruments:
        - type: counter
          name: "product.views"
          unit: "1"
          description: "Product view count"
        - type: gauge
          name: "inventory.level"
          unit: "1"
          description: "Current inventory level"
```

### MetricInstrument

```yaml
MetricInstrument:
  description: "Defines a specific metric measurement instrument (Counter, Gauge, Histogram, etc.) with its name, unit, description, and attributes. The fundamental unit of metric collection."
  attributes:
    id: string (UUID) [PK]
    name: string (metric name, e.g., "request.duration")
    type: InstrumentType [enum]
    unit: string (e.g., "ms", "bytes", "1")
    description: string (optional)
    enabled: boolean (optional) # default: true

  configuration:
    attributes: string[] (optional) # attribute keys to record
    buckets: number[] (optional) # histogram bucket boundaries
    valueRecorder: string (optional) # for value observations

  # Cross-layer integration
  references:
    operationId: string (OpenAPI operationId, optional)
    uxComponentRef: string (UX Layer component reference, optional)
    navigationRouteRef: string (Navigation Layer route reference, optional)
    businessProcessRef: string (Business Layer process reference, optional)
    processStepName: string (specific process step, optional)
    securityThreatRef: string (Security Layer threat reference, optional)
    securityControlRef: string (Security Layer control reference, optional)
    securityAccountabilityRef: string (Security Layer accountability reference, optional)

  # Motivation Layer Integration
  motivationMapping:
    contributesToGoal: string (Goal ID, optional)
    measuresOutcome: string (Outcome ID, optional)
    fulfillsRequirements: string[] (Requirement IDs, optional)
    kpiFormula: string (KPI calculation formula, optional)

  validationCriteria:
    requirementId: string (Requirement ID being validated, optional)
    threshold: string (SLA/NFR threshold expression, optional)
    alertOnViolation: boolean (optional)

  # UX-specific configuration
  webVitals:
    - metric: string (e.g., "LCP", "FID", "CLS")
      threshold: string (target threshold)

  enums:
    InstrumentType:
      - counter # Monotonically increasing value
      - up_down_counter # Value that can increase or decrease
      - gauge # Current value at a point in time
      - histogram # Statistical distribution of values
      - observable_counter # Async counter (callback-based)
      - observable_up_down_counter # Async up/down counter
      - observable_gauge # Async gauge

  examples:
    # HTTP request duration histogram
    - name: "request.duration"
      type: histogram
      unit: "ms"
      description: "HTTP request duration"
      configuration:
        attributes: ["http.method", "http.route", "http.status_code"]
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
      motivationMapping:
        fulfillsRequirements: ["req-api-latency-under-200ms"]
      validationCriteria:
        requirementId: "req-api-latency-under-200ms"
        threshold: "p95 < 200ms"
        alertOnViolation: true

    # Request counter
    - name: "requests.total"
      type: counter
      unit: "1"
      description: "Total HTTP requests"
      configuration:
        attributes: ["http.method", "http.route", "http.status_code"]

    # Business metric - product views
    - name: "product.views"
      type: counter
      unit: "1"
      description: "Product view count"
      configuration:
        attributes: ["product.id", "product.category", "user.authenticated"]
      motivationMapping:
        contributesToGoal: "goal-customer-engagement"
        measuresOutcome: "outcome-increased-product-discovery"
        kpiFormula: "COUNT(product.views) WHERE time > goal.target-date"

    # Inventory gauge
    - name: "inventory.level"
      type: gauge
      unit: "1"
      description: "Current inventory level"
      configuration:
        attributes: ["product.id"]
      motivationMapping:
        contributesToGoal: "goal-inventory-accuracy"
        measuresOutcome: "outcome-reduced-stockouts"

    # Page load time with Web Vitals
    - name: "page.load-time"
      type: histogram
      unit: "ms"
      description: "Page load time"
      configuration:
        attributes: ["page.route", "device.type"]
        buckets: [100, 500, 1000, 2000, 2500, 3000, 5000]
      references:
        uxComponentRef: "product-list-screen"
      webVitals:
        - metric: "LCP"
          threshold: "< 2.5s"
        - metric: "FID"
          threshold: "< 100ms"
        - metric: "CLS"
          threshold: "< 0.1"
      motivationMapping:
        contributesToGoal: "goal-user-experience"
        fulfillsRequirements: ["req-fast-page-loads"]

    # Security metric - failed auth attempts
    - name: "failed-auth-attempts"
      type: counter
      unit: "1"
      description: "Failed authentication attempts"
      configuration:
        attributes: ["source.ip", "user.id"]
      references:
        securityThreatRef: "threat-brute-force-attack"
        securityControlRef: "control-rate-limiting"
      validationCriteria:
        threshold: "> 10 per minute"
        alertOnViolation: true

    # Process duration histogram
    - name: "order-fulfillment.duration"
      type: histogram
      unit: "ms"
      description: "Order fulfillment process duration"
      configuration:
        buckets: [60000, 300000, 600000, 1800000, 3600000, 7200000]
      references:
        businessProcessRef: "order-fulfillment-process"
        processStepName: "complete-fulfillment"
      motivationMapping:
        contributesToGoal: "goal-operational-efficiency"
        measuresOutcome: "outcome-faster-fulfillment"
        fulfillsRequirements: ["req-order-fulfillment-2hours"]
      validationCriteria:
        requirementId: "req-order-fulfillment-2hours"
        threshold: "p95 < 2 hours"
        alertOnViolation: true
```

### Attribute

```yaml
Attribute:
  description: "Key-value pair metadata"
  attributes:
    id: string (UUID) [PK]
    name: string
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

```
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
    id: string (UUID) [PK]
    name: string
    version: string (config version)
    application: string (application identifier)

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
    id: string (UUID) [PK]
    name: string
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
      - always_on # Sample everything
      - always_off # Sample nothing
      - traceidratio # Sample by trace ID ratio
      - parentbased_always_on
      - parentbased_always_off
      - parentbased_traceidratio

    PropagatorType:
      - w3c-trace-context # W3C Trace Context (recommended)
      - w3c-baggage # W3C Baggage
      - b3 # Zipkin B3
      - jaeger # Jaeger
      - xray # AWS X-Ray
      - ottrace # OpenTracing

  examples:
    - serviceName: "product-service"
      serviceVersion: "2.1.0"
      deploymentEnvironment: "production"
      sampler:
        type: parentbased_traceidratio
        config:
          ratio: 0.1
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
    name: string
    id: string (UUID) [PK]
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
    nonRepudiation: boolean (cryptographic proof of log integrity)

  enums:
    LogLevel:
      - TRACE
      - DEBUG
      - INFO
      - WARN
      - ERROR
      - FATAL

  examples:
    - serviceName: "product-service"
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
    id: string (UUID) [PK]
    name: string
    serviceName: string
    exportIntervalMillis: integer (optional)

  meters:
    - MeterConfig[] (1..*)

  exporters:
    - ExporterConfig[] (1..*)

  examples:
    - serviceName: "product-service"
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
    monitoringEnabled: boolean (optional)

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
    alertOnViolation: boolean (optional)

  # Motivation Layer Integration
  motivationMapping:
    contributesToGoal: string (Goal ID, optional)
    governedByPrinciples: string[] (Principle IDs, optional)
    fulfillsRequirements: string[] (Requirement IDs, optional)

  enums:
    DataQualityType:
      - completeness # % of required fields populated
      - accuracy # % of records passing validation
      - freshness # Age of most recent data
      - consistency # % of cross-schema constraint violations
      - uniqueness # % of duplicate records
      - validity # % conforming to business rules
      - timeliness # Data arrival within expected timeframe
      - integrity # Referential integrity violations

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
        "traceId": { "type": "string" },
        "spanId": { "type": "string" },
        "userId": { "type": "string" },
        "tenantId": { "type": "string" },
        "requestId": { "type": "string" },
        "sessionId": { "type": "string" },
        "correlationId": { "type": "string" }
      }
    },

    "request": {
      "type": "object",
      "description": "HTTP request details",
      "properties": {
        "method": { "type": "string" },
        "path": { "type": "string" },
        "queryParams": { "type": "object" },
        "headers": { "type": "object" },
        "remoteAddr": { "type": "string" },
        "userAgent": { "type": "string" }
      }
    },

    "response": {
      "type": "object",
      "description": "HTTP response details",
      "properties": {
        "statusCode": { "type": "integer" },
        "durationMs": { "type": "number" },
        "bytesWritten": { "type": "integer" }
      }
    },

    "error": {
      "type": "object",
      "description": "Error details if applicable",
      "properties": {
        "type": { "type": "string" },
        "message": { "type": "string" },
        "stackTrace": { "type": "string" }
      }
    },

    "performance": {
      "type": "object",
      "description": "Performance metrics",
      "properties": {
        "cpuTimeMs": { "type": "number" },
        "memoryUsedBytes": { "type": "integer" },
        "dbQueriesCount": { "type": "integer" },
        "dbTimeMs": { "type": "number" }
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
      ratio: 0.1 # Sample 10% of root spans
    governedByPrinciples:
      - "principle-cost-optimization"
      - "principle-privacy-by-design"
    rationale: "10% sampling balances observability needs with cost and privacy concerns"

  # Context propagation
  propagators:
    - w3c-trace-context # Primary propagator
    - w3c-baggage # For baggage propagation

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
            - metric: "LCP" # Largest Contentful Paint
              threshold: "< 2.5s"
            - metric: "FID" # First Input Delay
              threshold: "< 100ms"
            - metric: "CLS" # Cumulative Layout Shift
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

## Example Model

The following XML example demonstrates cross-layer integration using ArchiMate-style XML format.

```xml
<model>
  <!-- Example Metric with cross-layer properties -->
  <element id="product-metric" type="Metric">
    <n>Product Metric</n>
    <documentation>Example demonstrating cross-layer property usage</documentation>

    <!-- Motivation Layer Integration -->
    <property key="motivation.supports-goals">goal-example</property>
    <property key="motivation.governed-by-principles">principle-example</property>

    <!-- Security Layer Integration -->
    <property key="security.classification">internal</property>
  </element>
</model>
```

## Integration Points

**For complete link patterns and validation rules**, see [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md). The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer

- **Metric** contributes to **Goal** (motivationMapping.contributesToGoal property)
- **Metric** measures **Outcome** (motivationMapping.measuresOutcome property)
- **Metric** fulfills **Requirement** (motivationMapping.fulfillsRequirements property)
- **APMConfiguration** governed by **Principle** (motivationMapping.governedByPrinciples property)
- **TraceConfiguration** governed by **Principle** (sampler.governedByPrinciples property)
- **DataQualityMetric** governed by **Principle** (motivationMapping.governedByPrinciples property)

### To Business Layer

- **Span** references **BusinessProcess** (businessProcess property)
- **Span** references **ProcessStep** (processStepName property)
- **MetricInstrument** references **BusinessProcess** (businessProcessRef property)
- **MetricInstrument** references **ProcessStep** (processStepName property)

### To ArchiMate Application Layer

- **TraceConfiguration** references **ApplicationService** (applicationService property)
- **Span** references **ApplicationFunction** (name property)
- **Resource** references **ApplicationComponent** (attributes property)

### To Technology Layer

- **Resource** references **TechnologyComponent** (technology.component.id property)
- **Resource** references **Framework** (technology.framework property)
- **Resource** references **Runtime** (technology.runtime property)
- **Resource** references **CostCenter** (cloud.cost-center property)

### To API Layer (OpenAPI)

- **Span** references **APIOperation** (name property)

### To Data Model Layer

- **DataQualityMetric** references **Schema** (dataModelSchemaId property)

### To UX Layer

- **MetricInstrument** references **UXComponent** (uxComponentRef property)

### To Navigation Layer

- **MetricInstrument** references **Route** (navigationRouteRef property)

### To Data Store Layer

- **Span** tracks **QueryPerformance** (database property)

### To Security Layer

- **LogConfiguration** references **AccountabilityRequirement** (auditConfiguration.accountabilityRequirementRefs property)
- **MetricInstrument** references **Threat** (securityThreatRef property)
- **MetricInstrument** references **Control** (securityControlRef property)
- **MetricInstrument** references **AccountabilityRequirement** (securityAccountabilityRef property)

## Intra-Layer Relationships

**Purpose**: Define structural and behavioral relationships between entities within this layer, following OpenTelemetry standards for distributed tracing, metrics, and logging.

### Structural Relationships

Relationships that define the composition, aggregation, and specialization of entities within this layer.

| Relationship   | Source Element        | Target Element        | Predicate     | Inverse Predicate | Cardinality | Description                                                   |
| -------------- | --------------------- | --------------------- | ------------- | ----------------- | ----------- | ------------------------------------------------------------- |
| Composition    | Span                  | SpanEvent             | `composes`    | `composed-of`     | 1:N         | Span contains timestamped events occurring during execution   |
| Composition    | Span                  | SpanLink              | `composes`    | `composed-of`     | 1:N         | Span contains links to causally related spans                 |
| Composition    | Span                  | SpanStatus            | `composes`    | `composed-of`     | 1:1         | Span contains exactly one status indicating outcome           |
| Composition    | Span                  | Attribute             | `composes`    | `composed-of`     | 1:N         | Span contains key-value attributes for metadata               |
| Composition    | SpanEvent             | Attribute             | `composes`    | `composed-of`     | 1:N         | Span event contains event-specific attributes                 |
| Composition    | SpanLink              | Attribute             | `composes`    | `composed-of`     | 1:N         | Span link contains link-specific attributes                   |
| Composition    | LogRecord             | Attribute             | `composes`    | `composed-of`     | 1:N         | Log record contains contextual attributes                     |
| Composition    | Resource              | Attribute             | `composes`    | `composed-of`     | 1:N         | Resource contains identity and environment attributes         |
| Composition    | InstrumentationScope  | Attribute             | `composes`    | `composed-of`     | 1:N         | Instrumentation scope contains scope-specific attributes      |
| Composition    | APMConfiguration      | TraceConfiguration    | `composes`    | `composed-of`     | 1:1         | APM config contains trace configuration                       |
| Composition    | APMConfiguration      | LogConfiguration      | `composes`    | `composed-of`     | 1:1         | APM config contains log configuration                         |
| Composition    | APMConfiguration      | MetricConfiguration   | `composes`    | `composed-of`     | 1:1         | APM config contains metric configuration                      |
| Composition    | TraceConfiguration    | InstrumentationConfig | `composes`    | `composed-of`     | 1:N         | Trace config composes instrumentation configurations          |
| Composition    | LogConfiguration      | LogProcessor          | `composes`    | `composed-of`     | 1:N         | Log config composes processing pipeline stages                |
| Composition    | MetricConfiguration   | MeterConfig           | `composes`    | `composed-of`     | 1:N         | Metric config composes meter configurations                   |
| Composition    | MeterConfig           | MetricInstrument      | `composes`    | `composed-of`     | 1:N         | Meter config composes individual metric instruments           |
| Composition    | DataQualityMetrics    | DataQualityMetric     | `composes`    | `composed-of`     | 1:N         | Quality metrics container composes individual metrics         |
| Aggregation    | TraceConfiguration    | ExporterConfig        | `aggregates`  | `aggregated-by`   | 1:N         | Trace config aggregates trace exporters                       |
| Aggregation    | LogConfiguration      | ExporterConfig        | `aggregates`  | `aggregated-by`   | 1:N         | Log config aggregates log exporters                           |
| Aggregation    | MetricConfiguration   | ExporterConfig        | `aggregates`  | `aggregated-by`   | 1:N         | Metric config aggregates metric exporters                     |
| Aggregation    | Resource              | Span                  | `aggregates`  | `aggregated-by`   | 1:N         | Resource aggregates all spans it produces                     |
| Aggregation    | Resource              | LogRecord             | `aggregates`  | `aggregated-by`   | 1:N         | Resource aggregates all log records it produces               |
| Aggregation    | InstrumentationScope  | Span                  | `aggregates`  | `aggregated-by`   | 1:N         | Instrumentation scope aggregates spans it generates           |
| Aggregation    | InstrumentationScope  | MetricInstrument      | `aggregates`  | `aggregated-by`   | 1:N         | Instrumentation scope aggregates metrics it records           |
| Aggregation    | InstrumentationScope  | LogRecord             | `aggregates`  | `aggregated-by`   | 1:N         | Instrumentation scope aggregates logs it emits                |
| Specialization | MetricInstrument      | MetricInstrument      | `specializes` | `generalized-by`  | N:1         | Counter, Gauge, Histogram specialize base instrument          |
| Specialization | LogProcessor          | LogProcessor          | `specializes` | `generalized-by`  | N:1         | Batch, Filter, Transform processors specialize base processor |
| Specialization | ExporterConfig        | ExporterConfig        | `specializes` | `generalized-by`  | N:1         | OTLP, Jaeger, Prometheus exporters specialize base exporter   |
| Specialization | InstrumentationConfig | InstrumentationConfig | `specializes` | `generalized-by`  | N:1         | HTTP, Database, gRPC configs specialize base instrumentation  |
| Specialization | DataQualityMetric     | DataQualityMetric     | `specializes` | `generalized-by`  | N:1         | Completeness, Accuracy, Freshness specialize base metric      |

### Behavioral Relationships

Relationships that define interactions, flows, and dependencies between entities within this layer.

| Relationship | Source Element        | Target Element       | Predicate    | Inverse Predicate | Cardinality | Description                                                                  |
| ------------ | --------------------- | -------------------- | ------------ | ----------------- | ----------- | ---------------------------------------------------------------------------- |
| Reference    | Span                  | Span                 | `references` | `referenced-by`   | N:N         | Span references parent span via parentSpanId (trace hierarchy)               |
| Reference    | SpanLink              | Span                 | `references` | `referenced-by`   | N:1         | Span link references target span across traces                               |
| Reference    | LogRecord             | Span                 | `references` | `referenced-by`   | N:1         | Log record references associated span via traceContext                       |
| Reference    | MetricInstrument      | MeterConfig          | `references` | `referenced-by`   | N:1         | Metric instrument references its parent meter                                |
| Reference    | LogProcessor          | ExporterConfig       | `references` | `referenced-by`   | N:N         | Log processor routes records to exporters                                    |
| Reference    | SpanStatus            | Attribute            | `references` | `referenced-by`   | N:N         | Span status references attributes for status message details                 |
| Reference    | DataQualityMetrics    | InstrumentationScope | `references` | `referenced-by`   | N:N         | Quality metrics collection references instrumentation scopes being monitored |
| Triggering   | SpanEvent             | Span                 | `triggers`   | `triggered-by`    | N:1         | Span event triggers exception handling within span                           |
| Triggering   | MetricInstrument      | DataQualityMetric    | `triggers`   | `triggered-by`    | 1:N         | Threshold violation triggers quality alert                                   |
| Triggering   | DataQualityMetric     | LogRecord            | `triggers`   | `triggered-by`    | 1:N         | Quality violation triggers alert log record                                  |
| Flow         | Span                  | Span                 | `flows-to`   | `flows-from`      | N:N         | Span flows to child spans (request propagation)                              |
| Flow         | LogProcessor          | LogProcessor         | `flows-to`   | `flows-from`      | 1:1         | Log records flow through processor pipeline in order                         |
| Flow         | LogProcessor          | ExporterConfig       | `flows-to`   | `flows-from`      | N:N         | Processed logs flow to configured exporters                                  |
| Flow         | MetricInstrument      | ExporterConfig       | `flows-to`   | `flows-from`      | N:N         | Collected metrics flow to configured exporters                               |
| Flow         | Span                  | ExporterConfig       | `flows-to`   | `flows-from`      | N:N         | Completed spans flow to configured exporters                                 |
| Monitors     | MetricInstrument      | Resource             | `monitors`   | `monitored-by`    | N:1         | Metric instrument monitors resource performance                              |
| Monitors     | DataQualityMetric     | Resource             | `monitors`   | `monitored-by`    | N:1         | Quality metric monitors data produced by resource                            |
| Access       | LogProcessor          | Attribute            | `accesses`   | `accessed-by`     | 1:N         | Log processor accesses attributes for filtering/transformation               |
| Access       | LogProcessor          | LogRecord            | `accesses`   | `accessed-by`     | 1:N         | Log processor accesses log records for processing                            |
| Access       | MetricInstrument      | Attribute            | `accesses`   | `accessed-by`     | 1:N         | Metric instrument accesses attributes for labeling                           |
| Access       | DataQualityMetric     | Attribute            | `accesses`   | `accessed-by`     | 1:N         | Quality metric accesses attributes for validation                            |
| Depends-On   | Span                  | Resource             | `depends-on` | `dependency-of`   | N:1         | Span depends on resource for identity context                                |
| Depends-On   | Span                  | InstrumentationScope | `depends-on` | `dependency-of`   | N:1         | Span depends on instrumentation scope for source context                     |
| Depends-On   | LogRecord             | Resource             | `depends-on` | `dependency-of`   | N:1         | Log record depends on resource for identity context                          |
| Depends-On   | LogRecord             | InstrumentationScope | `depends-on` | `dependency-of`   | N:1         | Log record depends on instrumentation scope                                  |
| Depends-On   | MetricInstrument      | Resource             | `depends-on` | `dependency-of`   | N:1         | Metric instrument depends on resource for identity                           |
| Depends-On   | MetricInstrument      | InstrumentationScope | `depends-on` | `dependency-of`   | N:1         | Metric instrument depends on instrumentation scope                           |
| Depends-On   | ExporterConfig        | TraceConfiguration   | `depends-on` | `dependency-of`   | N:1         | Trace exporter depends on trace configuration                                |
| Depends-On   | ExporterConfig        | LogConfiguration     | `depends-on` | `dependency-of`   | N:1         | Log exporter depends on log configuration                                    |
| Depends-On   | ExporterConfig        | MetricConfiguration  | `depends-on` | `dependency-of`   | N:1         | Metric exporter depends on metric configuration                              |
| Measures     | MetricInstrument      | Span                 | `measures`   | `measured-by`     | N:N         | Metric instrument measures span duration/count                               |
| Measures     | MetricInstrument      | LogRecord            | `measures`   | `measured-by`     | N:N         | Metric instrument measures log event counts                                  |
| Measures     | DataQualityMetric     | MetricInstrument     | `measures`   | `measured-by`     | 1:N         | Quality metric measures other instrument accuracy                            |
| Serves       | InstrumentationConfig | Resource             | `serves`     | `served-by`       | N:N         | Instrumentation config serves resources it instruments                       |
| Serves       | ExporterConfig        | APMConfiguration     | `serves`     | `served-by`       | N:1         | Exporter serves APM configuration by delivering telemetry                    |

---

## Cross-Layer Relationships

**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.

### Outgoing Relationships (This Layer → Other Layers)

Links from entities in this layer to entities in other layers.

#### To Motivation Layer (01)

Links to strategic goals, requirements, principles, and constraints.

| Predicate                | Source Element | Target Element | Field Path                          | Strength | Required | Examples |
| ------------------------ | -------------- | -------------- | ----------------------------------- | -------- | -------- | -------- |
| `supports-goals`         | (TBD)          | Goal           | `motivation.supports-goals`         | High     | No       | (TBD)    |
| `fulfills-requirements`  | (TBD)          | Requirement    | `motivation.fulfills-requirements`  | High     | No       | (TBD)    |
| `governed-by-principles` | (TBD)          | Principle      | `motivation.governed-by-principles` | High     | No       | (TBD)    |
| `constrained-by`         | (TBD)          | Constraint     | `motivation.constrained-by`         | Medium   | No       | (TBD)    |

### Incoming Relationships (Other Layers → This Layer)

Links from entities in other layers to entities in this layer.

(To be documented based on actual usage patterns)

---

## Validation Rules

### Entity Validation

- **Required Fields**: `id`, `name`, `description`
- **ID Format**: UUID v4 or kebab-case string
- **Name**: Non-empty string, max 200 characters
- **Description**: Non-empty string, max 1000 characters

### Relationship Validation

#### Intra-Layer Relationships

- **Valid Types**: Composition, Aggregation, Specialization, Triggering, Flow, Access, Serving, Assignment
- **Source Validation**: Must reference existing entity in this layer
- **Target Validation**: Must reference existing entity in this layer
- **Cardinality**: Enforced based on relationship type

#### Cross-Layer Relationships

- **Target Existence**: Referenced entities must exist in target layer
- **Target Type**: Must match allowed target element types
- **Cardinality**:
  - Array fields: Multiple references allowed
  - Single fields: One reference only
- **Format Validation**:
  - UUID fields: Valid UUID v4 format
  - ID fields: Valid identifier format
  - Enum fields: Must match allowed values

### Schema Validation

All entities must validate against the layer schema file in `spec/schemas/`.

---

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
