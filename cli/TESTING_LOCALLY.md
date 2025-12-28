# Local Testing Guide - Documentation Robotics Bun CLI

This guide provides step-by-step instructions for testing the Bun CLI locally during development.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 18+** (includes npm)
- **Bun 1.3+** (optional but recommended for faster test execution)
- **Git** (for cloning the repository)

### Installing Bun (Optional but Recommended)

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (WSL or PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# Verify installation
bun --version
```

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/tinkermonkey/documentation_robotics.git
cd documentation_robotics
```

### 2. Navigate to Bun CLI Directory

```bash
cd cli
```

### 3. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:

- TypeScript compiler
- Testing framework (Bun)
- CLI dependencies (Commander.js, AJV, Ansis, etc.)

### 4. Build the CLI

```bash
npm run build
```

This compiles TypeScript to JavaScript and copies schema files to the `dist/` directory.

**Expected output:**

```
> @documentation-robotics/cli@0.1.0 build
> tsc && npm run copy-schemas

> @documentation-robotics/cli@0.1.0 copy-schemas
> cp -r src/schemas dist/
```

## Running the CLI Locally

### Option 1: Direct Execution (Development)

Run the CLI directly from the compiled output:

```bash
node dist/cli.js --version
node dist/cli.js --help
node dist/cli.js init --name "Test Model"
```

### Option 2: npm dev Script

Use the preconfigured dev script:

```bash
npm run dev -- --help
npm run dev -- init --name "Test Model"
npm run dev -- validate
```

### Option 3: Global Installation (Recommended for Testing)

Install the CLI globally for easier testing:

```bash
# From cli directory
npm install -g .

# Now you can use 'dr' command anywhere
dr --version
dr --help
```

**To uninstall:**

```bash
npm uninstall -g @documentation-robotics/cli
```

## Testing Workflows

### 1. Run All Tests

```bash
npm run test
```

This runs the full test suite using Bun's test runner.

### 2. Run Specific Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# Validator tests
npm run test:validators

# All compatibility tests
npm run test:compatibility
```

### 3. Run Individual Test Files

```bash
# Run a specific test file
bun test tests/unit/core/element.test.ts

# With verbose output
bun test tests/unit/core/element.test.ts --verbose
```

### 4. Watch Mode (Auto-rerun on Changes)

```bash
# Watch all tests
bun test --watch

# Watch specific directory
bun test tests/unit/core --watch
```

## Testing with a Real Model

### 1. Create a Test Project

```bash
# Create a temporary directory for testing
mkdir -p ~/test-dr-model
cd ~/test-dr-model

# Initialize a new model
node ~/path/to/documentation_robotics/cli/dist/cli.js init --name "Test Project"
```

Or if installed globally:

```bash
mkdir -p ~/test-dr-model
cd ~/test-dr-model
dr init --name "Test Project"
```

### 2. Add Elements

```bash
# Add a motivation goal
dr add motivation goal --name "improve-performance" \
  --property description="Improve system performance"

# Add a business service
dr add business service --name "order-service" \
  --property description="Handles customer orders"

# Add an API endpoint
dr add api endpoint --name "create-order" \
  --property method=POST \
  --property path="/api/orders"
```

### 3. Validate the Model

```bash
dr validate

# Validate specific layer
dr validate --layer business

# Validate relationships
dr validate --validate-relationships
```

### 4. List Elements

```bash
# List all elements
dr list

# List elements in a specific layer
dr list motivation
dr list business
dr list api

# Search for elements
dr search "order"
```

### 5. View Element Details

```bash
dr show business.service.order-service
```

## Compatibility Testing (Python vs. Bun)

To run compatibility tests between the Python and Bun CLIs:

### Prerequisites

1. **Python CLI must be installed:**

```bash
cd ../cli
pip install -e .
cd ../cli
```

2. **Verify both CLIs work:**

```bash
# Test Python CLI
dr --version  # Should show Python CLI version

# Test Bun CLI
node dist/cli.js --version  # Should show Bun CLI version
```

### Run Compatibility Tests

```bash
# Run all compatibility tests
npm run test:compatibility

# Run specific compatibility test suites
npm run test:compatibility:commands
npm run test:compatibility:validation
npm run test:compatibility:export
npm run test:compatibility:edge-cases
```

**Note:** Some tests may fail if:

- Python CLI is not installed
- Python CLI version is incompatible
- Environment paths are not configured correctly

### Troubleshooting Compatibility Tests

If compatibility tests fail with "Python CLI not found":

```bash
# Check which 'dr' command is being used
which dr

# Set explicit path to Python CLI
export DR_PYTHON_CLI=/path/to/python/dr

# Re-run tests
npm run test:compatibility
```

## Development Workflow

### 1. Make Changes to Source Code

Edit files in `src/` directory:

- `src/commands/` - CLI commands
- `src/core/` - Domain models
- `src/validators/` - Validation logic
- `src/export/` - Export handlers

### 2. Rebuild

```bash
npm run build
```

### 3. Test Your Changes

```bash
# Run relevant tests
npm run test:unit

# Or test manually
node dist/cli.js <your-command>
```

### 4. Format Code

```bash
npm run format
```

### 5. Run Full Test Suite

```bash
npm run test:all
```

## Common Testing Scenarios

### Scenario 1: Testing a New Command

```bash
# 1. Add command implementation in src/commands/
# 2. Rebuild
npm run build

# 3. Test manually
node dist/cli.js your-new-command --help

# 4. Add tests in tests/unit/commands/
# 5. Run tests
npm run test:unit
```

### Scenario 2: Testing Validation Changes

```bash
# 1. Modify validators in src/validators/
# 2. Rebuild
npm run build

# 3. Test with a sample model
cd ~/test-dr-model
dr validate --verbose

# 4. Run validation test suite
cd ~/documentation_robotics/cli
npm run test:validators
```

### Scenario 3: Testing Export Formats

```bash
# 1. Create a test model with sample data
cd ~/test-dr-model
dr add business service test-service

# 2. Test export
dr export archimate --output test-export.xml
cat test-export.xml

# 3. Run export tests
cd ~/documentation_robotics/cli
npm run test -- tests/unit/export/*.test.ts
```

### Scenario 4: Testing Visualization Server

```bash
# 1. Start the server
dr visualize --port 8080

# 2. Open browser to http://localhost:8080/?token=<shown-token>

# 3. Test in another terminal
curl -H "Authorization: Bearer <token>" http://localhost:8080/api/model

# 4. Stop server with Ctrl+C
```

## Debugging

### Using VS Code Debugger

Create `.vscode/launch.json` in `cli/` directory:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "program": "${workspaceFolder}/dist/cli.js",
      "args": ["--help"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Test",
      "program": "${workspaceFolder}/node_modules/.bin/bun",
      "args": ["test", "${file}"],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### Console Logging

Add debug output in your code:

```typescript
console.log("Debug:", variableName);
console.error("Error occurred:", error);
```

### Verbose Mode

Many commands support `--verbose` flag:

```bash
dr validate --verbose
dr export archimate --output test.xml --verbose
```

## Performance Testing

### Measure Startup Time

```bash
# Bun CLI
time node dist/cli.js --help

# Compare with Python CLI (if installed)
time dr --help
```

### Measure Command Execution

```bash
# Test validation performance
time dr validate

# Test with larger models
time dr validate --layer api
```

## Cleaning Up

### Remove Test Models

```bash
rm -rf ~/test-dr-model
```

### Clean Build Artifacts

```bash
npm run clean  # If script exists, otherwise:
rm -rf dist/
npm run build
```

### Uninstall Global CLI

```bash
npm uninstall -g @documentation-robotics/cli
```

## CI/CD Simulation

Test the same checks that run in CI:

```bash
# Format check
npm run format

# Type check
npx tsc --noEmit

# Run all tests
npm run test:all

# Compatibility tests (requires Python CLI)
npm run test:compatibility
```

## Getting Help

### Documentation

- **CLI README:** `cli/README.md`
- **Main Project README:** `../README.md`
- **Specification:** `../spec/`
- **Compatibility Tests:** `cli/tests/compatibility/README.md`

### Command Help

```bash
# General help
dr --help

# Command-specific help
dr <command> --help

# Examples
dr init --help
dr validate --help
dr export --help
```

### Common Issues

**Issue: "Cannot find module"**

```bash
# Solution: Rebuild
npm run build
```

**Issue: "Command not found: dr"**

```bash
# Solution: Reinstall globally
npm install -g .
```

**Issue: "Tests failing with import errors"**

```bash
# Solution: Check Node version
node --version  # Should be 18+

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

**Issue: "Schema validation errors"**

```bash
# Solution: Ensure schemas are copied
npm run copy-schemas

# Or rebuild completely
npm run build
```

## Contributing

When you're ready to contribute your changes:

1. **Run all tests:**

   ```bash
   npm run test:all
   ```

2. **Format code:**

   ```bash
   npm run format
   ```

3. **Update documentation** if needed

4. **Create a pull request** with:
   - Clear description of changes
   - Test results
   - Any breaking changes noted

## Quick Reference Card

```bash
# Setup
npm install && npm run build

# Development
node dist/cli.js <command>      # Run CLI
npm run dev -- <command>        # Alt. run CLI
npm run build                   # Rebuild
npm run test                    # Run tests

# Testing Suites
npm run test:unit              # Unit tests
npm run test:integration       # Integration tests
npm run test:compatibility     # Cross-CLI tests

# Installation
npm install -g .               # Install globally
npm uninstall -g @documentation-robotics/cli  # Uninstall

# Debugging
node --inspect dist/cli.js     # Debug mode
dr <command> --verbose         # Verbose output
```

---

**Happy Testing!** 🚀

For questions or issues, check the main project [README.md](../README.md) or open an issue on GitHub.
