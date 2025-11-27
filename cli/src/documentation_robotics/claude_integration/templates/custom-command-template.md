# Custom DR Command Template

This template helps you create custom slash commands for Documentation Robotics workflows specific to your organization.

## Template Structure

````markdown
---
description: [Brief description of what this command does]
argument-hint: "[param1] [param2]"
---

# [Command Name]

[Brief description of what this command does]

## Purpose

[Detailed explanation of the command's purpose and when to use it]

## Workflow

When this command is invoked:

1. [Step 1 description]
2. [Step 2 description]
3. [Step 3 description]
   ...

## Frontmatter Fields

**Recommended fields:**

- `description`: Brief explanation shown in `/help` command
- `argument-hint`: Usage pattern shown during auto-complete (e.g., `"<path> [--option]"`)

**Optional fields:**

- `allowed-tools`: Comma-separated list of tools this command can use
- `model`: Specific AI model to use (e.g., `sonnet`, `haiku`)
- `disable-model-invocation`: Set to `true` to prevent programmatic invocation

## Parameters

[If your command accepts parameters, describe them here]

**Examples:**

```bash
/your-command [param1] [param2]
/your-command --option value
```
````

## Expected Behavior

[Describe what the agent should do when this command is run]

### Phase 1: [Name] (X% of time)

**Goal:** [Phase goal]

**Actions:**

- [Action 1]
- [Action 2]

### Phase 2: [Name] (Y% of time)

**Goal:** [Phase goal]

**Actions:**

- [Action 1]
- [Action 2]

[Continue with more phases as needed]

## Output Format

[Describe what output the user should expect]

## Integration

**Works well with:**

- [Related command 1]
- [Related command 2]

**Suggested workflow:**

```
1. /command-1
2. /your-command
3. /command-3
```

````

---

## Example: Custom Company-Specific Command

Here's an example of a custom command for adding microservices with your company's standards:

```markdown
---
description: Add a new microservice to the architecture model following Acme Corp standards
argument-hint: "<service-name> [--team <team>]"
---

# Add Microservice (Company Standard)

Adds a new microservice to the architecture model following Acme Corp standards.

## Purpose

Creates a complete microservice entry across multiple layers with all required:
- Business capability mapping
- Application service definition
- API operations (REST endpoints)
- Data model schemas
- Security policies (OAuth2 + API Gateway)
- Monitoring metrics (SLI/SLO)
- Deployment configuration (Kubernetes)

## Workflow

When invoked with `/dr-add-microservice [service-name]`:

1. Gather requirements interactively
2. Create business capability (if doesn't exist)
3. Create application service with standard properties
4. Define REST API operations (CRUD pattern)
5. Add data model schemas
6. Apply security policies (Acme Corp standard)
7. Add monitoring (availability, latency, error rate)
8. Configure deployment (Kubernetes namespace, resources)
9. Validate complete model
10. Generate service documentation

## Parameters

**Required:**
- `service-name`: Name of the service (kebab-case)

**Optional:**
- `--domain`: Business domain (default: infer from context)
- `--criticality`: Service criticality (critical|high|medium|low, default: medium)
- `--data-store`: Database type (postgresql|mongodb|redis, default: postgresql)

**Examples:**
```bash
/dr-add-microservice payment-processing
/dr-add-microservice order-fulfillment --domain=commerce --criticality=high
/dr-add-microservice user-preferences --data-store=redis
````

## Expected Behavior

### Phase 1: Requirements Gathering (10%)

**Goal:** Collect all necessary information

**Actions:**

- If domain not specified, list available domains and ask user to choose
- Confirm service name and description
- Ask about data storage requirements
- Identify dependencies on other services

### Phase 2: Model Creation (40%)

**Goal:** Create all architecture elements

**Business Layer:**

```bash
dr add business service --name "$SERVICE_NAME" \
  --description "$DESCRIPTION" \
  --property criticality=$CRITICALITY \
  --property domain=$DOMAIN
```

**Application Layer:**

```bash
dr add application service --name "$SERVICE_NAME" \
  --description "Application service for $SERVICE_NAME" \
  --property realizes=business.service.$SERVICE_NAME \
  --property technology=java-spring-boot \
  --property team=$TEAM
```

**API Layer (Standard CRUD):**

```bash
# Create operation
dr add api operation --name "Create $RESOURCE" \
  --property path="/api/v1/$RESOURCE" \
  --property method=POST \
  --property applicationServiceRef=application.service.$SERVICE_NAME

# Read operation
dr add api operation --name "Get $RESOURCE" \
  --property path="/api/v1/$RESOURCE/{id}" \
  --property method=GET \
  --property applicationServiceRef=application.service.$SERVICE_NAME

# Update operation
dr add api operation --name "Update $RESOURCE" \
  --property path="/api/v1/$RESOURCE/{id}" \
  --property method=PUT \
  --property applicationServiceRef=application.service.$SERVICE_NAME

# Delete operation
dr add api operation --name "Delete $RESOURCE" \
  --property path="/api/v1/$RESOURCE/{id}" \
  --property method=DELETE \
  --property applicationServiceRef=application.service.$SERVICE_NAME

# List operation
dr add api operation --name "List $RESOURCE" \
  --property path="/api/v1/$RESOURCE" \
  --property method=GET \
  --property applicationServiceRef=application.service.$SERVICE_NAME
```

**Data Model:**

```bash
dr add data_model schema --name "$RESOURCE" \
  --description "Data model for $SERVICE_NAME" \
  --property usedBy=api.operation.*$SERVICE_NAME*
```

### Phase 3: Security & Compliance (20%)

**Goal:** Apply Acme Corp security standards

**Actions:**

```bash
# OAuth2 authentication (Acme Corp standard)
dr add security policy --name "$SERVICE_NAME OAuth2" \
  --description "OAuth2 authentication for $SERVICE_NAME" \
  --property type=oauth2 \
  --property provider=okta \
  --property applies_to=application.service.$SERVICE_NAME

# API Gateway authorization
dr add security control --name "$SERVICE_NAME API Gateway" \
  --description "API Gateway authorization rules" \
  --property type=api-gateway \
  --property rules="require-jwt,rate-limit-1000-per-min" \
  --property applies_to=api.operation.*$SERVICE_NAME*

# If high/critical criticality, add encryption
if [ "$CRITICALITY" = "high" ] || [ "$CRITICALITY" = "critical" ]; then
  dr add security control --name "$SERVICE_NAME Encryption" \
    --property type=encryption \
    --property in-transit=tls-1.3 \
    --property at-rest=aes-256 \
    --property applies_to=application.service.$SERVICE_NAME
fi
```

### Phase 4: Monitoring (15%)

**Goal:** Add SLI/SLO monitoring per Acme standards

**Actions:**

```bash
# Availability metric (99.9% SLO)
dr add apm metric --name "$SERVICE_NAME availability" \
  --property type=availability \
  --property target=99.9 \
  --property instruments=application.service.$SERVICE_NAME

# Latency metric (P95 < 200ms)
dr add apm metric --name "$SERVICE_NAME latency" \
  --property type=latency \
  --property percentile=95 \
  --property target=200ms \
  --property instruments=application.service.$SERVICE_NAME

# Error rate metric (< 1%)
dr add apm metric --name "$SERVICE_NAME error-rate" \
  --property type=error-rate \
  --property target=1.0 \
  --property instruments=application.service.$SERVICE_NAME
```

### Phase 5: Deployment Configuration (10%)

**Goal:** Add Kubernetes deployment specs

**Actions:**

```bash
# Kubernetes node
dr add technology node --name "$SERVICE_NAME pod" \
  --property type=kubernetes-pod \
  --property namespace=production \
  --property replicas=3 \
  --property resources="cpu=500m,memory=512Mi"

# Database
dr add datastore database --name "$SERVICE_NAME db" \
  --property type=$DATA_STORE \
  --property deployedTo=technology.node.acme-db-cluster
```

### Phase 6: Validation & Documentation (5%)

**Goal:** Ensure quality and generate docs

**Actions:**

```bash
# Validate model
dr validate --strict

# Generate service documentation
dr export --format markdown --filter "layer=*;service=$SERVICE_NAME" \
  --output docs/services/$SERVICE_NAME.md
```

## Output Format

```
✓ Microservice created: $SERVICE_NAME

Elements created:
  Business Layer:
    ✓ business.service.$SERVICE_NAME

  Application Layer:
    ✓ application.service.$SERVICE_NAME

  API Layer:
    ✓ api.operation.create-$RESOURCE
    ✓ api.operation.get-$RESOURCE
    ✓ api.operation.update-$RESOURCE
    ✓ api.operation.delete-$RESOURCE
    ✓ api.operation.list-$RESOURCE

  Data Model:
    ✓ data_model.schema.$RESOURCE

  Security:
    ✓ security.policy.$SERVICE_NAME-oauth2
    ✓ security.control.$SERVICE_NAME-api-gateway
    [✓ security.control.$SERVICE_NAME-encryption] (if critical)

  Monitoring:
    ✓ apm.metric.$SERVICE_NAME-availability
    ✓ apm.metric.$SERVICE_NAME-latency
    ✓ apm.metric.$SERVICE_NAME-error-rate

  Deployment:
    ✓ technology.node.$SERVICE_NAME-pod
    ✓ datastore.database.$SERVICE_NAME-db

Validation: ✓ Passed (strict mode)

Documentation: docs/services/$SERVICE_NAME.md

Next steps:
1. Review generated model: dr list application service --filter $SERVICE_NAME
2. Customize API operations if needed
3. Add business goal references: /dr-model Link $SERVICE_NAME to goals
4. Generate diagrams: dr export --format plantuml
5. Update team wiki with service docs
```

## Integration

**Works well with:**

- `/dr-validate` - Validate after creation
- `/dr-project` - Project to additional layers
- `/dr-model` - Fine-tune details

**Suggested workflow:**

```
1. /dr-add-microservice my-service --criticality=high
2. /dr-model Add goal references for my-service
3. /dr-validate --fix
4. dr export --format archimate
```

## Customization Notes

**To adapt this template:**

1. **Change security standards**: Update Phase 3 to match your org's policies
2. **Adjust monitoring**: Modify SLOs to match your targets
3. **Add deployment specifics**: Include your cloud provider details
4. **Include CI/CD**: Add pipeline configuration steps
5. **Compliance requirements**: Add regulatory checks (SOC2, HIPAA, etc.)

**Variables to customize:**

- `$TEAM`: Default team ownership
- OAuth provider: Change from Okta to your provider
- Kubernetes namespace: Update to your environment
- Database cluster: Update to your infrastructure
- Monitoring targets: Adjust SLOs to your standards

```

---

## Tips for Creating Effective Commands

1. **Start with common workflows**: Identify repetitive tasks
2. **Follow company standards**: Encode organizational patterns
3. **Make it interactive**: Ask for required information
4. **Validate thoroughly**: Check model after creation
5. **Provide clear output**: Show what was created
6. **Suggest next steps**: Guide user workflow
7. **Handle errors gracefully**: Anticipate common issues
8. **Document examples**: Show typical usage
9. **Keep focused**: One command = one workflow
10. **Test thoroughly**: Verify with real scenarios

## Installation

After creating your custom command:

1. Save as `.claude/commands/your-command.md`
2. Test with Claude Code: `/your-command`
3. Iterate based on results
4. Share with team
5. Consider contributing back to DR project

## Resources

- [Design Document](../../docs/04_claude_code_integration_design.md)
- [Existing Commands](../commands/)
- [DR CLI Reference](../../docs/user-guide/)
```
