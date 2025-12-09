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

  values:
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

## Integration Points

**For complete link patterns and validation rules**, see [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md). The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer

- **Security governance**: x-security.governedBy.constraintRefs, requirementRefs, principleRefs link field-level security policies to Motivation Layer
- **Data governance**: x-data-governance.governedBy.principleRefs, requirementRefs, constraintRefs link schema-level data architecture decisions to Motivation Layer
- **Data architecture principles**: Links schemas to principles like "principle-canonical-data-model", "principle-event-sourcing", "principle-data-normalization"
- **Data requirements**: Links schemas to requirements like "req-master-data-management", "req-audit-trail", "req-customer-360-view"
- **Data constraints**: Links schemas to constraints like "constraint-sox-compliance", "constraint-7year-retention", "constraint-no-pii-in-analytics"
- **UX principles**: x-ui.governedBy.principleRefs ensures UI rendering follows UX principles
- **Compliance traceability**: Proves data policies implement regulatory requirements at both field and schema levels
- **Separation of concerns**: x-security for security/privacy, x-data-governance for architecture/design, x-ui for user experience

### To Business Layer

- **Bidirectional traceability**:
  - BusinessObject.spec.schema-id → JSONSchema (downward documentation reference)
  - JSONSchema.x-business-object-ref → BusinessObject (upward implementation reference)
- **Business impact analysis**: Enables understanding which business concepts are affected by schema changes
- **Domain-driven design**: Links technical data models to business domain concepts
- **Complete lineage**: Business concept → Application data → Schema → Database → Metrics

### To ArchiMate Application Layer

- **Schema references DataObject**: x-archimate-ref links schema to application-level DataObject
- **Technical traceability**: Enables traceability from application components to data structures

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

### To APM/Observability Layer

- **Data quality monitoring**: x-apm-data-quality-metrics links schemas to data quality Metrics in APM Layer
- **Completeness tracking**: Monitor required field completion rates (e.g., "metric-customer-email-completeness")
- **Accuracy monitoring**: Track data validation success rates (e.g., "metric-product-price-validity")
- **Consistency monitoring**: Measure cross-field validation success (e.g., "metric-order-item-sum-matches-total")
- **Freshness tracking**: Monitor data staleness and update frequency (e.g., "metric-customer-last-updated-age")
- **Uniqueness tracking**: Detect duplicate records (e.g., "metric-customer-duplicate-rate")
- **Integrity tracking**: Monitor referential integrity (e.g., "metric-order-customer-reference-integrity")
- **Goal validation**: Links data quality metrics to business goal achievement (e.g., "goal-data-accuracy", "goal-customer-360-view")
- **SLA enforcement**: Enables data quality SLAs and compliance reporting
- **Complete traceability chain**: Goal → Data Requirement → Schema → Data Quality Metric → Outcome
- **Industry alignment**: Follows DAMA DMBOK and ISO 8000 data quality frameworks

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

10. **Link to Business Concepts**: Use x-business-object-ref to connect schemas to BusinessObject for domain-driven design traceability
11. **Business Impact Analysis**: Maintain bidirectional links (BusinessObject.spec.schema-id + JSONSchema.x-business-object-ref)
12. **Domain Modeling**: Every schema representing a business concept should reference its BusinessObject

#### Motivation Layer Integration

13. **Data Governance**: Use x-data-governance.governedBy to document data architecture principles, requirements, and constraints
14. **Separate Concerns**: Use x-security.governedBy for security/privacy, x-data-governance for architecture/design decisions
15. **Document Principles**: Reference principles like "principle-canonical-data-model", "principle-event-sourcing"
16. **Link Requirements**: Reference requirements like "req-master-data-management", "req-audit-trail"
17. **Capture Constraints**: Reference constraints like "constraint-sox-compliance", "constraint-7year-retention"

#### APM/Observability Integration

18. **Data Quality Metrics**: Use x-apm-data-quality-metrics to link schemas to data quality monitoring
19. **Completeness Metrics**: Define metrics for required field completion rates
20. **Accuracy Metrics**: Define metrics for data validation success rates
21. **Freshness Metrics**: Define metrics for data staleness (especially for master data)
22. **Integrity Metrics**: Define metrics for referential integrity (foreign keys)
23. **Goal Alignment**: Ensure data quality metrics support business goals (e.g., "goal-customer-360-view")

#### Security & UI Integration

24. **Security Metadata**: Always include x-security for sensitive data
25. **UI Rendering**: Use x-ui.group for logical grouping and x-ui.component for field types
26. **Database Mapping**: Use x-database for persistence layer mapping

### Data Quality Best Practices

27. **Measure What Matters**: Focus on quality dimensions that impact business goals
28. **Start with Critical Data**: Implement quality metrics for master data and high-value entities first
29. **Progressive Enhancement**: Begin with completeness/accuracy, add consistency/freshness/integrity as you mature
30. **Industry Standards**: Follow DAMA DMBOK data quality dimensions (completeness, accuracy, consistency, timeliness, uniqueness, integrity)

### Traceability Best Practices

31. **Complete Chain**: Maintain Goal → Requirement → Schema → Metric → Outcome traceability
32. **Upward References**: Schemas reference their purpose (BusinessObject, Principles, Metrics) following the link philosophy
33. **Bidirectional Queries**: Use upward references for maintenance, enable downward queries through tooling

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
