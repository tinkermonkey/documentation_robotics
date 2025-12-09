# Layer 3: Security Layer

Defines authentication, authorization, access control, data classification, and security policies including STS-ml concepts for goal-oriented security modeling.

## Overview

The Security Layer defines authentication, authorization, access control, and security policies for the application. This is a **custom specification** as no single standard addresses the full spectrum of application security concerns including RBAC, ABAC, field-level security, and policy-based access control.

**Version 2.0 Enhancement**: This specification has been enhanced with concepts from the Socio-Technical Security Modeling Language (STS-ml), adding actor objectives, delegation chains, security patterns (separation/binding of duty), social dependencies, accountability requirements, and integrated threat modeling.

**Layer Integration**: Security Layer integrates with Motivation Layer for requirements (WHY) and Business Layer for actors (WHO), ensuring single source of truth and proper traceability from business goals to security controls.

## Layer Characteristics

- **Standard**: Custom Specification (YAML format)
- **Custom Extensions**: Complete custom specification
- **Validation**: Custom JSON Schema validator
- **Tooling**: Custom validation, policy enforcement, audit logging

## Why Custom?

No existing standard comprehensively covers:

- **RBAC**: Role-Based Access Control
- **ABAC**: Attribute-Based Access Control
- **Field-level Security**: Granular data access control
- **Policy as Code**: Declarative security policies
- **OAuth/OIDC**: Authentication integration
- **Data Classification**: PII, encryption, retention
- **STS-ml Concepts**: Goal-oriented security, delegation, security patterns

Our Security spec provides:

1. Role and permission definitions
2. Resource-level access control
3. Field-level access control
4. Policy-based rules
5. Data classification and protection
6. Audit requirements
7. **Actor modeling with goals** (STS-ml inspired)
8. **Information flow rights** (produce, read, modify, distribute)
9. **Explicit delegation chains** with constraints
10. **Security patterns** (separation/binding of duty, need-to-know)
11. **Social dependencies** and trust relationships
12. **Accountability requirements** with non-repudiation
13. **Threat modeling** with countermeasures and security requirements

## Entity Definitions

### SecurityModel

```yaml
SecurityModel:
  description: "Complete security model for application"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (spec version)
    application: string (application identifier)

  contains:
    - authentication: AuthenticationConfig[] (1..1)
    - actors: Actor[] (0..*) # STS-ml inspired
    - roles: Role[] (1..*)
    - permissions: Permission[] (0..*)
    - resources: SecureResource[] (1..*)
    - informationEntities: InformationEntity[] (0..*) # STS-ml inspired
    - delegations: Delegation[] (0..*) # STS-ml inspired
    - securityConstraints: SecurityConstraints[] (0..1) # STS-ml inspired
    - policies: SecurityPolicy[] (0..*)
    - dataClassification: DataClassification[] (1..1)
    - socialDependencies: SocialDependency[] (0..*) # STS-ml inspired
    - accountability: AccountabilityRequirement[] (0..*) # STS-ml inspired
    - threats: Threat[] (0..*) # STS-ml inspired

  references:
    - archimateElement: Element.id (ApplicationComponent)
```

### AuthenticationConfig

```yaml
AuthenticationConfig:
  description: "Authentication configuration"
  attributes:
    id: string (UUID) [PK]
    name: string
    provider: AuthProvider [enum]
    sessionTimeout: integer (minutes)
    mfaRequired: boolean (optional) # default: false
    passwordPolicy: PasswordPolicy (optional)

  enums:
    AuthProvider:
      - oauth2
      - openid-connect
      - saml
      - jwt
      - session
      - api-key
      - certificate

  examples:
    - # OAuth2 with MFA
      provider: oauth2
      sessionTimeout: 30
      mfaRequired: true
      oauth2:
        authorizationUrl: "https://auth.example.com/authorize"
        tokenUrl: "https://auth.example.com/token"
        userInfoUrl: "https://auth.example.com/userinfo"
        clientId: "app-client-id"
        scopes: ["openid", "profile", "email"]

    - # JWT
      provider: jwt
      sessionTimeout: 60
      jwt:
        issuer: "https://auth.example.com"
        audience: "product-api"
        algorithm: "RS256"
        publicKeyUrl: "https://auth.example.com/.well-known/jwks.json"
```

### PasswordPolicy

```yaml
PasswordPolicy:
  description: "Password requirements"
  attributes:
    id: string (UUID) [PK]
    name: string
    minLength: integer (optional) # default: 8
    maxLength: integer (optional)
    requireUppercase: boolean (optional) # default: true
    requireLowercase: boolean (optional) # default: true
    requireNumbers: boolean (optional) # default: true
    requireSpecialChars: boolean (optional) # default: true
    preventReuse: integer (optional) # default: 5
    expiryDays: integer (password expiration, optional)
    lockoutAttempts: integer (optional) # default: 5
    lockoutDuration: integer (optional) # default: 30

  example:
    minLength: 12
    requireUppercase: true
    requireLowercase: true
    requireNumbers: true
    requireSpecialChars: true
    preventReuse: 10
    expiryDays: 90
    lockoutAttempts: 3
    lockoutDuration: 60
```

### Role

```yaml
Role:
  description: "User role definition"
  attributes:
    id: string (UUID) [PK]
    name: string
    displayName: string
    description: string (optional)
    level: integer (hierarchy level, optional)
    inheritsFrom: string[] (parent role names, optional)

  contains:
    - permissions: Permission[] (0..*)

  metadata:
    isSystemRole: boolean (optional) # default: false
    assignable: boolean (optional) # can be assigned to users, default: true

  examples:
    # Admin role
    - name: "admin"
      displayName: "Administrator"
      description: "Full system access"
      level: 100
      permissions:
        - "product.*"
        - "user.*"
        - "system.*"
      isSystemRole: true

    # Editor role
    - name: "editor"
      displayName: "Editor"
      description: "Can create and edit content"
      level: 50
      inheritsFrom: ["viewer"]
      permissions:
        - "product.create"
        - "product.update"
        - "product.delete"

    # Viewer role
    - name: "viewer"
      displayName: "Viewer"
      description: "Read-only access"
      level: 10
      permissions:
        - "product.read"
        - "category.read"

    # Custom role
    - name: "product-manager"
      displayName: "Product Manager"
      level: 70
      inheritsFrom: ["editor"]
      permissions:
        - "product.*"
        - "category.*"
        - "analytics.read"
```

### Permission

```yaml
Permission:
  description: "Permission definition"
  attributes:
    name: string [PK]
    id: string (UUID) [PK] # format: "resource.action" or "resource.*"
    description: string (optional)
    scope: PermissionScope [enum]
    resource: string (resource type)
    action: string (action type)

  enums:
    PermissionScope:
      - global # Applies to all instances
      - resource # Applies to specific resource instances
      - attribute # Applies to specific attributes/fields
      - owner # Applies to owned resources only

  examples:
    # Global permissions
    - name: "product.read"
      description: "Read product information"
      scope: global
      resource: "product"
      action: "read"

    - name: "product.create"
      description: "Create new products"
      scope: global
      resource: "product"
      action: "create"

    # Wildcard permission
    - name: "product.*"
      description: "All product operations"
      scope: global
      resource: "product"
      action: "*"

    # Owner-scoped permission
    - name: "product.update.own"
      description: "Update own products"
      scope: owner
      resource: "product"
      action: "update"

    # Attribute-level permission
    - name: "product.read.price"
      description: "View product price"
      scope: attribute
      resource: "product"
      action: "read"
```

### SecureResource

```yaml
SecureResource:
  description: "Protected resource definition"
  attributes:
    resource: string [PK]
    id: string (UUID) [PK]
    name: string (resource identifier)
    type: ResourceType [enum]
    description: string (optional)

  contains:
    - operations: ResourceOperation[] (1..*)
    - fieldAccess: FieldAccessControl[] (0..*)

  references:
    - archimateRef: Element.id (ApplicationService, DataObject, etc.)
    - apiOperations: string[] (OpenAPI operationIds, optional)

  enums:
    ResourceType:
      - api # API endpoint
      - screen # UI screen/component
      - data # Data object
      - file # File/document
      - service # Backend service

  examples:
    # API resource
    - resource: "product-api"
      type: api
      description: "Product management API"
      archimateRef: "app-service-product-api"
      operations:
        - operation: "listProducts"
          allowRoles: ["viewer", "editor", "admin"]
        - operation: "getProduct"
          allowRoles: ["viewer", "editor", "admin"]
        - operation: "createProduct"
          allowRoles: ["editor", "admin"]
        - operation: "updateProduct"
          allowRoles: ["editor", "admin"]
        - operation: "deleteProduct"
          allowRoles: ["admin"]

    # Data resource
    - resource: "product"
      type: data
      description: "Product data object"
      archimateRef: "data-object-product"
      operations:
        - operation: "read"
          allowRoles: ["viewer", "editor", "admin"]
        - operation: "write"
          allowRoles: ["editor", "admin"]
      fieldAccess:
        - field: "price"
          read:
            allowRoles: ["editor", "admin"]
          write:
            allowRoles: ["admin"]
        - field: "cost"
          read:
            allowRoles: ["admin"]
          write:
            allowRoles: ["admin"]

    # Screen resource
    - resource: "product-edit-screen"
      type: screen
      description: "Product edit screen"
      archimateRef: "app-comp-product-edit-ui"
      operations:
        - operation: "access"
          allowRoles: ["editor", "admin"]
```

### ResourceOperation

```yaml
ResourceOperation:
  description: "Operation on a resource"
  attributes:
    id: string (UUID) [PK]
    name: string
    operation: string [PK within resource]
    description: string (optional)

  authorization:
    allowRoles: string[] (role names, optional)
    denyRoles: string[] (role names, optional)
    allowPermissions: string[] (permission names, optional)
    requireAll: boolean (optional) # require all permissions, default: false

  contains:
    - conditions: AccessCondition[] (0..*) # Additional conditions
    - rateLimit: RateLimit[] (0..1)
    - audit: AuditConfig[] (0..1)

  examples:
    # Simple role-based
    - operation: "updateProduct"
      allowRoles: ["editor", "admin"]
      audit:
        enabled: true
        level: "info"

    # Permission-based with conditions
    - operation: "deleteProduct"
      allowPermissions: ["product.delete"]
      conditions:
        - field: "status"
          operator: "notEquals"
          value: "published"
          message: "Cannot delete published products"
      audit:
        enabled: true
        level: "warning"

    # Owner-based access
    - operation: "updateProduct"
      conditions:
        - field: "ownerId"
          operator: "equals"
          value: "{{ user.id }}"
          message: "Can only update own products"
      audit:
        enabled: true
```

### AccessCondition

```yaml
AccessCondition:
  description: "Conditional access rule"
  attributes:
    id: string (UUID) [PK]
    name: string
    field: string (field path in resource)
    operator: ConditionOperator [enum]
    value: any (comparison value, can include templates)
    message: string (error message, optional)
    source: DataSource [enum] (where to get comparison value)

  enums:
    ConditionOperator:
      - equals
      - notEquals
      - in
      - notIn
      - greaterThan
      - lessThan
      - greaterThanOrEqual
      - lessThanOrEqual
      - contains
      - notContains
      - startsWith
      - endsWith
      - matches # Regex match
      - exists
      - notExists

    DataSource:
      - constant # Static value
      - user-attribute # From authenticated user
      - resource-field # From resource being accessed
      - context # From request context
      - computed # Computed value

  examples:
    # Owner check
    - field: "ownerId"
      operator: "equals"
      value: "{{ user.id }}"
      source: user-attribute
      message: "You can only access your own resources"

    # Status check
    - field: "status"
      operator: "in"
      value: ["draft", "review"]
      source: constant
      message: "Can only edit draft or review items"

    # Date check
    - field: "publishDate"
      operator: "greaterThan"
      value: "{{ now() }}"
      source: computed
      message: "Cannot edit published content"

    # Region check
    - field: "region"
      operator: "in"
      value: "{{ user.allowedRegions }}"
      source: user-attribute
      message: "You don't have access to this region"
```

### FieldAccessControl

```yaml
FieldAccessControl:
  description: "Field-level access control"
  attributes:
    id: string (UUID) [PK]
    name: string
    field: string [PK within resource]
    description: string (optional)

  read:
    allowRoles: string[] (optional)
    denyRoles: string[] (optional)
    conditions: AccessCondition[] (optional)
    mask: MaskingStrategy (optional)

  write:
    allowRoles: string[] (optional)
    denyRoles: string[] (optional)
    conditions: AccessCondition[] (optional)
    validation: ValidationRule[] (optional)

  enums:
    MaskingStrategy:
      - none
      - partial # Show first/last chars (e.g., "****5678")
      - full # Complete masking (e.g., "********")
      - hash # One-way hash
      - redact # Remove completely

  examples:
    # Sensitive field (price)
    - field: "price"
      description: "Product price"
      read:
        allowRoles: ["editor", "admin"]
        mask: none
      write:
        allowRoles: ["admin"]

    # PII field (email)
    - field: "email"
      description: "Customer email"
      read:
        allowRoles: ["support", "admin"]
        mask: partial # show first 2 and domain
        conditions:
          - field: "consentGiven"
            operator: "equals"
            value: true
      write:
        allowRoles: ["admin"]
        validation:
          - type: "email"

    # Internal field (cost)
    - field: "cost"
      description: "Product cost (internal)"
      read:
        allowRoles: ["admin", "finance"]
      write:
        allowRoles: ["admin"]
```

### SecurityPolicy

```yaml
SecurityPolicy:
  description: "Declarative security policy"
  attributes:
    id: string (UUID) [PK]
    name: string [PK]
    description: string (optional)
    enabled: boolean (optional) # default: true
    priority: integer (execution order, higher = first)
    target: PolicyTarget [enum]

  contains:
    - rules: PolicyRule[] (1..*)

  enums:
    PolicyTarget:
      - all # Apply to all resources
      - api # API endpoints only
      - data # Data access only
      - screen # UI screens only

  examples:
    # Data protection policy
    - name: "pii-protection"
      description: "Protect PII data"
      enabled: true
      priority: 100
      target: data
      rules:
        - condition:
            expression: "resource.containsPII === true"
          actions:
            - type: "require-encryption"
            - type: "audit-access"
            - type: "apply-retention"

    # Multi-factor authentication policy
    - name: "mfa-required-for-admin"
      description: "Require MFA for admin operations"
      enabled: true
      priority: 90
      target: api
      rules:
        - condition:
            expression: "operation.requiresRole('admin')"
          actions:
            - type: "require-mfa"
              message: "MFA required for admin operations"

    # IP restriction policy
    - name: "admin-ip-restriction"
      description: "Restrict admin access to specific IPs"
      enabled: true
      priority: 95
      target: all
      rules:
        - condition:
            expression: "user.hasRole('admin')"
          actions:
            - type: "check-ip-whitelist"
              allowedIPs: ["10.0.0.0/8", "192.168.1.100"]
```

### PolicyRule

```yaml
PolicyRule:
  description: "Individual policy rule"
  attributes:
    id: string (UUID) [PK]
    name: string
    condition: Condition (1..1)
    effect: PolicyEffect [enum]
    message: string (optional)

  contains:
    - actions: PolicyAction[] (0..*)

  enums:
    PolicyEffect:
      - allow
      - deny
      - audit
      - warn

  examples:
    # Allow with audit
    - condition:
        expression: "user.hasRole('admin')"
      effect: allow
      actions:
        - type: "audit-access"
          level: "info"

    # Deny with message
    - condition:
        expression: "request.ipAddress not in allowedIPs"
      effect: deny
      message: "Access denied from this IP address"

    # Warn
    - condition:
        expression: "resource.classification === 'confidential'"
      effect: warn
      message: "Accessing confidential data"
      actions:
        - type: "notify-security-team"
```

### PolicyAction

```yaml
PolicyAction:
  description: "Action to take when policy rule matches"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ActionType [enum]
    parameters: object (action-specific parameters)

  enums:
    ActionType:
      - allow # Grant access
      - deny # Deny access
      - audit-access # Log access
      - require-mfa # Require multi-factor auth
      - require-approval # Require manual approval
      - apply-mask # Apply data masking
      - apply-encryption # Encrypt data
      - apply-retention # Apply retention policy
      - notify # Send notification
      - rate-limit # Apply rate limiting
      - check-ip-whitelist # Verify IP address
      - check-time-window # Verify time of access

  examples:
    # Audit
    - type: "audit-access"
      parameters:
        level: "info"
        includePayload: true

    # MFA
    - type: "require-mfa"
      parameters:
        methods: ["totp", "sms"]

    # Notification
    - type: "notify"
      parameters:
        recipients: ["security@example.com"]
        template: "security-alert"

    # Rate limit
    - type: "rate-limit"
      parameters:
        requests: 100
        window: "1h"
```

### DataClassification

```yaml
DataClassification:
  description: "Data classification and protection policies"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (optional)

  contains:
    - classifications: Classification[] (1..*)

Classification:
  description: "A single classification level defining data sensitivity and protection requirements"
  attributes:
    level: ClassificationLevel [enum]
    label: string
    description: string

  requirements:
    encryption: EncryptionRequirement
    retention: RetentionPolicy
    accessControl: AccessControlLevel
    auditLevel: AuditLevel
    masking: MaskingStrategy

  enums:
    ClassificationLevel:
      - public
      - internal
      - confidential
      - restricted

    EncryptionRequirement:
      - none
      - in-transit # HTTPS only
      - at-rest # Database encryption
      - both # Full encryption
      - end-to-end # E2E encryption

    AccessControlLevel:
      - open # No restrictions
      - authenticated # Login required
      - role-based # RBAC
      - attribute-based # ABAC

    AuditLevel:
      - none
      - minimal # Access only
      - standard # Access + modifications
      - comprehensive # All operations

  examples:
    # Public data
    - level: public
      label: "Public"
      description: "Publicly available information"
      encryption: in-transit
      retention:
        period: "indefinite"
      accessControl: open
      auditLevel: minimal

    # Confidential data
    - level: confidential
      label: "Confidential"
      description: "Sensitive business information"
      encryption: both
      retention:
        period: "7years"
        deleteAfter: true
      accessControl: role-based
      auditLevel: comprehensive
      masking: partial

    # PII data
    - level: restricted
      label: "PII/Restricted"
      description: "Personally identifiable information"
      encryption: end-to-end
      retention:
        period: "as-required"
        reviewRequired: true
      accessControl: attribute-based
      auditLevel: comprehensive
      masking: full
```

### Actor (STS-ml Inspired)

```yaml
Actor:
  description: "Actor in the system (beyond roles)"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ActorType [enum]
    description: string (optional)
    trustLevel: TrustLevel [enum] (optional)

  contains:
    - objectives: ActorObjective[] (0..*) # What the actor wants to achieve
    - dependencies: ActorDependency[] (0..*) # Who they depend on

  references:
    - businessActorRef: string (optional, reference to BusinessActor)
    - stakeholderRef: string (optional, reference to Stakeholder)

  enums:
    ActorType:
      - role # User role
      - agent # Individual user
      - organization # External organization
      - system # External system

    TrustLevel:
      - none
      - low
      - medium
      - high
      - full

  examples:
    # Internal role actor
    - id: "product-manager"
      name: "Product Manager"
      type: role
      businessActorRef: "business-actor-product-manager"
      stakeholderRef: "stakeholder-product-manager"
      objectives:
        - id: "maintain-product-catalog"
          description: "Maintain accurate product catalog"
          motivationGoalRef: "goal-product-catalog-accuracy"
        - id: "ensure-pricing-accuracy"
          description: "Ensure pricing is accurate and approved"
          motivationGoalRef: "goal-pricing-accuracy"

    # External organization
    - id: "external-vendor"
      name: "External Vendor System"
      type: organization
      trustLevel: medium
      dependencies:
        - dependee: "product-api"
          resource: "product-data"
          objective: "sync-inventory"
          criticality: high
```

### ActorObjective

```yaml
ActorObjective:
  description: "Security-related objective or goal of an actor"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string
    criticality: Criticality [enum] (optional)

  references:
    - motivationGoalRef: string (optional, reference to Motivation Goal)

  enums:
    Criticality:
      - low
      - medium
      - high
      - critical

  examples:
    - id: "maintain-product-catalog"
      description: "Maintain accurate and up-to-date product catalog"
      criticality: high
      motivationGoalRef: "goal-product-catalog-accuracy"

    - id: "ensure-pricing-accuracy"
      description: "Ensure pricing is accurate and approved"
      criticality: critical
      motivationGoalRef: "goal-pricing-accuracy"
```

### ActorDependency

```yaml
ActorDependency:
  description: "Dependency between actors"
  attributes:
    id: string (UUID) [PK]
    name: string
    dependee: string (actor id or resource id)
    resource: string (what resource is needed)
    objective: string (objective id that requires this dependency)
    criticality: Criticality [enum]

  example:
    - dependee: "inventory-system"
      resource: "stock-data"
      objective: "display-availability"
      criticality: high
```

### InformationEntity (STS-ml Inspired)

```yaml
InformationEntity:
  description: "Information asset with fine-grained rights"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    classification: ClassificationLevel [enum]

  contains:
    - authorizationRequirements: InformationRight[] (1..*)

  references:
    - dataObjectRef: string (reference to data schema or resource)

  examples:
    # Product pricing information
    - id: "product-pricing"
      name: "Product Pricing Information"
      classification: confidential
      dataObjectRef: "product"
      authorizationRequirements:
        - actor: "product-manager"
          rights: [read, modify, produce]
        - actor: "finance"
          rights: [read, modify]
          constraint: "approval required for changes over $100"
        - actor: "viewer"
          rights: [read]
          constraint: "only for published products"

    # Customer PII
    - id: "customer-pii"
      name: "Customer Personal Information"
      classification: restricted
      authorizationRequirements:
        - actor: "customer-service"
          rights: [read]
          constraint: "only with customer consent"
        - actor: "admin"
          rights: [read, modify, produce, delete]
```

### InformationRight

```yaml
InformationRight:
  description: "Fine-grained information access rights"
  attributes:
    id: string (UUID) [PK]
    name: string
    actor: string (actor id or role name)
    constraint: string (optional textual constraint)

  rights:
    produce: boolean (create new information)
    read: boolean (view information)
    modify: boolean or Constraint (change existing information)
    distribute: boolean or Constraint (share with others)
    delete: boolean (remove information, optional)

  examples:
    # Editor with constraints
    - actor: "editor"
      produce: true
      read: true
      modify:
        constraint: "status != 'published'"
      distribute: false

    # Viewer with limited distribution
    - actor: "viewer"
      read: true
      produce: false
      modify: false
      distribute:
        constraint: "only to internal actors"
```

### Delegation (STS-ml Inspired)

```yaml
Delegation:
  description: "Explicit delegation of permissions or goals"
  attributes:
    id: string (UUID) [PK]
    name: string
    delegator: string (actor/role delegating)
    delegatee: string (actor/role receiving delegation)
    delegationType: DelegationType [enum]
    description: string (optional)

  scope:
    permission: string (permission being delegated, optional)
    objective: string (objective being delegated, optional)
    resource: string (resource scope, optional)

  constraints:
    retainOversight: boolean (delegator keeps visibility)
    retainControl: boolean (delegator can revoke)
    timebound: string (duration, optional)
    revocable: boolean (optional) # default: true
    maxDelegationDepth: integer (prevent deep chains, optional)
    excludes: string[] (excluded sub-permissions/resources)

  enums:
    DelegationType:
      - execution # Delegate task execution only
      - permission # Delegate permission (can further delegate)
      - approval # Delegate approval authority

  examples:
    # Product manager delegates to editor
    - delegator: "product-manager"
      delegatee: "product-editor"
      delegationType: execution
      objective: "update-product-details"
      permission: "product.update"
      constraints:
        retainOversight: true
        timebound: "30days"
        revocable: true
        excludes: ["pricing", "cost"]

    # Admin delegates permission
    - delegator: "admin"
      delegatee: "product-manager"
      delegationType: permission
      permission: "product.*"
      constraints:
        maxDelegationDepth: 2
        retainControl: true
```

### SecurityConstraints (STS-ml Inspired)

```yaml
SecurityConstraints:
  description: "Security patterns and constraints"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (optional)

  contains:
    - separationOfDuty: SeparationOfDuty[] (0..*)
    - bindingOfDuty: BindingOfDuty[] (0..*)
    - needToKnow: NeedToKnow[] (0..*)

SeparationOfDuty:
  description: "Different actors must perform related tasks"
  attributes:
    name: string [PK]
    description: string (optional)
    message: string (error message)

  contains:
    - tasks: string[] (task/operation names that must be separated)
    - roles: string[] (roles that cannot both perform these tasks)
    - mutuallyExclusive: boolean (optional) # default: true

  examples:
    - name: "purchase-approval"
      description: "Purchase order approval"
      tasks: ["create-order", "approve-order"]
      message: "Order creator cannot approve their own order"
      mutuallyExclusive: true

    - name: "financial-controls"
      tasks: ["initiate-payment", "authorize-payment", "reconcile-payment"]
      message: "Financial transactions require separation of duties"

BindingOfDuty:
  description: "Same actor must complete related tasks"
  attributes:
    name: string [PK]
    description: string (optional)
    message: string (error message)

  contains:
    - tasks: string[] (tasks that must be performed by same actor)
    - scope: string (scope within which binding applies)

  examples:
    - name: "audit-completion"
      description: "Audit process completion"
      tasks: ["start-audit", "complete-audit"]
      scope: "per-audit-instance"
      message: "Same auditor must complete the audit they started"

    - name: "approval-workflow"
      tasks: ["review-request", "approve-request"]
      message: "Reviewer must also be the approver"

NeedToKnow:
  description: "Information access based on objective/purpose requirements"
  attributes:
    name: string [PK]
    resource: string (information entity or resource)
    objective: string (objective that justifies access)
    message: string (access denial message)
    justificationRequired: boolean (require explicit justification)

  examples:
    - name: "customer-ssn-access"
      resource: "customer-ssn"
      objective: "process-tax-document"
      message: "SSN only visible when processing tax documents"
      justificationRequired: true

    - name: "salary-information"
      resource: "employee-salary"
      objective: "payroll-processing"
      message: "Salary information requires payroll processing context"
```

### SocialDependency (STS-ml Inspired)

```yaml
SocialDependency:
  description: "Dependencies and trust between actors"
  attributes:
    id: string (UUID) [PK]
    name: string
    depender: string (actor who depends)
    dependee: string (actor depended upon)
    resource: string (what is depended upon)
    objective: string (objective that requires this dependency, optional)
    criticality: Criticality [enum]

  trust:
    trustLevel: TrustLevel [enum]
    verification: VerificationLevel [enum] (optional)

  references:
    - commitmentRefs: string[] (optional, references to Motivation Constraints)

  enums:
    VerificationLevel:
      - none
      - manual # Manual verification
      - automated # Automated checks
      - continuous # Continuous monitoring

  examples:
    - depender: "sales-system"
      dependee: "product-catalog"
      resource: "accurate-pricing"
      objective: "generate-quotes"
      criticality: high
      trust:
        trustLevel: high
        verification: automated

    - depender: "internal-system"
      dependee: "external-vendor"
      resource: "inventory-data"
      objective: "maintain-inventory-accuracy"
      criticality: medium
      trust:
        trustLevel: medium
        verification: continuous
      commitmentRefs: ["constraint-inventory-sla"]
```

### AccountabilityRequirement (STS-ml Inspired)

```yaml
AccountabilityRequirement:
  description: "Accountability and non-repudiation requirements"
  attributes:
    id: string (UUID) [PK]
    name: string
    action: string (action requiring accountability)
    resource: string (resource involved, optional)
    nonRepudiation: boolean (cannot deny performing action)
    purposeDeclaration: RequirementLevel [enum] (require purpose declaration)
    challengeable: boolean (user can challenge access)

  requires:
    evidence: Evidence[] (required evidence)
    auditRetention: string (how long to retain audit, e.g., "7years")

  enums:
    RequirementLevel:
      - none
      - optional
      - required
      - mandatory

  examples:
    # Financial approval
    - action: "approve-transaction"
      nonRepudiation: true
      purposeDeclaration: mandatory
      requiresEvidence:
        - type: "digital-signature"
          strength: "strong"
        - type: "timestamp"
          source: "trusted-time-source"
        - type: "ip-address"
        - type: "device-fingerprint"
      auditRetention: "7years"
      challengeable: false

    # Data access
    - action: "access-customer-pii"
      resource: "customer-data"
      nonRepudiation: true
      purposeDeclaration: required
      purposeTypes: ["support", "audit", "legal"]
      requiresEvidence:
        - type: "user-authentication"
        - type: "timestamp"
        - type: "access-reason"
      auditRetention: "5years"
      challengeable: true
```

### Evidence

```yaml
Evidence:
  description: "Evidence required for accountability"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: EvidenceType [enum]
    strength: EvidenceStrength [enum] (optional)
    source: string (source of evidence, optional)

  enums:
    EvidenceType:
      - digital-signature
      - timestamp
      - ip-address
      - device-fingerprint
      - biometric
      - user-authentication
      - access-reason
      - approval-chain
      - video-recording

    EvidenceStrength:
      - weak
      - moderate
      - strong
      - cryptographic

  examples:
    - type: "digital-signature"
      strength: "cryptographic"
      source: "pki-certificate"

    - type: "timestamp"
      source: "trusted-time-source"
      strength: "strong"
```

### Threat (STS-ml Inspired)

```yaml
Threat:
  description: "Security threat and countermeasures"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string
    threatens: string[] (resources, objectives, or information entities)
    likelihood: Likelihood [enum]
    impact: Impact [enum]

  actors:
    threatActors: string[] (potential threat actors)

  references:
    - assessmentRef: string (optional, reference to Motivation Assessment)
    - mitigatedByRequirements: string[] (Motivation Requirement IDs)

  contains:
    - countermeasures: Countermeasure[] (0..*)

  enums:
    Likelihood:
      - very-low
      - low
      - medium
      - high
      - very-high

    Impact:
      - negligible
      - low
      - medium
      - high
      - critical

  examples:
    # Insider threat
    - id: "unauthorized-price-change"
      name: "Unauthorized Price Manipulation"
      description: "Malicious insider changes product prices for fraud"
      threatens: ["product.price", "pricing-integrity"]
      threatActors: ["malicious-insider", "compromised-editor"]
      likelihood: medium
      impact: high
      assessmentRef: "assessment-pricing-manipulation-risk"
      mitigatedByRequirements: ["req-dual-control-pricing", "req-price-audit-trail"]
      countermeasures:
        - type: "separation-of-duty"
          description: "Require dual approval for price changes"
          effectiveness: high
          implemented: true
          implementedBy: ["req-dual-control-pricing"]
        - type: "audit-trail"
          description: "Log all price changes with full context"
          effectiveness: medium
          implemented: true
          implementedBy: ["req-price-audit-trail"]

    # External threat
    - id: "api-data-breach"
      name: "API Data Breach"
      description: "Unauthorized access to customer data via API"
      threatens: ["customer-pii", "product-api"]
      threatActors: ["external-attacker"]
      likelihood: medium
      impact: critical
      assessmentRef: "assessment-api-security-vulnerability"
      mitigatedByRequirements:
        ["req-api-strong-auth", "req-api-rate-limiting", "req-data-encryption"]
      countermeasures:
        - type: "authentication"
          description: "Strong authentication required"
          effectiveness: very-high
          implemented: true
          implementedBy: ["req-api-strong-auth"]
        - type: "rate-limiting"
          description: "Prevent brute force attacks"
          effectiveness: high
          implemented: true
          implementedBy: ["req-api-rate-limiting"]
        - type: "encryption"
          description: "Encrypt data in transit and at rest"
          effectiveness: very-high
          implemented: true
          implementedBy: ["req-data-encryption"]
```

### Countermeasure

```yaml
Countermeasure:
  description: "Security countermeasure for a threat"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: string (type of countermeasure)
    description: string
    effectiveness: Effectiveness [enum] (optional)
    implemented: boolean (optional) # default: false

  references:
    implementedBy: string[] (security requirements or controls)

  enums:
    Effectiveness:
      - low
      - medium
      - high
      - very-high

  examples:
    - type: "separation-of-duty"
      description: "Require two different roles for approval"
      effectiveness: high
      implemented: true
      implementedBy: ["dual-control-pricing"]

    - type: "encryption"
      description: "End-to-end encryption of sensitive data"
      effectiveness: very-high
      implemented: true
```

### RateLimit

```yaml
RateLimit:
  description: "Defines throttling constraints for API or service access, specifying maximum request counts, time windows, and actions to take when limits are exceeded. Protects resources from abuse and ensures fair usage across consumers."
  attributes:
    id: string (UUID) [PK]
    name: string
    requests: integer (maximum number of requests allowed)
    window: string (time window, e.g., "1m", "1h", "1d")
    scope: RateLimitScope [enum] (optional)
    keyBy: string (attribute to use for rate limiting, e.g., "user.id", "ip", optional)

  actions:
    onExceed: RateLimitAction [enum]
    retryAfter: integer (seconds until retry allowed, optional)
    message: string (error message to return, optional)

  enums:
    RateLimitScope:
      - global # Applies to all requests
      - user # Per authenticated user
      - ip # Per IP address
      - api-key # Per API key
      - tenant # Per tenant/organization

    RateLimitAction:
      - reject # Return 429 Too Many Requests
      - queue # Queue request for later processing
      - throttle # Slow down response
      - degrade # Return degraded response

  examples:
    # Standard API rate limit
    - name: "api-standard-limit"
      requests: 1000
      window: "1h"
      scope: user
      onExceed: reject
      retryAfter: 60
      message: "Rate limit exceeded. Please try again later."

    # Strict limit for sensitive operations
    - name: "password-reset-limit"
      requests: 3
      window: "15m"
      scope: ip
      onExceed: reject
      retryAfter: 900
      message: "Too many password reset attempts."
```

### AuditConfig

```yaml
AuditConfig:
  description: "Configuration for security audit logging, specifying what events to capture, retention periods, storage destinations, and compliance requirements. Enables security monitoring and forensic analysis."
  attributes:
    id: string (UUID) [PK]
    name: string
    enabled: boolean (optional) # default: true
    level: AuditLevel [enum]
    includePayload: boolean (optional) # include request/response body
    includeHeaders: boolean (optional) # include HTTP headers
    sanitizeFields: string[] (fields to redact, optional)

  retention:
    period: string (e.g., "90days", "7years")
    storageClass: StorageClass [enum] (optional)
    archiveAfter: string (move to archive storage after, optional)

  destinations:
    - type: DestinationType [enum]
      config: object (destination-specific configuration)

  enums:
    AuditLevel:
      - none # No auditing
      - minimal # Access events only
      - standard # Access and modifications
      - detailed # All operations with context
      - comprehensive # Full audit trail with payloads

    StorageClass:
      - hot # Frequently accessed
      - warm # Occasionally accessed
      - cold # Rarely accessed
      - archive # Long-term archive

    DestinationType:
      - database # Audit database
      - log-service # Centralized logging
      - siem # Security information and event management
      - file # File-based storage

  examples:
    # Standard audit configuration
    - name: "product-audit"
      enabled: true
      level: standard
      includePayload: false
      sanitizeFields: ["password", "creditCard", "ssn"]
      retention:
        period: "7years"
        storageClass: warm
        archiveAfter: "90days"
      destinations:
        - type: database
          config:
            table: "audit_log"
        - type: siem
          config:
            endpoint: "https://siem.example.com/ingest"
```

### Condition

```yaml
Condition:
  description: "A logical expression or predicate that determines when a SecurityPolicy rule applies. Supports attribute-based access control by evaluating context such as time, location, user attributes, or resource state."
  attributes:
    id: string (UUID) [PK]
    name: string
    expression: string (boolean expression to evaluate)
    description: string (optional)
    evaluationType: EvaluationType [enum] (optional)

  context:
    availableVariables:
      - user # Authenticated user context
      - resource # Resource being accessed
      - request # Request context (IP, time, etc.)
      - environment # Environment variables
      - custom # Custom context providers

  enums:
    EvaluationType:
      - synchronous # Evaluate immediately
      - asynchronous # May require external call
      - cached # Use cached evaluation result

  examples:
    # Time-based condition
    - name: "business-hours-only"
      expression: "request.time.hour >= 9 && request.time.hour < 17 && request.time.dayOfWeek >= 1 && request.time.dayOfWeek <= 5"
      description: "Only allow access during business hours"

    # Location-based condition
    - name: "internal-network-only"
      expression: "request.ipAddress.startsWith('10.') || request.ipAddress.startsWith('192.168.')"
      description: "Restrict to internal network"

    # Attribute-based condition
    - name: "owner-or-admin"
      expression: "user.id === resource.ownerId || user.hasRole('admin')"
      description: "Allow owner or admin access"

    # Complex condition
    - name: "high-value-approval"
      expression: "resource.value > 10000 && user.approvalLimit >= resource.value"
      description: "Require sufficient approval authority for high-value items"
```

### RetentionPolicy

```yaml
RetentionPolicy:
  description: "Defines how long security-related data (audit logs, access records, encryption keys) must be retained, archival strategies, and secure deletion procedures. Ensures compliance with regulatory requirements."
  attributes:
    id: string (UUID) [PK]
    name: string
    period: string (retention duration, e.g., "90days", "7years", "indefinite")
    description: string (optional)

  lifecycle:
    activeRetention: string (keep in active storage, optional)
    archiveAfter: string (move to archive after, optional)
    deleteAfter: string (permanently delete after, optional)
    reviewRequired: boolean (require review before deletion, optional)

  deletion:
    method: DeletionMethod [enum]
    verification: boolean (verify deletion, optional)
    certificate: boolean (generate deletion certificate, optional)

  compliance:
    regulationRefs: string[] (applicable regulations, optional)
    legalHoldOverride: boolean (can be overridden by legal hold, optional)

  enums:
    DeletionMethod:
      - soft # Mark as deleted, retain data
      - hard # Permanently remove
      - cryptographic # Destroy encryption keys
      - overwrite # Overwrite with random data
      - physical # Physical destruction (for hardware)

  examples:
    # GDPR-compliant retention
    - name: "gdpr-user-data"
      period: "as-required"
      description: "Retain user data only as long as necessary"
      lifecycle:
        activeRetention: "duration-of-service"
        deleteAfter: "30days-after-account-closure"
        reviewRequired: true
      deletion:
        method: hard
        verification: true
        certificate: true
      compliance:
        regulationRefs: ["GDPR-Article-17"]
        legalHoldOverride: true

    # Financial audit retention
    - name: "financial-records"
      period: "7years"
      description: "Retain financial records for regulatory compliance"
      lifecycle:
        activeRetention: "1year"
        archiveAfter: "1year"
        deleteAfter: "7years"
      deletion:
        method: cryptographic
        certificate: true
      compliance:
        regulationRefs: ["SOX", "SEC-Rule-17a-4"]
```

### ValidationRule

```yaml
ValidationRule:
  description: "Specifies data validation constraints for FieldAccessControl, defining allowed patterns, value ranges, or transformations applied when accessing protected fields. Prevents data corruption and enforces field-level integrity."
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ValidationRuleType [enum]
    value: any (validation parameter, depends on type)
    message: string (error message on validation failure, optional)
    severity: ValidationSeverity [enum] (optional)

  transform:
    onRead: string (transformation when reading, optional)
    onWrite: string (transformation when writing, optional)

  enums:
    ValidationRuleType:
      - required # Field must have a value
      - pattern # Must match regex pattern
      - minLength # Minimum string length
      - maxLength # Maximum string length
      - min # Minimum numeric value
      - max # Maximum numeric value
      - enum # Must be one of allowed values
      - email # Valid email format
      - url # Valid URL format
      - date # Valid date format
      - custom # Custom validation function

    ValidationSeverity:
      - error # Block operation
      - warning # Allow but warn
      - info # Informational only

  examples:
    # Email validation
    - name: "email-format"
      type: email
      message: "Invalid email format"
      severity: error

    # Price range validation
    - name: "price-range"
      type: min
      value: 0
      message: "Price must be non-negative"
      severity: error

    # SKU pattern validation
    - name: "sku-format"
      type: pattern
      value: "^[A-Z]{2}\\d{4}$"
      message: "SKU must match format: AA1234"
      severity: error

    # With transformation
    - name: "phone-normalize"
      type: pattern
      value: "^\\+?[1-9]\\d{1,14}$"
      message: "Invalid phone number format"
      transform:
        onWrite: "normalizePhoneNumber(value)"
        onRead: "formatPhoneNumber(value, user.locale)"
```

## Complete Example: Product Security Model

```yaml
# File: specs/security/product-security.yaml
version: "2.0.0" # Enhanced with STS-ml concepts
application: "product-management"

# ============================================================
# Authentication
# ============================================================
authentication:
  provider: oauth2
  sessionTimeout: 30
  mfaRequired: false
  oauth2:
    authorizationUrl: "https://auth.example.com/authorize"
    tokenUrl: "https://auth.example.com/token"
    userInfoUrl: "https://auth.example.com/userinfo"
    clientId: "product-app"
    scopes: ["openid", "profile", "email", "product.read", "product.write"]
  passwordPolicy:
    minLength: 12
    requireUppercase: true
    requireLowercase: true
    requireNumbers: true
    requireSpecialChars: true
    preventReuse: 10
    expiryDays: 90
    lockoutAttempts: 3
    lockoutDuration: 30

# ============================================================
# Roles
# ============================================================
roles:
  - name: "admin"
    displayName: "Administrator"
    description: "Full system access"
    level: 100
    permissions:
      - "product.*"
      - "user.*"
      - "system.*"
    isSystemRole: true

  - name: "product-manager"
    displayName: "Product Manager"
    description: "Manage product catalog"
    level: 70
    inheritsFrom: ["editor"]
    permissions:
      - "product.*"
      - "category.*"
      - "analytics.read"

  - name: "editor"
    displayName: "Editor"
    description: "Create and edit content"
    level: 50
    inheritsFrom: ["viewer"]
    permissions:
      - "product.create"
      - "product.update"
      - "product.delete"
      - "category.read"

  - name: "viewer"
    displayName: "Viewer"
    description: "Read-only access"
    level: 10
    permissions:
      - "product.read"
      - "category.read"

# ============================================================
# Permissions
# ============================================================
permissions:
  - name: "product.read"
    description: "Read product information"
    scope: global
    resource: "product"
    action: "read"

  - name: "product.create"
    description: "Create new products"
    scope: global
    resource: "product"
    action: "create"

  - name: "product.update"
    description: "Update existing products"
    scope: global
    resource: "product"
    action: "update"

  - name: "product.delete"
    description: "Delete products"
    scope: global
    resource: "product"
    action: "delete"

  - name: "product.*"
    description: "All product operations"
    scope: global
    resource: "product"
    action: "*"

# ============================================================
# Resources
# ============================================================
resources:
  # Product API
  - resource: "product-api"
    type: api
    description: "Product management API"
    archimateRef: "app-service-product-api"
    operations:
      - operation: "listProducts"
        description: "List products (GET /products)"
        allowRoles: ["viewer", "editor", "product-manager", "admin"]
        rateLimit:
          requests: 1000
          window: "1h"
        audit:
          enabled: true
          level: "info"

      - operation: "getProduct"
        description: "Get product details (GET /products/:id)"
        allowRoles: ["viewer", "editor", "product-manager", "admin"]
        rateLimit:
          requests: 2000
          window: "1h"

      - operation: "createProduct"
        description: "Create product (POST /products)"
        allowRoles: ["editor", "product-manager", "admin"]
        rateLimit:
          requests: 100
          window: "1h"
        audit:
          enabled: true
          level: "warning"

      - operation: "updateProduct"
        description: "Update product (PUT /products/:id)"
        allowRoles: ["editor", "product-manager", "admin"]
        conditions:
          - field: "status"
            operator: "notEquals"
            value: "archived"
            message: "Cannot update archived products"
        audit:
          enabled: true
          level: "warning"

      - operation: "deleteProduct"
        description: "Delete product (DELETE /products/:id)"
        allowRoles: ["admin"]
        conditions:
          - field: "status"
            operator: "equals"
            value: "draft"
            message: "Can only delete draft products"
        audit:
          enabled: true
          level: "critical"

  # Product Data Object
  - resource: "product"
    type: data
    description: "Product data object"
    archimateRef: "data-object-product"
    operations:
      - operation: "read"
        allowRoles: ["viewer", "editor", "product-manager", "admin"]
      - operation: "write"
        allowRoles: ["editor", "product-manager", "admin"]

    # Field-level access control
    fieldAccess:
      # Public fields (no restrictions)
      - field: "name"
        read:
          allowRoles: ["*"]
        write:
          allowRoles: ["editor", "product-manager", "admin"]

      - field: "description"
        read:
          allowRoles: ["*"]
        write:
          allowRoles: ["editor", "product-manager", "admin"]

      # Sensitive field (price)
      - field: "price"
        description: "Product price"
        read:
          allowRoles: ["editor", "product-manager", "admin"]
        write:
          allowRoles: ["product-manager", "admin"]

      # Internal field (cost)
      - field: "cost"
        description: "Product cost (internal)"
        read:
          allowRoles: ["product-manager", "admin"]
          mask: full # Masked for non-admins
        write:
          allowRoles: ["admin"]

      # Inventory
      - field: "stockQuantity"
        read:
          allowRoles: ["editor", "product-manager", "admin"]
        write:
          allowRoles: ["product-manager", "admin"]

# ============================================================
# Security Policies
# ============================================================
policies:
  # Audit high-value products
  - name: "audit-high-value-products"
    description: "Audit access to expensive products"
    enabled: true
    priority: 80
    target: data
    rules:
      - condition:
          expression: "resource.type === 'product' && resource.price > 1000"
        effect: audit
        actions:
          - type: "audit-access"
            parameters:
              level: "warning"
              includePayload: true

  # Require MFA for delete operations
  - name: "mfa-for-delete"
    description: "Require MFA for product deletion"
    enabled: true
    priority: 90
    target: api
    rules:
      - condition:
          expression: "operation.name === 'deleteProduct'"
        effect: allow
        actions:
          - type: "require-mfa"
            parameters:
              methods: ["totp"]

  # Rate limiting for public API
  - name: "public-api-rate-limit"
    description: "Rate limit for unauthenticated requests"
    enabled: true
    priority: 100
    target: api
    rules:
      - condition:
          expression: "!user.isAuthenticated"
        effect: allow
        actions:
          - type: "rate-limit"
            parameters:
              requests: 100
              window: "15m"

# ============================================================
# Data Classification
# ============================================================
dataClassification:
  classifications:
    - level: public
      label: "Public"
      description: "Publicly available product information"
      encryption: in-transit
      retention:
        period: "indefinite"
      accessControl: open
      auditLevel: minimal
      masking: none

    - level: internal
      label: "Internal"
      description: "Internal product information"
      encryption: both
      retention:
        period: "7years"
      accessControl: authenticated
      auditLevel: standard
      masking: none

    - level: confidential
      label: "Confidential"
      description: "Sensitive pricing and cost information"
      encryption: both
      retention:
        period: "7years"
        deleteAfter: true
      accessControl: role-based
      auditLevel: comprehensive
      masking: partial

# ============================================================
# STS-ml Inspired Extensions
# ============================================================

# Actors (beyond roles)
actors:
  - id: "product-manager-actor"
    name: "Product Manager"
    type: role
    businessActorRef: "business-actor-product-manager"
    stakeholderRef: "stakeholder-product-manager"
    objectives:
      - id: "maintain-product-catalog"
        description: "Maintain accurate product catalog"
        criticality: high
        motivationGoalRef: "goal-product-catalog-accuracy"
      - id: "ensure-pricing-accuracy"
        description: "Ensure pricing is accurate and approved"
        criticality: critical
        motivationGoalRef: "goal-pricing-accuracy"

  - id: "external-vendor-actor"
    name: "External Vendor System"
    type: organization
    trustLevel: medium

# Information Entities (fine-grained rights)
informationEntities:
  - id: "product-pricing"
    name: "Product Pricing Information"
    classification: confidential
    dataObjectRef: "product"
    authorizationRequirements:
      - actor: "product-manager"
        produce: true
        read: true
        modify: true
        distribute: false
      - actor: "finance"
        produce: false
        read: true
        modify:
          constraint: "changes over $100 require approval"
        distribute: false
      - actor: "editor"
        produce: false
        read: true
        modify:
          constraint: "status != 'published'"
        distribute: false

  - id: "product-cost"
    name: "Product Cost Information"
    classification: confidential
    dataObjectRef: "product"
    authorizationRequirements:
      - actor: "admin"
        produce: true
        read: true
        modify: true
        distribute: false
      - actor: "product-manager"
        produce: false
        read: true
        modify: false
        distribute: false

# Delegations
delegations:
  - delegator: "product-manager"
    delegatee: "editor"
    delegationType: execution
    objective: "update-product-details"
    permission: "product.update"
    constraints:
      retainOversight: true
      timebound: "30days"
      revocable: true
      excludes: ["price", "cost"]

  - delegator: "admin"
    delegatee: "product-manager"
    delegationType: permission
    permission: "product.*"
    constraints:
      maxDelegationDepth: 1
      retainControl: true

# Security Constraints
securityConstraints:
  separationOfDuty:
    - name: "price-approval"
      description: "Price changes require dual approval"
      tasks: ["propose-price-change", "approve-price-change"]
      message: "Price proposer cannot approve their own changes"
      mutuallyExclusive: true

  bindingOfDuty:
    - name: "product-review"
      description: "Product reviewer must complete review"
      tasks: ["start-product-review", "complete-product-review"]
      scope: "per-product"
      message: "Same reviewer must complete the review"

  needToKnow:
    - name: "cost-visibility"
      resource: "product-cost"
      objective: "pricing-analysis"
      message: "Cost information only visible for pricing analysis"
      justificationRequired: true

# Social Dependencies
socialDependencies:
  - depender: "sales-system"
    dependee: "product-catalog"
    resource: "accurate-pricing"
    objective: "generate-quotes"
    criticality: high
    trust:
      trustLevel: high
      verification: automated

  - depender: "product-catalog"
    dependee: "external-vendor"
    resource: "inventory-data"
    objective: "maintain-inventory-accuracy"
    criticality: medium
    trust:
      trustLevel: medium
      verification: continuous
    commitmentRefs: ["constraint-inventory-sla"]

# Accountability Requirements
accountability:
  - action: "approve-price-change"
    resource: "product-pricing"
    nonRepudiation: true
    purposeDeclaration: mandatory
    challengeable: false
    requiresEvidence:
      - type: "digital-signature"
        strength: "strong"
      - type: "timestamp"
        source: "trusted-time-source"
      - type: "user-authentication"
      - type: "approval-chain"
    auditRetention: "7years"

  - action: "access-product-cost"
    resource: "product-cost"
    nonRepudiation: true
    purposeDeclaration: required
    challengeable: true
    requiresEvidence:
      - type: "user-authentication"
      - type: "timestamp"
      - type: "access-reason"
    auditRetention: "3years"

# Threats (linked to Motivation Requirements)
threats:
  - id: "unauthorized-price-change"
    name: "Unauthorized Price Manipulation"
    description: "Malicious insider changes product prices without approval"
    threatens: ["product-pricing", "ensure-pricing-accuracy"]
    threatActors: ["malicious-insider", "compromised-editor"]
    likelihood: medium
    impact: high
    assessmentRef: "assessment-pricing-manipulation-risk"
    mitigatedByRequirements: ["req-dual-control-pricing", "req-price-audit-trail"]
    countermeasures:
      - type: "separation-of-duty"
        description: "Require dual approval for price changes"
        effectiveness: high
        implemented: true
        implementedBy: ["req-dual-control-pricing"]
      - type: "audit-trail"
        description: "Log all price changes with full context"
        effectiveness: medium
        implemented: true
        implementedBy: ["req-price-audit-trail"]

  - id: "cost-information-leak"
    name: "Cost Information Disclosure"
    description: "Unauthorized access to internal cost information"
    threatens: ["product-cost", "competitive-advantage"]
    threatActors: ["external-attacker", "curious-employee"]
    likelihood: medium
    impact: high
    assessmentRef: "assessment-cost-data-exposure-risk"
    mitigatedByRequirements:
      ["req-cost-access-control", "req-cost-audit-trail", "req-need-to-know-cost"]
    countermeasures:
      - type: "access-control"
        description: "Strict role-based access to cost data"
        effectiveness: high
        implemented: true
        implementedBy: ["req-cost-access-control"]
      - type: "audit-trail"
        description: "Log all cost data access with justification"
        effectiveness: medium
        implemented: true
        implementedBy: ["req-cost-audit-trail"]
      - type: "need-to-know"
        description: "Access only granted for specific purposes"
        effectiveness: high
        implemented: true
        implementedBy: ["req-need-to-know-cost"]
```

## Integration Points

**For complete link patterns and validation rules**, see [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md). The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer (WHY)

- **Actor** references **Stakeholder** (stakeholderRef)
- **ActorObjective** references **Goal** (motivationGoalRef)
- **Threat** references **Assessment** (assessmentRef)
- **Threat.mitigatedByRequirements** references **Requirement** IDs
- **SocialDependency.commitmentRefs** references **Constraint** IDs
- **Requirement** properties specify security implementation details

**Example Flow**:

```
Stakeholder → Goal → Assessment (threat) → Requirement → Security Implementation
     ↓          ↓            ↓                   ↓               ↓
   Actor  → Objective  →  Threat    →  Permission Rule  →  Access Control
```

### To Business Layer (WHO)

- **Actor** references **BusinessActor** (businessActorRef)
- **BusinessService** is secured by ResourceOperation
- **BusinessProcess** authorization mapped from roles

### To ArchiMate Application Layer

- SecurityModel references ApplicationComponent
- Resource authorization maps to ApplicationService

### To API Layer (OpenAPI)

- ResourceOperation maps to OpenAPI operations
- Security schemes reference authentication config

### To Data Model Layer (JSON Schema)

- FieldAccessControl maps to schema properties
- Data classification guides x-security extensions

### To UX Layer

- Screen access control via NavigationGuard
- Field visibility based on permissions

### To Navigation Layer

- Route guards reference roles/permissions
- Authentication requirements

### To Data Store Layer

- Encryption requirements for columns
- Audit trail requirements

## Validation

```yaml
Validation Checks:
  # Traditional validations
  - All role references are valid
  - All permission references exist
  - No circular role inheritance
  - Resource operations reference valid roles
  - Field access references valid fields
  - Policy conditions are syntactically valid
  - No conflicting policies (priority ordering)

  # Cross-layer reference validations
  - Actor.businessActorRef references valid BusinessActor (if provided)
  - Actor.stakeholderRef references valid Stakeholder (if provided)
  - ActorObjective.motivationGoalRef references valid Goal (if provided)
  - Threat.assessmentRef references valid Assessment (if provided)
  - Threat.mitigatedByRequirements references valid Requirement IDs
  - SocialDependency.commitmentRefs references valid Constraint IDs (if provided)

  # STS-ml inspired validations
  - Actor references in delegations are valid
  - Delegation chains don't exceed maxDelegationDepth
  - Information entity references to data objects are valid
  - Security constraint tasks reference valid operations
  - Social dependency references are valid
  - Threat countermeasures reference valid requirement IDs in implementedBy
  - Accountability evidence types are valid
  - Objective references in actors and dependencies are consistent
```

## Best Practices

### Traditional Security Practices

1. **Principle of Least Privilege**: Grant minimum required permissions
2. **Role Hierarchy**: Use inheritance to avoid duplication
3. **Defense in Depth**: Multiple layers of security
4. **Audit Everything Sensitive**: Log all access to sensitive data
5. **Fail Secure**: Deny by default, allow explicitly
6. **Separation of Duties**: No single role has complete control
7. **Regular Reviews**: Audit role and permission assignments
8. **Data Classification**: Always classify data sensitivity
9. **Field-Level Security**: Control access to sensitive fields
10. **Policy-Based**: Use policies for complex rules

### STS-ml Inspired Practices

11. **Goal-Oriented Security**: Model actor goals to understand why access is needed
12. **Information Flow Control**: Use fine-grained rights (produce, read, modify, distribute) not just CRUD
13. **Explicit Delegation**: Model delegation chains with constraints rather than implicit role assignments
14. **Security Patterns**: Explicitly define SoD, BoD, and need-to-know constraints
15. **Trust Modeling**: Explicitly model trust levels for external actors and systems
16. **Social Commitments**: Document regulatory and contractual security commitments
17. **Accountability First**: Require non-repudiation and evidence for sensitive actions
18. **Threat-Driven**: Link threats to security requirements to justify controls
19. **Delegation Limits**: Set maxDelegationDepth to prevent excessive delegation chains
20. **Purpose Declaration**: Require justification for accessing sensitive information

### Layer Integration Approach

- **Motivation Layer** (WHY): Define security requirements, threats as assessments, compliance constraints
- **Business Layer** (WHO): Define business actors that map to security actors
- **Security Layer** (WHAT/HOW): Define security implementation using cross-layer references
- Use **Motivation Requirements** with security properties instead of separate SecurityRequirement
- Use **Motivation Constraints** for compliance commitments instead of SocialCommitment
- Link **Threats to Assessments** for business-to-technical traceability
- Map **Actors to Stakeholders and BusinessActors** for identity consistency
- Reference **Objectives to Goals** to align security with business outcomes

### Implementation Benefits

- **Single source of truth** for all requirements in Motivation Layer
- **Clear traceability** from stakeholders → goals → threats → requirements → controls
- **Avoid duplication** of actors, requirements, and constraints across layers
- **Proper separation of concerns**: Business (WHO), Motivation (WHY), Security (WHAT/HOW)
- **ArchiMate alignment**: Leverage standard Motivation elements for security modeling

## Code Generation

Security specs enable generation of:

```yaml
Middleware:
  - Authentication middleware
  - Authorization middleware
  - Audit logging middleware
  - Rate limiting middleware

Guards:
  - Route guards
  - API guards
  - Data access guards

Policy Enforcement:
  - Policy engine
  - Rule evaluator
  - Condition matcher

Testing:
  - Security tests
  - Permission tests
  - Policy tests
  - Penetration tests
```

This Security Layer provides comprehensive, declarative security controls with support for RBAC, ABAC, field-level security, and policy-based enforcement.
