---
name: LAYER_09_UX
description: Expert knowledge for UX Layer modeling in Documentation Robotics
triggers:
  [
    "UX",
    "user interface",
    "UI",
    "view",
    "component",
    "screen",
    "form",
    "user experience",
    "state machine"
  ]
version: 0.8.3
---

# UX Layer Skill

**Layer Number:** 09
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines user experience using Three-Tier Architecture, specifying views, components, state machines, and interactions.

---

## Layer Overview

The UX Layer captures **user experience design**:

- **VIEWS** - Screens/pages, modals, dialogs, drawers, and panels
- **COMPONENTS** - UI components (forms, tables, charts, cards)
- **STATE MACHINES** - Experience states and transitions
- **ACTIONS** - Interactive elements (buttons, links, voice commands)
- **LAYOUTS** - Layout configurations (grid, flex, etc.)

This layer uses **Three-Tier Architecture** (v0.5.0+):

1. **Library Tier** - Reusable design system components
2. **Application Tier** - Application-wide configuration
3. **Experience Tier** - Experience-specific views and flows

**Central Entity:** The **View** (page, modal, dialog, drawer, or panel) is the core modeling unit.

---

## When to Use This Skill

Activate when the user:

- Mentions "UX", "UI", "view", "screen", "component", "form"
- Wants to define user interfaces or user experiences
- Asks about state machines, transitions, or user flows
- Needs to model screens, forms, or interactive elements
- Wants to link UX to navigation, APIs, or business processes

---

## Entity Types

> **CLI Introspection:** Run `dr schema types ux` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

### Three-Tier Architecture (22 entities)

**Library Tier:**

- **UXLibrary** - Container for library components
- **LibraryComponent** - Reusable component (form-field, table, chart, card)
- **LibrarySubView** - Reusable component groupings
- **StatePattern** - Reusable state machine patterns
- **ActionPattern** - Reusable action definitions
- **StateActionTemplate** - Reusable template for state lifecycle actions (required: `action`)
- **TransitionTemplate** - Reusable template for state transitions (required: `to`, `trigger`)
- **TableColumn** - Column definition for table components (required: `header`, `field`)
- **ChartSeries** - Data series configuration for chart components (required: `label`, `dataField`)

**Application Tier:**

- **UXApplication** - Application-wide UX configuration

**Experience Tier:**

- **UXSpec** - Container for experience specification
- **View** - Screen/page/modal/dialog/drawer/panel (required: `type`)
- **SubView** - Component grouping within view
- **ComponentInstance** - Instance of library component
- **ComponentReference** - Reference to a library component by ID (required: `ref`)
- **ActionComponent** - Interactive element (button, link, voice command)
- **ExperienceState** - State in state machine
- **StateAction** - Action during state lifecycle
- **StateTransition** - Transition between states
- **LayoutConfig** - Layout configuration for views and components (required: `type`)
- **DataConfig** - Data binding configuration (required: `source`, `target`)
- **ErrorConfig** - Error handling configuration for components

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any UX element.

```
LIBRARY TIER — reusable, cross-experience artifacts
├── Component library container?                               → ux.uxlibrary
├── Reusable UI component type (form, table, chart, card)?    → ux.librarycomponent
├── Reusable grouping of components?                          → ux.librarysubview
├── Reusable state machine pattern?                           → ux.statepattern
├── Reusable action definition?                               → ux.actionpattern
├── Reusable parameterized state action template?             → ux.stateactiontemplate
│     (no lifecycle binding; has parameters array)
├── Reusable transition template with animation?              → ux.transitiontemplate
│     (has animationType/duration/easing; both `to` and `trigger` required)
├── Column definition for a table component?                  → ux.tablecolumn
└── Data series definition for a chart component?             → ux.chartseries

APPLICATION TIER — app-wide UX configuration
└── Application-wide UX configuration (channel required)?     → ux.uxapplication

EXPERIENCE TIER — specific to a view or experience
├── Top-level experience specification container?             → ux.uxspec
├── Screen, page, modal, dialog, drawer, or panel?           → ux.view
│     (required: type enum — page|modal|dialog|drawer|panel|overlay|embedded|full-screen)
├── Section or grouping within a view?                        → ux.subview
├── Placed instance of a component on a view?                 → ux.componentinstance
│     (has `order` for positioning and `props` for overrides)
├── Typed reference to a component by slot or variant?        → ux.componentreference
│     (ref required; use when targeting a specific variant or slot, not placement)
├── Interactive element (button, link, voice command)?        → ux.actioncomponent
├── State in an experience state machine?                     → ux.experiencestate
├── Concrete action bound to a state lifecycle?               → ux.stateaction
│     (has lifecycle: on-enter|on-exit|on-transition and timing; no parameters)
├── Concrete transition with trigger and optional guard?      → ux.statetransition
│     (trigger required; has guard conditions and inline actions; no animation)
├── Layout configuration (grid, flex, block, etc.)?           → ux.layoutconfig
├── Data binding configuration (source → target)?             → ux.dataconfig
└── Error handling configuration?                             → ux.errorconfig
```

---

## Intra-Layer Relationships

Placement is `composes`: a view composes its sub-views, instances and action components, and an
instance composes its nested instances, slots, chart series and table columns. Instances and placed
sub-views `realizes` their library definition. Elements `applies` their layout, `binds-to` their data
config and `uses` their error config. A state composes its outgoing transitions, which `flows-to`
the next state. UX reaches other layers only through the interfaces and features a view realizes,
the operations an action triggers and the data a data config maps to.

| Source Type        | Predicate    | Target Type         | Example                                                       |
| ------------------ | ------------ | ------------------- | ------------------------------------------------------------- |
| UXApplication      | aggregates   | UXSpec              | "Storefront Web" aggregates the "Checkout Experience" spec    |
| UXSpec             | aggregates   | View                | "Checkout Experience" aggregates the "Cart" view              |
| UXSpec             | aggregates   | ExperienceState     | "Checkout Experience" aggregates the "Payment Pending" state  |
| UXSpec             | uses         | UXLibrary           | "Checkout Experience" uses the "Design System" library        |
| UXLibrary          | aggregates   | LibraryComponent    | "Design System" aggregates "Data Table"                       |
| UXLibrary          | aggregates   | LibrarySubView      | "Design System" aggregates "Address Form Group"               |
| View               | composes     | SubView             | "Cart" view composes the "Order Summary" panel                |
| View               | composes     | ComponentInstance   | "Cart" view composes "Cart Items Table"                       |
| View               | composes     | ActionComponent     | "Cart" view composes the "Checkout" button                    |
| View               | applies      | LayoutConfig        | "Cart" view applies the "Two-Column Grid" layout              |
| View               | binds-to     | DataConfig          | "Cart" view binds to "Cart Data"                              |
| View               | uses         | ErrorConfig         | "Cart" view uses "Cart Load Error"                            |
| SubView            | realizes     | LibrarySubView      | "Shipping Address" section realizes "Address Form Group"      |
| SubView            | composes     | ComponentInstance   | "Order Summary" panel composes "Totals Card"                  |
| ComponentInstance  | realizes     | LibraryComponent    | "Cart Items Table" realizes "Data Table"                      |
| ComponentInstance  | binds-to     | DataConfig          | "Cart Items Table" binds to "Cart Data"                       |
| ComponentInstance  | composes     | TableColumn         | "Cart Items Table" composes the "Quantity" column             |
| ComponentInstance  | composes     | ChartSeries         | "Revenue Chart" composes the "Monthly Revenue" series         |
| ComponentReference | references   | LibraryComponent    | "Primary Button Slot" references "Button" (variant `primary`) |
| LibraryComponent   | composes     | LibraryComponent    | "Data Table" composes "Pagination Bar"                        |
| LibraryComponent   | specializes  | LibraryComponent    | "Currency Input" specializes "Text Input"                     |
| LibraryComponent   | uses         | StatePattern        | "Data Table" uses the "Loading / Loaded / Error" pattern      |
| ActionPattern      | governs      | ActionComponent     | The "Submit" action pattern governs the "Checkout" button     |
| ActionComponent    | triggers     | StateTransition     | "Checkout" button triggers "Begin Payment"                    |
| ActionComponent    | navigates-to | View                | "Continue Shopping" link navigates to the "Catalog" view      |
| ExperienceState    | composes     | StateTransition     | "Cart Ready" composes "Begin Payment"                         |
| StateTransition    | flows-to     | ExperienceState     | "Begin Payment" flows to "Payment Pending"                    |
| StateTransition    | triggers     | StateAction         | "Begin Payment" triggers "Disable Checkout Button"            |
| StateAction        | realizes     | StateActionTemplate | "Show Spinner" realizes the "Show Loading Indicator" template |
| StatePattern       | aggregates   | ExperienceState     | "Loading / Loaded / Error" aggregates "Loading"               |
| StateTransition    | uses         | TransitionTemplate  | "Open Cart" uses the "Slide-In Drawer" template               |
| DataConfig         | uses         | ErrorConfig         | "Cart Data" uses the "Cart Load Error" config                 |

---

## Cross-Layer References

### Outgoing References (UX → Other Layers)

| Source Type      | Predicate  | Target Type                        | Example                                                         |
| ---------------- | ---------- | ---------------------------------- | --------------------------------------------------------------- |
| View             | realizes   | `product.feature`                  | "Cart" view realizes the "Shopping Cart" feature                |
| View             | references | `business.businessobject`          | "Order Detail" view references the "Order" business object      |
| View             | realizes   | `application.applicationinterface` | "Cart" view realizes the "Storefront Web UI" interface          |
| View             | satisfies  | `motivation.requirement`           | "Checkout" view satisfies "Guest checkout must be supported"    |
| View             | requires   | `security.permission`              | "Admin Orders" view requires the `orders:read` permission       |
| View             | serves     | `business.businessrole`            | "Admin Orders" view serves the "Fulfillment Clerk" role         |
| ActionComponent  | triggers   | `api.operation`                    | "Place Order" button triggers `POST /orders`                    |
| ActionComponent  | requires   | `security.permission`              | "Refund" button requires the `orders:refund` permission         |
| StateAction      | triggers   | `api.operation`                    | "Load Cart" on-enter action triggers `GET /cart`                |
| DataConfig       | maps-to    | `api.response`                     | "Cart Data" maps to the `GET /cart` 200 response                |
| DataConfig       | maps-to    | `api.requestbody`                  | "Checkout Form Data" maps to the `POST /orders` request body    |
| DataConfig       | maps-to    | `data-model.objectschema`          | "Cart Data" maps to the "Cart" schema                           |
| TableColumn      | maps-to    | `data-model.schemaproperty`        | "Quantity" column maps to the "quantity" property               |
| TableColumn      | references | `security.fieldaccesscontrol`      | "Card Number" column references the "PAN Masking" control       |
| ErrorConfig      | references | `api.response`                     | "Payment Declined" references the `POST /payments` 402 response |
| LibraryComponent | depends-on | `technology.systemsoftware`        | "Data Table" depends on "React 18"                              |

### Incoming References (Other Layers → UX)

| Source Type                       | Predicate | Target Type     | Example                                                         |
| --------------------------------- | --------- | --------------- | --------------------------------------------------------------- |
| `navigation.route`                | maps-to   | View            | `/cart` route maps to the "Cart" view                           |
| `navigation.navigationtransition` | triggers  | StateTransition | "Cart → Checkout" transition triggers "Begin Payment"           |
| `navigation.navigationguard`      | triggers  | ExperienceState | "Require Login" guard triggers the "Signed Out" state           |
| `testing.testcasesketch`          | tests     | View            | "Empty cart renders placeholder" tests the "Cart" view          |
| `testing.testcasesketch`          | tests     | ActionComponent | "Checkout disabled when cart empty" tests the "Checkout" button |
| `apm.span`                        | monitors  | View            | "page.load /cart" span monitors the "Cart" view                 |
| `apm.metricinstrument`            | monitors  | ActionComponent | "checkout_click_count" monitors the "Checkout" button           |

> Routing is modelled from the Navigation Layer: a `navigation.route` `maps-to` the view it shows,
> rather than the view pointing at the route.

---

## Design Best Practices

1. **Reusability** - Use library components for consistency
2. **State machines** - Model complex flows with states/transitions
3. **Error handling** - Define error states, ErrorConfig, and recovery transitions
4. **Accessibility** - Consider accessibility requirements
5. **Responsive** - Design for multiple screen sizes
6. **Performance** - Set performance targets (load time, interaction latency)

---

## React Flow / Graph Visualization Patterns

When the codebase uses a graph visualization library (React Flow, D3, Cytoscape), apply these patterns in addition to the standard UX decision tree.

### Configuration-Driven Node Renderer

```tsx
// src/core/nodes/components/UnifiedNode.tsx
export function UnifiedNode({ data }: NodeProps<UnifiedNodeData>) {
  const config = nodeConfigLoader.get(data.elementType);
  return <div style={config.styles}>{data.name}</div>;
}
// src/core/nodes/nodeConfig.json  ← drives all 20 node type styles
```

→ `UnifiedNode.tsx` → `ux.librarycomponent.unified-node` (type: graph-node)
→ `nodeConfig.json` → `data-model.objectschema.node-config`
→ Do NOT create 20 separate elements for each node type in the config — the configuration-driven system as a whole is one `librarycomponent`

### Custom Edge Type

```tsx
// src/core/edges/ElbowEdge.tsx
export function ElbowEdge(props: EdgeProps) { ... }
```

→ `ux.librarycomponent.elbow-edge` (type: graph-edge)
→ Each distinct custom edge type → one `librarycomponent`

### Layer Container / Swimlane Node

```tsx
// src/core/nodes/LayerContainerNode.tsx
export function LayerContainerNode({ data }: NodeProps) { ... }
```

→ `ux.librarycomponent.layer-container-node` (type: graph-container)

### Graph Canvas Component

```tsx
// src/core/components/GraphViewer.tsx
export function GraphViewer({ nodes, edges }) {
  return <ReactFlow nodeTypes={nodeTypes} edgeTypes={edgeTypes} />;
}
```

→ Already captured in the application layer as `ApplicationComponent`. Do NOT add it again as a UX element — the `ux.view.*` that represents the graph page already serves this purpose in the UX layer.

### Sub-components (field lists, tooltips, badges)

`FieldList.tsx`, `FieldTooltip.tsx`, `RelationshipBadge.tsx`, `BadgeRenderer.tsx` are internal implementation details of `UnifiedNode`. Do NOT add them as separate `librarycomponent` entries.

---

## Common Commands

```bash
# Add view
dr add ux view "User Profile" --description "User profile page"

# Add component instance
dr add ux component-instance "Profile Form"

# List views
dr list ux --type view

# Validate UX layer
dr validate --layers ux

# Export UX documentation
dr export markdown --layers ux
```

---

## Example: Login Screen

A login page with a form component, state machine, and data binding:

```bash
# Add the view (page type, routable)
dr add ux view "Login" --description "Login page" --attributes '{"type":"page","routable":true}'
# → id: ux.view.login

# Add a form component from the library
dr add ux librarycomponent "Login Form" --description "Email/password form" --attributes '{"type":"form"}'
# → id: ux.librarycomponent.login-form

# Place the form as an instance on the login view
dr add ux componentinstance "Login Form Instance"
# → id: ux.componentinstance.login-form-instance

# Add states for the login flow
dr add ux experiencestate "Idle"
dr add ux experiencestate "Submitting"
dr add ux experiencestate "Error"

# Add a transition: click submit → submitting
dr add ux statetransition "Submit Clicked" --attributes '{"trigger":"click","to":"ux.experiencestate.submitting"}'
# → id: ux.statetransition.submit-clicked

# Add data config binding the form to the API
dr add ux dataconfig "Login Data" --attributes '{"source":"api","target":"ux.componentinstance.login-form-instance"}'

# Add error config for failed login
dr add ux errorconfig "Login Error" --description "Show inline error on auth failure"

# Wire the elements together
dr relationship add ux.view.login ux.componentinstance.login-form-instance --predicate composes
dr relationship add ux.componentinstance.login-form-instance ux.librarycomponent.login-form --predicate realizes
dr relationship add ux.statetransition.submit-clicked ux.experiencestate.submitting --predicate flows-to
dr relationship add ux.componentinstance.login-form-instance ux.dataconfig.login-data --predicate binds-to
dr relationship add ux.view.login ux.errorconfig.login-error --predicate uses
```

---

## Pitfalls to Avoid

- ❌ Not using library components (inconsistent UX)
- ❌ Complex state machines without documentation
- ❌ Not linking to API operations or navigation routes
- ❌ Missing error states and handling
- ❌ No performance targets defined

---

## Coverage Completeness Checklist

Before declaring UX layer extraction complete, verify each type was considered:

- [ ] **ux.uxlibrary** — Component library container
- [ ] **ux.librarycomponent** — Reusable UI component (form-field, table, chart, card)
- [ ] **ux.librarysubview** — Reusable grouping of components
- [ ] **ux.statepattern** — Reusable state machine pattern
- [ ] **ux.actionpattern** — Reusable action definition
- [ ] **ux.stateactiontemplate** — Reusable state action template
- [ ] **ux.transitiontemplate** — Reusable transition template
- [ ] **ux.tablecolumn** — Column definition for table components
- [ ] **ux.chartseries** — Data series configuration for chart components
- [ ] **ux.uxapplication** — Application-wide UX configuration
- [ ] **ux.uxspec** — Experience specification container
- [ ] **ux.view** — Screen, page, modal, dialog, drawer, or panel (required: `type`)
- [ ] **ux.subview** — Section or panel within a view
- [ ] **ux.componentinstance** — Instance of a library component on a view
- [ ] **ux.componentreference** — Reference to a library component by ID
- [ ] **ux.actioncomponent** — Interactive element (button, link, voice command)
- [ ] **ux.experiencestate** — State in experience state machine
- [ ] **ux.stateaction** — Action executed during a state lifecycle
- [ ] **ux.statetransition** — Transition between states
- [ ] **ux.layoutconfig** — Layout configuration (grid, flex, block, etc.)
- [ ] **ux.dataconfig** — Data binding configuration (source → target)
- [ ] **ux.errorconfig** — Error handling configuration

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.
