# Customization Templates

This directory contains templates for creating custom slash commands, agents, and workflows tailored to your organization's needs.

## Available Templates

### 1. [custom-command-template.md](custom-command-template.md)

Template for creating custom slash commands that automate organization-specific workflows.

**Use when:**

- You have repetitive architecture modeling tasks
- Your organization has specific standards or patterns
- You want to encode best practices as commands

**Example use cases:**

- Add microservice with company standards (security, monitoring, deployment)
- Create API with organization's conventions
- Add compliance controls for your industry
- Generate feature with full traceability

**How to use:**

1. Copy the template
2. Fill in your workflow details
3. Save to `.claude/commands/your-command.md`
4. Test with Claude Code: `/your-command`

### 2. [custom-agent-template.md](custom-agent-template.md)

Template for creating specialized sub-agents for complex, multi-step operations.

**Use when:**

- Task requires autonomous decision-making
- Multiple phases with different strategies
- Complex analysis or validation needed
- Integration with external tools

**Example use cases:**

- Compliance validation agent (SOC2, HIPAA, GDPR)
- Cost optimization analyzer
- Technical debt detector
- Architecture pattern enforcer
- Custom code-to-model extractor

**How to use:**

1. Copy the template
2. Define agent capabilities and workflow
3. Save to `.claude/agents/your-agent.md`
4. Launch via: `Task(subagent_type="your-agent", prompt="...")`

### 3. [workflow-examples.md](workflow-examples.md)

Collection of complete workflow examples showing how to use DR + Claude Code for common scenarios.

**Includes:**

- New project setup
- Extracting model from existing codebase
- Adding new features
- Microservices documentation
- Security audit & remediation
- API-first development
- Goal-driven architecture
- Refactoring documentation
- Compliance documentation
- Team onboarding

**How to use:**

1. Find a workflow matching your needs
2. Follow step-by-step instructions
3. Adapt to your specific context
4. Share successful workflows with your team

## Quick Start

### Creating a Custom Command

```bash
# 1. Copy template
cp .claude/templates/custom-command-template.md .claude/commands/my-command.md

# 2. Edit the file
# - Replace [Command Name] with your command name
# - Define the workflow steps
# - Add examples

# 3. Test in Claude Code
/my-command
```

### Creating a Custom Agent

```bash
# 1. Copy template
cp .claude/templates/custom-agent-template.md .claude/agents/my-agent.md

# 2. Edit the file
# - Define agent capabilities
# - Outline the workflow phases
# - Specify tools needed

# 3. Test by launching from Claude Code
# (Agent will be available via Task tool)
```

## Template Structure

### Command Template Structure

```markdown
# Command Name

Brief description

## Purpose

Detailed explanation

## Workflow

Phase-by-phase breakdown

## Parameters

Expected inputs

## Expected Behavior

What the agent should do

## Output Format

What user should see

## Integration

How it chains with other commands
```

### Agent Template Structure

```markdown
# Agent Name

**Agent Type:** identifier
**Purpose:** one-line description
**Autonomy Level:** Low/Medium/High

## Overview

Detailed description

## Capabilities

List of what it can do

## Tools Available

Tools the agent needs

## Input Parameters

Configuration options

## Workflow

Phase-by-phase with percentages

## Strategies/Patterns

Approaches the agent uses

## Error Handling

Common scenarios and recovery

## Best Practices

Guidelines for effectiveness

## Integration

Chaining with other agents

## Output Example

Sample final result
```

## Best Practices

### For Commands

1. **Focus on one workflow**: Don't try to do everything
2. **Make it interactive**: Ask for required information
3. **Validate thoroughly**: Check model after creation
4. **Provide clear output**: Show what was created
5. **Suggest next steps**: Guide user workflow
6. **Handle errors gracefully**: Anticipate common issues
7. **Document examples**: Show typical usage
8. **Test with real scenarios**: Verify it works
9. **Keep it maintainable**: Use clear structure
10. **Share with team**: Collaborate on improvements

### For Agents

1. **Define clear autonomy level**: Set expectations
2. **Break into phases**: Make workflow understandable
3. **Provide confidence scores**: Help users trust decisions
4. **Handle errors gracefully**: Anticipate common issues
5. **Generate actionable reports**: Don't just identify problems
6. **Integrate well**: Chain with existing agents
7. **Document strategies**: Explain decision logic
8. **Test thoroughly**: Validate with real scenarios
9. **Optimize token usage**: Keep prompts concise but complete
10. **Iterate based on feedback**: Refine after real usage

## Example: Company-Specific Command

Let's say your company always adds microservices with specific standards:

````markdown
# Add Acme Corp Microservice

Adds a microservice following Acme Corp standards.

## Purpose

Creates a complete microservice with:

- Standard Kubernetes deployment (3 replicas)
- OAuth2 + API Gateway authentication
- PostgreSQL database
- Redis cache
- RabbitMQ messaging
- Standard monitoring (availability, latency, errors)
- PagerDuty alerting
- Datadog APM

## Workflow

### Phase 1: Gather Information

- Service name
- Business domain
- Criticality level
- Data sensitivity

### Phase 2: Create Model Elements

```bash
# Business service
dr add business service --name "$SERVICE" \
  --property domain="$DOMAIN" \
  --property criticality="$CRITICALITY"

# Application service
dr add application service --name "$SERVICE" \
  --property realizes=business.service.$SERVICE \
  --property technology=java-spring-boot \
  --property team=$TEAM

# Standard CRUD API operations
dr add api operation --name "Create $RESOURCE" \
  --property path="/api/v1/$RESOURCE" \
  --property method=POST

# Continue with more operations...
```
````

### Phase 3: Add Acme Corp Standards

```bash
# OAuth2 via API Gateway
dr add security policy --name "$SERVICE OAuth2" \
  --property type=oauth2 \
  --property provider=okta \
  --property applies_to=application.service.$SERVICE

# Kubernetes deployment
dr add technology node --name "$SERVICE pod" \
  --property type=kubernetes-pod \
  --property namespace=production \
  --property replicas=3

# PostgreSQL database
dr add datastore database --name "$SERVICE db" \
  --property type=postgresql \
  --property cluster=acme-db-prod

# Redis cache
dr add technology software --name "$SERVICE cache" \
  --property type=redis \
  --property cluster=acme-cache-prod

# Standard monitoring
dr add apm metric --name "$SERVICE availability" \
  --property type=availability \
  --property target=99.9

dr add apm metric --name "$SERVICE latency" \
  --property type=latency \
  --property percentile=95 \
  --property target=200ms

dr add apm metric --name "$SERVICE errors" \
  --property type=error-rate \
  --property target=1.0
```

### Phase 4: Validate and Document

```bash
# Validate
dr validate --strict

# Generate service docs
dr export --format markdown \
  --filter "service=$SERVICE" \
  --output docs/services/$SERVICE.md
```

## Output Format

```
✓ Microservice created: order-processing

Elements:
  ✓ business.service.order-processing
  ✓ application.service.order-processing
  ✓ api.operation.create-order
  ✓ api.operation.get-order
  ✓ api.operation.update-order
  ✓ api.operation.delete-order
  ✓ security.policy.order-processing-oauth2
  ✓ technology.node.order-processing-pod
  ✓ datastore.database.order-processing-db
  ✓ technology.software.order-processing-cache
  ✓ apm.metric.order-processing-availability
  ✓ apm.metric.order-processing-latency
  ✓ apm.metric.order-processing-errors

Validation: ✓ Passed

Documentation: docs/services/order-processing.md

Next steps:
1. Review service docs
2. Add to CI/CD pipeline
3. Create Jira epic
4. Begin implementation
```

## Integration

Works well with:

- `/dr-validate` - Validate after creation
- `/dr-project` - Project to additional layers
- `dr export` - Generate diagrams

Suggested workflow:

```
1. /add-acme-microservice payment-processing --criticality=critical
2. /dr-model Link payment-processing to business goals
3. /dr-validate --fix
4. dr export --format plantuml
```

```

Save this to `.claude/commands/add-acme-microservice.md` and it's ready to use!

## Sharing Templates

### Within Your Team

1. **Commit to repository**: Add custom commands/agents to version control
2. **Document in team wiki**: Link to templates and examples
3. **Conduct training**: Show team how to create and use custom workflows
4. **Iterate together**: Gather feedback and improve templates
5. **Create library**: Build collection of team-specific patterns

### With the Community

Consider contributing your templates back to the DR project if they're:
- Generally useful across organizations
- Well-documented and tested
- Follow DR conventions
- Include good examples

Submit via pull request to the [DR GitHub repository](https://github.com/yourusername/documentation-robotics).

## Testing Your Customizations

### For Commands

1. **Create test project**: Set up a clean environment
2. **Run the command**: Test with Claude Code
3. **Verify output**: Check model files created
4. **Validate model**: Run `dr validate --strict`
5. **Check exports**: Generate docs and diagrams
6. **Test error cases**: Try invalid inputs
7. **Get team feedback**: Have others use it

### For Agents

1. **Define test scenarios**: Create example inputs
2. **Launch agent**: Use Task tool
3. **Monitor execution**: Watch the workflow
4. **Verify results**: Check agent output
5. **Test edge cases**: Try unusual situations
6. **Measure performance**: Check execution time
7. **Iterate**: Refine based on results

## Troubleshooting

### Command not found

```

Error: Command '/my-command' not found

```

**Fix:**
- Ensure file is in `.claude/commands/`
- Check filename matches command name
- Restart Claude Code session

### Agent not available

```

Error: Unknown subagent_type 'my-agent'

```

**Fix:**
- Ensure file is in `.claude/agents/`
- Check agent type matches filename
- Verify agent markdown format

### Command executes but doesn't work

**Debug:**
1. Check Claude Code output for errors
2. Verify DR CLI commands are correct
3. Test DR commands manually
4. Check model validation
5. Review command prompt clarity

### Agent produces unexpected results

**Debug:**
1. Review agent workflow definition
2. Check input parameters
3. Test with simpler scenarios first
4. Add more specific instructions
5. Reduce autonomy level if needed

## Resources

- [Design Document](/cli/docs/04_claude_code_integration_design.md) - Overall architecture
- [User Guide](/cli/docs/user-guide/) - DR CLI documentation
- [Reference Sheets](../reference_sheets/) - Quick reference for agents
- [Existing Commands](../commands/) - Built-in command examples
- [Existing Agents](../agents/) - Built-in agent examples

## Support

- **Documentation issues**: Open issue on GitHub
- **Template questions**: Ask in Discussions
- **Feature requests**: Submit feature request
- **Bug reports**: Include command/agent file and error output

## Contributing

We welcome contributions of:
- New templates for common patterns
- Improvements to existing templates
- Example workflows from real projects
- Documentation enhancements

See [CONTRIBUTING.md](/CONTRIBUTING.md) for guidelines.
```
