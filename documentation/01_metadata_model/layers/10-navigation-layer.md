# Navigation Layer - Custom Navigation Specification

## Overview

The Navigation Layer defines the application's routing, navigation flows, and transitions between screens. This is a **custom specification** as no standard adequately addresses the combination of routing, guards, parameter mapping, and deep linking needed for modern web and mobile applications.

## Layer Characteristics

- **Standard**: Custom Specification (YAML format)
- **Custom Extensions**: Complete custom specification
- **Validation**: Custom JSON Schema validator
- **Tooling**: Custom validation, route generation, navigation testing

## Why Custom?

No existing standard covers our navigation needs:
- **URL Routing**: Too framework-specific (React Router, Vue Router, etc.)
- **OpenAPI paths**: Focused on API, not UI navigation
- **Sitemap XML**: Too simplistic, no parameters or guards
- **State machines**: Don't capture routing and deep linking

Our Navigation spec provides:
1. Route definitions with parameters
2. Navigation transitions and flows
3. Guard conditions for access control
4. Parameter mapping between routes
5. Deep linking support
6. Breadcrumb and menu generation

## Entity Definitions

### NavigationGraph
```yaml
NavigationGraph:
  description: "Complete navigation structure for application"
  attributes:
    version: string (spec version)
    application: string (application identifier)
    baseUrl: string (base URL for application)

  contains:
    - routes: Route[] (1..*)
    - transitions: NavigationTransition[] (0..*)
    - guards: NavigationGuard[] (0..*)
    - menus: NavigationMenu[] (0..*)

  references:
    - archimateElement: Element.id (ApplicationComponent)
```

### Route
```yaml
Route:
  description: "Single route/screen in the application"
  attributes:
    path: string [PK] (URL pattern, e.g., "/products/:id")
    name: string (unique route name)
    title: string (page title)
    description: string (optional)
    exact: boolean (default: true, for path matching)
    caseSensitive: boolean (default: false)

  contains:
    - params: RouteParam[] (0..*) # Path parameters
    - queryParams: QueryParam[] (0..*) # Query string parameters
    - meta: RouteMeta (optional) # Metadata

  references:
    - screen: string (UX spec reference)
    - component: string (component name/path)
    - archimateRef: Element.id (ApplicationComponent)
    - guards: NavigationGuard.name[] (optional)
    - parent: Route.path (for nested routes, optional)
    - redirectTo: Route.path (for redirects, optional)

  examples:
    # List route
    - path: "/products"
      name: "product-list"
      title: "Products"
      component: "ProductList"
      screen: "product-list.ux.yaml"

    # Detail route with parameter
    - path: "/products/:id"
      name: "product-detail"
      title: "Product Details"
      component: "ProductDetail"
      screen: "product-detail.ux.yaml"
      params:
        - name: id
          type: uuid
          required: true
      guards: ["authenticated"]

    # Nested route
    - path: "/products/:id/edit"
      name: "product-edit"
      title: "Edit Product"
      component: "ProductEdit"
      parent: "/products/:id"
      guards: ["authenticated", "has-edit-permission"]

    # Redirect
    - path: "/"
      redirectTo: "/products"

    # Not found (wildcard)
    - path: "*"
      name: "not-found"
      title: "Page Not Found"
      component: "NotFound"
```

### RouteParam
```yaml
RouteParam:
  description: "Path parameter in route"
  attributes:
    name: string [PK within route]
    type: ParamType [enum]
    required: boolean (default: true for path params)
    pattern: string (regex validation, optional)
    description: string (optional)

  validation:
    min: number (for numeric types, optional)
    max: number (for numeric types, optional)
    minLength: integer (for string types, optional)
    maxLength: integer (for string types, optional)

  enums:
    ParamType:
      - string
      - integer
      - number
      - uuid
      - slug      # URL-friendly string
      - date      # ISO date format
      - boolean

  examples:
    # UUID parameter
    - name: id
      type: uuid
      required: true
      description: "Product identifier"

    # Integer parameter
    - name: page
      type: integer
      required: false
      min: 1
      description: "Page number"

    # Slug parameter
    - name: category
      type: slug
      pattern: "^[a-z0-9-]+$"
      description: "Product category slug"
```

### QueryParam
```yaml
QueryParam:
  description: "Query string parameter"
  attributes:
    name: string [PK within route]
    type: ParamType
    required: boolean (default: false)
    default: any (optional)
    description: string (optional)

  validation:
    enum: any[] (allowed values, optional)
    min: number (optional)
    max: number (optional)

  examples:
    # Pagination
    - name: limit
      type: integer
      required: false
      default: 20
      min: 1
      max: 100
      description: "Items per page"

    - name: offset
      type: integer
      required: false
      default: 0
      min: 0
      description: "Number of items to skip"

    # Filtering
    - name: category
      type: string
      required: false
      enum: ["electronics", "clothing", "food"]
      description: "Filter by category"

    # Search
    - name: search
      type: string
      required: false
      description: "Search query"

    # Sorting
    - name: sort
      type: string
      required: false
      enum: ["name", "price", "date"]
      default: "name"
      description: "Sort field"

    - name: order
      type: string
      required: false
      enum: ["asc", "desc"]
      default: "asc"
      description: "Sort order"
```

### RouteMeta
```yaml
RouteMeta:
  description: "Route metadata"
  attributes:
    requiresAuth: boolean (default: false)
    roles: string[] (required roles, optional)
    permissions: string[] (required permissions, optional)
    layout: string (layout component name, optional)
    breadcrumb: BreadcrumbConfig (optional)
    keepAlive: boolean (cache component, default: false)
    transition: string (page transition name, optional)

  seo:
    metaTitle: string (optional, overrides title)
    metaDescription: string (optional)
    metaKeywords: string[] (optional)
    ogImage: string (Open Graph image URL, optional)
    canonical: string (canonical URL, optional)
    noIndex: boolean (default: false)

  analytics:
    trackPageView: boolean (default: true)
    eventCategory: string (optional)
    customDimensions: object (optional)
```

### NavigationTransition
```yaml
NavigationTransition:
  description: "Transition from one route to another"
  attributes:
    from: string [FK -> Route.path]
    to: string [FK -> Route.path]
    trigger: NavigationTrigger [enum]
    element: string (UI element identifier, optional)
    description: string (optional)

  contains:
    - paramMapping: ParamMapping[] (0..*) # How to map parameters
    - guards: NavigationGuard.name[] (optional)
    - actions: NavigationAction[] (0..*) # Actions during transition

  enums:
    NavigationTrigger:
      - click        # User clicked element
      - submit       # Form submission
      - success      # Previous action succeeded
      - failure      # Previous action failed
      - cancel       # User cancelled
      - automatic    # Automatic navigation
      - deepLink     # Deep link activation
      - backButton   # Browser back button

  examples:
    # List to detail
    - from: "/products"
      to: "/products/:id"
      trigger: click
      element: "product-row"
      paramMapping:
        - source: "row.id"
          target: "id"

    # Detail to edit
    - from: "/products/:id"
      to: "/products/:id/edit"
      trigger: click
      element: "edit-button"
      guards: ["has-edit-permission"]
      paramMapping:
        - source: "id"
          target: "id"

    # Edit success to detail
    - from: "/products/:id/edit"
      to: "/products/:id"
      trigger: success
      paramMapping:
        - source: "id"
          target: "id"

    # Cancel edit back to detail
    - from: "/products/:id/edit"
      to: "/products/:id"
      trigger: cancel
```

### ParamMapping
```yaml
ParamMapping:
  description: "Maps parameters between routes"
  attributes:
    source: string (source parameter path)
    target: string (target parameter name)
    transform: string (transformation expression, optional)
    default: any (default value if source is missing, optional)

  examples:
    # Direct mapping
    - source: "id"
      target: "id"

    # Nested object property
    - source: "product.id"
      target: "productId"

    # Array element
    - source: "items[0].id"
      target: "itemId"

    # With transformation
    - source: "name"
      target: "slug"
      transform: "slugify(name)"

    # With default
    - source: "page"
      target: "page"
      default: 1
```

### NavigationGuard
```yaml
NavigationGuard:
  description: "Guard condition for route access"
  attributes:
    name: string [PK]
    type: GuardType [enum]
    description: string (optional)
    order: integer (execution order, optional)

  contains:
    - condition: GuardCondition (1..1)
    - onDeny: GuardAction (what happens if denied)

  enums:
    GuardType:
      - authentication  # User must be logged in
      - authorization   # User must have role/permission
      - validation      # Route params must be valid
      - data-loaded     # Required data must be loaded
      - custom          # Custom guard logic

  examples:
    # Authentication guard
    - name: "authenticated"
      type: authentication
      condition:
        expression: "user.isAuthenticated"
      onDeny:
        action: redirect
        target: "/login"
        preserveUrl: true  # Return to requested page after login

    # Role-based authorization
    - name: "admin-only"
      type: authorization
      condition:
        expression: "user.hasRole('admin')"
      onDeny:
        action: redirect
        target: "/forbidden"
        message: "Admin access required"

    # Permission-based authorization
    - name: "has-edit-permission"
      type: authorization
      condition:
        expression: "user.hasPermission('product.edit')"
      onDeny:
        action: redirect
        target: "/products/:id"
        message: "You don't have permission to edit products"

    # Data validation
    - name: "valid-product-id"
      type: validation
      condition:
        expression: "isUUID(params.id)"
      onDeny:
        action: redirect
        target: "/products"
        message: "Invalid product ID"

    # Resource existence
    - name: "product-exists"
      type: data-loaded
      condition:
        expression: "await productService.exists(params.id)"
      onDeny:
        action: redirect
        target: "/not-found"
```

### GuardCondition
```yaml
GuardCondition:
  description: "Condition expression for guard"
  attributes:
    expression: string (boolean expression)
    async: boolean (default: false, for async checks)
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
    action: GuardActionType [enum]
    target: string (route path, for redirect)
    message: string (error message, optional)
    preserveUrl: boolean (save requested URL, default: false)

  enums:
    GuardActionType:
      - redirect      # Redirect to another route
      - show-error    # Show error message, stay on current route
      - navigate-back # Go back to previous route
      - abort         # Abort navigation silently

  examples:
    # Redirect to login
    - action: redirect
      target: "/login"
      preserveUrl: true

    # Show error
    - action: show-error
      message: "Access denied"

    # Go back
    - action: navigate-back
      message: "You don't have permission for this action"
```

### NavigationMenu
```yaml
NavigationMenu:
  description: "Navigation menu definition"
  attributes:
    name: string [PK]
    type: MenuType [enum]
    position: MenuPosition [enum]

  contains:
    - items: MenuItem[] (1..*)

  enums:
    MenuType:
      - main          # Main navigation
      - sidebar       # Sidebar menu
      - footer        # Footer links
      - breadcrumb    # Breadcrumb trail
      - context       # Context menu
      - tabs          # Tab navigation

    MenuPosition:
      - top
      - left
      - right
      - bottom
```

### MenuItem
```yaml
MenuItem:
  description: "Individual menu item"
  attributes:
    label: string
    icon: string (optional)
    badge: string (notification badge, optional)
    order: integer (optional)

  references:
    - route: Route.path (target route)

  contains:
    - children: MenuItem[] (0..*) # Nested menu items
    - visibility: MenuVisibility (optional)

  examples:
    # Simple item
    - label: "Products"
      icon: "shopping-bag"
      route: "/products"
      order: 1

    # With children
    - label: "Admin"
      icon: "settings"
      order: 5
      visibility:
        condition: "user.hasRole('admin')"
      children:
        - label: "Users"
          route: "/admin/users"
        - label: "Settings"
          route: "/admin/settings"

    # With badge
    - label: "Notifications"
      icon: "bell"
      badge: "{{ notificationCount }}"
      route: "/notifications"
```

### MenuVisibility
```yaml
MenuVisibility:
  description: "Condition for showing menu item"
  attributes:
    condition: string (boolean expression)
    requiresAuth: boolean (default: false)
    roles: string[] (optional)
    permissions: string[] (optional)

  examples:
    # Auth required
    - requiresAuth: true

    # Role-based
    - roles: ["admin", "editor"]

    # Complex condition
    - condition: |
        user.isAuthenticated &&
        (user.hasRole('admin') || feature.enabled('beta'))
```

## Complete Example: Product Navigation

```yaml
# File: specs/navigation/product-navigation.yaml
version: "1.0.0"
application: "product-management"
baseUrl: "https://app.example.com"

# ============================================================
# Routes
# ============================================================
routes:
  # Home/Redirect
  - path: "/"
    name: "home"
    redirectTo: "/products"

  # Product List
  - path: "/products"
    name: "product-list"
    title: "Products"
    component: "ProductList"
    screen: "product-list.ux.yaml"
    archimateRef: "app-comp-product-list-ui"
    queryParams:
      - name: limit
        type: integer
        default: 20
        min: 1
        max: 100
      - name: offset
        type: integer
        default: 0
      - name: category
        type: string
        enum: ["electronics", "clothing", "food", "books"]
      - name: search
        type: string
    meta:
      requiresAuth: false
      breadcrumb:
        label: "Products"
      seo:
        metaTitle: "Product Catalog"
        metaDescription: "Browse our product catalog"

  # Product Detail
  - path: "/products/:id"
    name: "product-detail"
    title: "Product Details"
    component: "ProductDetail"
    screen: "product-detail.ux.yaml"
    archimateRef: "app-comp-product-detail-ui"
    params:
      - name: id
        type: uuid
        required: true
        description: "Product identifier"
    guards: ["valid-product-id", "product-exists"]
    meta:
      requiresAuth: false
      breadcrumb:
        label: "{{ product.name }}"
        parent: "/products"
      keepAlive: true

  # Product Edit
  - path: "/products/:id/edit"
    name: "product-edit"
    title: "Edit Product"
    component: "ProductEdit"
    screen: "product-edit.ux.yaml"
    archimateRef: "app-comp-product-edit-ui"
    params:
      - name: id
        type: uuid
        required: true
    guards: ["authenticated", "has-edit-permission", "product-exists"]
    meta:
      requiresAuth: true
      permissions: ["product.edit"]
      breadcrumb:
        label: "Edit"
        parent: "/products/:id"

  # Product Create
  - path: "/products/new"
    name: "product-create"
    title: "Create Product"
    component: "ProductEdit"
    screen: "product-edit.ux.yaml"
    guards: ["authenticated", "has-create-permission"]
    meta:
      requiresAuth: true
      permissions: ["product.create"]
      breadcrumb:
        label: "Create"
        parent: "/products"

  # Not Found
  - path: "*"
    name: "not-found"
    title: "Page Not Found"
    component: "NotFound"
    meta:
      seo:
        noIndex: true

# ============================================================
# Navigation Transitions
# ============================================================
transitions:
  # List to Detail
  - from: "/products"
    to: "/products/:id"
    trigger: click
    element: "product-row"
    paramMapping:
      - source: "product.id"
        target: "id"

  # Detail to Edit
  - from: "/products/:id"
    to: "/products/:id/edit"
    trigger: click
    element: "edit-button"
    guards: ["has-edit-permission"]
    paramMapping:
      - source: "id"
        target: "id"

  # Edit Save Success back to Detail
  - from: "/products/:id/edit"
    to: "/products/:id"
    trigger: success
    paramMapping:
      - source: "id"
        target: "id"

  # Edit Cancel back to Detail
  - from: "/products/:id/edit"
    to: "/products/:id"
    trigger: cancel
    paramMapping:
      - source: "id"
        target: "id"

  # Delete Success back to List
  - from: "/products/:id"
    to: "/products"
    trigger: success
    description: "After product deletion"

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
    onDeny:
      action: redirect
      target: "/login"
      preserveUrl: true

  # Create Permission
  - name: "has-create-permission"
    type: authorization
    description: "User must have product creation permission"
    condition:
      expression: "user.hasPermission('product.create')"
      async: false
    onDeny:
      action: redirect
      target: "/products"
      message: "You don't have permission to create products"

  # Edit Permission
  - name: "has-edit-permission"
    type: authorization
    description: "User must have product edit permission"
    condition:
      expression: "user.hasPermission('product.edit')"
    onDeny:
      action: redirect
      target: "/products/:id"
      message: "You don't have permission to edit products"

  # Valid UUID
  - name: "valid-product-id"
    type: validation
    description: "Product ID must be valid UUID"
    condition:
      expression: "isValidUUID(params.id)"
    onDeny:
      action: redirect
      target: "/products"
      message: "Invalid product ID"

  # Product Exists
  - name: "product-exists"
    type: data-loaded
    description: "Product must exist"
    condition:
      expression: "await productService.exists(params.id)"
      async: true
      timeout: 5000
    onDeny:
      action: redirect
      target: "/not-found"

# ============================================================
# Navigation Menus
# ============================================================
menus:
  # Main Navigation
  - name: "main-nav"
    type: main
    position: top
    items:
      - label: "Products"
        icon: "shopping-bag"
        route: "/products"
        order: 1

      - label: "Categories"
        icon: "folder"
        route: "/categories"
        order: 2

      - label: "Admin"
        icon: "settings"
        order: 3
        visibility:
          roles: ["admin"]
        children:
          - label: "Users"
            route: "/admin/users"
          - label: "Settings"
            route: "/admin/settings"

  # Breadcrumb
  - name: "breadcrumb"
    type: breadcrumb
    position: top
    # Generated automatically from route meta.breadcrumb

  # Product Actions (context menu)
  - name: "product-actions"
    type: context
    items:
      - label: "Edit"
        icon: "edit"
        route: "/products/:id/edit"
        visibility:
          permissions: ["product.edit"]

      - label: "Delete"
        icon: "trash"
        visibility:
          permissions: ["product.delete"]
```

## Integration Points

### To ArchiMate Application Layer
- Route references ApplicationComponent via archimateRef
- Navigation structure maps to application structure

### To UX Layer
- Route.screen references UX spec file
- StateAction.navigateTo references Route.path
- Navigation triggers UX state transitions

### To API Layer
- Guards may call API operations for validation
- Parameter types align with API parameter types

### To Security Layer
- RouteMeta.roles/permissions reference SecurityModel
- NavigationGuard enforces access control
- Authentication/authorization integration

## Validation

```yaml
Validation Checks:
  - All route paths are unique
  - All route names are unique
  - Parameter references are valid
  - Guard references exist
  - Parent routes exist (for nested routes)
  - No circular route dependencies
  - Redirect targets exist
  - Menu routes exist
  - Param mapping sources/targets match route definitions
```

## Best Practices

1. **Unique Names**: Every route should have a unique name
2. **Guards**: Use guards for authentication and authorization
3. **Param Validation**: Validate all route parameters
4. **Breadcrumbs**: Define breadcrumb structure
5. **SEO Metadata**: Include meta tags for public pages
6. **Deep Linking**: Support deep links for all routes
7. **404 Handling**: Always include wildcard route
8. **Redirects**: Use redirects for legacy URLs
9. **Nested Routes**: Use parent/child for logical hierarchy
10. **Keep Alive**: Cache expensive components

## Code Generation

Navigation specs enable generation of:

```yaml
Router Configuration:
  - React Router routes
  - Vue Router routes
  - Angular routing modules
  - Framework-agnostic route configs

Type Definitions:
  - TypeScript route types
  - Parameter types
  - Guard types

Navigation Code:
  - Navigation helpers
  - Guard implementations
  - Breadcrumb generators
  - Menu components

Testing:
  - Route tests
  - Guard tests
  - Navigation flow tests
  - Deep link tests
```

This Navigation Layer provides a comprehensive, framework-agnostic way to define application navigation with full support for guards, parameter mapping, and menu generation.
