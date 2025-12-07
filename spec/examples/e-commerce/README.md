# E-Commerce Example

A realistic e-commerce platform demonstrating comprehensive use of all 12 layers with complex traceability and multi-user scenarios.

## Overview

This example models a complete e-commerce system with:

- Multiple user roles (customer, seller, admin)
- Product catalog management
- Shopping cart and checkout
- Order fulfillment
- Payment processing
- Customer support
- Analytics and reporting

## Business Context

**Company**: ShopEase
**Industry**: Online Retail
**Scale**: Mid-size e-commerce platform
**Users**: 100K+ customers, 5K+ sellers

### Strategic Goals

1. **Increase Revenue**: Grow GMV by 30% year-over-year
2. **Improve Conversion**: Increase conversion rate to 5%
3. **Enhance Trust**: Achieve 4.5+ seller rating
4. **Reduce Costs**: Decrease customer support costs by 20%

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ MOTIVATION LAYER                                     │
│ - Strategic goals with KPIs                          │
│ - Business requirements                              │
│ - Stakeholders (CEO, CTO, customers)                 │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ BUSINESS LAYER                                       │
│ - Product Management    - Payment Processing        │
│ - Order Management      - Customer Support          │
│ - Seller Management     - Analytics                 │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ SECURITY LAYER                                       │
│ - Authentication (OAuth2, SSO)                       │
│ - Authorization (RBAC)                               │
│ - Data encryption (PCI DSS)                          │
│ - Audit logging                                      │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ APPLICATION LAYER                                    │
│ - Product Service      - Payment Service            │
│ - Cart Service         - Notification Service       │
│ - Order Service        - Search Service             │
│ - User Service         - Recommendation Service     │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ TECHNOLOGY LAYER                                     │
│ - Kubernetes cluster (10 nodes)                     │
│ - PostgreSQL (primary + replicas)                   │
│ - Redis (caching)                                    │
│ - Elasticsearch (search)                             │
│ - S3 (object storage)                                │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ API LAYER                                            │
│ - RESTful APIs (OpenAPI 3.0)                        │
│ - GraphQL API (product catalog)                     │
│ - Webhook APIs (payment events)                     │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ DATA MODEL + DATASTORE LAYERS                       │
│ - Product catalog schema                             │
│ - Order management schema                            │
│ - User profiles schema                               │
│ - Payment transactions                               │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ UX + NAVIGATION LAYERS                               │
│ - Customer web app (React)                           │
│ - Seller dashboard (Vue)                             │
│ - Mobile apps (iOS/Android)                          │
│ - Voice commerce (Alexa)                             │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ APM/OBSERVABILITY LAYER                              │
│ - Business metrics (GMV, conversion)                 │
│ - Technical metrics (latency, errors)                │
│ - User analytics (funnels, cohorts)                  │
│ - Data quality monitoring                            │
└─────────────────────────────────────────────────────┘
```

## Key Features Demonstrated

### 1. Multi-User System

- Customer, Seller, Admin roles
- Role-based access control
- User-specific workflows

### 2. Complex Business Processes

- Product lifecycle (create → publish → sell → fulfill)
- Order flow (cart → checkout → payment → fulfillment)
- Return/refund process

### 3. Complete Traceability

- Every application service traces to business service
- Every business service supports strategic goals
- Every goal measured by APM metrics

### 4. Security Integration

- PCI DSS compliance for payments
- PII protection for user data
- API key management for sellers

### 5. Multi-Channel Experience

- Web application
- Mobile apps
- Voice commerce
- SMS notifications

### 6. Observability

- Business KPIs → Technical metrics
- Conversion funnel tracking
- Performance monitoring
- Data quality metrics

## Model Structure

```
e-commerce/
├── README.md
├── dr.config.yaml
├── ARCHITECTURE.md              # Detailed architecture docs
├── model/
│   ├── manifest.yaml
│   ├── 01_motivation/
│   │   ├── goals.yaml           # 4 strategic goals
│   │   ├── requirements.yaml    # 12 requirements
│   │   └── stakeholders.yaml    # 5 stakeholders
│   ├── 02_business/
│   │   ├── services.yaml        # 7 business services
│   │   ├── processes.yaml       # 5 business processes
│   │   └── actors.yaml          # 3 actor types
│   ├── 03_security/
│   │   ├── policies.yaml        # 8 security policies
│   │   ├── roles.yaml           # 5 roles
│   │   └── resources.yaml       # 10 protected resources
│   ├── 04_application/
│   │   ├── services.yaml        # 12 microservices
│   │   ├── components.yaml      # 15 components
│   │   └── interfaces.yaml      # 8 interfaces
│   ├── 05_technology/
│   │   ├── nodes.yaml           # 10 compute nodes
│   │   ├── databases.yaml       # 3 databases
│   │   ├── system-software.yaml # 8 platforms
│   │   └── networks.yaml        # 2 networks
│   ├── 06_api/
│   │   ├── product-api.yaml     # Product management API
│   │   ├── order-api.yaml       # Order management API
│   │   ├── payment-api.yaml     # Payment processing API
│   │   └── user-api.yaml        # User management API
│   ├── 07_data_model/
│   │   ├── product.schema.json  # Product data model
│   │   ├── order.schema.json    # Order data model
│   │   ├── user.schema.json     # User profile model
│   │   └── payment.schema.json  # Payment model
│   ├── 08_datastore/
│   │   ├── product-db.yaml      # Product database
│   │   ├── order-db.yaml        # Order database
│   │   ├── user-db.yaml         # User database
│   │   └── analytics-db.yaml    # Analytics warehouse
│   ├── 09_ux/
│   │   ├── customer-app.yaml    # Customer web app
│   │   ├── seller-dashboard.yaml # Seller dashboard
│   │   └── mobile-app.yaml      # Mobile app specs
│   ├── 10_navigation/
│   │   ├── customer-routes.yaml # Customer navigation
│   │   ├── seller-routes.yaml   # Seller navigation
│   │   └── voice-intents.yaml   # Voice commerce
│   └── 11_apm/
│       ├── business-metrics.yaml # GMV, conversion, etc.
│       ├── service-metrics.yaml  # Latency, errors
│       ├── traces.yaml           # Distributed tracing
│       └── data-quality.yaml     # Data quality metrics
└── specs/                        # Generated outputs
    ├── archimate/
    ├── openapi/
    ├── docs/
    └── diagrams/
```

## Element Counts

| Layer       | Elements | Types                                                 |
| ----------- | -------- | ----------------------------------------------------- |
| Motivation  | 21       | Goals (4), Requirements (12), Stakeholders (5)        |
| Business    | 15       | Services (7), Processes (5), Actors (3)               |
| Security    | 23       | Policies (8), Roles (5), Resources (10)               |
| Application | 35       | Services (12), Components (15), Interfaces (8)        |
| Technology  | 23       | Nodes (10), Databases (3), Software (8), Networks (2) |
| API         | 45       | Operations across 4 API specs                         |
| Data Model  | 12       | Schemas (4), with 30+ properties each                 |
| Datastore   | 28       | Tables (20), Indexes (8)                              |
| UX          | 32       | Screens (18), Components (14)                         |
| Navigation  | 24       | Routes (18), Guards (4), Flows (2)                    |
| APM         | 35       | Metrics (20), Traces (10), Logs (5)                   |
| **Total**   | **293**  | **Comprehensive coverage**                            |

## Business Flows

### 1. Product Publication Flow

```
Seller creates product → Submit for review → Admin approves →
Publish to catalog → Index in search → Available for purchase
```

### 2. Purchase Flow

```
Browse products → Add to cart → Proceed to checkout →
Enter shipping → Select payment → Place order →
Process payment → Confirm order → Fulfill order
```

### 3. Customer Support Flow

```
Customer reports issue → Create support ticket →
Route to agent → Investigate → Resolve →
Close ticket → Follow-up survey
```

## Security Model

### Roles and Permissions

**Customer**:

- View products
- Manage own cart
- Place orders
- View own orders
- Contact support

**Seller**:

- Manage product catalog
- View sales analytics
- Manage inventory
- Respond to customer questions
- Process refunds

**Support Agent**:

- View customer tickets
- Access customer orders
- Issue refunds
- Escalate issues

**Admin**:

- Full system access
- Manage users and sellers
- Configure system settings
- View all analytics

**System**:

- Internal service-to-service calls
- Background jobs
- Automated processes

### Data Classification

- **Public**: Product catalog, seller information
- **Internal**: Order history, inventory levels
- **Confidential**: User PII, purchase history
- **Restricted**: Payment information (PCI DSS)

## Traceability Examples

### Goal → Implementation → Measurement

**Goal**: Increase Revenue (30% GMV growth)

- **Requirement**: Improve product discovery
- **Business Service**: Product Management
- **Application Service**: Search Service
- **API**: GET /api/v1/products/search
- **Data**: Product search index
- **UX**: Product search screen
- **Navigation**: /search route
- **Metric**: Search-to-purchase conversion rate

**Goal**: Improve Conversion (5% conversion rate)

- **Requirement**: Streamline checkout
- **Business Service**: Order Management
- **Application Service**: Checkout Service
- **API**: POST /api/v1/orders
- **Data**: Order schema
- **UX**: Checkout flow (3 steps)
- **Navigation**: /checkout/\* routes
- **Metric**: Checkout abandonment rate

## Validation Results

This model passes all validation checks:

✅ **Schema Validation**: All 293 elements conform to their schemas
✅ **Cross-References**: All references resolve correctly
✅ **Link Validation**: 60+ link types validated across all layers
✅ **Semantic Rules**: All 11 semantic rules pass
✅ **Upward Traceability**: Complete chains from implementation to goals
✅ **Security Integration**: All sensitive operations are secured
✅ **Bidirectional Consistency**: All relationships are bidirectional
✅ **Goal-to-Metric**: All goals measured by APM metrics

## Usage

### Validate

```bash
cd e-commerce

# Basic validation
dr validate

# With link validation (recommended)
dr validate --validate-links

# Full strict validation
dr validate --strict --validate-links --strict-links
```

### Export

```bash
# Export to all formats
dr export all --output specs/

# Generate documentation
dr export markdown --output specs/docs/

# Generate diagrams
dr export plantuml --output specs/diagrams/

# Export APIs
dr export openapi --output specs/openapi/
```

### Query

```bash
# Find all services supporting revenue goal
dr trace motivation.goal.increase-revenue

# Discover all cross-layer links
dr links list

# Analyze specific link types
dr links analyze --type x-archimate-ref

# List all authenticated routes
dr list navigation --filter authenticated

# Find all PCI DSS compliant components
dr search --property "compliance=PCI-DSS"
```

## Learning Outcomes

After studying this example, you'll understand:

1. **Enterprise Architecture**: How to model complex systems
2. **Traceability**: Linking strategy to implementation
3. **Security**: Role-based access control and data protection
4. **Multi-Channel**: Web, mobile, and voice experiences
5. **Observability**: Measuring business and technical metrics
6. **Data Modeling**: JSON Schema + SQL DDL integration
7. **API Design**: RESTful and GraphQL APIs

## Next Steps

1. **Explore**: Navigate through the model files
2. **Extend**: Add new features (wishlist, reviews, recommendations)
3. **Export**: Generate documentation and diagrams
4. **Validate**: Run strict validation
5. **Customize**: Adapt for your e-commerce needs

## Comparison with Other Examples

| Aspect       | Minimal      | E-Commerce      | Microservices     |
| ------------ | ------------ | --------------- | ----------------- |
| Elements     | 15           | 293             | 450+              |
| Complexity   | Basic        | Realistic       | Enterprise        |
| Traceability | Simple chain | Multiple chains | Complex graph     |
| Security     | Basic auth   | RBAC + PCI DSS  | Zero-trust        |
| Services     | 1            | 12              | 25+               |
| APIs         | 1 operation  | 45 operations   | 100+ operations   |
| Best For     | Learning     | Real projects   | Large enterprises |

---

**Spec Version**: 0.2.0
**Conformance Level**: Full
**Industry**: E-Commerce
**Complexity**: Medium
**Last Updated**: 2025-11-26
