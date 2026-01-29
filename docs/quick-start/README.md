# Quick Start Tutorials

Welcome to Documentation Robotics! These tutorials guide you through common workflows using complete, executable examples.

## Choose Your Learning Path

### For First-Time Users (15 minutes)

Start with **[Simple REST API Model](01-simple-api.md)** to learn:

- How to initialize a DR project
- Adding elements across layers
- Creating relationships
- Validating your model

**Best for:** Understanding basic concepts and CLI commands

### For Architecture Teams (30 minutes)

Progress to **[Microservices Architecture](02-microservices.md)** to learn:

- Modeling multi-service systems
- Complex relationship patterns
- Cross-layer traceability
- Organizing larger models

**Best for:** Real-world architecture modeling

## Tutorial Format

Each tutorial includes:

- **Objective:** What you'll accomplish
- **Prerequisites:** What to know before starting
- **Step-by-step instructions** with CLI commands
- **Expected output:** What you should see
- **Verification:** How to confirm success
- **Next steps:** Where to go from here

## CLI Setup

Before starting any tutorial, ensure the CLI is ready:

```bash
cd documentation_robotics/cli
npm install
npm run build

# Verify installation
node dist/cli.js --help
```

## Getting Help

- Stuck on a step? See the [Troubleshooting Guide](../troubleshooting/common-errors.md)
- Need a reference? Check the [Quick Reference](../reference/cheat-sheet.md)

## Learning Order (Recommended)

1. **Simple REST API** - Foundation (15 min)
2. **Troubleshooting Guide** - Reference as needed (ongoing)
3. **Microservices Architecture** - Build on foundation (30 min)

---

Ready to start? Open **[Simple REST API Model](01-simple-api.md)** →
