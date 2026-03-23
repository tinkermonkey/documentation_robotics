---
name: LAYER_10_NAVIGATION
description: Expert knowledge for Navigation Layer modeling in Documentation Robotics
triggers:
  [
    "navigation",
    "routing",
    "route",
    "flow",
    "navigation guard",
    "redirect",
    "navigation flow"
  ]
version: 0.8.3
---

# Navigation Layer Skill

**Layer Number:** 10
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines multi-modal navigation flows, routes, guards, and transitions between views.

---

## Layer Overview

The Navigation Layer captures **navigation and routing**:

- **GRAPH** - Top-level container for the entire navigation model (`navigationgraph`)
- **ROUTES** - URL paths to views; types include `public`, `protected`, `redirect`, `alias`, `lazy` (`route`)
- **ROUTE METADATA** - Auth requirements, layout, keepAlive metadata per route (`routemeta`)
- **BREADCRUMBS** - Breadcrumb trail configuration per route (`breadcrumbconfig`)
- **GUARDS** - Pre-navigation authorization/validation checks (`navigationguard`)
- **GUARD CONDITIONS** - Boolean expressions evaluated by guards (`guardcondition`)
- **GUARD ACTIONS** - Actions on guard failure: redirect, block, notify, prompt (`guardaction`)
- **FLOWS** - Multi-step navigation sequences (`navigationflow`)
- **FLOW STEPS** - Individual steps within a flow (`flowstep`)
- **TRANSITIONS** - Directed transitions between routes with triggers (`navigationtransition`)
- **CONTEXT** - Navigation-scoped context variables (`contextvariable`)

This layer uses **Multi-Modal Navigation** supporting web, mobile, voice, and other modalities.

**Central Entity:** The **Route** (URL path to view) is the core modeling unit.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types navigation` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

### Core Navigation Entities (11 entities)

| Entity Type              | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| **NavigationGraph**      | Top-level container representing the complete navigation model    |
| **Route**                | URL path mapped to a view; the core modeling unit                 |
| **RouteMeta**            | Auth, layout, and lifecycle metadata attached to a route          |
| **NavigationGuard**      | Authorization/validation check executed before navigation         |
| **GuardCondition**       | Boolean expression evaluated by a navigation guard                |
| **GuardAction**          | Action taken when a guard fails (redirect, block, notify, prompt) |
| **NavigationFlow**       | Multi-step navigation sequence                                    |
| **FlowStep**             | A single step within a navigation flow                            |
| **NavigationTransition** | Directed transition between two routes                            |
| **ContextVariable**      | Navigation-scoped context data passed between routes              |
| **BreadcrumbConfig**     | Breadcrumb trail configuration for a route                        |

---

## Type Decision Tree

Use this decision tree **before assigning a type** to any navigation element.

```
Is this the top-level navigation model for an application?
  → navigation.navigationgraph.*

Is this a URL path/route that maps to a view?
  → navigation.route.*

Is this metadata about a route (auth requirements, layout, keepAlive)?
  → navigation.routemeta.*

Is this a breadcrumb configuration for a route?
  → navigation.breadcrumbconfig.*

Is this a guard that checks conditions before allowing navigation?
  → navigation.navigationguard.*

Is this a boolean expression/predicate evaluated inside a guard?
  → navigation.guardcondition.*

Is this the action to take when a guard fails (redirect, block, notify, prompt)?
  → navigation.guardaction.*

Is this a named multi-step navigation sequence (wizard, checkout, onboarding)?
  → navigation.navigationflow.*

Is this a single step within a navigation flow?
  → navigation.flowstep.*

Is this a directed transition between two specific routes with a trigger?
  → navigation.navigationtransition.*

Is this a context variable scoped to the navigation session?
  → navigation.contextvariable.*
```

---

## When to Use This Skill

Activate when the user:

- Mentions "navigation", "routing", "routes", "flows"
- Wants to define URL paths or route guards
- Asks about multi-step flows or navigation transitions
- Needs to model navigation between screens
- Wants to link navigation to UX views or business processes

---

## Cross-Layer Relationships

**Outgoing (Navigation → Other Layers):**

- `view-ref` → UX Layer (which view does this route show?)
- `business.realizes-process` → Business Layer (what process does this flow realize?)
- `security.required-roles` → Security Layer (authorization requirements)
- `apm.flow-metrics` → APM Layer (navigation analytics)

**Incoming (Other Layers → Navigation):**

- UX Layer → Navigation (views reference routes)
- Business Layer → Navigation (processes trigger flows)

---

## Design Best Practices

1. **Guards** - Add navigation guards for protected routes
2. **Context** - Pass necessary context between routes
3. **Analytics** - Track navigation flows for insights
4. **Error handling** - Define fallback routes for errors
5. **Deep linking** - Support deep linking for all routes
6. **SEO** - Consider SEO requirements for public routes
7. **Performance** - Lazy-load routes when appropriate

---

## Common Commands

```bash
# Add navigation graph (one per application)
dr add navigation navigationgraph "My App Navigation"

# Add route (types: public | protected | redirect | alias | lazy)
dr add navigation route "User Profile Route" --description "User profile page route"

# Add route metadata
dr add navigation routemeta "Profile Route Meta"

# Add breadcrumb configuration
dr add navigation breadcrumbconfig "Profile Breadcrumb"

# Add navigation guard
dr add navigation navigationguard "Auth Guard"

# Add guard condition
dr add navigation guardcondition "Is Authenticated"

# Add guard action (on failure)
dr add navigation guardaction "Redirect To Login"

# Add navigation flow
dr add navigation navigationflow "Checkout Flow"

# Add flow step
dr add navigation flowstep "Cart Review Step"

# Add transition between routes
dr add navigation navigationtransition "Cart To Shipping"

# Add context variable
dr add navigation contextvariable "Cart ID"

# List by type
dr list navigation --type route
dr list navigation --type navigationguard

# Validate navigation layer
dr validate --layers navigation

# Export navigation map
dr export plantuml --layers navigation
```

---

## Example: Protected Profile Route

```yaml
id: navigation.route.user-profile
name: "User Profile Route"
type: route
properties:
  path: /profile/:userId
  view-ref: ux.view.user-profile
  guards:
    - navigation.navigationguard.authentication
    - navigation.navigationguard.profile-ownership
  parameters:
    - name: userId
      type: string
      format: uuid
      required: true
  meta:
    title: "User Profile"
    requiresAuth: true
    allowedRoles:
      - user
      - admin
  contextVariables:
    - name: currentUserId
      source: auth.user.id
  dataMapping:
    - source: route.params.userId
      target: view.data.userId
  security:
    required-roles:
      - security.role.authenticated-user
  business:
    realizes-process: business.process.profile-management
  apm:
    flow-metrics:
      - apm.metric.profile-view-count
      - apm.metric.profile-load-time
```

---

## Example: Multi-Step Checkout Flow

```yaml
id: navigation.navigationflow.checkout
name: "Checkout Flow"
type: navigationflow
properties:
  steps:
    - id: cart-review
      route: /checkout/cart
      view: ux.view.cart-review
      onNext: validate-cart
    - id: shipping-address
      route: /checkout/shipping
      view: ux.view.shipping-form
      onNext: validate-address
    - id: payment
      route: /checkout/payment
      view: ux.view.payment-form
      onNext: validate-payment
    - id: confirmation
      route: /checkout/confirm
      view: ux.view.order-confirmation
      final: true
  transitions:
    - from: cart-review
      to: shipping-address
      trigger: next-button
      guard: navigation.navigationguard.cart-not-empty
    - from: shipping-address
      to: payment
      trigger: next-button
      guard: navigation.navigationguard.valid-address
    - from: payment
      to: confirmation
      trigger: submit
      guard: navigation.navigationguard.payment-successful
  context:
    - cartId
    - selectedAddress
    - paymentMethod
  business:
    realizes-process: business.process.checkout
```

---

## Coverage Completeness Checklist

Before declaring navigation layer extraction complete, verify each type was considered:

- [ ] `navigation.navigationgraph.*` — Top-level navigation model container
- [ ] `navigation.route.*` — URL path to view mappings (core unit)
- [ ] `navigation.routemeta.*` — Auth, layout, keepAlive metadata per route
- [ ] `navigation.breadcrumbconfig.*` — Breadcrumb trail configuration
- [ ] `navigation.navigationguard.*` — Pre-navigation authorization/validation checks
- [ ] `navigation.guardcondition.*` — Boolean expressions evaluated by guards
- [ ] `navigation.guardaction.*` — Actions taken on guard failure
- [ ] `navigation.navigationflow.*` — Multi-step navigation sequences
- [ ] `navigation.flowstep.*` — Individual steps within flows
- [ ] `navigation.navigationtransition.*` — Directed transitions between routes
- [ ] `navigation.contextvariable.*` — Navigation-scoped context data

If any type has ZERO elements, explicitly decide:
"This type doesn't apply to this codebase" with reasoning.

---

## Pitfalls to Avoid

- ❌ Missing authentication guards on protected routes — use `navigationguard` + `guardcondition` + `guardaction` together
- ❌ Using `navigation.guard.*` or `navigation.flow.*` as element IDs — correct types are `navigationguard` and `navigationflow`
- ❌ Not decomposing guards into conditions (`guardcondition`) and actions (`guardaction`) — model these as separate elements
- ❌ Complex flows without explicit `flowstep` elements — each step in a flow should be a distinct `flowstep`
- ❌ Missing `routemeta` for protected routes — auth requirements belong in `routemeta`, not embedded in route properties
- ❌ Missing cross-layer links to UX views (`view-ref`) and business processes (`realizes-process`)
- ❌ No error/fallback routes defined — model these as `route` with `type: redirect`
