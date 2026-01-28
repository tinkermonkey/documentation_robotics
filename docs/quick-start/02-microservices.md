# Tutorial: Microservices Architecture Model

**Duration:** 30 minutes
**Objective:** Model a complete microservices e-commerce platform with multiple services, databases, and complex relationships
**Outcome:** Understand how to model real-world distributed architectures with cross-layer traceability

## Prerequisites

- Completed [Simple REST API Model](01-simple-api.md) tutorial
- Familiarity with microservices concepts
- ~30 minutes of time

## System Overview

We'll model an e-commerce platform with these components:

```
┌─────────────────────────────────────────────┐
│          User Interface Layer               │
│    (Web, Mobile, Admin Dashboard)           │
└────────────┬────────────────────────────────┘
             │
┌────────────▼────────────────────────────────┐
│          API Gateway & Routing              │
└────────────┬────────────────────────────────┘
             │
    ┌────────┴────────┬──────────┬──────────┐
    │                 │          │          │
┌───▼──────┐  ┌──────▼───┐ ┌───▼──────┐ ┌─▼───────┐
│  User    │  │ Catalog  │ │ Order    │ │Payment  │
│ Service  │  │ Service  │ │ Service  │ │Service  │
└───┬──────┘  └──────┬───┘ └───┬──────┘ └─┬───────┘
    │                │         │          │
┌───▼─────┐  ┌──────▼───┐ ┌───▼──────┐ ┌─▼────────┐
│  Users  │  │ Products │ │ Orders   │ │Payments  │
│  DB     │  │   DB     │ │   DB     │ │   DB     │
└─────────┘  └──────────┘ └──────────┘ └──────────┘
```

## Step 1: Initialize the Project

```bash
mkdir ecommerce-platform
cd ecommerce-platform
dr init ecommerce-platform
```

## Step 2: Define Strategic Goals

```bash
dr add motivation goal increase-sales \
  --name "Increase Online Sales" \
  --description "Enable customers to discover and purchase products online"
```

```bash
dr add motivation goal improve-customer-experience \
  --name "Improve Customer Experience" \
  --description "Provide fast, reliable shopping experience"
```

```bash
dr add motivation goal scale-platform \
  --name "Scale Platform" \
  --description "Support growth to millions of daily users without downtime"
```

```bash
dr add motivation goal ensure-security \
  --name "Ensure Security" \
  --description "Protect customer data and payment information"
```

## Step 3: Define Business Capabilities

Model the business functions:

```bash
dr add business capability product-catalog \
  --name "Product Catalog" \
  --description "Manage product inventory and discovery"
```

```bash
dr add business capability user-management \
  --name "User Management" \
  --description "Handle user accounts and authentication"
```

```bash
dr add business capability order-management \
  --name "Order Management" \
  --description "Process customer orders end-to-end"
```

```bash
dr add business capability payment-processing \
  --name "Payment Processing" \
  --description "Handle secure payment transactions"
```

```bash
dr add business capability customer-support \
  --name "Customer Support" \
  --description "Provide customer service and support"
```

## Step 4: Link Goals to Capabilities

```bash
dr add relationship \
  --from business.capability.product-catalog \
  --to motivation.goal.increase-sales \
  --type satisfied-by
```

```bash
dr add relationship \
  --from business.capability.order-management \
  --to motivation.goal.increase-sales \
  --type satisfied-by
```

```bash
dr add relationship \
  --from business.capability.payment-processing \
  --to motivation.goal.ensure-security \
  --type satisfied-by
```

```bash
dr add relationship \
  --from business.capability.user-management \
  --to motivation.goal.improve-customer-experience \
  --type satisfied-by
```

## Step 5: Define Security Policies

Add security controls:

```bash
dr add security authentication-policy oauth2 \
  --name "OAuth2 Authentication" \
  --description "OAuth 2.0 for all API endpoints" \
  --mechanism "OAuth2 Bearer Tokens"
```

```bash
dr add security authorization-policy rbac \
  --name "Role-Based Access Control" \
  --description "RBAC controlling user permissions"
```

```bash
dr add security data-protection pci-compliance \
  --name "PCI DSS Compliance" \
  --description "Payment Card Industry Data Security Standard compliance"
```

```bash
dr add security data-protection gdpr-compliance \
  --name "GDPR Data Protection" \
  --description "General Data Protection Regulation compliance"
```

## Step 6: Define Application Services

Create the microservices:

```bash
dr add application service user-service \
  --name "User Service" \
  --description "User authentication and profile management" \
  --technology "Node.js/Express" \
  --criticality "HIGH"
```

```bash
dr add application service catalog-service \
  --name "Catalog Service" \
  --description "Product catalog and inventory management" \
  --technology "Python/FastAPI" \
  --criticality "HIGH"
```

```bash
dr add application service order-service \
  --name "Order Service" \
  --description "Order creation and management" \
  --technology "Java/Spring Boot" \
  --criticality "CRITICAL"
```

```bash
dr add application service payment-service \
  --name "Payment Service" \
  --description "Payment processing and transactions" \
  --technology "Go/Gin" \
  --criticality "CRITICAL"
```

## Step 7: Link Services to Business Capabilities

```bash
dr add relationship \
  --from application.service.user-service \
  --to business.capability.user-management \
  --type realizes
```

```bash
dr add relationship \
  --from application.service.catalog-service \
  --to business.capability.product-catalog \
  --type realizes
```

```bash
dr add relationship \
  --from application.service.order-service \
  --to business.capability.order-management \
  --type realizes
```

```bash
dr add relationship \
  --from application.service.payment-service \
  --to business.capability.payment-processing \
  --type realizes
```

## Step 8: Link Services to Security Policies

```bash
dr add relationship \
  --from application.service.user-service \
  --to security.authentication-policy.oauth2 \
  --type protected-by
```

```bash
dr add relationship \
  --from application.service.order-service \
  --to security.authentication-policy.oauth2 \
  --type protected-by
```

```bash
dr add relationship \
  --from application.service.payment-service \
  --to security.authentication-policy.oauth2 \
  --type protected-by
```

```bash
dr add relationship \
  --from application.service.payment-service \
  --to security.data-protection.pci-compliance \
  --type complies-with
```

## Step 9: Define API Endpoints for User Service

```bash
dr add api operation signup \
  --name "Sign Up" \
  --description "Create new user account" \
  --method "POST" \
  --path "/api/v1/auth/signup"
```

```bash
dr add api operation login \
  --name "Login" \
  --description "Authenticate user and return token" \
  --method "POST" \
  --path "/api/v1/auth/login"
```

```bash
dr add api operation get-profile \
  --name "Get User Profile" \
  --description "Retrieve authenticated user's profile" \
  --method "GET" \
  --path "/api/v1/users/me"
```

```bash
dr add api operation update-profile \
  --name "Update Profile" \
  --description "Update user profile information" \
  --method "PUT" \
  --path "/api/v1/users/me"
```

## Step 10: Define API Endpoints for Catalog Service

```bash
dr add api operation list-products \
  --name "List Products" \
  --description "Get paginated product list with filters" \
  --method "GET" \
  --path "/api/v1/products"
```

```bash
dr add api operation get-product \
  --name "Get Product" \
  --description "Get detailed product information" \
  --method "GET" \
  --path "/api/v1/products/{id}"
```

```bash
dr add api operation search-products \
  --name "Search Products" \
  --description "Full-text search across product catalog" \
  --method "GET" \
  --path "/api/v1/products/search"
```

## Step 11: Define API Endpoints for Order Service

```bash
dr add api operation create-order \
  --name "Create Order" \
  --description "Create new order from cart" \
  --method "POST" \
  --path "/api/v1/orders"
```

```bash
dr add api operation get-order \
  --name "Get Order" \
  --description "Retrieve order details and status" \
  --method "GET" \
  --path "/api/v1/orders/{id}"
```

```bash
dr add api operation list-orders \
  --name "List User Orders" \
  --description "Get all orders for authenticated user" \
  --method "GET" \
  --path "/api/v1/orders"
```

```bash
dr add api operation cancel-order \
  --name "Cancel Order" \
  --description "Cancel pending order" \
  --method "DELETE" \
  --path "/api/v1/orders/{id}"
```

## Step 12: Define API Endpoints for Payment Service

```bash
dr add api operation process-payment \
  --name "Process Payment" \
  --description "Process payment for order" \
  --method "POST" \
  --path "/api/v1/payments"
```

```bash
dr add api operation get-payment-status \
  --name "Get Payment Status" \
  --description "Check payment processing status" \
  --method "GET" \
  --path "/api/v1/payments/{id}"
```

```bash
dr add api operation refund-payment \
  --name "Refund Payment" \
  --description "Issue refund for payment" \
  --method "POST" \
  --path "/api/v1/payments/{id}/refund"
```

## Step 13: Link Services to API Operations

User Service:

```bash
dr add relationship --from application.service.user-service --to api.operation.signup --type exposes
dr add relationship --from application.service.user-service --to api.operation.login --type exposes
dr add relationship --from application.service.user-service --to api.operation.get-profile --type exposes
dr add relationship --from application.service.user-service --to api.operation.update-profile --type exposes
```

Catalog Service:

```bash
dr add relationship --from application.service.catalog-service --to api.operation.list-products --type exposes
dr add relationship --from application.service.catalog-service --to api.operation.get-product --type exposes
dr add relationship --from application.service.catalog-service --to api.operation.search-products --type exposes
```

Order Service:

```bash
dr add relationship --from application.service.order-service --to api.operation.create-order --type exposes
dr add relationship --from application.service.order-service --to api.operation.get-order --type exposes
dr add relationship --from application.service.order-service --to api.operation.list-orders --type exposes
dr add relationship --from application.service.order-service --to api.operation.cancel-order --type exposes
```

Payment Service:

```bash
dr add relationship --from application.service.payment-service --to api.operation.process-payment --type exposes
dr add relationship --from application.service.payment-service --to api.operation.get-payment-status --type exposes
dr add relationship --from application.service.payment-service --to api.operation.refund-payment --type exposes
```

## Step 14: Define Data Models

```bash
dr add data-model object-schema user-account \
  --name "User Account" \
  --description "User account and profile data"
```

```bash
dr add data-model object-schema product \
  --name "Product" \
  --description "Product information and pricing"
```

```bash
dr add data-model object-schema order \
  --name "Order" \
  --description "Customer order and order items"
```

```bash
dr add data-model object-schema payment \
  --name "Payment" \
  --description "Payment transaction details"
```

## Step 15: Link API Operations to Data Models

```bash
dr add relationship --from api.operation.signup --to data-model.object-schema.user-account --type uses
dr add relationship --from api.operation.get-profile --to data-model.object-schema.user-account --type uses
dr add relationship --from api.operation.list-products --to data-model.object-schema.product --type uses
dr add relationship --from api.operation.create-order --to data-model.object-schema.order --type uses
dr add relationship --from api.operation.process-payment --to data-model.object-schema.payment --type uses
```

## Step 16: Define Databases

```bash
dr add data-store database users-db \
  --name "Users Database" \
  --description "PostgreSQL for user accounts and authentication"
```

```bash
dr add data-store database products-db \
  --name "Products Database" \
  --description "PostgreSQL for product catalog"
```

```bash
dr add data-store database orders-db \
  --name "Orders Database" \
  --description "PostgreSQL for order data"
```

```bash
dr add data-store database payments-db \
  --name "Payments Database" \
  --description "PostgreSQL for payment transactions"
```

## Step 17: Link Data Models to Databases

```bash
dr add relationship --from data-store.database.users-db --to data-model.object-schema.user-account --type stores
dr add relationship --from data-store.database.products-db --to data-model.object-schema.product --type stores
dr add relationship --from data-store.database.orders-db --to data-model.object-schema.order --type stores
dr add relationship --from data-store.database.payments-db --to data-model.object-schema.payment --type stores
```

## Step 18: Validate the Model

```bash
dr validate
```

**Expected output:**

```
✓ Validation complete
✓ 55 elements validated
✓ 46 relationships validated
✓ All cross-layer references valid
✓ Model is valid
```

## Step 19: Verify the Model

```bash
dr info
```

**Expected output:**

```
Model Summary:
- Motivation layer: 4 elements
- Business layer: 5 elements
- Security layer: 4 elements
- Application layer: 4 elements
- API layer: 15 elements
- Data Model layer: 4 elements
- Data Store layer: 4 elements

Total: 40 elements, 46 relationships
```

## Architecture Overview

```
Goals (4)
  ├─ Increase Sales
  ├─ Improve Customer Experience
  ├─ Scale Platform
  └─ Ensure Security
       ↑ (satisfied-by)

Business Capabilities (5)
  ├─ Product Catalog
  ├─ User Management
  ├─ Order Management
  ├─ Payment Processing
  └─ Customer Support
       ↑ (realizes)

Security (4)
  ├─ OAuth2 Auth
  ├─ RBAC
  ├─ PCI Compliance
  └─ GDPR Compliance
       ↓ (protected-by)

Application Services (4)
  ├─ User Service (Node.js) - HIGH criticality
  ├─ Catalog Service (Python) - HIGH criticality
  ├─ Order Service (Java) - CRITICAL
  └─ Payment Service (Go) - CRITICAL
       ↓ (exposes)

API Operations (15)
  ├─ User Service (4 endpoints)
  ├─ Catalog Service (3 endpoints)
  ├─ Order Service (4 endpoints)
  └─ Payment Service (3 endpoints)
       ↓ (uses)

Data Models (4)
  ├─ User Account
  ├─ Product
  ├─ Order
  └─ Payment
       ↓ (stores)

Databases (4)
  ├─ Users DB
  ├─ Products DB
  ├─ Orders DB
  └─ Payments DB
```

## Key Patterns Demonstrated

1. **Multiple Services Pattern** - Four independent services with clear responsibilities
2. **Shared Security** - Security policies applied consistently across multiple services
3. **Data Isolation** - Each service has its own database (Database per Service pattern)
4. **Complete Traceability** - From business goals all the way to databases
5. **Service Criticality** - Different services marked with appropriate criticality levels

## Success Criteria

You've successfully completed this tutorial if:

- ✅ All commands executed without errors
- ✅ `dr validate` shows "Model is valid"
- ✅ You have 40+ elements across 7 layers
- ✅ You have 46+ relationships showing complete traceability
- ✅ You understand how to model distributed systems

## Next Steps

1. **Explore the model:** Check `.dr/layers/` to see how services are organized
2. **Export APIs:** Run `dr export openapi` to generate OpenAPI specs for each service
3. **Build Your Own:** Start modeling your actual architecture

## Troubleshooting

Having issues? Check the [Troubleshooting Guide](../troubleshooting/common-errors.md) for:

- Validation errors
- Relationship issues
- Data consistency problems

---

For more help, check the [Troubleshooting Guide](../troubleshooting/common-errors.md) and [Quick Reference](../reference/cheat-sheet.md).
