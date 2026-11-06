---
name: LAYER_06_API
description: Expert knowledge for API Layer modeling in Documentation Robotics
triggers:
  [
    "OpenAPI",
    "REST API",
    "endpoint",
    "operation",
    "swagger",
    "API specification",
    "HTTP method",
    "request",
    "response"
  ]
version: 0.8.3
---

# API Layer Skill

**Layer Number:** 06
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines REST API contracts using OpenAPI 3.0, specifying endpoints, operations, request/response schemas, and security requirements.

---

## Layer Overview

The API Layer captures **API contracts**:

- **OPERATIONS** - HTTP methods on paths (GET, POST, PUT, DELETE, PATCH)
- **SCHEMAS** - Request/response data structures
- **SECURITY** - Authentication and authorization schemes
- **DOCUMENTATION** - API metadata, descriptions, examples
- **INTEGRATION** - Links to business services, application services, data models

This layer uses **OpenAPI 3.0.3** (de facto industry standard) with custom extensions for cross-layer traceability.

**Central Entity:** The **Operation** (HTTP method on a path) is the core modeling unit.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types api` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

### Core OpenAPI Entities (13 entities)

| Entity Type         | Description                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **OpenAPIDocument** | Root of an OpenAPI specification file (version 3.0.3)                                       |
| **Info**            | Metadata about the API (title, description, version, contact, license)                      |
| **Server**          | Server where the API is available (with URL and variables)                                  |
| **Paths**           | Available API endpoints and operations                                                      |
| **PathItem**        | Operations available on a path                                                              |
| **Operation**       | Single API operation (HTTP method on a path) - **CENTRAL ENTITY**                           |
| **Parameter**       | Parameter for an operation (locations: query, header, path, cookie)                         |
| **RequestBody**     | Request payload for an operation                                                            |
| **Responses**       | Possible responses from an operation                                                        |
| **Response**        | Single response definition with status code                                                 |
| **MediaType**       | Media type and schema for request/response body                                             |
| **Components**      | Reusable component definitions (schemas, responses, parameters, examples, security schemes) |
| **Schema**          | Data type definition (JSON Schema subset)                                                   |

### Metadata Entities (11 entities)

| Entity Type               | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| **Tag**                   | Metadata label for grouping operations                                 |
| **ExternalDocumentation** | Reference to external documentation                                    |
| **Contact**               | Contact information for API owner                                      |
| **License**               | Legal license for API                                                  |
| **ServerVariable**        | Variable placeholder in server URL templates                           |
| **Header**                | HTTP header parameters for requests/responses                          |
| **Link**                  | Relationship between API responses and subsequent operations (HATEOAS) |
| **Callback**              | Webhook or callback URL pattern                                        |
| **Example**               | Sample values for documentation and testing                            |
| **Encoding**              | Serialization details for multipart content                            |
| **SecurityScheme**        | Security mechanism (types: apiKey, http, oauth2, openIdConnect)        |

### Supporting Entities (3 entities)

| Entity Type    | Description                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------- |
| **OAuthFlows** | Configuration for OAuth 2.0 flows                                                           |
| **OAuthFlow**  | Single OAuth 2.0 flow definition (authorizationCode, implicit, password, clientCredentials) |
| **RateLimit**  | Rate limiting policy for an operation (requests per window, key strategy, action on breach) |

---

## Type Decision Tree

For each construct encountered, ask "what is this?" and assign the first matching type.

```
Root OpenAPI specification file/object?                            → api.openapidocument
API-level metadata (title, description, version)?                  → api.info
Contact information for the API owner?                             → api.contact
Legal license declaration?                                         → api.license
Server/host where the API is available (URL)?                      → api.server
Variable placeholder in a server URL template (e.g., {version})?  → api.servervariable
Container of all URL paths (the `paths:` block)?                   → api.paths
A specific URL path with its available HTTP methods?               → api.pathitem
A single HTTP method on a path (GET, POST, PUT, DELETE, PATCH)?    → api.operation
A parameter — query, path, header, or cookie?                      → api.parameter
  ↳ NOTE: request bodies are NOT parameters → use api.requestbody
Request payload/body for an operation?                             → api.requestbody
Container of all possible responses for an operation?              → api.responses
  ↳ NOTE: not a single response — use api.response for each status code
A single response for a specific HTTP status code?                 → api.response
Media type + schema pair (e.g., application/json with schema)?     → api.mediatype
Data structure / schema definition (JSON Schema subset)?           → api.schema
HTTP header for a request or response?                             → api.header
Grouping label used to organize operations?                        → api.tag
Reference to external documentation (URL)?                         → api.externaldocumentation
Container for reusable definitions (schemas, responses, params)?   → api.components
Security mechanism definition (apiKey, http, oauth2)?              → api.securityscheme
Container of all OAuth 2.0 flow types for a security scheme?       → api.oauthflows
  ↳ NOTE: the individual flows inside are NOT api.oauthflows
A single OAuth 2.0 flow (authorizationCode, implicit, etc.)?       → api.oauthflow
HATEOAS link from a response to a subsequent operation?            → api.link
Webhook / callback URL pattern triggered by an operation?          → api.callback
Sample value for documentation or testing?                         → api.example
Serialization details for multipart form content?                  → api.encoding
Rate limiting policy (requests per window, key strategy)?          → api.ratelimit
```

---

## Common Misclassifications

| Misclassification                                            | Correct Classification                                                                                                            | Why                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Using `api.response.*` for the set of all responses          | `api.responses.*` is the container; `api.response.*` is a single status code response                                             | `responses` is the plural container; `response` is one entry within it                            |
| Using `api.oauthflows.*` for a single flow                   | `api.oauthflow.*` — each flow variant (authorizationCode, implicit, etc.) is its own node                                         | `oauthflows` is the multi-flow container; `oauthflow` is one flow definition                      |
| Modeling schemas inline as `api.mediatype.*`                 | Schemas are `api.schema.*`; `mediatype` just pairs a content type with a schema reference                                         | MediaType is the content-type envelope; Schema is the data structure inside it                    |
| Using `api.parameter.*` for the request body                 | Request bodies are `api.requestbody.*`; parameters are query/path/header/cookie values only                                       | The OpenAPI spec distinguishes body from parameters explicitly                                    |
| Using `api.schema.*` for an entire API endpoint              | Endpoints are `api.pathitem.*` + `api.operation.*`; schemas are data type definitions only                                        | Schema ≠ endpoint                                                                                 |
| Putting rate limit config as a property on `api.operation.*` | `api.ratelimit.*` is a dedicated node type for rate limiting policies                                                             | Model rate limits as first-class nodes so they can be referenced and reasoned about independently |
| Using `api.components.*` to represent every reusable object  | `api.components.*` is the container; individual reusables (schemas, parameters, etc.) are their own typed nodes composed under it | Components is a structural container, not a substitute for specific types                         |

---

## Intra-Layer Relationships

### Composition Relationships (Part cannot exist without whole)

| Source Type     | Predicate | Target Type    | Example                                             |
| --------------- | --------- | -------------- | --------------------------------------------------- |
| OpenAPIDocument | composes  | Info           | "Payment API" composes "Payment API Info"           |
| OpenAPIDocument | composes  | Paths          | "Payment API" composes "Payment API Paths"          |
| OpenAPIDocument | composes  | Components     | "Payment API" composes "Payment API Components"     |
| Paths           | composes  | PathItem       | "Payment API Paths" composes "/payments/{id}"       |
| PathItem        | composes  | Operation      | "/payments/{id}" composes "getPayment"              |
| Operation       | composes  | Responses      | "getPayment" composes "getPayment Responses"        |
| Responses       | composes  | Response       | "getPayment Responses" composes "200 Payment Found" |
| RequestBody     | composes  | MediaType      | "Payment Request Body" composes "application/json"  |
| Response        | composes  | MediaType      | "200 Payment Found" composes "application/json"     |
| Response        | composes  | Header         | "201 Created" composes "Location"                   |
| Response        | composes  | Link           | "201 Created" composes "GetCreatedPayment"          |
| MediaType       | composes  | Schema         | "application/json" composes "Payment"               |
| MediaType       | composes  | Encoding       | "multipart/form-data" composes "receipt encoding"   |
| Components      | composes  | Schema         | "Payment API Components" composes "Payment"         |
| Components      | composes  | Parameter      | "Payment API Components" composes "PageSize"        |
| Components      | composes  | Response       | "Payment API Components" composes "404 Not Found"   |
| Components      | composes  | SecurityScheme | "Payment API Components" composes "oauth2-auth"     |
| SecurityScheme  | composes  | OAuthFlows     | "oauth2-auth" composes "oauth2-auth Flows"          |
| OAuthFlows      | composes  | OAuthFlow      | "oauth2-auth Flows" composes "Authorization Code"   |

### Aggregation Relationships (Part can exist independently)

| Source Type     | Predicate  | Target Type    | Example                                                 |
| --------------- | ---------- | -------------- | ------------------------------------------------------- |
| OpenAPIDocument | aggregates | Server         | "Payment API" aggregates "Production Server"            |
| OpenAPIDocument | aggregates | Tag            | "Payment API" aggregates "payments"                     |
| Server          | aggregates | ServerVariable | "Regional Server" aggregates "region"                   |
| Info            | aggregates | Contact        | "Payment API Info" aggregates "Payments Team"           |
| Info            | aggregates | License        | "Payment API Info" aggregates "Apache 2.0"              |
| PathItem        | aggregates | Parameter      | "/payments/{id}" aggregates "paymentId"                 |
| Operation       | aggregates | Parameter      | "listPayments" aggregates "status"                      |
| Operation       | aggregates | RequestBody    | "processPayment" aggregates "Payment Request Body"      |
| Components      | aggregates | RequestBody    | "Payment API Components" aggregates "Refund Request"    |
| Components      | aggregates | Callback       | "Payment API Components" aggregates "paymentSettled"    |
| Callback        | aggregates | PathItem       | "paymentSettled" aggregates "{$request.body#/callback}" |

### Reference Relationships

| Source Type | Predicate  | Target Type           | Example                                            |
| ----------- | ---------- | --------------------- | -------------------------------------------------- |
| Schema      | references | Schema                | "Payment" references "Money"                       |
| Parameter   | references | Schema                | "status" references "PaymentStatus"                |
| Header      | references | Schema                | "X-Request-Id" references "UUID"                   |
| RequestBody | references | Schema                | "Payment Request Body" references "PaymentRequest" |
| Response    | references | Schema                | "200 Payment Found" references "Payment"           |
| Link        | references | Operation             | "GetCreatedPayment" references "getPayment"        |
| Operation   | references | Tag                   | "processPayment" references "payments"             |
| Tag         | references | ExternalDocumentation | "payments" references "Payments Guide"             |

### Specialization Relationships

| Source Type | Predicate   | Target Type | Example                                                 |
| ----------- | ----------- | ----------- | ------------------------------------------------------- |
| Schema      | specializes | Schema      | "CardPayment" specializes "Payment" (allOf)             |
| Header      | specializes | Parameter   | "X-Request-Id" header specializes "requestId" parameter |

### Behavioral Relationships

| Source Type     | Predicate | Target Type    | Example                                                |
| --------------- | --------- | -------------- | ------------------------------------------------------ |
| Operation       | delivers  | Response       | "getPayment" delivers "200 Payment Found"              |
| Operation       | triggers  | Callback       | "processPayment" triggers "paymentSettled"             |
| Operation       | uses      | SecurityScheme | "processPayment" uses "oauth2-auth"                    |
| OpenAPIDocument | requires  | SecurityScheme | "Payment API" requires "oauth2-auth" (global)          |
| SecurityScheme  | serves    | Operation      | "api-key-auth" serves "listPayments"                   |
| RateLimit       | governs   | Operation      | "Standard Tier Limit" governs "processPayment"         |
| RateLimit       | triggers  | Response       | "Standard Tier Limit" triggers "429 Too Many Requests" |

---

## Cross-Layer References

Cross-layer links are recorded with `dr relationship add`, not with `x-*` extension properties. Value-only
extensions such as `x-apm-sla-target-latency` or `x-apm-criticality` are still recorded as element
attributes (see [Custom Extension Reference](#custom-extension-reference)).

### Outgoing References (API → Other Layers)

| Source Type     | Predicate  | Target Type                       | Example                                              |
| --------------- | ---------- | --------------------------------- | ---------------------------------------------------- |
| OpenAPIDocument | realizes   | `application.applicationservice`  | "Payment API" realizes "Payment Service"             |
| OpenAPIDocument | realizes   | `business.businessservice`        | "Payment API" realizes "Payment Processing"          |
| Operation       | realizes   | `application.applicationfunction` | "processPayment" realizes "Authorize Payment"        |
| Operation       | realizes   | `business.businessprocess`        | "submitOrder" realizes "Order Placement"             |
| Operation       | exposes    | `product.feature`                 | "exportReport" exposes "CSV Export"                  |
| Operation       | triggers   | `application.applicationevent`    | "createOrder" triggers "Order Created"               |
| Server          | depends-on | `technology.node`                 | "Production Server" depends on "EKS Cluster"         |
| Operation       | requires   | `security.permission`             | "refundPayment" requires "payments:refund"           |
| Operation       | references | `security.secureresource`         | "getPayment" references "Payment Records"            |
| SecurityScheme  | realizes   | `security.securitypolicy`         | "oauth2-auth" realizes "Authenticated Access Policy" |
| RateLimit       | realizes   | `security.countermeasure`         | "Login Rate Limit" realizes "Brute-force Throttling" |
| Operation       | realizes   | `motivation.goal`                 | "processPayment" realizes "Reduce Checkout Time"     |
| Operation       | satisfies  | `motivation.requirement`          | "refundPayment" satisfies "Self-service Refunds"     |
| Operation       | satisfies  | `motivation.constraint`           | "exportUserData" satisfies "GDPR Data Portability"   |
| Schema          | maps-to    | `data-store.collection`           | "Payment" maps to "payments table"                   |

### Incoming References (Other Layers → API)

| Source Type                   | Predicate | Target Type    | Example                                                 |
| ----------------------------- | --------- | -------------- | ------------------------------------------------------- |
| `data-model.schemadefinition` | maps-to   | Schema         | "PaymentRequest definition" maps to "PaymentRequest"    |
| `data-model.objectschema`     | maps-to   | RequestBody    | "PaymentRequest object" maps to "Payment Request Body"  |
| `data-model.schemaproperty`   | maps-to   | Parameter      | "payment.status" maps to "status"                       |
| `data-store.accesspattern`    | maps-to   | Operation      | "Payments by Customer" maps to "listPayments"           |
| `ux.actioncomponent`          | triggers  | Operation      | "Pay Now Button" triggers "processPayment"              |
| `ux.view`                     | accesses  | Operation      | "Payment History View" accesses "listPayments"          |
| `navigation.route`            | maps-to   | PathItem       | "/payments/:id route" maps to "/payments/{id}"          |
| `navigation.navigationguard`  | uses      | SecurityScheme | "Require Login Guard" uses "oauth2-auth"                |
| `apm.metricinstrument`        | monitors  | Operation      | "payment.latency" monitors "processPayment"             |
| `apm.span`                    | monitors  | Operation      | "POST /payments span" monitors "processPayment"         |
| `testing.testcasesketch`      | tests     | Operation      | "Declined Card Sketch" tests "processPayment"           |
| `testing.testcasesketch`      | validates | Response       | "Declined Card Sketch" validates "402 Payment Required" |

---

## Codebase Detection Patterns

### Pattern 1: FastAPI Python

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(
    title="User Management API",  # OpenAPIDocument: Info.title
    description="API for managing user accounts",  # Info.description
    version="1.0.0"  # Info.version
)

class UserCreateRequest(BaseModel):  # Schema (RequestBody)
    username: str
    email: str
    full_name: str

class UserResponse(BaseModel):  # Schema (Response)
    user_id: str
    username: str
    email: str
    created_at: datetime

@app.post(
    "/api/users",  # PathItem + Operation (POST)
    response_model=UserResponse,  # Response schema
    status_code=201,  # Response status
    tags=["Users"],  # Tag
    summary="Create a new user",  # Operation.summary
    description="Creates a new user account with the provided details"  # Operation.description
)
async def create_user(user: UserCreateRequest) -> UserResponse:  # RequestBody + Response
    """
    x-apm-sla-target-latency: 200ms
    x-required-permissions: users.write
    """
    pass
```

**Maps to:**

- OpenAPIDocument: "User Management API"
- PathItem: "/api/users"
- Operation: "POST /api/users"
- RequestBody: MediaType (application/json) with Schema (UserCreateRequest)
- Response: 201 with Schema (UserResponse)
- Tag: "Users"

### Pattern 2: Express.js TypeScript

```typescript
import express from "express";
import { body, param, query, validationResult } from "express-validator";

const router = express.Router();

/**
 * @openapi
 * /api/orders/{orderId}:
 *   get:
 *     summary: Get order by ID
 *     description: Retrieves a single order by its unique identifier
 *     tags:
 *       - Orders
 *     parameters:
 *       - name: orderId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Order found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Order'
 *       404:
 *         description: Order not found
 *     x-apm-sla-target-latency: 100ms
 *     x-apm-criticality: high
 */
router.get(
  "/api/orders/:orderId",
  param("orderId").isUUID(),
  async (req, res) => {
    // Implementation
  }
);
```

**Maps to:**

- PathItem: "/api/orders/{orderId}"
- Operation: "GET /api/orders/{orderId}"
- Parameter: "orderId" (in: path, type: string, format: uuid)
- Response: 200 with schema reference
- Response: 404 error response
- Custom extensions: x-apm-sla-target-latency, x-apm-criticality

### Pattern 3: Spring Boot Java

```java
@RestController
@RequestMapping("/api/products")
@Tag(name = "Products", description = "Product management operations")
public class ProductController {

    @Operation(
        summary = "List products",
        description = "Returns a paginated list of products",
        extensions = {
            @Extension(name = "x-apm-sla-target-latency", properties = @ExtensionProperty(name = "latency", value = "150ms")),
            @Extension(name = "x-required-permissions", properties = @ExtensionProperty(name = "permissions", value = "products.read"))
        }
    )
    @ApiResponses({
        @ApiResponse(
            responseCode = "200",
            description = "Products retrieved successfully",
            content = @Content(
                mediaType = "application/json",
                schema = @Schema(implementation = ProductListResponse.class)
            )
        )
    })
    @GetMapping
    public ResponseEntity<ProductListResponse> listProducts(
        @Parameter(description = "Page number", example = "1") @RequestParam(defaultValue = "1") int page,
        @Parameter(description = "Page size", example = "20") @RequestParam(defaultValue = "20") int size
    ) {
        // Implementation
    }
}
```

**Maps to:**

- PathItem: "/api/products"
- Operation: "GET /api/products"
- Parameters: "page" (query), "size" (query)
- Response: 200 with ProductListResponse schema
- Tag: "Products"
- Custom extensions

### Pattern 4: OpenAPI YAML Definition

```yaml
openapi: 3.0.3
info:
  title: Payment Processing API
  description: API for processing customer payments
  version: 2.1.0
  contact:
    name: API Support
    email: api-support@example.com
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT
  x-governed-by-principles:
    - motivation/principle/api-first-design
    - motivation/principle/security-by-design

servers:
  - url: https://api.example.com/v2
    description: Production server
  - url: https://staging-api.example.com/v2
    description: Staging server

paths:
  /payments:
    post:
      summary: Process payment
      description: Processes a payment transaction
      operationId: processPayment
      tags:
        - Payments
      security:
        - oauth2: [payments.write]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PaymentRequest"
            examples:
              credit-card:
                $ref: "#/components/examples/CreditCardPayment"
      responses:
        "201":
          description: Payment processed successfully
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PaymentResponse"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
      x-apm-sla-target-latency: 500ms
      x-apm-sla-target-availability: 99.99%
      x-apm-criticality: critical
      x-required-permissions:
        - payments.write
      x-rate-limit:
        requests: 100
        window: 60s

components:
  schemas:
    PaymentRequest:
      type: object
      required:
        - amount
        - currency
        - payment_method
      properties:
        amount:
          type: number
          format: double
          minimum: 0.01
          example: 99.99
        currency:
          type: string
          enum: [USD, EUR, GBP]
          example: USD
        payment_method:
          $ref: "#/components/schemas/PaymentMethod"

    PaymentResponse:
      type: object
      properties:
        transaction_id:
          type: string
          format: uuid
        status:
          type: string
          enum: [pending, completed, failed]
        timestamp:
          type: string
          format: date-time

  securitySchemes:
    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/oauth/authorize
          tokenUrl: https://auth.example.com/oauth/token
          scopes:
            payments.read: Read payment information
            payments.write: Process payments

  responses:
    BadRequest:
      description: Invalid request
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"

  examples:
    CreditCardPayment:
      value:
        amount: 99.99
        currency: USD
        payment_method:
          type: credit_card
          card_number: "4111111111111111"
```

---

## Modeling Workflow

### Step 1: Create OpenAPI Document

```bash
# Create the API specification document
dr add api openapidocument "payment-api" \
  --description "API for processing customer payments"

# Add API metadata
# NOTE: api.info requires a companion api.openapidocument to avoid orphan warnings.
# Always create api.openapidocument first, then link api.info to it via composes.
dr add api info "payment-api-info" \
  --description "API metadata and contact information"

dr relationship add api.openapidocument.payment-api \
  api.info.payment-api-info --predicate composes

```

### Step 2: Define Servers

```bash
# Production server
dr add api server "production-server" \
  --description "Production API server"

# Staging server
dr add api server "staging-server" \
  --description "Staging API server"
```

### Step 3: Define Security Schemes

```bash
# OAuth2 security
dr add api securityscheme "oauth2-auth" \
  --description "OAuth2 authorization code flow"

# API Key security
dr add api securityscheme "api-key-auth" \
  --description "API key authentication"
```

### Step 4: Define Schemas (Data Models)

```bash
# Request schema
dr add api schema "payment-request" \
  --description "Payment request payload"

# Response schema
dr add api schema "payment-response" \
  --description "Payment processing response"

# Link from the data model layer
dr relationship add data-model.schemadefinition.payment-request \
  api.schema.payment-request --predicate maps-to
```

### Step 5: Define Operations (Core Entities)

```bash
# POST operation
dr add api operation "process-payment" \
  --description "Processes a payment transaction"

# Link to business layer via relationship
dr relationship add api.operation.process-payment \
  business.businessprocess.payment-processing --predicate realizes

# GET operation
dr add api operation "get-payment" \
  --description "Retrieves payment details by ID"
```

### Step 6: Define Parameters

```bash
# Path parameter
dr add api parameter "payment-id-param" \
  --description "Payment transaction ID"

# Query parameter
dr add api parameter "status-filter" \
  --description "Filter payments by status"

# Link parameter to operation
dr relationship add api.operation.get-payment \
  api.parameter.payment-id-param --predicate aggregates
```

### Step 7: Define Request/Response Bodies

```bash
# Request body
dr add api requestbody "payment-request-body" \
  --description "Payment request payload"

# Link request body to schema
dr relationship add api.requestbody.payment-request-body \
  api.schema.payment-request --predicate references

# Response
dr add api response "payment-success-response" \
  --description "Successful payment response"

# Link response to schema
dr relationship add api.response.payment-success-response \
  api.schema.payment-response --predicate references
```

### Step 8: Define Tags for Organization

```bash
# Add tags
dr add api tag "payments" \
  --description "Payment processing operations"

dr add api tag "refunds" \
  --description "Refund operations"

# Tag operations
dr relationship add api.operation.process-payment \
  api.tag.payments --predicate references
```

### Step 9: Cross-Layer Integration

```bash
# Link to business layer
dr relationship add api.openapidocument.payment-api \
  business.businessservice.payment-processing --predicate realizes

# Link to application layer
dr relationship add api.openapidocument.payment-api \
  application.applicationservice.payment-service --predicate realizes

# Link to security layer
dr relationship add api.operation.process-payment \
  security.secureresource.payment-records --predicate references

dr relationship add api.operation.process-payment \
  security.permission.payments-write --predicate requires

# Link to motivation layer
dr relationship add api.operation.process-payment \
  motivation.goal.reduce-checkout-time --predicate realizes

# Link from APM layer (APM monitors the operation)
dr relationship add apm.metricinstrument.payment-processing-latency \
  api.operation.process-payment --predicate monitors
```

### Step 10: Validate and Export

```bash
# Validate API layer
dr validate --layers api

# Export to OpenAPI YAML
dr export openapi --output payment-api.yaml

# Validate exported OpenAPI with external tools
spectral lint payment-api.yaml
```

---

## Operation-Level SLA Patterns

Different operations have different SLA targets:

```yaml
# Search operation: fast response
x-apm-sla-target-latency: "50ms"
x-apm-sla-target-availability: "99.9%"
x-apm-criticality: "high"

# Write operation: moderate latency
x-apm-sla-target-latency: "200ms"
x-apm-sla-target-availability: "99.95%"
x-apm-criticality: "critical"

# Batch operation: longer latency acceptable
x-apm-sla-target-latency: "10s"
x-apm-sla-target-availability: "99.5%"
x-apm-criticality: "medium"

# Reporting: can be slower
x-apm-sla-target-latency: "5s"
x-apm-sla-target-availability: "99%"
x-apm-criticality: "low"
```

---

## Best Practices

1. **Operation is the Central Entity** - Model operations, not just paths
2. **Use OpenAPI 3.0.3** - Latest stable version with broad tooling support
3. **Tag Operations** - Organize operations by domain or resource
4. **Define Reusable Components** - Schemas, responses, parameters in Components section
5. **Document Examples** - Include request/response examples for testing and documentation
6. **Security at Operation Level** - Different operations can have different security requirements
7. **Link to Business Services** - Use `dr relationship add` to link API operations to business services for traceability
8. **Define SLA Targets** - Use x-apm-sla-target-\* attributes for monitoring
9. **Version APIs Properly** - Use semantic versioning (major.minor.patch)
10. **Generate from Code** - Use FastAPI, NestJS decorators, or Springdoc to auto-generate OpenAPI specs

---

## OpenAPI Tooling Ecosystem

### Generation Tools

- **FastAPI** (Python) - Auto-generates OpenAPI from Python decorators
- **NestJS** (TypeScript) - Swagger module for OpenAPI generation
- **Springdoc** (Java) - OpenAPI 3 for Spring Boot applications
- **Express + swagger-jsdoc** (Node.js) - Generate from JSDoc comments

### Validation Tools

- **Spectral** - OpenAPI linter and validator
- **openapi-validator** - IBM's OpenAPI validator
- **swagger-cli** - Validate and bundle OpenAPI specs

### Documentation Tools

- **Swagger UI** - Interactive API documentation
- **Redoc** - Clean, customizable API documentation
- **Postman** - Import OpenAPI for API testing

### Code Generation Tools

- **OpenAPI Generator** - Generate client SDKs and server stubs
- **swagger-codegen** - Legacy code generation tool
- **oapi-codegen** (Go) - Generate Go server/client from OpenAPI

---

## Validation Tips

| Issue                | Cause                                  | Fix                                                                           |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| Missing Operations   | Paths defined but no operations        | Add HTTP methods (GET, POST, etc.)                                            |
| Unlinked Schemas     | Schemas not referenced by operations   | Link schemas to request/response bodies                                       |
| Missing Security     | Operations lack security requirements  | Add securitySchemes and apply to operations                                   |
| No Cross-Layer Links | API not linked to business/application | Run `dr relationship add <api-element> <target-element> --predicate realizes` |
| Missing SLA Targets  | Operations lack performance targets    | Add x-apm-sla-target-\* extensions                                            |
| Untagged Operations  | Operations not organized by tags       | Add tags for grouping                                                         |
| No Examples          | Schemas lack examples                  | Add example values for documentation                                          |
| Invalid OpenAPI      | Spec doesn't validate                  | Use Spectral or openapi-validator                                             |

---

## Quick Reference

**Add Commands:**

```bash
dr add api openapidocument <name>
dr add api operation <name>
dr add api schema <name>
dr add api parameter <name>
dr add api securityscheme <name>
dr add api tag <name>
```

**Relationship Commands:**

```bash
dr relationship add <response> <schema> --predicate references
dr relationship add <operation> <parameter> --predicate aggregates
dr relationship add <operation> <tag> --predicate references
dr relationship add <operation> <response> --predicate delivers
dr relationship add <schema> <schema> --predicate references
```

**Cross-Layer Commands:**

```bash
dr relationship add <api-operation> <business-process> --predicate realizes
dr relationship add <api-openapidocument> <application-service> --predicate realizes
dr relationship add <data-model-schemadefinition> <api-schema> --predicate maps-to
dr relationship add <api-operation> <security-permission> --predicate requires
dr relationship add <api-operation> <motivation-goal> --predicate realizes
```

**Export Commands:**

```bash
dr export openapi --output api-spec.yaml
dr export openapi --layers api --output api-spec.json
```

**Validation Commands:**

```bash
dr validate --layers api
spectral lint api-spec.yaml
swagger-cli validate api-spec.yaml
```

---

## Custom Extension Reference

Documentation Robotics keeps value-only OpenAPI extensions as element attributes:

```yaml
x-rate-limit:
  requests: 100
  window: 60s
x-apm-sla-target-latency: "100ms"
x-apm-sla-target-availability: "99.9%"
x-apm-trace: true
x-apm-criticality: "high" # critical, high, medium, low
```

Extensions that point at elements in other layers are recorded as catalog relationships instead
(see [Cross-Layer References](#cross-layer-references)):

| Legacy extension           | Record as                                                                     |
| -------------------------- | ----------------------------------------------------------------------------- |
| `x-supports-goals`         | `api.operation` `realizes` `motivation.goal`                                  |
| `x-fulfills-requirements`  | `api.operation` `satisfies` `motivation.requirement`                          |
| `x-constrained-by`         | `api.operation` `satisfies` `motivation.constraint`                           |
| `x-governed-by-principles` | `api.securityscheme` `satisfies` `motivation.principle` (security principles) |
| `x-security-resource`      | `api.operation` `references` `security.secureresource`                        |
| `x-required-permissions`   | `api.operation` `requires` `security.permission`                              |
| `x-apm-business-metrics`   | `apm.metricinstrument` `monitors` `api.operation`                             |

---

## Coverage Completeness Checklist

Before declaring API layer extraction complete, verify each type was considered:

- [ ] **api.openapidocument** — Root OpenAPI specification document
- [ ] **api.info** — API metadata (title, version, description)
- [ ] **api.contact** — Contact information for the API owner
- [ ] **api.license** — Legal license for the API
- [ ] **api.server** — Server URLs where the API is available
- [ ] **api.servervariable** — Variable placeholders in server URL templates
- [ ] **api.paths** — Container of all API endpoint paths
- [ ] **api.pathitem** — Operations available on a specific URL path
- [ ] **api.operation** — Individual HTTP operations (GET, POST, PUT, DELETE, PATCH) — CENTRAL ENTITY
- [ ] **api.parameter** — Query, path, header, or cookie parameters
- [ ] **api.requestbody** — Request payload for an operation
- [ ] **api.responses** — Container of all possible responses for an operation
- [ ] **api.response** — Single response definition for a specific HTTP status code
- [ ] **api.mediatype** — Media type + schema pair for request/response bodies
- [ ] **api.schema** — Data type definitions (JSON Schema subset)
- [ ] **api.header** — HTTP header parameters
- [ ] **api.tag** — Grouping labels for organizing operations
- [ ] **api.externaldocumentation** — References to external documentation
- [ ] **api.components** — Container for reusable API component definitions
- [ ] **api.securityscheme** — Security mechanism definitions (apiKey, http, oauth2, openIdConnect)
- [ ] **api.oauthflows** — OAuth 2.0 flows configuration container
- [ ] **api.oauthflow** — Single OAuth 2.0 flow (authorizationCode, implicit, password, clientCredentials)
- [ ] **api.link** — HATEOAS links from responses to subsequent operations
- [ ] **api.callback** — Webhook / callback URL patterns
- [ ] **api.example** — Sample values for documentation and testing
- [ ] **api.encoding** — Serialization details for multipart content
- [ ] **api.ratelimit** — Rate limiting policies (requests per window, key strategy)

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.

---

## Summary

The API Layer is the **contract layer** - it defines HOW external consumers interact with your system. Every operation should:

1. Be linked to a business service (traceability)
2. Have clear request/response schemas
3. Define security requirements
4. Specify SLA targets for monitoring
5. Include examples for documentation and testing

Use OpenAPI 3.0.3 as the foundation, leverage auto-generation tools from your framework, and record cross-layer links as catalog relationships for full traceability.
