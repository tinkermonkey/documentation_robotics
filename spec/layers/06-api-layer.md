# Layer 6: API Layer

**Standard**: [OpenAPI 3.0](https://spec.openapis.org/oas/v3.0.0)

---

## Overview

This layer defines **29** node types that represent various aspects of the architecture.

## Node Types

### SecurityType

**ID**: `api.securitytype`

SecurityType element in API Layer


### License

**ID**: `api.license`

Specifies the legal license under which the API is provided, including license name and URL to full terms. Clarifies usage rights for API consumers.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `url`: string (required)

### ParameterStyle

**ID**: `api.parameterstyle`

ParameterStyle element in API Layer


### Info

**ID**: `api.info`

Metadata about the API

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `title`: string (required)
- `description`: string
- `version`: string (required)
- `termsOfService`: string (required)
- `contact`: string
- `license`: string

### OAuthFlow

**ID**: `api.oauthflow`

Individual OAuth 2.0 flow configuration

**Attributes**:

- `authorizationUrl`: string (required)
- `tokenUrl`: string (required)
- `refreshUrl`: string
- `scopes`: object (required)

### Contact

**ID**: `api.contact`

Contact information for the API owner or maintainer, including name, email, and URL. Enables consumers to reach out for support or collaboration.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `url`: string (required)
- `email`: string (required)

### RequestBody

**ID**: `api.requestbody`

Request payload for an operation

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `required`: boolean

### Parameter

**ID**: `api.parameter`

Parameter for an operation

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `in`: string (required)
- `description`: string
- `required`: boolean (required)
- `deprecated`: boolean
- `allowEmptyValue`: boolean

### Responses

**ID**: `api.responses`

Possible responses from an operation

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### OpenAPIDocument

**ID**: `api.openapidocument`

Root of an OpenAPI specification file

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `openapi`: string (required)
- `info`: string (required)
- `servers`: string (required)
- `paths`: string (required)
- `components`: string
- `security`: string (required)
- `tags`: string (required)
- `externalDocs`: string

### PathItem

**ID**: `api.pathitem`

Operations available on a path

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `summary`: string
- `description`: string
- `servers`: string (required)
- `parameters`: string (required)
- `x-source-reference`: string
  - Source code reference using OpenAPI x- extension pattern. This pattern is used for OpenAPI-style layers (API, Data Model, Datastore) to maintain compatibility with OpenAPI tooling, as opposed to the nested properties.source.reference pattern used in ArchiMate-style layers (Application, Technology).

### Link

**ID**: `api.link`

Describes a relationship between API responses and subsequent operations, enabling hypermedia-driven API navigation. Supports HATEOAS design patterns.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `operationId`: string (required)
- `operationRef`: string (required)
- `description`: string

### Callback

**ID**: `api.callback`

Defines a webhook or callback URL pattern where the API will send asynchronous notifications. Enables event-driven integrations and async workflows.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### OAuthFlows

**ID**: `api.oauthflows`

Configuration for OAuth 2.0 authentication flows (implicit, password, clientCredentials, authorizationCode), specifying authorization URLs, token URLs, and scopes. Defines OAuth security implementation.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### ExternalDocumentation

**ID**: `api.externaldocumentation`

A reference to external documentation resources (URLs, wikis, guides) that provide additional context beyond the inline API specification. Links API elements to comprehensive documentation.

**Attributes**:

- `id`: string (uuid) (required)
- `description`: string
- `url`: string (required)

### Operation

**ID**: `api.operation`

Single API operation (HTTP method on a path)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `operationId`: string (required)
- `summary`: string (required)
- `description`: string (required)
- `tags`: string (required)
- `deprecated`: boolean
- `parameters`: array
  - Contains relationship
- `requestBody`: array
  - Contains relationship
- `responses`: array
  - Contains relationship
- `callbacks`: array
  - Contains relationship
- `security`: array
  - Contains relationship
- `x-source-reference`: string
  - Source code reference using OpenAPI x- extension pattern. This pattern is used for OpenAPI-style layers (API, Data Model, Datastore) to maintain compatibility with OpenAPI tooling, as opposed to the nested properties.source.reference pattern used in ArchiMate-style layers (Application, Technology).

### SecurityScheme

**ID**: `api.securityscheme`

Security mechanism for the API

**Attributes**:

- `id`: string (uuid) (required)
- `type`: string (required)
- `description`: string
- `name`: string (required)
- `in`: string (required)
- `scheme`: string (required)
- `bearerFormat`: string (required)

### ServerVariable

**ID**: `api.servervariable`

A variable placeholder in server URL templates that can be substituted at runtime. Enables dynamic server addressing for different environments or tenants.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `default`: string (required)
- `enum`: string (required)
- `description`: string

### ParameterLocation

**ID**: `api.parameterlocation`

ParameterLocation element in API Layer


### Example

**ID**: `api.example`

Provides sample values for request bodies, responses, or parameters. Improves documentation clarity and enables automated testing or mocking.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `summary`: string (required)
- `description`: string (required)
- `value`: string (required)
- `externalValue`: string (required)

### Header

**ID**: `api.header`

Defines HTTP header parameters for requests or responses, specifying name, schema, required status, and description. Documents header-based communication requirements.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `required`: boolean
- `deprecated`: boolean
- `allowEmptyValue`: boolean

### Tag

**ID**: `api.tag`

A metadata label used to group and categorize API operations for documentation organization. Enables logical grouping of endpoints in generated API documentation.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string

### Response

**ID**: `api.response`

Single response definition

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string (required)

### Paths

**ID**: `api.paths`

Available API endpoints and operations

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### Server

**ID**: `api.server`

Server where the API is available

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `url`: string (required)
- `description`: string
- `variables`: string (required)

### MediaType

**ID**: `api.mediatype`

Media type and schema for request/response body

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `contentType`: string (required)
- `example`: string
- `schema`: array
  - Contains relationship
- `examples`: array
  - Contains relationship
- `encoding`: array
  - Contains relationship

### Components

**ID**: `api.components`

Reusable component definitions

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `schemas`: array
  - Contains relationship
- `responses`: array
  - Contains relationship
- `parameters`: array
  - Contains relationship
- `examples`: array
  - Contains relationship
- `requestBodies`: array
  - Contains relationship
- `headers`: array
  - Contains relationship
- `securitySchemes`: array
  - Contains relationship
- `links`: array
  - Contains relationship
- `callbacks`: array
  - Contains relationship

### Encoding

**ID**: `api.encoding`

Specifies serialization details for multipart request body properties, including content-type, headers, and encoding style. Handles complex content negotiation.

**Attributes**:

- `id`: string (uuid) (required)
- `propertyName`: string (required)
- `contentType`: string (required)
- `style`: string (required)
- `explode`: boolean
- `allowReserved`: boolean

### Schema

**ID**: `api.schema`

Data type definition (JSON Schema subset)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `title`: string
- `description`: string
- `format`: string (required)
- `default`: string
- `enum`: string
- `nullable`: boolean


## References

- [OpenAPI 3.0](https://spec.openapis.org/oas/v3.0.0)
