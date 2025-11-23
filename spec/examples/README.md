# Example Models

This directory contains example architecture models demonstrating the Federated Architecture Metadata Model specification.

## Available Examples

### 1. Minimal Example

**Location:** [minimal/](minimal/)
**Description:** Smallest valid model demonstrating basic conformance
**Layers:** 01-04 (Motivation, Business, Security, Application)
**Use Case:** Learning the basics, testing validators
**Status:** In Progress

### 2. E-commerce Example

**Location:** [e-commerce/](e-commerce/)
**Description:** Realistic e-commerce application architecture
**Layers:** All 11 layers
**Use Case:** Standard conformance demonstration, realistic patterns
**Status:** Planned

### 3. Microservices Example

**Location:** [microservices/](microservices/)
**Description:** Distributed microservices architecture
**Layers:** All 11 layers, emphasizing API and observability
**Use Case:** Full conformance, complex systems
**Status:** Planned

### 4. Reference Implementation

**Location:** [reference-implementation/](reference-implementation/)
**Description:** Complete model used for testing the `dr` CLI tool
**Layers:** All 11 layers
**Use Case:** Reference for implementers, testing
**Status:** Complete

## Using Examples

### Validating an Example

```bash
cd examples/minimal
dr validate --all
```

### Creating a Model from an Example

```bash
# Copy example as starting point
cp -r examples/minimal my-project
cd my-project

# Modify for your needs
# ...

# Validate
dr validate --all
```

### Learning from Examples

Each example includes:

- `README.md` - Description and learning objectives
- `model/` - Architecture model files (YAML)
- `specs/` - Generated specifications (if applicable)
- `validation-report.txt` - Expected validation results

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
