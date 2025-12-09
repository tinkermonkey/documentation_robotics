# UX Layer - User Experience Specification

## Overview

The UX Layer defines user experience state management, interaction design, and behavior across multiple channels (visual, voice, chat, SMS). This is a **custom specification** as no standard adequately covers the combination of state machines, component composition, and API integration needed for modern multi-channel applications.

### Three-Tier Architecture

The UX Layer follows a **three-tier architecture** that separates concerns and promotes reusability:

1. **Library Tier** (UXLibrary, LibraryComponent, LibrarySubView): Reusable, shareable UI components and component groupings that can be shared across applications
2. **Pattern Tier** (StatePattern, ActionPattern): Reusable behavioral patterns for state management and user actions
3. **Application Tier** (UXApplication, UXSpec): Application-specific configurations that compose library components and patterns

This architecture enables:

- **Reusability**: Components and patterns defined once, used across multiple applications
- **Consistency**: Shared libraries ensure consistent UX across products
- **Maintainability**: Changes to library components propagate to all consuming applications
- **Flexibility**: Applications can customize and extend library components

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
6. Separating reusable library components from application-specific configurations

## Entity Definitions

### Tier 1: Library Entities

#### UXLibrary

```yaml
UXLibrary:
  description: "Collection of reusable UI components and sub-views that can be shared across applications"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string
    description: string (optional)
    author: string (optional)
    license: string (optional)

  contains:
    - components: LibraryComponent[] (0..*) # Reusable components
    - subViews: LibrarySubView[] (0..*) # Reusable sub-view templates
    - statePatterns: StatePattern[] (0..*) # Reusable state machine patterns
    - actionPatterns: ActionPattern[] (0..*) # Reusable action patterns

  references:
    - extendsLibrary: UXLibrary.id (optional) # Inherit from another library
    - designSystem: string (path to design system specification, optional)

  metadata:
    tags: string[] (optional) # Categorization tags
    deprecated: boolean (optional) # Mark library as deprecated
    deprecationMessage: string (optional) # Migration guidance

  examples:
    - name: "core-components"
      version: "2.0.0"
      description: "Core UI component library"
      author: "Platform Team"
      components:
        - # LibraryComponent definitions

    - name: "ecommerce-components"
      version: "1.5.0"
      description: "E-commerce specific components"
      extendsLibrary: "core-components"
```

#### LibraryComponent

```yaml
LibraryComponent:
  description: "Reusable UI component definition that can be instantiated in multiple UXSpecs"
  attributes:
    id: string (UUID) [PK]
    name: string
    type: ComponentType [enum]
    label: string (optional)
    description: string (optional)
    category: string (optional) # Component category for organization

  # Default configuration (can be overridden when instantiated)
  defaults:
    required: boolean (optional)
    readonly: boolean (optional)
    hidden: boolean (optional)

  # Data Binding Template
  dataBindingTemplate:
    schemaPattern: string (JSONPath pattern for binding, optional)
    defaultValue: any (optional)
    dataSourcePattern: string (API operation pattern, optional)

  # Component-specific configuration template
  configTemplate: ComponentConfig (varies by type)

  # Slots for customization
  slots:
    - name: string
      description: string
      required: boolean
      defaultContent: any (optional)

  # Variants
  variants:
    - name: string
      description: string (optional)
      configOverrides: object (optional)

  # Security defaults
  securityDefaults:
    visibleToRoles: string[] (optional)
    editableByRoles: string[] (optional)

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

  examples:
    # Reusable text input component
    - name: "text-input"
      type: form-field
      category: "inputs"
      description: "Standard text input field"
      configTemplate:
        fieldType: text-input
      slots:
        - name: "prefix"
          description: "Content before input"
          required: false
        - name: "suffix"
          description: "Content after input"
          required: false
      variants:
        - name: "search"
          description: "Search input variant"
          configOverrides:
            props:
              icon: "search"
              clearable: true

    # Reusable price input component
    - name: "price-input"
      type: form-field
      category: "inputs"
      description: "Currency input with formatting"
      configTemplate:
        fieldType: number-input
        props:
          min: 0
          step: 0.01
          prefix: "$"
      securityDefaults:
        visibleToRoles: ["editor", "product-manager", "admin"]
        editableByRoles: ["product-manager", "admin"]
```

#### LibrarySubView

```yaml
LibrarySubView:
  description: "Reusable grouping of components that can be composed into views"
  attributes:
    id: string (UUID) [PK]
    name: string
    title: string (optional)
    description: string (optional)
    category: string (optional) # SubView category for organization

  # Layout configuration
  layout:
    type: LayoutStyle [enum]
    columns: integer (optional)
    gap: string (optional)

  # Component slots - define what components this sub-view expects
  componentSlots:
    - name: string
      description: string (optional)
      required: boolean
      allowedTypes: ComponentType[] (optional) # Restrict component types
      multiple: boolean (optional) # Allow multiple components in slot

  # Default components (optional - can be overridden)
  defaultComponents: ComponentReference[] (0..*)

  # Nested sub-view slots
  subViewSlots:
    - name: string
      description: string (optional)
      required: boolean

  # Behavior configuration
  collapsible: boolean (optional)
  collapsed: boolean (optional)

  enums:
    LayoutStyle:
      - grid
      - flex
      - stack
      - flow
      - custom

  examples:
    # Reusable form section template
    - name: "form-section"
      title: "Form Section"
      description: "Standard form section with title and grid layout"
      layout:
        type: grid
        columns: 2
        gap: "1rem"
      componentSlots:
        - name: "fields"
          description: "Form fields in this section"
          required: true
          allowedTypes: ["form-field"]
          multiple: true
      collapsible: true

    # Reusable address sub-view
    - name: "address-section"
      title: "Address"
      description: "Standard address form section"
      layout:
        type: grid
        columns: 2
      defaultComponents:
        - ref: "text-input"
          name: "street-address"
          label: "Street Address"
          slot: "fields"
        - ref: "text-input"
          name: "city"
          label: "City"
          slot: "fields"
        - ref: "select"
          name: "state"
          label: "State"
          slot: "fields"
        - ref: "text-input"
          name: "zip-code"
          label: "ZIP Code"
          slot: "fields"
```

### Tier 2: Pattern Entities

#### StatePattern

```yaml
StatePattern:
  description: "Reusable state machine pattern for common UX flows"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    category: string (optional) # Pattern category (e.g., "forms", "lists", "wizards")

  # Pattern parameters - values provided when pattern is used
  parameters:
    - name: string
      type: string # "string", "number", "boolean", "apiOperation", "state"
      required: boolean
      default: any (optional)
      description: string (optional)

  # State definitions with parameter placeholders
  states:
    - name: string
      initial: boolean (optional)
      description: string (optional)
      onEnter: StateActionTemplate[] (0..*)
      onExit: StateActionTemplate[] (0..*)
      transitions: TransitionTemplate[] (0..*)

  # Entry and exit points for composition
  entryPoints: string[] # State names that can be entered from outside
  exitPoints: string[] # State names that represent completion

  examples:
    # CRUD form pattern
    - name: "crud-form-pattern"
      description: "Standard create/read/update/delete form flow"
      category: "forms"
      parameters:
        - name: "fetchOperation"
          type: "apiOperation"
          required: true
          description: "API operation to fetch entity"
        - name: "saveOperation"
          type: "apiOperation"
          required: true
          description: "API operation to save entity"
        - name: "deleteOperation"
          type: "apiOperation"
          required: false
          description: "API operation to delete entity"
        - name: "entityPath"
          type: "string"
          required: true
          default: "$.entity"
          description: "JSONPath to store entity data"
      states:
        - name: "initial"
          initial: true
          transitions:
            - to: "loading"
              on: dataReady
              condition: "{{hasEntityId}}"
            - to: "editing"
              on: dataReady
              condition: "!{{hasEntityId}}"
        - name: "loading"
          onEnter:
            - action: fetchData
              api:
                operationId: "{{fetchOperation}}"
              data:
                target: "{{entityPath}}"
          transitions:
            - to: "viewing"
              on: success
            - to: "error"
              on: failure
        - name: "viewing"
          transitions:
            - to: "editing"
              on: click
        - name: "editing"
          transitions:
            - to: "validating"
              on: submit
            - to: "viewing"
              on: cancel
        - name: "validating"
          onEnter:
            - action: validateForm
          transitions:
            - to: "saving"
              on: success
            - to: "editing"
              on: failure
        - name: "saving"
          onEnter:
            - action: saveData
              api:
                operationId: "{{saveOperation}}"
          transitions:
            - to: "viewing"
              on: success
            - to: "error"
              on: failure
        - name: "error"
          transitions:
            - to: "editing"
              on: click
      entryPoints: ["initial"]
      exitPoints: ["viewing"]

    # List with selection pattern
    - name: "list-selection-pattern"
      description: "List view with item selection capability"
      category: "lists"
      parameters:
        - name: "listOperation"
          type: "apiOperation"
          required: true
        - name: "itemsPath"
          type: "string"
          default: "$.items"
      states:
        - name: "loading"
          initial: true
          onEnter:
            - action: fetchData
              api:
                operationId: "{{listOperation}}"
              data:
                target: "{{itemsPath}}"
          transitions:
            - to: "viewing"
              on: success
            - to: "error"
              on: failure
        - name: "viewing"
          transitions:
            - to: "item-selected"
              on: click
        - name: "item-selected"
          transitions:
            - to: "viewing"
              on: click
        - name: "error"
          transitions:
            - to: "loading"
              on: click
      entryPoints: ["loading"]
      exitPoints: ["item-selected"]
```

#### ActionPattern

```yaml
ActionPattern:
  description: "Reusable action configuration for common user interactions"
  attributes:
    id: string (UUID) [PK]
    name: string
    description: string (optional)
    category: string (optional) # Pattern category (e.g., "crud", "navigation", "notifications")

  # Pattern parameters
  parameters:
    - name: string
      type: string
      required: boolean
      default: any (optional)
      description: string (optional)

  # Action template
  actionTemplate:
    action: ActionType [enum]
    api: ApiConfig (optional)
    data: DataConfig (optional)
    errorHandling: ErrorConfig (optional)

  # Confirmation configuration (optional)
  confirmation:
    required: boolean
    messageTemplate: string (optional)

  enums:
    ActionType:
      - fetchData
      - saveData
      - deleteData
      - validateForm
      - clearForm
      - showNotification
      - navigateTo
      - callAPI
      - updateState
      - computeValue

  examples:
    # Delete with confirmation pattern
    - name: "delete-with-confirmation"
      description: "Delete action with user confirmation"
      category: "crud"
      parameters:
        - name: "deleteOperation"
          type: "apiOperation"
          required: true
        - name: "entityName"
          type: "string"
          default: "item"
        - name: "redirectPath"
          type: "string"
          required: false
      actionTemplate:
        action: deleteData
        api:
          operationId: "{{deleteOperation}}"
        errorHandling:
          showNotification: true
      confirmation:
        required: true
        messageTemplate: "Are you sure you want to delete this {{entityName}}?"

    # Save and navigate pattern
    - name: "save-and-navigate"
      description: "Save data and navigate to another page"
      category: "crud"
      parameters:
        - name: "saveOperation"
          type: "apiOperation"
          required: true
        - name: "successPath"
          type: "string"
          required: true
        - name: "successMessage"
          type: "string"
          default: "Saved successfully"
      actionTemplate:
        action: saveData
        api:
          operationId: "{{saveOperation}}"
        data:
          source: form-data
        errorHandling:
          showNotification: true
          errorMessage: "Failed to save"
```

### Tier 3: Application Entities

#### UXApplication

```yaml
UXApplication:
  description: "Application-level UX configuration that groups UXSpecs and defines shared settings"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (optional)
    description: string (optional)
    channel: ChannelType [enum]

  # Library dependencies
  libraries:
    - libraryRef: UXLibrary.id
      version: string (semver range, optional)
      alias: string (optional) # Local name for library

  # Shared configuration across all UXSpecs in this application
  sharedConfig:
    theme: string (optional) # Theme reference
    locale: string (optional) # Default locale
    errorHandling: ErrorConfig (optional) # Default error handling

  # Global actions available across all experiences
  globalActions: ActionComponent[] (0..*)

  # Global state patterns available to all UXSpecs
  globalPatterns: string[] (StatePattern IDs, optional)

  contains:
    - experiences: UXSpec[] (1..*) # UXSpecs in this application

  references:
    - application: Element.id [Application] # Links to Application Layer
    - archimateElement: Element.id [ApplicationComponent]

  # Motivation Layer Integration
  motivationAlignment:
    supportsGoals: string[] (Goal IDs, optional)
    deliversValue: string[] (Value IDs, optional)
    governedByPrinciples: string[] (Principle IDs, optional)

  # Security Layer Integration
  security:
    model: string (SecurityModel reference, optional)
    defaultRequiredRoles: string[] (optional)

  # APM Layer Integration
  apm:
    measuredByMetrics: string[] (optional)

  enums:
    ChannelType:
      - visual # Web, mobile app
      - voice # Phone, voice assistant
      - chat # Chatbot, messaging
      - sms # SMS/text messaging
      - multimodal # Multiple channels

  examples:
    - name: "product-management-app"
      version: "2.0.0"
      channel: visual
      description: "Product management application"
      libraries:
        - libraryRef: "core-components"
          version: "^2.0.0"
        - libraryRef: "ecommerce-components"
          version: "^1.5.0"
          alias: "ecom"
      sharedConfig:
        theme: "enterprise-light"
        locale: "en-US"
      security:
        model: "product-security-model"
        defaultRequiredRoles: ["editor"]
```

#### UXSpec

```yaml
UXSpec:
  description: "Complete UX specification for a single experience (visual, voice, chat, SMS)"
  attributes:
    id: string (UUID) [PK]
    name: string
    version: string (optional)
    experience: string (optional)
    title: string (optional)
    description: string (optional)

  # Pattern usage - reference patterns from library or application
  usesPatterns:
    - patternRef: StatePattern.id
      parameters: object # Parameter values for pattern instantiation

  # State machine (can use pattern or define custom)
  states: ExperienceState[] (0..*) # Custom states (merged with pattern states)

  # View definition
  views: View[] (1..*)

  # Global actions for this experience
  globalActions: ActionComponent[] (0..*)

  references:
    - application: UXApplication.id (optional) # Parent application
    - dataSchema: string (path to JSON Schema file, optional)
    - apiSpec: string (path to OpenAPI spec file, optional)

  # Business Layer Integration
  business:
    supportsProcesses: string[] (BusinessProcess IDs, optional)
    realizesServices: string[] (BusinessService IDs, optional)
    targetActors: string[] (BusinessActor IDs, optional)
    targetRoles: string[] (BusinessRole IDs, optional)

  # Motivation Layer Integration (can override application-level)
  motivationAlignment:
    supportsGoals: string[] (optional)
    deliversValue: string[] (optional)
    governedByPrinciples: string[] (optional)
    fulfillsRequirements: string[] (optional)

  # Security Layer Integration (can override application-level)
  security:
    requiredRoles: string[] (optional)
    requiredPermissions: string[] (optional)

  # APM Layer Integration
  apm:
    measuredByMetrics: string[] (optional)
    performanceTargets: PerformanceTargets (optional)

  PerformanceTargets:
    loadTimeMs: integer (optional)
    interactionLatencyMs: integer (optional)
    errorRatePercent: number (optional)
    completionRatePercent: number (optional)
```

### Supporting Entities

#### ExperienceState

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

#### StateAction

```yaml
StateAction:
  description: "Action executed during state lifecycle"
  attributes:
    id: string (UUID) [PK]
    name: string
    action: ActionType [enum]
    description: string (optional)

  # Pattern reference (alternative to inline definition)
  usesPattern: ActionPattern.id (optional)
  patternParameters: object (optional)

  # API Integration (used if not using pattern)
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

#### StateTransition

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

  # Condition for guarded transitions
  condition: Condition (optional)

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

#### Condition

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

#### View

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
    layout: LayoutConfig (optional)

  contains:
    - subViews: SubView[] (0..*) # Sub-view instances
    - components: ComponentInstance[] (0..*) # Component instances
    - actions: ActionComponent[] (0..*) # Actions available in view

  references:
    - route: string (route identifier from Navigation Layer, optional)

  # Security Layer Integration
  security:
    resourceRef: string (SecureResource reference, optional)
    requiredRoles: string[] (optional)
    requiredPermissions: string[] (optional)

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
```

#### SubView

```yaml
SubView:
  description: "Instance of a LibrarySubView or custom sub-view definition"
  attributes:
    id: string (UUID) [PK]
    name: string
    title: string (optional)
    description: string (optional)
    order: integer (optional)

  # Reference to library sub-view (if using library)
  libraryRef: LibrarySubView.id (optional)

  # Slot content (provides components for library slots)
  slotContent:
    - slotName: string
      components: ComponentInstance[] (0..*)

  # Override configuration
  overrides:
    layout: LayoutConfig (optional)
    collapsible: boolean (optional)
    collapsed: boolean (optional)

  # Custom components (if not using library)
  components: ComponentInstance[] (0..*)

  # Nested sub-views
  subViews: SubView[] (0..*)

  # Conditional display
  conditionalDisplay: Condition (optional)
```

#### ComponentInstance

```yaml
ComponentInstance:
  description: "Instance of a LibraryComponent with application-specific configuration"
  attributes:
    id: string (UUID) [PK]
    name: string
    order: integer (optional)

  # Reference to library component
  libraryRef: LibraryComponent.id (optional)
  variant: string (optional) # Use specific variant from library

  # Instance-specific overrides
  overrides:
    label: string (optional)
    required: boolean (optional)
    readonly: boolean (optional)
    hidden: boolean (optional)

  # Data binding (overrides or extends library template)
  dataBinding:
    schemaRef: string (JSONPath to property in JSON Schema, optional)
    defaultValue: any (optional)
    dataSource: string (API operation ID, optional)

  # Config overrides
  configOverrides: object (optional)

  # Slot content (for components with slots)
  slotContent:
    - slotName: string
      content: any

  # Conditional display
  conditionalDisplay: Condition (optional)

  # Security overrides
  security:
    fieldAccess: string (optional)
    visibleToRoles: string[] (optional)
    editableByRoles: string[] (optional)

  # Dependencies
  dependsOn: string[] (component names, optional)
  triggers: string[] (components to refresh, optional)
```

#### ActionComponent

```yaml
ActionComponent:
  description: "Interactive element that triggers actions (button, menu, link, voice command)"
  attributes:
    id: string (UUID) [PK]
    name: string
    label: string (optional)
    type: ActionComponentType [enum]
    icon: string (optional)
    disabled: boolean (optional)
    tooltip: string (optional)
    channel: ChannelType (optional)

  # Pattern reference
  usesPattern: ActionPattern.id (optional)
  patternParameters: object (optional)

  # Inline action definition (if not using pattern)
  action: StateAction (optional)

  # Enable condition
  enableCondition: Condition (optional)

  # Confirmation prompt
  confirmationPrompt: string (optional)

  contains:
    - children: ActionComponent[] (0..*)

  enums:
    ActionComponentType:
      - button # Visual button
      - menu-item # Menu option
      - link # Hyperlink
      - voice-command # Voice intent/command
      - chat-button # Chat quick reply
      - sms-keyword # SMS keyword trigger
      - custom # Custom action type

    ButtonStyle:
      - primary
      - secondary
      - danger
      - success
      - warning
      - ghost
      - icon
```

#### ComponentConfig

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

#### ValidationRule

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

## Example UX Specification (Three-Tier Architecture)

### Library Definition

```yaml
# File: libs/ux/core-components.lib.yaml
id: "core-components"
name: "Core Components Library"
version: "2.0.0"
description: "Standard UI components for all applications"
author: "Platform Team"

components:
  - id: "lib-text-input"
    name: "text-input"
    type: form-field
    category: "inputs"
    description: "Standard text input field"
    configTemplate:
      fieldType: text-input
    slots:
      - name: "prefix"
        description: "Content before input"
        required: false
      - name: "suffix"
        description: "Content after input"
        required: false
    variants:
      - name: "search"
        configOverrides:
          props:
            icon: "search"
            clearable: true

  - id: "lib-price-input"
    name: "price-input"
    type: form-field
    category: "inputs"
    description: "Currency input with formatting"
    configTemplate:
      fieldType: number-input
      props:
        min: 0
        step: 0.01
        prefix: "$"
    securityDefaults:
      editableByRoles: ["product-manager", "admin"]

  - id: "lib-select"
    name: "select"
    type: form-field
    category: "inputs"
    configTemplate:
      fieldType: select

  - id: "lib-rich-text"
    name: "rich-text-editor"
    type: form-field
    category: "inputs"
    configTemplate:
      fieldType: rich-text-editor

subViews:
  - id: "lib-form-section"
    name: "form-section"
    description: "Standard form section with title"
    layout:
      type: grid
      columns: 2
      gap: "1rem"
    componentSlots:
      - name: "fields"
        description: "Form fields"
        required: true
        allowedTypes: ["form-field"]
        multiple: true
    collapsible: true

statePatterns:
  - id: "pattern-crud-form"
    name: "crud-form-pattern"
    description: "Standard CRUD form state machine"
    category: "forms"
    parameters:
      - name: "fetchOperation"
        type: "apiOperation"
        required: true
      - name: "saveOperation"
        type: "apiOperation"
        required: true
      - name: "entityPath"
        type: "string"
        default: "$.entity"
    states:
      - name: "initial"
        initial: true
        transitions:
          - to: "loading"
            on: dataReady
            condition:
              expression: "routeParams.id !== null"
          - to: "editing"
            on: dataReady
            condition:
              expression: "routeParams.id === null"
      - name: "loading"
        onEnter:
          - action: fetchData
            api:
              operationId: "{{fetchOperation}}"
            data:
              target: "{{entityPath}}"
            errorHandling:
              onError: "error"
        transitions:
          - to: "viewing"
            on: success
          - to: "error"
            on: failure
      - name: "viewing"
        transitions:
          - to: "editing"
            on: click
      - name: "editing"
        transitions:
          - to: "validating"
            on: submit
          - to: "viewing"
            on: cancel
      - name: "validating"
        onEnter:
          - action: validateForm
        transitions:
          - to: "saving"
            on: success
          - to: "editing"
            on: failure
      - name: "saving"
        onEnter:
          - action: saveData
            api:
              operationId: "{{saveOperation}}"
        transitions:
          - to: "viewing"
            on: success
          - to: "error"
            on: failure
      - name: "error"
        transitions:
          - to: "editing"
            on: click
    entryPoints: ["initial"]
    exitPoints: ["viewing"]

actionPatterns:
  - id: "pattern-delete-confirm"
    name: "delete-with-confirmation"
    description: "Delete with confirmation dialog"
    category: "crud"
    parameters:
      - name: "deleteOperation"
        type: "apiOperation"
        required: true
      - name: "entityName"
        type: "string"
        default: "item"
    actionTemplate:
      action: deleteData
      api:
        operationId: "{{deleteOperation}}"
      errorHandling:
        showNotification: true
    confirmation:
      required: true
      messageTemplate: "Are you sure you want to delete this {{entityName}}?"
```

### Application Definition

```yaml
# File: apps/ux/product-management.app.yaml
id: "product-management-app"
name: "Product Management Application"
version: "2.0.0"
channel: visual
description: "Application for managing product catalog"

libraries:
  - libraryRef: "core-components"
    version: "^2.0.0"

sharedConfig:
  theme: "enterprise-light"
  locale: "en-US"
  errorHandling:
    showNotification: true
    defaultErrorMessage: "An error occurred. Please try again."

references:
  application: "app-product-management"
  archimateElement: "app-comp-product-ui"

motivationAlignment:
  supportsGoals:
    - "goal-product-catalog-accuracy"
    - "goal-editor-productivity"
  deliversValue:
    - "value-operational-efficiency"
  governedByPrinciples:
    - "principle-accessibility-first"
    - "principle-mobile-responsive"

security:
  model: "product-security-model"
  defaultRequiredRoles:
    - "editor"

apm:
  measuredByMetrics:
    - "product.app.active.users"
    - "product.app.error.rate"
```

### UXSpec Definition (Using Patterns and Library)

```yaml
# File: specs/ux/product-edit.ux.yaml
id: "product-edit-experience"
name: "product-edit"
version: "1.0.0"
experience: "product-edit"
title: "Product Editor"
description: "Visual experience for creating and editing products"

# Reference parent application
application: "product-management-app"

# Use state pattern from library
usesPatterns:
  - patternRef: "pattern-crud-form"
    parameters:
      fetchOperation: "getProduct"
      saveOperation: "updateProduct"
      entityPath: "$.product"

references:
  dataSchema: "schemas/product.json"
  apiSpec: "specs/api/product-api.yaml"

# Business Layer Integration
business:
  supportsProcesses:
    - "bp-product-management"
  realizesServices:
    - "bs-product-catalog-management"
  targetActors:
    - "ba-product-manager"
  targetRoles:
    - "br-inventory-specialist"

# Experience-specific motivation alignment
motivationAlignment:
  fulfillsRequirements:
    - "req-product-data-management"
    - "req-real-time-validation"

# APM targets
apm:
  measuredByMetrics:
    - "product.edit.load.time"
    - "product.edit.save.duration"
    - "product.edit.error.rate"
  performanceTargets:
    loadTimeMs: 1000
    interactionLatencyMs: 100
    errorRatePercent: 0.5

# View Definition using library components
views:
  - name: "product-form-view"
    type: form
    title: "Product Details"
    routable: true
    route: "product-edit"
    layout:
      type: grid
      columns: 1
      gap: "1.5rem"

    security:
      resourceRef: "product-edit-screen"
      requiredRoles: ["editor", "product-manager", "admin"]

    subViews:
      # Basic info section using library sub-view
      - name: "basic-info"
        libraryRef: "lib-form-section"
        title: "Basic Information"
        order: 1
        slotContent:
          - slotName: "fields"
            components:
              # Product name using library text input
              - name: "product-name"
                libraryRef: "lib-text-input"
                overrides:
                  label: "Product Name"
                  required: true
                dataBinding:
                  schemaRef: "product.json#/properties/name"
                configOverrides:
                  placeholder: "Enter product name"
                  validation:
                    - type: required
                      message: "Product name is required"
                    - type: minLength
                      value: 3
                      message: "Name must be at least 3 characters"

              # SKU using text input with pattern validation
              - name: "product-sku"
                libraryRef: "lib-text-input"
                overrides:
                  label: "SKU"
                  required: true
                dataBinding:
                  schemaRef: "product.json#/properties/sku"
                configOverrides:
                  placeholder: "AA1234"
                  validation:
                    - type: pattern
                      value: "^[A-Z]{2}\\d{4}$"
                      message: "SKU must be format: AA1234"

              # Price using library price input
              - name: "product-price"
                libraryRef: "lib-price-input"
                overrides:
                  label: "Price"
                  required: true
                dataBinding:
                  schemaRef: "product.json#/properties/price"
                security:
                  fieldAccess: "price"
                  visibleToRoles: ["editor", "product-manager", "admin"]
                  editableByRoles: ["product-manager", "admin"]

              # Category using library select
              - name: "product-category"
                libraryRef: "lib-select"
                overrides:
                  label: "Category"
                  required: true
                dataBinding:
                  schemaRef: "product.json#/properties/category"
                configOverrides:
                  props:
                    options:
                      - value: "electronics"
                        label: "Electronics"
                      - value: "clothing"
                        label: "Clothing"
                      - value: "food"
                        label: "Food"

      # Description section
      - name: "description"
        libraryRef: "lib-form-section"
        title: "Description"
        order: 2
        overrides:
          layout:
            columns: 1
        slotContent:
          - slotName: "fields"
            components:
              - name: "product-description"
                libraryRef: "lib-rich-text"
                overrides:
                  label: "Description"
                dataBinding:
                  schemaRef: "product.json#/properties/description"
                configOverrides:
                  helpText: "Detailed product description for customers"

      # Inventory section (collapsible)
      - name: "inventory"
        libraryRef: "lib-form-section"
        title: "Inventory"
        order: 3
        overrides:
          collapsed: true
        slotContent:
          - slotName: "fields"
            components:
              - name: "stock-quantity"
                libraryRef: "lib-text-input"
                overrides:
                  label: "Stock Quantity"
                dataBinding:
                  schemaRef: "product.json#/properties/stockQuantity"
                configOverrides:
                  fieldType: number-input
                  props:
                    min: 0

              - name: "reorder-point"
                libraryRef: "lib-text-input"
                overrides:
                  label: "Reorder Point"
                dataBinding:
                  schemaRef: "product.json#/properties/reorderPoint"
                configOverrides:
                  fieldType: number-input
                  helpText: "Alert when stock falls below this level"

    # Actions
    actions:
      - name: "save-button"
        label: "Save Product"
        type: button
        icon: "save"
        action:
          action: saveData
        enableCondition:
          expression: "currentState === 'editing'"

      - name: "cancel-button"
        label: "Cancel"
        type: button
        action:
          action: navigateTo
          data:
            target: "/products"

      - name: "delete-button"
        label: "Delete"
        type: button
        icon: "trash"
        usesPattern: "pattern-delete-confirm"
        patternParameters:
          deleteOperation: "deleteProduct"
          entityName: "product"
        enableCondition:
          expression: "product.id !== null"
```

## Migration Guide

### Migrating from Legacy (Flat) to Three-Tier Architecture

#### Before (Legacy Flat Structure)

```yaml
# Old: Single monolithic UXSpec file
version: "0.1.1"
experience: "product-edit"
channel: visual

# All components defined inline
states:
  - name: "initial"
    # ... state definitions

views:
  - name: "product-form"
    components:
      - name: "product-name"
        type: form-field
        config:
          fieldType: text-input
          # Full config inline
```

#### After (Three-Tier Architecture)

```yaml
# Step 1: Extract reusable components to library
# libs/ux/core-components.lib.yaml
components:
  - id: "lib-text-input"
    name: "text-input"
    type: form-field
    configTemplate:
      fieldType: text-input

# Step 2: Extract reusable patterns
statePatterns:
  - id: "pattern-crud-form"
    name: "crud-form-pattern"
    # ... pattern definition

# Step 3: Create application configuration
# apps/ux/product-management.app.yaml
libraries:
  - libraryRef: "core-components"
    version: "^2.0.0"

# Step 4: Simplify UXSpec to reference library
# specs/ux/product-edit.ux.yaml
usesPatterns:
  - patternRef: "pattern-crud-form"
    parameters:
      fetchOperation: "getProduct"

views:
  - subViews:
      - slotContent:
          - components:
              - libraryRef: "lib-text-input"
                overrides:
                  label: "Product Name"
```

### Migration Steps

1. **Identify reusable components**: Look for components used across multiple UXSpecs
2. **Create component library**: Extract common components to `UXLibrary`
3. **Identify state patterns**: Look for repeated state machine structures
4. **Create state patterns**: Extract to `StatePattern` definitions
5. **Create application config**: Define `UXApplication` with library dependencies
6. **Refactor UXSpecs**: Replace inline definitions with library references

## Integration Points

**For complete link patterns and validation rules**, see [Cross-Layer Reference Registry](../core/06-cross-layer-reference-registry.md). The following integration points are defined in the registry with specific patterns and validation requirements.

### To Motivation Layer

- **Experiences support Goals**: `motivationAlignment.supportsGoals` links UX to business objectives
- **Experiences deliver Value**: `motivationAlignment.deliversValue` shows user value contribution
- **Principles guide UX design**: `motivationAlignment.governedByPrinciples` ensures consistent UX (accessibility, mobile-first, multi-channel, etc.)
- **Requirements fulfillment**: `motivationAlignment.fulfillsRequirements` enables requirements traceability from requirements through implementation
- **Product alignment**: Validates features deliver business value
- **Traceability**: Requirement -> UXSpec -> API -> Implementation creates complete audit trail

### To Business Layer

- **Process support**: `business.supportsProcesses` links UX experiences to BusinessProcess entities they support
- **Service realization**: `business.realizesServices` shows which BusinessService entities are realized through the UX
- **Actor targeting**: `business.targetActors` documents which BusinessActor types the experience is designed for
- **Role targeting**: `business.targetRoles` specifies which BusinessRole types use the experience
- **Business context**: Provides business justification for why UX experiences exist
- **Traceability**: BusinessProcess -> UXSpec -> Metrics enables process optimization

### To Application Layer

- **UXApplication.application**: Links UX application to Application entity
- **UXSpec.application**: Links experience to UXApplication
- **Multi-app systems**: Different UX applications for different use cases (customer portal, admin panel, mobile app)
- **Application context**: Each UX spec belongs to a specific application

### To ArchiMate Application Layer

- UXApplication references ApplicationComponent via archimateElement
- Maps to frontend ApplicationComponent types

### To Security Layer

- **Application-level security**: `UXApplication.security.model` references SecurityModel, `defaultRequiredRoles` sets baseline access
- **Experience-level security**: `UXSpec.security` can override application defaults
- **View-level security**: `View.security.resourceRef` links to SecureResource (type: screen), `requiredRoles` and `requiredPermissions` control view access
- **Component-level security**: `ComponentInstance.security.fieldAccess` references SecureResource field-level controls, `visibleToRoles` and `editableByRoles` enable fine-grained access control
- **Library defaults**: `LibraryComponent.securityDefaults` provides default security configuration
- **Implementation**: Enables runtime access control, security testing, and audit compliance
- **Traceability**: SecurityModel -> UXApplication -> UXSpec -> Component enables security requirement validation

### To API Layer (OpenAPI)

- StateAction.api.operationId references OpenAPI operations
- StatePattern parameters can reference API operations via `apiOperation` type
- ComponentInstance.dataSource references API operations
- Ensures UI actions align with available APIs

### To Data Model Layer (JSON Schema)

- ComponentInstance.dataBinding.schemaRef points to schema properties
- LibraryComponent.dataBindingTemplate defines binding patterns
- Ensures components match data structure
- Validation alignment across layers

### To Navigation Layer

- **View to Route**: View.route references Route identifier
- **Action navigation**: ActionComponent navigation actions reference Routes
- **State triggers navigation**: Experience state transitions trigger route changes
- **Flow integration**: NavigationFlow steps reference UXSpec files and entry states
  - `FlowStep.route` -> Route -> `Route.experience` -> UXSpec file
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
- **Closed-loop measurement**: Goal -> UXSpec -> Metrics -> Goal validation enables data-driven UX optimization
- **Frontend traces**: User interactions generate client spans that link to backend traces
- **End-to-end tracing**: Complete transaction visibility across UX and backend systems
- **UX metrics**: Load time, interaction latency, error rates, completion rates, field validation errors
- **Business metrics**: Conversion rates, feature adoption, user satisfaction scores
- **Traceability**: UXSpec -> Metrics -> Goal measurement validates UX effectiveness

## Validation

### Library Validation

```javascript
// UXLibrary validation:
1. Library ID must be unique across all libraries
2. Version must follow semantic versioning
3. If extendsLibrary is set, referenced library must exist
4. Component IDs must be unique within library
5. Component names must be unique within library
6. SubView IDs must be unique within library
7. StatePattern IDs must be unique within library
8. ActionPattern IDs must be unique within library

// LibraryComponent validation:
9. Component type must be valid ComponentType enum value
10. If configTemplate is set, it must match component type
11. Slot names must be unique within component
12. Variant names must be unique within component
13. If securityDefaults.editableByRoles is set, roles must be subset of visibleToRoles

// LibrarySubView validation:
14. ComponentSlot names must be unique within sub-view
15. If allowedTypes is set, values must be valid ComponentType enum values
16. SubViewSlot names must be unique within sub-view
17. Layout type must be valid LayoutStyle enum value

// StatePattern validation:
18. Pattern must have exactly one initial state
19. All transition targets must reference valid states within pattern
20. Parameter names must be unique within pattern
21. Parameters used in templates ({{paramName}}) must be defined
22. entryPoints must reference valid state names
23. exitPoints must reference valid state names

// ActionPattern validation:
24. Parameter names must be unique within pattern
25. Parameters used in templates must be defined
26. actionTemplate.action must be valid ActionType enum value
```

### Application Validation

```javascript
// UXApplication validation:
1. Application ID must be unique
2. All libraryRef values must reference existing UXLibrary entities
3. If version constraint is set, it must be valid semver range
4. Library alias must be unique within application
5. Channel must be valid ChannelType enum value
6. If security.model is set, referenced SecurityModel must exist
7. If security.defaultRequiredRoles is set, roles must exist in SecurityModel
8. All motivationAlignment references must exist in Motivation Layer
9. All apm.measuredByMetrics references must exist in APM Layer
```

### UXSpec Validation

```javascript
// UXSpec validation:
1. If application is set, referenced UXApplication must exist
2. All usesPatterns.patternRef must reference existing StatePattern
3. Pattern parameters must satisfy pattern requirements
4. If states is set, exactly one must be initial
5. All state transitions must reference valid states
6. All operationIds must exist in referenced OpenAPI spec
7. All schemaRef paths must exist in referenced JSON Schema
8. Component instance names must be unique within View/SubView
9. View names must be unique within UXSpec
10. Route references must exist in Navigation Layer

// ComponentInstance validation:
11. If libraryRef is set, referenced LibraryComponent must exist
12. If variant is set, it must exist in referenced LibraryComponent
13. Overrides must be compatible with library component type
14. dataBinding.schemaRef must exist in referenced schema
15. Security roles must exist in application's SecurityModel

// SubView validation:
16. If libraryRef is set, referenced LibrarySubView must exist
17. slotContent must provide components for required slots
18. Components in slots must match allowedTypes constraint

// Cross-layer validation:
19. All business.supportsProcesses references must exist in Business Layer
20. All business.realizesServices references must exist in Business Layer
21. All business.targetActors references must exist in Business Layer
22. All business.targetRoles references must exist in Business Layer
23. All motivationAlignment references must exist in Motivation Layer
24. All security references must exist in Security Layer
25. All apm.measuredByMetrics references must exist in APM Layer
26. Performance target percentages must be between 0 and 100
```

## Property Conventions

### File Naming

```yaml
Libraries: "{library-name}.lib.yaml"
Examples:
  - core-components.lib.yaml
  - ecommerce-components.lib.yaml
  - voice-components.lib.yaml

Applications: "{app-name}.app.yaml"
Examples:
  - product-management.app.yaml
  - customer-portal.app.yaml
  - admin-dashboard.app.yaml

UXSpecs: "{experience-identifier}.ux.yaml"
Examples:
  - product-edit.ux.yaml
  - customer-list.ux.yaml
  - order-status-voice.ux.yaml
  - support-chat.ux.yaml
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

### Library Design

1. **Single Responsibility**: Each library component should do one thing well
2. **Composability**: Design components to work together via slots
3. **Sensible Defaults**: Provide good default configurations
4. **Documentation**: Include descriptions for components, slots, and variants
5. **Versioning**: Follow semantic versioning for library updates
6. **Security Defaults**: Include default security configuration where applicable

### Pattern Design

1. **Parameterization**: Make patterns flexible through well-designed parameters
2. **Entry/Exit Points**: Clearly define where patterns can be entered and exited
3. **Error Handling**: Include error states and recovery paths
4. **Reusability**: Design patterns for common UX flows (CRUD, wizard, list-detail)

### Application Design

1. **Library Selection**: Choose minimal set of libraries needed
2. **Shared Configuration**: Use application-level defaults to reduce repetition
3. **Security Baseline**: Set default security requirements at application level
4. **Metrics Strategy**: Define application-wide metrics

### UXSpec Design

1. **Pattern First**: Prefer patterns over custom state machines
2. **Library Components**: Use library components with overrides vs inline definitions
3. **Minimal Overrides**: Only override what's necessary
4. **Slot Content**: Provide slot content for library sub-views
5. **Clear Naming**: Use descriptive names for components and views
6. **Validation Alignment**: Validation should match schema constraints
7. **Error Handling**: Define error states and transitions
8. **Loading States**: Always indicate loading for async operations
9. **Accessibility**: Include labels, help text, and appropriate affordances

## Code Generation

UX specs enable generation of:

```yaml
Library Code:
  - Reusable React/Vue/Angular component packages
  - Component documentation and storybooks
  - Design system tokens

Pattern Code:
  - State machine configurations (XState, Redux)
  - Reusable hooks/composables
  - Test templates

Application Code:
  - Application shell and routing
  - Theme configuration
  - Security context providers

Frontend Code (Visual):
  - React/Vue/Angular components (using library)
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
  - Component unit tests
  - State machine tests
  - Integration tests with API mocks
  - Visual regression tests
```

## Common Patterns

### List-Detail Pattern

```yaml
# Use list-selection-pattern for list view
List Experience (product-list.ux.yaml):
  usesPatterns:
    - patternRef: "list-selection-pattern"
      parameters:
        listOperation: "getProducts"
        itemsPath: "$.products"

# Use crud-form-pattern for detail view
Detail Experience (product-detail.ux.yaml):
  usesPatterns:
    - patternRef: "crud-form-pattern"
      parameters:
        fetchOperation: "getProduct"
        saveOperation: "updateProduct"
```

### Wizard Pattern

```yaml
# Define wizard-specific pattern
Multi-Step Wizard:
  usesPatterns:
    - patternRef: "wizard-pattern"
      parameters:
        steps: ["personal-info", "address", "payment", "review"]
        submitOperation: "createOrder"
```

### Master-Detail Pattern

```yaml
Split View:
  - View type: split
  - Left SubView: Uses list-selection-pattern
  - Right SubView: Uses crud-form-pattern
  - Sync: Selection in master triggers detail load via shared state
```

### Voice Interaction Pattern

```yaml
Voice Experience (order-status-voice.ux.yaml):
  - Channel: voice
  - usesPatterns:
      - patternRef: "voice-query-pattern"
        parameters:
          queryOperation: "getOrderStatus"
          confirmationRequired: true
```

### Chat Conversation Pattern

```yaml
Chat Experience (support-chat.ux.yaml):
  - Channel: chat
  - usesPatterns:
      - patternRef: "chat-conversation-pattern"
        parameters:
          intentHandlers:
            - orderStatus
            - productInfo
            - humanHandoff
```

This UX Layer specification provides a comprehensive, implementation-ready definition of user experiences across channels that bridges design and development through a three-tier architecture promoting reusability and consistency.
