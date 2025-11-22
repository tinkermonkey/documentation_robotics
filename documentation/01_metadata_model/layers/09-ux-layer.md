# UX Layer - User Experience Specification

## Overview

The UX Layer defines the user interface state management, layout, and behavior of application screens. This is a **custom specification** as no standard adequately covers the combination of state machines, layout definitions, and API integration needed for modern applications.

## Layer Characteristics

- **Standard**: Custom Specification (YAML format)
- **Custom Extensions**: Complete custom specification
- **Validation**: Custom JSON Schema validator
- **Tooling**: Custom validation tools, code generators

## Why Custom?

Existing standards fall short:
- **W3C UI specs**: Too low-level (HTML/CSS)
- **Design systems**: Too visual, not behavioral
- **State machine specs**: Don't integrate with APIs and data
- **Form builders**: Limited to forms, not full screens

Our UX spec bridges the gap between design and implementation by:
1. Defining screen states and transitions
2. Linking UI actions to API operations
3. Mapping form fields to data schemas
4. Specifying layout structure

## Entity Definitions

### UXSpec
```yaml
UXSpec:
  description: "Complete UX specification for a screen or component"
  attributes:
    version: string (spec version, e.g., "1.0.0")
    screen: string (screen identifier)
    title: string (optional)
    description: string (optional)

  contains:
    - states: ScreenState[] (1..*)
    - layout: ScreenLayout (1..1)
    - globalActions: ActionButton[] (0..*)

  references:
    - archimateElement: Element.id [ApplicationComponent]
    - dataSchema: string (path to JSON Schema file)
    - apiSpec: string (path to OpenAPI spec file)
```

### ScreenState
```yaml
ScreenState:
  description: "Distinct state that the screen can be in"
  attributes:
    name: string [PK within spec] (e.g., "loading", "viewing", "editing")
    initial: boolean (default: false) # Exactly one state must be initial
    description: string (optional)

  contains:
    - onEnter: StateAction[] (0..*) # Actions when entering this state
    - onExit: StateAction[] (0..*) # Actions when leaving this state
    - transitions: StateTransition[] (0..*) # Possible transitions to other states
    - enabledFields: string[] (field names, optional)
    - disabledFields: string[] (field names, optional)
    - hiddenFields: string[] (field names, optional)

  examples:
    - name: "initial"
      initial: true
      description: "Screen just loaded, no data yet"

    - name: "loading"
      description: "Fetching data from API"

    - name: "viewing"
      description: "Displaying data in read-only mode"

    - name: "editing"
      description: "User editing form fields"

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
    showNotification: boolean (default: true)
    errorMessage: string (optional, custom error message)

  enums:
    ActionType:
      - fetchData       # Retrieve data from API
      - saveData        # Send data to API
      - deleteData      # Delete via API
      - validateForm    # Run client-side validation
      - clearForm       # Reset form to defaults
      - showNotification # Display message to user
      - navigateTo      # Navigate to another screen
      - callAPI         # Generic API call
      - updateState     # Update local state
      - computeValue    # Calculate derived value

    DataSource:
      - api-response    # From API response
      - form-data       # From form fields
      - route-params    # From URL parameters
      - query-params    # From URL query string
      - local-storage   # From browser storage
      - constant        # Fixed value
      - computed        # Calculated value
```

### StateTransition
```yaml
StateTransition:
  description: "Transition from current state to another state"
  attributes:
    to: string [FK -> ScreenState.name]
    on: TriggerType [enum]
    description: string (optional)

  contains:
    - condition: Condition (optional) # Guard condition
    - validate: boolean (default: false) # Run validation before transition
    - actions: StateAction[] (0..*) # Actions during transition

  enums:
    TriggerType:
      - success       # Previous action succeeded
      - failure       # Previous action failed
      - submit        # User clicked submit
      - cancel        # User clicked cancel
      - click         # User interaction
      - timeout       # Timer expired
      - dataReady     # Data loaded
      - custom        # Custom event
```

### Condition
```yaml
Condition:
  description: "Boolean expression for guard conditions"
  attributes:
    expression: string (JavaScript-like boolean expression)
    description: string (optional)

  examples:
    - expression: "data.status === 'draft'"
      description: "Only allow edit if status is draft"

    - expression: "form.isValid && user.hasPermission('edit')"
      description: "Valid form and user has permission"

    - expression: "items.length > 0"
      description: "At least one item exists"
```

### ScreenLayout
```yaml
ScreenLayout:
  description: "Visual layout structure of the screen"
  attributes:
    type: LayoutType [enum]
    title: string (optional)
    description: string (optional)
    columns: integer (default: 1) # Grid columns

  contains:
    - sections: LayoutSection[] (0..*)
    - fields: FieldDefinition[] (0..*)
    - actions: ActionButton[] (0..*)
    - navigation: NavigationElement[] (0..*)

  enums:
    LayoutType:
      - form          # Data entry form
      - list          # List of items
      - detail        # Single item detail view
      - dashboard     # Multiple widgets
      - wizard        # Multi-step process
      - split         # Split screen (master-detail)
      - custom        # Custom layout
```

### LayoutSection
```yaml
LayoutSection:
  description: "Logical grouping of fields within layout"
  attributes:
    name: string [PK within layout]
    title: string
    description: string (optional)
    collapsible: boolean (default: false)
    collapsed: boolean (default: false)
    columns: integer (default: 1)
    order: integer (optional) # Display order

  contains:
    - fields: FieldDefinition[] (0..*)
    - subsections: LayoutSection[] (0..*) # Nested sections

  references:
    - conditionalDisplay: Condition (optional) # Show/hide based on condition
```

### FieldDefinition
```yaml
FieldDefinition:
  description: "Individual field in the layout"
  attributes:
    name: string [PK within layout]
    label: string
    placeholder: string (optional)
    helpText: string (optional)
    required: boolean (default: false)
    readonly: boolean (default: false)
    hidden: boolean (default: false)
    order: integer (optional)

  # Data Binding
  dataBinding:
    schemaRef: string (JSONPath to property in JSON Schema)
    # e.g., "product-schema.json#/definitions/Product/properties/name"
    defaultValue: any (optional)

  # UI Component
  component:
    type: UIComponent [enum]
    props: object (component-specific properties)

  # Validation
  validation:
    - rules: ValidationRule[] (0..*)

  # Conditional Display
  conditionalDisplay: Condition (optional)

  # Dependencies
  dependsOn: string[] (field names, optional)
  triggers: string[] (field names to refresh, optional)

  enums:
    UIComponent:
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
      - custom
```

### ValidationRule
```yaml
ValidationRule:
  description: "Client-side validation rule for a field"
  attributes:
    type: ValidationType [enum]
    message: string # Error message to display
    value: any (optional) # Rule-specific value

  enums:
    ValidationType:
      - required
      - minLength
      - maxLength
      - pattern        # Regex validation
      - email
      - url
      - min           # Minimum numeric value
      - max           # Maximum numeric value
      - custom        # Custom validation function

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

### ActionButton
```yaml
ActionButton:
  description: "Interactive button that triggers actions"
  attributes:
    name: string [PK within layout]
    label: string
    type: ButtonType [enum]
    icon: string (optional, icon identifier)
    disabled: boolean (default: false)
    tooltip: string (optional)

  contains:
    - action: StateAction (1..1) # Action to execute
    - confirmationPrompt: string (optional) # Confirmation dialog text
    - enableCondition: Condition (optional) # When button is enabled

  enums:
    ButtonType:
      - primary
      - secondary
      - danger
      - success
      - warning
      - link
      - icon
```

### NavigationElement
```yaml
NavigationElement:
  description: "Navigation component (breadcrumb, tabs, menu)"
  attributes:
    type: NavigationType [enum]
    items: NavigationItem[] (1..*)

  enums:
    NavigationType:
      - breadcrumb
      - tabs
      - menu
      - stepper      # Wizard steps
```

### NavigationItem
```yaml
NavigationItem:
  description: "Individual navigation item"
  attributes:
    label: string
    path: string (route path)
    icon: string (optional)
    badge: string (optional, notification badge)
    active: boolean (default: false)
```

## Example UX Specification

```yaml
# File: specs/ux/product-edit-screen.ux.yaml
version: "1.0.0"
screen: "product-edit"
title: "Product Editor"
description: "Screen for creating and editing products"

references:
  archimateElement: "app-comp-product-ui"
  dataSchema: "schemas/product.json"
  apiSpec: "specs/api/product-api.yaml"

# State Machine
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
    disabledFields: ["all"]
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

# Layout Definition
layout:
  type: form
  title: "Product Details"
  columns: 2

  sections:
    - name: "basic-info"
      title: "Basic Information"
      columns: 2
      order: 1
      fields:
        - name: "product-name"
          label: "Product Name"
          component:
            type: text-input
          dataBinding:
            schemaRef: "product.json#/properties/name"
          required: true
          validation:
            - type: required
              message: "Product name is required"
            - type: minLength
              value: 3
              message: "Name must be at least 3 characters"

        - name: "product-sku"
          label: "SKU"
          component:
            type: text-input
          dataBinding:
            schemaRef: "product.json#/properties/sku"
          required: true
          validation:
            - type: pattern
              value: "^[A-Z]{2}\\d{4}$"
              message: "SKU must be format: AA1234"

        - name: "product-price"
          label: "Price"
          component:
            type: number-input
            props:
              min: 0
              step: 0.01
              prefix: "$"
          dataBinding:
            schemaRef: "product.json#/properties/price"
          required: true
          validation:
            - type: min
              value: 0
              message: "Price must be positive"

        - name: "product-category"
          label: "Category"
          component:
            type: select
            props:
              options: # Could also reference API endpoint
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
      columns: 1
      order: 2
      fields:
        - name: "product-description"
          label: "Description"
          component:
            type: rich-text-editor
          dataBinding:
            schemaRef: "product.json#/properties/description"
          helpText: "Detailed product description for customers"

    - name: "inventory"
      title: "Inventory"
      columns: 2
      order: 3
      collapsible: true
      fields:
        - name: "stock-quantity"
          label: "Stock Quantity"
          component:
            type: number-input
            props:
              min: 0
          dataBinding:
            schemaRef: "product.json#/properties/stockQuantity"

        - name: "reorder-point"
          label: "Reorder Point"
          component:
            type: number-input
          dataBinding:
            schemaRef: "product.json#/properties/reorderPoint"
          helpText: "Alert when stock falls below this level"

  actions:
    - name: "save-button"
      label: "Save Product"
      type: primary
      icon: "save"
      action:
        action: saveData
      enableCondition:
        expression: "currentState === 'editing'"

    - name: "cancel-button"
      label: "Cancel"
      type: secondary
      action:
        action: navigateTo
        data:
          target: "/products"

    - name: "delete-button"
      label: "Delete"
      type: danger
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

### To ArchiMate Application Layer
- UXSpec references ApplicationComponent via archimateElement
- Maps to frontend ApplicationComponent types

### To API Layer (OpenAPI)
- StateAction.api.operationId references OpenAPI operations
- Ensures UI actions align with available APIs

### To Data Model Layer (JSON Schema)
- FieldDefinition.dataBinding.schemaRef points to schema properties
- Ensures UI fields match data structure

### To Navigation Layer
- ActionButton navigation actions reference Route paths
- Screen transitions trigger route changes

### To Security Layer
- StateAction permissions checked against SecurityModel
- Field-level access control based on user roles

## Validation

### UX Spec Validation
```javascript
// Validation checks:
1. Exactly one initial state exists
2. All state transitions reference valid states
3. All operationIds exist in referenced OpenAPI spec
4. All schemaRef paths exist in referenced JSON Schema
5. Field names are unique within layout
6. Required validation rules match schema requirements
7. Conditional expressions are syntactically valid
8. All referenced archimate elements exist
```

## Property Conventions

### File Naming
```yaml
Pattern: "{screen-identifier}.ux.yaml"
Examples:
  - product-edit.ux.yaml
  - customer-list.ux.yaml
  - order-detail.ux.yaml
```

### State Naming
```yaml
Common States:
  - initial      # Entry point
  - loading      # Fetching data
  - viewing      # Read-only display
  - editing      # Form editing
  - validating   # Running validation
  - saving       # Submitting data
  - deleting     # Removing data
  - error        # Error occurred
  - success      # Operation completed
```

## Best Practices

1. **Single Responsibility**: One UX spec per screen/component
2. **State Machine First**: Design state transitions before layout
3. **API Integration**: Link all data operations to OpenAPI operations
4. **Schema Binding**: Bind all fields to JSON Schema properties
5. **Validation Alignment**: Client-side validation should match schema constraints
6. **Error Handling**: Define error states and transitions
7. **Loading States**: Always show loading for async operations
8. **Guard Conditions**: Use conditions to prevent invalid transitions
9. **Confirmation Prompts**: Require confirmation for destructive actions
10. **Accessibility**: Include labels, help text, and ARIA properties

## Code Generation

UX specs enable generation of:

```yaml
Frontend Code:
  - React/Vue/Angular components
  - State management (Redux/MobX/Vuex)
  - Form validation logic
  - API client calls
  - Navigation routing

Test Code:
  - State machine tests
  - Form validation tests
  - User interaction tests
  - Integration tests with API mocks
```

## Common Patterns

### List-Detail Pattern
```yaml
List Screen (product-list.ux.yaml):
  - State: loading ’ viewing
  - Layout: list with search/filter
  - Actions: Navigate to detail on row click

Detail Screen (product-detail.ux.yaml):
  - State: loading ’ viewing ’ editing ’ saving
  - Layout: form with sections
  - Actions: Edit, Save, Delete, Back to list
```

### Wizard Pattern
```yaml
Multi-Step Wizard:
  - States: step1 ’ step2 ’ step3 ’ review ’ submitting
  - Layout: wizard with navigation stepper
  - Actions: Next, Previous, Submit
  - Validation: Per-step validation before transition
```

### Master-Detail Pattern
```yaml
Split Screen:
  - Left: List of items (master)
  - Right: Selected item details (detail)
  - States: Both sides have independent state machines
  - Sync: Selection in master triggers detail load
```

This UX Layer specification provides a comprehensive, implementation-ready definition of user interfaces that bridges design and development.
