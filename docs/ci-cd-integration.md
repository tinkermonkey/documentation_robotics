# CI/CD Integration Guide for Documentation Robotics

This guide shows you how to integrate Documentation Robotics validation and export workflows into your CI/CD pipelines.

## Overview

The Documentation Robotics CLI (Bun/TypeScript implementation) provides fast, reliable validation and export capabilities that integrate seamlessly with modern CI/CD platforms.

**Key Features:**

- Fast startup time (~200ms vs ~2s for legacy Python CLI)
- Lightweight Node.js/Bun runtime
- JSON output for programmatic parsing
- Non-zero exit codes on validation failures
- Supports all major CI/CD platforms

## Installation

### Prerequisites

- Node.js 18+ or Bun runtime
- npm or Bun package manager

### Installation Methods

#### Method 1: Install from npm (Recommended for CI)

```bash
npm install -g @documentation-robotics/cli
```

#### Method 2: Install from Source

```bash
git clone https://github.com/your-org/documentation_robotics.git
cd documentation_robotics/cli
npm install
npm run build
npm install -g .
```

#### Method 3: Use npx (No Installation)

```bash
npx @documentation-robotics/cli validate
```

## Common CI/CD Use Cases

### 1. Validate Model on Pull Requests

Run validation checks on every pull request to ensure model quality:

```bash
dr validate --strict --output json
```

**Exit Codes:**

- `0` - Validation passed
- `1` - Validation failed (errors found)
- `2` - Command error (invalid arguments, etc.)

### 2. Auto-Generate OpenAPI Specification

The visualization server generates an OpenAPI specification from route definitions. This ensures the API documentation always matches the implementation:

```bash
cd cli
npm run generate:openapi
```

This command:

- Loads your model from the working directory
- Extracts OpenAPI definitions from route handlers
- Validates schemas match the implementation
- Outputs to `docs/api-spec.yaml` in the project root

**Integration in CI/CD:**

Add this step to your release workflow to regenerate the spec before publishing:

```yaml
- name: Generate OpenAPI Spec
  run: |
    cd cli
    npm run generate:openapi
    git add docs/api-spec.yaml
```

### 3. Generate Documentation on Merge

Export documentation formats when code is merged to main:

```bash
dr export --format all --output ./exports
```

**Supported Formats:**

- ArchiMate XML
- OpenAPI JSON
- JSON Schema
- PlantUML
- Markdown
- GraphML

### 4. Check for Broken Cross-Layer References

Ensure architectural integrity by validating relationships:

```bash
dr validate --strict
```

### 5. Run Conformance Checks

Validate against industry standards:

```bash
dr conformance --standards archimate,openapi
```

## OpenAPI Auto-Generation Integration

The visualization server provides automated OpenAPI specification generation. Use this in your CI/CD pipelines to keep API documentation synchronized with implementation changes.

### Why Auto-Generate?

- **Schema-First Development**: Route definitions in `server.ts` use Zod schemas as the source of truth
- **No Manual Sync**: API docs automatically reflect any schema changes
- **Runtime Validation**: Generated spec can be validated against actual implementation
- **CI/CD Integration**: Validate spec changes in pull requests, regenerate on releases

### Setup Steps

1. **Local Development**:

   ```bash
   cd cli
   npm run generate:openapi
   ```

2. **Before Committing**:

   ```bash
   # Verify spec matches current implementation
   npm run generate:openapi
   git add docs/api-spec.yaml
   ```

3. **In CI/CD Pipelines**:
   - Validate that `docs/api-spec.yaml` has the `# HAND-MAINTAINED:` marker
   - Regenerate spec on releases
   - Version both spec and CLI together

### Example: GitHub Actions Release Workflow

Add to your release preparation workflow:

```yaml
- name: Generate Updated OpenAPI Spec
  run: |
    cd cli
    npm install
    npm run build
    npm run generate:openapi

- name: Verify Spec Format
  run: |
    # Check that spec has validation marker
    grep "# HAND-MAINTAINED:" docs/api-spec.yaml || exit 1

    # Validate YAML syntax
    python -m yaml docs/api-spec.yaml

- name: Commit Spec Updates
  run: |
    git config user.name "CI Bot"
    git config user.email "ci@example.com"
    git add docs/api-spec.yaml
    git commit -m "Update OpenAPI spec for release" || true
    git push
```

### Validation in CI

The CI pipeline automatically validates:

- ✓ `# HAND-MAINTAINED:` marker is present (indicates schema-first approach)
- ✓ Valid OpenAPI version (3.0.x or 3.1.x)
- ✓ No deprecated "backward compatibility" language
- ✓ Valid YAML syntax

See `.github/workflows/cli-tests.yml` for the validation job.

---

## Platform-Specific Integrations

## GitHub Actions Integration

### Basic Validation Workflow

Create `.github/workflows/dr-validate.yml`:

```yaml
name: DR Model Validation

on:
  pull_request:
    branches: [main, develop]
    paths:
      - ".dr/**"
      - "dr.config.yaml"
  push:
    branches: [main]
    paths:
      - ".dr/**"
      - "dr.config.yaml"

jobs:
  validate:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install DR CLI
        run: npm install -g @documentation-robotics/cli

      - name: Validate DR Model
        run: dr validate --strict --output json

      - name: Upload validation report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: validation-report
          path: ./dr-validation-report.json
```

### Advanced Workflow with Export

Create `.github/workflows/dr-export.yml`:

```yaml
name: DR Model Export

on:
  push:
    branches: [main]
    paths:
      - ".dr/**"

jobs:
  validate-and-export:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install DR CLI
        run: npm install -g @documentation-robotics/cli

      - name: Validate Model
        run: |
          dr validate --strict --output json > validation-report.json
          cat validation-report.json

      - name: Export All Formats
        if: success()
        run: |
          mkdir -p exports
          dr export --format all --output exports/

      - name: Upload Exports
        if: success()
        uses: actions/upload-artifact@v4
        with:
          name: dr-exports
          path: exports/

      - name: Deploy Documentation
        if: success()
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./exports
          destination_dir: architecture
```

### Matrix Strategy for Multiple Models

```yaml
name: DR Multi-Model Validation

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        model:
          - services/api-gateway
          - services/auth-service
          - services/order-service
      fail-fast: false

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install DR CLI
        run: npm install -g @documentation-robotics/cli

      - name: Validate ${{ matrix.model }}
        working-directory: ${{ matrix.model }}
        run: dr validate --strict --output json
```

---

## GitLab CI Integration

### Basic Pipeline Configuration

Create `.gitlab-ci.yml`:

```yaml
stages:
  - validate
  - export
  - deploy

variables:
  NODE_VERSION: "20"

.dr_install: &dr_install
  before_script:
    - npm install -g @documentation-robotics/cli

validate:model:
  stage: validate
  image: node:${NODE_VERSION}
  <<: *dr_install
  script:
    - dr validate --strict --output json
  artifacts:
    when: always
    paths:
      - dr-validation-report.json
    reports:
      junit: dr-validation-report.json
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

export:documentation:
  stage: export
  image: node:${NODE_VERSION}
  <<: *dr_install
  script:
    - mkdir -p exports
    - dr export --format all --output exports/
  artifacts:
    paths:
      - exports/
    expire_in: 30 days
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  dependencies:
    - validate:model
```

### Advanced Pipeline with Caching

```yaml
stages:
  - validate
  - export

variables:
  NODE_VERSION: "20"
  npm_config_cache: "$CI_PROJECT_DIR/.npm"

cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths:
    - .npm/
    - node_modules/

validate:strict:
  stage: validate
  image: node:${NODE_VERSION}
  before_script:
    - npm ci --cache .npm --prefer-offline
    - npm install -g @documentation-robotics/cli
  script:
    - dr validate --strict --output json
  artifacts:
    when: always
    paths:
      - dr-validation-report.json
    expire_in: 1 week

export:formats:
  stage: export
  image: node:${NODE_VERSION}
  before_script:
    - npm ci --cache .npm --prefer-offline
    - npm install -g @documentation-robotics/cli
  script:
    - |
      for format in archimate openapi json-schema plantuml markdown graphml; do
        echo "Exporting $format..."
        dr export --format $format --output exports/$format/
      done
  artifacts:
    paths:
      - exports/
    expire_in: 30 days
  only:
    - main
    - tags
```

---

## CircleCI Integration

### Basic Configuration

Create `.circleci/config.yml`:

```yaml
version: 2.1

orbs:
  node: circleci/node@5.1.0

jobs:
  validate-model:
    docker:
      - image: cimg/node:20.10
    steps:
      - checkout
      - node/install-packages:
          cache-path: ~/project/node_modules
      - run:
          name: Install DR CLI
          command: npm install -g @documentation-robotics/cli
      - run:
          name: Validate DR Model
          command: dr validate --strict --output json
      - store_artifacts:
          path: dr-validation-report.json
      - store_test_results:
          path: dr-validation-report.json

  export-documentation:
    docker:
      - image: cimg/node:20.10
    steps:
      - checkout
      - node/install-packages
      - run:
          name: Install DR CLI
          command: npm install -g @documentation-robotics/cli
      - run:
          name: Export All Formats
          command: |
            mkdir -p exports
            dr export --format all --output exports/
      - store_artifacts:
          path: exports/
      - persist_to_workspace:
          root: .
          paths:
            - exports

workflows:
  validate-and-export:
    jobs:
      - validate-model:
          filters:
            branches:
              only:
                - main
                - develop
      - export-documentation:
          requires:
            - validate-model
          filters:
            branches:
              only: main
```

---

## Jenkins Integration

### Declarative Pipeline

Create `Jenkinsfile`:

```groovy
pipeline {
    agent {
        docker {
            image 'node:20'
            args '-u root'
        }
    }

    environment {
        NODE_OPTIONS = '--max-old-space-size=4096'
    }

    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g @documentation-robotics/cli'
            }
        }

        stage('Validate Model') {
            steps {
                sh 'dr validate --strict --output json > validation-report.json || true'
                archiveArtifacts artifacts: 'validation-report.json', allowEmptyArchive: true
                script {
                    def validation = sh(
                        script: 'dr validate --strict',
                        returnStatus: true
                    )
                    if (validation != 0) {
                        error "DR model validation failed"
                    }
                }
            }
        }

        stage('Export Documentation') {
            when {
                branch 'main'
            }
            steps {
                sh 'mkdir -p exports'
                sh 'dr export --format all --output exports/'
                archiveArtifacts artifacts: 'exports/**/*', allowEmptyArchive: false
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo 'DR model validation and export completed successfully!'
        }
        failure {
            echo 'DR model validation failed!'
        }
    }
}
```

### Multibranch Pipeline

```groovy
pipeline {
    agent any

    tools {
        nodejs 'NodeJS-20'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Install DR CLI') {
            steps {
                sh 'npm install -g @documentation-robotics/cli'
            }
        }

        stage('Validate on PR') {
            when {
                changeRequest()
            }
            steps {
                sh 'dr validate --strict --output json'
                publishHTML([
                    reportDir: '.',
                    reportFiles: 'dr-validation-report.json',
                    reportName: 'DR Validation Report'
                ])
            }
        }

        stage('Full Export on Main') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    mkdir -p exports/{archimate,openapi,schemas,diagrams,docs}
                    dr export --format archimate --output exports/archimate/
                    dr export --format openapi --output exports/openapi/
                    dr export --format json-schema --output exports/schemas/
                    dr export --format plantuml --output exports/diagrams/
                    dr export --format markdown --output exports/docs/
                '''
                archiveArtifacts artifacts: 'exports/**/*'
            }
        }
    }
}
```

---

## Advanced Patterns

### Caching Strategies

#### GitHub Actions with npm Cache

```yaml
- name: Setup Node.js with Cache
  uses: actions/setup-node@v4
  with:
    node-version: "20"
    cache: "npm"
    cache-dependency-path: "**/package-lock.json"
```

#### GitLab CI with Artifact Caching

```yaml
cache:
  key:
    files:
      - package-lock.json
  paths:
    - node_modules/
    - .npm/
```

### Parallel Validation Jobs

Run validation for different layers in parallel:

```yaml
# GitHub Actions
jobs:
  validate-layers:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        layer:
          [
            motivation,
            business,
            security,
            application,
            technology,
            api,
            data-model,
            data-store,
            ux,
            navigation,
            apm,
            testing,
          ]
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @documentation-robotics/cli
      - run: dr validate --layer ${{ matrix.layer }}
```

### Conditional Export

Export only if validation passes:

```bash
#!/bin/bash
set -e

# Validate first
dr validate --strict --output json

# Only export if validation succeeded
if [ $? -eq 0 ]; then
  echo "Validation passed. Exporting documentation..."
  dr export --format all --output ./exports
else
  echo "Validation failed. Skipping export."
  exit 1
fi
```

---

## Troubleshooting

### Common Issues and Solutions

#### Issue: `dr: command not found`

**Solution:**

```bash
# Verify Node.js installation
node --version

# Install DR CLI
npm install -g @documentation-robotics/cli

# Verify installation
dr --version
```

#### Issue: Validation fails with "Model not found"

**Solution:**
Ensure you're in the project directory with `.dr/` folder:

```bash
ls -la .dr/
cd /path/to/project
dr validate
```

#### Issue: Out of memory errors

**Solution:**
Increase Node.js memory limit:

```bash
export NODE_OPTIONS="--max-old-space-size=4096"
dr validate --strict
```

#### Issue: Slow validation in CI

**Solution:**
Use caching and layer-specific validation:

```bash
# Cache node_modules
# Validate only changed layers
dr validate --layer api
```

#### Issue: Permission denied errors

**Solution:**
Check file permissions and use appropriate user:

```bash
# GitHub Actions/GitLab CI
chmod -R 755 .dr/

# Docker
docker run --user $(id -u):$(id -g) ...
```

---

## Best Practices

### 1. Fail Fast

Configure pipelines to fail immediately on validation errors:

```yaml
- run: dr validate --strict
  # No continue-on-error, fail pipeline if validation fails
```

### 2. Cache Dependencies

Cache `node_modules` to speed up builds:

```yaml
cache:
  paths:
    - node_modules/
```

### 3. Use JSON Output

Parse validation results programmatically:

```bash
dr validate --output json > validation.json
jq '.errors | length' validation.json
```

### 4. Separate Validation and Export

Run validation on every PR, export only on main:

```yaml
# Validate on all branches
on: [pull_request, push]

# Export only on main
if: github.ref == 'refs/heads/main'
```

### 5. Store Artifacts

Keep validation reports and exports for debugging:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: dr-validation
    path: |
      validation-report.json
      exports/
```

---

## Performance Tips

### 1. Use Layer-Specific Validation

Validate only changed layers to reduce execution time:

```bash
dr validate --layer api --layer data-model
```

### 2. Enable Caching

Cache DR CLI installation and dependencies:

```yaml
cache:
  key: ${{ runner.os }}-dr-${{ hashFiles('**/package-lock.json') }}
  paths:
    - ~/.npm
    - node_modules/
```

### 3. Run Validation in Parallel

Split validation across multiple jobs:

```yaml
strategy:
  matrix:
    layer: [business, application, api]
```

### 4. Use Faster Runners

Use larger runner instances for complex models:

```yaml
runs-on: ubuntu-latest-8-cores # GitHub Enterprise
```

---

## Example Repository Configurations

See complete working examples in `docs/examples/ci-cd/`:

- `.github/workflows/dr-validate.yml` - GitHub Actions
- `.gitlab-ci.yml` - GitLab CI
- `.circleci/config.yml` - CircleCI
- `Jenkinsfile` - Jenkins

## Additional Resources

- [DR CLI Documentation](https://github.com/your-org/documentation_robotics/tree/main/cli)
- [Migration from Python CLI](../migration-from-python-cli.md)
- [DR Specification](../spec/README.md)
- [Troubleshooting Guide](../docs/troubleshooting.md)

## Support

For issues or questions:

- GitHub Issues: https://github.com/your-org/documentation_robotics/issues
- Documentation: https://docs.documentation-robotics.dev
- Community: https://community.documentation-robotics.dev
