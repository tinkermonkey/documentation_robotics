# Tutorial: Simple REST API Model

**Duration:** 15 minutes
**Objective:** Create a complete DR model for a simple user management REST API
**Outcome:** Understand how to build models from scratch using all basic commands

## Prerequisites

- DR CLI installed and built (`npm run build` in `cli/` directory)
- Familiarity with command line
- ~15 minutes of time

## Step 1: Initialize the Project

Create a new directory and initialize a DR project:

```bash
mkdir user-api-model
cd user-api-model
dr init user-api
```

**Expected output:**
```
✓ Initialized documentation-robotics project at /path/to/user-api-model
✓ Created .dr/manifest.json
✓ Created .dr/layers/ directory
```

**What happened:** DR created a `.dr/` directory with the basic model structure.

## Step 2: Define Business Goals

First, establish why this API exists by adding motivation layer elements:

```bash
dr add motivation goal enable-user-registration \
  --name "Enable User Registration" \
  --description "Allow new users to create accounts without requiring manual admin intervention"
```

```bash
dr add motivation goal secure-user-data \
  --name "Secure User Data" \
  --description "Protect user personal information from unauthorized access and data breaches"
```

**Expected output for each:**
```
✓ Added element: motivation.goal.enable-user-registration
✓ Description: Allow new users to create accounts...
```

**What happened:** You created two business goals that drive the system design.

## Step 3: Define Business Capabilities

Map business functions that satisfy those goals:

```bash
dr add business capability user-account-management \
  --name "User Account Management" \
  --description "Manage the complete user account lifecycle from registration through deletion"
```

```bash
dr add business capability data-protection \
  --name "Data Protection" \
  --description "Implement security controls to protect user personal information"
```

**Expected output:**
```
✓ Added element: business.capability.user-account-management
✓ Added element: business.capability.data-protection
```

**What happened:** You defined business capabilities that realize the business goals.

## Step 4: Link Goals to Capabilities

Create relationships showing which capabilities satisfy which goals:

```bash
dr add relationship \
  --from business.capability.user-account-management \
  --to motivation.goal.enable-user-registration \
  --type satisfied-by
```

```bash
dr add relationship \
  --from business.capability.data-protection \
  --to motivation.goal.secure-user-data \
  --type satisfied-by
```

**Expected output:**
```
✓ Added relationship: business.capability.user-account-management → motivation.goal.enable-user-registration (satisfied-by)
```

**What happened:** You connected business strategy to capabilities.

## Step 5: Define Application Services

Create application-layer services that implement the business capabilities:

```bash
dr add application service user-service \
  --name "User Service" \
  --description "RESTful service providing user account management operations"
```

```bash
dr add application service security-service \
  --name "Security Service" \
  --description "Service handling authentication and authorization for all operations"
```

**Expected output:**
```
✓ Added element: application.service.user-service
✓ Added element: application.service.security-service
```

**What happened:** You created application services that implement business capabilities.

## Step 6: Link Services to Business Capabilities

Show how services realize business capabilities:

```bash
dr add relationship \
  --from application.service.user-service \
  --to business.capability.user-account-management \
  --type realizes
```

```bash
dr add relationship \
  --from application.service.security-service \
  --to business.capability.data-protection \
  --type realizes
```

**Expected output:**
```
✓ Added relationship: application.service.user-service → business.capability.user-account-management (realizes)
```

**What happened:** You connected application services to business capabilities.

## Step 7: Define Security Policies

Add security layer policies that protect the services:

```bash
dr add security authentication-policy oauth2-auth \
  --name "OAuth2 Authentication" \
  --description "OAuth2.0 authentication protecting API access" \
  --mechanism "OAuth2 Bearer Tokens"
```

```bash
dr add security authorization-policy role-based-access \
  --name "Role-Based Access Control" \
  --description "RBAC controlling what authenticated users can do"
```

**Expected output:**
```
✓ Added element: security.authentication-policy.oauth2-auth
✓ Added element: security.authorization-policy.role-based-access
```

**What happened:** You defined security controls.

## Step 8: Link Security to Services

Show which services are protected by which policies:

```bash
dr add relationship \
  --from application.service.user-service \
  --to security.authentication-policy.oauth2-auth \
  --type protected-by
```

```bash
dr add relationship \
  --from application.service.user-service \
  --to security.authorization-policy.role-based-access \
  --type protected-by
```

**Expected output:**
```
✓ Added relationship: application.service.user-service → security.authentication-policy.oauth2-auth (protected-by)
```

**What happened:** You connected security policies to the services they protect.

## Step 9: Define API Operations

Create the actual REST API operations:

```bash
dr add api operation create-user \
  --name "Create User" \
  --description "Create a new user account" \
  --method "POST" \
  --path "/api/v1/users"
```

```bash
dr add api operation get-user \
  --name "Get User" \
  --description "Retrieve user by ID" \
  --method "GET" \
  --path "/api/v1/users/{id}"
```

```bash
dr add api operation list-users \
  --name "List Users" \
  --description "Retrieve all users with pagination" \
  --method "GET" \
  --path "/api/v1/users"
```

```bash
dr add api operation update-user \
  --name "Update User" \
  --description "Update user information" \
  --method "PUT" \
  --path "/api/v1/users/{id}"
```

```bash
dr add api operation delete-user \
  --name "Delete User" \
  --description "Delete a user account" \
  --method "DELETE" \
  --path "/api/v1/users/{id}"
```

**Expected output:**
```
✓ Added element: api.operation.create-user
✓ Added element: api.operation.get-user
... (repeat for others)
```

**What happened:** You defined all the REST API operations.

## Step 10: Link API Operations to Services

Show which service exposes which operations:

```bash
dr add relationship \
  --from application.service.user-service \
  --to api.operation.create-user \
  --type exposes
```

```bash
dr add relationship \
  --from application.service.user-service \
  --to api.operation.get-user \
  --type exposes
```

```bash
dr add relationship \
  --from application.service.user-service \
  --to api.operation.list-users \
  --type exposes
```

```bash
dr add relationship \
  --from application.service.user-service \
  --to api.operation.update-user \
  --type exposes
```

```bash
dr add relationship \
  --from application.service.user-service \
  --to api.operation.delete-user \
  --type exposes
```

**Expected output:**
```
✓ Added relationship: application.service.user-service → api.operation.create-user (exposes)
```

**What happened:** You connected the service to the API operations it provides.

## Step 11: Define Data Models

Create the data structures used by the API:

```bash
dr add data-model object-schema user-profile \
  --name "User Profile" \
  --description "Complete user account information"
```

```bash
dr add data-model field id \
  --name "User ID" \
  --description "Unique identifier for user" \
  --data-type "UUID" \
  --is-key true
```

```bash
dr add data-model field email \
  --name "Email Address" \
  --description "User's email address (unique)" \
  --data-type "string" \
  --is-required true
```

```bash
dr add data-model field full-name \
  --name "Full Name" \
  --description "User's full name" \
  --data-type "string"
```

**Expected output:**
```
✓ Added element: data-model.object-schema.user-profile
✓ Added element: data-model.field.id
... (repeat for others)
```

**What happened:** You defined the data structures.

## Step 12: Link Data Models to API Operations

Show which operations use which data models:

```bash
dr add relationship \
  --from api.operation.create-user \
  --to data-model.object-schema.user-profile \
  --type uses
```

```bash
dr add relationship \
  --from api.operation.get-user \
  --to data-model.object-schema.user-profile \
  --type uses
```

**Expected output:**
```
✓ Added relationship: api.operation.create-user → data-model.object-schema.user-profile (uses)
```

**What happened:** You connected API operations to the data structures they work with.

## Step 13: Define Data Storage

Create the database schema:

```bash
dr add data-store database postgresql \
  --name "PostgreSQL Database" \
  --description "Primary user data storage"
```

**Expected output:**
```
✓ Added element: data-store.database.postgresql
```

**What happened:** You defined where data is stored.

## Step 14: Link Data Storage

Show which data store persists the data models:

```bash
dr add relationship \
  --from data-store.database.postgresql \
  --to data-model.object-schema.user-profile \
  --type stores
```

**Expected output:**
```
✓ Added relationship: data-store.database.postgresql → data-model.object-schema.user-profile (stores)
```

**What happened:** You connected storage to data models.

## Step 15: Validate Your Model

Check that everything is correct:

```bash
dr validate
```

**Expected output:**
```
✓ Validation complete
✓ 23 elements validated
✓ 14 relationships validated
✓ All cross-layer references valid
✓ Model is valid
```

If you see errors, check the [Troubleshooting Guide](../troubleshooting/common-errors.md).

## Step 16: View Your Model

See what you've built:

```bash
dr info
```

**Expected output:**
```
Model Summary:
- Motivation layer: 2 elements (2 goals)
- Business layer: 2 elements (2 capabilities)
- Security layer: 2 elements (1 policy, 1 policy)
- Application layer: 2 elements (2 services)
- API layer: 5 elements (5 operations)
- Data Model layer: 4 elements (1 schema, 3 fields)
- Data Store layer: 1 element (1 database)

Total: 18 elements, 14 relationships
```

## Architecture Visualization

Here's the structure you just built:

```
Motivation Layer
  ├─ Goal: Enable User Registration
  └─ Goal: Secure User Data
        ↑ (satisfied-by)

Business Layer
  ├─ Capability: User Account Management
  └─ Capability: Data Protection
        ↑ (realizes)

Security Layer
  ├─ Authentication Policy: OAuth2
  └─ Authorization Policy: RBAC
        ↓ (protected-by)

Application Layer
  ├─ Service: User Service
  └─ Service: Security Service
        ↓ (exposes)

API Layer
  ├─ POST /api/v1/users (create-user)
  ├─ GET /api/v1/users (list-users)
  ├─ GET /api/v1/users/{id} (get-user)
  ├─ PUT /api/v1/users/{id} (update-user)
  └─ DELETE /api/v1/users/{id} (delete-user)
        ↓ (uses)

Data Model Layer
  └─ Object: User Profile
      ├─ Field: ID (UUID, key)
      ├─ Field: Email (string, required)
      └─ Field: Full Name (string)
        ↓ (stores)

Data Store Layer
  └─ Database: PostgreSQL
```

## Success Criteria

You've successfully completed this tutorial if:

- ✅ All commands executed without errors
- ✅ `dr validate` shows "Model is valid"
- ✅ You have elements in 7 different layers
- ✅ You understand the flow from goals to API to data

## Next Steps

Now that you understand the basics:

1. **Explore the model files:** Check `.dr/layers/` to see how DR stores your model
2. **Try exporting:** Run `dr export openapi` to generate an OpenAPI specification
3. **Add more detail:** Add descriptions, criticalities, and additional operations
4. **Progress to Microservices:** Try the [Microservices Architecture](02-microservices.md) tutorial

## Troubleshooting

- **"Invalid element ID" errors?** See [Element ID Format Issues](../troubleshooting/common-errors.md#element-id-format-issues)
- **"Relationship not found" errors?** See [Relationship Direction Issues](../troubleshooting/common-errors.md#relationship-direction-issues)
- **Commands not working?** See [CLI Setup Issues](../troubleshooting/common-errors.md#cli-setup-issues)

---

Ready for more complexity? Continue to **[Microservices Architecture](02-microservices.md)** →
