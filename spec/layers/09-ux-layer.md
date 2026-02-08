# Layer 9: UX Layer

**Standard**: [HTML 5.3](https://html.spec.whatwg.org/)

---

## Overview

This layer defines **53** node types that represent various aspects of the architecture.

## Node Types

### UXLibrary

**ID**: `ux.uxlibrary`

Collection of reusable UI components and sub-views that can be shared across applications

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string (required)
- `description`: string
- `author`: string
- `license`: string
- `components`: array
  - Contains relationship
- `subViews`: array
  - Contains relationship
- `statePatterns`: array
  - Contains relationship
- `actionPatterns`: array
  - Contains relationship
- `source`: object
  - Source code reference

### AnimationType

**ID**: `ux.animationtype`

AnimationType element in UX Layer

### ButtonStyle

**ID**: `ux.buttonstyle`

ButtonStyle element in UX Layer

### FilterType

**ID**: `ux.filtertype`

FilterType element in UX Layer

### ActionComponent

**ID**: `ux.actioncomponent`

Interactive element that triggers actions (button, menu, link, voice command)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `label`: string
- `type`: string (required)
- `icon`: string
- `disabled`: boolean
- `tooltip`: string
- `channel`: string
- `children`: array
  - Contains relationship

### ComponentInstance

**ID**: `ux.componentinstance`

Instance of a LibraryComponent with application-specific configuration

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `order`: integer

### PerformanceTargets

**ID**: `ux.performancetargets`

Defines performance SLAs for UI components including load time, interaction responsiveness, and rendering thresholds. Enables performance monitoring and optimization.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)

### LayoutType

**ID**: `ux.layouttype`

LayoutType element in UX Layer

### AlignContent

**ID**: `ux.aligncontent`

AlignContent element in UX Layer

### ErrorConfig

**ID**: `ux.errorconfig`

Configuration for error handling and display within UI components, specifying error message formats, retry behavior, fallback content, and user guidance. Ensures consistent error UX.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `showNotification`: boolean
- `notificationType`: string
- `errorMessage`: string
- `defaultErrorMessage`: string

### ChannelType

**ID**: `ux.channeltype`

ChannelType element in UX Layer

### TextAlign

**ID**: `ux.textalign`

TextAlign element in UX Layer

### HttpMethod

**ID**: `ux.httpmethod`

HttpMethod element in UX Layer

### ColumnDisplayType

**ID**: `ux.columndisplaytype`

ColumnDisplayType element in UX Layer

### ViewType

**ID**: `ux.viewtype`

ViewType element in UX Layer

### TriggerType

**ID**: `ux.triggertype`

TriggerType element in UX Layer

### View

**ID**: `ux.view`

Routable grouping of components (a complete user experience)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `title`: string
- `description`: string
- `routable`: boolean
- `layout`: string
- `subViews`: array
  - Contains relationship
- `components`: array
  - Contains relationship
- `actions`: array
  - Contains relationship
- `source`: object
  - Source code reference

### JustifyContent

**ID**: `ux.justifycontent`

JustifyContent element in UX Layer

### ApiConfig

**ID**: `ux.apiconfig`

Configuration for API integration within UI components, specifying endpoints, request/response mapping, authentication, and caching strategies. Connects UI to backend services.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `operationId`: string (required)
- `method`: string (required)
- `endpoint`: string (required)
- `baseUrl`: string (required)

### StatePattern

**ID**: `ux.statepattern`

Reusable state machine pattern for common UX flows

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `category`: string

### DataSource

**ID**: `ux.datasource`

DataSource element in UX Layer

### LineStyle

**ID**: `ux.linestyle`

LineStyle element in UX Layer

### LabelPosition

**ID**: `ux.labelposition`

LabelPosition element in UX Layer

### StickyPosition

**ID**: `ux.stickyposition`

StickyPosition element in UX Layer

### ValidationType

**ID**: `ux.validationtype`

ValidationType element in UX Layer

### UXSpec

**ID**: `ux.uxspec`

Complete UX specification for a single experience (visual, voice, chat, SMS)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string
- `experience`: string
- `title`: string
- `description`: string
- `source`: object
  - Source code reference

### DataConfig

**ID**: `ux.dataconfig`

Configuration for data binding and state management within UI components, defining data sources, transformation pipelines, and update triggers. Manages component data flow.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `source`: string (required)
- `target`: string (required)
- `path`: string

### LayoutConfig

**ID**: `ux.layoutconfig`

Configuration for UI layout structure, defining grid systems, responsive breakpoints, spacing rules, and component arrangement patterns. Controls visual organization of the interface.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `columns`: integer
- `rows`: integer
- `gap`: string
- `rowGap`: string
- `columnGap`: string
- `padding`: string
- `margin`: string
- `maxWidth`: string

### SortDirection

**ID**: `ux.sortdirection`

SortDirection element in UX Layer

### SeriesType

**ID**: `ux.seriestype`

SeriesType element in UX Layer

### ActionComponentType

**ID**: `ux.actioncomponenttype`

ActionComponentType element in UX Layer

### NotificationType

**ID**: `ux.notificationtype`

NotificationType element in UX Layer

### TableColumn

**ID**: `ux.tablecolumn`

Configuration for a single column within a data table component, specifying header, data binding, sorting, filtering, and rendering options. Defines table structure and behavior.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `header`: string (required)
- `field`: string (required)
- `width`: string
- `minWidth`: string
- `maxWidth`: string

### ActionPattern

**ID**: `ux.actionpattern`

Reusable action configuration for common user interactions

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `description`: string
- `category`: string

### TransitionTemplate

**ID**: `ux.transitiontemplate`

Defines reusable animation and transition patterns for state changes, page navigation, or component lifecycle events. Ensures consistent motion design across the application.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `to`: string (required)
- `trigger`: string (required)
- `description`: string

### JustifyItems

**ID**: `ux.justifyitems`

JustifyItems element in UX Layer

### SubView

**ID**: `ux.subview`

Instance of a LibrarySubView or custom sub-view definition

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `title`: string
- `description`: string
- `order`: integer

### LibraryComponent

**ID**: `ux.librarycomponent`

Reusable UI component definition that can be instantiated in multiple UXSpecs

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `label`: string
- `description`: string
- `category`: string
- `source`: object
  - Source code reference

### LibrarySubView

**ID**: `ux.librarysubview`

Reusable grouping of components that can be composed into views

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `title`: string
- `description`: string
- `category`: string

### AlignItems

**ID**: `ux.alignitems`

AlignItems element in UX Layer

### UXApplication

**ID**: `ux.uxapplication`

Application-level UX configuration that groups UXSpecs and defines shared settings

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `version`: string
- `description`: string
- `channel`: string (required)
- `experiences`: array
  - Contains relationship

### ExperienceState

**ID**: `ux.experiencestate`

Distinct state that the experience can be in (works across all channels)

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `initial`: boolean
- `description`: string
- `channel`: string
- `onEnter`: array
  - Contains relationship
- `onExit`: array
  - Contains relationship
- `transitions`: array
  - Contains relationship
- `enabledComponents`: array
  - Contains relationship
- `disabledComponents`: array
  - Contains relationship
- `hiddenComponents`: array
  - Contains relationship

### ChartSeries

**ID**: `ux.chartseries`

Configuration for a data series within a chart component, specifying data source, visualization type, colors, and legend properties. Defines how data is visualized in charts.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `label`: string (required)
- `type`: string
- `dataField`: string (required)
- `categoryField`: string

### ValidationRule

**ID**: `ux.validationrule`

Client-side validation rule for a field

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `type`: string (required)
- `message`: string
- `value`: string

### ComponentType

**ID**: `ux.componenttype`

ComponentType element in UX Layer

### StateActionTemplate

**ID**: `ux.stateactiontemplate`

A reusable template defining actions to execute during component state transitions. Enables standardized behavior patterns for common state changes.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `action`: string (required)
- `description`: string

### ComponentReference

**ID**: `ux.componentreference`

A reference to another UI component that can be embedded or composed within a parent component. Enables component reuse and modular UI architecture.

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `ref`: string (required)
- `variant`: string
- `slot`: string

### LayoutStyle

**ID**: `ux.layoutstyle`

LayoutStyle element in UX Layer

### Condition

**ID**: `ux.condition`

Boolean expression for guard conditions

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `expression`: string

### ActionType

**ID**: `ux.actiontype`

ActionType element in UX Layer

### StateAction

**ID**: `ux.stateaction`

Action executed during state lifecycle

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `action`: string (required)
- `description`: string

### CacheStrategy

**ID**: `ux.cachestrategy`

CacheStrategy element in UX Layer

### StateTransition

**ID**: `ux.statetransition`

Transition from current state to another state

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `to`: string
- `trigger`: string (required)
- `description`: string
- `actions`: array
  - Contains relationship

## References

- [HTML 5.3](https://html.spec.whatwg.org/)
