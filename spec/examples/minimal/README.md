# Minimal Example

The smallest conformant model demonstrating all 12 layers of the Documentation Robotics specification.

## Purpose

This example demonstrates the **minimum** elements required for a conformant model:

- One element per layer
- Complete traceability chain from motivation to APM
- All validation rules pass

## Architecture

```
Motivation: Single goal (deliver value to users)
     ↓
Business: Single service (core business capability)
     ↓
Application: Single service (realizes business service)
     ↓
Technology: Single node (hosts application service)
     ↓
API: Single operation (exposes functionality)
     ↓
Data Model: Single schema (data structure)
     ↓
Datastore: Single table (persists data)
     ↓
UX: Single screen (user interface)
     ↓
Navigation: Single route (access screen)
     ↓
APM: Single metric (measures goal)
```

## Traceability

- **Goal**: Deliver Value to Users (99% availability)
- **Business Service**: Core Business Service
- **Application Service**: Application Service
- **API**: GET /data
- **Data**: Data schema and table
- **UX**: Main screen
- **Navigation**: / route
- **Metric**: System availability (measures goal)

## Security

- Single authentication policy
- Single user role
- OAuth2 authentication

## Model Structure

```
minimal/
├── dr.config.yaml              # Project configuration
├── model/
│   ├── manifest.yaml           # Layer manifest
│   ├── 01_motivation/
│   │   └── goals.yaml          # Single goal
│   ├── 02_business/
│   │   └── services.yaml       # Single service
│   ├── 03_security/
│   │   └── policies.yaml       # Auth policy
│   ├── 04_application/
│   │   └── services.yaml       # Single service
│   ├── 05_technology/
│   │   └── nodes.yaml          # Single server
│   ├── 06_api/
│   │   └── operations.yaml     # Single endpoint
│   ├── 07_data_model/
│   │   └── schemas.yaml        # Single schema
│   ├── 08_datastore/
│   │   └── tables.yaml         # Single table
│   ├── 09_ux/
│   │   └── screens.yaml        # Single screen
│   ├── 10_navigation/
│   │   └── routes.yaml         # Single route
│   └── 11_apm/
│       └── metrics.yaml        # Single metric
└── README.md                   # This file
```

## Element Count

- **Total Elements**: 15 (one per layer + security role + data elements)
- **Layers**: 11 (all layers)
- **Traceability Links**: Complete chain
- **Validation**: Passes all rules

## Validation

This model passes:

✅ Schema validation (all layers)
✅ Cross-layer reference validation
✅ Link validation (60+ link types from link registry)
✅ Semantic validation (11 rules)
✅ Upward traceability (application → business → motivation)
✅ Security integration (policies enforced)
✅ Bidirectional consistency (all relationships)
✅ Goal-to-metric traceability (goal measured by APM)

## Usage

### Validate the Model

```bash
cd minimal

# Basic validation
dr validate

# With link validation (recommended)
dr validate 

# Full strict validation
dr validate --strict  
```

Expected output:

```
✓ Validation passed
  - 15 elements validated
  - 60+ cross-layer links validated
  - 0 errors
  - 0 warnings
```

### Export

```bash
# Export to all formats
dr export all --output specs/

# Export specific format
dr export --format markdown --output specs/docs/
```

### Explore

```bash
# List all elements
dr list --all

# Discover cross-layer links
dr links list

# Find traceability
dr trace motivation.goal.deliver-value

# View conformance
dr conformance
```

## Learning Path

After understanding this minimal model:

1. **E-commerce Example**: See a realistic multi-user system
2. **Microservices Example**: See distributed architecture
3. **Full Spec**: Read the complete specification

## Key Concepts

This minimal model demonstrates:

1. **All 12 Layers**: Every layer is represented
2. **Traceability**: Complete chain from goal to metric
3. **Security**: Authentication and authorization
4. **API-First**: OpenAPI-based API definition
5. **Data Modeling**: JSON Schema + SQL DDL
6. **Multi-Channel**: Navigation supports web
7. **Observability**: Metrics measure goals

## Conformance Level

This model achieves **Full Conformance**:

- ✅ Basic Conformance (schema + references)
- ✅ Standard Conformance (+ semantic rules)
- ✅ Full Conformance (+ strict validation)

## Next Steps

1. Clone this model: `dr init --template minimal`
2. Add more elements to each layer
3. Add relationships between elements
4. Export to your preferred format
5. Integrate with your tools

## Questions

- What is the minimum viable model? **This one**
- Do I need all 12 layers? **Yes, for full conformance**
- Can I disable layers? **Yes, but you lose conformance**
- How do I extend this? **Add more elements, maintain traceability**

---

**Spec Version**: 0.6.0
**Conformance Level**: Full
**Last Updated**: 2025-12-14
