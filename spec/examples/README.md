# Example Models

This directory contains example architecture models demonstrating the Federated Architecture Metadata Model specification.

## Available Examples

### 1. Minimal Example ✅

**Location:** [minimal/](minimal/)
**Description:** The smallest conformant model with one element per layer
**Layers:** All 11 layers (minimal configuration)
**Elements:** 15 elements total
**Use Case:** Learning the basics, understanding traceability
**Complexity:** ⭐ (Low)
**Status:** Complete

**Perfect for:**

- First-time users
- Understanding spec structure
- Testing validators
- Template for new projects

### 2. E-Commerce Example ✅

**Location:** [e-commerce/](e-commerce/)
**Description:** Realistic online retail platform with multi-user system
**Layers:** All 11 layers (comprehensive)
**Elements:** 293 elements (7 services, 12 microservices)
**Use Case:** Production-ready patterns, realistic scenarios
**Complexity:** ⭐⭐⭐ (Medium)
**Status:** Complete

**Features:**

- Multi-user (customer, seller, admin)
- Product catalog & search
- Shopping cart & checkout
- Payment processing (PCI DSS)
- Customer support
- Analytics & reporting

**Perfect for:**

- Real-world projects
- Understanding complex traceability
- Security patterns (RBAC)
- Multi-channel UX

### 3. Microservices Example ✅

**Location:** [microservices/](microservices/)
**Description:** Enterprise-scale SaaS platform with distributed architecture
**Layers:** All 11 layers (advanced patterns)
**Elements:** 900+ elements (25+ microservices)
**Use Case:** Large-scale distributed systems, enterprise architecture
**Complexity:** ⭐⭐⭐⭐⭐ (High)
**Status:** Complete

**Features:**

- 25+ microservices across 7 domains
- Event-driven architecture (Kafka)
- Service mesh (Istio)
- Zero-trust security model
- Multi-region deployment (4 regions)
- Advanced observability (SLI/SLO)
- CQRS & Event Sourcing
- Chaos engineering

**Perfect for:**

- Enterprise architects
- Platform engineers
- SRE teams
- Advanced patterns (saga, circuit breaker)

### 4. Reference Implementation

**Location:** [reference-implementation/](reference-implementation/)
**Description:** Complete model used for testing the `dr` CLI tool
**Layers:** All 11 layers
**Use Case:** Reference for implementers, testing
**Status:** Complete

## Comparison Matrix

| Aspect            | Minimal       | E-Commerce     | Microservices   |
| ----------------- | ------------- | -------------- | --------------- |
| **Elements**      | 15            | 293            | 900+            |
| **Services**      | 1             | 12             | 25+             |
| **Complexity**    | Low           | Medium         | High            |
| **Patterns**      | Basic         | Realistic      | Advanced        |
| **Security**      | Basic auth    | RBAC + PCI DSS | Zero-trust      |
| **Scale**         | Single user   | 100K users     | 10M+ users      |
| **Deployment**    | Single server | Multi-tier     | Multi-region    |
| **APIs**          | 1 operation   | 45 operations  | 150+ operations |
| **Observability** | Basic         | Standard       | SLI/SLO/SLA     |
| **Best For**      | Learning      | Production     | Enterprise      |

## Learning Path

**Recommended progression:**

1. **Start: Minimal Example**
   - Understand all 11 layers
   - Learn traceability basics
   - Practice validation
   - **Time**: 1-2 hours

2. **Next: E-Commerce Example**
   - See realistic patterns
   - Multi-user scenarios
   - Complex relationships
   - **Time**: 4-6 hours

3. **Advanced: Microservices Example**
   - Enterprise patterns
   - Distributed systems
   - Advanced observability
   - **Time**: 8-12 hours

## Using Examples

### Validating an Example

```bash
# Minimal example
cd examples/minimal
dr validate --strict

# E-commerce example
cd examples/e-commerce
dr validate --strict

# Microservices example
cd examples/microservices
dr validate --strict
```

### Creating from Template

```bash
# Initialize new project from minimal
dr init --template minimal --name "my-project"

# Or copy and customize
cp -r examples/minimal my-project
cd my-project
# Edit files as needed
dr validate --strict
```

### Exploring

```bash
# List all elements
dr list --all

# Find traceability
dr trace motivation.goal.increase-revenue

# Search by property
dr search --property "criticality=critical"

# Export documentation
dr export markdown --output docs/
```

### Learning from Examples

Each example includes:

- **README.md** - Architecture overview and learning objectives
- **model/** - Complete architecture model (YAML)
- **ARCHITECTURE.md** - Detailed architecture documentation
- **dr.config.yaml** - Project configuration

Expected validation results:

- ✅ All schema validation passes
- ✅ All cross-references valid
- ✅ All semantic rules pass
- ✅ Full traceability present

## Contributing Examples

To contribute an example:

1. Create a new directory under `examples/`
2. Follow the structure of existing examples
3. Include comprehensive README.md
4. Ensure all files validate correctly
5. Document learning objectives
6. Submit pull request

See [../CONTRIBUTING.md](../CONTRIBUTING.md#adding-examples) for details.

---

**Start here:** [minimal/README.md](minimal/README.md) for the simplest example
