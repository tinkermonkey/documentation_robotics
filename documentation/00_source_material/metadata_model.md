## **Federated Architecture Metadata Model**

This is the "data model of the data models" - showing all entity types, their attributes, and cross-references across all layers.

---

## **1. ArchiMate Layer (Spine)**

### **Entity: ArchiMateModel**
```yaml
ArchiMateModel:
  attributes:
    id: string (UUID)
    name: string
    version: string
    xmlns: string (namespace URI)
    created: datetime
    modified: datetime
  
  contains:
    - elements: Element[] (1..*)
    - relationships: Relationship[] (0..*)
    - views: View[] (0..*)
    - propertyDefinitions: PropertyDefinition[] (0..*)
```

### **Entity: Element**
```yaml
Element:
  attributes:
    id: string (UUID) [PK]
    type: ElementType [enum]
    name: string
    documentation: string (optional)
    layer: Layer [enum]
  
  contains:
    - properties: Property[] (0..*)
  
  references:
    - parentElement: Element.id (optional, for composition)
  
  enums:
    ElementType:
      # Business Layer
      - BusinessActor
      - BusinessRole
      - BusinessCollaboration
      - BusinessInterface
      - BusinessProcess
      - BusinessFunction
      - BusinessInteraction
      - BusinessEvent
      - BusinessService
      - BusinessObject
      - Contract
      - Representation
      - Product
      
      # Application Layer
      - ApplicationComponent
      - ApplicationCollaboration
      - ApplicationInterface
      - ApplicationFunction
      - ApplicationInteraction
      - ApplicationProcess
      - ApplicationEvent
      - ApplicationService
      - DataObject
      
      # Technology Layer
      - Node
      - Device
      - SystemSoftware
      - TechnologyCollaboration
      - TechnologyInterface
      - Path
      - CommunicationNetwork
      - TechnologyFunction
      - TechnologyProcess
      - TechnologyInteraction
      - TechnologyEvent
      - TechnologyService
      - Artifact
      
      # Motivation Layer
      - Stakeholder
      - Driver
      - Assessment
      - Goal
      - Outcome
      - Principle
      - Requirement
      - Constraint
      - Meaning
      - Value
    
    Layer:
      - Business
      - Application
      - Technology
      - Motivation
      - Strategy
      - Physical
      - Implementation
```

### **Entity: Relationship**
```yaml
Relationship:
  attributes:
    id: string (UUID) [PK]
    type: RelationshipType [enum]
    source: string [FK -> Element.id]
    target: string [FK -> Element.id]
    name: string (optional)
    documentation: string (optional)
  
  contains:
    - properties: Property[] (0..*)
  
  enums:
    RelationshipType:
      # Structural
      - Composition
      - Aggregation
      - Assignment
      - Realization
      
      # Dependency
      - Serving
      - Access
      - Influence
      - Association
      
      # Dynamic
      - Triggering
      - Flow
      
      # Other
      - Specialization
      - Junction
```

### **Entity: Property**
```yaml
Property:
  attributes:
    key: string [references PropertyDefinition.key]
    value: string
    type: PropertyType [enum]
  
  enums:
    PropertyType:
      - string
      - integer
      - boolean
      - float
      - enum
      - reference (to another entity)
      - fileReference (path to external spec)
```

### **Entity: PropertyDefinition**
```yaml
PropertyDefinition:
  attributes:
    key: string [PK] (e.g., "spec.openapi")
    name: string
    description: string
    type: PropertyType
    required: boolean
    defaultValue: string (optional)
    enumValues: string[] (if type=enum)
    pattern: string (regex, optional)
    
  # Standard property definitions for federation
  standardProperties:
    - key: "spec.openapi"
      type: fileReference
      description: "Path to OpenAPI specification"
    
    - key: "spec.schema"
      type: fileReference
      description: "Path to JSON Schema"
    
    - key: "spec.ux"
      type: fileReference
      description: "Path to UX specification"
    
    - key: "spec.navigation"
      type: fileReference
      description: "Path to navigation specification"
    
    - key: "spec.database"
      type: fileReference
      description: "Path to database DDL"
    
    - key: "spec.security"
      type: fileReference
      description: "Path to security specification"
    
    - key: "implementation.framework"
      type: enum
      enumValues: [react, vue, angular, svelte]
```

---

## **2. API Layer (OpenAPI)**

### **Entity: OpenAPISpec**
```yaml
OpenAPISpec:
  attributes:
    openapi: string (version, e.g., "3.0.0")
    title: string
    version: string
    description: string (optional)
    termsOfService: string (optional)
    
  contains:
    - servers: Server[] (0..*)
    - paths: PathItem[] (1..*)
    - components: Components (0..1)
    - security: SecurityRequirement[] (0..*)
    - tags: Tag[] (0..*)
  
  references:
    - archimateElement: Element.id [where Element.type = ApplicationService]
```

### **Entity: PathItem**
```yaml
PathItem:
  attributes:
    path: string [PK] (e.g., "/api/products/{id}")
    summary: string (optional)
    description: string (optional)
  
  contains:
    - operations: Operation[] (1..*) [keyed by HTTP method]
  
  enums:
    HttpMethod:
      - get
      - post
      - put
      - patch
      - delete
      - options
      - head
```

### **Entity: Operation**
```yaml
Operation:
  attributes:
    operationId: string [PK]
    method: HttpMethod
    summary: string (optional)
    description: string (optional)
    deprecated: boolean (default: false)
  
  contains:
    - parameters: Parameter[] (0..*)
    - requestBody: RequestBody (0..1)
    - responses: Response[] (1..*) [keyed by status code]
    - security: SecurityRequirement[] (0..*)
  
  references:
    - dataSchema: Schema.name [in components.schemas]
    - archimateElement: Element.id (optional, for traceability)
```

### **Entity: Parameter**
```yaml
Parameter:
  attributes:
    name: string [PK within operation]
    in: ParameterLocation [enum]
    required: boolean
    description: string (optional)
    deprecated: boolean (default: false)
  
  contains:
    - schema: Schema (1..1)
  
  enums:
    ParameterLocation:
      - path
      - query
      - header
      - cookie
```

### **Entity: RequestBody**
```yaml
RequestBody:
  attributes:
    required: boolean (default: false)
    description: string (optional)
  
  contains:
    - content: MediaType[] (1..*) [keyed by content-type]
```

### **Entity: Response**
```yaml
Response:
  attributes:
    statusCode: string [PK] (e.g., "200", "404")
    description: string
  
  contains:
    - headers: Header[] (0..*)
    - content: MediaType[] (0..*) [keyed by content-type]
```

### **Entity: MediaType**
```yaml
MediaType:
  attributes:
    contentType: string (e.g., "application/json")
  
  contains:
    - schema: Schema (1..1)
  
  references:
    - schemaRef: string (e.g., "product-schema.json#/definitions/Product")
```

### **Entity: Components**
```yaml
Components:
  contains:
    - schemas: Schema[] [keyed by name]
    - responses: Response[] [keyed by name]
    - parameters: Parameter[] [keyed by name]
    - requestBodies: RequestBody[] [keyed by name]
    - securitySchemes: SecurityScheme[] [keyed by name]
```

### **Entity: SecurityScheme**
```yaml
SecurityScheme:
  attributes:
    name: string [PK]
    type: SecuritySchemeType [enum]
    description: string (optional)
    scheme: string (e.g., "bearer", for http type)
    bearerFormat: string (e.g., "JWT", optional)
    in: ParameterLocation (for apiKey type)
    openIdConnectUrl: string (for openIdConnect type)
  
  enums:
    SecuritySchemeType:
      - apiKey
      - http
      - oauth2
      - openIdConnect
```

---

## **3. Data Model Layer (JSON Schema)**

### **Entity: JSONSchema**
```yaml
JSONSchema:
  attributes:
    $schema: string (schema version URI)
    $id: string (schema identifier URI, optional)
    title: string (optional)
    description: string (optional)
  
  contains:
    - definitions: SchemaDefinition[] (0..*) [keyed by name]
  
  references:
    - archimateElement: Element.id [where Element.type = DataObject]
```

### **Entity: SchemaDefinition**
```yaml
SchemaDefinition:
  attributes:
    name: string [PK within schema]
    type: JSONType [enum]
    title: string (optional)
    description: string (optional)
    default: any (optional)
    
  # Validation keywords
  constraints:
    # String
    - minLength: integer (optional)
    - maxLength: integer (optional)
    - pattern: string (regex, optional)
    - format: string (e.g., "email", "date-time", optional)
    
    # Numeric
    - minimum: number (optional)
    - maximum: number (optional)
    - exclusiveMinimum: boolean (optional)
    - exclusiveMaximum: boolean (optional)
    - multipleOf: number (optional)
    
    # Array
    - minItems: integer (optional)
    - maxItems: integer (optional)
    - uniqueItems: boolean (optional)
    
    # Object
    - required: string[] (property names)
    - additionalProperties: boolean | Schema (optional)
    - minProperties: integer (optional)
    - maxProperties: integer (optional)
  
  contains:
    - properties: SchemaProperty[] (if type=object)
    - items: Schema (if type=array)
    - enum: any[] (if enumerated values)
    
    # Custom extensions
    - x-database: DatabaseMapping (optional)
    - x-ui: UIMapping (optional)
    - x-security: SecurityMapping (optional)
  
  enums:
    JSONType:
      - string
      - number
      - integer
      - boolean
      - object
      - array
      - "null"
```

### **Entity: SchemaProperty**
```yaml
SchemaProperty:
  attributes:
    name: string [PK within object schema]
    schema: Schema (1..1)
  
  references:
    - $ref: string (reference to another schema)
```

### **Entity: DatabaseMapping** (x-database extension)
```yaml
DatabaseMapping:
  attributes:
    table: string
    schema: string (optional, e.g., "public")
  
  contains:
    - columns: ColumnMapping[] (keyed by property name)
    - indexes: Index[] (optional)
    - constraints: Constraint[] (optional)
```

### **Entity: ColumnMapping**
```yaml
ColumnMapping:
  attributes:
    propertyName: string [PK]
    columnName: string
    type: SQLType [enum]
    nullable: boolean (default: true)
    primaryKey: boolean (default: false)
    autoIncrement: boolean (default: false)
    unique: boolean (default: false)
    default: string (optional)
  
  references:
    - foreignKey: ForeignKey (optional)
  
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
```

### **Entity: ForeignKey**
```yaml
ForeignKey:
  attributes:
    table: string
    column: string
    onDelete: ReferentialAction [enum]
    onUpdate: ReferentialAction [enum]
  
  enums:
    ReferentialAction:
      - CASCADE
      - SET_NULL
      - RESTRICT
      - NO_ACTION
      - SET_DEFAULT
```

### **Entity: Index**
```yaml
Index:
  attributes:
    name: string [PK]
    columns: string[] (column names)
    unique: boolean (default: false)
    type: IndexType [enum]
  
  enums:
    IndexType:
      - BTREE
      - HASH
      - GIN
      - GIST
```

### **Entity: UIMapping** (x-ui extension)
```yaml
UIMapping:
  contains:
    - fieldMappings: FieldUIMapping[] (keyed by property name)
```

### **Entity: FieldUIMapping**
```yaml
FieldUIMapping:
  attributes:
    propertyName: string [PK]
    component: UIComponent [enum]
    label: string
    placeholder: string (optional)
    helpText: string (optional)
    readOnly: boolean (default: false)
    hidden: boolean (default: false)
  
  references:
    - dataSource: string (API endpoint, optional)
    - dependsOn: string[] (property names, optional)
  
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
      - checkbox
      - radio-group
      - file-upload
      - rich-text-editor
      - color-picker
```

---

## **4. UX Layer (Custom Spec)**

### **Entity: UXSpec**
```yaml
UXSpec:
  attributes:
    version: string (spec version)
    screen: string (screen identifier)
  
  contains:
    - states: ScreenState[] (1..*)
    - layout: ScreenLayout (1..1)
  
  references:
    - archimateElement: Element.id [where Element.type = ApplicationComponent]
    - dataSchema: string (path to JSON Schema)
```

### **Entity: ScreenState**
```yaml
ScreenState:
  attributes:
    name: string [PK within spec]
    initial: boolean (default: false)
    description: string (optional)
  
  contains:
    - onEnter: StateAction[] (0..*)
    - onExit: StateAction[] (0..*)
    - transitions: StateTransition[] (0..*)
```

### **Entity: StateAction**
```yaml
StateAction:
  attributes:
    action: ActionType [enum]
    description: string (optional)
  
  references:
    - api: string (operationId from OpenAPI)
    - apiRef: Element.id [where Element.type = ApplicationService]
    - dataPath: string (JSONPath expression, optional)
  
  enums:
    ActionType:
      - fetchData
      - saveData
      - deleteData
      - validateForm
      - showNotification
      - navigateTo
      - resetForm
      - callAPI
```

### **Entity: StateTransition**
```yaml
StateTransition:
  attributes:
    to: string [FK -> ScreenState.name]
    on: TriggerType [enum]
    description: string (optional)
  
  contains:
    - condition: Condition (optional)
    - validate: boolean (default: false)
  
  enums:
    TriggerType:
      - success
      - failure
      - submit
      - cancel
      - click
      - timeout
      - custom
```

### **Entity: Condition**
```yaml
Condition:
  attributes:
    expression: string (boolean expression)
    description: string (optional)
  
  # Expression syntax examples:
  # - "data.status === 'draft'"
  # - "form.isValid && user.hasPermission"
  # - "items.length > 0"
```

### **Entity: ScreenLayout**
```yaml
ScreenLayout:
  attributes:
    type: LayoutType [enum]
    title: string (optional)
    description: string (optional)
  
  contains:
    - sections: LayoutSection[] (0..*)
    - fields: FieldDefinition[] (0..*)
    - actions: ActionButton[] (0..*)
  
  enums:
    LayoutType:
      - form
      - list
      - detail
      - dashboard
      - wizard
      - custom
```

### **Entity: LayoutSection**
```yaml
LayoutSection:
  attributes:
    name: string [PK within layout]
    title: string
    collapsible: boolean (default: false)
    collapsed: boolean (default: false)
    columns: integer (default: 1)
  
  contains:
    - fields: FieldDefinition[] (0..*)
```

### **Entity: FieldDefinition**
```yaml
FieldDefinition:
  attributes:
    name: string [PK within layout]
    required: boolean (default: false)
    readonly: boolean (default: false)
    hidden: boolean (default: false)
  
  references:
    - schemaRef: string (JSONPath to property in JSON Schema)
    # e.g., "product-schema.json#/definitions/Product/properties/name"
  
  contains:
    - conditionalDisplay: Condition (optional)
```

### **Entity: ActionButton**
```yaml
ActionButton:
  attributes:
    name: string [PK within layout]
    label: string
    type: ButtonType [enum]
    icon: string (optional)
    disabled: boolean (default: false)
  
  contains:
    - action: StateAction (1..1)
    - confirmationPrompt: string (optional)
  
  enums:
    ButtonType:
      - primary
      - secondary
      - danger
      - link
```

---

## **5. Navigation Layer (Custom Spec)**

### **Entity: NavigationGraph**
```yaml
NavigationGraph:
  contains:
    - routes: Route[] (1..*)
    - transitions: NavigationTransition[] (0..*)
    - guards: NavigationGuard[] (0..*)
```

### **Entity: Route**
```yaml
Route:
  attributes:
    path: string [PK] (e.g., "/products/:id")
    screen: string (screen identifier)
    title: string (optional)
    description: string (optional)
  
  contains:
    - params: RouteParam[] (0..*)
    - queryParams: QueryParam[] (0..*)
  
  references:
    - archimateRef: Element.id [ApplicationComponent]
    - uxSpec: string (path to UX spec)
    - guards: NavigationGuard.name[] (optional)
```

### **Entity: RouteParam**
```yaml
RouteParam:
  attributes:
    name: string [PK within route]
    type: ParamType [enum]
    required: boolean (default: true)
    pattern: string (regex, optional)
  
  enums:
    ParamType:
      - string
      - integer
      - uuid
```

### **Entity: QueryParam**
```yaml
QueryParam:
  attributes:
    name: string [PK within route]
    type: ParamType
    required: boolean (default: false)
    default: string (optional)
```

### **Entity: NavigationTransition**
```yaml
NavigationTransition:
  attributes:
    from: string [FK -> Route.path]
    to: string [FK -> Route.path]
    trigger: NavigationTrigger [enum]
    element: string (optional, UI element name)
    description: string (optional)
  
  contains:
    - paramMapping: ParamMapping[] (0..*)
  
  enums:
    NavigationTrigger:
      - click
      - submit
      - success
      - cancel
      - automatic
```

### **Entity: ParamMapping**
```yaml
ParamMapping:
  attributes:
    sourceParam: string
    targetParam: string
    transform: string (optional, transformation expression)
```

### **Entity: NavigationGuard**
```yaml
NavigationGuard:
  attributes:
    name: string [PK]
    type: GuardType [enum]
    description: string (optional)
  
  contains:
    - condition: Condition (1..1)
    - redirectTo: string (route path, if condition fails)
  
  enums:
    GuardType:
      - authentication
      - authorization
      - validation
      - custom
```

---

## **6. Security Layer (Custom Spec)**

### **Entity: SecurityModel**
```yaml
SecurityModel:
  contains:
    - roles: Role[] (1..*)
    - permissions: Permission[] (0..*)
    - resources: SecureResource[] (1..*)
    - policies: SecurityPolicy[] (0..*)
```

### **Entity: Role**
```yaml
Role:
  attributes:
    name: string [PK]
    description: string (optional)
    inheritsFrom: string[] (role names, optional)
  
  references:
    - permissions: Permission.name[] (0..*)
```

### **Entity: Permission**
```yaml
Permission:
  attributes:
    name: string [PK] (e.g., "product.create", "user.read")
    description: string (optional)
    scope: PermissionScope [enum]
  
  enums:
    PermissionScope:
      - global
      - resource
      - attribute
```

### **Entity: SecureResource**
```yaml
SecureResource:
  attributes:
    resource: string [PK] (resource identifier)
    type: ResourceType [enum]
    description: string (optional)
  
  contains:
    - operations: ResourceOperation[] (1..*)
  
  references:
    - archimateRef: Element.id
  
  enums:
    ResourceType:
      - api
      - screen
      - data
      - file
```

### **Entity: ResourceOperation**
```yaml
ResourceOperation:
  attributes:
    operation: string [PK within resource] (e.g., "getProduct", "updateProduct")
    description: string (optional)
  
  references:
    - allowRoles: Role.name[] (0..*)
    - denyRoles: Role.name[] (0..*)
  
  contains:
    - conditions: AccessCondition[] (0..*)
    - fieldAccess: FieldAccessControl[] (0..*)
```

### **Entity: AccessCondition**
```yaml
AccessCondition:
  attributes:
    field: string (data field path)
    operator: ConditionOperator [enum]
    value: string
    message: string (optional, error message)
  
  enums:
    ConditionOperator:
      - equals
      - notEquals
      - in
      - notIn
      - greaterThan
      - lessThan
      - contains
      - matches (regex)
```

### **Entity: FieldAccessControl**
```yaml
FieldAccessControl:
  attributes:
    field: string [PK within operation]
    read: boolean (default: true)
    write: boolean (default: true)
  
  references:
    - allowRoles: Role.name[] (optional)
    - denyRoles: Role.name[] (optional)
  
  contains:
    - conditions: AccessCondition[] (0..*)
```

### **Entity: SecurityPolicy**
```yaml
SecurityPolicy:
  attributes:
    name: string [PK]
    description: string (optional)
    enabled: boolean (default: true)
  
  contains:
    - rules: PolicyRule[] (1..*)
```

### **Entity: PolicyRule**
```yaml
PolicyRule:
  attributes:
    condition: Condition (1..1)
    effect: PolicyEffect [enum]
    message: string (optional)
  
  enums:
    PolicyEffect:
      - allow
      - deny
      - audit
```

---

## **7. Technology/Data Store Layer**

### **Entity: DatabaseDefinition**
```yaml
DatabaseDefinition:
  attributes:
    name: string [PK]
    type: DatabaseType [enum]
    version: string (optional)
  
  contains:
    - schemas: DatabaseSchema[] (0..*)
  
  references:
    - archimateRef: Element.id [where Element.type = Artifact or Node]
  
  enums:
    DatabaseType:
      - PostgreSQL
      - MySQL
      - SQLite
      - MongoDB
      - Redis
      - Elasticsearch
```

### **Entity: DatabaseSchema**
```yaml
DatabaseSchema:
  attributes:
    name: string [PK within database]
  
  contains:
    - tables: Table[] (0..*)
    - views: View[] (0..*)
```

### **Entity: Table**
```yaml
Table:
  attributes:
    name: string [PK within schema]
  
  contains:
    - columns: Column[] (1..*)
    - constraints: TableConstraint[] (0..*)
    - indexes: Index[] (0..*)
  
  references:
    - jsonSchema: string (path to JSON Schema that defines this table)
```

### **Entity: Column**
```yaml
Column:
  attributes:
    name: string [PK within table]
    type: SQLType
    nullable: boolean (default: true)
    defaultValue: string (optional)
  
  references:
    - schemaProperty: string (JSONPath to property in JSON Schema)
```

### **Entity: TableConstraint**
```yaml
TableConstraint:
  attributes:
    name: string [PK within table]
    type: ConstraintType [enum]
  
  contains:
    - columns: string[] (column names)
  
  references:
    - foreignKey: ForeignKey (if type=FOREIGN_KEY)
  
  enums:
    ConstraintType:
      - PRIMARY_KEY
      - UNIQUE
      - FOREIGN_KEY
      - CHECK
```

---

## **Cross-Reference Metadata**

### **Entity: CrossReference**
```yaml
CrossReference:
  attributes:
    sourceType: EntityType [enum]
    sourceId: string
    targetType: EntityType [enum]
    targetId: string
    referenceType: ReferenceType [enum]
    valid: boolean (validation result)
    lastChecked: datetime
  
  enums:
    EntityType:
      - ArchiMateElement
      - OpenAPIOperation
      - JSONSchema
      - UXSpec
      - Route
      - SecureResource
      - Table
    
    ReferenceType:
      - specReference (ArchiMate property points to spec file)
      - schemaReference (OpenAPI $ref to JSON Schema)
      - archimateReference (spec references ArchiMate element)
      - dataReference (UI field references schema property)
      - apiReference (state action references API operation)
```

---

## **Master Entity Relationship Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│                    ARCHIMATE LAYER (SPINE)                  │
│                                                              │
│  ArchiMateModel                                             │
│    │                                                         │
│    ├──> Element [id, type, name, layer]                    │
│    │      │                                                  │
│    │      ├──> Property [key, value, type]                 │
│    │      │      └──ref──> PropertyDefinition             │
│    │      │                                                  │
│    │      └──spec.openapi──────────┐                       │
│    │      └──spec.schema───────────┤                       │
│    │      └──spec.ux───────────────┤                       │
│    │      └──spec.navigation───────┤                       │
│    │      └──spec.security─────────┤                       │
│    │                                │                        │
│    └──> Relationship [source, target, type]                │
│                                     │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      │
        ┌─────────────────────────────┼──────────────────┐
        │                             │                   │
        ▼                             ▼                   ▼
┌──────────────┐            ┌──────────────┐    ┌──────────────┐
│  API LAYER   │            │ DATA LAYER   │    │  UX LAYER    │
│              │            │              │    │              │
│ OpenAPISpec  │            │ JSONSchema   │    │ UXSpec       │
│   │          │            │   │          │    │   │          │
│   ├─>PathItem│            │   ├─>Schema  │    │   ├─>State   │
│   │   │      │            │   │  Def.    │    │   │   │      │
│   │   └─>Op  │◄───$ref────┤   │   │      │◄───┤   │   └─>Tr  │
│   │      │   │            │   │   ├─>x-db│    │   │   ansition
│   │      └──>│Param       │   │   │  Map │    │   │          │
│   │          │            │   │   └─>x-ui│    │   └─>Layout  │
│   └─>Comp    │            │   │     Map  │────┤      │       │
│      onents  │            │   │          │    │      └─>Field│
│              │            │   │          │    │              │
└──────────────┘            └──────────────┘    └──────────────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │ DATA STORE   │
                            │              │
                            │ Database     │
                            │   │          │
                            │   ├─>Table   │
                            │   │   │      │
                            │   │   └─>Col │
                            │   │          │
                            │   └─>Constr  │
                            │              │
                            └──────────────┘

┌──────────────┐            ┌──────────────┐
│ NAVIGATION   │            │  SECURITY    │
│              │            │              │
│ Navigation   │            │ Security     │
│  Graph       │            │  Model       │
│   │          │            │   │          │
│   ├─>Route   │            │   ├─>Role    │
│   │   │      │            │   ├─>Perm    │
│   │   └─>Prm │            │   └─>Sec     │
│   │          │            │      Resource│
│   └─>Nav     │            │        │     │
│      Trans   │            │        └─>Op │
│              │            │              │
└──────────────┘            └──────────────┘
```

---

## **Summary Statistics**

```yaml
Total Entity Types: 58

By Layer:
  - ArchiMate: 7 entities
  - OpenAPI: 12 entities
  - JSON Schema: 10 entities
  - UX: 10 entities
  - Navigation: 6 entities
  - Security: 10 entities
  - Data Store: 6 entities
  - Cross-Reference: 1 entity

Total Attributes: ~350

Total Enums: 28

Cross-Layer References: 47
```

---

This metadata model is your "rosetta stone" - it defines exactly what data exists in each layer, what it looks like, and how it connects. You can use this to:

1. **Validate** your federated architecture
2. **Generate** tooling (parsers, validators, code generators)
3. **Document** your system's information architecture
4. **Query** across layers (e.g., "Find all API operations that access this data object")