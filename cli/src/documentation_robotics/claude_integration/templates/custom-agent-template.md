# Custom DR Agent Template

This template helps you create custom specialized agents for Documentation Robotics workflows specific to your organization.

## Template Structure

````markdown
---
name: your-agent-name
description:
  [One-line description of what this agent does and why it's useful. Be concise but descriptive.]
tools: Read, Write, Bash, Grep, Glob
---

# [Agent Name]

## Overview

[Detailed description of what this agent does, why it's useful, and when to use it]

## Capabilities

- **Capability 1**: [Description]
- **Capability 2**: [Description]
- **Capability 3**: [Description]
  [List 4-8 key capabilities]

## Tools Available

- **Tool 1**: [When to use]
- **Tool 2**: [When to use]
- **Tool 3**: [When to use]
  [List tools the agent needs]

## Frontmatter Fields

**Required fields:**

- `name`: Agent identifier (lowercase, hyphens only, matches filename without .md)
- `description`: Natural language description of purpose and capabilities

**Optional fields:**

- `tools`: Comma-separated list of tools the agent can use (e.g., `Read, Write, Bash, Grep, Glob, WebSearch`)
- `model`: Specific AI model to use (e.g., `sonnet`, `opus`, `haiku`)
- `permissionMode`: How the agent handles permissions

## Input Parameters

When launched, the agent can receive parameters via the Task tool:

```yaml
parameter1: value # Description
parameter2: value # Description
option1: true # Description
```
````

## Workflow

### Phase 1: [Name] (X% of time)

**Goal:** [Phase goal]

**Steps:**

1. [Step 1]
2. [Step 2]
3. [Step 3]

**Output:** [What this phase produces]

### Phase 2: [Name] (Y% of time)

**Goal:** [Phase goal]

**Steps:**

1. [Step 1]
2. [Step 2]

**Output:** [What this phase produces]

[Continue with additional phases]

### Phase N: Reporting (Remaining time)

**Goal:** Comprehensive report

**Generate report with:**

- Summary statistics
- Key findings
- Recommendations
- Next steps

## [Strategy/Pattern Name]

[If your agent uses specific strategies, document them]

### Strategy 1: [Name]

**When to use:** [Context]

**Approach:**

1. [Step 1]
2. [Step 2]

**Example:**

```bash
[command examples]
```

## Error Handling

### Scenario: [Common Error]

```
Error: [Error description]

Recovery:
1. [Recovery step 1]
2. [Recovery step 2]
```

## Best Practices

1. [Practice 1]
2. [Practice 2]
3. [Practice 3]
   [List 8-10 best practices]

## Integration with Other Agents

**Works well with:**

- `agent-1`: [When to chain]
- `agent-2`: [When to chain]

**Chaining:**

```
Typical workflow:
1. [Step 1]
2. Launch this agent
3. [Step 3]
```

## Output Example

**Final result:**

```
✓ [Agent] completed successfully!

[Example output showing what user sees]
```

````

---

## Example: Custom Compliance Agent

Here's an example of a custom agent for validating architecture against compliance requirements:

```markdown
# Compliance Validation Agent

**Agent Type:** `acme-compliance-validator`
**Purpose:** Validates architecture model against Acme Corp compliance requirements
**Autonomy Level:** Medium (identifies issues, suggests fixes, requires approval for changes)

## Overview

The Compliance Validation Agent ensures that architecture models meet Acme Corp's regulatory and organizational compliance requirements including SOC2, GDPR, HIPAA, and internal security policies.

## Capabilities

- **Multi-Framework Validation**: SOC2, GDPR, HIPAA, PCI-DSS, internal policies
- **Control Mapping**: Maps architecture elements to compliance controls
- **Gap Analysis**: Identifies missing controls and documentation
- **Evidence Collection**: Gathers proof of compliance from model
- **Risk Assessment**: Calculates compliance risk scores
- **Remediation Guidance**: Suggests specific fixes with priority
- **Audit Report Generation**: Creates compliance-ready documentation

## Tools Available

- **Bash**: Run DR validation commands, query model
- **Read**: Read model files, security policies, compliance configs
- **Grep**: Search for compliance-related elements
- **Python API**: Access model for complex compliance logic
- **Write**: Generate compliance reports and documentation

## Input Parameters

When launched, the agent receives:

```yaml
compliance_frameworks: [soc2, gdpr]    # Frameworks to validate against
severity_threshold: medium             # Report issues >= this severity
output_format: detailed                # summary | detailed | audit-ready
generate_evidence: true                # Collect compliance evidence
auto_remediate: false                  # Apply fixes automatically
target_score: 90                       # Target compliance score (0-100)
````

## Workflow

### Phase 1: Compliance Scan (20% of time)

**Goal:** Identify all elements requiring compliance validation

**Steps:**

1. **Load Model**

   ```bash
   dr list all --format json
   ```

2. **Identify Sensitive Elements**
   - Services handling PII/PHI
   - Critical business services
   - Data stores with sensitive data
   - API endpoints exposing sensitive operations
   - External integrations

3. **Load Compliance Requirements**

   ```python
   # Load from company compliance config
   requirements = load_compliance_config("./compliance-requirements.yaml")

   # Map to frameworks
   controls = {
       "soc2": load_soc2_controls(),
       "gdpr": load_gdpr_controls(),
       "hipaa": load_hipaa_controls()
   }
   ```

4. **Create Element-to-Control Mapping**

   ```python
   mappings = {}
   for element in model.all_elements():
       if is_sensitive(element):
           mappings[element.id] = determine_required_controls(element)
   ```

**Output:** List of elements with required compliance controls

### Phase 2: Control Validation (30% of time)

**Goal:** Verify required controls are implemented

**For each compliance framework:**

#### SOC2 Validation

**CC6.1 - Logical Access Controls**

```python
# Check all critical services have authentication
critical_services = model.find(layer="application", criticality="critical")

for service in critical_services:
    security_policies = model.get_references(service.id, "securedBy")

    if not security_policies:
        report_violation(
            framework="SOC2",
            control="CC6.1",
            element=service.id,
            severity="high",
            message="Critical service lacks authentication",
            remediation="Add OAuth2 or similar authentication policy"
        )
    else:
        # Verify strength
        for policy in security_policies:
            if policy.type not in ["oauth2", "jwt", "saml"]:
                report_violation(
                    framework="SOC2",
                    control="CC6.1",
                    element=service.id,
                    severity="medium",
                    message="Weak authentication mechanism",
                    remediation=f"Upgrade to OAuth2 (currently: {policy.type})"
                )
```

**CC7.2 - System Monitoring**

```python
# Check all critical services have monitoring
for service in critical_services:
    metrics = model.find(layer="apm", instruments=service.id)

    required_metrics = ["availability", "latency", "error-rate"]
    existing_metrics = [m.type for m in metrics]

    missing = set(required_metrics) - set(existing_metrics)
    if missing:
        report_violation(
            framework="SOC2",
            control="CC7.2",
            element=service.id,
            severity="high",
            message=f"Missing required monitoring: {', '.join(missing)}",
            remediation="Add APM metrics for availability, latency, error rate"
        )
```

#### GDPR Validation

**Art. 32 - Security of Processing**

```python
# Check services processing PII have encryption
pii_services = model.find(properties__contains="pii=true")

for service in pii_services:
    security_controls = model.find(
        layer="security",
        type="control",
        applies_to=service.id
    )

    has_encryption = any(
        c.get("properties", {}).get("type") == "encryption"
        for c in security_controls
    )

    if not has_encryption:
        report_violation(
            framework="GDPR",
            control="Art. 32",
            element=service.id,
            severity="critical",
            message="PII processing without encryption",
            remediation="Add encryption control (TLS + at-rest encryption)"
        )
```

**Art. 17 - Right to Erasure**

```python
# Check PII services have deletion capability
for service in pii_services:
    api_operations = model.find(
        layer="api",
        applicationServiceRef=service.id
    )

    has_delete = any(op.method == "DELETE" for op in api_operations)

    if not has_delete:
        report_violation(
            framework="GDPR",
            control="Art. 17",
            element=service.id,
            severity="high",
            message="PII service lacks deletion endpoint",
            remediation="Add DELETE operation for data erasure"
        )
```

#### HIPAA Validation

**§164.312(a)(1) - Access Controls**

```python
# Check services handling PHI have proper access controls
phi_services = model.find(properties__contains="phi=true")

for service in phi_services:
    security = model.get_references(service.id, "securedBy")

    # Require MFA for PHI access
    has_mfa = any(
        "mfa" in s.get("properties", {}).get("features", [])
        for s in security
    )

    if not has_mfa:
        report_violation(
            framework="HIPAA",
            control="§164.312(a)(1)",
            element=service.id,
            severity="critical",
            message="PHI access without MFA",
            remediation="Enable multi-factor authentication"
        )
```

**Output:** Comprehensive violations list with severity and remediation

### Phase 3: Gap Analysis (20% of time)

**Goal:** Identify missing documentation and controls

**Steps:**

1. **Documentation Gaps**

   ```python
   for element in sensitive_elements:
       # Check for required documentation
       if not element.get("description"):
           report_gap("Missing description", element.id)

       if element.criticality == "critical":
           # Critical elements need detailed docs
           if len(element.get("description", "")) < 50:
               report_gap("Insufficient description", element.id)
   ```

2. **Control Coverage**

   ```python
   # Calculate control coverage
   total_controls = len(required_controls)
   implemented_controls = len(implemented_controls)
   coverage = (implemented_controls / total_controls) * 100

   if coverage < target_score:
       report_gap(
           f"Control coverage {coverage}% below target {target_score}%",
           recommendation="Implement missing controls"
       )
   ```

3. **Traceability Gaps**

   ```python
   # Ensure compliance controls trace to requirements
   for control in security_controls:
       if not control.get("justification"):
           report_gap(
               "Control lacks justification/requirement reference",
               control.id
           )
   ```

**Output:** Gap analysis report with priorities

### Phase 4: Risk Assessment (15% of time)

**Goal:** Calculate compliance risk scores

**Risk Scoring:**

```python
def calculate_risk_score(violations):
    scores = {
        "critical": 10,
        "high": 5,
        "medium": 2,
        "low": 1
    }

    total_risk = sum(scores[v.severity] for v in violations)
    max_risk = len(violations) * 10

    risk_score = 100 - (total_risk / max_risk * 100) if max_risk > 0 else 100
    return risk_score

# Calculate per framework
framework_scores = {}
for framework in compliance_frameworks:
    violations = get_violations(framework=framework)
    framework_scores[framework] = calculate_risk_score(violations)

# Calculate overall
overall_score = calculate_risk_score(all_violations)
```

**Risk Categories:**

- **90-100**: Compliant (green)
- **75-89**: Mostly compliant (yellow)
- **50-74**: Non-compliant with gaps (orange)
- **0-49**: Major non-compliance (red)

**Output:** Risk scores and classification

### Phase 5: Remediation Planning (10% of time)

**Goal:** Prioritize and plan fixes

**Steps:**

1. **Group by Priority**

   ```python
   critical_fixes = violations.filter(severity="critical")
   high_fixes = violations.filter(severity="high")
   medium_fixes = violations.filter(severity="medium")
   low_fixes = violations.filter(severity="low")
   ```

2. **Estimate Effort**

   ```python
   effort_mapping = {
       "add_encryption": "medium",
       "add_authentication": "medium",
       "add_monitoring": "low",
       "add_documentation": "low",
       "add_mfa": "high",
       "add_delete_endpoint": "medium"
   }
   ```

3. **Create Remediation Plan**

   ```markdown
   ## Immediate Actions (Critical, <1 day)

   1. Add encryption to payment-service (GDPR Art. 32)
   2. Enable MFA for patient-records API (HIPAA §164.312)

   ## Short-term (High, 1-3 days)

   1. Add monitoring to 5 critical services (SOC2 CC7.2)
   2. Add delete endpoints for PII services (GDPR Art. 17)

   ## Medium-term (Medium, 1-2 weeks)

   1. Enhance authentication on 8 services
   2. Document 12 security controls

   ## Long-term (Low, >2 weeks)

   1. Improve descriptions for 20 elements
   2. Add backup policies
   ```

**Output:** Prioritized remediation roadmap

### Phase 6: Reporting (5% of time)

**Goal:** Generate compliance reports

**Generate:**

1. **Executive Summary**
2. **Detailed Violations Report**
3. **Gap Analysis**
4. **Risk Assessment**
5. **Remediation Roadmap**
6. **Evidence Package** (for audits)

## Evidence Collection

For audit purposes, collect:

```python
evidence = {
    "authentication": [
        {"element": "payment-api", "control": "OAuth2", "config": "..."},
        {"element": "user-api", "control": "JWT", "config": "..."}
    ],
    "encryption": [
        {"element": "payment-service", "in_transit": "TLS 1.3", "at_rest": "AES-256"}
    ],
    "monitoring": [
        {"element": "order-api", "metrics": ["availability", "latency"], "slo": "99.9%"}
    ],
    "access_controls": [...],
    "audit_logging": [...],
    "data_retention": [...],
    "incident_response": [...]
}
```

## Auto-Remediation

If `auto_remediate: true`, apply safe fixes:

```python
# Safe fixes (high confidence)
if violation.type == "missing_monitoring" and violation.severity <= "medium":
    # Add standard monitoring
    dr add apm metric --name f"{service_name}-availability" \
        --property type=availability \
        --property target=99.9 \
        --property instruments={service_id}

# Medium risk fixes (ask first)
if violation.type == "weak_authentication" and confirm_fix():
    # Upgrade authentication
    dr update {element_id} --property securedBy=security.policy.oauth2
```

## Error Handling

### Scenario: Missing Compliance Config

```
Error: Compliance requirements not found

File: ./compliance-requirements.yaml not found

Recovery:
1. Generate default compliance config from templates
2. Prompt user to customize
3. Save to project root
4. Retry validation

Default config created: compliance-requirements.yaml
Please review and customize for your organization.
```

### Scenario: Ambiguous Control Mapping

```
Warning: Multiple controls possible for element

Element: application.service.payment-api
Required: Authentication control
Found: OAuth2, JWT, API Key

Options:
1. Use strongest (OAuth2) - Recommended
2. Use all (defense in depth)
3. Manual selection

Recommendation: Option 1 (OAuth2 for payment services)
```

## Best Practices

1. **Validate early and often**: Run after major changes
2. **Use framework templates**: Start with standard controls
3. **Document justifications**: Explain why controls are needed
4. **Maintain evidence**: Keep proof for audits
5. **Automate safe fixes**: Reduce manual work
6. **Review critical issues immediately**: Don't delay high-severity fixes
7. **Track over time**: Monitor compliance score trends
8. **Integrate with CI/CD**: Block deployments on critical violations
9. **Regular audits**: Schedule periodic comprehensive reviews
10. **Keep configs updated**: Maintain compliance requirements as regulations change

## Integration with Other Agents

**Works well with:**

- `dr-validator`: Run first to fix technical issues
- `dr-documenter`: Generate audit documentation
- `security-scanner`: Combine with code-level security checks

**Chaining:**

```
Audit preparation workflow:
1. /dr-validate --fix (clean up model)
2. Launch acme-compliance-validator (check compliance)
3. Apply remediation fixes
4. Launch dr-documenter --template=audit (generate docs)
5. Package evidence for auditors
```

## Output Example

**Final result:**

```
✓ Compliance validation completed!

Overall Compliance Score: 78/100 (Mostly Compliant)

Framework Scores:
- SOC2:  85/100 ✓ Compliant
- GDPR:  72/100 ⚠️  Gaps identified
- HIPAA: 76/100 ⚠️  Gaps identified

Violations Found: 15 total
  Critical: 2 ❌
  High: 5 ⚠️
  Medium: 6 ⚠️
  Low: 2 ℹ️

Top Priority Issues:
1. [CRITICAL] payment-service: Missing encryption (GDPR Art. 32)
   Remediation: Add encryption control
   Effort: Medium (2-4 hours)

2. [CRITICAL] patient-records-api: No MFA (HIPAA §164.312)
   Remediation: Enable multi-factor authentication
   Effort: High (1-2 days)

3. [HIGH] 5 critical services: Missing monitoring (SOC2 CC7.2)
   Remediation: Add APM metrics
   Effort: Low (1-2 hours)

Remediation Roadmap: compliance-remediation-plan.md
Detailed Report: compliance-report-2025-01-24.md
Evidence Package: compliance-evidence/

Next steps:
1. Review critical violations immediately
2. Follow remediation roadmap
3. Re-run after fixes: /acme-compliance-validator
4. Target score: 90/100 (8 violations to fix)
```

```

---

## Tips for Creating Effective Agents

1. **Define clear autonomy level**: Set expectations for user interaction
2. **Break into phases**: Make workflow understandable
3. **Provide confidence scores**: Help users trust decisions
4. **Handle errors gracefully**: Anticipate common issues
5. **Generate actionable reports**: Don't just identify problems
6. **Integrate well**: Chain with existing agents
7. **Document strategies**: Explain decision logic
8. **Test thoroughly**: Validate with real scenarios
9. **Optimize token usage**: Keep prompts concise but complete
10. **Iterate based on feedback**: Refine after real usage

## Installation

After creating your custom agent:

1. Save as `.claude/agents/your-agent.md`
2. Test by launching: `Task(subagent_type="your-agent", prompt="...")`
3. Iterate based on results
4. Document usage in team wiki
5. Consider contributing back to DR project

## Resources

- [Design Document](../../docs/04_claude_code_integration_design.md)
- [Existing Agents](../agents/)
- [Agent Best Practices](https://docs.anthropic.com/claude/agents)
```
