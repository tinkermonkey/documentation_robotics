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
    x-archimate-ref: string (Element.id reference)
    x-service-tier: enum [api-gateway, service, backend]
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

  pathPattern: string (e.g., "/products/{id}")
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
    x-apm-trace: boolean (default: true)
    x-cache-ttl: integer (seconds, optional)

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

# Custom extension
x-archimate-ref: app-service-product-api

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
      x-apm-trace: true

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
- SecurityScheme definitions map to SecurityModel
- Operation security requirements enforce access control
- x-security-policy extension references security policies

### To APM/Observability Layer
- x-apm-trace extension enables distributed tracing
- Operation-level metrics and monitoring
- Error response tracking

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

## Best Practices

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
