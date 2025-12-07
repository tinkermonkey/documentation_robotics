# Navigation Layer - Custom Navigation Specification

## Overview

The Navigation Layer defines the application's routing, navigation flows, and transitions between experiences. This is a **custom specification** as no standard adequately addresses the combination of channel-agnostic routing, guards, and navigation flows needed for modern multi-channel applications.

## Layer Characteristics

- **Standard**: Custom Specification (YAML format)
- **Custom Extensions**: Complete custom specification
- **Validation**: Custom JSON Schema validator
- **Tooling**: Custom validation, route generation, navigation testing

## Why Custom?

No existing standard covers our navigation needs:

- **URL Routing**: Too framework-specific and web-centric (React Router, Vue Router, etc.)
- **OpenAPI paths**: Focused on API, not experience navigation
- **Sitemap XML**: Too simplistic, no guards or flows
- **State machines**: Don't capture multi-channel routing
- **Voice flow specs**: Channel-specific, not unified

Our Navigation spec provides:

1. Channel-agnostic route definitions
2. Navigation transitions and flows
3. Guard conditions for access control
4. Support for URL-based, intent-based, and event-based routing
5. Deep linking across channels

## Entity Definitions

### NavigationGraph

```yaml
NavigationGraph:
  description: "Complete navigation structure for application"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (spec version)
    application: string (application identifier)
    description: string (optional)

  contains:
    - routes: Route[] (1..*)
    - transitions: NavigationTransition[] (0..*)
    - guards: NavigationGuard[] (0..*)

  references:
    - archimateElement: Element.id (ApplicationComponent)

  # Motivation Layer Integration
  governedByPrinciples: string[] (Navigation/UX Principle IDs, optional)
```

### Route

```yaml
Route:
  description: "Single route/destination in the application (channel-agnostic)"
  attributes:
    id: string (UUID) [PK]
    name: string
    title: string (optional)
    description: string (optional)
    type: RouteType [enum]

  references:
    - experience: string (UX spec reference)
    - archimateRef: Element.id (ApplicationComponent)
    - guards: NavigationGuard[] (0..*)
    - parent: Route.identifier (for nested routes, optional)
    - redirectTo: Route.identifier (for redirects, optional)

  # Motivation Layer Integration
  motivation:
    fulfillsRequirements: string[] (Requirement IDs this route fulfills, optional)

  # Channel-specific addressing
  addressing:
    url: string (for visual channel, e.g., "/products/:id")
    intent: string (for voice channel, e.g., "CheckOrderStatus")
    event: string (for chat channel, e.g., "order.status.requested")
    keyword: string (for SMS channel, e.g., "STATUS")

  enums:
    RouteType:
      - experience # Routes to an experience
      - redirect # Redirects to another route
      - external # Links to external resource

  examples:
    # Visual route (URL-based)
    - identifier: "product-list"
      name: "Product List"
      title: "Products"
      type: experience
      experience: "product-list.ux.yaml"
      addressing:
        url: "/products"

    # Multi-channel route
    - identifier: "product-detail"
      name: "Product Detail"
      title: "Product Details"
      type: experience
      experience: "product-detail.ux.yaml"
      guards: ["authenticated"]
      addressing:
        url: "/products/:id"
        intent: "ShowProductDetail"
        event: "product.detail.requested"

    # Voice-only route
    - identifier: "order-status-check"
      name: "Check Order Status"
      title: "Order Status"
      type: experience
      experience: "order-status-voice.ux.yaml"
      addressing:
        intent: "CheckOrderStatus"
        keyword: "STATUS"

    # Nested route
    - identifier: "product-edit"
      name: "Edit Product"
      title: "Edit Product"
      type: experience
      experience: "product-edit.ux.yaml"
      parent: "product-detail"
      guards: ["authenticated", "has-edit-permission"]
      addressing:
        url: "/products/:id/edit"

    # Redirect
    - identifier: "home"
      type: redirect
      redirectTo: "product-list"
      addressing:
        url: "/"

    # Not found
    - identifier: "not-found"
      name: "Not Found"
      title: "Page Not Found"
      type: experience
      experience: "not-found.ux.yaml"
      addressing:
        url: "*"
```

### RouteMeta

```yaml
RouteMeta:
  description: "Route metadata"
  attributes:
    id: string (UUID) [PK]
    name: string
    requiresAuth: boolean (optional)
    roles: string[] (required roles, optional)
    permissions: string[] (required permissions, optional)
    layout: string (layout component name, optional)
    breadcrumb: BreadcrumbConfig (optional)
    keepAlive: boolean (cache component)
    transition: string (page transition name, optional)

  seo:
    metaTitle: string (optional, overrides title)
    metaDescription: string (optional)
    metaKeywords: string[] (optional)
    ogImage: string (Open Graph image URL, optional)
    canonical: string (canonical URL, optional)
    noIndex: boolean (optional)

  analytics:
    trackPageView: boolean (optional)
    eventCategory: string (optional)
    customDimensions: object (optional)
```

### NavigationTransition

```yaml
NavigationTransition:
  description: "Transition from one route to another"
  attributes:
    id: string (UUID) [PK]
    name: string
    from: string [FK -> Route.identifier]
    to: string [FK -> Route.identifier]
    trigger: NavigationTrigger [enum]
    description: string (optional)

  contains:
    - guards: NavigationGuard[] (0..*)

  enums:
    NavigationTrigger:
      - user-action # User initiated (click, voice command, etc.)
      - submit # Form/data submission
      - success # Previous action succeeded
      - failure # Previous action failed
      - cancel # User cancelled
      - automatic # Automatic navigation
      - deeplink # Deep link activation
      - back # Navigate back
      - timeout # Time-based trigger

  examples:
    # List to detail
    - from: "product-list"
      to: "product-detail"
      trigger: user-action
      description: "User selected a product"

    # Detail to edit
    - from: "product-detail"
      to: "product-edit"
      trigger: user-action
      guards: ["has-edit-permission"]
      description: "User clicked edit button"

    # Edit success to detail
    - from: "product-edit"
      to: "product-detail"
      trigger: success
      description: "Product saved successfully"

    # Cancel edit back to detail
    - from: "product-edit"
      to: "product-detail"
      trigger: cancel
      description: "User cancelled editing"

    # Voice navigation
    - from: "order-status-check"
      to: "order-detail"
      trigger: success
      description: "Order found, showing details"
```

### NavigationGuard

```yaml
NavigationGuard:
  description: "Guard condition for route access"
  attributes:
    id: string (UUID) [PK]
    name: string [PK]
    type: GuardType [enum]
    description: string (optional)
    order: integer (execution order, optional)

  # Motivation Layer Integration
  motivation:
    enforcesRequirement: string (Requirement ID this guard enforces, optional)

  # API Layer Integration
  api:
    operationId: string (API operation this guard calls, optional)
    method: HttpMethod (GET, POST, PUT, DELETE, PATCH, optional)

  enums:
    GuardType:
      - authentication # User must be logged in
      - authorization # User must have role/permission
      - validation # Route params must be valid
      - data-loaded # Required data must be loaded
      - custom # Custom guard logic

    HttpMethod:
      - GET
      - POST
      - PUT
      - DELETE
      - PATCH
      - HEAD
      - OPTIONS

  examples:
    # Authentication guard
    - name: "authenticated"
      type: authentication
      condition:
        expression: "user.isAuthenticated"
      motivation:
        enforcesRequirement: "req-user-authentication"
      onDeny:
        action: redirect
        target: "/login"
        preserveUrl: true # Return to requested page after login

    # Role-based authorization
    - name: "admin-only"
      type: authorization
      condition:
        expression: "user.hasRole('admin')"
      motivation:
        enforcesRequirement: "req-admin-access-control"
      onDeny:
        action: redirect
        target: "/forbidden"
        message: "Admin access required"

    # Permission-based authorization
    - name: "has-edit-permission"
      type: authorization
      condition:
        expression: "user.hasPermission('product.edit')"
      motivation:
        enforcesRequirement: "req-role-based-access-control"
      onDeny:
        action: redirect
        target: "product-detail"
        message: "You don't have permission to edit products"

    # Data validation
    - name: "valid-product-id"
      type: validation
      condition:
        expression: "isValidIdentifier(routeData.id)"
      motivation:
        enforcesRequirement: "req-input-validation"
      onDeny:
        action: redirect
        target: "product-list"
        message: "Invalid product ID"

    # Resource existence (with API integration)
    - name: "product-exists"
      type: data-loaded
      condition:
        expression: "await productService.exists(routeData.id)"
      motivation:
        enforcesRequirement: "req-data-availability-check"
      api:
        operationId: "checkProductExists"
        method: GET
      onDeny:
        action: redirect
        target: "not-found"
```

### GuardCondition

```yaml
GuardCondition:
  description: "Condition expression for guard"
  attributes:
    id: string (UUID) [PK]
    name: string
    expression: string (boolean expression)
    async: boolean (optional)
    timeout: integer (milliseconds, for async, optional)

  examples:
    # Synchronous
    - expression: "user.isAuthenticated"
      async: false

    # Asynchronous (API call)
    - expression: "await checkPermission(user.id, 'product.edit')"
      async: true
      timeout: 5000

    # Complex expression
    - expression: |
        user.isAuthenticated &&
        (user.hasRole('admin') || user.hasRole('editor'))
      async: false
```

### GuardAction

```yaml
GuardAction:
  description: "Action when guard denies access"
  attributes:
    id: string (UUID) [PK]
    name: string
    action: GuardActionType [enum]
    target: string (route identifier, for redirect)
    message: string (error message, optional)
    preserveRoute: boolean (save requested route)

  enums:
    GuardActionType:
      - redirect # Redirect to another route
      - show-error # Show error message, stay on current route
      - navigate-back # Go back to previous route
      - abort # Abort navigation silently

  examples:
    # Redirect to login
    - action: redirect
      target: "login"
      preserveRoute: true

    # Show error
    - action: show-error
      message: "Access denied"

    # Go back
    - action: navigate-back
      message: "You don't have permission for this action"
```

### NavigationFlow

```yaml
NavigationFlow:
  description: "Sequence of routes that realizes a business process"
  attributes:
    id: string (UUID) [PK]
    name: string [PK]
    description: string (optional)

  # Motivation Layer Integration
  motivation:
    supportsGoals: string[] (Goal IDs this flow supports, optional)
    deliversValue: string[] (Value IDs this flow delivers, optional)

  # Business Layer Integration
  business:
    realizesProcess: string (BusinessProcess ID)
    realizesServices: string[] (BusinessService IDs, optional)

  # Shared State
  sharedContext:
    - contextVariables: ContextVariable[] (0.*)

  # Process Tracking
  processTracking: ProcessTracking (optional)

  # Analytics
  analytics: FlowAnalytics (optional)

  # Flow Steps
  contains:
    - steps: FlowStep[] (1..*)

  examples:
    - name: "order-fulfillment"
      description: "Complete order fulfillment user journey"
      business:
        realizesProcess: "bp-order-fulfillment"
        realizesServices: ["bs-order-processing", "bs-payment-processing"]
      sharedContext:
        - name: "shoppingCart"
          schemaRef: "schemas/cart.json"
          scope: flow
          persistedIn: session-storage
      steps:
        # Multiple FlowSteps...
```

### FlowStep

```yaml
FlowStep:
  description: "One step in a navigation flow"
  attributes:
    id: string (UUID) [PK]
    sequence: integer (step order)
    route: string [FK -> Route.identifier]
    name: string (step name, e.g., "Browse Products")
    description: string (optional)
    required: boolean (optional) # Can this step be skipped?

  # Experience Entry/Exit
  experience:
    entryState: string (which UXSpec state to enter at, optional)
    exitTrigger: string (what triggers move to next step)

  # Data Transfer
  dataTransfer:
    inputs: DataMapping[] (data coming into this step, optional)
    outputs: DataMapping[] (data going out of this step, optional)

  # Conditional Execution
  condition: Condition (when this step applies, optional)

  # Branching
  nextStep:
    onSuccess: integer (next sequence number)
    onFailure: integer (fallback sequence number, optional)
    onCancel: integer (cancel sequence number, optional)

  # Compensating Transactions (Gap #6)
  compensation:
    enabled: boolean (optional)
    compensationStep: integer (step to execute for rollback, optional)
    compensationAction: string (API operation or action to undo, optional)

  # Async/Long-Running Integration (Gap #7)
  async:
    longRunning: boolean (optional)
    pollingInterval: integer (polling interval in ms, optional)
    timeout: integer (timeout in ms, optional)
    statusEndpoint: string (API endpoint to check status, optional)
    webhookEvent: string (webhook event name for completion, optional)

  # Multi-User/Collaborative Workflows (Gap #4)
  collaboration:
    assignedTo: string (JSONPath to user/role assignment, optional)
    waitingFor: WaitType [enum] (what this step is waiting for, optional)
    notifyAction: NotificationAction (notification to send, optional)

  enums:
    WaitType:
      - user-action # Waiting for user to act
      - approval # Waiting for approval
      - external-event # Waiting for external system
      - timeout # Time-based wait

  examples:
    # Simple step
    - sequence: 1
      route: "product-list"
      name: "Browse Products"
      nextStep:
        onSuccess: 2

    # Step with data transfer
    - sequence: 2
      route: "product-detail"
      name: "View Product"
      dataTransfer:
        inputs:
          - source: "$.sharedContext.selectedProduct.id"
            target: "$.routeParams.id"
        outputs:
          - source: "$.product"
            target: "$.sharedContext.shoppingCart.items[]"
      nextStep:
        onSuccess: 3
        onCancel: 1

    # Conditional step
    - sequence: 3
      route: "special-offer"
      name: "Show Special Offer"
      condition:
        expression: "user.isNew && cart.total > 100"
      required: false
      nextStep:
        onSuccess: 4

    # Approval step (multi-user)
    - sequence: 5
      route: "order-approval"
      name: "Manager Approval"
      collaboration:
        assignedTo: "$.order.approverUserId"
        waitingFor: approval
        notifyAction:
          type: email
          template: "order-approval-request"
          recipients: "$.order.approverEmail"
      nextStep:
        onSuccess: 6
        onFailure: 2 # Return to edit

    # Async payment processing
    - sequence: 6
      route: "payment-processing"
      name: "Process Payment"
      async:
        longRunning: true
        pollingInterval: 2000
        timeout: 30000
        statusEndpoint: "getPaymentStatus"
        webhookEvent: "payment.completed"
      compensation:
        enabled: true
        compensationAction: "refundPayment"
      nextStep:
        onSuccess: 7
        onFailure: 2
```

### ContextVariable

```yaml
ContextVariable:
  description: "Shared variable across flow steps (Gap #1: Cross-experience state)"
  attributes:
    id: string (UUID) [PK]
    name: string [PK within flow]
    schemaRef: string (JSON Schema reference)
    scope: ContextScope [enum]
    persistedIn: StorageType [enum]
    defaultValue: any (optional)

  enums:
    ContextScope:
      - flow # Scoped to this flow instance
      - session # Scoped to user session
      - user # Scoped to user (persisted)

    StorageType:
      - memory # In-memory only
      - session-storage # Browser session storage
      - local-storage # Browser local storage
      - server-session # Server-side session
      - database # Persisted to DB

  examples:
    # Shopping cart (session-scoped)
    - name: "shoppingCart"
      schemaRef: "schemas/cart.json"
      scope: flow
      persistedIn: session-storage

    # User preferences (user-scoped)
    - name: "userPreferences"
      schemaRef: "schemas/preferences.json"
      scope: user
      persistedIn: database

    # Temporary selection (flow-scoped)
    - name: "selectedProduct"
      schemaRef: "schemas/product.json"
      scope: flow
      persistedIn: memory

    # Process correlation (flow-scoped)
    - name: "orderId"
      schemaRef: "schemas/order.json#/properties/id"
      scope: flow
      persistedIn: server-session
```

### DataMapping

```yaml
DataMapping:
  description: "Maps data between flow context and experience (Gap #2: Data handoff)"
  attributes:
    id: string (UUID) [PK]
    name: string
    source: string (JSONPath to source data)
    target: string (JSONPath to target location)
    transform: string (optional transformation expression)
    required: boolean (optional)

  examples:
    # Simple mapping
    - source: "$.selectedProduct.id"
      target: "$.routeParams.id"
      required: true

    # With transformation
    - source: "$.product"
      target: "$.sharedContext.shoppingCart.items[]"
      transform: "addToCart(product, quantity)"

    # Multiple mappings
    - source: "$.sharedContext.shoppingCart"
      target: "$.checkoutData.cart"
      required: true

    - source: "$.order.id"
      target: "$.sharedContext.orderId"
      required: true
```

### ProcessTracking

```yaml
ProcessTracking:
  description: "Tracks business process instance across flow (Gap #3: Process correlation)"
  attributes:
    id: string (UUID) [PK]
    name: string
    processInstanceId: string (JSONPath to correlation ID)
    resumable: boolean (optional)
    timeoutMinutes: integer (flow timeout, optional)
    stateCheckpoint: boolean (save state after each step)

  examples:
    # Order fulfillment tracking
    - processInstanceId: "$.orderId"
      resumable: true
      timeoutMinutes: 30
      stateCheckpoint: true

    # Non-resumable flow
    - processInstanceId: "$.sessionId"
      resumable: false
```

### FlowAnalytics

```yaml
FlowAnalytics:
  description: "Analytics for funnel tracking (Gap #9: Funnel analytics)"
  attributes:
    id: string (UUID) [PK]
    name: string
    funnelMetrics: string[] (metric IDs for funnel tracking)
    conversionGoal: string (final step identifier)
    dropoffAlerts: DropoffAlertConfig (optional)

  DropoffAlertConfig:
    enabled: boolean (optional)
    threshold: number (alert if drop-off exceeds %, 0-100)

  examples:
    - funnelMetrics:
        - "funnel.product-list.entry"
        - "funnel.product-detail.entry"
        - "funnel.checkout.entry"
        - "funnel.order.completion"
      conversionGoal: "order-placed"
      dropoffAlerts:
        enabled: true
        threshold: 20
```

### NotificationAction

```yaml
NotificationAction:
  description: "Notification to send during flow step"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: NotificationType [enum]
    template: string (template identifier)
    recipients: string (JSONPath to recipients)

  enums:
    NotificationType:
      - email
      - sms
      - push
      - webhook

  examples:
    - type: email
      template: "order-approval-request"
      recipients: "$.order.approverEmail"

    - type: push
      template: "order-status-update"
      recipients: "$.order.customerUserId"
```

## Complete Example: Product Navigation

```yaml
# File: specs/navigation/product-navigation.yaml
version: "0.1.1"
application: "product-management"
description: "Navigation structure for product management application"

# Motivation Layer Integration
governedByPrinciples:
  - "principle-user-centric-navigation"
  - "principle-multi-channel-navigation"
  - "principle-accessibility"

# ============================================================
# Routes
# ============================================================
routes:
  # Home/Redirect
  - identifier: "home"
    name: "Home"
    type: redirect
    redirectTo: "product-list"
    addressing:
      url: "/"

  # Product List
  - identifier: "product-list"
    name: "Product List"
    title: "Products"
    type: experience
    experience: "product-list.ux.yaml"
    archimateRef: "app-comp-product-list-ui"
    motivation:
      fulfillsRequirements:
        - "req-product-browsing"
        - "req-search-functionality"
    addressing:
      url: "/products"
    meta:
      requiresAuth: false
      seo:
        metaTitle: "Product Catalog"
        metaDescription: "Browse our product catalog"

  # Product Detail
  - identifier: "product-detail"
    name: "Product Detail"
    title: "Product Details"
    type: experience
    experience: "product-detail.ux.yaml"
    archimateRef: "app-comp-product-detail-ui"
    guards: ["valid-product-id", "product-exists"]
    motivation:
      fulfillsRequirements:
        - "req-product-detail-view"
        - "req-multi-channel-support"
    addressing:
      url: "/products/:id"
      intent: "ShowProductDetail"
    meta:
      requiresAuth: false
      keepAlive: true

  # Product Edit
  - identifier: "product-edit"
    name: "Edit Product"
    title: "Edit Product"
    type: experience
    experience: "product-edit.ux.yaml"
    archimateRef: "app-comp-product-edit-ui"
    parent: "product-detail"
    guards: ["authenticated", "has-edit-permission", "product-exists"]
    motivation:
      fulfillsRequirements:
        - "req-product-data-management"
        - "req-role-based-access-control"
        - "req-real-time-validation"
    addressing:
      url: "/products/:id/edit"
    meta:
      requiresAuth: true
      permissions: ["product.edit"]

  # Product Create
  - identifier: "product-create"
    name: "Create Product"
    title: "Create Product"
    type: experience
    experience: "product-edit.ux.yaml"
    guards: ["authenticated", "has-create-permission"]
    motivation:
      fulfillsRequirements:
        - "req-product-creation"
        - "req-role-based-access-control"
    addressing:
      url: "/products/new"
    meta:
      requiresAuth: true
      permissions: ["product.create"]

  # Order Status (Voice)
  - identifier: "order-status-voice"
    name: "Check Order Status"
    title: "Order Status"
    type: experience
    experience: "order-status-voice.ux.yaml"
    guards: ["authenticated"]
    addressing:
      intent: "CheckOrderStatus"
      keyword: "STATUS"

  # Not Found
  - identifier: "not-found"
    name: "Not Found"
    title: "Page Not Found"
    type: experience
    experience: "not-found.ux.yaml"
    addressing:
      url: "*"
    meta:
      seo:
        noIndex: true

# ============================================================
# Navigation Transitions
# ============================================================
transitions:
  # List to Detail
  - from: "product-list"
    to: "product-detail"
    trigger: user-action
    description: "User selected a product from list"

  # Detail to Edit
  - from: "product-detail"
    to: "product-edit"
    trigger: user-action
    guards: ["has-edit-permission"]
    description: "User clicked edit button"

  # Edit Save Success back to Detail
  - from: "product-edit"
    to: "product-detail"
    trigger: success
    description: "Product saved successfully"

  # Edit Cancel back to Detail
  - from: "product-edit"
    to: "product-detail"
    trigger: cancel
    description: "User cancelled editing"

  # Delete Success back to List
  - from: "product-detail"
    to: "product-list"
    trigger: success
    description: "Product deleted successfully"

  # Voice: Order status to detail
  - from: "order-status-voice"
    to: "product-detail"
    trigger: success
    description: "Order found, showing product details"

# ============================================================
# Navigation Guards
# ============================================================
guards:
  # Authentication
  - name: "authenticated"
    type: authentication
    description: "User must be logged in"
    condition:
      expression: "user.isAuthenticated"
    motivation:
      enforcesRequirement: "req-user-authentication"
    onDeny:
      action: redirect
      target: "login"
      preserveRoute: true

  # Create Permission
  - name: "has-create-permission"
    type: authorization
    description: "User must have product creation permission"
    condition:
      expression: "user.hasPermission('product.create')"
      async: false
    motivation:
      enforcesRequirement: "req-role-based-access-control"
    onDeny:
      action: redirect
      target: "product-list"
      message: "You don't have permission to create products"

  # Edit Permission
  - name: "has-edit-permission"
    type: authorization
    description: "User must have product edit permission"
    condition:
      expression: "user.hasPermission('product.edit')"
    motivation:
      enforcesRequirement: "req-role-based-access-control"
    onDeny:
      action: redirect
      target: "product-detail"
      message: "You don't have permission to edit products"

  # Valid Identifier
  - name: "valid-product-id"
    type: validation
    description: "Product ID must be valid"
    condition:
      expression: "isValidIdentifier(routeData.id)"
    motivation:
      enforcesRequirement: "req-input-validation"
    onDeny:
      action: redirect
      target: "product-list"
      message: "Invalid product ID"

  # Product Exists
  - name: "product-exists"
    type: data-loaded
    description: "Product must exist"
    condition:
      expression: "await productService.exists(routeData.id)"
      async: true
      timeout: 5000
    motivation:
      enforcesRequirement: "req-data-availability-check"
    api:
      operationId: "checkProductExists"
      method: GET
    onDeny:
      action: redirect
      target: "not-found"

# ============================================================
# Navigation Flows (NEW - Addresses Gaps #1-9)
# ============================================================
flows:
  # Main order fulfillment flow
  - name: "order-fulfillment"
    description: "Complete order fulfillment user journey"

    # Motivation Layer Integration
    motivation:
      supportsGoals:
        - "goal-customer-satisfaction"
        - "goal-revenue-growth"
        - "goal-order-processing-efficiency"
      deliversValue:
        - "value-convenience"
        - "value-transaction-security"
        - "value-operational-efficiency"

    # Business Layer Integration (Gap #3: Process correlation)
    business:
      realizesProcess: "bp-order-fulfillment"
      realizesServices: ["bs-order-processing", "bs-payment-processing"]

    # Shared Context (Gap #1: Cross-experience state management)
    sharedContext:
      - name: "shoppingCart"
        schemaRef: "schemas/cart.json"
        scope: flow
        persistedIn: session-storage

      - name: "selectedProduct"
        schemaRef: "schemas/product.json"
        scope: flow
        persistedIn: memory

      - name: "orderId"
        schemaRef: "schemas/order.json#/properties/id"
        scope: flow
        persistedIn: server-session

    # Process Tracking (Gap #3: Long-running process correlation)
    processTracking:
      processInstanceId: "$.orderId"
      resumable: true
      timeoutMinutes: 30
      stateCheckpoint: true

    # Analytics (Gap #9: Funnel analytics tracking)
    analytics:
      funnelMetrics:
        - "funnel.product-list.entry"
        - "funnel.product-detail.entry"
        - "funnel.checkout.entry"
        - "funnel.order.completion"
      conversionGoal: "order-placed"
      dropoffAlerts:
        enabled: true
        threshold: 20

    # Flow Steps
    steps:
      # Step 1: Browse Products
      - sequence: 1
        route: "product-list"
        name: "Browse Products"
        description: "User browses product catalog"
        required: true
        experience:
          entryState: "initial"
          exitTrigger: "product-selected"
        dataTransfer:
          outputs:
            - source: "$.selectedProduct"
              target: "$.sharedContext.selectedProduct"
              required: true
        nextStep:
          onSuccess: 2

      # Step 2: View Product Details (Gap #2: Data handoff)
      - sequence: 2
        route: "product-detail"
        name: "View Product"
        description: "User views selected product details"
        required: true
        experience:
          entryState: "loading"
          exitTrigger: "add-to-cart"
        dataTransfer:
          inputs:
            - source: "$.sharedContext.selectedProduct.id"
              target: "$.routeParams.id"
              required: true
          outputs:
            - source: "$.product"
              target: "$.sharedContext.shoppingCart.items[]"
              transform: "addToCart(product, quantity)"
        nextStep:
          onSuccess: 3
          onCancel: 1 # Back to list (Gap #8: Error recovery)

      # Step 3: Checkout (Gap #5: Conditional branching)
      - sequence: 3
        route: "checkout"
        name: "Checkout"
        description: "User completes checkout and payment"
        required: true
        experience:
          entryState: "initial"
          exitTrigger: "payment-success"
        dataTransfer:
          inputs:
            - source: "$.sharedContext.shoppingCart"
              target: "$.checkoutData.cart"
              required: true
          outputs:
            - source: "$.order.id"
              target: "$.sharedContext.orderId"
              required: true
        # Async payment processing (Gap #7: Async integration)
        async:
          longRunning: true
          pollingInterval: 2000
          timeout: 30000
          statusEndpoint: "getPaymentStatus"
          webhookEvent: "payment.completed"
        # Compensation for payment rollback (Gap #6: Compensating transactions)
        compensation:
          enabled: true
          compensationAction: "refundPayment"
        nextStep:
          onSuccess: 4
          onFailure: 2 # Payment failed, return to product detail
          onCancel: 1 # Cancel checkout

      # Step 4: Confirmation
      - sequence: 4
        route: "order-confirmation"
        name: "Order Confirmation"
        description: "User sees order confirmation"
        required: true
        experience:
          entryState: "loading"
          exitTrigger: "complete"
        dataTransfer:
          inputs:
            - source: "$.sharedContext.orderId"
              target: "$.routeParams.orderId"
              required: true

  # Alternative flow: Quick reorder (Gap #5: Conditional workflow branching)
  - name: "quick-reorder"
    description: "Returning customers can reorder from order history"

    # Motivation Layer Integration
    motivation:
      supportsGoals:
        - "goal-customer-retention"
        - "goal-repeat-purchase-rate"
      deliversValue:
        - "value-convenience"
        - "value-time-savings"

    business:
      realizesProcess: "bp-order-fulfillment"
      realizesServices: ["bs-order-processing"]

    sharedContext:
      - name: "previousOrder"
        schemaRef: "schemas/order.json"
        scope: flow
        persistedIn: server-session

    steps:
      - sequence: 1
        route: "order-history"
        name: "Select Previous Order"
        description: "User selects order to reorder"
        condition:
          expression: "user.isAuthenticated && user.hasOrderHistory"
        nextStep:
          onSuccess: 2

      - sequence: 2
        route: "checkout"
        name: "Confirm Reorder"
        dataTransfer:
          inputs:
            - source: "$.sharedContext.previousOrder.items"
              target: "$.checkoutData.cart.items"
        nextStep:
          onSuccess: 3

      - sequence: 3
        route: "order-confirmation"
        name: "Confirmation"

  # Approval flow example (Gap #4: Multi-user collaborative workflows)
  - name: "high-value-order-approval"
    description: "Orders over $10,000 require manager approval"

    # Motivation Layer Integration
    motivation:
      supportsGoals:
        - "goal-financial-control"
        - "goal-fraud-prevention"
      deliversValue:
        - "value-risk-mitigation"
        - "value-compliance"

    business:
      realizesProcess: "bp-order-approval"

    sharedContext:
      - name: "orderId"
        schemaRef: "schemas/order.json#/properties/id"
        scope: flow
        persistedIn: server-session

    steps:
      - sequence: 1
        route: "order-detail"
        name: "Review Order"
        description: "Manager reviews high-value order"
        condition:
          expression: "order.total > 10000"
        nextStep:
          onSuccess: 2

      # Multi-user step (Gap #4: Collaboration)
      - sequence: 2
        route: "order-approval"
        name: "Manager Approval"
        description: "Waiting for manager approval"
        collaboration:
          assignedTo: "$.order.approverUserId"
          waitingFor: approval
          notifyAction:
            type: email
            template: "order-approval-request"
            recipients: "$.order.approverEmail"
        nextStep:
          onSuccess: 3
          onFailure: 1 # Rejection, return to review

      - sequence: 3
        route: "order-processing"
        name: "Process Approved Order"
        description: "Order approved, processing payment"
        nextStep:
          onSuccess: 4

      - sequence: 4
        route: "order-confirmation"
        name: "Confirmation"
```

## Integration Points

**For complete link patterns and validation rules**, see [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md). The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer

- **Principles guide navigation**: `NavigationGraph.governedByPrinciples` ensures navigation follows UX Principles (user-centric, accessibility, multi-channel, etc.)
- **Flows support Goals**: `NavigationFlow.motivation.supportsGoals` links user journeys to business objectives, enabling goal-based impact analysis
- **Flows deliver Value**: `NavigationFlow.motivation.deliversValue` shows which stakeholder values are delivered through user journeys
- **Routes fulfill Requirements**: `Route.motivation.fulfillsRequirements` enables requirements traceability from requirements through navigation to implementation
- **Guards enforce Requirements**: `NavigationGuard.motivation.enforcesRequirement` creates audit trail proving security/access control requirements are enforced
- **End-to-end traceability**: Stakeholder → Goal → NavigationFlow → Route → UXSpec → Metrics enables complete value chain validation
- **Compliance support**: NavigationGuard → Requirement traceability is critical for security audits (SOC 2, ISO 27001, NIST)

### To Business Layer

- **NavigationFlow realizes BusinessProcess**: `NavigationFlow.business.realizesProcess` links flows to BusinessProcess entities
- **Flows realize BusinessServices**: `NavigationFlow.business.realizesServices` shows which services are delivered through the flow
- **Process instance tracking**: `ProcessTracking.processInstanceId` correlates UX flow with business process instances
- **End-to-end traceability**: BusinessProcess → NavigationFlow → UXSpec → Implementation provides complete audit trail

### To ArchiMate Application Layer

- Route references ApplicationComponent via archimateRef
- Navigation structure maps to application structure

### To UX Layer

- **Route to Experience**: Route.experience references UX spec file
- **View to Route**: View.route references Route.identifier
- **Action navigation**: ActionComponent navigation actions reference Route.identifier
- **State to transition**: Navigation transitions trigger ExperienceState changes
- **Flow entry points**: FlowStep.experience.entryState specifies which UXSpec state to enter
- **Data handoff**: FlowStep.dataTransfer maps data between flow context and UX experience state

### To API Layer

- **Guards call API operations**: `NavigationGuard.api.operationId` explicitly references API operations used for validation (e.g., checking resource existence, authorization)
- **Guard API methods**: `NavigationGuard.api.method` specifies HTTP method used for guard validation calls
- **Experience state actions**: Trigger navigation transitions
- **Async integration**: `FlowStep.async` defines long-running API operations with polling/webhooks
- **Compensation actions**: `FlowStep.compensation.compensationAction` references API operations for rollback
- **Dependency analysis**: Explicit guard → API links enable architectural analysis of navigation dependencies

### To Security Layer

- RouteMeta.roles/permissions reference SecurityModel
- NavigationGuard enforces access control
- Authentication/authorization integration
- **Collaborative flows**: FlowStep.collaboration.assignedTo enforces role-based task assignment

### To Data Model Layer

- **Context variables**: ContextVariable.schemaRef references JSON Schema definitions
- **Type safety**: Shared context variables are typed via JSON Schema
- **Data validation**: DataMapping ensures type-safe data transfer between experiences

### To APM/Observability Layer

- **Funnel metrics**: FlowAnalytics.funnelMetrics tracks conversion through flow steps
- **Drop-off alerts**: FlowAnalytics.dropoffAlerts triggers alerts when users abandon flows
- **Process monitoring**: ProcessTracking enables flow instance monitoring and recovery
- **End-to-end tracing**: Flow instance ID enables distributed tracing across experiences

## Validation

```yaml
# Core Navigation Validation
Core Checks:
  - All route identifiers are unique
  - All route names are unique
  - Guard references exist
  - Parent routes exist (for nested routes)
  - No circular route dependencies
  - Redirect targets exist (Route.redirectTo)
  - Experience references exist (UX spec files)
  - Route addressing is appropriate for channel
  - NavigationTransition from/to routes exist

# NavigationFlow Validation (NEW)
Flow Structure:
  - All flow names are unique
  - All FlowStep.route references must exist in routes[]
  - All FlowStep.sequence numbers are unique within a flow
  - FlowStep.sequence numbers should be sequential (1, 2, 3...)
  - At least one step must exist per flow

Flow Branching:
  - All FlowStep.nextStep.onSuccess must reference valid sequence numbers
  - All FlowStep.nextStep.onFailure must reference valid sequence numbers
  - All FlowStep.nextStep.onCancel must reference valid sequence numbers
  - No circular step dependencies
  - All branching paths must eventually lead to a terminal step or loop back validly

Data Flow:
  - All ContextVariable names are unique within a flow
  - All ContextVariable.schemaRef must reference valid JSON Schema files
  - All DataMapping.source JSONPaths are valid
  - All DataMapping.target JSONPaths are valid
  - Required DataMappings must have source data available

Motivation Integration:
  - All NavigationFlow.motivation.supportsGoals must reference valid Goal IDs
  - All NavigationFlow.motivation.deliversValue must reference valid Value IDs
  - All Route.motivation.fulfillsRequirements must reference valid Requirement IDs
  - All NavigationGuard.motivation.enforcesRequirement must reference valid Requirement ID
  - If NavigationGuard.type is 'authentication' or 'authorization', it SHOULD have motivation.enforcesRequirement (warning)

Business Integration:
  - NavigationFlow.business.realizesProcess must reference valid BusinessProcess ID
  - NavigationFlow.business.realizesServices must reference valid BusinessService IDs
  - ProcessTracking.processInstanceId JSONPath must be valid

Experience Integration:
  - FlowStep.experience.entryState must reference valid state in the UX spec
  - FlowStep.experience.exitTrigger should match valid state transition triggers
  - Route.experience file must exist

API Integration:
  - If NavigationGuard.api.operationId is set, it must reference valid OpenAPI operation
  - If NavigationGuard.api.operationId is set, NavigationGuard.api.method should also be set (warning)
  - If NavigationGuard.condition.async is true, consider adding api.operationId for documentation (warning)
  - If NavigationGuard.type is 'data-loaded', consider adding api.operationId (warning)

Async Integration:
  - If FlowStep.async.longRunning is true, either pollingInterval or webhookEvent must be set
  - FlowStep.async.statusEndpoint must reference valid API operation (if polling)
  - FlowStep.async.timeout must be greater than pollingInterval

Compensation:
  - If FlowStep.compensation.enabled is true, either compensationStep or compensationAction must be set
  - FlowStep.compensation.compensationStep must reference valid sequence number
  - FlowStep.compensation.compensationAction should reference valid API operation

Collaboration:
  - FlowStep.collaboration.assignedTo JSONPath must be valid
  - FlowStep.collaboration.notifyAction.recipients JSONPath must be valid
  - FlowStep.collaboration.notifyAction.template should exist

Analytics:
  - FlowAnalytics.funnelMetrics must reference valid metric IDs
  - FlowAnalytics.conversionGoal should reference the final step name or identifier
  - FlowAnalytics.dropoffAlerts.threshold must be between 0 and 100

Context Storage:
  - ContextVariable.scope must be one of: flow, session, user
  - ContextVariable.persistedIn must be one of: memory, session-storage, local-storage, server-session, database
  - If scope is 'user', persistedIn should be database or server-session (warning)
  - If scope is 'flow' and persistedIn is 'memory', data will be lost on page refresh (warning)

Consistency Warnings:
  - If a flow has resumable=true, it should have stateCheckpoint=true (warning)
  - If a flow has compensation steps, it should document rollback strategy (warning)
  - If a flow spans multiple experiences, it should have shared context variables (warning)
  - If a flow has collaborative steps, it should define timeout behavior (warning)
  - If NavigationFlow has business.realizesProcess, it SHOULD have motivation.supportsGoals (warning)
  - If Route has guards, consider adding motivation.fulfillsRequirements for the guarded capability (warning)
  - If NavigationGuard enforces security, it SHOULD have motivation.enforcesRequirement for audit compliance (warning)
```

## Best Practices

### Core Navigation

1. **Unique Identifiers**: Every route must have a unique identifier
2. **Guards**: Use guards for authentication and authorization
3. **Channel Addressing**: Provide appropriate addressing for each channel (URL, intent, event, keyword)
4. **SEO Metadata**: Include meta tags for public visual routes
5. **Deep Linking**: Support deep links across channels
6. **404 Handling**: Always include not-found route
7. **Redirects**: Use redirects for home/default routes
8. **Nested Routes**: Use parent/child for logical hierarchy
9. **Keep Alive**: Cache expensive experiences
10. **Multi-channel**: Design routes that can work across multiple channels where appropriate

### NavigationFlow Best Practices (NEW)

11. **Flow Scope**: Create one flow per business process or major user journey
12. **Shared Context**: Use shared context for data that needs to persist across multiple experiences
13. **Data Handoff**: Always use DataMapping for explicit data transfer between steps
14. **Process Tracking**: Use ProcessTracking for flows that realize business processes
15. **Compensation Strategy**: Define compensation actions for critical transactional steps
16. **Error Paths**: Always define onFailure and onCancel paths for better error recovery
17. **Resumability**: Enable resumable=true for long-running flows that users might abandon and return to
18. **State Checkpoints**: Use stateCheckpoint=true for resumable flows to enable recovery
19. **Analytics**: Add funnel metrics to measure conversion and identify drop-off points
20. **Collaborative Steps**: Use collaboration settings for approval or multi-user workflows
21. **Async Operations**: Define polling or webhook strategies for long-running operations
22. **Context Scope**: Choose appropriate scope for context variables:
    - `flow`: For workflow-specific data (shopping cart, form progress)
    - `session`: For session-wide data (user preferences for this session)
    - `user`: For persistent user data (saved preferences, history)
23. **Context Persistence**: Match persistedIn to scope and durability needs:
    - `memory`: Fast but lost on page refresh
    - `session-storage`: Persists across pages but lost when browser closes
    - `local-storage`: Persists across browser sessions
    - `server-session`: Server-side session, survives page refresh
    - `database`: Permanent storage for user-scoped data
24. **Step Granularity**: Keep FlowSteps at experience-level granularity (not too fine-grained)
25. **Flow Reuse**: Design flows to be reusable (e.g., quick-reorder reuses checkout flow)

## Code Generation

Navigation specs enable generation of:

```yaml
Visual Channel (Web/Mobile):
  - React Router routes
  - Vue Router routes
  - Angular routing modules
  - Framework-agnostic route configs

Voice Channel:
  - Alexa Skill intents
  - Google Actions intents
  - Voice flow routing

Chat Channel:
  - Chatbot event handlers
  - Intent routing
  - Conversation flows

Type Definitions:
  - TypeScript route types
  - Guard types
  - Route data types
  - Flow context types (from ContextVariable schemas)
  - FlowStep types

Navigation Code:
  - Navigation helpers
  - Guard implementations
  - Deep link handlers
  - Multi-channel routing logic

NavigationFlow Code (NEW):
  - Flow orchestration engine
  - Context management (session storage, local storage, server-side)
  - Data mapping transformers
  - Process tracking and correlation
  - Resumability and checkpoint management
  - Compensation/rollback handlers
  - Async operation managers (polling, webhooks)
  - Collaboration handlers (assignment, notification)
  - Funnel analytics tracking
  - Flow state machines

Testing:
  - Route tests
  - Guard tests
  - Navigation flow tests
  - Deep link tests (all channels)
  - Cross-channel navigation tests
  - Flow orchestration tests (NEW)
  - Context persistence tests (NEW)
  - Data mapping tests (NEW)
  - Compensation/rollback tests (NEW)
  - Multi-user collaboration tests (NEW)
  - Process resumability tests (NEW)
  - Funnel analytics tests (NEW)
```

## Gap Coverage Summary

NavigationFlow addresses the following identified gaps:

| Gap                               | NavigationFlow Feature                      | How It's Addressed                                                            |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| **#1: Cross-experience state**    | `sharedContext` with `ContextVariable`      | Variables scoped to flow/session/user with configurable persistence           |
| **#2: Data handoff**              | `dataTransfer` with `DataMapping`           | Explicit input/output mappings between steps with transformations             |
| **#3: Process correlation**       | `processTracking` with `processInstanceId`  | Correlates flow instances to business process instances, enables resumability |
| **#4: Multi-user workflows**      | `FlowStep.collaboration`                    | Assignment, approval waits, notifications                                     |
| **#5: Conditional branching**     | `FlowStep.condition` + `nextStep` branching | Guards on steps, onSuccess/onFailure/onCancel paths                           |
| **#6: Compensating transactions** | `FlowStep.compensation`                     | Rollback steps and compensation actions for failed transactions               |
| **#7: Async integration**         | `FlowStep.async`                            | Polling, webhooks, status endpoints for long-running operations               |
| **#8: Error recovery**            | `nextStep.onFailure` + `onCancel`           | Explicit fallback and cancel paths                                            |
| **#9: Funnel analytics**          | `FlowAnalytics`                             | Funnel metrics, conversion goals, drop-off alerts                             |

This Navigation Layer provides a comprehensive, channel-agnostic way to define application navigation with full support for guards, multi-channel routing, and business process orchestration through NavigationFlows.
