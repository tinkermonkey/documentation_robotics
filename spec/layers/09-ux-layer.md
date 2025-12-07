# UX Layer - User Experience Specification

## Overview

The UX Layer defines user experience state management, interaction design, and behavior across multiple channels (visual, voice, chat, SMS). This is a **custom specification** as no standard adequately covers the combination of state machines, component composition, and API integration needed for modern multi-channel applications.

### UXSpec Scope

A **UXSpec** models a **single, routable user experience** such as:

- One screen/page (e.g., product edit form, product list view)
- One form or wizard step
- One conversation flow (voice/chat)
- One user task or interaction

**Not** an entire application - an application contains multiple UXSpecs, connected via the Navigation Layer.

**Relationship to Business Processes:**

- One UXSpec can support multiple BusinessProcesses (via `business.supportsProcesses`)
- One BusinessProcess typically spans multiple UXSpecs (orchestrated via NavigationFlow)
- NavigationFlow in the Navigation Layer orchestrates multiple UXSpecs to realize a complete business process

## Layer Characteristics

- **Standard**: Custom Specification (YAML format)
- **Custom Extensions**: Complete custom specification
- **Validation**: Custom JSON Schema validator
- **Tooling**: Custom validation tools, code generators

## Why Custom?

Existing standards fall short:

- **W3C UI specs**: Too low-level (HTML/CSS), visual-only
- **Design systems**: Too visual, not behavioral or multi-channel
- **State machine specs**: Don't integrate with APIs and data
- **VoiceXML/SCXML**: Channel-specific, not unified
- **Form builders**: Limited to forms, not full experiences

Our UX spec bridges the gap between design and implementation by:

1. Defining experience states and transitions (across channels)
2. Linking user interactions to API operations
3. Mapping components to data schemas
4. Supporting visual, voice, chat, and SMS channels
5. Composing experiences from reusable views and components

## Entity Definitions

### UXSpec

```yaml
UXSpec:
  description: "Complete UX specification for an experience (visual, voice, chat, SMS)"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (optional)
    experience: string (optional)
    channel: ChannelType [enum]
    title: string (optional)

  contains:
    - states: ExperienceState[] (1..*)
    - views: View[] (1..*) # Routable groupings of components
    - globalActions: ActionComponent[] (0..*) # Actions available across all states

  references:
    - application: Element.id [Application] # Links to Application Layer
    - archimateElement: Element.id [ApplicationComponent]
    - dataSchema: string (path to JSON Schema file, optional)
    - apiSpec: string (path to OpenAPI spec file, optional)

  enums:
    ChannelType:
      - visual # Web, mobile app
      - voice # Phone, voice assistant
      - chat # Chatbot, messaging
      - sms # SMS/text messaging
      - multimodal # Multiple channels

  # Motivation Layer Integration
  motivationAlignment:
    supportsGoals: string[] (Goal IDs this experience helps achieve, optional)
    deliversValue: string[] (Value IDs this experience provides, optional)
    governedByPrinciples: string[] (UX/Design Principle IDs, optional)
    fulfillsRequirements: string[] (Requirement IDs this experience fulfills, optional)

  # Business Layer Integration
  business:
    supportsProcesses: string[] (BusinessProcess IDs this experience supports, optional)
    realizesServices: string[] (BusinessService IDs this experience realizes, optional)
    targetActors: string[] (BusinessActor IDs this experience is designed for, optional)
    targetRoles: string[] (BusinessRole IDs this experience is designed for, optional)

  # Security Layer Integration
  security:
    model: string (SecurityModel reference, optional)
    defaultRequiredRoles: string[] (Default roles required for this experience, optional)

  # APM Layer Integration
  apm:
    measuredByMetrics: string[] (Metric names that measure this experience, optional)
    performanceTargets: PerformanceTargets (Optional performance goals)

  PerformanceTargets:
    loadTimeMs: integer (Target load time in milliseconds, optional)
    interactionLatencyMs: integer (Target interaction latency in milliseconds, optional)
    errorRatePercent: number (Target error rate percentage, optional)
    completionRatePercent: number (Target completion rate percentage, optional)
```

### ExperienceState

```yaml
ExperienceState:
  description: "Distinct state that the experience can be in (works across all channels)"
  attributes:
    id: string (UUID) [PK]
    name: string
    initial: boolean (optional)
    description: string (optional)
    channel: ChannelType (optional)

  contains:
    - onEnter: StateAction[] (0..*)
    - onExit: StateAction[] (0..*)
    - transitions: StateTransition[] (0..*)
    - enabledComponents: string[] (0..*)
    - disabledComponents: string[] (0..*)
    - hiddenComponents: string[] (0..*)

  examples:
    # Visual channel states
    - name: "initial"
      initial: true
      channel: visual
      description: "Screen just loaded, no data yet"

    - name: "loading"
      description: "Fetching data from API"

    - name: "viewing"
      channel: visual
      description: "Displaying data in read-only mode"

    - name: "editing"
      channel: visual
      description: "User editing form fields"

    # Voice channel states
    - name: "listening"
      channel: voice
      description: "Listening for user speech input"

    - name: "speaking"
      channel: voice
      description: "Playing audio response to user"

    # Common states (all channels)
    - name: "saving"
      description: "Submitting changes to API"

    - name: "error"
      description: "Error occurred during operation"
```

### StateAction

```yaml
StateAction:
  description: "Action executed during state lifecycle"
  attributes:
    id: string (UUID) [PK]
    name: string
    action: ActionType [enum]
    description: string (optional)

  # API Integration
  api:
    operationId: string (from OpenAPI spec)
    method: HttpMethod (GET, POST, PUT, DELETE, PATCH)
    endpoint: string (optional, if not using operationId)

  # Data Handling
  data:
    source: DataSource [enum] # Where data comes from
    target: string (JSONPath to target location in state)
    transform: string (optional, transformation expression)

  # Error Handling
  errorHandling:
    onError: string (target state on error)
    showNotification: boolean (optional)
    errorMessage: string (optional, custom error message)

  enums:
    ActionType:
      - fetchData # Retrieve data from API
      - saveData # Send data to API
      - deleteData # Delete via API
      - validateForm # Run client-side validation
      - clearForm # Reset form to defaults
      - showNotification # Display message to user
      - navigateTo # Navigate to another screen
      - callAPI # Generic API call
      - updateState # Update local state
      - computeValue # Calculate derived value

    DataSource:
      - api-response # From API response
      - form-data # From form fields
      - route-params # From URL parameters
      - query-params # From URL query string
      - local-storage # From browser storage
      - constant # Fixed value
      - computed # Calculated value
```

### StateTransition

```yaml
StateTransition:
  description: "Transition from current state to another state"
  attributes:
    id: string (UUID) [PK]
    name: string
    to: string (optional)
    on: TriggerType [enum]
    description: string (optional)

  contains:
    - actions: StateAction[] (0..*)

  enums:
    TriggerType:
      - success # Previous action succeeded
      - failure # Previous action failed
      - submit # User clicked submit
      - cancel # User clicked cancel
      - click # User interaction
      - timeout # Timer expired
      - dataReady # Data loaded
      - custom # Custom event
```

### Condition

```yaml
Condition:
  description: "Boolean expression for guard conditions"
  attributes:
    id: string (UUID) [PK]
    name: string
    expression: string (optional)

  examples:
    - expression: "data.status === 'draft'"
      description: "Only allow edit if status is draft"

    - expression: "form.isValid && user.hasPermission('edit')"
      description: "Valid form and user has permission"

    - expression: "items.length > 0"
      description: "At least one item exists"
```

### View

```yaml
View:
  description: "Routable grouping of components (a complete user experience)"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ViewType [enum]
    title: string (optional)
    description: string (optional)
    routable: boolean (optional)
    layout: LayoutStyle (optional)

  contains:
    - subViews: SubView[] (0..*) # Reusable component groupings
    - components: Component[] (0..*) # Direct components in view
    - actions: ActionComponent[] (0..*) # Actions available in view

  references:
    - route: string (route identifier from Navigation Layer, optional)

  # Security Layer Integration
  security:
    resourceRef: string (SecureResource reference - type must be 'screen', optional)
    requiredRoles: string[] (Roles required to access this view, optional)
    requiredPermissions: string[] (Permissions required to access this view, optional)

  enums:
    ViewType:
      - form # Data entry form
      - list # List of items
      - detail # Single item detail view
      - dashboard # Multiple widgets
      - wizard # Multi-step process
      - split # Split screen (master-detail)
      - conversational # Chat/voice interface
      - custom # Custom layout

    LayoutStyle:
      - grid
      - flex
      - stack
      - flow
      - custom
```

### SubView

```yaml
SubView:
  description: "Reusable grouping of components (not directly routable)"
  attributes:
    id: string (UUID) [PK]
    name: string
    title: string (optional)
    description: string (optional)
    collapsible: boolean (optional)
    collapsed: boolean (optional)
    layout: LayoutStyle (optional)
    order: integer (optional)

  contains:
    - components: Component[] (0..*) # Components in this sub-view
    - subViews: SubView[] (0..*) # Nested sub-views

  references:
    - conditionalDisplay: Condition (optional) # Show/hide based on condition

  examples:
    # Form section
    - name: "basic-info"
      title: "Basic Information"
      layout:
        type: grid
        columns: 2
      components:
        -  # Component definitions here

    # Collapsible section
    - name: "advanced-settings"
      title: "Advanced Settings"
      collapsible: true
      collapsed: true
```

### Component

```yaml
Component:
  description: "Atomic UI element (table, form field, graph, custom visualization)"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ComponentType [enum]
    label: string (optional)
    description: string (optional)
    required: boolean (optional)
    readonly: boolean (optional)
    hidden: boolean (optional)
    order: integer (optional)

  # Data Binding
  dataBinding:
    schemaRef: string (JSONPath to property in JSON Schema, optional)
    # e.g., "product-schema.json#/definitions/Product/properties/name"
    defaultValue: any (optional)
    dataSource: string (API operation ID or data reference, optional)

  # Component-specific configuration
  config: ComponentConfig (varies by type)

  # Conditional Display
  conditionalDisplay: Condition (optional)

  # Security Layer Integration
  security:
    fieldAccess: string (Field name in SecureResource for field-level access control, optional)
    visibleToRoles: string[] (Roles that can see this component, optional)
    editableByRoles: string[] (Roles that can edit this component, optional)

  # Dependencies
  dependsOn: string[] (component names, optional)
  triggers: string[] (components to refresh, optional)

  enums:
    ComponentType:
      - form-field # Individual form input
      - table # Data table
      - chart # Chart/graph
      - card # Content card
      - list # Item list
      - text # Static text/label
      - image # Image display
      - video # Video player
      - audio # Audio player (for voice channel)
      - map # Geographic map
      - calendar # Calendar view
      - timeline # Timeline view
      - tree # Tree structure
      - custom # Custom component
```

### ComponentConfig

```
ComponentConfig:
  description: "Type-specific configuration for components"

  # For form-field components
  FormFieldConfig:
    fieldType: FormFieldType [enum]
    placeholder: string (optional)
    helpText: string (optional)
    validation: ValidationRule[] (optional)
    props: object (field-specific properties)

    FormFieldType:
      - text-input
      - textarea
      - number-input
      - email-input
      - password-input
      - url-input
      - phone-input
      - date-picker
      - datetime-picker
      - time-picker
      - select
      - multi-select
      - autocomplete
      - checkbox
      - radio-group
      - toggle
      - slider
      - file-upload
      - image-upload
      - rich-text-editor
      - markdown-editor
      - color-picker
      - rating
      - tags-input

  # For table components
  TableConfig:
    columns: TableColumn[]
    sortable: boolean
    filterable: boolean
    paginated: boolean
    selectable: boolean
    actions: ActionComponent[] (row actions)

  # For chart components
  ChartConfig:
    chartType: ChartType [enum]
    xAxis: string (data field)
    yAxis: string (data field)
    series: ChartSeries[]

    ChartType:
      - line
      - bar
      - pie
      - scatter
      - area
      - custom

  # For audio components (voice channel)
  AudioConfig:
    audioType: AudioType [enum]
    text: string (for text-to-speech)
    audioUrl: string (for pre-recorded audio)
    voice: string (voice identifier)

    AudioType:
      - speech # Text-to-speech
      - recorded # Pre-recorded audio
      - stream # Audio stream

  # For custom components
  CustomConfig:
    componentClass: string (implementation reference)
    props: object (custom properties)
```

### ValidationRule

```yaml
ValidationRule:
  description: "Client-side validation rule for a field"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ValidationType [enum]
    message: string (optional)
    value: string (optional)

  enums:
    ValidationType:
      - required
      - minLength
      - maxLength
      - pattern # Regex validation
      - email
      - url
      - min # Minimum numeric value
      - max # Maximum numeric value
      - custom # Custom validation function

  examples:
    - type: required
      message: "Product name is required"

    - type: minLength
      value: 3
      message: "Name must be at least 3 characters"

    - type: pattern
      value: "^[A-Z]{2}\\d{4}$"
      message: "Must match format: AA1234"
```

### ActionComponent

```yaml
ActionComponent:
  description: "Interactive element that triggers actions (button, menu, link, voice command)"
  attributes:
    id: string (UUID) [PK]
    name: string
    label: string (optional)
    type: ActionType [enum]
    icon: string (optional)
    disabled: boolean (optional)
    tooltip: string (optional)
    channel: ChannelType (optional)

  contains:
    - children: ActionComponent[] (0..*)

  enums:
    ActionType:
      - button # Visual button
      - menu-item # Menu option
      - link # Hyperlink
      - voice-command # Voice intent/command
      - chat-button # Chat quick reply
      - sms-keyword # SMS keyword trigger
      - custom # Custom action type

    ButtonStyle: # For button type
      - primary
      - secondary
      - danger
      - success
      - warning
      - ghost
      - icon

  examples:
    # Visual button
    - name: "save-button"
      label: "Save"
      type: button
      channel: visual
      action:
        action: saveData

    # Menu with children
    - name: "actions-menu"
      label: "Actions"
      type: button
      children:
        - name: "edit"
          label: "Edit"
          type: menu-item
          action:
            action: navigateTo
        - name: "delete"
          label: "Delete"
          type: menu-item
          action:
            action: deleteData

    # Voice command
    - name: "check-status"
      label: "Check my order status"
      type: voice-command
      channel: voice
      action:
        action: fetchData

    # Chat quick reply
    - name: "yes-button"
      label: "Yes"
      type: chat-button
      channel: chat
      action:
        action: updateState
```

## Example UX Specification

```yaml
# File: specs/ux/product-edit-experience.ux.yaml
version: "0.1.1"
experience: "product-edit"
channel: visual
title: "Product Editor"
description: "Visual experience for creating and editing products"

references:
  application: "app-product-management" # Links to Application entity
  archimateElement: "app-comp-product-ui"
  dataSchema: "schemas/product.json"
  apiSpec: "specs/api/product-api.yaml"

# Motivation Layer Integration
motivationAlignment:
  supportsGoals:
    - "goal-product-catalog-accuracy"
    - "goal-editor-productivity"
  deliversValue:
    - "value-operational-efficiency"
    - "value-user-experience"
  governedByPrinciples:
    - "principle-accessibility-first"
    - "principle-mobile-responsive"
    - "principle-progressive-disclosure"
  fulfillsRequirements:
    - "req-product-data-management"
    - "req-real-time-validation"
    - "req-accessibility-wcag-2-1"

# Business Layer Integration
business:
  supportsProcesses:
    - "bp-product-management"
    - "bp-inventory-management"
  realizesServices:
    - "bs-product-catalog-management"
  targetActors:
    - "ba-product-manager"
    - "ba-catalog-administrator"
  targetRoles:
    - "br-inventory-specialist"

# Security Layer Integration
security:
  model: "product-security-model"
  defaultRequiredRoles:
    - "editor"
    - "product-manager"

# APM Layer Integration
apm:
  measuredByMetrics:
    - "product.edit.load.time"
    - "product.edit.save.duration"
    - "product.edit.error.rate"
    - "product.edit.completion.rate"
    - "product.edit.field.validation.errors"
  performanceTargets:
    loadTimeMs: 1000
    interactionLatencyMs: 100
    errorRatePercent: 0.5
    completionRatePercent: 95.0

# Experience State Machine
states:
  - name: "initial"
    initial: true
    description: "Screen loaded, determining mode"
    onEnter:
      - action: computeValue
        description: "Check if editing existing or creating new"
        data:
          source: route-params
          target: "$.mode"
    transitions:
      - to: "loading"
        on: dataReady
        condition:
          expression: "routeParams.productId !== null"
      - to: "editing"
        on: dataReady
        condition:
          expression: "routeParams.productId === null"

  - name: "loading"
    description: "Fetching product data from API"
    onEnter:
      - action: fetchData
        api:
          operationId: "getProduct"
          method: GET
        data:
          source: api-response
          target: "$.product"
        errorHandling:
          onError: "error"
          showNotification: true
    transitions:
      - to: "viewing"
        on: success
      - to: "error"
        on: failure

  - name: "viewing"
    description: "Displaying product in read-only mode"
    disabledComponents: ["all"] # All form components disabled
    transitions:
      - to: "editing"
        on: click
        description: "User clicked Edit button"

  - name: "editing"
    description: "User editing product data"
    onEnter:
      - action: updateState
        description: "Enable form editing"
    transitions:
      - to: "validating"
        on: submit
        validate: true
      - to: "viewing"
        on: cancel
        condition:
          expression: "product.id !== null"
          description: "Only go to viewing if existing product"

  - name: "validating"
    description: "Running client-side validation"
    onEnter:
      - action: validateForm
    transitions:
      - to: "saving"
        on: success
      - to: "editing"
        on: failure
        actions:
          - action: showNotification
            errorMessage: "Please fix validation errors"

  - name: "saving"
    description: "Submitting changes to API"
    onEnter:
      - action: saveData
        api:
          operationId: "updateProduct"
          method: PUT
        data:
          source: form-data
        errorHandling:
          onError: "error"
    transitions:
      - to: "viewing"
        on: success
        actions:
          - action: showNotification
            errorMessage: "Product saved successfully"
      - to: "error"
        on: failure

  - name: "error"
    description: "Error state"
    transitions:
      - to: "editing"
        on: click
        description: "Try again"

# View Definition
views:
  - name: "product-form-view"
    type: form
    title: "Product Details"
    routable: true
    route: "product-edit" # References Navigation Layer route
    layout:
      type: grid
      columns: 2
      gap: "1rem"

    # Security Layer Integration
    security:
      resourceRef: "product-edit-screen"
      requiredRoles: ["editor", "product-manager", "admin"]
      requiredPermissions: ["product.update", "product.read"]

    subViews:
      - name: "basic-info"
        title: "Basic Information"
        layout:
          type: grid
          columns: 2
        order: 1
        components:
          - name: "product-name"
            type: form-field
            label: "Product Name"
            config:
              fieldType: text-input
              placeholder: "Enter product name"
              validation:
                - type: required
                  message: "Product name is required"
                - type: minLength
                  value: 3
                  message: "Name must be at least 3 characters"
            dataBinding:
              schemaRef: "product.json#/properties/name"
            required: true

          - name: "product-sku"
            type: form-field
            label: "SKU"
            config:
              fieldType: text-input
              placeholder: "AA1234"
              validation:
                - type: pattern
                  value: "^[A-Z]{2}\\d{4}$"
                  message: "SKU must be format: AA1234"
            dataBinding:
              schemaRef: "product.json#/properties/sku"
            required: true

          - name: "product-price"
            type: form-field
            label: "Price"
            config:
              fieldType: number-input
              props:
                min: 0
                step: 0.01
                prefix: "$"
              validation:
                - type: min
                  value: 0
                  message: "Price must be positive"
            dataBinding:
              schemaRef: "product.json#/properties/price"
            required: true
            # Security Layer Integration - field-level access control
            security:
              fieldAccess: "price"
              visibleToRoles: ["editor", "product-manager", "admin"]
              editableByRoles: ["product-manager", "admin"]

          - name: "product-category"
            type: form-field
            label: "Category"
            config:
              fieldType: select
              props:
                options:
                  - value: "electronics"
                    label: "Electronics"
                  - value: "clothing"
                    label: "Clothing"
                  - value: "food"
                    label: "Food"
            dataBinding:
              schemaRef: "product.json#/properties/category"
            required: true

      - name: "description"
        title: "Description"
        layout:
          type: stack
          columns: 1
        order: 2
        components:
          - name: "product-description"
            type: form-field
            label: "Description"
            config:
              fieldType: rich-text-editor
              helpText: "Detailed product description for customers"
            dataBinding:
              schemaRef: "product.json#/properties/description"

      - name: "inventory"
        title: "Inventory"
        layout:
          type: grid
          columns: 2
        order: 3
        collapsible: true
        components:
          - name: "stock-quantity"
            type: form-field
            label: "Stock Quantity"
            config:
              fieldType: number-input
              props:
                min: 0
            dataBinding:
              schemaRef: "product.json#/properties/stockQuantity"

          - name: "reorder-point"
            type: form-field
            label: "Reorder Point"
            config:
              fieldType: number-input
              helpText: "Alert when stock falls below this level"
            dataBinding:
              schemaRef: "product.json#/properties/reorderPoint"

    actions:
      - name: "save-button"
        label: "Save Product"
        type: button
        channel: visual
        icon: "save"
        action:
          action: saveData
        enableCondition:
          expression: "currentState === 'editing'"

      - name: "cancel-button"
        label: "Cancel"
        type: button
        channel: visual
        action:
          action: navigateTo
          data:
            target: "/products"

      - name: "delete-button"
        label: "Delete"
        type: button
        channel: visual
        icon: "trash"
        confirmationPrompt: "Are you sure you want to delete this product?"
        action:
          action: deleteData
          api:
            operationId: "deleteProduct"
            method: DELETE
        enableCondition:
          expression: "product.id !== null"
```

## Integration Points

**For complete link patterns and validation rules**, see [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md). The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer

- **Experiences support Goals**: `motivationAlignment.supportsGoals` links UX to business objectives
- **Experiences deliver Value**: `motivationAlignment.deliversValue` shows user value contribution
- **Principles guide UX design**: `motivationAlignment.governedByPrinciples` ensures consistent UX (accessibility, mobile-first, multi-channel, etc.)
- **Requirements fulfillment**: `motivationAlignment.fulfillsRequirements` enables requirements traceability from requirements through implementation
- **Product alignment**: Validates features deliver business value
- **Traceability**: Requirement → UXSpec → API → Implementation creates complete audit trail

### To Business Layer

- **Process support**: `business.supportsProcesses` links UX experiences to BusinessProcess entities they support
- **Service realization**: `business.realizesServices` shows which BusinessService entities are realized through the UX
- **Actor targeting**: `business.targetActors` documents which BusinessActor types the experience is designed for
- **Role targeting**: `business.targetRoles` specifies which BusinessRole types use the experience
- **Business context**: Provides business justification for why UX experiences exist
- **Traceability**: BusinessProcess → UXSpec → Metrics enables process optimization

### To Application Layer

- **UXSpec.application**: Links experience to Application entity
- **Multi-app systems**: Different UX applications for different use cases (customer portal, admin panel, mobile app)
- **Application context**: Each UX spec belongs to a specific application

### To ArchiMate Application Layer

- UXSpec references ApplicationComponent via archimateElement
- Maps to frontend ApplicationComponent types

### To Security Layer

- **Experience-level security**: `UXSpec.security.model` references SecurityModel, `defaultRequiredRoles` sets baseline access
- **View-level security**: `View.security.resourceRef` links to SecureResource (type: screen), `requiredRoles` and `requiredPermissions` control view access
- **Component-level security**: `Component.security.fieldAccess` references SecureResource field-level controls, `visibleToRoles` and `editableByRoles` enable fine-grained access control
- **StateAction permissions**: Checked against SecurityModel during state transitions
- **ExperienceState guards**: Enforce authorization via Condition expressions
- **Implementation**: Enables runtime access control, security testing, and audit compliance
- **Traceability**: SecurityModel → UXSpec → Component enables security requirement validation

### To API Layer (OpenAPI)

- StateAction.api.operationId references OpenAPI operations
- Component.dataSource references API operations
- Ensures UI actions align with available APIs

### To Data Model Layer (JSON Schema)

- Component.dataBinding.schemaRef points to schema properties
- Ensures components match data structure
- Validation alignment across layers

### To Navigation Layer

- **View to Route**: View.route references Route identifier
- **Action navigation**: ActionComponent navigation actions reference Routes
- **State triggers navigation**: Experience state transitions trigger route changes
- **Flow integration**: NavigationFlow steps reference UXSpec files and entry states
  - `FlowStep.route` → Route → `Route.experience` → UXSpec file
  - `FlowStep.experience.entryState` specifies which ExperienceState to begin at
  - `FlowStep.experience.exitTrigger` defines what completes the experience step
- **Data flow**: NavigationFlow.dataTransfer maps flow context to/from UX experience state
  - Input mappings populate experience initial state (e.g., `routeParams`, form defaults)
  - Output mappings extract data from experience to flow context (e.g., form results, selections)
- **Shared context**: NavigationFlow.sharedContext provides cross-experience state management
  - Solves shopping cart, wizard progress, and multi-step form persistence
  - Context variables accessible via JSONPath in StateAction data sources

### To APM/Observability Layer

- **Metric linkage**: `apm.measuredByMetrics` links UX experiences to metrics that measure their effectiveness
- **Performance targets**: `apm.performanceTargets` defines expected performance characteristics (load time, latency, error rates, completion rates)
- **Closed-loop measurement**: Goal → UXSpec → Metrics → Goal validation enables data-driven UX optimization
- **Frontend traces**: User interactions generate client spans that link to backend traces
- **End-to-end tracing**: Complete transaction visibility across UX and backend systems
- **UX metrics**: Load time, interaction latency, error rates, completion rates, field validation errors
- **Business metrics**: Conversion rates, feature adoption, user satisfaction scores
- **Traceability**: UXSpec → Metrics → Goal measurement validates UX effectiveness

## Validation

### UX Spec Validation

```javascript
// Validation checks:
1. Exactly one initial ExperienceState exists
2. All state transitions reference valid ExperienceStates
3. All operationIds exist in referenced OpenAPI spec
4. All schemaRef paths exist in referenced JSON Schema
5. Component names are unique within View/SubView
6. View names are unique within UXSpec
7. Required validation rules match schema requirements
8. Conditional expressions are syntactically valid
9. All referenced archimate elements exist
10. Application reference exists
11. Route references exist in Navigation Layer
12. Channel-specific states/actions match UXSpec channel

// New validation checks for cross-layer integration:
13. All motivationAlignment.fulfillsRequirements references exist in Motivation Layer
14. All business.supportsProcesses references exist in Business Layer
15. All business.realizesServices references exist in Business Layer
16. All business.targetActors references exist in Business Layer
17. All business.targetRoles references exist in Business Layer
18. All security.model references exist in Security Layer
19. All security.defaultRequiredRoles exist in the referenced SecurityModel
20. All View.security.resourceRef references exist in Security Layer
21. If View.security.resourceRef is set, the SecureResource.type must be 'screen'
22. All View.security.requiredRoles exist in the referenced SecurityModel
23. All View.security.requiredPermissions exist in the referenced SecurityModel
24. All Component.security.fieldAccess fields exist in the View's referenced SecureResource
25. All Component.security.visibleToRoles exist in the referenced SecurityModel
26. All Component.security.editableByRoles exist in the referenced SecurityModel
27. If Component.security.editableByRoles is set, visibleToRoles must include those roles
28. All apm.measuredByMetrics references exist in APM Layer configuration
29. If apm.performanceTargets is set, at least one target metric must be defined
30. Performance target percentages must be between 0 and 100

// Consistency validation:
31. If View has security.resourceRef, Components should use security.fieldAccess (warning)
32. If UXSpec has security.defaultRequiredRoles, Views should specify security (warning)
33. If UXSpec has business.supportsProcesses, it should have apm.measuredByMetrics (warning)
34. If Component is required, it should have validation rules (warning)
```

## Property Conventions

### File Naming

```yaml
Pattern: "{experience-identifier}.ux.yaml"
Examples:
  - product-edit.ux.yaml # Visual form experience
  - customer-list.ux.yaml # Visual list experience
  - order-status-voice.ux.yaml # Voice experience
  - support-chat.ux.yaml # Chat experience
```

### Experience State Naming

```yaml
Common States (Visual):
  - initial # Entry point
  - loading # Fetching data
  - viewing # Read-only display
  - editing # Form editing
  - validating # Running validation
  - saving # Submitting data
  - deleting # Removing data
  - error # Error occurred
  - success # Operation completed

Common States (Voice):
  - listening # Waiting for user speech
  - speaking # Playing audio response
  - processing # Processing speech input
  - confirming # Confirming user intent

Common States (Chat):
  - awaiting-input # Waiting for user message
  - typing # Showing typing indicator
  - responding # Sending response

Common States (All Channels):
  - initial
  - loading
  - processing
  - error
  - success
```

## Best Practices

1. **Single Responsibility**: One UX spec per experience (view/conversation/interaction)
2. **State Machine First**: Design state transitions before views/components
3. **Channel Awareness**: Design states and actions that work across channels
4. **API Integration**: Link all data operations to OpenAPI operations
5. **Schema Binding**: Bind all components to JSON Schema properties
6. **Validation Alignment**: Validation should match schema constraints
7. **Error Handling**: Define error states and transitions for all channels
8. **Loading States**: Always indicate loading/processing for async operations
9. **Guard Conditions**: Use conditions to prevent invalid transitions
10. **Confirmation Prompts**: Require confirmation for destructive actions (adapted per channel)
11. **Accessibility**: Include labels, help text, and appropriate channel-specific affordances
12. **Application Context**: Always link UXSpec to Application entity
13. **View Composition**: Use SubViews for reusable component groupings
14. **Component Types**: Choose appropriate component types (form-field, table, chart, etc.)

## Code Generation

UX specs enable generation of:

```yaml
Frontend Code (Visual):
  - React/Vue/Angular components
  - State management (Redux/MobX/Vuex)
  - Form validation logic
  - API client calls
  - Navigation routing

Voice Code:
  - Alexa Skills / Google Actions
  - Voice flow definitions
  - Speech recognition intents
  - Text-to-speech responses
  - SSML generation

Chat Code:
  - Chatbot conversation flows
  - Intent handlers
  - Quick reply buttons
  - Message templates

Test Code:
  - Experience state machine tests
  - Component interaction tests
  - Validation tests
  - Multi-channel tests
  - Integration tests with API mocks
```

## Common Patterns

### List-Detail Pattern

```yaml
List Experience (product-list.ux.yaml):
  - States: loading � viewing
  - View: list with search/filter components
  - Actions: Navigate to detail on row click

Detail Experience (product-detail.ux.yaml):
  - States: loading � viewing � editing � saving
  - View: form with SubViews (sections)
  - Actions: Edit, Save, Delete, Back to list
```

### Wizard Pattern

```yaml
Multi-Step Wizard:
  - States: step1 � step2 � step3 � review � submitting
  - View: wizard type with stepper component
  - SubViews: One per step
  - Actions: Next, Previous, Submit
  - Validation: Per-step validation before transition
```

### Master-Detail Pattern

```yaml
Split View:
  - View type: split
  - Left SubView: List of items (master)
  - Right SubView: Selected item details (detail)
  - States: Both sides have coordinated state machines
  - Sync: Selection in master triggers detail load
```

### Voice Interaction Pattern

```yaml
Voice Experience (order-status-voice.ux.yaml):
  - Channel: voice
  - States: listening � processing � speaking
  - Components: audio (speech synthesis)
  - Actions: voice-command types
  - State machine drives conversation flow
```

### Chat Conversation Pattern

```yaml
Chat Experience (support-chat.ux.yaml):
  - Channel: chat
  - States: awaiting-input � processing � responding
  - Components: text, chat-button (quick replies)
  - Actions: chat-button types
  - State machine drives dialogue
```

This UX Layer specification provides a comprehensive, implementation-ready definition of user experiences across channels that bridges design and development.
