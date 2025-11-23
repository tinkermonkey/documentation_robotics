# Minimal Example Model

**Conformance Level:** Basic (Layers 01-04)
**Status:** Template - Customize for your project

## Overview

This is the smallest valid architecture model conforming to the Federated Architecture Metadata Model specification at the Basic conformance level.

## Learning Objectives

After studying this example, you'll understand:
- Required directory structure
- Minimal required entities per layer
- How to reference between layers
- Basic validation requirements

## Model Structure

```
minimal/
├── README.md                   # This file
├── dr.config.yaml              # Model configuration
├── model/                      # Architecture model
│   ├── manifest.yaml           # Model metadata
│   ├── 01_motivation/
│   │   ├── goals.yaml
│   │   └── requirements.yaml
│   ├── 02_business/
│   │   └── services.yaml
│   ├── 03_security/
│   │   └── roles.yaml
│   └── 04_application/
│       └── components.yaml
└── specs/                      # Generated specs (empty for minimal)
```

## Entities Included

### Layer 01: Motivation
- 1 Goal
- 1 Requirement

### Layer 02: Business
- 1 Business Service

### Layer 03: Security
- 1 Role
- 1 Permission

### Layer 04: Application
- 1 Application Component
- 1 Application Service

## Cross-Layer References

Demonstrates:
- Application Service → Business Service (realization)
- Application Component → Goal (supports)
- Business Service → Requirement (fulfills)

## Usage

### Validate

```bash
cd spec/examples/minimal
dr validate --all
```

### Use as Template

```bash
cp -r spec/examples/minimal my-project
cd my-project

# Edit model/01_motivation/goals.yaml with your goals
# Edit other files as needed
# ...

dr validate --all
```

## Next Steps

After understanding this minimal example:
1. Review [../e-commerce/README.md](../e-commerce/README.md) for a realistic example
2. See [../../guides/getting-started.md](../../guides/getting-started.md) for a full tutorial
3. Read layer specifications in [../../layers/](../../layers/)
