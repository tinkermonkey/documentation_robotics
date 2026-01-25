# Layer 12: Testing Layer

Models test coverage requirements, input space partitioning, and coverage criteria to ensure comprehensive testing with traceability to requirements.

## Overview

The Testing Layer defines **test coverage requirements** rather than test execution details. This is a **custom specification** that models what should be tested and why, enabling traceability from business requirements through coverage targets to abstract test cases.

**Key Distinction**: This layer models the _coverage space_ (what combinations of inputs, contexts, and outcomes need testing) rather than _test instances_ (specific test cases with concrete values). Concrete test implementations can be linked via references to external formats (Gherkin, Postman, etc.).

**Layer Integration**: Testing Layer integrates with Motivation Layer for requirements traceability (WHY), Business Layer for workflow coverage (WHAT processes), UX Layer for form coverage (WHAT interfaces), API Layer for endpoint coverage (WHAT services), and Data Model Layer for input constraints (HOW to partition).

## Layer Characteristics

- **Standard**: Custom Specification (YAML format)
- **Custom Extensions**: Complete custom specification
- **Validation**: Custom JSON Schema validator
- **Tooling**: Coverage analysis, gap detection, traceability reports

## Why Custom?

No existing standard comprehensively covers test coverage modeling:

- **IEEE 829 / ISO 29119**: Document templates, not machine-readable schemas
- **Gherkin/Cucumber**: Test instance definitions, not coverage space modeling
- **TTCN-3**: Protocol testing focus, steep learning curve
- **OSLC QM**: Test case management, not coverage planning
- **JUnit XML**: Test results, not test requirements

Our Testing spec provides:

1. **Coverage target modeling** — what artifacts need testing
2. **Input space partitioning** — degrees of freedom in test inputs
3. **Coverage requirements** — what combinations must be exercised
4. **Context variations** — same functionality via different entry points
5. **Outcome categories** — expected result partitions (not specific assertions)
6. **Coverage criteria** — pairwise, boundary, exhaustive, risk-based
7. **Traceability** — links to requirements, workflows, forms, APIs
8. **Implementation references** — optional links to concrete test formats

## Entity Definitions

### TestCoverageModel

```yaml
TestCoverageModel:
  description: "Complete test coverage model for application"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (spec version)
    application: string (application identifier)
    description: string (optional)

  contains:
    - coverageTargets: TestCoverageTarget[] (1..*)
    - inputSpacePartitions: InputSpacePartition[] (0..*)
    - contextVariations: ContextVariation[] (0..*)
    - coverageRequirements: CoverageRequirement[] (1..*)
    - testCaseSketches: TestCaseSketch[] (0..*)
  references:
    - motivationRefs: string[] (optional, Requirement IDs for overall scope)
```

### TestCoverageTarget

```yaml
TestCoverageTarget:
  description: "An artifact or functionality that requires test coverage"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    targetType: TargetType [enum]
    priority: Priority [enum] (optional)

  # Source code integration
  source:
    reference: SourceReference (optional) # Links target to source code artifact
      provenance: "extracted" | "manual" | "inferred" | "generated"
      locations:
        - file: string (relative path to source file)
          symbol: string (function/class/method name being tested, optional)
      repository:
        url: string (Git remote URL, optional)
        commit: string (Git commit SHA, optional)

  references:
    - targetRef: string (URI to the target artifact)
    - businessProcessRef: string (optional, Business Layer process ID)
    - workflowStepRef: string (optional, specific step within workflow)
    - formRef: string (optional, UX Layer form ID)
    - apiOperationRef: string (optional, OpenAPI operationId)
    - dataTransformRef: string (optional, data transformation ID)
    - navigationRouteRef: string (optional, Navigation Layer route ID)

  contains:
    - applicableContexts: string[] (0..*)
    - inputFields: TargetInputField[] (0..*)
    - outcomeCategories: OutcomeCategory[] (0..*)

  enums:
    TargetType:
      - workflow # Business process or workflow
      - workflow-step # Specific step within a workflow
      - form # UI form submission
      - api-operation # API endpoint operation
      - data-transform # Data transformation or business rule
      - navigation-path # Navigation sequence through UI
      - integration # Integration between systems
      - composite # Combination of multiple targets

    Priority:
      - critical # Must have full coverage
      - high # Should have strong coverage
      - medium # Normal coverage expectations
      - low # Best-effort coverage

  examples:
    # Workflow target
    - id: "create-order"
      name: "Create Order Workflow"
      description: "End-to-end order creation process"
      targetType: workflow
      priority: critical
      source:
        reference:
          provenance: "extracted"
          locations:
            - file: "src/services/order.ts"
              symbol: "createOrder"
          repository:
            commit: "abc123def456"
      businessProcessRef: "business-process-create-order"
      applicableContexts:
        - "customer-ui-context"
        - "admin-ui-context"
        - "api-context"
      inputFields:
        - fieldRef: "order.lineItems"
          partitionRef: "line-items-partition"
        - fieldRef: "order.shippingAddress"
          partitionRef: "shipping-address-partition"
      outcomeCategories:
        - id: "success"
          description: "Order created successfully"
        - id: "validation-error"
          description: "Validation rejected the input"
        - id: "authorization-denied"
          description: "User lacks permission"

    # Form target
    - id: "product-edit-form"
      name: "Product Edit Form"
      targetType: form
      priority: high
      formRef: "ux-form-product-edit"
      apiOperationRef: "updateProduct"
```

### TargetInputField

```yaml
TargetInputField:
  description: "Input field associated with a coverage target"
  attributes:
    id: string (UUID) [PK]
    name: string
    fieldRef: string (reference to data model field or form field)
    partitionRef: string (reference to InputSpacePartition)
    description: string (optional)
    relevance: FieldRelevance [enum] (optional)

  enums:
    FieldRelevance:
      - primary # Core to the functionality
      - secondary # Affects behavior but not central
      - contextual # Only relevant in certain contexts

  example:
    - fieldRef: "order.lineItems"
      partitionRef: "line-items-count-partition"
      relevance: primary
```

### InputSpacePartition

```yaml
InputSpacePartition:
  description: "Partitioning of an input dimension into testable categories"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    fieldRef: string (reference to data model field, form field, or parameter)
    presenceRule: PresenceRule [enum]

  contains:
    - partitions: PartitionValue[] (1..*)
    - dependencies: PartitionDependency[] (0..*)

  references:
    - dataModelFieldRef: string (optional, Data Model Layer field)
    - formFieldRef: string (optional, UX Layer field)
    - apiParameterRef: string (optional, OpenAPI parameter)
    - jsonSchemaRef: string (optional, JSON Schema path)

  enums:
    PresenceRule:
      - required # Field must always be present
      - optional # Field presence is a dimension to test
      - conditional # Presence depends on other fields

  examples:
    # Presence partition
    - id: "shipping-address-presence"
      name: "Shipping Address Presence"
      fieldRef: "order.shippingAddress"
      presenceRule: optional
      partitions:
        - id: "present"
          label: "Address Provided"
          constraint: "field is present and valid"
        - id: "absent"
          label: "No Address (pickup)"
          constraint: "field is null or omitted"

    # Value range partition
    - id: "line-items-count"
      name: "Line Items Count"
      fieldRef: "order.lineItems"
      presenceRule: required
      dataModelFieldRef: "order-schema.properties.lineItems"
      partitions:
        - id: "single"
          label: "Single Item"
          constraint: "length = 1"
          category: typical
        - id: "multiple"
          label: "Multiple Items"
          constraint: "length in [2, 10]"
          category: typical
        - id: "boundary-max"
          label: "Maximum Items"
          constraint: "length = 100"
          category: boundary
        - id: "empty"
          label: "No Items"
          constraint: "length = 0"
          category: invalid
```

### PartitionValue

```yaml
PartitionValue:
  description: "A specific partition within the input space"
  attributes:
    name: string
    id: string (UUID) [PK]
    label: string
    description: string (optional)
    constraint: string (human-readable or expression)
    constraintExpression: string (optional, machine-evaluable expression)
    category: PartitionCategory [enum]
    representativeValue: any (optional, example value for this partition)

  enums:
    PartitionCategory:
      - typical # Normal/common case
      - boundary # Edge case at limits
      - invalid # Should be rejected
      - null # Null or missing value
      - special # Special handling required

  examples:
    - id: "valid-email"
      label: "Valid Email Format"
      constraint: "matches email regex"
      category: typical
      representativeValue: "user@example.com"

    - id: "email-max-length"
      label: "Maximum Length Email"
      constraint: "length = 254"
      category: boundary
```

### PartitionDependency

```yaml
PartitionDependency:
  description: "Constraint between partition values across fields"
  attributes:
    id: string (UUID) [PK]
    name: string
    dependsOnPartition: string (InputSpacePartition ID)
    dependsOnValue: string (PartitionValue ID)
    effect: DependencyEffect [enum]
    affectedValues: string[] (PartitionValue IDs in this partition)
    description: string (optional)

  enums:
    DependencyEffect:
      - requires # If A, then must have B
      - excludes # If A, then cannot have B
      - enables # If A, then B becomes available
      - modifies # If A, then B's meaning changes

  example:
    - dependsOnPartition: "payment-method"
      dependsOnValue: "credit-card"
      effect: requires
      affectedValues: ["card-number-present"]
      description: "Credit card payment requires card number"
```

### ContextVariation

```yaml
ContextVariation:
  description: "Different context in which functionality can be invoked"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    contextType: ContextType [enum]

  references:
    - entryPointRef: string (optional, navigation route, API endpoint, etc.)
    - actorRef: string (optional, Security Layer actor or role)
    - securityRoleRef: string (optional, Security Layer role)
    - preconditions: string[] (optional, required system state)

  contains:
    - environmentFactors: EnvironmentFactor[] (0..*)

  enums:
    ContextType:
      - ui-entry # Entry via UI navigation
      - api-entry # Entry via API call
      - event-triggered # Triggered by system event
      - scheduled # Triggered by scheduler
      - integration # Triggered by external system

  examples:
    # Customer UI context
    - id: "customer-ui-context"
      name: "Customer Self-Service UI"
      contextType: ui-entry
      entryPointRef: "navigation://customer-portal#new-order"
      actorRef: "security-actor-customer"
      securityRoleRef: "customer"
      preconditions:
        - "user is authenticated"
        - "user has active account"

    # Admin UI context
    - id: "admin-ui-context"
      name: "Admin Portal"
      contextType: ui-entry
      entryPointRef: "navigation://admin-portal#create-order"
      securityRoleRef: "admin"
      preconditions:
        - "admin is authenticated"
        - "admin has order-management permission"

    # API context
    - id: "api-context"
      name: "REST API"
      contextType: api-entry
      entryPointRef: "api://orders#createOrder"
      securityRoleRef: "api-client"
```

### EnvironmentFactor

```yaml
EnvironmentFactor:
  description: "Environmental condition that may affect behavior"
  attributes:
    id: string (UUID) [PK]
    name: string
    factor: string (factor name)
    value: string (factor value or state)
    description: string (optional)

  examples:
    - factor: "data-state"
      value: "empty-system"
      description: "No existing orders in system"

    - factor: "external-service"
      value: "payment-gateway-available"
      description: "Payment gateway is responsive"
```

### OutcomeCategory

```yaml
OutcomeCategory:
  description: "Category of expected outcomes (not specific assertions)"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    outcomeType: OutcomeType [enum]
    httpStatusRange: string (optional, e.g., "2xx", "400-499")

  references:
    - validationRuleRefs: string[] (optional, validation rules that trigger this)
    - securityConstraintRefs: string[] (optional, security rules that trigger this)

  enums:
    OutcomeType:
      - success # Operation completed successfully
      - validation-error # Input validation failed
      - authorization-denied # Permission denied
      - not-found # Resource not found
      - conflict # State conflict (e.g., already exists)
      - precondition-failed # Precondition not met
      - idempotent-noop # Already in target state
      - partial-success # Some items succeeded, some failed
      - error # Unexpected error

  examples:
    - id: "order-created"
      name: "Order Created Successfully"
      outcomeType: success
      httpStatusRange: "201"

    - id: "invalid-line-items"
      name: "Line Items Validation Failed"
      outcomeType: validation-error
      httpStatusRange: "400"
      validationRuleRefs: ["validation-line-items-required"]
```

### CoverageRequirement

```yaml
CoverageRequirement:
  description: "Requirement for test coverage of a target"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    coverageCriteria: CoverageCriteria [enum]
    priority: Priority [enum] (optional)

  references:
    - targetRef: string (TestCoverageTarget ID)
    - requirementRefs: string[] (Motivation Layer Requirement IDs)
    - riskAssessmentRef: string (optional, Motivation Layer Assessment ID)

  contains:
    - inputPartitionSelections: InputPartitionSelection[] (0..*)
    - contextSelections: string[] (0..*)
    - outcomeSelections: string[] (0..*)
    - exclusions: CoverageExclusion[] (0..*)

  enums:
    CoverageCriteria:
      - exhaustive # All combinations
      - pairwise # All pairs of values
      - each-choice # At least one test per partition value
      - boundary # Focus on boundary values
      - risk-based # Priority based on risk assessment
      - happy-path # Only success scenarios
      - error-path # Only error scenarios

  examples:
    # Comprehensive coverage requirement
    - id: "cr-order-creation-full"
      name: "Order Creation Full Coverage"
      description: "Comprehensive coverage of order creation workflow"
      coverageCriteria: pairwise
      priority: critical
      targetRef: "create-order"
      requirementRefs:
        - "req-order-creation"
        - "req-order-validation"
      inputPartitionSelections:
        - partitionRef: "shipping-address-presence"
          coverValues: ["present", "absent"]
        - partitionRef: "line-items-count"
          coverValues: ["single", "multiple", "boundary-max"]
        - partitionRef: "payment-method"
          coverValues: ["credit-card", "invoice", "prepaid"]
      contextSelections:
        - "customer-ui-context"
        - "admin-ui-context"
        - "api-context"
      outcomeSelections:
        - "order-created"
        - "validation-error"
        - "authorization-denied"

    # Focused boundary coverage
    - id: "cr-order-boundaries"
      name: "Order Boundary Cases"
      coverageCriteria: boundary
      priority: high
      targetRef: "create-order"
      inputPartitionSelections:
        - partitionRef: "line-items-count"
          coverValues: ["empty", "boundary-max"]
        - partitionRef: "item-quantity"
          coverValues: ["zero", "one", "max-quantity"]
```

### InputPartitionSelection

```yaml
InputPartitionSelection:
  description: "Selection of partition values to include in coverage"
  attributes:
    id: string (UUID) [PK]
    name: string
    partitionRef: string (InputSpacePartition ID)
    coverValues: string[] (PartitionValue IDs to cover)
    coverAllCategories: boolean (optional, cover all categories of a type)
    excludeValues: string[] (optional, PartitionValue IDs to exclude)

  example:
    - partitionRef: "line-items-count"
      coverValues: ["single", "multiple", "boundary-max"]
      excludeValues: ["empty"] # Covered by separate error-path requirement
```

### CoverageExclusion

```yaml
CoverageExclusion:
  description: "Explicit exclusion from coverage with justification"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (what is excluded)
    reason: string (why it's excluded)
    riskAccepted: boolean (explicitly accepted risk)
    approvedBy: string (optional, who approved the exclusion)

  example:
    - description: "Empty line items with admin context"
      reason: "Admin override allows empty orders - tested separately"
      riskAccepted: true
      approvedBy: "product-owner"
```

### TestCaseSketch

```yaml
TestCaseSketch:
  description: "Abstract test case selecting specific partition values"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    status: SketchStatus [enum]

  # Source code integration
  source:
    reference: SourceReference (optional) # Links test case to implementation
      provenance: "extracted" | "manual" | "inferred" | "generated"
      locations:
        - file: string (relative path to test file, e.g., "tests/test_orders.py")
          symbol: string (test function/method name, e.g., "TestOrderService.test_create_order_happy_path")
      repository:
        url: string (Git remote URL, optional)
        commit: string (Git commit SHA, optional)

  references:
    - coverageReqRef: string (CoverageRequirement ID)
    - implementationRef: string (optional, URI to concrete test)
    - implementationFormat: ImplementationFormat [enum] (optional)

  contains:
    - inputSelections: InputSelection[] (1..*)
  enums:
    SketchStatus:
      - planned # Not yet implemented
      - implemented # Has concrete implementation
      - automated # Automated and in CI/CD
      - manual # Requires manual execution
      - blocked # Cannot be implemented currently
      - deprecated # No longer relevant

    ImplementationFormat:
      - gherkin # Cucumber/Gherkin feature file
      - postman # Postman collection
      - jest # Jest test file
      - pytest # pytest test file
      - playwright # Playwright test
      - cypress # Cypress test
      - robot # Robot Framework
      - manual # Manual test procedure
      - other # Other format

  examples:
    # Implemented test case sketch
    - id: "tcs-order-single-item-customer"
      name: "Customer creates single-item order"
      status: automated
      source:
        reference:
          provenance: "extracted"
          locations:
            - file: "tests/test_orders.py"
              symbol: "TestOrderService.test_create_order_happy_path"
          repository:
            commit: "abc123def456"
      coverageReqRef: "cr-order-creation-full"
      inputSelections:
        - partitionRef: "line-items-count"
          selectedValue: "single"
        - partitionRef: "shipping-address-presence"
          selectedValue: "present"
        - partitionRef: "payment-method"
          selectedValue: "credit-card"
      contextSelection: "customer-ui-context"
      expectedOutcome: "order-created"
      implementationRef: "gherkin://features/orders.feature#customer-creates-single-item-order"
      implementationFormat: gherkin

    # Planned test case sketch
    - id: "tcs-order-max-items-api"
      name: "API order with maximum items"
      status: planned
      coverageReqRef: "cr-order-boundaries"
      inputSelections:
        - partitionRef: "line-items-count"
          selectedValue: "boundary-max"
      contextSelection: "api-context"
      expectedOutcome: "order-created"
      notes: "Need to verify system handles 100 items efficiently"
```

### InputSelection

```yaml
InputSelection:
  description: "Specific partition value selected for a test case"
  attributes:
    id: string (UUID) [PK]
    name: string
    partitionRef: string (InputSpacePartition ID)
    selectedValue: string (PartitionValue ID)
    concreteValue: any (optional, specific value to use)
    valueSource: string (optional, reference to test data source)

  example:
    - partitionRef: "line-items-count"
      selectedValue: "boundary-max"
      concreteValue: 100
```

### CoverageSummary

```yaml
CoverageSummary:
  description: "Summary of coverage status (can be computed or declared)"
  attributes:
    generatedAt: datetime (optional)
    totalTargets: integer
    totalRequirements: integer
    totalSketches: integer

  contains:
    - targetSummaries: TargetCoverageSummary[] (0..*)
    - gaps: CoverageGap[] (0..*)

TargetCoverageSummary:
  description: "Coverage metrics summary for a single test coverage target"
  attributes:
    targetRef: string (TestCoverageTarget ID)
    sketchCount: integer
    implementedCount: integer
    automatedCount: integer
    coveragePercentage: number (optional)

CoverageGap:
  description: "Identified gap in test coverage requiring attention"
  attributes:
    description: string
    severity: GapSeverity [enum]
    affectedRequirements: string[] (CoverageRequirement IDs)

  enums:
    GapSeverity:
      - critical # Missing critical coverage
      - high # Significant gap
      - medium # Notable gap
      - low # Minor gap
```

## Complete Example: Order Management Test Coverage

```yaml
# File: specs/testing/order-coverage.yaml
version: "1.0.0"
application: "order-management"
description: "Test coverage model for order management system"

# ============================================================
# Coverage Targets
# ============================================================
coverageTargets:
  # Create Order Workflow
  - id: "create-order"
    name: "Create Order Workflow"
    description: "End-to-end order creation from any entry point"
    targetType: workflow
    priority: critical
    businessProcessRef: "business-process-order-creation"
    applicableContexts:
      - "customer-ui"
      - "admin-ui"
      - "api-direct"
    inputFields:
      - fieldRef: "order.customerId"
        partitionRef: "customer-id-partition"
        relevance: primary
      - fieldRef: "order.lineItems"
        partitionRef: "line-items-partition"
        relevance: primary
      - fieldRef: "order.shippingAddress"
        partitionRef: "shipping-address-partition"
        relevance: primary
      - fieldRef: "order.paymentMethod"
        partitionRef: "payment-method-partition"
        relevance: primary
      - fieldRef: "order.discountCode"
        partitionRef: "discount-code-partition"
        relevance: secondary
    outcomeCategories:
      - id: "created"
        name: "Order Created"
        outcomeType: success
        httpStatusRange: "201"
      - id: "validation-failed"
        name: "Validation Failed"
        outcomeType: validation-error
        httpStatusRange: "400"
      - id: "unauthorized"
        name: "Unauthorized"
        outcomeType: authorization-denied
        httpStatusRange: "403"
      - id: "customer-not-found"
        name: "Customer Not Found"
        outcomeType: not-found
        httpStatusRange: "404"

  # Product Edit Form
  - id: "product-edit"
    name: "Product Edit Form"
    description: "Editing product details via admin form"
    targetType: form
    priority: high
    formRef: "ux-form-product-edit"
    apiOperationRef: "updateProduct"
    applicableContexts:
      - "admin-ui"
    inputFields:
      - fieldRef: "product.name"
        partitionRef: "product-name-partition"
      - fieldRef: "product.price"
        partitionRef: "price-partition"
      - fieldRef: "product.status"
        partitionRef: "product-status-partition"
    outcomeCategories:
      - id: "updated"
        name: "Product Updated"
        outcomeType: success
      - id: "validation-failed"
        name: "Validation Failed"
        outcomeType: validation-error
      - id: "conflict"
        name: "Concurrent Edit Conflict"
        outcomeType: conflict

# ============================================================
# Input Space Partitions
# ============================================================
inputSpacePartitions:
  # Line Items Partition
  - id: "line-items-partition"
    name: "Order Line Items"
    fieldRef: "order.lineItems"
    presenceRule: required
    dataModelFieldRef: "order-schema#/properties/lineItems"
    partitions:
      - id: "empty"
        label: "No Items"
        constraint: "length = 0"
        category: invalid
      - id: "single"
        label: "Single Item"
        constraint: "length = 1"
        category: typical
        representativeValue: [{ "productId": "prod-1", "quantity": 1 }]
      - id: "few"
        label: "Few Items (2-5)"
        constraint: "length in [2, 5]"
        category: typical
      - id: "many"
        label: "Many Items (6-20)"
        constraint: "length in [6, 20]"
        category: typical
      - id: "boundary-max"
        label: "Maximum Items"
        constraint: "length = 100"
        category: boundary
      - id: "over-max"
        label: "Over Maximum"
        constraint: "length > 100"
        category: invalid

  # Shipping Address Partition
  - id: "shipping-address-partition"
    name: "Shipping Address Presence"
    fieldRef: "order.shippingAddress"
    presenceRule: optional
    partitions:
      - id: "present-domestic"
        label: "Domestic Address"
        constraint: "address present AND country = 'US'"
        category: typical
      - id: "present-international"
        label: "International Address"
        constraint: "address present AND country != 'US'"
        category: typical
      - id: "absent"
        label: "No Address (In-Store Pickup)"
        constraint: "address is null"
        category: typical

  # Payment Method Partition
  - id: "payment-method-partition"
    name: "Payment Method"
    fieldRef: "order.paymentMethod"
    presenceRule: required
    partitions:
      - id: "credit-card"
        label: "Credit Card"
        category: typical
      - id: "debit-card"
        label: "Debit Card"
        category: typical
      - id: "invoice"
        label: "Invoice (B2B)"
        category: typical
      - id: "gift-card"
        label: "Gift Card"
        category: special
      - id: "split-payment"
        label: "Split Payment (Multiple Methods)"
        category: special
    dependencies:
      - dependsOnPartition: "customer-type-partition"
        dependsOnValue: "b2b"
        effect: enables
        affectedValues: ["invoice"]
        description: "Invoice payment only available for B2B customers"

  # Discount Code Partition
  - id: "discount-code-partition"
    name: "Discount Code"
    fieldRef: "order.discountCode"
    presenceRule: optional
    partitions:
      - id: "absent"
        label: "No Discount Code"
        category: typical
      - id: "valid-percent"
        label: "Valid Percentage Discount"
        constraint: "code exists AND type = 'percent'"
        category: typical
      - id: "valid-fixed"
        label: "Valid Fixed Amount Discount"
        constraint: "code exists AND type = 'fixed'"
        category: typical
      - id: "expired"
        label: "Expired Code"
        category: invalid
      - id: "invalid-format"
        label: "Malformed Code"
        category: invalid

  # Price Partition (for product edit)
  - id: "price-partition"
    name: "Product Price"
    fieldRef: "product.price"
    presenceRule: required
    partitions:
      - id: "typical"
        label: "Normal Price Range"
        constraint: "price in [1.00, 10000.00]"
        category: typical
      - id: "zero"
        label: "Zero Price (Free)"
        constraint: "price = 0"
        category: boundary
      - id: "minimum"
        label: "Minimum Price"
        constraint: "price = 0.01"
        category: boundary
      - id: "maximum"
        label: "Maximum Price"
        constraint: "price = 999999.99"
        category: boundary
      - id: "negative"
        label: "Negative Price"
        constraint: "price < 0"
        category: invalid

# ============================================================
# Context Variations
# ============================================================
contextVariations:
  - id: "customer-ui"
    name: "Customer Self-Service Portal"
    contextType: ui-entry
    entryPointRef: "navigation://customer-portal#checkout"
    securityRoleRef: "customer"
    preconditions:
      - "user authenticated as customer"
      - "cart contains items"
    environmentFactors:
      - factor: "session-state"
        value: "active-cart"

  - id: "admin-ui"
    name: "Admin Order Creation"
    contextType: ui-entry
    entryPointRef: "navigation://admin-portal#orders/new"
    securityRoleRef: "admin"
    preconditions:
      - "user authenticated as admin"
      - "has order-create permission"

  - id: "api-direct"
    name: "Direct API Access"
    contextType: api-entry
    entryPointRef: "api://orders#createOrder"
    securityRoleRef: "api-client"
    preconditions:
      - "valid API key"
      - "rate limit not exceeded"

# ============================================================
# Coverage Requirements
# ============================================================
coverageRequirements:
  # Primary order creation coverage
  - id: "cr-order-primary"
    name: "Order Creation Primary Coverage"
    description: "Core happy-path and common error scenarios"
    coverageCriteria: pairwise
    priority: critical
    targetRef: "create-order"
    requirementRefs:
      - "req-order-creation"
      - "req-order-validation"
    inputPartitionSelections:
      - partitionRef: "line-items-partition"
        coverValues: ["single", "few", "many"]
      - partitionRef: "shipping-address-partition"
        coverValues: ["present-domestic", "present-international", "absent"]
      - partitionRef: "payment-method-partition"
        coverValues: ["credit-card", "invoice"]
    contextSelections:
      - "customer-ui"
      - "admin-ui"
      - "api-direct"
    outcomeSelections:
      - "created"
      - "validation-failed"

  # Boundary and edge cases
  - id: "cr-order-boundaries"
    name: "Order Boundary Cases"
    description: "Edge cases and limits"
    coverageCriteria: boundary
    priority: high
    targetRef: "create-order"
    requirementRefs:
      - "req-order-limits"
    inputPartitionSelections:
      - partitionRef: "line-items-partition"
        coverValues: ["empty", "boundary-max", "over-max"]
      - partitionRef: "price-partition"
        coverValues: ["zero", "minimum", "maximum"]
    contextSelections:
      - "api-direct" # API is best for boundary testing
    outcomeSelections:
      - "created"
      - "validation-failed"

  # Error path coverage
  - id: "cr-order-errors"
    name: "Order Error Scenarios"
    description: "Error handling and validation"
    coverageCriteria: each-choice
    priority: high
    targetRef: "create-order"
    requirementRefs:
      - "req-order-error-handling"
    inputPartitionSelections:
      - partitionRef: "discount-code-partition"
        coverValues: ["expired", "invalid-format"]
      - partitionRef: "line-items-partition"
        coverValues: ["empty"]
    contextSelections:
      - "customer-ui"
      - "api-direct"
    outcomeSelections:
      - "validation-failed"
      - "unauthorized"
    exclusions:
      - description: "Admin bypassing validation"
        reason: "Admins can force invalid orders - tested in admin-specific suite"
        riskAccepted: true

# ============================================================
# Test Case Sketches
# ============================================================
testCaseSketches:
  # Implemented happy path
  - id: "tcs-001"
    name: "Customer creates single-item domestic order with credit card"
    status: automated
    coverageReqRef: "cr-order-primary"
    inputSelections:
      - partitionRef: "line-items-partition"
        selectedValue: "single"
      - partitionRef: "shipping-address-partition"
        selectedValue: "present-domestic"
      - partitionRef: "payment-method-partition"
        selectedValue: "credit-card"
    contextSelection: "customer-ui"
    expectedOutcome: "created"
    implementationRef: "gherkin://features/orders/create-order.feature#single-item-domestic-cc"
    implementationFormat: gherkin

  # Implemented international order
  - id: "tcs-002"
    name: "Customer creates multi-item international order"
    status: automated
    coverageReqRef: "cr-order-primary"
    inputSelections:
      - partitionRef: "line-items-partition"
        selectedValue: "few"
      - partitionRef: "shipping-address-partition"
        selectedValue: "present-international"
      - partitionRef: "payment-method-partition"
        selectedValue: "credit-card"
    contextSelection: "customer-ui"
    expectedOutcome: "created"
    implementationRef: "gherkin://features/orders/create-order.feature#multi-item-international"
    implementationFormat: gherkin

  # API boundary test
  - id: "tcs-003"
    name: "API order with maximum items"
    status: automated
    coverageReqRef: "cr-order-boundaries"
    inputSelections:
      - partitionRef: "line-items-partition"
        selectedValue: "boundary-max"
        concreteValue: 100
    contextSelection: "api-direct"
    expectedOutcome: "created"
    implementationRef: "postman://collections/orders-api.json#max-items-order"
    implementationFormat: postman

  # Planned test
  - id: "tcs-004"
    name: "Admin creates B2B invoice order"
    status: planned
    coverageReqRef: "cr-order-primary"
    inputSelections:
      - partitionRef: "line-items-partition"
        selectedValue: "many"
      - partitionRef: "payment-method-partition"
        selectedValue: "invoice"
    contextSelection: "admin-ui"
    expectedOutcome: "created"
    notes: "Requires B2B customer fixture setup"

  # Error case
  - id: "tcs-005"
    name: "Reject expired discount code"
    status: automated
    coverageReqRef: "cr-order-errors"
    inputSelections:
      - partitionRef: "line-items-partition"
        selectedValue: "single"
      - partitionRef: "discount-code-partition"
        selectedValue: "expired"
    contextSelection: "customer-ui"
    expectedOutcome: "validation-failed"
    implementationRef: "gherkin://features/orders/discounts.feature#expired-code-rejected"
    implementationFormat: gherkin

# ============================================================
# Coverage Summary (optional, can be computed)
# ============================================================
coverageSummary:
  totalTargets: 2
  totalRequirements: 3
  totalSketches: 5
  targetSummaries:
    - targetRef: "create-order"
      sketchCount: 5
      implementedCount: 4
      automatedCount: 4
      coveragePercentage: 80
  gaps:
    - description: "No test for split payment method"
      severity: medium
      affectedRequirements: ["cr-order-primary"]
    - description: "Gift card payment untested"
      severity: low
      affectedRequirements: ["cr-order-primary"]
```

## Example Model

The following XML example demonstrates cross-layer integration using ArchiMate-style XML format.

```xml
<model>
  <!-- Example TestCase with cross-layer properties -->
  <element id="product-test" type="TestCase">
    <n>Product Test</n>
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

**For complete link patterns and validation rules**, see:

- **[Cross-Layer Relationships Guide](../guides/CROSS_LAYER_RELATIONSHIPS.md)** - Clarifies which pattern to use and naming conventions
- **[Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md)** - Complete catalog of all 60+ patterns

The following integration points are defined:

### To Motivation Layer (WHY)

- **CoverageRequirement** links to **Requirement** (requirementRefs property)
- **CoverageRequirement** links to **Assessment** (riskAssessmentRef property)

### To Business Layer (WHAT processes)

- **TestCoverageTarget** links to **BusinessProcess** (businessProcessRef property)
- **TestCoverageTarget** links to **WorkflowStep** (workflowStepRef property)

### To UX Layer (WHAT interfaces)

- **TestCoverageTarget** links to **Form** (formRef property)
- **InputSpacePartition** links to **FormField** (formFieldRef property)

### To API Layer (WHAT services)

- **TestCoverageTarget** links to **API Operation** (apiOperationRef property)
- **InputSpacePartition** links to **API Parameter** (apiParameterRef property)
- **OutcomeCategory** maps to **HTTP Status** (httpStatusRange property)

### To Data Model Layer (HOW to partition)

- **InputSpacePartition** links to **Schema Field** (dataModelFieldRef property)
- **InputSpacePartition** links to **JSON Schema** (jsonSchemaRef property)

### To Security Layer (WHO and access)

- **ContextVariation** links to **Security Role** (securityRoleRef property)
- **ContextVariation** links to **Security Actor** (actorRef property)
- **OutcomeCategory** links to **Security Constraint** (securityConstraintRefs property)

### To Navigation Layer (HOW to reach)

- **TestCoverageTarget** links to **Route** (navigationRouteRef property)
- **ContextVariation** links to **Entry Point** (entryPointRef property)

## Validation

```yaml
Validation Checks:
  # Structure validations
  - All partition references are valid
  - All context references are valid
  - All outcome references are valid within target
  - Test case sketches reference valid coverage requirements
  - Input selections reference valid partitions and values

  # Coverage validations
  - Coverage requirements specify at least one outcome
  - Pairwise coverage is computationally feasible
  - No orphan partitions (partitions not used in any requirement)
  - All critical targets have coverage requirements

  # Cross-layer reference validations
  - businessProcessRef references valid Business Layer process
  - formRef references valid UX Layer form
  - apiOperationRef references valid API operation
  - requirementRefs reference valid Motivation Layer requirements
  - securityRoleRef references valid Security Layer role

  # Dependency validations
  - Partition dependencies don't create cycles
  - Conditional presence rules have valid dependency references
```

## Coverage Analysis

The Testing Layer enables several coverage analyses:

### Gap Analysis

Identify missing coverage by comparing:

1. All partition value combinations required by coverage criteria
2. Partition values covered by existing test case sketches
3. Contexts not exercised for a given target
4. Outcome categories not verified

### Traceability Reports

Generate traceability matrices:

1. Requirement → Coverage Requirements → Test Case Sketches
2. Workflow Step → Coverage Targets → Test Case Sketches
3. Form Field → Input Partitions → Test Case Sketches

### Implementation Status

Track implementation progress:

1. Planned vs. Implemented sketches
2. Manual vs. Automated tests
3. Coverage percentage per target

## Intra-Layer Relationships

**Purpose**: Define structural and behavioral relationships between entities within this layer, enabling comprehensive test coverage modeling with clear containment hierarchies and semantic connections between coverage targets, partitions, requirements, and test case sketches.

### Structural Relationships

Relationships that define the composition, aggregation, and specialization of entities within this layer.

| Relationship   | Source Element          | Target Element          | Predicate     | Inverse Predicate | Cardinality | Description                                                                  |
| -------------- | ----------------------- | ----------------------- | ------------- | ----------------- | ----------- | ---------------------------------------------------------------------------- |
| Composition    | TestCoverageModel       | TestCoverageTarget      | `composes`    | `composed-of`     | 1:N         | Coverage model contains coverage targets defining what needs testing         |
| Composition    | TestCoverageModel       | InputSpacePartition     | `composes`    | `composed-of`     | 1:N         | Coverage model contains input space partitions for all testable inputs       |
| Composition    | TestCoverageModel       | ContextVariation        | `composes`    | `composed-of`     | 1:N         | Coverage model contains context variations for different entry points        |
| Composition    | TestCoverageModel       | CoverageRequirement     | `composes`    | `composed-of`     | 1:N         | Coverage model contains coverage requirements specifying what must be tested |
| Composition    | TestCoverageModel       | TestCaseSketch          | `composes`    | `composed-of`     | 1:N         | Coverage model contains abstract test case sketches                          |
| Composition    | TestCoverageModel       | CoverageSummary         | `composes`    | `composed-of`     | 1:1         | Coverage model contains computed coverage summary                            |
| Composition    | TestCoverageTarget      | TargetInputField        | `composes`    | `composed-of`     | 1:N         | Coverage target contains input fields relevant to testing                    |
| Composition    | TestCoverageTarget      | OutcomeCategory         | `composes`    | `composed-of`     | 1:N         | Coverage target contains expected outcome categories                         |
| Composition    | InputSpacePartition     | PartitionValue          | `composes`    | `composed-of`     | 1:N         | Input partition contains discrete partition values                           |
| Composition    | InputSpacePartition     | PartitionDependency     | `composes`    | `composed-of`     | 1:N         | Input partition contains dependencies on other partitions                    |
| Composition    | ContextVariation        | EnvironmentFactor       | `composes`    | `composed-of`     | 1:N         | Context variation contains environmental factors                             |
| Composition    | CoverageRequirement     | InputPartitionSelection | `composes`    | `composed-of`     | 1:N         | Coverage requirement contains partition value selections                     |
| Composition    | CoverageRequirement     | CoverageExclusion       | `composes`    | `composed-of`     | 1:N         | Coverage requirement contains justified exclusions                           |
| Composition    | TestCaseSketch          | InputSelection          | `composes`    | `composed-of`     | 1:N         | Test case sketch contains specific input selections                          |
| Composition    | CoverageSummary         | TargetCoverageSummary   | `composes`    | `composed-of`     | 1:N         | Coverage summary contains per-target metrics                                 |
| Composition    | CoverageSummary         | CoverageGap             | `composes`    | `composed-of`     | 1:N         | Coverage summary contains identified gaps                                    |
| Aggregation    | InputPartitionSelection | PartitionValue          | `aggregates`  | `aggregated-by`   | N:N         | Partition selection aggregates multiple partition values to cover            |
| Aggregation    | TestCoverageTarget      | ContextVariation        | `aggregates`  | `aggregated-by`   | N:N         | Target aggregates applicable contexts (reusable across targets)              |
| Aggregation    | CoverageRequirement     | ContextVariation        | `aggregates`  | `aggregated-by`   | N:N         | Requirement aggregates selected contexts for testing                         |
| Aggregation    | CoverageRequirement     | OutcomeCategory         | `aggregates`  | `aggregated-by`   | N:N         | Requirement aggregates outcome categories to verify                          |
| Specialization | PartitionValue          | PartitionValue          | `specializes` | `generalized-by`  | N:1         | Boundary, Invalid, Null values specialize base partition value               |
| Specialization | OutcomeCategory         | OutcomeCategory         | `specializes` | `generalized-by`  | N:1         | Success, Error, Validation outcomes specialize base category                 |
| Specialization | TestCaseSketch          | TestCaseSketch          | `specializes` | `generalized-by`  | N:1         | Automated, Manual, Blocked sketches specialize base sketch                   |

### Behavioral Relationships

Relationships that define interactions, flows, and dependencies between entities within this layer.

| Relationship | Source Element          | Target Element          | Predicate    | Inverse Predicate | Cardinality | Description                                                            |
| ------------ | ----------------------- | ----------------------- | ------------ | ----------------- | ----------- | ---------------------------------------------------------------------- |
| Reference    | TestCaseSketch          | CoverageRequirement     | `references` | `referenced-by`   | N:1         | Test case sketch references coverage requirement it satisfies          |
| Reference    | CoverageRequirement     | TestCoverageTarget      | `references` | `referenced-by`   | N:1         | Coverage requirement references target it covers                       |
| Reference    | TargetInputField        | InputSpacePartition     | `references` | `referenced-by`   | N:1         | Input field references its partition definition                        |
| Reference    | InputSelection          | InputSpacePartition     | `references` | `referenced-by`   | N:1         | Input selection references its source partition                        |
| Reference    | InputSelection          | PartitionValue          | `references` | `referenced-by`   | N:1         | Input selection references selected partition value                    |
| Reference    | PartitionDependency     | InputSpacePartition     | `references` | `referenced-by`   | N:1         | Partition dependency references dependent partition                    |
| Reference    | PartitionDependency     | PartitionValue          | `references` | `referenced-by`   | N:N         | Partition dependency references affected partition values              |
| Reference    | CoverageGap             | CoverageRequirement     | `references` | `referenced-by`   | N:N         | Coverage gap references affected requirements                          |
| Reference    | TargetCoverageSummary   | TestCoverageTarget      | `references` | `referenced-by`   | N:1         | Target summary references the target being summarized                  |
| Reference    | InputPartitionSelection | InputSpacePartition     | `references` | `referenced-by`   | N:1         | Partition selection references source partition                        |
| Reference    | EnvironmentFactor       | PartitionValue          | `references` | `referenced-by`   | N:N         | Environment factor references partition values it affects              |
| Reference    | CoverageExclusion       | PartitionValue          | `references` | `referenced-by`   | N:N         | Coverage exclusion references partition values to exclude from testing |
| Triggering   | PartitionDependency     | PartitionValue          | `triggers`   | `triggered-by`    | 1:N         | Dependency condition triggers inclusion/exclusion of values            |
| Triggering   | CoverageGap             | CoverageRequirement     | `triggers`   | `triggered-by`    | N:N         | Gap triggers need for additional coverage                              |
| Flow         | TestCoverageTarget      | CoverageRequirement     | `flows-to`   | `flows-from`      | 1:N         | Target flows to requirements that specify its coverage                 |
| Flow         | CoverageRequirement     | TestCaseSketch          | `flows-to`   | `flows-from`      | 1:N         | Requirement flows to sketches that implement it                        |
| Flow         | InputSpacePartition     | InputPartitionSelection | `flows-to`   | `flows-from`      | 1:N         | Partition flows to selections that use it                              |
| Depends-On   | TestCaseSketch          | ContextVariation        | `depends-on` | `dependency-of`   | N:1         | Test sketch depends on context for execution environment               |
| Depends-On   | TestCaseSketch          | OutcomeCategory         | `depends-on` | `dependency-of`   | N:1         | Test sketch depends on expected outcome category                       |
| Depends-On   | CoverageRequirement     | InputSpacePartition     | `depends-on` | `dependency-of`   | N:N         | Requirement depends on partitions for coverage criteria                |
| Depends-On   | InputSelection          | PartitionDependency     | `depends-on` | `dependency-of`   | N:N         | Selection depends on partition dependencies for validity               |
| Validates    | TestCaseSketch          | CoverageRequirement     | `validates`  | `validated-by`    | N:N         | Test sketch validates requirement is satisfied                         |
| Validates    | TargetCoverageSummary   | TestCoverageTarget      | `validates`  | `validated-by`    | N:1         | Summary validates coverage completeness of target                      |
| Serves       | InputSpacePartition     | TestCoverageTarget      | `serves`     | `served-by`       | N:N         | Partition serves target by defining testable input space               |
| Serves       | ContextVariation        | TestCoverageTarget      | `serves`     | `served-by`       | N:N         | Context serves target by defining execution environments               |
| Access       | TestCaseSketch          | InputSelection          | `accesses`   | `accessed-by`     | 1:N         | Test sketch accesses input selections for test execution               |
| Access       | CoverageRequirement     | InputPartitionSelection | `accesses`   | `accessed-by`     | 1:N         | Requirement accesses partition selections for coverage                 |

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

1. **Start with Coverage Targets**: Identify what needs testing before how to test it
2. **Model the Input Space First**: Define partitions based on data model constraints
3. **Use Appropriate Coverage Criteria**: Pairwise for combinatorial, boundary for limits
4. **Document Exclusions**: Always justify what's not covered
5. **Link to Requirements**: Every coverage requirement should trace to a business requirement
6. **Keep Sketches Abstract**: Don't put concrete values in sketches - that's for implementations
7. **Use Context Variations**: Same functionality via different paths is different testing
8. **Categorize Outcomes**: Focus on outcome types, not specific assertions
9. **Review Coverage Gaps**: Regularly analyze gaps and prioritize closure
10. **Maintain Traceability**: Keep cross-layer references current as other layers evolve

## Code Generation

Test coverage specs enable generation of:

```yaml
Analysis:
  - Coverage gap reports
  - Traceability matrices
  - Test case templates
  - Pairwise combination tables

Test Scaffolding:
  - Gherkin feature file skeletons
  - Postman collection structures
  - Test data fixtures based on partitions
  - Parameterized test templates

Documentation:
  - Test plan documents
  - Coverage summary reports
  - Requirements traceability matrices
```

This Testing Layer provides a declarative model for test coverage planning, enabling systematic identification of what should be tested and traceability from business requirements to test implementations.
