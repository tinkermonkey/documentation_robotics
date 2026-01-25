# Layer 6: API Layer

Defines REST API contracts using OpenAPI 3.0, specifying endpoints, operations, request/response schemas, and security requirements.

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

## Entity Definitions

### Core OpenAPI Structure

### OpenAPIDocument

```yaml
OpenAPIDocument:
  description: "Root of an OpenAPI specification file"
  attributes:
    id: string (UUID) [PK]
    name: string
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
    id: string (UUID) [PK]
    name: string
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
    id: string (UUID) [PK]
    name: string
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
  attributes:
    id: string (UUID) [PK]
    name: string

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
    id: string (UUID) [PK]
    name: string
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
    id: string (UUID) [PK]
    name: string
    operationId: string [required, unique] # Used for cross-references
    summary: string (optional, short description)
    description: string (optional, detailed description)
    tags: string[] (optional, for grouping)
    deprecated: boolean (optional) # default: false

  contains:
    - parameters: Parameter[] (0..*)
    - requestBody: RequestBody[] (0..*)
    - responses: Responses[] (0..*)
    - callbacks: Callback[] (0..*)
    - security: SecurityRequirement[] (0..*)

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
    x-apm-trace: boolean (optional) # default: true
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
    id: string (UUID) [PK]
    name: string [required]
    in: ParameterLocation [required]
    description: string (optional)
    required: boolean (required for path params, optional otherwise)
    deprecated: boolean (optional) # default: false
    allowEmptyValue: boolean (optional) # default: false

  schema:
    schema: Schema [required] # Data type

  style: ParameterStyle (optional, default depends on 'in')
  explode: boolean (optional)

  enums:
    ParameterLocation:
      - query # Query string parameter
      - header # HTTP header
      - path # Path parameter (always required)
      - cookie # Cookie parameter

    ParameterStyle:
      - matrix
      - label
      - form # Default for query
      - simple # Default for path/header
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
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    required: boolean (optional) # default: false

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
  attributes:
    id: string (UUID) [PK]
    name: string

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
    id: string (UUID) [PK]
    name: string
    description: string [required]

  headers: Header[] (optional, keyed by name)
  content: MediaType[] (optional, keyed by content type)
  links: Link[] (optional, keyed by name)

  examples:
    - # Success response
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

    - # Error response
      "400":
        description: "Invalid request"
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Error"

    - # Default response
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
    id: string (UUID) [PK]
    name: string
    contentType: string (key, e.g., "application/json")
    example: any (optional)

  contains:
    - schema: Schema[] (0..1)
    - examples: Example[] (0..*) # keyed by name
    - encoding: Encoding[] (0..*) # for multipart/form-data
```

### Components

```yaml
Components:
  description: "Reusable component definitions"
  attributes:
    id: string (UUID) [PK]
    name: string

  contains:
    - schemas: Schema[] (0..*)
    - responses: Response[] (0..*)
    - parameters: Parameter[] (0..*)
    - examples: Example[] (0..*)
    - requestBodies: RequestBody[] (0..*)
    - headers: Header[] (0..*)
    - securitySchemes: SecurityScheme[] (0..*)
    - links: Link[] (0..*)
    - callbacks: Callback[] (0..*)
```

### Schema

```yaml
Schema:
  description: "Data type definition (JSON Schema subset)"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: JSONType (string, number, integer, boolean, array, object)
    title: string (optional)
    description: string (optional)
    format: string (optional, e.g., "date-time", "email", "uuid")
    default: any (optional)
    enum: any[] (optional)
    nullable: boolean (optional) # default: false, OpenAPI 3.0 extension

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

### Tag

```yaml
Tag:
  description: "A metadata label used to group and categorize API operations for documentation organization. Enables logical grouping of endpoints in generated API documentation."
  attributes:
    id: string (UUID) [PK]
    name: string [required]
    description: string (optional)

  references:
    externalDocs: ExternalDocumentation (optional)

  examples:
    - name: "products"
      description: "Product management operations"
      externalDocs:
        description: "Product API documentation"
        url: "https://docs.example.com/products"

    - name: "orders"
      description: "Order processing operations"

    - name: "admin"
      description: "Administrative operations (restricted access)"
```

### ExternalDocumentation

```yaml
ExternalDocumentation:
  description: "A reference to external documentation resources (URLs, wikis, guides) that provide additional context beyond the inline API specification. Links API elements to comprehensive documentation."
  attributes:
    id: string (UUID) [PK]
    description: string (optional)
    url: string [required] (URL to external documentation)

  examples:
    - description: "Full API documentation"
      url: "https://docs.example.com/api"

    - description: "Authentication guide"
      url: "https://docs.example.com/auth"

    - description: "Rate limiting policies"
      url: "https://docs.example.com/rate-limits"
```

### Contact

```yaml
Contact:
  description: "Contact information for the API owner or maintainer, including name, email, and URL. Enables consumers to reach out for support or collaboration."
  attributes:
    id: string (UUID) [PK]
    name: string (optional)
    url: string (optional, URL to contact page)
    email: string (optional, email address)

  examples:
    - name: "API Support Team"
      email: "api-support@example.com"
      url: "https://support.example.com/api"

    - name: "Product Team"
      email: "product-team@example.com"

    - name: "Developer Relations"
      url: "https://developers.example.com/contact"
```

### License

```yaml
License:
  description: "Specifies the legal license under which the API is provided, including license name and URL to full terms. Clarifies usage rights for API consumers."
  attributes:
    id: string (UUID) [PK]
    name: string [required]
    url: string (optional, URL to license text)

  examples:
    - name: "Apache 2.0"
      url: "https://www.apache.org/licenses/LICENSE-2.0.html"

    - name: "MIT"
      url: "https://opensource.org/licenses/MIT"

    - name: "Proprietary"
      url: "https://example.com/api-license"
```

### ServerVariable

```yaml
ServerVariable:
  description: "A variable placeholder in server URL templates that can be substituted at runtime. Enables dynamic server addressing for different environments or tenants."
  attributes:
    id: string (UUID) [PK]
    name: string (variable name, used in URL template)
    default: string [required] (default value if not provided)
    enum: string[] (optional, allowed values)
    description: string (optional)

  examples:
    # Environment variable
    - name: "environment"
      default: "prod"
      enum: ["dev", "staging", "prod"]
      description: "Deployment environment"

    # Version variable
    - name: "version"
      default: "v2"
      enum: ["v1", "v2", "v3"]
      description: "API version"

    # Tenant variable
    - name: "tenant"
      default: "default"
      description: "Tenant identifier for multi-tenant deployments"

    # Region variable
    - name: "region"
      default: "us-east-1"
      enum: ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"]
      description: "Geographic region for data residency"
```

### Header

```yaml
Header:
  description: "Defines HTTP header parameters for requests or responses, specifying name, schema, required status, and description. Documents header-based communication requirements."
  attributes:
    id: string (UUID) [PK]
    name: string (header name, e.g., "X-Request-ID")
    description: string (optional)
    required: boolean (optional) # default: false
    deprecated: boolean (optional) # default: false
    allowEmptyValue: boolean (optional) # default: false

  schema:
    schema: Schema [required]

  style: string (optional) # default: "simple"
  explode: boolean (optional) # default: false

  examples:
    # Request ID header
    - name: "X-Request-ID"
      description: "Unique identifier for request tracing"
      required: false
      schema:
        type: string
        format: uuid

    # Rate limit headers
    - name: "X-Rate-Limit-Remaining"
      description: "Number of requests remaining in current window"
      schema:
        type: integer

    - name: "X-Rate-Limit-Reset"
      description: "Unix timestamp when rate limit resets"
      schema:
        type: integer

    # Pagination headers
    - name: "X-Total-Count"
      description: "Total number of items available"
      schema:
        type: integer

    # Cache control
    - name: "ETag"
      description: "Entity tag for cache validation"
      schema:
        type: string
```

### Link

```yaml
Link:
  description: "Describes a relationship between API responses and subsequent operations, enabling hypermedia-driven API navigation. Supports HATEOAS design patterns."
  attributes:
    id: string (UUID) [PK]
    name: string (link name)
    operationId: string (optional, target operation ID)
    operationRef: string (optional, relative or absolute URI to operation)
    description: string (optional)

  parameters:
    # Map of parameter names to values or runtime expressions
    parameterName: string | RuntimeExpression

  requestBody: any (optional, value or runtime expression)
  server: Server (optional, override server for this link)

  examples:
    # Link from product list to product detail
    - name: "GetProductById"
      operationId: "getProduct"
      description: "Get details for a specific product"
      parameters:
        id: "$response.body#/items/0/id"

    # Link from order to customer
    - name: "GetOrderCustomer"
      operationId: "getCustomer"
      description: "Get customer who placed this order"
      parameters:
        customerId: "$response.body#/customerId"

    # Self link
    - name: "self"
      operationId: "getProduct"
      parameters:
        id: "$response.body#/id"

    # Link with request body
    - name: "UpdateProduct"
      operationId: "updateProduct"
      parameters:
        id: "$response.body#/id"
      requestBody: "$response.body"
```

### Callback

```yaml
Callback:
  description: "Defines a webhook or callback URL pattern where the API will send asynchronous notifications. Enables event-driven integrations and async workflows."
  attributes:
    id: string (UUID) [PK]
    name: string (callback name)

  structure:
    # Map of runtime expression to PathItem
    expression: string (runtime expression for callback URL)
    pathItem: PathItem (operations available on callback URL)

  examples:
    # Order status webhook
    - name: "orderStatusCallback"
      "{$request.body#/callbackUrl}":
        post:
          summary: "Order status update callback"
          description: "Notification sent when order status changes"
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    orderId:
                      type: string
                      format: uuid
                    status:
                      type: string
                      enum: [pending, processing, shipped, delivered]
                    timestamp:
                      type: string
                      format: date-time
          responses:
            "200":
              description: "Callback processed successfully"
            "410":
              description: "Callback URL no longer valid"

    # Payment confirmation webhook
    - name: "paymentConfirmation"
      "{$request.body#/webhookUrl}":
        post:
          summary: "Payment confirmation callback"
          requestBody:
            content:
              application/json:
                schema:
                  $ref: "#/components/schemas/PaymentEvent"
          responses:
            "200":
              description: "Acknowledged"
```

### Example

```yaml
Example:
  description: "Provides sample values for request bodies, responses, or parameters. Improves documentation clarity and enables automated testing or mocking."
  attributes:
    id: string (UUID) [PK]
    name: string (example name)
    summary: string (optional, short description)
    description: string (optional, detailed description)
    value: any (optional, inline example value)
    externalValue: string (optional, URL to external example)

  # Note: value and externalValue are mutually exclusive

  examples:
    # Inline example
    - name: "simpleProduct"
      summary: "Minimal product example"
      description: "A product with only required fields"
      value:
        name: "Widget"
        sku: "WG1234"
        price: 9.99
        category: "electronics"

    # Detailed example
    - name: "fullProduct"
      summary: "Complete product example"
      description: "A product with all optional fields populated"
      value:
        id: "550e8400-e29b-41d4-a716-446655440000"
        name: "Premium Widget Pro"
        sku: "WG5678"
        description: "High-quality widget with advanced features"
        price: 99.99
        category: "electronics"
        stockQuantity: 150
        reorderPoint: 25
        createdAt: "2024-01-15T10:30:00Z"
        updatedAt: "2024-06-20T14:45:00Z"

    # External example
    - name: "bulkProducts"
      summary: "Bulk product import example"
      description: "Example payload for bulk product import"
      externalValue: "https://examples.example.com/bulk-products.json"
```

### Encoding

```yaml
Encoding:
  description: "Specifies serialization details for multipart request body properties, including content-type, headers, and encoding style. Handles complex content negotiation."
  attributes:
    id: string (UUID) [PK]
    propertyName: string (property this encoding applies to)
    contentType: string (optional, content type for this property)
    style: string (optional, serialization style)
    explode: boolean (optional)
    allowReserved: boolean (optional) # default: false

  headers:
    - Header[] (optional, additional headers for this property)

  examples:
    # File upload encoding
    - propertyName: "profilePhoto"
      contentType: "image/png, image/jpeg"
      headers:
        X-Custom-Header:
          description: "Custom header for file metadata"
          schema:
            type: string

    # JSON part in multipart
    - propertyName: "metadata"
      contentType: "application/json"

    # Array encoding
    - propertyName: "tags"
      style: "form"
      explode: true

    # Binary data encoding
    - propertyName: "attachment"
      contentType: "application/octet-stream"
      headers:
        Content-Disposition:
          description: "Attachment filename"
          schema:
            type: string
```

### OAuthFlows

```yaml
OAuthFlows:
  description: "Configuration for OAuth 2.0 authentication flows (implicit, password, clientCredentials, authorizationCode), specifying authorization URLs, token URLs, and scopes. Defines OAuth security implementation."
  attributes:
    id: string (UUID) [PK]
    name: string

  flows:
    implicit: OAuthFlow (optional)
    password: OAuthFlow (optional)
    clientCredentials: OAuthFlow (optional)
    authorizationCode: OAuthFlow (optional)

OAuthFlow:
  description: "Individual OAuth 2.0 flow configuration"
  attributes:
    authorizationUrl: string (required for implicit, authorizationCode)
    tokenUrl: string (required for password, clientCredentials, authorizationCode)
    refreshUrl: string (optional)
    scopes: object [required] (map of scope name to description)

  examples:
    # Authorization Code flow (recommended for web apps)
    - authorizationCode:
        authorizationUrl: "https://auth.example.com/authorize"
        tokenUrl: "https://auth.example.com/token"
        refreshUrl: "https://auth.example.com/refresh"
        scopes:
          read:products: "Read product information"
          write:products: "Create and update products"
          delete:products: "Delete products"
          admin: "Full administrative access"

    # Client Credentials flow (for service-to-service)
    - clientCredentials:
        tokenUrl: "https://auth.example.com/token"
        scopes:
          service:read: "Read access for services"
          service:write: "Write access for services"

    # Implicit flow (legacy, for SPAs)
    - implicit:
        authorizationUrl: "https://auth.example.com/authorize"
        scopes:
          read:products: "Read product information"

    # Password flow (for trusted first-party clients)
    - password:
        tokenUrl: "https://auth.example.com/token"
        scopes:
          user: "Basic user access"
          admin: "Administrative access"
```

### SecurityScheme

```yaml
SecurityScheme:
  description: "Security mechanism for the API"
  attributes:
    id: string (UUID) [PK]
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
    - # Bearer token (JWT)
      bearerAuth:
        type: http
        scheme: bearer
        bearerFormat: JWT
        description: "JWT token authentication"

    - # API Key
      apiKeyAuth:
        type: apiKey
        in: header
        name: X-API-Key
        description: "API key authentication"

    - # OAuth2
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

```yml
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

## Example Model

The following XML example demonstrates intra-layer and cross-layer relationships using ArchiMate-style XML format.

```xml
<model>
  <!-- OpenAPI Document -->
  <element id="product-api" type="OpenAPIDocument">
    <n>Product API</n>
    <documentation>Product catalog API specification</documentation>
  </element>

  <!-- Info -->
  <element id="api-info" type="Info">
    <n>Product API Info</n>
  </element>

  <!-- Contact -->
  <element id="api-contact" type="Contact">
    <n>API Team</n>
  </element>

  <!-- License -->
  <element id="api-license" type="License">
    <n>MIT License</n>
  </element>

  <!-- Components -->
  <element id="api-components" type="Components">
    <n>Reusable Components</n>
  </element>

  <!-- Servers -->
  <element id="production-server" type="Server">
    <n>Production Server</n>
  </element>

  <element id="env-variable" type="ServerVariable">
    <n>Environment Variable</n>
  </element>

  <!-- Tags -->
  <element id="products-tag" type="Tag">
    <n>Products</n>
  </element>

  <element id="api-docs" type="ExternalDocumentation">
    <n>API Documentation</n>
  </element>

  <!-- Paths and Operations -->
  <element id="api-paths" type="Paths">
    <n>API Paths</n>
  </element>

  <element id="products-path" type="PathItem">
    <n>/products</n>
  </element>

  <element id="get-products" type="Operation">
    <n>Get Products</n>
    <documentation>List all products</documentation>

    <!-- Cross-layer properties -->
    <property key="motivation.supports-goals">goal-customer-satisfaction</property>
    <property key="motivation.governed-by-principles">principle-api-first</property>
    <property key="security.classification">internal</property>
  </element>

  <element id="query-param" type="Parameter">
    <n>category parameter</n>
  </element>

  <element id="products-responses" type="Responses">
    <n>Product Responses</n>
  </element>

  <element id="success-response" type="Response">
    <n>200 Success</n>
  </element>

  <element id="json-media-type" type="MediaType">
    <n>application/json</n>
  </element>

  <element id="product-schema" type="Schema">
    <n>Product Schema</n>
  </element>

  <element id="product-array-schema" type="Schema">
    <n>Product Array Schema</n>
  </element>

  <element id="product-example" type="Example">
    <n>Product Example</n>
  </element>

  <element id="content-encoding" type="Encoding">
    <n>Content Encoding</n>
  </element>

  <element id="content-header" type="Header">
    <n>Content-Type Header</n>
  </element>

  <element id="callback-definition" type="Callback">
    <n>Webhook Callback</n>
  </element>

  <element id="webhook-path" type="PathItem">
    <n>/webhooks/product-updated</n>
  </element>

  <element id="oauth2-scheme" type="SecurityScheme">
    <n>OAuth 2.0</n>
  </element>

  <element id="oauth-flows" type="OAuthFlows">
    <n>OAuth Flows</n>
  </element>

  <element id="auth-code-flow" type="OAuthFlow">
    <n>Authorization Code Flow</n>
  </element>

  <element id="security-requirement" type="SecurityRequirement">
    <n>OAuth Required</n>
  </element>

  <element id="product-link" type="Link">
    <n>Get Product Link</n>
  </element>

  <element id="post-products" type="Operation">
    <n>Create Product</n>
  </element>

  <element id="request-body" type="RequestBody">
    <n>Product Request Body</n>
  </element>

  <!-- Composition Relationships -->
  <relationship type="Composition" source="product-api" target="api-info"/>
  <relationship type="Composition" source="product-api" target="api-paths"/>
  <relationship type="Composition" source="product-api" target="api-components"/>
  <relationship type="Composition" source="api-paths" target="products-path"/>
  <relationship type="Composition" source="products-path" target="get-products"/>
  <relationship type="Composition" source="get-products" target="query-param"/>
  <relationship type="Composition" source="get-products" target="products-responses"/>
  <relationship type="Composition" source="post-products" target="request-body"/>
  <relationship type="Composition" source="products-responses" target="success-response"/>
  <relationship type="Composition" source="request-body" target="json-media-type"/>
  <relationship type="Composition" source="success-response" target="json-media-type"/>
  <relationship type="Composition" source="success-response" target="content-header"/>
  <relationship type="Composition" source="success-response" target="product-link"/>
  <relationship type="Composition" source="json-media-type" target="product-schema"/>
  <relationship type="Composition" source="json-media-type" target="product-example"/>
  <relationship type="Composition" source="json-media-type" target="content-encoding"/>
  <relationship type="Composition" source="api-components" target="product-schema"/>
  <relationship type="Composition" source="api-components" target="success-response"/>
  <relationship type="Composition" source="api-components" target="query-param"/>
  <relationship type="Composition" source="api-components" target="product-example"/>
  <relationship type="Composition" source="api-components" target="request-body"/>
  <relationship type="Composition" source="api-components" target="content-header"/>
  <relationship type="Composition" source="api-components" target="oauth2-scheme"/>
  <relationship type="Composition" source="api-components" target="product-link"/>
  <relationship type="Composition" source="api-components" target="callback-definition"/>
  <relationship type="Composition" source="api-info" target="api-contact"/>
  <relationship type="Composition" source="api-info" target="api-license"/>
  <relationship type="Composition" source="oauth2-scheme" target="oauth-flows"/>
  <relationship type="Composition" source="oauth-flows" target="auth-code-flow"/>

  <!-- Aggregation Relationships -->
  <relationship type="Aggregation" source="product-api" target="production-server"/>
  <relationship type="Aggregation" source="product-api" target="products-tag"/>
  <relationship type="Aggregation" source="product-api" target="security-requirement"/>
  <relationship type="Aggregation" source="production-server" target="env-variable"/>
  <relationship type="Aggregation" source="products-path" target="query-param"/>
  <relationship type="Aggregation" source="get-products" target="callback-definition"/>
  <relationship type="Aggregation" source="get-products" target="security-requirement"/>

  <!-- Specialization Relationships -->
  <relationship type="Specialization" source="product-array-schema" target="product-schema"/>

  <!-- Reference Relationships -->
  <relationship type="Reference" source="product-array-schema" target="product-schema"/>
  <relationship type="Reference" source="query-param" target="product-schema"/>
  <relationship type="Reference" source="content-header" target="product-schema"/>
  <relationship type="Reference" source="product-link" target="post-products"/>
  <relationship type="Reference" source="callback-definition" target="webhook-path"/>
  <relationship type="Reference" source="get-products" target="products-tag"/>
  <relationship type="Reference" source="products-tag" target="api-docs"/>
  <relationship type="Reference" source="product-api" target="api-docs"/>
  <relationship type="Reference" source="content-encoding" target="content-header"/>
  <relationship type="Reference" source="env-variable" target="production-server"/>
  <relationship type="Reference" source="auth-code-flow" target="oauth-flows"/>

  <!-- Triggering Relationships -->
  <relationship type="Triggering" source="post-products" target="callback-definition"/>

  <!-- Serving Relationships -->
  <relationship type="Serving" source="oauth2-scheme" target="get-products"/>

  <!-- Association Relationships -->
  <relationship type="Association" source="api-contact" target="product-api"/>
  <relationship type="Association" source="api-license" target="product-api"/>
</model>
```

## Integration Points

**For complete link patterns and validation rules**, see:
- **[Cross-Layer Relationships Guide](../guides/CROSS_LAYER_RELATIONSHIPS.md)** - Clarifies which pattern to use and naming conventions
- **[Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md)** - Complete catalog of all 60+ patterns

The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer

- **API Operation** supports **Goal** (x-supports-goals property)
- **API Operation** fulfills **Requirement** (x-fulfills-requirements property)
- **API** governed by **Principle** (x-governed-by-principles property)
- **API Operation** constrained by **Constraint** (x-constrained-by property)

**Example Traceability Chain**:

```text
Goal (goal-customer-satisfaction)
   BusinessService (business-service-product-catalog)
     API Operation (GET /products)
       Metrics (metric-catalog-findability)
         Outcome validation
```

### To Business Layer

- **API Operation** realizes **BusinessService** (x-business-service-ref property)
- **API Operation** exposed via **BusinessInterface** (x-business-interface-ref property)

**Bidirectional Navigation**:

- BusinessInterface.interface.api-operations (downward documentation reference)
- Operation.x-business-service-ref (upward implementation reference)

### To ArchiMate Application Layer

- **OpenAPI Document** references **ApplicationService** (x-archimate-ref property)
- **API Operation** maps to **ApplicationFunction** (operationId property)

### To Data Model Layer (JSON Schema)

- **Schema** references **JSON Schema** (schema.$ref property)
- **RequestBody** embeds **JSON Schema** (content.schema property)

### To UX Layer

- **StateAction** references **API Operation** (api.operationId property)

### To Security Layer

- **SecurityScheme** maps to **SecurityModel** (securitySchemes property)
- **API Operation** enforces **Access Control** (security property)
- **API Operation** links to **SecureResource** (x-security-resource property)
- **API Operation** requires **Permission** (x-required-permissions property)

**Security Integration Flow**:

```text
Operation (createProduct)
   x-required-permissions: ["product.create"]
     SecureResource (product-api)
       ResourceOperation (createProduct)
         allowRoles: ["editor", "admin"]
           Role definitions
             Security Actors
```

### To APM/Observability Layer

- **API Operation** enables **Distributed Tracing** (x-apm-trace property)
- **API Operation** defines **SLA Latency Target** (x-apm-sla-target-latency property)
- **API Operation** defines **SLA Availability Target** (x-apm-sla-target-availability property)
- **API Operation** tracks **Business Metric** (x-apm-business-metrics property)
- **API Operation** has **Criticality** (x-apm-criticality property)
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

## Intra-Layer Relationships

**Purpose**: Define structural and behavioral relationships between entities within this layer.

### Structural Relationships

Relationships that define the composition, aggregation, and specialization of entities within this layer.

#### Composition Relationships

Whole-part relationships where the part cannot exist without the whole.

| Source Element  | Target Element | Predicate  | Inverse Predicate | Cardinality | Description                                                           |
| --------------- | -------------- | ---------- | ----------------- | ----------- | --------------------------------------------------------------------- |
| OpenAPIDocument | Info           | `composes` | `composed-of`     | 1:1         | API document contains exactly one info object with API metadata       |
| OpenAPIDocument | Paths          | `composes` | `composed-of`     | 1:1         | API document contains exactly one paths object defining endpoints     |
| OpenAPIDocument | Components     | `composes` | `composed-of`     | 1:0..1      | API document may contain a components object for reusable definitions |
| Paths           | PathItem       | `composes` | `composed-of`     | 1:N         | Paths object contains path items keyed by URL pattern                 |
| PathItem        | Operation      | `composes` | `composed-of`     | 1:N         | Path item contains operations for each HTTP method                    |
| Operation       | Parameter      | `composes` | `composed-of`     | 1:N         | Operation contains its parameters                                     |
| Operation       | RequestBody    | `composes` | `composed-of`     | 1:0..1      | Operation may contain a request body                                  |
| Operation       | Responses      | `composes` | `composed-of`     | 1:1         | Operation contains a responses object                                 |
| Responses       | Response       | `composes` | `composed-of`     | 1:N         | Responses object contains response definitions keyed by status code   |
| RequestBody     | MediaType      | `composes` | `composed-of`     | 1:N         | Request body contains media type definitions                          |
| Response        | MediaType      | `composes` | `composed-of`     | 1:N         | Response contains media type definitions for content                  |
| Response        | Header         | `composes` | `composed-of`     | 1:N         | Response contains header definitions                                  |
| Response        | Link           | `composes` | `composed-of`     | 1:N         | Response contains link definitions for HATEOAS navigation             |
| MediaType       | Schema         | `composes` | `composed-of`     | 1:0..1      | Media type contains schema definition                                 |
| MediaType       | Example        | `composes` | `composed-of`     | 1:N         | Media type contains example definitions                               |
| MediaType       | Encoding       | `composes` | `composed-of`     | 1:N         | Media type contains encoding definitions for multipart content        |
| Components      | Schema         | `composes` | `composed-of`     | 1:N         | Components object contains reusable schema definitions                |
| Components      | Response       | `composes` | `composed-of`     | 1:N         | Components object contains reusable response definitions              |
| Components      | Parameter      | `composes` | `composed-of`     | 1:N         | Components object contains reusable parameter definitions             |
| Components      | Example        | `composes` | `composed-of`     | 1:N         | Components object contains reusable example definitions               |
| Components      | RequestBody    | `composes` | `composed-of`     | 1:N         | Components object contains reusable request body definitions          |
| Components      | Header         | `composes` | `composed-of`     | 1:N         | Components object contains reusable header definitions                |
| Components      | SecurityScheme | `composes` | `composed-of`     | 1:N         | Components object contains security scheme definitions                |
| Components      | Link           | `composes` | `composed-of`     | 1:N         | Components object contains reusable link definitions                  |
| Components      | Callback       | `composes` | `composed-of`     | 1:N         | Components object contains reusable callback definitions              |
| Info            | Contact        | `composes` | `composed-of`     | 1:0..1      | Info object may contain contact information                           |
| Info            | License        | `composes` | `composed-of`     | 1:0..1      | Info object may contain license information                           |
| SecurityScheme  | OAuthFlows     | `composes` | `composed-of`     | 1:0..1      | OAuth2 security scheme contains OAuth flows configuration             |

#### Aggregation Relationships

Whole-part relationships where the part can exist independently.

| Source Element  | Target Element      | Predicate    | Inverse Predicate | Cardinality | Description                                              |
| --------------- | ------------------- | ------------ | ----------------- | ----------- | -------------------------------------------------------- |
| OpenAPIDocument | Server              | `aggregates` | `aggregated-by`   | 1:N         | API document aggregates server definitions               |
| OpenAPIDocument | Tag                 | `aggregates` | `aggregated-by`   | 1:N         | API document aggregates tag definitions for grouping     |
| OpenAPIDocument | SecurityRequirement | `aggregates` | `aggregated-by`   | 1:N         | API document aggregates global security requirements     |
| Server          | ServerVariable      | `aggregates` | `aggregated-by`   | 1:N         | Server aggregates its URL template variables             |
| PathItem        | Parameter           | `aggregates` | `aggregated-by`   | 1:N         | Path item aggregates shared parameters across operations |
| Operation       | Callback            | `aggregates` | `aggregated-by`   | 1:N         | Operation aggregates callback definitions                |
| Operation       | SecurityRequirement | `aggregates` | `aggregated-by`   | 1:N         | Operation aggregates its security requirements           |

#### Specialization Relationships

Type-subtype relationships (inheritance).

| Source Element | Target Element | Predicate     | Inverse Predicate | Cardinality | Description                                                 |
| -------------- | -------------- | ------------- | ----------------- | ----------- | ----------------------------------------------------------- |
| Schema         | Schema         | `specializes` | `generalized-by`  | N:1         | Schema specializes another schema through allOf/oneOf/anyOf |

### Behavioral Relationships

Relationships that define interactions, flows, and dependencies between entities within this layer.

#### Reference Relationships

Pointer references between entities without ownership semantics.

| Source Element  | Target Element        | Predicate    | Inverse Predicate | Cardinality | Description                                          |
| --------------- | --------------------- | ------------ | ----------------- | ----------- | ---------------------------------------------------- |
| Schema          | Schema                | `references` | `referenced-by`   | N:N         | Schema references another schema via $ref            |
| Parameter       | Schema                | `references` | `referenced-by`   | N:1         | Parameter references a schema for its data type      |
| Header          | Schema                | `references` | `referenced-by`   | N:1         | Header references a schema for its data type         |
| Link            | Operation             | `references` | `referenced-by`   | N:1         | Link references target operation via operationId     |
| Callback        | PathItem              | `references` | `referenced-by`   | N:1         | Callback references path item for webhook definition |
| Operation       | Tag                   | `references` | `referenced-by`   | N:N         | Operation references tags for categorization         |
| Tag             | ExternalDocumentation | `references` | `referenced-by`   | N:0..1      | Tag references external documentation                |
| OpenAPIDocument | ExternalDocumentation | `references` | `referenced-by`   | 1:0..1      | API document references external documentation       |
| Encoding        | Header                | `references` | `referenced-by`   | N:N         | Encoding references headers for multipart content    |

#### Triggering Relationships

Event-driven relationships where one entity initiates another.

| Source Element | Target Element | Predicate  | Inverse Predicate | Cardinality | Description                                    |
| -------------- | -------------- | ---------- | ----------------- | ----------- | ---------------------------------------------- |
| Operation      | Callback       | `triggers` | `triggered-by`    | 1:N         | Operation triggers callback webhooks on events |

#### Serving Relationships

Service availability relationships.

| Source Element | Target Element | Predicate | Inverse Predicate | Cardinality | Description                                      |
| -------------- | -------------- | --------- | ----------------- | ----------- | ------------------------------------------------ |
| SecurityScheme | Operation      | `serves`  | `served-by`       | N:N         | Security scheme serves operations requiring auth |

#### Association Relationships

Generic relationships indicating elements are related.

| Source Element | Target Element  | Predicate         | Inverse Predicate | Cardinality | Description                                             |
| -------------- | --------------- | ----------------- | ----------------- | ----------- | ------------------------------------------------------- |
| Contact        | OpenAPIDocument | `associated-with` | `associated-with` | N:1         | Contact is associated with API document for support     |
| License        | OpenAPIDocument | `associated-with` | `associated-with` | N:1         | License is associated with API document for legal terms |

---

## Cross-Layer Relationships

**Purpose**: Define semantic links to entities in other layers, supporting traceability, governance, and architectural alignment.

### Outgoing Relationships (This Layer → Other Layers)

Links from entities in this layer to entities in other layers.

#### To Motivation Layer (01)

Links to strategic goals, requirements, principles, and constraints.

| Predicate                | Source Element  | Target Element | Field Path                 | Strength | Required | Examples                                                  |
| ------------------------ | --------------- | -------------- | -------------------------- | -------- | -------- | --------------------------------------------------------- |
| `supports-goals`         | Operation       | Goal           | `x-supports-goals`         | High     | No       | `GET /products` supports `goal-customer-satisfaction`     |
| `supports-goals`         | OpenAPIDocument | Goal           | `x-supports-goals`         | High     | No       | Product API supports `goal-digital-channel-growth`        |
| `fulfills-requirements`  | Operation       | Requirement    | `x-fulfills-requirements`  | High     | No       | `POST /orders` fulfills `req-order-creation-capability`   |
| `governed-by-principles` | Operation       | Principle      | `x-governed-by-principles` | High     | No       | API operations governed by `principle-api-first`          |
| `governed-by-principles` | OpenAPIDocument | Principle      | `x-governed-by-principles` | High     | No       | API document governed by `principle-rest-conventions`     |
| `constrained-by`         | Operation       | Constraint     | `x-constrained-by`         | Medium   | No       | `DELETE /customers/{id}` constrained by `constraint-gdpr` |

#### To Business Layer (02)

Links to business services and interfaces.

| Predicate     | Source Element | Target Element    | Field Path                 | Strength | Required | Examples                                                    |
| ------------- | -------------- | ----------------- | -------------------------- | -------- | -------- | ----------------------------------------------------------- |
| `realizes`    | Operation      | BusinessService   | `x-business-service-ref`   | High     | No       | `GET /products` realizes `business-service-product-catalog` |
| `exposed-via` | Operation      | BusinessInterface | `x-business-interface-ref` | Medium   | No       | Operation exposed via `business-interface-customer-portal`  |

#### To Application Layer (04)

Links to application services and components.

| Predicate  | Source Element  | Target Element     | Field Path        | Strength | Required | Examples                                       |
| ---------- | --------------- | ------------------ | ----------------- | -------- | -------- | ---------------------------------------------- |
| `realizes` | OpenAPIDocument | ApplicationService | `x-archimate-ref` | High     | No       | Product API realizes `app-service-product-api` |

#### To Data Model Layer (07)

Links to JSON Schema definitions.

| Predicate    | Source Element | Target Element | Field Path    | Strength | Required | Examples                                             |
| ------------ | -------------- | -------------- | ------------- | -------- | -------- | ---------------------------------------------------- |
| `references` | Schema         | JSONSchema     | `schema.$ref` | High     | Yes      | API schema references `#/components/schemas/Product` |

#### To Security Layer (03)

Links to security resources and permissions.

| Predicate             | Source Element | Target Element | Field Path               | Strength | Required | Examples                                              |
| --------------------- | -------------- | -------------- | ------------------------ | -------- | -------- | ----------------------------------------------------- |
| `protected-by`        | Operation      | SecureResource | `x-security-resource`    | High     | No       | Operation protected by `product-api` resource         |
| `requires-permission` | Operation      | Permission     | `x-required-permissions` | High     | No       | `POST /products` requires `product.create` permission |

#### To APM Layer (11)

Links to observability and monitoring elements.

| Predicate        | Source Element | Target Element | Field Path                 | Strength | Required | Examples                                         |
| ---------------- | -------------- | -------------- | -------------------------- | -------- | -------- | ------------------------------------------------ |
| `measured-by`    | Operation      | Metric         | `x-apm-business-metrics`   | Medium   | No       | Operation measured by `metric-api-response-time` |
| `has-sla-target` | Operation      | SLATarget      | `x-apm-sla-target-latency` | Medium   | No       | Operation has SLA target of `200ms`              |

### Incoming Relationships (Other Layers → This Layer)

Links from entities in other layers to entities in this layer.

#### From UX Layer (09)

| Predicate | Source Element | Target Element | Field Path        | Strength | Required | Examples                                 |
| --------- | -------------- | -------------- | ----------------- | -------- | -------- | ---------------------------------------- |
| `invokes` | StateAction    | Operation      | `api.operationId` | High     | No       | UI action invokes `getProduct` operation |

#### From Testing Layer (12)

| Predicate | Source Element | Target Element | Field Path         | Strength | Required | Examples                                      |
| --------- | -------------- | -------------- | ------------------ | -------- | -------- | --------------------------------------------- |
| `tests`   | TestCase       | Operation      | `target.operation` | High     | No       | Test case validates `createProduct` operation |

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

1. **Always Link to Business Services**: Every operation should have x-business-service-ref to show business value
2. **Document Business Interface**: Use x-business-interface-ref to show which business channel exposes the operation
3. **Consistent Service Mapping**: Related operations (CRUD on same resource) should reference the same business service
4. **Business Impact Analysis**: Use business references to assess impact of API changes

#### Motivation Layer Integration

1. **Goal Alignment Required**: Critical operations must have x-supports-goals to justify their existence
2. **Link to Requirements**: Use x-fulfills-requirements to show which requirements the operation satisfies
3. **Declare Governing Principles**: Use x-governed-by-principles to document architectural decisions (API-first, REST conventions, etc.)
4. **Document Constraints**: Operations with regulatory requirements (GDPR, HIPAA) must use x-constrained-by
5. **Traceability Chain**: Ensure complete chain: Goal Requirement Operation Metric

#### APM/Observability Integration

1. **Define SLA Targets**: All production operations should have x-apm-sla-target-latency and x-apm-sla-target-availability
2. **Different SLAs for Different Operations**: Read operations should be faster than write operations; search should be fastest
3. **Link to Business Metrics**: Use x-apm-business-metrics to show which business KPIs the operation affects
4. **Criticality Classification**: Use x-apm-criticality to prioritize monitoring (critical operations get tightest SLAs)
5. **Enable Tracing**: Set x-apm-trace: true for all operations in production

#### Security Layer Integration

1. **Explicit Permissions**: Use x-required-permissions to declare permissions beyond authentication
2. **Link to Security Resources**: Use x-security-resource to reference detailed authorization rules
3. **Security for All Authenticated Operations**: Any operation requiring authentication should declare x-required-permissions
4. **Audit Trail for Sensitive Operations**: Delete and update operations should reference audit constraints

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

- ✅ **Business traceability**: Clear path from business capability API operation implementation
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
- ✅ **Security audit trail**: Clear path from operation permissions roles actors
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

- Complete traceability from goals APIs metrics
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
