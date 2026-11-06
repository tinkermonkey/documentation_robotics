---
name: LAYER_03_SECURITY
description: Expert knowledge for Security Layer modeling in Documentation Robotics
triggers:
  [
    "security",
    "authentication",
    "authorization",
    "role",
    "permission",
    "RBAC",
    "ABAC",
    "policy",
    "threat",
    "actor objective",
    "STS-ml"
  ]
version: 0.8.3
---

# Security Layer Skill

**Layer Number:** 03
**Specification:** Metadata Model Spec v0.8.3
**Purpose:** Defines authentication, authorization, access control, data classification, and security policies including STS-ml concepts for goal-oriented security modeling.

---

## Layer Overview

The Security Layer provides **comprehensive security modeling** spanning:

- **Authentication & Authorization** - RBAC, ABAC, field-level access control
- **Goal-Oriented Security** - Actor objectives, social dependencies (STS-ml inspired)
- **Information Flow Rights** - Fine-grained rights: produce, read, modify, distribute
- **Security Patterns** - Separation of duty, binding of duty, need-to-know
- **Threat Modeling** - Threats, countermeasures, accountability

This layer uses a **custom YAML specification** designed to cover authentication, authorization, data classification, threat modeling, and goal-oriented security in a unified model.

**Key Innovation:** Integrates STS-ml 2.0 concepts (goal-oriented security, information flow, delegation, social dependencies) with modern RBAC/ABAC patterns.

---

## Entity Types

> **CLI Introspection:** Run `dr schema types security` for the authoritative, always-current list of node types.
> Run `dr schema node <type-id>` for full attribute details on any type.

### Authentication & Authorization (14 entities)

| Entity Type              | Description                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| **SecurityModel**        | Root container for complete security model                                                          |
| **AuthenticationConfig** | Authentication providers (OAuth2, OIDC, SAML, JWT, session, API key, certificate)                   |
| **PasswordPolicy**       | Password requirements and policies                                                                  |
| **Role**                 | User role definition with inheritance and hierarchy                                                 |
| **Permission**           | Permission definition with scopes (global, resource, attribute, owner) and format "resource.action" |
| **SecureResource**       | Protected resource (types: api, screen, data, file, service)                                        |
| **ResourceOperation**    | Operation on a resource with role-based access, conditions, rate limits, audit                      |
| **AccessCondition**      | Conditional access rule with operators and data sources                                             |
| **FieldAccessControl**   | Field-level access control with read/write permissions and masking                                  |
| **SecurityPolicy**       | Declarative security policy with rules and actions                                                  |
| **PolicyRule**           | Individual policy rule with conditions and effects (allow, deny, audit, warn)                       |
| **PolicyAction**         | Action to take when policy rule matches                                                             |
| **DataClassification**   | Data classification and protection policies (levels: public, internal, confidential, restricted)    |
| **RateLimit**            | Throttling constraints for API/service access                                                       |

### STS-ml Inspired Security (17 entities)

| Entity Type                   | Description                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| **Actor**                     | Security actor (types: role, agent, organization, system) with objectives and dependencies |
| **ActorObjective**            | Security-related goal of an actor (links to motivation layer goals)                        |
| **ActorDependency**           | Dependency between actors on resources                                                     |
| **InformationEntity**         | Information asset with fine-grained rights (produce, read, modify, distribute)             |
| **InformationRight**          | Fine-grained information access rights per actor                                           |
| **Delegation**                | Explicit delegation of permissions or goals (types: execution, permission, approval)       |
| **SecurityConstraints**       | Container for security patterns (separation/binding of duty, need-to-know)                 |
| **SeparationOfDuty**          | Pattern requiring different actors to perform related tasks                                |
| **BindingOfDuty**             | Pattern requiring same actor to complete related tasks                                     |
| **NeedToKnow**                | Information access based on objective/purpose requirements                                 |
| **SocialDependency**          | Dependencies and trust between actors with verification levels                             |
| **AccountabilityRequirement** | Accountability and non-repudiation requirements                                            |
| **Evidence**                  | Evidence required for accountability (digital-signature, timestamp, IP, biometric, etc.)   |
| **Threat**                    | Security threat with likelihood, impact, and countermeasures                               |
| **Countermeasure**            | Security countermeasure for a threat                                                       |
| **AuditConfig**               | Security audit logging configuration                                                       |
| **RetentionPolicy**           | Data retention and deletion policies                                                       |

---

## Intra-Layer Relationships

Containment is recorded with `aggregates` / `composes`; behavior and access rules use the predicates below. Record each link with `dr relationship add`.

### Containment

| Source Type         | Predicate  | Target Type          | Example                                                    |
| ------------------- | ---------- | -------------------- | ---------------------------------------------------------- |
| SecurityModel       | composes   | AuthenticationConfig | "Application Security" composes "OAuth2 Google"            |
| SecurityModel       | composes   | SecurityPolicy       | "Application Security" composes "Data Access Policy"       |
| SecurityModel       | aggregates | Role                 | "Application Security" aggregates "Admin", "User", "Guest" |
| SecurityModel       | aggregates | Threat               | "Application Security" aggregates "SQL Injection"          |
| SecureResource      | aggregates | ResourceOperation    | "User API" aggregates "List Users", "Create User"          |
| SecureResource      | aggregates | FieldAccessControl   | "Customer Record" aggregates "Mask SSN For Support"        |
| SecurityPolicy      | aggregates | PolicyRule           | "Data Access Policy" aggregates "Owner Can Write"          |
| SecurityConstraints | aggregates | SeparationOfDuty     | "Payment Controls" aggregates "Approve Payment SoD"        |
| Threat              | aggregates | Countermeasure       | "Credential Stuffing" aggregates "Rate Limiting", "MFA"    |

### Key Relationship Patterns

| Source Type               | Predicate      | Target Type               | Example                                                       |
| ------------------------- | -------------- | ------------------------- | ------------------------------------------------------------- |
| Actor                     | assigned-to    | Role                      | "Support Agent" assigned-to "Support"                         |
| Actor                     | requires       | AuthenticationConfig      | "Service Account" requires "mTLS Client Certificate"          |
| Role                      | aggregates     | Permission                | "Admin" aggregates "users.write"                              |
| Role                      | specializes    | Role                      | "Admin" specializes "User"                                    |
| Permission                | authorizes     | ResourceOperation         | "users.read" authorizes "List Users"                          |
| ResourceOperation         | constrained-by | AccessCondition           | "Update Invoice" constrained-by "Is Owner"                    |
| ResourceOperation         | triggers       | AuditConfig               | "Delete User" triggers "Admin Action Audit"                   |
| AuthenticationConfig      | uses           | PasswordPolicy            | "Internal JWT Login" uses "Corporate Password Policy"         |
| AuthenticationConfig      | protects       | SecureResource            | "OAuth2 Google" protects "User API"                           |
| FieldAccessControl        | requires       | Permission                | "SSN Field Read" requires "pii.read"                          |
| PolicyRule                | uses           | AccessCondition           | "Owner Can Write" uses "Is Owner"                             |
| PolicyRule                | triggers       | PolicyAction              | "Block After 5 Failures" triggers "Lock Account"              |
| PolicyRule                | authorizes     | Permission                | "Business Hours Only" authorizes "payments.approve"           |
| Delegation                | authorizes     | Role                      | "Budget Approval Delegation" authorizes "Approver"            |
| Delegation                | requires       | Actor                     | "Budget Approval Delegation" requires "CFO" (delegatee)       |
| InformationRight          | assigned-to    | Actor                     | "Read Customer PII" assigned-to "Support Agent"               |
| InformationRight          | governs        | InformationEntity         | "Read Customer PII" governs "Customer PII"                    |
| NeedToKnow                | protects       | InformationEntity         | "Support Needs Ticket Context" protects "Customer PII"        |
| SeparationOfDuty          | constrains     | Role                      | "Approve Payment SoD" constrains "Payment Creator"            |
| BindingOfDuty             | governs        | ResourceOperation         | "Refund Same Handler" governs "Complete Refund"               |
| DataClassification        | governs        | SecureResource            | "Confidential" governs "Customer Record"                      |
| Threat                    | targets        | SecureResource            | "SQL Injection" targets "Orders Database"                     |
| Countermeasure            | mitigates      | Threat                    | "Parameterized Queries" mitigates "SQL Injection"             |
| Countermeasure            | protects       | SecureResource            | "WAF Rules" protects "Public API"                             |
| AuditConfig               | monitors       | SecureResource            | "Admin Action Audit" monitors "User API"                      |
| AuditConfig               | satisfies      | AccountabilityRequirement | "Admin Action Audit" satisfies "Non-Repudiation Of Admin Ops" |
| AccountabilityRequirement | requires       | Evidence                  | "Non-Repudiation Of Admin Ops" requires "Signed Audit Entry"  |
| RetentionPolicy           | governs        | AuditConfig               | "7-Year Audit Retention" governs "Admin Action Audit"         |

---

## Cross-Layer References

### Outgoing References (Security → Other Layers)

| Source Type               | Predicate  | Target Type                | Example                                                         |
| ------------------------- | ---------- | -------------------------- | --------------------------------------------------------------- |
| Countermeasure            | satisfies  | `motivation.requirement`   | "Parameterized Queries" satisfies "Prevent Injection Attacks"   |
| Countermeasure            | realizes   | `motivation.goal`          | "Encrypt PII At Rest" realizes "Protect Customer Privacy"       |
| SecurityPolicy            | satisfies  | `motivation.requirement`   | "Data Access Policy" satisfies "GDPR Article 32"                |
| SecurityPolicy            | satisfies  | `motivation.principle`     | "Default Deny Policy" satisfies "Least Privilege"               |
| SecurityConstraints       | satisfies  | `motivation.constraint`    | "Payment Controls" satisfies "SOX Dual Control"                 |
| AccountabilityRequirement | satisfies  | `motivation.requirement`   | "Non-Repudiation Of Admin Ops" satisfies "Audit Trail Required" |
| Threat                    | maps-to    | `motivation.requirement`   | "SQL Injection" maps-to "Prevent Injection Attacks"             |
| Threat                    | realizes   | `motivation.driver`        | "Credential Stuffing" realizes "Account Takeover Risk"          |
| Role                      | maps-to    | `business.businessrole`    | "Admin" maps-to "System Administrator"                          |
| SeparationOfDuty          | constrains | `business.businessrole`    | "Approve Payment SoD" constrains "Accounts Payable Clerk"       |
| SecurityPolicy            | constrains | `business.businessprocess` | "Refund Approval Policy" constrains "Process Refund"            |
| SecurityPolicy            | governs    | `business.businessservice` | "PCI Policy" governs "Card Payments"                            |
| Countermeasure            | protects   | `business.businessprocess` | "Fraud Scoring" protects "Checkout"                             |
| SecureResource            | references | `business.businessobject`  | "Customer Record" references "Customer"                         |
| Threat                    | targets    | `business.businessservice` | "Card Testing Attack" targets "Card Payments"                   |

### Incoming References (Other Layers → Security)

| Source Type                        | Predicate      | Target Type          | Example                                                 |
| ---------------------------------- | -------------- | -------------------- | ------------------------------------------------------- |
| `application.applicationinterface` | exposes        | SecureResource       | "User REST API" exposes "User API" resource             |
| `application.applicationcomponent` | realizes       | Countermeasure       | "Fetch Interceptor" realizes "Bearer Token Injection"   |
| `application.applicationservice`   | requires       | AuthenticationConfig | "Order API" requires "Internal JWT"                     |
| `application.applicationservice`   | constrained-by | SecurityPolicy       | "Patient Records Service" constrained-by "HIPAA Policy" |
| `api.operation`                    | requires       | Permission           | "GET /users" requires "users.read"                      |
| `api.securityscheme`               | realizes       | SecurityPolicy       | "bearerAuth" realizes "API Authentication Policy"       |
| `api.ratelimit`                    | realizes       | Countermeasure       | "100 req/min per key" realizes "Rate Limiting"          |
| `business.businessprocess`         | constrained-by | SeparationOfDuty     | "Approve Payment" constrained-by "Approve Payment SoD"  |
| `data-model.schemaproperty`        | satisfies      | FieldAccessControl   | "Customer.ssn" satisfies "Mask SSN For Support"         |
| `data-store.field`                 | satisfies      | DataClassification   | "customers.ssn" satisfies "Restricted"                  |
| `navigation.navigationguard`       | requires       | Role                 | "AdminGuard" requires "Admin"                           |
| `ux.view`                          | requires       | Permission           | "User Admin Screen" requires "users.write"              |
| `apm.logconfiguration`             | satisfies      | AuditConfig          | "Audit Log Pipeline" satisfies "Admin Action Audit"     |
| `testing.testcasesketch`           | tests          | Threat               | "Injection payloads on search" tests "SQL Injection"    |

---

## Codebase Detection Patterns

### Pattern 1: Role-Based Access Control (RBAC)

```python
# FastAPI with role-based authorization
from enum import Enum

class Role(Enum):
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"

def require_role(role: Role):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Check user role
            pass
        return wrapper
    return decorator

@app.get("/admin/users")
@require_role(Role.ADMIN)
async def list_users():
    pass
```

**Maps to:**

- Role: "Admin", "User", "Guest"
- SecureResource: "/admin/users" (type: api)
- ResourceOperation: "list_users" (allowed-roles: [admin])

### Pattern 2: Permission-Based Authorization

```typescript
// Permission definitions
export const Permissions = {
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  USERS_DELETE: 'users.delete',
  ORDERS_READ: 'orders.read',
  ORDERS_WRITE: 'orders.write'
} as const;

@RequirePermission(Permissions.USERS_WRITE)
async updateUser(userId: string, data: UpdateUserDto) {
  // Implementation
}
```

**Maps to:**

- Permission entities: "users.read", "users.write", "users.delete", "orders.read", "orders.write"
- SecureResource: "users", "orders"
- ResourceOperation: "updateUser" (required-permissions: ["users.write"])

### Pattern 3: Attribute-Based Access Control (ABAC)

```python
# Policy-based access with conditions
class AccessPolicy:
    def can_access(self, user, resource, action):
        if action == "read" and resource.classification == "public":
            return True
        if action == "write" and user.department == resource.owner_department:
            return True
        if user.role == "admin":
            return True
        return False
```

**Maps to:**

- AccessCondition with field comparisons
- PolicyRule with conditions and effects
- SecurityPolicy containing multiple rules

### Pattern 4: Authentication Configuration

```yaml
# OAuth2 configuration
authentication:
  providers:
    - type: oauth2
      name: google
      client_id: ${GOOGLE_CLIENT_ID}
      authorization_url: https://accounts.google.com/o/oauth2/v2/auth
      token_url: https://oauth2.googleapis.com/token
      scopes: [openid, email, profile]
    - type: jwt
      name: internal
      secret: ${JWT_SECRET}
      expiration: 3600
```

**Maps to:**

- AuthenticationConfig with providers array
- Properties: type, authorization-url, token-url, scopes

### Pattern 5: Field-Level Security

```python
# Data masking based on role
class UserSerializer:
    def serialize(self, user: User, requester_role: Role):
        data = {
            "id": user.id,
            "username": user.username,
            "email": user.email if requester_role in [Role.ADMIN, Role.MANAGER] else "***@***.com",
            "ssn": user.ssn if requester_role == Role.ADMIN else "***-**-****"
        }
        return data
```

**Maps to:**

- FieldAccessControl on "email" and "ssn" fields
- Masking strategies: "email" (partial), "redact" (full)
- Role-based field access

### Pattern 6: Threat Modeling Comments

```python
# THREAT: SQL Injection via user input
# COUNTERMEASURE: Parameterized queries
def get_user_by_email(email: str):
    # Safe: uses parameterized query
    query = "SELECT * FROM users WHERE email = ?"
    return db.execute(query, [email])
```

**Maps to:**

- Threat: "SQL Injection" (likelihood: high, impact: critical)
- Countermeasure: "Parameterized Queries"
- Countermeasure mitigates Threat

---

## Modeling Workflow

### Step 1: Define Authentication Configuration

```bash
# Create security model
dr add security model "application-security" \
  --description "Complete security model for the application"

# Add authentication providers
dr add security authentication-config "oauth2-google" \
  --description "Google OAuth2 authentication"

dr add security authentication-config "jwt-internal" \
  --description "Internal JWT authentication"
```

### Step 2: Define Roles and Permissions

```bash
# Add roles
dr add security role "admin" \
  --description "System administrator with full access"

dr add security role "user" \
  --description "Regular authenticated user"

dr add security role "guest" \
  --description "Unauthenticated visitor"

# Add permissions
dr add security permission "users.read" \
  --description "Read access to user data"

dr add security permission "users.write" \
  --description "Write access to user data"

dr add security permission "admin.all" \
  --description "Full administrative access"
```

### Step 3: Define Secure Resources

```bash
# Protected API endpoint
dr add security secure-resource "user-api" \
  --description "User management API endpoints"

# Add resource operation
dr add security resource-operation "list-users" \
  --description "List all users operation"

dr add security resource-operation "create-user" \
  --description "Create new user operation"
```

### Step 4: Define Security Actors (STS-ml)

```bash
# Security actors
dr add security actor "support-agent" \
  --description "Customer support team member"

# Assign the actor to a role and the authentication it must use
dr relationship add security.actor.support-agent \
  security.role.user --predicate assigned-to

dr relationship add security.actor.support-agent \
  security.authenticationconfig.oauth2-google --predicate requires
```

### Step 5: Define Information Entities and Rights

```bash
# Information entity (STS-ml)
dr add security information-entity "customer-pii" \
  --description "Customer personally identifiable information"

# Information rights (produce, read, modify, distribute)
dr add security information-right "support-read-pii" \
  --description "Support can read customer PII"

dr add security information-right "admin-full-pii" \
  --description "Admin has full rights to customer PII"
```

### Step 6: Define Security Constraints (Patterns)

```bash
# Separation of duty
dr add security separation-of-duty "approve-payment-sod" \
  --description "Payment creation and approval must be done by different actors"

# Binding of duty
dr add security binding-of-duty "handle-refund-bod" \
  --description "Same actor must initiate and complete refund process"

# Need to know
dr add security need-to-know "customer-data-ntk" \
  --description "Access to customer PII only when resolving customer issues"
```

### Step 7: Model Threats and Countermeasures

```bash
# Identify threats
dr add security threat "sql-injection" \
  --description "SQL injection via user input fields"

# Add countermeasures
dr add security countermeasure "parameterized-queries" \
  --description "Use parameterized queries for all database operations"

# Link countermeasure to threat, and to the requirement it satisfies
dr relationship add security.countermeasure.parameterized-queries \
  security.threat.sql-injection --predicate mitigates

dr relationship add security.countermeasure.parameterized-queries \
  motivation.requirement.prevent-injection-attacks --predicate satisfies
```

### Step 8: Define Policies (ABAC)

```bash
# Declarative security policy
dr add security policy "data-access-policy" \
  --description "Attribute-based data access control"

# Policy rule
dr add security policy-rule "owner-can-write" \
  --description "Resource owner can write to their own resources"

# Access condition (ABAC expression)
dr add security access-condition "is-owner" \
  --description "User is the resource owner"
```

### Step 9: Cross-Layer Integration

```bash
# Application interface exposes the secure resource
dr relationship add application.applicationinterface.user-api-rest \
  security.secureresource.user-api --predicate exposes

# API operation requires a permission
dr relationship add api.operation.get-users \
  security.permission.users-read --predicate requires

# Security role maps to a business role
dr relationship add security.role.admin \
  business.businessrole.system-administrator --predicate maps-to

# Security policy satisfies a motivation requirement
dr relationship add security.securitypolicy.data-access-policy \
  motivation.requirement.gdpr-article-32 --predicate satisfies
```

### Step 10: Validate

```bash
dr validate --layers security
dr validate --relationships
```

---

## Security Modeling Patterns

### Pattern 1: RBAC with Role Hierarchy

```
Role: "Admin" (hierarchy: 1)
├── specializes → Role: "Manager" (hierarchy: 2)
│   ├── specializes → Role: "User" (hierarchy: 3)
│   │   └── specializes → Role: "Guest" (hierarchy: 4)
│   └── aggregates → Permission: "users.write"
└── aggregates → Permission: "admin.all"
    └── authorizes → ResourceOperation: "delete-user"
```

### Pattern 2: Goal-Oriented Security (STS-ml)

```
Actor: "Data Analyst"
├── assigned-to → Role: "Analyst"
└── ← assigned-to — InformationRight: "Read Sales Data"
    └── governs → InformationEntity: "Sales Data"
        ├── constrained-by → DataClassification: "Internal"
        └── ← protects — NeedToKnow: "Access sales data only for reporting"
Countermeasure: "Row-Level Security On Sales Data"
└── realizes → motivation.goal: "Data-Driven Decisions"
```

### Pattern 3: Delegation Chain

```
Actor: "CEO"
└── associated-with → Delegation: "Budget Approval"
    ├── requires → Actor: "CFO" (delegatee)
    ├── authorizes → Role: "Budget Approver"
    ├── type: "approval", retain-oversight: true
    └── (CFO) associated-with → Delegation: "Department Budget"
        ├── requires → Actor: "Department Head" (delegatee)
        └── retain-oversight: true
```

### Pattern 4: Threat Model with Countermeasures

```
Threat: "Unauthorized API Access"
├── likelihood: "high"
├── impact: "critical"
├── category: "broken-authentication"
├── aggregates → Countermeasure: "JWT Authentication" (status: implemented)
├── aggregates → Countermeasure: "Rate Limiting" (status: implemented)
└── aggregates → Countermeasure: "API Key Rotation" (status: planned)
    (each Countermeasure also mitigates → Threat: "Unauthorized API Access")
```

---

## STS-ml 2.0 Concepts

The Security Layer integrates **STS-ml 2.0** (Socio-Technical Security Modeling Language) concepts:

### 1. Goal-Oriented Security

- **Countermeasures and policies** link to Motivation Layer goals, principles and requirements (`realizes`, `satisfies`)
- Security is justified by business goals
- Traceability: Why do we need this security control?

### 2. Information Flow Rights

- **Produce** - Create new information
- **Read** - Access information
- **Modify** - Update existing information
- **Distribute** - Share information with others

### 3. Delegation

- Explicit delegation chains (execution, permission, approval)
- Retention of oversight/control
- Delegation constraints (time-bound, scope-limited)

### 4. Security Patterns

- **Separation of Duty** - Prevent fraud by requiring multiple actors
- **Binding of Duty** - Ensure accountability by requiring same actor
- **Need to Know** - Limit access based on objectives

### 5. Social Dependencies

- Trust relationships between actors
- Verification levels (low, medium, high)
- Depender → Dependee relationships

### 6. Accountability

- Non-repudiation requirements
- Evidence collection (digital signatures, timestamps, audit logs)
- Proof of action

---

## Best Practices

1. **Start with Authentication, Then Authorization** - Get identity right before access control
2. **Use RBAC for Coarse-Grained, ABAC for Fine-Grained** - Roles for broad access, attributes for specific conditions
3. **Model Threats Early** - Security by design, not afterthought
4. **Link to Motivation Layer** - Justify security controls with business goals
5. **Use STS-ml for Compliance** - Goal-oriented security helps with SOX, GDPR, HIPAA
6. **Separate Authentication from Authorization** - Different concerns, different models
7. **Document Delegation Chains** - Explicit delegation prevents confusion
8. **Apply Security Patterns** - Use separation/binding of duty where applicable
9. **Classify Data Early** - Data classification drives access control
10. **Audit Everything Sensitive** - Enable AuditConfig for sensitive operations

---

## Validation Tips

| Issue                        | Cause                                          | Fix                                |
| ---------------------------- | ---------------------------------------------- | ---------------------------------- |
| Orphaned Actor               | Actor not assigned to any role                 | Assign to a Role or remove actor   |
| Unmapped Threat              | Threat has no countermeasures                  | Add countermeasures or accept risk |
| Unused Permission            | Permission not assigned to roles or operations | Assign to roles or remove          |
| Missing Field-Level Security | Sensitive data lacks FieldAccessControl        | Add field-level access rules       |
| Unlinked Countermeasure      | Countermeasure doesn't satisfy a requirement   | Add cross-layer link               |
| No Evidence                  | AccountabilityRequirement lacks evidence       | Define required evidence types     |
| Incomplete Delegation        | Delegation chain missing delegatee             | Complete delegation or remove      |

---

## Quick Reference

**Add Commands:**

```bash
dr add security model <name>
dr add security authentication-config <name> --description <description>
dr add security role <name> --description <description>
dr add security permission <name> --description <description>
dr add security secure-resource <name> --description <description>
dr add security actor <name> --description <description>
dr add security information-entity <name> --description <description>
dr add security threat <name> --description <description>
dr add security countermeasure <name> --description <description>
dr add security delegation <name> --description <description>
```

**Relationship Commands:**

```bash
dr relationship add <actor> <role> --predicate assigned-to
dr relationship add <role> <permission> --predicate aggregates
dr relationship add <permission> <resource-operation> --predicate authorizes
dr relationship add <countermeasure> <threat> --predicate mitigates
```

**Cross-Layer Commands:**

```bash
dr relationship add <countermeasure> <motivation-requirement> --predicate satisfies
dr relationship add <security-role> <business-role> --predicate maps-to
dr relationship add <application-interface> <secure-resource> --predicate exposes
dr relationship add <api-operation> <permission> --predicate requires
```
