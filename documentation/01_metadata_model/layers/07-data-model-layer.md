# Data Model Layer - JSON Schema

## Overview

The Data Model Layer defines the structure, types, and validation rules for data using JSON Schema (Draft 7). This leverages an established standard for data definition rather than inventing custom formats.

## Layer Characteristics

- **Standard**: JSON Schema Draft 7
- **Custom Extensions**: x-database, x-ui, x-security for cross-layer integration
- **Validation**: AJV, JSON Schema validators
- **Tooling**: JSON Schema validators, code generators, documentation generators

## Why JSON Schema?

JSON Schema is the standard for JSON data validation:
- **Industry Standard**: Widely adopted for JSON data validation
- **Language Agnostic**: Works across all programming languages
- **Comprehensive**: Supports complex validation rules
- **Composable**: Schemas can reference and extend other schemas
- **Tool Support**: Extensive ecosystem for validation and code generation
- **Self-Documenting**: Schema serves as documentation

## Core JSON Schema Structure

### JSONSchema
```yaml
JSONSchema:
  description: "Root schema document"
  attributes:
    $schema: string (schema version URI, e.g., "http://json-schema.org/draft-07/schema#")
    $id: string (unique schema identifier URI, optional)
    title: string (optional)
    description: string (optional)
    type: JSONType (optional, can be at root or in definitions)

  contains:
    definitions: SchemaDefinition[] (keyed by name, optional)
    properties: SchemaProperty[] (keyed by name, for object type)

  # Custom extensions for federated architecture
  extensions:
    x-archimate-ref: string (Element.id reference to DataObject)
    x-database: DatabaseMapping (optional)
```

### Type System

```yaml
JSONType:
  description: "Core JSON data types"
  values:
    - string
    - number      # Any numeric value
    - integer     # Whole numbers only
    - boolean
    - object
    - array
    - "null"

  # Can also be array of types for unions
  example: ["string", "null"]  # Nullable string
```

### String Validation

```yaml
StringSchema:
  type: string

  validation:
    minLength: integer (minimum string length)
    maxLength: integer (maximum string length)
    pattern: string (regular expression)
    format: StringFormat [enum]

  enums:
    StringFormat:
      # Date and Time
      - date-time    # RFC 3339 date-time
      - date         # RFC 3339 full-date
      - time         # RFC 3339 full-time

      # Email and Networks
      - email        # Email address
      - idn-email    # Internationalized email
      - hostname     # Internet hostname
      - idn-hostname # Internationalized hostname
      - ipv4         # IPv4 address
      - ipv6         # IPv6 address
      - uri          # Universal Resource Identifier
      - uri-reference
      - iri          # Internationalized URI
      - iri-reference

      # JSON and Regex
      - json-pointer
      - relative-json-pointer
      - regex        # Regular expression

      # Custom formats (not standard, but commonly used)
      - uuid         # UUID/GUID
      - phone        # Phone number
      - credit-card  # Credit card number

  examples:
    # Email
    email:
      type: string
      format: email
      maxLength: 254

    # UUID
    productId:
      type: string
      format: uuid
      description: "Unique product identifier"

    # Pattern
    sku:
      type: string
      pattern: "^[A-Z]{2}\\d{4}$"
      description: "SKU format: AA1234"

    # Enum
    status:
      type: string
      enum: ["draft", "active", "archived"]
      description: "Product status"
```

### Numeric Validation

```yaml
NumericSchema:
  type: number | integer

  validation:
    minimum: number (inclusive minimum)
    maximum: number (inclusive maximum)
    exclusiveMinimum: number (exclusive minimum)
    exclusiveMaximum: number (exclusive maximum)
    multipleOf: number (must be multiple of this value)

  examples:
    # Price
    price:
      type: number
      minimum: 0
      multipleOf: 0.01
      description: "Price in USD"

    # Percentage
    discountPercent:
      type: number
      minimum: 0
      maximum: 100
      description: "Discount percentage"

    # Quantity
    quantity:
      type: integer
      minimum: 0
      description: "Stock quantity"

    # Rating
    rating:
      type: integer
      minimum: 1
      maximum: 5
      description: "Product rating (1-5 stars)"
```

### Array Validation

```yaml
ArraySchema:
  type: array

  validation:
    items: Schema (schema for array items)
    minItems: integer (minimum array length)
    maxItems: integer (maximum array length)
    uniqueItems: boolean (all items must be unique)
    contains: Schema (at least one item must match)

  examples:
    # Simple array
    tags:
      type: array
      items:
        type: string
        minLength: 1
      minItems: 0
      maxItems: 10
      uniqueItems: true
      description: "Product tags"

    # Array of objects
    reviews:
      type: array
      items:
        $ref: "#/definitions/Review"
      description: "Product reviews"

    # Tuple (fixed-length array with typed positions)
    coordinates:
      type: array
      items:
        - type: number  # latitude
        - type: number  # longitude
      minItems: 2
      maxItems: 2
      description: "Geographic coordinates [lat, lon]"
```

### Object Validation

```yaml
ObjectSchema:
  type: object

  properties:
    propertyName: Schema (keyed by property name)

  validation:
    required: string[] (required property names)
    additionalProperties: boolean | Schema (allow/disallow extra properties)
    minProperties: integer (minimum number of properties)
    maxProperties: integer (maximum number of properties)
    propertyNames: Schema (validation for property names)
    dependencies: object (property dependencies)

  examples:
    # Basic object
    Product:
      type: object
      required: ["name", "sku", "price"]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 200
        sku:
          type: string
          pattern: "^[A-Z]{2}\\d{4}$"
        price:
          type: number
          minimum: 0
        description:
          type: string
          maxLength: 2000
      additionalProperties: false

    # With dependencies
    Address:
      type: object
      properties:
        street:
          type: string
        city:
          type: string
        state:
          type: string
        postalCode:
          type: string
        country:
          type: string
      dependencies:
        postalCode: ["country"]  # If postalCode exists, country is required
```

### Schema Composition

```yaml
SchemaComposition:
  description: "Combining multiple schemas"

  keywords:
    allOf: Schema[] # Must match ALL schemas
    anyOf: Schema[] # Must match AT LEAST ONE schema
    oneOf: Schema[] # Must match EXACTLY ONE schema
    not: Schema     # Must NOT match this schema

  examples:
    # allOf - combining schemas (like inheritance)
    DiscountedProduct:
      allOf:
        - $ref: "#/definitions/Product"
        - type: object
          properties:
            discountPercent:
              type: number
              minimum: 0
              maximum: 100
          required: ["discountPercent"]

    # oneOf - discriminated union
    PaymentMethod:
      oneOf:
        - $ref: "#/definitions/CreditCard"
        - $ref: "#/definitions/BankTransfer"
        - $ref: "#/definitions/PayPal"
      discriminator:
        propertyName: type

    # anyOf - nullable
    OptionalString:
      anyOf:
        - type: string
        - type: "null"

    # not - exclusion
    NonEmptyString:
      type: string
      not:
        const: ""
```

### References

```yaml
Reference:
  description: "Reference to another schema"
  syntax: "$ref"

  examples:
    # Local reference (same file)
    - $ref: "#/definitions/Product"

    # External reference (different file)
    - $ref: "common-schemas.json#/definitions/Address"

    # Remote reference (URL)
    - $ref: "https://example.com/schemas/product.json"

    # Relative path
    - $ref: "../schemas/user.json#/definitions/User"
```

## Custom Extensions

### x-database Extension

```yaml
x-database:
  description: "Database mapping information"
  attributes:
    table: string (database table name)
    schema: string (database schema, optional)
    engine: string (database engine, optional)

  columns:
    propertyName:
      column: string (database column name)
      type: SQLType (SQL data type)
      nullable: boolean
      primaryKey: boolean
      autoIncrement: boolean
      unique: boolean
      default: any
      index: boolean | string (index name)
      foreignKey:
        table: string
        column: string
        onDelete: ReferentialAction
        onUpdate: ReferentialAction

  indexes:
    - name: string
      columns: string[]
      unique: boolean
      type: IndexType

  constraints:
    - name: string
      type: ConstraintType
      columns: string[]
      check: string (SQL expression, for CHECK constraints)

  enums:
    SQLType:
      - VARCHAR
      - TEXT
      - INTEGER
      - BIGINT
      - SERIAL
      - BIGSERIAL
      - DECIMAL
      - NUMERIC
      - BOOLEAN
      - DATE
      - TIMESTAMP
      - TIMESTAMPTZ
      - JSON
      - JSONB
      - UUID
      - BYTEA

    ReferentialAction:
      - CASCADE
      - SET_NULL
      - RESTRICT
      - NO_ACTION
      - SET_DEFAULT

    IndexType:
      - BTREE
      - HASH
      - GIN
      - GIST

    ConstraintType:
      - PRIMARY_KEY
      - UNIQUE
      - FOREIGN_KEY
      - CHECK
```

### x-ui Extension

```yaml
x-ui:
  description: "UI rendering hints"
  attributes:
    component: UIComponent [enum]
    label: string
    placeholder: string
    helpText: string
    order: integer
    readOnly: boolean
    hidden: boolean
    group: string (section/group name)

  validation:
    customValidation: string (custom validation function name)

  dataSource:
    endpoint: string (API endpoint for options)
    method: HttpMethod
    valueField: string (field to use as value)
    labelField: string (field to use as label)

  enums:
    UIComponent:
      - text-input
      - textarea
      - number-input
      - email-input
      - password-input
      - date-picker
      - datetime-picker
      - select
      - multi-select
      - autocomplete
      - checkbox
      - radio-group
      - toggle
      - slider
      - file-upload
      - rich-text-editor
      - color-picker
```

### x-security Extension

```yaml
x-security:
  description: "Security and privacy metadata"
  attributes:
    pii: boolean (contains personally identifiable information)
    encrypted: boolean (should be encrypted at rest)
    classification: SecurityClassification [enum]
    retention: string (data retention period, e.g., "90days", "7years")
    masking: MaskingStrategy [enum]
    redaction: boolean (should be redacted in logs)

  accessControl:
    read: string[] (roles that can read)
    write: string[] (roles that can write)

  enums:
    SecurityClassification:
      - public
      - internal
      - confidential
      - restricted

    MaskingStrategy:
      - none
      - partial       # Show first/last characters
      - full          # Complete masking
      - hash          # One-way hash
```

## Complete Example: Product Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/schemas/product.json",
  "title": "Product",
  "description": "Product catalog item schema",
  "x-archimate-ref": "data-object-product",
  "x-database": {
    "table": "products",
    "schema": "public",
    "indexes": [
      {
        "name": "idx_products_sku",
        "columns": ["sku"],
        "unique": true
      },
      {
        "name": "idx_products_category",
        "columns": ["category"]
      }
    ]
  },

  "type": "object",
  "required": ["name", "sku", "price", "category"],
  "additionalProperties": false,

  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "description": "Unique product identifier",
      "readOnly": true,
      "x-database": {
        "column": "id",
        "type": "UUID",
        "primaryKey": true,
        "nullable": false
      },
      "x-ui": {
        "hidden": true
      }
    },

    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "Product name",
      "x-database": {
        "column": "name",
        "type": "VARCHAR",
        "nullable": false,
        "index": "idx_products_name"
      },
      "x-ui": {
        "component": "text-input",
        "label": "Product Name",
        "placeholder": "Enter product name",
        "order": 1,
        "group": "basic"
      }
    },

    "sku": {
      "type": "string",
      "pattern": "^[A-Z]{2}\\d{4}$",
      "description": "Stock Keeping Unit (format: AA1234)",
      "examples": ["EL1001", "CL2345"],
      "x-database": {
        "column": "sku",
        "type": "VARCHAR",
        "nullable": false,
        "unique": true
      },
      "x-ui": {
        "component": "text-input",
        "label": "SKU",
        "placeholder": "AA1234",
        "helpText": "Two letters followed by four digits",
        "order": 2,
        "group": "basic"
      }
    },

    "description": {
      "type": "string",
      "maxLength": 2000,
      "description": "Detailed product description",
      "x-database": {
        "column": "description",
        "type": "TEXT",
        "nullable": true
      },
      "x-ui": {
        "component": "rich-text-editor",
        "label": "Description",
        "helpText": "Detailed product description for customers",
        "order": 3,
        "group": "basic"
      }
    },

    "price": {
      "type": "number",
      "minimum": 0,
      "multipleOf": 0.01,
      "description": "Product price in USD",
      "x-database": {
        "column": "price",
        "type": "DECIMAL(10,2)",
        "nullable": false
      },
      "x-ui": {
        "component": "number-input",
        "label": "Price",
        "placeholder": "0.00",
        "order": 4,
        "group": "pricing"
      }
    },

    "category": {
      "type": "string",
      "enum": ["electronics", "clothing", "food", "books", "other"],
      "description": "Product category",
      "x-database": {
        "column": "category",
        "type": "VARCHAR",
        "nullable": false,
        "index": true
      },
      "x-ui": {
        "component": "select",
        "label": "Category",
        "order": 5,
        "group": "basic"
      }
    },

    "stockQuantity": {
      "type": "integer",
      "minimum": 0,
      "default": 0,
      "description": "Current stock quantity",
      "x-database": {
        "column": "stock_quantity",
        "type": "INTEGER",
        "nullable": false,
        "default": 0
      },
      "x-ui": {
        "component": "number-input",
        "label": "Stock Quantity",
        "order": 6,
        "group": "inventory"
      }
    },

    "reorderPoint": {
      "type": "integer",
      "minimum": 0,
      "default": 10,
      "description": "Reorder threshold",
      "x-database": {
        "column": "reorder_point",
        "type": "INTEGER",
        "nullable": false,
        "default": 10
      },
      "x-ui": {
        "component": "number-input",
        "label": "Reorder Point",
        "helpText": "Alert when stock falls below this level",
        "order": 7,
        "group": "inventory"
      }
    },

    "tags": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 0,
      "maxItems": 10,
      "uniqueItems": true,
      "description": "Product tags for search and categorization",
      "x-database": {
        "column": "tags",
        "type": "JSONB"
      },
      "x-ui": {
        "component": "tags-input",
        "label": "Tags",
        "order": 8,
        "group": "metadata"
      }
    },

    "images": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/ProductImage"
      },
      "maxItems": 5,
      "description": "Product images",
      "x-database": {
        "column": "images",
        "type": "JSONB"
      }
    },

    "metadata": {
      "type": "object",
      "description": "Additional product metadata",
      "additionalProperties": true,
      "x-database": {
        "column": "metadata",
        "type": "JSONB"
      }
    },

    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "Creation timestamp",
      "readOnly": true,
      "x-database": {
        "column": "created_at",
        "type": "TIMESTAMPTZ",
        "nullable": false,
        "default": "CURRENT_TIMESTAMP"
      },
      "x-ui": {
        "hidden": true
      }
    },

    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Last update timestamp",
      "readOnly": true,
      "x-database": {
        "column": "updated_at",
        "type": "TIMESTAMPTZ",
        "nullable": false,
        "default": "CURRENT_TIMESTAMP"
      },
      "x-ui": {
        "hidden": true
      }
    }
  },

  "definitions": {
    "ProductImage": {
      "type": "object",
      "required": ["url", "altText"],
      "properties": {
        "url": {
          "type": "string",
          "format": "uri",
          "description": "Image URL"
        },
        "altText": {
          "type": "string",
          "description": "Alternative text for accessibility"
        },
        "isPrimary": {
          "type": "boolean",
          "default": false,
          "description": "Is this the primary product image"
        }
      }
    }
  }
}
```

## Integration Points

### To ArchiMate Application Layer
- Schema references DataObject via x-archimate-ref
- Enables traceability from business objects to data structures

### To API Layer (OpenAPI)
- OpenAPI schemas reference or embed JSON Schemas via $ref
- Ensures API request/response match data model
- Single source of truth for data types

### To UX Layer
- FieldDefinition.dataBinding.schemaRef references schema properties
- x-ui extension provides rendering hints
- Ensures forms match data structure

### To Data Store Layer
- x-database extension maps to physical database
- Column definitions, indexes, constraints
- Enables database schema generation

### To Security Layer
- x-security extension defines access control
- PII and encryption metadata
- Data classification and retention

## Validation

### Schema Validation Tools
```yaml
Validators:
  - AJV: Fast JavaScript validator
  - jsonschema: Python validator
  - JSON Schema Validator: Java validator
  - go-jsonschema: Go validator

Features:
  - Type checking
  - Format validation
  - Constraint validation
  - Custom keywords support
  - Error reporting
  - Schema compilation
```

## Best Practices

1. **Use $id**: Give schemas unique identifiers
2. **Provide Descriptions**: Document all properties
3. **Set additionalProperties**: Be explicit about extra properties
4. **Use Formats**: Leverage standard formats (email, uuid, date-time)
5. **Define Examples**: Include example values
6. **Version Schemas**: Use $id with versions for breaking changes
7. **Reuse Definitions**: Use $ref for common patterns
8. **Validate Constraints**: Use min/max, pattern for validation
9. **Mark ReadOnly**: Use readOnly for computed/system fields
10. **Group Properties**: Use x-ui.group for logical grouping
11. **Security Metadata**: Always include x-security for sensitive data
12. **Database Mapping**: Use x-database for persistence layer

## Code Generation

JSON Schemas enable generation of:

```yaml
Type Definitions:
  - TypeScript interfaces
  - Java POJOs
  - Python dataclasses
  - Go structs
  - C# classes

Validation Code:
  - Runtime validators
  - Form validation
  - API request/response validation

Database Code:
  - DDL (CREATE TABLE statements)
  - ORM models
  - Migration scripts

Documentation:
  - Schema documentation
  - API documentation
  - Developer guides
```

## Common Patterns

### Nullable Fields
```json
{
  "description": {
    "anyOf": [
      {"type": "string"},
      {"type": "null"}
    ]
  }
}
```

### Discriminated Unions
```json
{
  "oneOf": [
    {"$ref": "#/definitions/CreditCard"},
    {"$ref": "#/definitions/BankTransfer"}
  ],
  "discriminator": {
    "propertyName": "paymentType"
  }
}
```

### Timestamps Pattern
```json
{
  "createdAt": {
    "type": "string",
    "format": "date-time",
    "readOnly": true
  },
  "updatedAt": {
    "type": "string",
    "format": "date-time",
    "readOnly": true
  }
}
```

### Soft Delete Pattern
```json
{
  "deletedAt": {
    "anyOf": [
      {"type": "string", "format": "date-time"},
      {"type": "null"}
    ],
    "readOnly": true
  }
}
```

This Data Model Layer provides a comprehensive, standards-based approach to defining data structures with rich validation and cross-layer integration.
