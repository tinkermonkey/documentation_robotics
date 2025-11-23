# API Layer - OpenAPI 3.0 Specification

## Overview

The API Layer defines the application programming interfaces using the industry-standard OpenAPI Specification (formerly Swagger). This layer leverages an existing, mature standard rather than inventing custom API documentation formats.

## Layer Characteristics

- **Standard**: OpenAPI 3.0.3
- **Custom Extensions**: Minimal (x-archimate-ref, x-security-policy)
- **Validation**: OpenAPI validators (Swagger, Spectral, etc.)
- **Tooling**: Swagger UI, Postman, code generators, validators

## Why OpenAPI?

OpenAPI is the de facto standard for REST API specification:

- **Industry Standard**: Widely adopted, understood, and supported
- **Rich Ecosystem**: Extensive tooling for validation, documentation, testing, code generation
- **Machine Readable**: Enables automation and code generation
- **Human Friendly**: YAML format is readable and maintainable
- **Interoperable**: Other systems can consume our API specs

## Core OpenAPI Structure

### OpenAPIDocument

```yaml
OpenAPIDocument:
  description: "Root of an OpenAPI specification file"
  attributes:
    openapi: string (version, e.g., "3.0.3") [required]
    info: Info [required]
    servers: Server[] (0..*)
    paths: Paths [required]
    components: Components (optional)
    security: SecurityRequirement[] (0..*)
    tags: Tag[] (0..*)
    externalDocs: ExternalDocumentation (optional)

  # Custom extensions for federated architecture
  extensions:
    x-archimate-ref: string (Element.id reference to ApplicationService)
    x-service-tier: enum [api-gateway, service, backend]

    # Document-level Motivation Layer Integration
    x-governed-by-principles: string[] (Principle IDs that guide this API, optional)
```

### Info

```yaml
Info:
  description: "Metadata about the API"
  attributes:
    title: string [required]
    description: string (optional)
    version: string [required] (semantic version)
    termsOfService: string (URL, optional)
    contact: Contact (optional)
    license: License (optional)

  example:
    title: "Product Management API"
    description: "API for managing product catalog"
    version: "2.1.0"
    contact:
      name: "API Support"
      email: "api@example.com"
      url: "https://support.example.com"
    license:
      name: "Apache 2.0"
      url: "https://www.apache.org/licenses/LICENSE-2.0.html"
```

### Server

```yaml
Server:
  description: "Server where the API is available"
  attributes:
    url: string [required] (URL or URL template)
    description: string (optional)
    variables: ServerVariable[] (keyed by name, optional)

  examples:
    - url: "https://api.example.com/v2"
      description: "Production server"

    - url: "https://{environment}.api.example.com/v2"
      description: "Environment-specific server"
      variables:
        environment:
          default: "prod"
          enum: ["dev", "staging", "prod"]
          description: "Deployment environment"
```

### Paths

```yaml
Paths:
  description: "Available API endpoints and operations"
  structure: object (keyed by path pattern)

  pathPattern:
    string (e.g., "/products/{id}")
    # Each path contains PathItem
```

### PathItem

```yaml
PathItem:
  description: "Operations available on a path"
  attributes:
    summary: string (optional)
    description: string (optional)
    servers: Server[] (optional, overrides root servers)
    parameters: Parameter[] (optional, shared across operations)

  operations:
    get: Operation (optional)
    put: Operation (optional)
    post: Operation (optional)
    delete: Operation (optional)
    options: Operation (optional)
    head: Operation (optional)
    patch: Operation (optional)
    trace: Operation (optional)
```

### Operation

```yaml
Operation:
  description: "Single API operation (HTTP method on a path)"
  attributes:
    operationId: string [required, unique] # Used for cross-references
    summary: string (optional, short description)
    description: string (optional, detailed description)
    tags: string[] (optional, for grouping)
    deprecated: boolean (default: false)

  contains:
    parameters: Parameter[] (optional)
    requestBody: RequestBody (optional)
    responses: Responses [required]
    callbacks: Callback[] (optional)
    security: SecurityRequirement[] (optional)

  # Custom extensions
  extensions:
    x-archimate-ref: string (Element.id reference)
    x-rate-limit: string (e.g., "100/minute")
    x-cache-ttl: integer (seconds, optional)

    # Business Layer Integration
    x-business-service-ref: string (BusinessService.id, optional)
    x-business-interface-ref: string (BusinessInterface.id, optional)

    # Motivation Layer Integration
    x-supports-goals: string[] (Goal IDs, optional)
    x-fulfills-requirements: string[] (Requirement IDs, optional)
    x-governed-by-principles: string[] (Principle IDs, optional)
    x-constrained-by: string[] (Constraint IDs for regulatory/compliance, optional)

    # APM/Observability Layer Integration
    x-apm-trace: boolean (default: true)
    x-apm-sla-target-latency: string (e.g., "200ms", "500ms", optional)
    x-apm-sla-target-availability: string (e.g., "99.95%", "99.99%", optional)
    x-apm-business-metrics: string[] (metric IDs this operation affects, optional)
    x-apm-criticality: enum [low, medium, high, critical] (optional)

    # Security Layer Integration
    x-security-resource: string (SecureResource.resource, optional)
    x-required-permissions: string[] (Permission.name[], optional)

  example:
    operationId: "getProduct"
    summary: "Get product by ID"
    description: "Retrieves detailed information about a product"
    tags: ["products"]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      "200":
        description: "Successful response"
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Product"
      "404":
        description: "Product not found"
    x-archimate-ref: "app-service-product-api"
    x-rate-limit: "1000/hour"
    # Business Layer Integration
    x-business-service-ref: "business-service-product-catalog"
    x-business-interface-ref: "business-interface-customer-portal"
    # Motivation Layer Integration
    x-supports-goals: ["goal-product-catalog-accuracy", "goal-customer-satisfaction"]
    x-fulfills-requirements: ["req-product-retrieval-capability", "req-uuid-based-access"]
    x-governed-by-principles: ["principle-api-first", "principle-rest-conventions"]
    # APM/Observability Layer Integration
    x-apm-sla-target-latency: "200ms"
    x-apm-sla-target-availability: "99.95%"
    x-apm-business-metrics: ["metric-product-views", "metric-api-response-time"]
    x-apm-criticality: high
    # Security Layer Integration
    x-security-resource: "product-api"
    x-required-permissions: ["product.read"]
```

### Parameter

```yaml
Parameter:
  description: "Parameter for an operation"
  attributes:
    name: string [required]
    in: ParameterLocation [required]
    description: string (optional)
    required: boolean (required for path params, optional otherwise)
    deprecated: boolean (default: false)
    allowEmptyValue: boolean (default: false)

  schema:
    schema: Schema [required] # Data type

  style: ParameterStyle (optional, default depends on 'in')
  explode: boolean (optional)

  enums:
    ParameterLocation:
      - query      # Query string parameter
      - header     # HTTP header
      - path       # Path parameter (always required)
      - cookie     # Cookie parameter

    ParameterStyle:
      - matrix
      - label
      - form       # Default for query
      - simple     # Default for path/header
      - spaceDelimited
      - pipeDelimited
      - deepObject

  examples:
    # Path parameter
    - name: "id"
      in: path
      required: true
      schema:
        type: string
        format: uuid
      description: "Product identifier"

    # Query parameter
    - name: "limit"
      in: query
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      description: "Maximum number of results"

    # Header parameter
    - name: "X-Request-ID"
      in: header
      schema:
        type: string
        format: uuid
      description: "Unique request identifier for tracing"
```

### RequestBody

```yaml
RequestBody:
  description: "Request payload for an operation"
  attributes:
    description: string (optional)
    required: boolean (default: false)

  content:
    mediaTypes: MediaType[] [required] (keyed by content type)

  example:
    description: "Product data to create or update"
    required: true
    content:
      application/json:
        schema:
          $ref: "#/components/schemas/ProductInput"
        examples:
          minimal:
            summary: "Minimal product"
            value:
              name: "Widget"
              price: 9.99
          full:
            summary: "Complete product"
            value:
              name: "Premium Widget"
              price: 29.99
              description: "High-quality widget"
              category: "electronics"
```

### Responses

```yaml
Responses:
  description: "Possible responses from an operation"
  structure: object (keyed by HTTP status code or 'default')

  response:
    statusCode: string [required] (e.g., "200", "404", "default")
    # Each contains Response object
```

### Response

```yaml
Response:
  description: "Single response definition"
  attributes:
    description: string [required]

  headers: Header[] (optional, keyed by name)
  content: MediaType[] (optional, keyed by content type)
  links: Link[] (optional, keyed by name)

  examples:
    # Success response
    "200":
      description: "Successful operation"
      headers:
        X-Rate-Limit-Remaining:
          schema:
            type: integer
          description: "Number of requests remaining"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Product"

    # Error response
    "400":
      description: "Invalid request"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"

    # Default response
    "default":
      description: "Unexpected error"
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
```

### MediaType

```yaml
MediaType:
  description: "Media type and schema for request/response body"
  attributes:
    contentType: string (key, e.g., "application/json")

  schema: Schema (optional)
  example: any (optional)
  examples: Example[] (optional, keyed by name)
  encoding: Encoding[] (optional, for multipart/form-data)
```

### Components

```yaml
Components:
  description: "Reusable component definitions"
  contains:
    schemas: Schema[] (keyed by name)
    responses: Response[] (keyed by name)
    parameters: Parameter[] (keyed by name)
    examples: Example[] (keyed by name)
    requestBodies: RequestBody[] (keyed by name)
    headers: Header[] (keyed by name)
    securitySchemes: SecurityScheme[] (keyed by name)
    links: Link[] (keyed by name)
    callbacks: Callback[] (keyed by name)
```

### Schema

```yaml
Schema:
  description: "Data type definition (JSON Schema subset)"
  attributes:
    type: JSONType (string, number, integer, boolean, array, object)
    title: string (optional)
    description: string (optional)
    format: string (optional, e.g., "date-time", "email", "uuid")
    default: any (optional)
    enum: any[] (optional)
    nullable: boolean (default: false, OpenAPI 3.0 extension)

  # Validation keywords
  validation:
    # String
    minLength: integer
    maxLength: integer
    pattern: string (regex)

    # Numeric
    minimum: number
    maximum: number
    exclusiveMinimum: boolean
    exclusiveMaximum: boolean
    multipleOf: number

    # Array
    minItems: integer
    maxItems: integer
    uniqueItems: boolean
    items: Schema (for arrays)

    # Object
    properties: Schema[] (keyed by property name)
    required: string[] (property names)
    additionalProperties: boolean | Schema
    minProperties: integer
    maxProperties: integer

  # Composition
  allOf: Schema[] # All schemas must match
  oneOf: Schema[] # Exactly one schema must match
  anyOf: Schema[] # At least one schema must match
  not: Schema # Must NOT match this schema

  # Reference
  $ref: string # Reference to another schema

  # Custom extensions
  extensions:
    x-database-table: string
    x-database-column: string
    x-pii: boolean
    x-encrypted: boolean
```

### SecurityScheme

```yaml
SecurityScheme:
  description: "Security mechanism for the API"
  attributes:
    type: SecurityType [required]
    description: string (optional)
    name: string (required for apiKey)
    in: ParameterLocation (required for apiKey)
    scheme: string (required for http, e.g., "bearer", "basic")
    bearerFormat: string (optional, e.g., "JWT")

  # OAuth2 specific
  flows: OAuthFlows (required for oauth2)

  # OpenID Connect specific
  openIdConnectUrl: string (required for openIdConnect)

  enums:
    SecurityType:
      - apiKey
      - http
      - oauth2
      - openIdConnect

  examples:
    # Bearer token (JWT)
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: "JWT token authentication"

    # API Key
    apiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: "API key authentication"

    # OAuth2
    oauth2Auth:
      type: oauth2
      description: "OAuth2 authentication"
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/authorize
          tokenUrl: https://auth.example.com/token
          scopes:
            read:products: "Read product data"
            write:products: "Modify product data"
```

## Complete Example: Product API

```yaml
# File: specs/api/product-api.yaml
openapi: 3.0.3

info:
  title: Product Management API
  description: |
    RESTful API for managing product catalog

    ## Features
    - CRUD operations for products
    - Product search and filtering
    - Category management
    - Inventory tracking
  version: 2.1.0
  contact:
    name: Product Team
    email: product-team@example.com
  license:
    name: Apache 2.0
    url: https://www.apache.org/licenses/LICENSE-2.0.html

servers:
  - url: https://api.example.com/v2
    description: Production server
  - url: https://staging-api.example.com/v2
    description: Staging server
  - url: http://localhost:3000/v2
    description: Local development server

# Custom extensions for federated architecture
x-archimate-ref: app-service-product-api

# Document-level Motivation Layer Integration
x-governed-by-principles:
  - principle-api-first
  - principle-versioning-strategy
  - principle-backwards-compatibility
  - principle-rest-conventions

tags:
  - name: products
    description: Product operations
  - name: categories
    description: Category operations

paths:
  /products:
    get:
      operationId: listProducts
      summary: List products
      description: Retrieve a paginated list of products with optional filtering
      tags: [products]
      parameters:
        - name: limit
          in: query
          description: Maximum number of products to return
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: offset
          in: query
          description: Number of products to skip
          schema:
            type: integer
            minimum: 0
            default: 0
        - name: category
          in: query
          description: Filter by category
          schema:
            type: string
        - name: search
          in: query
          description: Search in product name and description
          schema:
            type: string
      responses:
        "200":
          description: Successful response
          headers:
            X-Total-Count:
              description: Total number of products
              schema:
                type: integer
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items:
                      $ref: "#/components/schemas/Product"
                  pagination:
                    $ref: "#/components/schemas/Pagination"
      x-rate-limit: "1000/hour"
      # Business Layer Integration
      x-business-service-ref: "business-service-product-catalog"
      x-business-interface-ref: "business-interface-customer-portal"
      # Motivation Layer Integration
      x-supports-goals: ["goal-product-catalog-accuracy", "goal-customer-satisfaction"]
      # APM/Observability Layer Integration
      x-apm-trace: true
      x-apm-sla-target-latency: "100ms"
      x-apm-sla-target-availability: "99.99%"
      x-apm-business-metrics: ["metric-catalog-findability", "metric-search-success-rate"]
      x-apm-criticality: critical
      # Security Layer Integration
      x-security-resource: "product-api"
      x-required-permissions: ["product.read"]

    post:
      operationId: createProduct
      summary: Create product
      description: Create a new product in the catalog
      tags: [products]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ProductInput"
      responses:
        "201":
          description: Product created successfully
          headers:
            Location:
              description: URL of created product
              schema:
                type: string
                format: uri
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Product"
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
      security:
        - bearerAuth: []
      x-rate-limit: "100/hour"
      # Business Layer Integration
      x-business-service-ref: "business-service-product-catalog"
      # Motivation Layer Integration
      x-supports-goals: ["goal-catalog-expansion", "goal-seller-enablement"]
      x-fulfills-requirements: ["req-product-creation-capability", "req-authenticated-write-access"]
      x-governed-by-principles: ["principle-security-by-design", "principle-api-first"]
      # APM/Observability Layer Integration
      x-apm-sla-target-latency: "500ms"
      x-apm-sla-target-availability: "99.9%"
      x-apm-business-metrics: ["metric-catalog-growth", "metric-seller-productivity"]
      x-apm-criticality: high
      # Security Layer Integration
      x-security-resource: "product-api"
      x-required-permissions: ["product.create"]

  /products/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: Product identifier
        schema:
          type: string
          format: uuid

    get:
      operationId: getProduct
      summary: Get product
      description: Retrieve a single product by ID
      tags: [products]
      responses:
        "200":
          description: Successful response
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Product"
        "404":
          $ref: "#/components/responses/NotFound"
      x-rate-limit: "2000/hour"

    put:
      operationId: updateProduct
      summary: Update product
      description: Update an existing product
      tags: [products]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ProductInput"
      responses:
        "200":
          description: Product updated successfully
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Product"
        "400":
          $ref: "#/components/responses/BadRequest"
        "404":
          $ref: "#/components/responses/NotFound"
      security:
        - bearerAuth: []

    delete:
      operationId: deleteProduct
      summary: Delete product
      description: Delete a product from the catalog
      tags: [products]
      responses:
        "204":
          description: Product deleted successfully
        "404":
          $ref: "#/components/responses/NotFound"
      security:
        - bearerAuth: []
      # Business Layer Integration
      x-business-service-ref: "business-service-product-catalog"
      # Motivation Layer Integration
      x-supports-goals: ["goal-data-governance"]
      x-fulfills-requirements: ["req-product-deletion-capability"]
      x-governed-by-principles: ["principle-security-by-design"]
      x-constrained-by: ["constraint-data-retention-policy", "constraint-audit-trail-required"]
      # APM/Observability Layer Integration
      x-apm-sla-target-latency: "300ms"
      x-apm-sla-target-availability: "99.9%"
      x-apm-business-metrics: ["metric-catalog-maintenance"]
      x-apm-criticality: medium
      # Security Layer Integration
      x-security-resource: "product-api"
      x-required-permissions: ["product.delete"]

components:
  schemas:
    Product:
      type: object
      required: [id, name, sku, price, category]
      properties:
        id:
          type: string
          format: uuid
          description: Unique product identifier
          readOnly: true
        name:
          type: string
          minLength: 1
          maxLength: 200
          description: Product name
        sku:
          type: string
          pattern: "^[A-Z]{2}\\d{4}$"
          description: Stock keeping unit (format AA1234)
        description:
          type: string
          maxLength: 2000
          description: Detailed product description
        price:
          type: number
          format: double
          minimum: 0
          description: Product price in USD
        category:
          type: string
          enum: [electronics, clothing, food, books, other]
          description: Product category
        stockQuantity:
          type: integer
          minimum: 0
          description: Current stock level
        reorderPoint:
          type: integer
          minimum: 0
          description: Reorder threshold
        createdAt:
          type: string
          format: date-time
          description: Creation timestamp
          readOnly: true
        updatedAt:
          type: string
          format: date-time
          description: Last update timestamp
          readOnly: true
      x-database-table: products

    ProductInput:
      type: object
      required: [name, sku, price, category]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 200
        sku:
          type: string
          pattern: "^[A-Z]{2}\\d{4}$"
        description:
          type: string
          maxLength: 2000
        price:
          type: number
          format: double
          minimum: 0
        category:
          type: string
          enum: [electronics, clothing, food, books, other]
        stockQuantity:
          type: integer
          minimum: 0
          default: 0
        reorderPoint:
          type: integer
          minimum: 0
          default: 10

    Pagination:
      type: object
      properties:
        limit:
          type: integer
        offset:
          type: integer
        total:
          type: integer
          description: Total number of items

    Error:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
          description: Error code
        message:
          type: string
          description: Human-readable error message
        details:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              message:
                type: string

  responses:
    BadRequest:
      description: Invalid request
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"

    Unauthorized:
      description: Authentication required
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"

    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: JWT token authentication

security:
  - {} # Some endpoints are public
```

## Integration Points

### To Motivation Layer

- **Operations support Goals**: x-supports-goals links API operations to business objectives they enable
- **Operations fulfill Requirements**: x-fulfills-requirements links API endpoints to Requirements they implement
- **Principles guide API design**: x-governed-by-principles ensures API follows design Principles (REST, versioning, etc.)
- **Operations constrained by regulatory/compliance**: x-constrained-by links operations to Constraints (GDPR, data retention, audit requirements)
- **Requirements traceability**: Complete chain from business need → goal → requirement → API operation
- **Architecture decision records**: Principles explain "why" certain API designs were chosen

**Example Traceability Chain**:

```
Goal (goal-customer-satisfaction)
  → BusinessService (business-service-product-catalog)
    → API Operation (GET /products)
      → Metrics (metric-catalog-findability)
        → Outcome validation
```

### To Business Layer

- **Operations realize BusinessServices**: x-business-service-ref links operations to the business capability they implement
- **Operations exposed via BusinessInterface**: x-business-interface-ref links operations to business access points (web portal, partner API, etc.)
- **Digital manifestation**: API operations are the digital realization of business services
- **Business impact analysis**: Enables understanding which business services are affected when APIs change

**Bidirectional Navigation**:

- BusinessInterface.interface.api-operations (downward documentation reference)
- Operation.x-business-service-ref (upward implementation reference)

### To ArchiMate Application Layer

- OpenAPI document references ApplicationService via x-archimate-ref
- Operation maps to ApplicationFunction or ApplicationService
- Enables traceability from business requirements to API implementation

### To Data Model Layer (JSON Schema)

- Schema definitions reference or embed JSON Schemas
- Ensures API contracts match data model
- Single source of truth for data structures

### To UX Layer

- StateAction.api.operationId references Operation.operationId
- Enables UI to call correct API operations
- Type-safe form-to-API binding

### To Security Layer

- **SecurityScheme definitions**: Map to SecurityModel authentication configuration
- **Operation security requirements**: Enforce access control via OpenAPI security field
- **x-security-resource**: Links operation to SecureResource for detailed authorization rules
- **x-required-permissions**: Explicitly declares Permission.name[] required for operation
- **Enhanced security traceability**: From operation → required permissions → roles → actors

**Security Integration Flow**:

```yaml
Operation (createProduct)
  → x-required-permissions: ["product.create"]
    → SecureResource (product-api)
      → ResourceOperation (createProduct)
        → allowRoles: ["editor", "admin"]
          → Role definitions
            → Security Actors
```

### To APM/Observability Layer

- **Distributed tracing**: x-apm-trace enables operation-level tracing
- **SLA targets**: x-apm-sla-target-latency and x-apm-sla-target-availability define operation-specific performance requirements
- **Business metrics**: x-apm-business-metrics links operations to the business metrics they affect
- **Criticality classification**: x-apm-criticality defines operation importance for monitoring prioritization
- **Operation-level monitoring**: Different SLAs for different operations (search vs. write, read vs. delete)
- **Goal validation**: Links API performance to business goal achievement measurement

**APM Integration Example**:

```yaml
# High-criticality search operation
GET /products:
  x-apm-sla-target-latency: "100ms" # Fast search required
  x-apm-sla-target-availability: "99.99%" # Critical for customer experience
  x-apm-business-metrics: ["metric-catalog-findability"]
  x-apm-criticality: critical

# Lower-criticality write operation
POST /products:
  x-apm-sla-target-latency: "500ms" # Writes can be slower
  x-apm-sla-target-availability: "99.9%"
  x-apm-business-metrics: ["metric-catalog-growth"]
  x-apm-criticality: high
```

## Validation

### OpenAPI Validation

```yaml
Tools:
  - Swagger Editor: Online editor with live validation
  - Spectral: CLI linter with customizable rules
  - OpenAPI CLI: Command-line validator
  - Postman: Import and validate
  - Redocly CLI: Enterprise-grade validator

Validation Checks:
  - Spec compliance with OpenAPI 3.0.3
  - Unique operationIds
  - Valid JSON Schema definitions
  - Resolvable $ref references
  - Security scheme definitions
  - Response status codes
  - Content type consistency
```

### Cross-Layer Reference Validation

```yaml
Business Layer References:
  - x-business-service-ref must reference valid BusinessService.id
  - x-business-interface-ref must reference valid BusinessInterface.id
  - Warn if operation lacks business service reference (potential orphaned API)

Motivation Layer References:
  - x-supports-goals must reference valid Goal.id(s)
  - x-fulfills-requirements must reference valid Requirement.id(s)
  - x-governed-by-principles must reference valid Principle.id(s)
  - x-constrained-by must reference valid Constraint.id(s)
  - Warn if critical operation lacks goal alignment

Security Layer References:
  - x-security-resource must reference valid SecureResource.resource
  - x-required-permissions must reference valid Permission.name(s)
  - x-required-permissions should align with operation's security requirements
  - Warn if authenticated operation lacks required permissions

APM Layer References:
  - x-apm-business-metrics must reference valid Metric.id(s)
  - x-apm-sla-target-latency must be valid duration (e.g., "100ms", "2s")
  - x-apm-sla-target-availability must be valid percentage (e.g., "99.9%", "99.95%")
  - x-apm-criticality must be one of: low, medium, high, critical
  - Warn if high-criticality operation lacks SLA targets

Consistency Checks:
  - Operations with security requirements should have x-required-permissions
  - Operations with x-apm-criticality=critical should have strict SLA targets
  - Delete operations should have x-constrained-by for audit/retention policies
  - Public operations (no auth) should not have high criticality
  - x-business-service-ref should be consistent across related operations
```

## Best Practices

### Core OpenAPI Practices

1. **Semantic Versioning**: Use semantic versioning for API versions
2. **Unique Operation IDs**: Every operation must have unique operationId
3. **Comprehensive Examples**: Provide examples for request/response
4. **Error Responses**: Define standard error response format
5. **Pagination**: Include pagination for list endpoints
6. **Filtering**: Support filtering and searching on collections
7. **Rate Limiting**: Document rate limits using x-rate-limit
8. **Security**: Define security schemes and requirements
9. **Deprecation**: Mark deprecated operations with deprecated: true
10. **Documentation**: Use descriptions liberally for clarity
11. **Schema Reuse**: Use $ref for schema reuse
12. **Validation**: Use JSON Schema validation keywords
13. **Headers**: Document important request/response headers
14. **HATEOAS**: Include links for related resources
15. **Versioning**: Include version in URL path (/v1, /v2)

### Cross-Layer Integration Practices

#### Business Layer Integration

16. **Always Link to Business Services**: Every operation should have x-business-service-ref to show business value
17. **Document Business Interface**: Use x-business-interface-ref to show which business channel exposes the operation
18. **Consistent Service Mapping**: Related operations (CRUD on same resource) should reference the same business service
19. **Business Impact Analysis**: Use business references to assess impact of API changes

#### Motivation Layer Integration

20. **Goal Alignment Required**: Critical operations must have x-supports-goals to justify their existence
21. **Link to Requirements**: Use x-fulfills-requirements to show which requirements the operation satisfies
22. **Declare Governing Principles**: Use x-governed-by-principles to document architectural decisions (API-first, REST conventions, etc.)
23. **Document Constraints**: Operations with regulatory requirements (GDPR, HIPAA) must use x-constrained-by
24. **Traceability Chain**: Ensure complete chain: Goal → Requirement → Operation → Metric

#### APM/Observability Integration

25. **Define SLA Targets**: All production operations should have x-apm-sla-target-latency and x-apm-sla-target-availability
26. **Different SLAs for Different Operations**: Read operations should be faster than write operations; search should be fastest
27. **Link to Business Metrics**: Use x-apm-business-metrics to show which business KPIs the operation affects
28. **Criticality Classification**: Use x-apm-criticality to prioritize monitoring (critical operations get tightest SLAs)
29. **Enable Tracing**: Set x-apm-trace: true for all operations in production

#### Security Layer Integration

30. **Explicit Permissions**: Use x-required-permissions to declare permissions beyond authentication
31. **Link to Security Resources**: Use x-security-resource to reference detailed authorization rules
32. **Security for All Authenticated Operations**: Any operation requiring authentication should declare x-required-permissions
33. **Audit Trail for Sensitive Operations**: Delete and update operations should reference audit constraints

### Integration Examples

#### High-Criticality Read Operation

```yaml
GET /products:
  x-business-service-ref: "business-service-product-catalog"
  x-supports-goals: ["goal-customer-satisfaction"]
  x-apm-sla-target-latency: "100ms"
  x-apm-sla-target-availability: "99.99%"
  x-apm-criticality: critical
  x-security-resource: "product-api"
  x-required-permissions: ["product.read"]
```

#### Regulated Delete Operation

```yaml
DELETE /customers/{id}:
  x-business-service-ref: "business-service-customer-management"
  x-supports-goals: ["goal-data-governance", "goal-gdpr-compliance"]
  x-fulfills-requirements: ["req-right-to-be-forgotten"]
  x-constrained-by: ["constraint-gdpr-article-17", "constraint-audit-trail-required"]
  x-apm-sla-target-latency: "500ms"
  x-apm-criticality: high
  x-required-permissions: ["customer.delete", "data.erase"]
```

#### Write Operation with Business Impact

```yaml
POST /orders:
  x-business-service-ref: "business-service-order-processing"
  x-business-interface-ref: "business-interface-customer-portal"
  x-supports-goals: ["goal-revenue-growth", "goal-customer-satisfaction"]
  x-apm-sla-target-latency: "500ms"
  x-apm-business-metrics: ["metric-order-creation-rate", "metric-revenue"]
  x-apm-criticality: critical
  x-required-permissions: ["order.create"]
```

## Rationale for Enhanced Cross-Layer Integration

### Why APIs Need Business Layer Connections

APIs are the **digital manifestation of business services**. Without explicit connections to business services:

- ❌ **Business impact unknown**: When an API changes or fails, business impact cannot be assessed
- ❌ **Orphaned APIs**: APIs exist without clear business justification, leading to technical debt
- ❌ **Portfolio management impossible**: Cannot analyze API portfolio from business capability perspective
- ❌ **Investment prioritization unclear**: Cannot prioritize API work based on business value

With business connections:

- ✅ **Business traceability**: Clear path from business capability → API operation → implementation
- ✅ **Impact analysis**: Understand which business services are affected by API changes
- ✅ **API governance**: Justify each API operation with business value
- ✅ **Portfolio optimization**: Identify redundant or underutilized APIs based on business usage

### Why APIs Need Goal Alignment

Operations within the same API may support different business goals. Without goal-level tracking:

- ❌ **Unclear business value**: Cannot justify API investment with business outcomes
- ❌ **No ROI tracking**: Cannot measure which operations drive business success
- ❌ **Misaligned priorities**: Developer priorities may not align with business goals

With goal alignment:

- ✅ **Value-driven development**: Focus API work on operations that support critical goals
- ✅ **ROI measurement**: Track which operations contribute to goal achievement
- ✅ **Executive visibility**: Show how API operations drive business objectives
- ✅ **Portfolio rationalization**: Deprecate operations that don't support active goals

### Why APIs Need Operation-Level SLAs

Different operations have different performance requirements. A single API-level SLA is insufficient:

- ❌ **One-size-fits-all monitoring**: Search operations and bulk imports treated the same
- ❌ **Alert fatigue**: Generic alerts don't prioritize customer-facing operations
- ❌ **Resource waste**: Over-provisioning all operations to meet strictest requirement

With operation-level SLAs:

- ✅ **Right-sized monitoring**: Critical search operations get <100ms SLA, bulk writes get 2s SLA
- ✅ **Prioritized alerts**: Customer-facing operations (criticality: critical) get immediate attention
- ✅ **Efficient resource allocation**: Optimize infrastructure based on actual operation requirements
- ✅ **Business-aligned SLAs**: SLAs reflect business impact, not arbitrary technical targets

**Industry Evidence**: API management platforms (Apigee, Kong, AWS API Gateway) all support operation-level SLAs because:

- Search operations require <100ms for good UX
- Write operations can tolerate 500ms-1s
- Batch operations may have 10s+ SLAs
- Delete operations with audit requirements may be slower than create

### Why APIs Need Enhanced Security Mapping

OpenAPI security schemes provide authentication, but authorization requires more detail:

- ❌ **Incomplete security picture**: Security schemes show authentication, not authorization
- ❌ **Permission gaps**: Cannot validate if user has required permissions for operation
- ❌ **Manual security audits**: Security team must manually trace operations to permission requirements

With explicit permission references:

- ✅ **Complete security specification**: Authentication (schemes) + Authorization (permissions)
- ✅ **Automated validation**: Tools can verify user has required permissions before calling operation
- ✅ **Security audit trail**: Clear path from operation → permissions → roles → actors
- ✅ **Code generation**: Generate authorization middleware from permission declarations

### Why APIs Need Constraint References

Some operations have specific regulatory or compliance requirements:

- ❌ **Hidden compliance requirements**: GDPR right-to-be-forgotten scattered across documentation
- ❌ **Audit challenges**: Cannot prove which operations implement regulatory requirements
- ❌ **Implementation gaps**: Developers unaware of compliance constraints

With constraint references:

- ✅ **Explicit compliance**: Operations declare which regulations they must satisfy
- ✅ **Audit readiness**: Automated reports showing GDPR/HIPAA/SOX compliance per operation
- ✅ **Developer awareness**: Constraints visible in API specification, not buried in legal documents
- ✅ **Testing requirements**: Constraint references drive compliance test generation

**Example**: DELETE /customers/{id} must reference:

- `constraint-gdpr-article-17` (right to be forgotten)
- `constraint-audit-trail-required` (deletion must be logged)
- `constraint-data-retention-policy` (soft delete vs. hard delete rules)

### Why This Follows Industry Norms

These extensions align with practices from leading API management platforms:

| Extension              | Industry Equivalent         | Platform Examples                                      |
| ---------------------- | --------------------------- | ------------------------------------------------------ |
| x-business-service-ref | Business capability mapping | Apigee (API Products), MuleSoft (API-led connectivity) |
| x-supports-goals       | Business objective tracking | AWS Service Catalog, Azure API Management policies     |
| x-apm-sla-target-\*    | Operation-level SLAs        | Kong (per-route SLAs), AWS API Gateway (usage plans)   |
| x-required-permissions | Fine-grained authorization  | Auth0 (permissions), Okta (scopes)                     |
| x-constrained-by       | Compliance tagging          | ServiceNow GRC, Apigee API compliance policies         |

### Benefits Summary

**For Product Managers**:

- Understand business value of each API operation
- Prioritize API work based on goal alignment
- Measure API contribution to business outcomes

**For Architects**:

- Complete traceability from goals → APIs → metrics
- Justify architectural decisions with business context
- API portfolio management based on business capabilities

**For Developers**:

- Clear security requirements for each operation
- Understanding of business impact guides implementation priorities
- Compliance requirements visible in API specs

**For Operations Teams**:

- Right-sized SLAs for each operation
- Business context for alert prioritization
- Clear understanding of which operations are business-critical

**For Compliance Officers**:

- Automated compliance reporting per operation
- Clear audit trail for regulatory requirements
- Provable compliance with GDPR/HIPAA/SOX

## Code Generation

OpenAPI specs enable generation of:

```yaml
Server Code:
  - API server stubs (Node.js, Java, Python, Go)
  - Request validation middleware
  - Route handlers
  - Database models

Client Code:
  - SDKs (JavaScript, TypeScript, Python, Java, etc.)
  - Type definitions
  - API client libraries

Documentation:
  - Interactive API documentation (Swagger UI)
  - Static documentation (ReDoc)
  - Postman collections
  - API reference guides

Testing:
  - Contract tests
  - Mock servers
  - Integration tests
  - Load tests
```

## Tooling Ecosystem

```yaml
Design:
  - Stoplight Studio: Visual API designer
  - SwaggerHub: Collaborative API design
  - Postman: API design and testing

Validation:
  - Spectral: Linting and validation
  - Swagger Editor: Online validator
  - Redocly CLI: Enterprise validation

Documentation:
  - Swagger UI: Interactive documentation
  - ReDoc: Beautiful API docs
  - RapiDoc: Modern API docs

Testing:
  - Postman: Manual and automated testing
  - Dredd: API testing framework
  - Prism: Mock server

Code Generation:
  - OpenAPI Generator: Multi-language code gen
  - Swagger Codegen: Code generation
  - oapi-codegen: Go code generation
```

This API Layer leverages the mature OpenAPI ecosystem, minimizing custom invention while maximizing interoperability and tooling support.
