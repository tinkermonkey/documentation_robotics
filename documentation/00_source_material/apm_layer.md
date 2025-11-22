## **Layer Analysis: APM/Observability**

| Layer | ArchiMate Native | Industry Standard | Gap? |
|-------|-----------------|-------------------|------|
| **APM/Observability** | ⚠️ Partial (Technology Layer events) | ✅ **OpenTelemetry** (OTLP) | Covered by standard |
| - Tracing | ❌ No native support | ✅ **OTel Trace** | Covered |
| - Metrics | ❌ No native support | ✅ **OTel Metrics** | Covered |
| - Logging | ❌ No native support | ✅ **OTel Logs** | Covered |

**Key Insight:** OpenTelemetry provides a complete observability standard including logs, eliminating the need for custom specs.

---

## **APM Layer Architecture**

```
┌─────────────────────────────────────────────────┐
│          ArchiMate Model (Spine)                │
│   - References to APM specs                     │
│   - Observability relationships                 │
└─────────────────────────────────────────────────┘
                    │
                    ▼
    ┌──────────────────────────────────┐
    │    OpenTelemetry Specifications   │
    │                                   │
    │  ┌──────────────────────────┐   │
    │  │   Trace Specification    │   │
    │  │  - Spans                  │   │
    │  │  - SpanContext            │   │
    │  │  - TraceState              │   │
    │  └──────────────────────────┘   │
    │                                   │
    │  ┌──────────────────────────┐   │
    │  │   Logs Specification     │   │
    │  │  - LogRecord               │   │
    │  │  - Resource                │   │
    │  │  - InstrumentationScope    │   │
    │  └──────────────────────────┘   │
    │                                   │
    │  ┌──────────────────────────┐   │
    │  │  Metrics Specification   │   │
    │  │  - Counter                 │   │
    │  │  - Gauge                   │   │
    │  │  - Histogram               │   │
    │  └──────────────────────────┘   │
    └──────────────────────────────────┘
```

---

## **APM Layer Metadata Model**

### **Entity: APMConfiguration**
```yaml
APMConfiguration:
  attributes:
    id: string (UUID)
    name: string
    version: string
    
  contains:
    - traceConfig: TraceConfiguration (1..1)
    - logConfig: LogConfiguration (1..1)
    - metricConfig: MetricConfiguration (0..1)
    
  references:
    - archimateElement: Element.id [Technology Layer]
```

### **Entity: TraceConfiguration**
```yaml
TraceConfiguration:
  attributes:
    serviceName: string
    serviceVersion: string
    deploymentEnvironment: string
    
  contains:
    - sampler: SamplerConfig (1..1)
    - propagators: PropagatorType[] (1..*)
    - exporters: ExporterConfig[] (1..*)
    
  references:
    - applicationComponent: Element.id [ApplicationComponent]
    
  enums:
    PropagatorType:
      - w3c-trace-context
      - w3c-baggage
      - b3
      - jaeger
      - xray
```

### **Entity: LogConfiguration**
```yaml
LogConfiguration:
  attributes:
    serviceName: string
    logLevel: LogLevel [enum]
    
  contains:
    - processors: LogProcessor[] (0..*)
    - exporters: ExporterConfig[] (1..*)
    - schema: LogSchema (1..1)
    
  enums:
    LogLevel:
      - TRACE
      - DEBUG
      - INFO
      - WARN
      - ERROR
      - FATAL
```

---

## **OpenTelemetry Trace Entities (Standard)**

These map directly to the OpenTelemetry specification:

### **Entity: Span**
```yaml
Span:
  attributes:
    traceId: string (hex, 16 bytes)
    spanId: string (hex, 8 bytes)
    traceState: string (optional, W3C format)
    parentSpanId: string (hex, 8 bytes, optional)
    name: string
    spanKind: SpanKind [enum]
    startTimeUnixNano: uint64
    endTimeUnixNano: uint64
    
  contains:
    - attributes: Attribute[] (0..*)
    - events: SpanEvent[] (0..*)
    - links: SpanLink[] (0..*)
    - status: SpanStatus (1..1)
    
  references:
    - operationId: string [OpenAPI operationId]
    - archimateService: Element.id [ApplicationService]
    
  enums:
    SpanKind:
      - INTERNAL
      - SERVER
      - CLIENT
      - PRODUCER
      - CONSUMER
```

### **Entity: SpanEvent**
```yaml
SpanEvent:
  attributes:
    timeUnixNano: uint64
    name: string
    droppedAttributesCount: uint32
    
  contains:
    - attributes: Attribute[] (0..*)
```

### **Entity: SpanLink**
```yaml
SpanLink:
  attributes:
    traceId: string (hex, 16 bytes)
    spanId: string (hex, 8 bytes)
    traceState: string (optional)
    droppedAttributesCount: uint32
    
  contains:
    - attributes: Attribute[] (0..*)
```

### **Entity: SpanStatus**
```yaml
SpanStatus:
  attributes:
    code: StatusCode [enum]
    message: string (optional)
    
  enums:
    StatusCode:
      - UNSET
      - OK
      - ERROR
```

---

## **OpenTelemetry Log Entities (Standard)**

### **Entity: LogRecord**
```yaml
LogRecord:
  attributes:
    timeUnixNano: uint64
    observedTimeUnixNano: uint64
    severityNumber: SeverityNumber [enum]
    severityText: string (optional)
    body: AnyValue
    
  contains:
    - attributes: Attribute[] (0..*)
    - resource: Resource (1..1)
    - instrumentationScope: InstrumentationScope (1..1)
    
  references:
    - traceId: string (hex, 16 bytes, optional)
    - spanId: string (hex, 8 bytes, optional)
    
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
```

### **Entity: Resource**
```yaml
Resource:
  attributes:
    schemaUrl: string (optional)
    
  contains:
    - attributes: Attribute[] (1..*)
    
  # Standard resource attributes per OTel semantic conventions
  standardAttributes:
    - service.name: string
    - service.namespace: string
    - service.instance.id: string
    - service.version: string
    - deployment.environment: string
    - host.name: string
    - host.type: string
    - container.name: string
    - container.id: string
    - k8s.pod.name: string
    - k8s.namespace.name: string
    - cloud.provider: string
    - cloud.region: string
```

### **Entity: Attribute**
```yaml
Attribute:
  attributes:
    key: string
    value: AnyValue
    
  # AnyValue can be:
  types:
    - stringValue: string
    - boolValue: boolean
    - intValue: int64
    - doubleValue: double
    - arrayValue: AnyValue[]
    - kvlistValue: KeyValue[]
    - bytesValue: bytes
```

---

## **Application-Specific Log Schema (JSON Schema)**

While OpenTelemetry defines the transport format, you'll want a consistent structure for your application logs:

### **specs/log-schema.json**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/schemas/application-log.json",
  "title": "ApplicationLogEntry",
  "description": "Standard application log entry format",
  
  "type": "object",
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
    
    "thread": {
      "type": "string",
      "description": "Thread name"
    },
    
    "context": {
      "type": "object",
      "description": "Contextual data",
      "properties": {
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
        "method": {
          "type": "string",
          "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
        },
        "path": { "type": "string" },
        "queryParams": { "type": "object" },
        "headers": { "type": "object" },
        "body": { "type": ["object", "string", "null"] },
        "remoteAddr": { "type": "string" },
        "userAgent": { "type": "string" }
      }
    },
    
    "response": {
      "type": "object",
      "description": "HTTP response details",
      "properties": {
        "statusCode": { "type": "integer" },
        "headers": { "type": "object" },
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
        "stackTrace": { "type": "string" },
        "cause": { "$ref": "#/definitions/Error" }
      }
    },
    
    "performance": {
      "type": "object",
      "description": "Performance metrics",
      "properties": {
        "cpuTimeMs": { "type": "number" },
        "memoryUsedBytes": { "type": "integer" },
        "dbQueriesCount": { "type": "integer" },
        "dbTimeMs": { "type": "number" },
        "cacheHits": { "type": "integer" },
        "cacheMisses": { "type": "integer" }
      }
    },
    
    "custom": {
      "type": "object",
      "description": "Application-specific fields",
      "additionalProperties": true
    }
  },
  
  "required": ["timestamp", "level", "message"],
  
  "x-otel-mapping": {
    "description": "Mapping to OpenTelemetry LogRecord",
    "mappings": {
      "timestamp": "timeUnixNano",
      "level": "severityText",
      "message": "body",
      "context.requestId": "attributes[http.request.id]",
      "context.userId": "attributes[enduser.id]",
      "request.method": "attributes[http.request.method]",
      "request.path": "attributes[http.route]",
      "response.statusCode": "attributes[http.response.status_code]",
      "response.durationMs": "attributes[http.request.duration]"
    }
  }
}
```

---

## **Cross-Layer Integration**

### **1. ArchiMate Integration**

```xml
<model>
  <!-- Technology Service: Observability Platform -->
  <element id="observability-platform" type="TechnologyService">
    <name>Observability Platform</name>
    <property key="spec.apm">specs/apm-config.yaml</property>
  </element>
  
  <!-- Application Service with APM -->
  <element id="product-api" type="ApplicationService">
    <name>Product API</name>
    <property key="spec.openapi">specs/product-api.yaml</property>
    <property key="apm.service">product-service</property>
    <property key="apm.traced">true</property>
  </element>
  
  <!-- Technology Process: Log Aggregation -->
  <element id="log-aggregation" type="TechnologyProcess">
    <name>Log Aggregation</name>
    <property key="spec.logs">specs/log-schema.json</property>
  </element>
  
  <!-- Relationships -->
  <relationship type="Flow" source="product-api" target="observability-platform">
    <property key="data.type">telemetry</property>
  </relationship>
</model>
```

### **2. OpenAPI Integration with Tracing**

```yaml
# specs/product-api.yaml
openapi: 3.0.0

paths:
  /api/products/{id}:
    get:
      operationId: getProduct
      x-otel-attributes:
        span.kind: SERVER
        service.name: product-service
        custom.attributes:
          - product.operation: read
          - cache.enabled: true
      
      x-logging:
        level: INFO
        includeRequest: true
        includeResponse: true
        sensitiveFields: ["password", "token"]
```

### **3. APM Configuration File**

```yaml
# specs/apm-config.yaml
apmConfiguration:
  version: "1.0"
  
  tracing:
    serviceName: product-service
    serviceVersion: ${SERVICE_VERSION}
    deploymentEnvironment: ${ENV}
    
    sampler:
      type: parentbased_traceidratio
      ratio: 0.1  # Sample 10% of traces
    
    propagators:
      - w3c-trace-context
      - w3c-baggage
    
    exporters:
      - type: otlp
        endpoint: http://otel-collector:4317
        headers:
          api-key: ${OTLP_API_KEY}
    
    instrumentations:
      - http:
          recordRequestHeaders: ["x-request-id", "x-tenant-id"]
          recordResponseHeaders: ["x-response-time"]
      
      - database:
          recordQueries: true
          sanitizeStatements: true
  
  logging:
    serviceName: product-service
    logLevel: ${LOG_LEVEL:INFO}
    
    schema:
      $ref: "log-schema.json"
    
    processors:
      - type: batch
        maxQueueSize: 2048
        scheduledDelayMillis: 5000
    
      - type: resource
        attributes:
          environment: ${ENV}
          version: ${SERVICE_VERSION}
    
    exporters:
      - type: otlp
        endpoint: http://otel-collector:4317
      
      - type: console
        enabled: ${CONSOLE_LOGS:false}
  
  metrics:
    serviceName: product-service
    
    meters:
      - name: http.server
        instruments:
          - type: histogram
            name: request.duration
            unit: ms
            buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500]
      
      - name: business
        instruments:
          - type: counter
            name: product.views
            unit: 1
            attributes: ["product.id", "product.category"]
```

---

## **Cross-Reference Validation**

### **Entity: APMCrossReference**
```yaml
APMCrossReference:
  validations:
    - OpenAPIOperationToSpan:
        description: "Each traced API operation should generate spans"
        check: |
          For each OpenAPI operation with x-otel-attributes:
            - Verify span.name matches operationId
            - Verify span.kind matches x-otel-attributes.span.kind
    
    - LogToSpanCorrelation:
        description: "Logs within a request should have trace context"
        check: |
          For each LogRecord with traceId:
            - Verify traceId exists in Span collection
            - Verify timestamp within span start/end time
    
    - ArchimateToAPM:
        description: "Traced services should have APM config"
        check: |
          For each ArchiMate element with apm.traced=true:
            - Verify apm.service exists in APM config
            - Verify spec.apm references valid config file
```

---

## **Code Generation Examples**

### **Trace Instrumentation Generator**

```typescript
// Generated from OpenAPI + APM config
import { trace, context, SpanKind } from '@opentelemetry/api';

const tracer = trace.getTracer('product-service', '1.0.0');

// Generated from OpenAPI operation
export async function getProduct(id: number): Promise<Product> {
  return tracer.startActiveSpan(
    'getProduct',  // operationId
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': 'GET',
        'http.route': '/api/products/{id}',
        'product.operation': 'read',
        'cache.enabled': true,
        'product.id': id
      }
    },
    async (span) => {
      try {
        // Log with trace context
        logger.info('Getting product', {
          productId: id,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId
        });
        
        const product = await fetchProduct(id);
        
        span.setStatus({ code: SpanStatusCode.OK });
        return product;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR,
          message: error.message 
        });
        throw error;
      } finally {
        span.end();
      }
    }
  );
}
```

### **Structured Logger Generator**

```typescript
// Generated from log-schema.json
interface ApplicationLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  logger?: string;
  context?: {
    userId?: string;
    tenantId?: string;
    requestId?: string;
    correlationId?: string;
  };
  request?: RequestInfo;
  response?: ResponseInfo;
  error?: ErrorInfo;
  performance?: PerformanceMetrics;
  custom?: Record<string, any>;
}

class StructuredLogger {
  log(entry: ApplicationLog): void {
    // Get current span context if available
    const span = trace.getActiveSpan();
    if (span) {
      const spanContext = span.spanContext();
      entry.context = {
        ...entry.context,
        traceId: spanContext.traceId,
        spanId: spanContext.spanId
      };
    }
    
    // Convert to OpenTelemetry LogRecord
    const logRecord = this.toOTelLogRecord(entry);
    
    // Export via OpenTelemetry
    this.loggerProvider.emit(logRecord);
  }
}
```

---

## **Summary**

**Standards Used:**
- ✅ **OpenTelemetry** for traces, metrics, and logs (no custom invention needed)
- ✅ **JSON Schema** for application log structure
- ✅ **W3C Trace Context** for distributed tracing propagation

**What You DON'T Need to Invent:**
- Trace/span data model (use OpenTelemetry)
- Log transport format (use OpenTelemetry Logs)
- Metrics data model (use OpenTelemetry Metrics)
- Context propagation (use W3C standards)

**What You Configure/Define:**
- APM configuration schema (simple YAML)
- Application log structure (JSON Schema)
- Cross-references to ArchiMate elements
- OpenAPI extensions for tracing hints

**Integration Points:**
1. ArchiMate elements reference APM configurations
2. OpenAPI operations map to span names
3. JSON Schema defines application log structure
4. OpenTelemetry provides the transport and correlation
