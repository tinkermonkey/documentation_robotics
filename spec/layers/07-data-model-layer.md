# Layer 7: Data Model Layer

Defines data structures, types, and validation rules using JSON Schema Draft 7 for consistent data modeling across the application.

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

## Entity Definitions

### Core JSON Schema Structure

### JSONSchema

```yaml
JSONSchema:
  description: "Root schema document"
  attributes:
    id: string (UUID) [PK]
    name: string
    $schema: string (schema version URI, e.g., "http://json-schema.org/draft-07/schema#")
    $id: string (unique schema identifier URI, optional)
    title: string (optional)
    description: string (optional)
    type: JSONType (optional, can be at root or in definitions)

  contains:
    - definitions: SchemaDefinition[] (0..*) # keyed by name
    - properties: SchemaProperty[] (0..*) # keyed by name, for object type

  # Custom extensions for federated architecture
  extensions:
    x-archimate-ref: string (Element.id reference to DataObject)
    x-business-object-ref: string (BusinessObject.id reference, optional)
    x-data-governance: DataGovernance (optional)
    x-apm-data-quality-metrics: DataQualityMetrics (optional)
    x-database: DatabaseMapping (optional)
```

### Type System

```yaml
JSONType:
  description: "Core JSON data types"
  attributes:
    value: string [enum]

  enums:
    string:
      - string
      - number # Any numeric value
      - integer # Whole numbers only
      - boolean
      - object
      - array
      - "null"

  # Can also be array of types for unions
  example: ["string", "null"] # Nullable string
```

### String Validation

```yaml
StringSchema:
  type: string
  description: "StringSchema validation rules"
  attributes:
    type: string (literal "string")
    minLength: integer (optional)
    maxLength: integer (optional)
    pattern: string (optional)
    format: StringFormat [enum] (optional)

  validation:
    minLength: integer (minimum string length)
    maxLength: integer (maximum string length)
    pattern: string (regular expression)
    format: StringFormat [enum]

  enums:
    StringFormat:
      # Date and Time
      - date-time # RFC 3339 date-time
      - date # RFC 3339 full-date
      - time # RFC 3339 full-time

      # Email and Networks
      - email # Email address
      - idn-email # Internationalized email
      - hostname # Internet hostname
      - idn-hostname # Internationalized hostname
      - ipv4 # IPv4 address
      - ipv6 # IPv6 address
      - uri # Universal Resource Identifier
      - uri-reference
      - iri # Internationalized URI
      - iri-reference

      # JSON and Regex
      - json-pointer
      - relative-json-pointer
      - regex # Regular expression

      # Custom formats (not standard, but commonly used)
      - uuid # UUID/GUID
      - phone # Phone number
      - credit-card # Credit card number

  examples:
    - # Email
      email:
        type: string
        format: email
        maxLength: 254

    - # UUID
      productId:
        type: string
        format: uuid
        description: "Unique product identifier"

    - # Pattern
      sku:
        type: string
        pattern: "^[A-Z]{2}\\d{4}$"
        description: "SKU format: AA1234"

    - # Enum
      status:
        type: string
        enum: ["draft", "active", "archived"]
        description: "Product status"
```

### Numeric Validation

```yaml
NumericSchema:
  type: number | integer
  description: "NumericSchema validation rules"
  attributes:
    type: string (literal "number" or "integer")
    minimum: number (optional)
    maximum: number (optional)
    exclusiveMinimum: number (optional)
    exclusiveMaximum: number (optional)
    multipleOf: number (optional)

  validation:
    minimum: number (inclusive minimum)
    maximum: number (inclusive maximum)
    exclusiveMinimum: number (exclusive minimum)
    exclusiveMaximum: number (exclusive maximum)
    multipleOf: number (must be multiple of this value)

  examples:
    - # Price
      price:
        type: number
        minimum: 0
        multipleOf: 0.01
        description: "Price in USD"

    - # Percentage
      discountPercent:
        type: number
        minimum: 0
        maximum: 100
        description: "Discount percentage"

    - # Quantity
      quantity:
        type: integer
        minimum: 0
        description: "Stock quantity"

    - # Rating
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
  description: "ArraySchema validation rules"
  attributes:
    type: string (literal "array")
    items: Schema (optional)
    minItems: integer (optional)
    maxItems: integer (optional)
    uniqueItems: boolean (optional)
    contains: Schema (optional)

  validation:
    items: Schema (schema for array items)
    minItems: integer (minimum array length)
    maxItems: integer (maximum array length)
    uniqueItems: boolean (all items must be unique)
    contains: Schema (at least one item must match)

  examples:
    - # Simple array
      tags:
        type: array
        items:
          type: string
          minLength: 1
        minItems: 0
        maxItems: 10
        uniqueItems: true
        description: "Product tags"

    - # Array of objects
      reviews:
        type: array
        items:
          $ref: "#/definitions/Review"
        description: "Product reviews"

    - # Tuple (fixed-length array with typed positions)
      coordinates:
        type: array
        items:
          - type: number # latitude
          - type: number # longitude
        minItems: 2
        maxItems: 2
        description: "Geographic coordinates [lat, lon]"
```

### Object Validation

```yaml
ObjectSchema:
  type: object
  description: "ObjectSchema validation rules"
  attributes:
    type: string (literal "object")
    required: string[] (optional)
    additionalProperties: boolean | Schema (optional)
    minProperties: integer (optional)
    maxProperties: integer (optional)

  contains:
    - properties: SchemaProperty[] (0..*) # keyed by property name

  validation:
    required: string[] (required property names)
    additionalProperties: boolean | Schema (allow/disallow extra properties)
    minProperties: integer (minimum number of properties)
    maxProperties: integer (maximum number of properties)
    propertyNames: Schema (validation for property names)
    dependencies: object (property dependencies)

  examples:
    - # Basic object
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

    - # With dependencies
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
          postalCode: ["country"] # If postalCode exists, country is required
```

### Schema Composition

```yaml
SchemaComposition:
  description: "Combining multiple schemas"
  attributes:
    id: string (UUID) [PK]
    name: string

  keywords:
    allOf: Schema[] # Must match ALL schemas
    anyOf: Schema[] # Must match AT LEAST ONE schema
    oneOf: Schema[] # Must match EXACTLY ONE schema
    not: Schema # Must NOT match this schema

  examples:
    - # allOf - combining schemas (like inheritance)
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

    - # oneOf - discriminated union
      PaymentMethod:
        oneOf:
          - $ref: "#/definitions/CreditCard"
          - $ref: "#/definitions/BankTransfer"
          - $ref: "#/definitions/PayPal"
        discriminator:
          propertyName: type

    - # anyOf - nullable
      OptionalString:
        anyOf:
          - type: string
          - type: "null"

    - # not - exclusion
      NonEmptyString:
        type: string
        not:
          const: ""
```

### References

```yaml
Reference:
  description: "Reference to another schema"
  attributes:
    id: string (UUID) [PK]
    name: string

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

### SchemaDefinition

```yaml
SchemaDefinition:
  description: "A reusable JSON Schema definition that can be referenced throughout the data model. Enables DRY schema design and consistent type definitions across entities."
  attributes:
    id: string (UUID) [PK]
    name: string (definition name, used as key in definitions object)
    title: string (optional, human-readable name)
    description: string (optional)
    type: JSONType (optional, inherited from Schema)

  contains:
    - properties: SchemaProperty[] (0..*) # for object types
    - items: Schema (for array types, optional)

  composition:
    allOf: Schema[] (optional)
    anyOf: Schema[] (optional)
    oneOf: Schema[] (optional)
    not: Schema (optional)

  examples:
    # Simple reusable definition
    - name: "Address"
      title: "Postal Address"
      description: "Standard postal address structure"
      type: object
      required: ["street", "city", "country"]
      properties:
        street:
          type: string
          maxLength: 200
        city:
          type: string
          maxLength: 100
        state:
          type: string
          maxLength: 50
        postalCode:
          type: string
          pattern: "^[0-9]{5}(-[0-9]{4})?$"
        country:
          type: string
          minLength: 2
          maxLength: 2

    # Enum definition
    - name: "OrderStatus"
      title: "Order Status"
      type: string
      enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"]

    # Composite definition
    - name: "AuditFields"
      title: "Audit Tracking Fields"
      type: object
      properties:
        createdAt:
          type: string
          format: date-time
          readOnly: true
        createdBy:
          type: string
          format: uuid
          readOnly: true
        updatedAt:
          type: string
          format: date-time
          readOnly: true
        updatedBy:
          type: string
          format: uuid
          readOnly: true
```

### SchemaProperty

```yaml
SchemaProperty:
  description: "Defines a single property within a schema, including its type, constraints, validation rules, and documentation. The fundamental building block of data model structure."
  attributes:
    id: string (UUID) [PK]
    name: string (property name, used as key in properties object)
    type: JSONType | JSONType[] (data type or array of types for unions)
    title: string (optional, human-readable name)
    description: string (optional)
    format: string (optional, e.g., "email", "uuid", "date-time")
    default: any (optional, default value)
    enum: any[] (optional, allowed values)
    const: any (optional, constant value)
    readOnly: boolean (optional) # default: false
    writeOnly: boolean (optional) # default: false
    deprecated: boolean (optional) # default: false
    examples: any[] (optional, example values)

  validation:
    # String constraints
    minLength: integer (optional)
    maxLength: integer (optional)
    pattern: string (regex, optional)

    # Numeric constraints
    minimum: number (optional)
    maximum: number (optional)
    exclusiveMinimum: number (optional)
    exclusiveMaximum: number (optional)
    multipleOf: number (optional)

    # Array constraints
    minItems: integer (optional)
    maxItems: integer (optional)
    uniqueItems: boolean (optional)
    items: Schema (optional, for array type)
    contains: Schema (optional, at least one item must match)

    # Object constraints
    properties: SchemaProperty[] (optional, for object type)
    required: string[] (optional, required property names)
    additionalProperties: boolean | Schema (optional)
    minProperties: integer (optional)
    maxProperties: integer (optional)

  references:
    $ref: string (optional, reference to another schema)

  extensions:
    x-database: object (database mapping, optional)
    x-ui: object (UI rendering hints, optional)
    x-security: object (security metadata, optional)

  examples:
    # String property with validation
    - name: "email"
      type: string
      format: email
      description: "User's primary email address"
      maxLength: 254
      x-security:
        pii: true
        classification: restricted

    # Numeric property with constraints
    - name: "price"
      type: number
      description: "Product price in USD"
      minimum: 0
      multipleOf: 0.01
      x-database:
        column: "price"
        type: "DECIMAL(10,2)"

    # Enum property
    - name: "status"
      type: string
      enum: ["active", "inactive", "pending"]
      default: "pending"
      description: "Current record status"

    # Nested object property
    - name: "address"
      type: object
      description: "Customer billing address"
      properties:
        street:
          type: string
        city:
          type: string
      required: ["street", "city"]
```

### DataGovernance

```yaml
DataGovernance:
  description: "Metadata about data ownership, classification, sensitivity level, and handling requirements. Ensures data is managed according to organizational policies and regulations."
  attributes:
    id: string (UUID) [PK]
    name: string

  governedBy:
    principleRefs: string[] (Principle IDs from Motivation Layer, optional)
    requirementRefs: string[] (Requirement IDs from Motivation Layer, optional)
    constraintRefs: string[] (Constraint IDs from Motivation Layer, optional)

  ownership:
    dataOwner: string (person or team responsible, optional)
    dataSteward: string (person or team managing data quality, optional)
    technicalOwner: string (person or team managing technical implementation, optional)

  classification:
    level: DataClassificationLevel [enum] (optional)
    categories: string[] (custom classification categories, optional)

  lifecycle:
    creationPolicy: string (how data is created, optional)
    retentionPeriod: string (how long data is retained, e.g., "7years", optional)
    archivalPolicy: string (how data is archived, optional)
    deletionPolicy: string (how data is deleted, optional)

  compliance:
    regulations: string[] (applicable regulations, e.g., ["GDPR", "HIPAA", "SOX"], optional)
    certifications: string[] (required certifications, optional)

  enums:
    DataClassificationLevel:
      - public # Publicly available
      - internal # Internal use only
      - confidential # Restricted access
      - restricted # Highly restricted (PII, PHI, financial)
      - secret # Top secret (rarely used)

  examples:
    # Customer data governance
    - governedBy:
        principleRefs: ["principle-privacy-by-design", "principle-data-minimization"]
        requirementRefs: ["req-gdpr-compliance", "req-customer-consent"]
        constraintRefs: ["constraint-gdpr-article-6", "constraint-ccpa-opt-out"]
      ownership:
        dataOwner: "Customer Experience Team"
        dataSteward: "Data Governance Office"
        technicalOwner: "Customer Platform Engineering"
      classification:
        level: restricted
        categories: ["PII", "customer-data"]
      lifecycle:
        retentionPeriod: "duration-of-service"
        deletionPolicy: "upon-account-closure-plus-30-days"
      compliance:
        regulations: ["GDPR", "CCPA", "LGPD"]

    # Financial data governance
    - governedBy:
        principleRefs: ["principle-data-integrity", "principle-audit-trail"]
        requirementRefs: ["req-sox-compliance", "req-financial-reporting"]
        constraintRefs: ["constraint-sox-section-404", "constraint-7year-retention"]
      ownership:
        dataOwner: "Finance Department"
        dataSteward: "Financial Controls Team"
      classification:
        level: confidential
        categories: ["financial", "audit-trail"]
      lifecycle:
        retentionPeriod: "7years"
        archivalPolicy: "move-to-cold-storage-after-1year"
      compliance:
        regulations: ["SOX", "SEC-17a-4"]
```

### DataQualityMetrics

```yaml
DataQualityMetrics:
  description: "Defines measurable quality attributes for data elements such as completeness, accuracy, consistency, and timeliness. Enables data quality monitoring and SLA enforcement."
  attributes:
    id: string (UUID) [PK]
    name: string
    schemaRef: string (reference to schema this applies to, optional)
    monitoringEnabled: boolean (optional) # default: true

  metrics:
    completenessMetrics: string[] (Metric IDs measuring field completion rates, optional)
    accuracyMetrics: string[] (Metric IDs measuring data validity, optional)
    consistencyMetrics: string[] (Metric IDs measuring cross-field validation, optional)
    freshnessMetrics: string[] (Metric IDs measuring data staleness, optional)
    uniquenessMetrics: string[] (Metric IDs measuring duplicate detection, optional)
    integrityMetrics: string[] (Metric IDs measuring referential integrity, optional)
    timelinessMetrics: string[] (Metric IDs measuring data arrival timing, optional)

  targets:
    completenessTarget: string (e.g., ">= 95%", optional)
    accuracyTarget: string (e.g., ">= 99%", optional)
    freshnessTarget: string (e.g., "< 5 minutes", optional)

  alerting:
    alertOnViolation: boolean (optional)
    alertThreshold: string (threshold for alerting, optional)
    alertChannels: string[] (notification channels, optional)

  references:
    - apmLayerMetrics: string[] (references to APM Layer Metric definitions)

  examples:
    # Customer profile quality metrics
    - name: "customer-profile-quality"
      schemaRef: "customer-schema"
      monitoringEnabled: true
      metrics:
        completenessMetrics:
          - "metric-customer-email-completeness"
          - "metric-customer-phone-completeness"
          - "metric-customer-address-completeness"
        accuracyMetrics:
          - "metric-customer-email-validity"
          - "metric-customer-phone-format-validity"
        consistencyMetrics:
          - "metric-customer-name-consistency"
        freshnessMetrics:
          - "metric-customer-last-updated-age"
        uniquenessMetrics:
          - "metric-customer-duplicate-rate"
      targets:
        completenessTarget: ">= 95%"
        accuracyTarget: ">= 99%"
        freshnessTarget: "< 24 hours"
      alerting:
        alertOnViolation: true
        alertThreshold: "< 90%"
        alertChannels: ["pagerduty", "slack-data-quality"]

    # Product catalog quality metrics
    - name: "product-catalog-quality"
      schemaRef: "product-schema"
      metrics:
        completenessMetrics:
          - "metric-product-description-completeness"
          - "metric-product-image-completeness"
        accuracyMetrics:
          - "metric-product-price-validity"
          - "metric-product-sku-format-validity"
        freshnessMetrics:
          - "metric-product-inventory-freshness"
        integrityMetrics:
          - "metric-product-category-reference-integrity"
      targets:
        completenessTarget: ">= 98%"
        accuracyTarget: ">= 99.9%"
```

### DatabaseMapping

```yaml
DatabaseMapping:
  description: "Specifies how a logical data model entity maps to physical database storage, including table names, column mappings, and storage optimizations. Bridges logical and physical data layers."
  attributes:
    id: string (UUID) [PK]
    name: string
    table: string (database table name)
    schema: string (database schema/namespace, optional)
    catalog: string (database catalog, optional)
    engine: string (database engine hint, e.g., "postgresql", "mysql", optional)

  columns:
    # Map of property name to column configuration
    propertyName:
      column: string (database column name)
      type: SQLType [enum]
      length: integer (for VARCHAR, optional)
      precision: integer (for DECIMAL, optional)
      scale: integer (for DECIMAL, optional)
      nullable: boolean (optional) # default: true
      primaryKey: boolean (optional) # default: false
      autoIncrement: boolean (optional) # default: false
      unique: boolean (optional) # default: false
      default: any (default value, optional)
      index: boolean | string (true for auto-named index, string for named index, optional)

  foreignKeys:
    - name: string (constraint name)
      columns: string[] (local columns)
      referencesTable: string (foreign table)
      referencesColumns: string[] (foreign columns)
      onDelete: ReferentialAction [enum] (optional)
      onUpdate: ReferentialAction [enum] (optional)

  indexes:
    - name: string (index name)
      columns: string[] (indexed columns)
      unique: boolean (optional) # default: false
      type: IndexType [enum] (optional)
      where: string (partial index condition, optional)

  constraints:
    - name: string (constraint name)
      type: ConstraintType [enum]
      columns: string[] (affected columns, optional)
      check: string (SQL expression for CHECK constraints, optional)

  partitioning:
    strategy: PartitionStrategy [enum] (optional)
    column: string (partition key column, optional)
    interval: string (for range partitioning, optional)

  enums:
    SQLType:
      - VARCHAR
      - CHAR
      - TEXT
      - CLOB
      - INTEGER
      - SMALLINT
      - BIGINT
      - SERIAL
      - BIGSERIAL
      - DECIMAL
      - NUMERIC
      - FLOAT
      - DOUBLE
      - BOOLEAN
      - DATE
      - TIME
      - TIMESTAMP
      - TIMESTAMPTZ
      - INTERVAL
      - JSON
      - JSONB
      - UUID
      - BYTEA
      - BLOB
      - ARRAY

    ReferentialAction:
      - CASCADE
      - SET_NULL
      - SET_DEFAULT
      - RESTRICT
      - NO_ACTION

    IndexType:
      - BTREE
      - HASH
      - GIN
      - GIST
      - BRIN

    ConstraintType:
      - PRIMARY_KEY
      - UNIQUE
      - FOREIGN_KEY
      - CHECK
      - NOT_NULL
      - EXCLUSION

    PartitionStrategy:
      - RANGE
      - LIST
      - HASH

  examples:
    # Product table mapping
    - name: "product-db-mapping"
      table: "products"
      schema: "catalog"
      engine: "postgresql"
      columns:
        id:
          column: "product_id"
          type: UUID
          primaryKey: true
          nullable: false
        name:
          column: "product_name"
          type: VARCHAR
          length: 200
          nullable: false
          index: "idx_product_name"
        sku:
          column: "sku"
          type: VARCHAR
          length: 20
          nullable: false
          unique: true
        price:
          column: "price"
          type: DECIMAL
          precision: 10
          scale: 2
          nullable: false
        category:
          column: "category_id"
          type: UUID
          nullable: false
        createdAt:
          column: "created_at"
          type: TIMESTAMPTZ
          nullable: false
          default: "CURRENT_TIMESTAMP"
      foreignKeys:
        - name: "fk_product_category"
          columns: ["category_id"]
          referencesTable: "categories"
          referencesColumns: ["category_id"]
          onDelete: RESTRICT
      indexes:
        - name: "idx_products_category"
          columns: ["category_id"]
        - name: "idx_products_sku"
          columns: ["sku"]
          unique: true
        - name: "idx_products_name_search"
          columns: ["product_name"]
          type: GIN
      constraints:
        - name: "chk_price_positive"
          type: CHECK
          check: "price >= 0"

    # Order table with partitioning
    - name: "order-db-mapping"
      table: "orders"
      schema: "sales"
      partitioning:
        strategy: RANGE
        column: "created_at"
        interval: "1 month"
      columns:
        id:
          column: "order_id"
          type: UUID
          primaryKey: true
        customerId:
          column: "customer_id"
          type: UUID
          nullable: false
        createdAt:
          column: "created_at"
          type: TIMESTAMPTZ
          nullable: false
```

## Custom Extensions

### x-business-object-ref Extension

```yaml
x-business-object-ref:
  description: "Reference to BusinessObject this schema implements"
  attributes:
    value: string (BusinessObject.id from Business Layer)

  type: string (BusinessObject.id from Business Layer)
  purpose: "Enables upward traceability from technical schema to business concept"

  rationale: |
    Completes bidirectional traceability:
    - BusinessObject.spec.schema-id (downward documentation reference)
    - JSONSchema.x-business-object-ref (upward implementation reference)

    Follows link philosophy: Implementation knows its business purpose.

  benefits:
    - Business impact analysis when schema changes
    - Domain-driven design traceability
    - Complete business-to-technical lineage

  example:
    x-business-object-ref: "business-object-product"
```

### x-data-governance Extension

```yaml
x-data-governance:
  description: "Data model governance metadata (root-level)"
  purpose: "Captures data architecture principles, requirements, and constraints beyond security"

  attributes:
    id: string (UUID) [PK]
    name: string
    governedBy: object (optional) # Contains principleRefs, requirementRefs, constraintRefs arrays

  rationale: |
    Extends x-security.governedBy to cover broader data architecture concerns:
    - x-security.governedBy: Security and privacy governance (field-level)
    - x-data-governance.governedBy: Data architecture governance (schema-level)

  useCases:
    - Data architecture principles (normalization, canonical models, event sourcing)
    - Data model requirements (audit trails, lifecycle tracking, temporal data)
    - Data constraints (retention policies, residency requirements, SOX/regulatory)

  examples:
    # Event-sourced order schema
    - governedBy:
        principleRefs: ["principle-event-sourcing", "principle-immutable-audit-log"]
        requirementRefs: ["req-order-lifecycle-tracking", "req-regulatory-reporting"]
        constraintRefs: ["constraint-sox-compliance", "constraint-7year-retention"]

    # Customer 360 schema
    - governedBy:
        principleRefs: ["principle-single-source-of-truth", "principle-canonical-data-model"]
        requirementRefs: ["req-customer-360-view", "req-master-data-management"]
        constraintRefs: ["constraint-gdpr-right-to-access", "constraint-data-quality-sla"]

    # Analytics schema
    - governedBy:
        principleRefs: ["principle-data-normalization", "principle-star-schema"]
        requirementRefs: ["req-historical-data-retention", "req-slowly-changing-dimensions"]
        constraintRefs: ["constraint-no-pii-in-analytics", "constraint-3year-historical-data"]
```

### x-apm-data-quality-metrics Extension

```yaml
x-apm-data-quality-metrics:
  description: "Links schema to data quality metrics in APM/Observability Layer"
  purpose: "Enables data quality monitoring, governance, and SLA tracking"

  attributes:
    id: string (UUID) [PK]
    name: string
    completenessMetrics: string[] (Metric IDs measuring field completion rates, optional)
    accuracyMetrics: string[] (Metric IDs measuring data accuracy/validity, optional)
    consistencyMetrics: string[] (Metric IDs measuring cross-field validation, optional)
    freshnessMetrics: string[] (Metric IDs measuring data staleness/age, optional)
    uniquenessMetrics: string[] (Metric IDs measuring duplicate detection, optional)
    integrityMetrics: string[] (Metric IDs measuring referential integrity, optional)

  rationale: |
    Data quality is a first-class architectural concern:
    - Industry standard (DAMA DMBOK, ISO 8000)
    - Enables data governance and compliance
    - Links data models to observable quality metrics
    - Supports business goal achievement measurement

  dataQualityDimensions:
    Completeness: "Percentage of required fields populated"
    Accuracy: "Percentage of values within valid ranges/formats"
    Consistency: "Percentage of values passing cross-field validation"
    Freshness: "Age of data records (time since last update)"
    Uniqueness: "Percentage of records without duplicates"
    Integrity: "Percentage of foreign key references that are valid"

  examples:
    # Customer schema with comprehensive quality metrics
    - completenessMetrics:
        - "metric-customer-email-completeness"
        - "metric-customer-address-completeness"
        - "metric-customer-phone-completeness"
      accuracyMetrics:
        - "metric-customer-email-validity"
        - "metric-customer-phone-format-validity"
        - "metric-customer-postal-code-validity"
      consistencyMetrics:
        - "metric-customer-name-consistency"
        - "metric-customer-address-standardization"
      freshnessMetrics:
        - "metric-customer-last-updated-age"
        - "metric-customer-profile-staleness"
      uniquenessMetrics:
        - "metric-customer-duplicate-rate"

    # Product catalog schema
    - completenessMetrics:
        - "metric-product-description-completeness"
        - "metric-product-image-completeness"
      accuracyMetrics:
        - "metric-product-price-validity"
        - "metric-product-sku-format-validity"
      freshnessMetrics:
        - "metric-product-inventory-freshness"

    # Order transaction schema
    - accuracyMetrics:
        - "metric-order-total-calculation-accuracy"
      consistencyMetrics:
        - "metric-order-item-sum-matches-total"
        - "metric-order-status-transitions-valid"
      integrityMetrics:
        - "metric-order-customer-reference-integrity"
        - "metric-order-product-reference-integrity"
```

### x-database Extension

```yaml
x-database:
  description: "Database mapping information"
  attributes:
    id: string (UUID) [PK]
    name: string
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
    id: string (UUID) [PK]
    name: string
    component: UIComponent [enum]
    label: string
    placeholder: string
    helpText: string
    order: integer
    readOnly: boolean
    hidden: boolean
    group: string (section/group name)

  # Motivation Layer Integration (optional)
  governedBy:
    principleRefs: string[] (UX/Design Principle IDs, optional)

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
    id: string (UUID) [PK]
    name: string
    pii: boolean (contains personally identifiable information)
    encrypted: boolean (should be encrypted at rest)
    classification: SecurityClassification [enum]
    retention: string (data retention period, e.g., "90days", "7years")
    masking: MaskingStrategy [enum]
    redaction: boolean (should be redacted in logs)

  # Motivation Layer Integration
  governedBy:
    constraintRefs: string[] (Constraint IDs from Motivation Layer, optional)
    requirementRefs: string[] (Requirement IDs from Motivation Layer, optional)
    principleRefs: string[] (Principle IDs from Motivation Layer, optional)

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
      - partial # Show first/last characters
      - full # Complete masking
      - hash # One-way hash

  examples:
    # GDPR-driven retention
    - retention: "90days"
      governedBy:
        constraintRefs: ["constraint-gdpr-data-protection"]
        requirementRefs: ["req-gdpr-article-17-right-to-erasure"]
        principleRefs: ["principle-privacy-by-design"]

    # Financial compliance
    - retention: "7years"
      governedBy:
        constraintRefs: ["constraint-sox-compliance"]
        requirementRefs: ["req-financial-record-retention"]
        principleRefs: ["principle-data-integrity"]
```

## Complete Example: Product Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/schemas/product.json",
  "title": "Product",
  "description": "Product catalog item schema",
  "x-archimate-ref": "data-object-product",
  "x-business-object-ref": "business-object-product",
  "x-data-governance": {
    "governedBy": {
      "principleRefs": ["principle-canonical-data-model", "principle-single-source-of-truth"],
      "requirementRefs": ["req-product-master-data-management", "req-product-lifecycle-tracking"],
      "constraintRefs": ["constraint-product-data-retention-7years"]
    }
  },
  "x-apm-data-quality-metrics": {
    "completenessMetrics": [
      "metric-product-description-completeness",
      "metric-product-image-completeness",
      "metric-product-category-completeness"
    ],
    "accuracyMetrics": [
      "metric-product-price-validity",
      "metric-product-sku-format-validity",
      "metric-product-weight-reasonableness"
    ],
    "freshnessMetrics": ["metric-product-inventory-freshness", "metric-product-price-update-age"],
    "uniquenessMetrics": ["metric-product-sku-uniqueness"],
    "integrityMetrics": ["metric-product-category-reference-integrity"]
  },
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

## Example Model

The following XML example demonstrates cross-layer integration using ArchiMate-style XML format.

```xml
<model>
  <!-- Example Schema with cross-layer properties -->
  <element id="product-schema" type="Schema">
    <n>Product Schema</n>
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

- **Schema** governed by **Principle** (x-security.governedBy.principleRefs property)
- **Schema** governed by **Requirement** (x-security.governedBy.requirementRefs property)
- **Schema** governed by **Constraint** (x-security.governedBy.constraintRefs property)
- **Schema** governed by **Principle** (x-data-governance.governedBy.principleRefs property)
- **Schema** governed by **Requirement** (x-data-governance.governedBy.requirementRefs property)
- **Schema** governed by **Constraint** (x-data-governance.governedBy.constraintRefs property)
- **Schema** governed by **Principle** (x-ui.governedBy.principleRefs property)

### To Business Layer

- **BusinessObject** references **Schema** (spec.schema-id property)
- **Schema** references **BusinessObject** (x-business-object-ref property)

### To ArchiMate Application Layer

- **Schema** references **DataObject** (x-archimate-ref property)

### To API Layer (OpenAPI)

- **OpenAPI** references **Schema** ($ref property)

### To UX Layer

- **FieldDefinition** references **Schema** (dataBinding.schemaRef property)

### To Data Store Layer

- **Schema** maps to **Database** (x-database property)

### To Security Layer

- **Schema** defines **AccessControl** (x-security property)

### To APM/Observability Layer

- **Schema** links to **Metric** (x-apm-data-quality-metrics property)

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

## Relationships

### Structural Relationships

- **JSONSchema composes SchemaDefinition**: Schema documents compose reusable schema definitions
- **JSONSchema composes SchemaProperty**: Schema documents compose root-level properties
- **SchemaDefinition composes SchemaProperty**: Schema definitions compose their properties
- **ObjectSchema composes SchemaProperty**: Object schemas compose their properties
- **ArraySchema composes SchemaProperty**: Array schemas compose item schema definitions
- **DatabaseMapping composes SchemaProperty**: Database mapping composes column property mappings
- **JSONSchema aggregates DataGovernance**: Schemas aggregate governance metadata
- **JSONSchema aggregates DataQualityMetrics**: Schemas aggregate quality metrics configuration
- **JSONSchema aggregates DatabaseMapping**: Schemas aggregate database mapping metadata
- **SchemaComposition aggregates SchemaDefinition**: Schema compositions aggregate schemas via allOf/anyOf/oneOf
- **DataGovernance aggregates DataQualityMetrics**: Governance aggregates associated quality metrics
- **SchemaDefinition specializes SchemaDefinition**: Schema definitions extend other definitions via allOf inheritance
- **SchemaProperty specializes SchemaProperty**: Schema properties specialize base property definitions
- **ObjectSchema specializes SchemaDefinition**: Object schema is a specialized schema definition
- **ArraySchema specializes SchemaDefinition**: Array schema is a specialized schema definition
- **StringSchema specializes SchemaProperty**: String schema specializes property with string constraints
- **NumericSchema specializes SchemaProperty**: Numeric schema specializes property with numeric constraints
- **SchemaComposition specializes SchemaDefinition**: Composition (allOf/anyOf/oneOf) is a specialized definition
- **SchemaDefinition realizes JSONType**: Schema definitions realize JSON types
- **StringSchema realizes JSONType**: String schema realizes the string JSON type
- **NumericSchema realizes JSONType**: Numeric schema realizes number/integer JSON types
- **ObjectSchema realizes JSONType**: Object schema realizes the object JSON type
- **ArraySchema realizes JSONType**: Array schema realizes the array JSON type

### Behavioral Relationships

- **SchemaProperty references SchemaDefinition**: Properties reference schema definitions via $ref
- **SchemaDefinition references SchemaDefinition**: Definitions reference other definitions via $ref
- **Reference references SchemaDefinition**: $ref objects point to target schema definitions
- **ArraySchema references SchemaDefinition**: Array items property references schema definition
- **ObjectSchema references SchemaDefinition**: Object properties reference definitions via $ref
- **StringSchema references SchemaDefinition**: String schema references enum definition for allowed values
- **SchemaDefinition depends-on SchemaDefinition**: Definitions depend on other definitions for composition
- **SchemaComposition depends-on SchemaDefinition**: Composition depends on schemas combined via allOf/anyOf/oneOf
- **Reference depends-on SchemaDefinition**: $ref creates compile-time dependency on target definition
- **SchemaProperty derives-from SchemaProperty**: Computed properties derive from source properties
- **DataQualityMetrics accesses SchemaProperty**: Quality metrics access properties for validation
- **DataQualityMetrics accesses SchemaDefinition**: Quality metrics access schema definitions for validation
- **DataGovernance accesses SchemaProperty**: Governance rules access properties for classification
- **SchemaProperty maps-to DatabaseMapping**: Properties map to database column definitions
- **SchemaDefinition maps-to DatabaseMapping**: Schema definition maps to database table mapping

## Intra-Layer Relationships

**Purpose**: Define structural and behavioral relationships between entities within this layer.

### Structural Relationships

Relationships that define the composition, aggregation, and specialization of entities within this layer.

| Relationship   | Source Element    | Target Element     | Predicate     | Inverse Predicate | Cardinality | Description                                                  |
| -------------- | ----------------- | ------------------ | ------------- | ----------------- | ----------- | ------------------------------------------------------------ |
| Composition    | JSONSchema        | SchemaDefinition   | `composes`    | `composed-of`     | 1:N         | Schema document composes reusable definitions                |
| Composition    | JSONSchema        | SchemaProperty     | `composes`    | `composed-of`     | 1:N         | Schema document composes root-level properties               |
| Composition    | SchemaDefinition  | SchemaProperty     | `composes`    | `composed-of`     | 1:N         | Definition composes its properties                           |
| Composition    | ObjectSchema      | SchemaProperty     | `composes`    | `composed-of`     | 1:N         | Object schema composes its properties                        |
| Composition    | ArraySchema       | SchemaProperty     | `composes`    | `composed-of`     | 1:N         | Array schema composes item definitions                       |
| Composition    | DatabaseMapping   | SchemaProperty     | `composes`    | `composed-of`     | 1:N         | Database mapping composes column property mappings           |
| Aggregation    | JSONSchema        | DataGovernance     | `aggregates`  | `aggregated-by`   | 1:1         | Schema aggregates governance metadata                        |
| Aggregation    | JSONSchema        | DataQualityMetrics | `aggregates`  | `aggregated-by`   | 1:1         | Schema aggregates quality metrics config                     |
| Aggregation    | JSONSchema        | DatabaseMapping    | `aggregates`  | `aggregated-by`   | 1:1         | Schema aggregates database mapping                           |
| Aggregation    | SchemaComposition | SchemaDefinition   | `aggregates`  | `aggregated-by`   | 1:N         | Composition aggregates schemas via allOf/anyOf/oneOf         |
| Aggregation    | DataGovernance    | DataQualityMetrics | `aggregates`  | `aggregated-by`   | 1:N         | Governance aggregates associated quality metrics             |
| Specialization | SchemaDefinition  | SchemaDefinition   | `specializes` | `generalized-by`  | N:1         | Definition extends another via allOf inheritance             |
| Specialization | SchemaProperty    | SchemaProperty     | `specializes` | `generalized-by`  | N:1         | Property specializes a base property definition              |
| Specialization | ObjectSchema      | SchemaDefinition   | `specializes` | `generalized-by`  | N:1         | Object schema is a specialized schema definition             |
| Specialization | ArraySchema       | SchemaDefinition   | `specializes` | `generalized-by`  | N:1         | Array schema is a specialized schema definition              |
| Specialization | StringSchema      | SchemaProperty     | `specializes` | `generalized-by`  | N:1         | String schema specializes property with string constraints   |
| Specialization | NumericSchema     | SchemaProperty     | `specializes` | `generalized-by`  | N:1         | Numeric schema specializes property with numeric constraints |
| Specialization | SchemaComposition | SchemaDefinition   | `specializes` | `generalized-by`  | N:1         | Composition (allOf/anyOf/oneOf) is a specialized definition  |
| Realization    | SchemaDefinition  | JSONType           | `realizes`    | `realized-by`     | N:1         | Definition realizes a JSON type                              |
| Realization    | StringSchema      | JSONType           | `realizes`    | `realized-by`     | N:1         | String schema realizes the string JSON type                  |
| Realization    | NumericSchema     | JSONType           | `realizes`    | `realized-by`     | N:1         | Numeric schema realizes number/integer JSON types            |
| Realization    | ObjectSchema      | JSONType           | `realizes`    | `realized-by`     | N:1         | Object schema realizes the object JSON type                  |
| Realization    | ArraySchema       | JSONType           | `realizes`    | `realized-by`     | N:1         | Array schema realizes the array JSON type                    |

### Behavioral Relationships

Relationships that define interactions, flows, and dependencies between entities within this layer.

| Relationship | Source Element     | Target Element   | Predicate      | Inverse Predicate | Cardinality | Description                                                   |
| ------------ | ------------------ | ---------------- | -------------- | ----------------- | ----------- | ------------------------------------------------------------- |
| Reference    | SchemaProperty     | SchemaDefinition | `references`   | `referenced-by`   | N:1         | Property references a definition via $ref                     |
| Reference    | SchemaDefinition   | SchemaDefinition | `references`   | `referenced-by`   | N:N         | Definition references other definitions via $ref              |
| Reference    | Reference          | SchemaDefinition | `references`   | `referenced-by`   | 1:1         | $ref object points to target definition                       |
| Reference    | ArraySchema        | SchemaDefinition | `references`   | `referenced-by`   | N:1         | Array items property references schema definition             |
| Reference    | ObjectSchema       | SchemaDefinition | `references`   | `referenced-by`   | N:N         | Object properties reference definitions via $ref              |
| Reference    | StringSchema       | SchemaDefinition | `references`   | `referenced-by`   | N:1         | String schema references enum definition for allowed values   |
| Depends-On   | SchemaDefinition   | SchemaDefinition | `depends-on`   | `dependency-of`   | N:N         | Definition depends on other definitions for composition       |
| Depends-On   | SchemaComposition  | SchemaDefinition | `depends-on`   | `dependency-of`   | N:N         | Composition depends on schemas combined via allOf/anyOf/oneOf |
| Depends-On   | Reference          | SchemaDefinition | `depends-on`   | `dependency-of`   | 1:1         | $ref creates compile-time dependency on target definition     |
| Derives-From | SchemaProperty     | SchemaProperty   | `derives-from` | `derived-by`      | N:N         | Computed property derives from source properties              |
| Access       | DataQualityMetrics | SchemaProperty   | `accesses`     | `accessed-by`     | 1:N         | Quality metrics access properties for validation              |
| Access       | DataQualityMetrics | SchemaDefinition | `accesses`     | `accessed-by`     | 1:N         | Quality metrics access schema definitions for validation      |
| Access       | DataGovernance     | SchemaProperty   | `accesses`     | `accessed-by`     | 1:N         | Governance rules access properties for classification         |
| Maps-To      | SchemaProperty     | DatabaseMapping  | `maps-to`      | `mapped-from`     | 1:1         | Property maps to database column definition                   |
| Maps-To      | SchemaDefinition   | DatabaseMapping  | `maps-to`      | `mapped-from`     | N:1         | Schema definition maps to database table mapping              |

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

### Core JSON Schema Practices

1. **Use $id**: Give schemas unique identifiers
2. **Provide Descriptions**: Document all properties
3. **Set additionalProperties**: Be explicit about extra properties
4. **Use Formats**: Leverage standard formats (email, uuid, date-time)
5. **Define Examples**: Include example values
6. **Version Schemas**: Use $id with versions for breaking changes
7. **Reuse Definitions**: Use $ref for common patterns
8. **Validate Constraints**: Use min/max, pattern for validation
9. **Mark ReadOnly**: Use readOnly for computed/system fields

### Cross-Layer Integration Practices

#### Business Layer Integration

1. **Link to Business Concepts**: Use x-business-object-ref to connect schemas to BusinessObject for domain-driven design traceability
2. **Business Impact Analysis**: Maintain bidirectional links (BusinessObject.spec.schema-id + JSONSchema.x-business-object-ref)
3. **Domain Modeling**: Every schema representing a business concept should reference its BusinessObject

#### Motivation Layer Integration

1. **Data Governance**: Use x-data-governance.governedBy to document data architecture principles, requirements, and constraints
2. **Separate Concerns**: Use x-security.governedBy for security/privacy, x-data-governance for architecture/design decisions
3. **Document Principles**: Reference principles like "principle-canonical-data-model", "principle-event-sourcing"
4. **Link Requirements**: Reference requirements like "req-master-data-management", "req-audit-trail"
5. **Capture Constraints**: Reference constraints like "constraint-sox-compliance", "constraint-7year-retention"

#### APM/Observability Integration

1. **Data Quality Metrics**: Use x-apm-data-quality-metrics to link schemas to data quality monitoring
2. **Completeness Metrics**: Define metrics for required field completion rates
3. **Accuracy Metrics**: Define metrics for data validation success rates
4. **Freshness Metrics**: Define metrics for data staleness (especially for master data)
5. **Integrity Metrics**: Define metrics for referential integrity (foreign keys)
6. **Goal Alignment**: Ensure data quality metrics support business goals (e.g., "goal-customer-360-view")

#### Security & UI Integration

1. **Security Metadata**: Always include x-security for sensitive data
2. **UI Rendering**: Use x-ui.group for logical grouping and x-ui.component for field types
3. **Database Mapping**: Use x-database for persistence layer mapping

### Data Quality Best Practices

1. **Measure What Matters**: Focus on quality dimensions that impact business goals
2. **Start with Critical Data**: Implement quality metrics for master data and high-value entities first
3. **Progressive Enhancement**: Begin with completeness/accuracy, add consistency/freshness/integrity as you mature
4. **Industry Standards**: Follow DAMA DMBOK data quality dimensions (completeness, accuracy, consistency, timeliness, uniqueness, integrity)

### Traceability Best Practices

1. **Complete Chain**: Maintain Goal → Requirement → Schema → Metric → Outcome traceability
2. **Upward References**: Schemas reference their purpose (BusinessObject, Principles, Metrics) following the link philosophy
3. **Bidirectional Queries**: Use upward references for maintenance, enable downward queries through tooling

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
    "anyOf": [{ "type": "string" }, { "type": "null" }]
  }
}
```

### Discriminated Unions

```json
{
  "oneOf": [{ "$ref": "#/definitions/CreditCard" }, { "$ref": "#/definitions/BankTransfer" }],
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
    "anyOf": [{ "type": "string", "format": "date-time" }, { "type": "null" }],
    "readOnly": true
  }
}
```

## Rationale for Enhanced Cross-Layer Integration

### Why Data Models Need Business Object References

**Problem**: Technical schemas exist in isolation from business concepts

- ❌ Cannot answer "which business concept does this schema represent?"
- ❌ Business impact analysis impossible when schemas change
- ❌ Domain-driven design traceability is one-way only (BusinessObject → Schema)

**Solution**: `x-business-object-ref` provides upward traceability

**Benefits**:

- ✅ **Bidirectional traceability**: BusinessObject.spec.schema-id (downward) + JSONSchema.x-business-object-ref (upward)
- ✅ **Business impact analysis**: Understand which business concepts are affected by schema changes
- ✅ **Domain-driven design**: Complete lineage from business domain to technical implementation
- ✅ **Follows link philosophy**: Implementation (schema) knows its business purpose

**Example Traceability Chain**:

```yaml
# Business Layer (02)
BusinessObject:
  id: "business-object-customer"
  name: "Customer"
  spec.schema-id: "550e8400-e29b-41d4-a716-446655440000" # Downward reference

# Data Model Layer (07)
JSONSchema:
  $id: "https://example.com/schemas/customer.json"
  x-business-object-ref: "business-object-customer" # Upward reference
  x-archimate-ref: "data-object-customer"

# Application Layer (04)
DataObject:
  id: "data-object-customer"
  spec.schema: "schemas/customer.json"
# Result: Complete Business → Application → Data → Database lineage
```

### Why Data Models Need Data Governance References

**Problem**: Security governance exists (x-security.governedBy), but broader data architecture governance is missing

- ❌ Cannot trace which principles guide data model design (normalization, event sourcing, canonical models)
- ❌ Cannot link schemas to data requirements (master data management, audit trails, temporal data)
- ❌ Cannot capture data constraints beyond security (retention policies, regulatory compliance)

**Solution**: `x-data-governance.governedBy` provides schema-level governance metadata

**Benefits**:

- ✅ **Separation of concerns**: x-security (field-level privacy/security) vs. x-data-governance (schema-level architecture)
- ✅ **Principle-driven design**: Links schemas to data architecture principles
- ✅ **Requirement traceability**: Links schemas to data model requirements
- ✅ **Regulatory compliance**: Links schemas to SOX, GDPR, HIPAA constraints
- ✅ **Architecture decision records**: Governance references document "why" design decisions were made

**Example Use Cases**:

```yaml
# Event-Sourced Order Schema
x-data-governance:
  governedBy:
    principleRefs: ["principle-event-sourcing", "principle-immutable-audit-log"]
    requirementRefs: ["req-order-lifecycle-tracking", "req-regulatory-reporting"]
    constraintRefs: ["constraint-sox-compliance", "constraint-7year-retention"]

# Customer 360 Master Data Schema
x-data-governance:
  governedBy:
    principleRefs: ["principle-single-source-of-truth", "principle-canonical-data-model"]
    requirementRefs: ["req-customer-360-view", "req-master-data-management"]
    constraintRefs: ["constraint-gdpr-right-to-access", "constraint-data-quality-sla"]

# Analytics Dimensional Schema
x-data-governance:
  governedBy:
    principleRefs: ["principle-star-schema", "principle-slowly-changing-dimensions"]
    requirementRefs: ["req-historical-data-retention", "req-time-series-analysis"]
    constraintRefs: ["constraint-no-pii-in-analytics", "constraint-3year-historical-data"]
```

### Why Data Models Need Data Quality Metrics

**Problem**: Data quality is a first-class concern, but no link from schemas to quality metrics exists

- ❌ Cannot trace which metrics monitor which data structures
- ❌ Data quality monitoring is ad-hoc, not systematically linked to schemas
- ❌ No way to validate if business goals (e.g., "goal-customer-360-view") are achieved via data quality
- ❌ Missing industry-standard data governance practice (DAMA DMBOK, ISO 8000)

**Solution**: `x-apm-data-quality-metrics` links schemas to data quality Metrics in APM Layer

**Benefits**:

- ✅ **Data governance**: Industry-standard practice (DAMA DMBOK, ISO 8000)
- ✅ **Observable quality**: Links data models to measurable quality metrics
- ✅ **Business goal validation**: Enables Goal → Schema → Metric → Outcome chain
- ✅ **SLA enforcement**: Enables data quality SLAs (e.g., "99% email completeness")
- ✅ **Automated monitoring**: Quality metrics generate alerts when data quality degrades
- ✅ **Compliance reporting**: Automated data quality reports for audits

**Industry Precedent**:

- **Data Catalogs**: Collibra, Alation link schemas to quality metrics
- **Cloud Platforms**: AWS Glue Data Quality, Azure Purview, Google Cloud Data Quality
- **Data Quality Tools**: Great Expectations, Deequ, Soda Core all link schemas to quality rules
- **Standards**: DAMA DMBOK defines 6 quality dimensions linked to data models

**Data Quality Dimensions** (DAMA DMBOK, ISO 8000):

1. **Completeness**: % of required fields populated
2. **Accuracy**: % of values within valid ranges/formats
3. **Consistency**: % of values passing cross-field validation rules
4. **Timeliness/Freshness**: Age of data records (time since last update)
5. **Uniqueness**: % of records without duplicates
6. **Integrity**: % of foreign key references that are valid

**Example with Complete Traceability**:

```yaml
# Motivation Layer (01)
Goal:
  id: "goal-customer-360-view"
  name: "Achieve Complete Customer 360 View"
  kpi: "95% customer profile completeness, 99% data accuracy"

Requirement:
  id: "req-customer-profile-completeness"
  name: "Customer profiles must be 95% complete"
  requirementType: "non-functional"

# Data Model Layer (07)
JSONSchema:
  $id: "https://example.com/schemas/customer.json"
  title: "Customer"
  x-business-object-ref: "business-object-customer"
  x-data-governance:
    governedBy:
      requirementRefs: ["req-customer-profile-completeness"]
  x-apm-data-quality-metrics:
    completenessMetrics:
      - "metric-customer-email-completeness"
      - "metric-customer-address-completeness"
      - "metric-customer-phone-completeness"
    accuracyMetrics:
      - "metric-customer-email-validity"
      - "metric-customer-phone-format-validity"

# APM Layer (11)
Metric:
  id: "metric-customer-email-completeness"
  name: "customer.email.completeness"
  type: "gauge"
  unit: "percent"
  motivationMapping:
    contributesToGoal: "goal-customer-360-view"
    measuresRequirement: "req-customer-profile-completeness"
    target: "95%"
  calculation: "COUNT(email IS NOT NULL) / COUNT(*) * 100"

Metric:
  id: "metric-customer-email-validity"
  name: "customer.email.validity"
  type: "gauge"
  unit: "percent"
  motivationMapping:
    contributesToGoal: "goal-customer-360-view"
    target: "99%"
  calculation: "COUNT(email MATCHES RFC5322) / COUNT(email IS NOT NULL) * 100"

# Result: Complete chain validates goal achievement
# Goal → Requirement → Schema → Quality Metrics → Actual Outcome
# "Are we achieving 95% customer profile completeness?" → Query metrics → Yes/No
```

## Benefits Summary

### For Data Architects

- **Complete traceability**: Goal → Requirement → Schema → Metric → Outcome
- **Governance automation**: Automated linking of schemas to principles, requirements, constraints
- **Quality by design**: Data quality metrics defined alongside data models
- **Business alignment**: Schemas explicitly linked to business concepts and goals

### For Data Engineers

- **Clear governance**: Know which principles, requirements, and constraints apply to each schema
- **Quality monitoring**: Automated data quality monitoring linked to schema definitions
- **Impact analysis**: Understand business impact of schema changes
- **Single source of truth**: All governance metadata in one place (schema file)

### For Business Stakeholders

- **Business traceability**: See which technical schemas implement business concepts
- **Goal validation**: Measure business goal achievement via data quality metrics
- **Compliance visibility**: Clear audit trail from business requirements to technical implementation
- **ROI measurement**: Link data quality improvements to business outcomes

### For Compliance Officers

- **Regulatory mapping**: Direct links from regulations (constraints) to data models
- **Audit readiness**: Automated compliance reporting via schema governance metadata
- **Data governance**: Provable compliance with GDPR, SOX, HIPAA requirements
- **Quality SLAs**: Measurable data quality commitments

### For Operations Teams

- **Quality monitoring**: Automated alerts when data quality degrades
- **SLA enforcement**: Data quality SLAs linked to business commitments
- **Incident response**: Understand business impact of data quality issues
- **Continuous improvement**: Track data quality trends over time

## Complete Example: Customer Schema with Full Integration

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/schemas/customer.json",
  "title": "Customer",
  "description": "Customer master data schema with full governance and quality tracking",

  "x-archimate-ref": "data-object-customer",
  "x-business-object-ref": "business-object-customer",

  "x-data-governance": {
    "governedBy": {
      "principleRefs": [
        "principle-single-source-of-truth",
        "principle-canonical-data-model",
        "principle-privacy-by-design"
      ],
      "requirementRefs": [
        "req-customer-360-view",
        "req-master-data-management",
        "req-customer-profile-completeness"
      ],
      "constraintRefs": [
        "constraint-gdpr-compliance",
        "constraint-ccpa-compliance",
        "constraint-data-quality-sla-95-percent"
      ]
    }
  },

  "x-apm-data-quality-metrics": {
    "completenessMetrics": [
      "metric-customer-email-completeness",
      "metric-customer-address-completeness",
      "metric-customer-phone-completeness",
      "metric-customer-profile-overall-completeness"
    ],
    "accuracyMetrics": [
      "metric-customer-email-validity",
      "metric-customer-phone-format-validity",
      "metric-customer-postal-code-validity"
    ],
    "consistencyMetrics": [
      "metric-customer-name-consistency",
      "metric-customer-address-standardization"
    ],
    "freshnessMetrics": ["metric-customer-last-updated-age", "metric-customer-profile-staleness"],
    "uniquenessMetrics": ["metric-customer-duplicate-rate"]
  },

  "x-database": {
    "table": "customers",
    "schema": "master_data"
  },

  "type": "object",
  "required": ["customerId", "email"],
  "properties": {
    "customerId": {
      "type": "string",
      "format": "uuid",
      "x-database": {
        "column": "customer_id",
        "type": "UUID",
        "primaryKey": true
      }
    },
    "email": {
      "type": "string",
      "format": "email",
      "x-security": {
        "pii": true,
        "classification": "restricted",
        "governedBy": {
          "constraintRefs": ["constraint-gdpr-article-6"]
        }
      }
    }
  }
}
```

**Result**: This schema demonstrates complete federated architecture integration across all 12 layers, from business motivation through technical implementation to quality measurement.

This Data Model Layer provides a comprehensive, standards-based approach to defining data structures with rich validation and cross-layer integration.
