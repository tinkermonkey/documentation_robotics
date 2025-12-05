---
description: Comprehensive validation of DR model including schema, references, semantic rules, and cross-layer links
argument-hint: "[--strict] [--validate-links] [--strict-links]"
---

# Validate Architecture Model

Comprehensive validation of the Documentation Robotics model including schema, naming, references, semantic rules, and cross-layer link validation.

## What This Command Does

1. Runs comprehensive validation on the architecture model:
   - Schema validation (JSON schema compliance)
   - Naming conventions (kebab-case, valid IDs)
   - Reference integrity (broken references)
   - Semantic rules (business logic, best practices)
   - **Cross-layer link validation** (existence, type, cardinality, format)
2. Reports errors, warnings, and informational messages
3. Analyzes issues and suggests fixes with confidence scores
4. Provides actionable recommendations for fixes

## Usage

```
/dr-validate [--strict] [--validate-links] [--strict-links]
```

**Options:**

- `--strict`: Enable strict validation with comprehensive semantic rules
- `--validate-links`: Include comprehensive cross-layer link validation (recommended)
- `--strict-links`: Treat link warnings as errors (use with --validate-links)

## Instructions for Claude Code

When the user runs this command, perform intelligent validation with helpful suggestions.

### Step 1: Run Initial Validation

**RECOMMENDED: Always include link validation**

```bash
dr validate --strict --validate-links
```

**Basic validation** (default):

```bash
dr validate
```

**Comprehensive validation with link checking**:

```bash
dr validate --strict --validate-links --strict-links
```

**Most thorough validation**:

```bash
dr validate --strict --validate-links --strict-links
```

### Link Validation

Cross-layer link validation checks:

1. **Existence**: Target elements exist
2. **Type**: Correct element types referenced
3. **Cardinality**: Single values vs arrays correct
4. **Format**: Valid element ID format (UUID, paths, durations)

### Step 2: Parse and Categorize Results

Group validation results by severity:

- **Errors** (❌): Must fix (breaks model integrity)
- **Warnings** (⚠️): Should fix (best practices)
- **Info** (ℹ️): Consider (suggestions)

### Step 3: Analyze and Present Results

Present results in a clear, organized format:

```
Validation Results
==================

Summary:
❌ 3 errors
⚠️  5 warnings
ℹ️  2 info

Errors (must fix):

1. ❌ business.service.orders
   Location: documentation-robotics/model/02_business/services.yaml:15
   Issue: Missing 'realizes' cross-layer reference
   Impact: No traceability to application layer

   Suggested fix:
   → Add reference to application service
   Command: dr update business.service.orders \
     --property realizes=application.service.order-api

2. ❌ application.service.payment-api
   Location: documentation-robotics/model/04_application/services.yaml:23
   Issue: Critical service has no security policy
   Impact: High-risk service is unsecured

   Suggested fix:
   → Add authentication scheme
   Command: dr add security policy \
     --name "Payment API Authentication" \
     --property applies_to=application.service.payment-api

[Continue for all errors...]

Warnings (should fix):
[List warnings with suggestions...]

Info (suggestions):
[List informational items...]
```

### Step 4: Suggest Fixes

For each issue, provide:

1. **Clear explanation**: What's wrong and why it matters
2. **Specific fix**: Exact command to resolve
3. **Confidence level**: How certain you are this is the right fix
4. **Risk assessment**: Is this safe to auto-fix?

#### Fix Confidence Levels

**High confidence** (✓ Auto-fix safe):

- Broken references with obvious targets
- Missing descriptions (can infer from name)
- Naming convention fixes
- Missing IDs (can generate)

**Medium confidence** (⚠ Review recommended):

- Security policy selection (multiple options)
- Goal associations (requires domain knowledge)
- Criticality levels (business decision)

**Low confidence** (❌ Manual review required):

- Complex traceability issues
- Architectural decisions
- Business-specific requirements

### Step 5: Apply Fixes (if requested)

When user requests fixes:

1. **Show fix plan**: List all fixes to be applied
2. **Separate by risk**: Group safe vs. risky fixes
3. **Get confirmation**: Always ask before applying changes
4. **Apply approved fixes**: Execute commands sequentially
5. **Re-validate**: Confirm fixes resolved issues
6. **Report results**: Show what was fixed and what remains

#### Auto-Fix Process

```bash
# Get user confirmation
"I found 8 issues. Here's my fix plan:

Safe to auto-fix (5):
✓ Add missing descriptions (3 elements)
✓ Fix naming conventions (2 elements)

Require review (3):
⚠ Select security policies (2 services)
⚠ Associate with goals (1 service)

Apply safe fixes now? (I'll ask about the others)"

# If yes, apply safe fixes
dr update business.service.orders \
  --property description="Manages customer orders"

dr update business.service.shipping \
  --property description="Handles shipping logistics"

# ... continue for all safe fixes

# Re-validate
dr validate

# Report
"✓ Applied 5 fixes
✓ Re-validated

Remaining issues: 3 (require review)
[Show remaining issues with recommendations]"
```

### Step 6: Handle Different Validation Scenarios

#### Scenario 1: Clean Model (No Issues)

```
✓ Validation passed!

Model is healthy:
- 0 errors
- 0 warnings
- All cross-layer references valid
- Naming conventions followed
- Semantic rules satisfied

Great job! Your model is well-structured.
```

#### Scenario 2: Minor Issues (Warnings Only)

```
⚠️ Validation passed with warnings

Summary: 0 errors, 3 warnings

Your model is valid but could be improved:

1. ⚠️  business.service.checkout
   Recommendation: Add 'supports-goals' reference for traceability
   Impact: Helps trace business value

2. ⚠️  application.service.reporting
   Recommendation: Add monitoring metrics
   Impact: Improves observability

3. ⚠️  api.operation.create-payment
   Recommendation: Consider adding rate limiting
   Impact: Protects against abuse

Would you like me to address these warnings?
```

#### Scenario 3: Critical Errors

```
❌ Validation failed

Summary: 3 errors, 2 warnings

Critical issues found:

1. ❌ application.service.payment-api
   Error: References non-existent business.service.payment
   Impact: Broken traceability chain
   Fix: Create business service or update reference

2. ❌ Invalid ID format: business.service.Order_Management
   Error: Must use kebab-case
   Impact: Violates naming convention
   Fix: Rename to: business.service.order-management

3. ❌ security.policy.pci-dss
   Error: Applies to non-existent application.service.payment
   Impact: Security policy orphaned
   Fix: Update reference or remove policy

I can fix #2 automatically (rename).
#1 and #3 require your input - which service should they reference?
```

#### Scenario 4: Pattern Detection

Look for patterns in errors to provide higher-level guidance:

```
Detected patterns:

🔍 Security Gap (3 services)
   All critical services should have security policies.
   Found 3 critical services without policies:
   - application.service.payment-api
   - application.service.order-api
   - application.service.user-api

   Fix: /dr-model Add authentication policies to critical services

🔍 Missing Monitoring (5 services)
   Critical services should have APM metrics.
   Found 5 critical services without metrics:
   [list services...]

   Fix: /dr-model Add availability and latency metrics

🔍 Broken Traceability (2 services)
   Application services should realize business services.
   Found 2 application services with no 'realizes' reference:
   [list services...]

   Fix: Review each service and add business service references
```

### Step 7: Provide Actionable Next Steps

Based on validation results, suggest specific actions:

```
Next steps:

Priority 1 (Critical):
1. Fix broken references (3 errors)
   → I can help fix these (ask me to apply fixes)

Priority 2 (Security):
2. Add security policies to critical services
   → Run: /dr-model Add OAuth2 authentication for payment API

Priority 3 (Monitoring):
3. Add APM metrics for critical services
   → Run: /dr-model Add availability metrics to critical services

Priority 4 (Documentation):
4. Add descriptions to 5 elements
   → I can help fix these with high confidence
```

## Advanced Features

### Validate Before Commit

Help users validate before committing:

```
User: /dr-validate

You: Running validation before commit...

     dr validate --strict

     [show results]

     ✓ Model is valid and ready to commit!

     Suggested commit workflow:
     1. git add documentation-robotics/
     2. git commit -m "Add payment service with full traceability"
     3. git push
```

### Continuous Validation

For ongoing work, track validation status:

```
User: /dr-validate

You: Running validation check #3 today...

     Previous: ❌ 5 errors, 8 warnings
     Current:  ⚠️  0 errors, 3 warnings

     ✓ Improvement! Fixed all errors since last check.

     Remaining warnings:
     [show warnings]

     Keep up the good work!
```

### Validation Reports

Generate detailed reports:

```
User: /dr-validate --report

You: Generating comprehensive validation report...

     dr validate --strict > validation-report.json

     ✓ Report saved to: validation-report.json

     Summary:
     - Total elements: 45
     - Validated: 45
     - Errors: 0
     - Warnings: 3
     - Info: 2

     Report includes:
     - Element-by-element validation status
     - Cross-layer reference validation
     - Semantic rule results
     - Traceability matrix
     - Recommendations

     View report: cat validation-report.json | jq
```

## Validation Rules Reference

### Semantic Rules (11 rules)

1. **Security Controls**: Critical services must have security policies
2. **Critical Services Monitored**: Critical services need APM metrics
3. **Public APIs Authenticated**: Public APIs need auth schemes
4. **Personal Data Encrypted**: PII data needs encryption
5. **Business Processes Have Owners**: Processes need owners
6. **Goals Have KPIs**: Goals need measurable metrics
7. **Requirements Traced**: Requirements link to implementation
8. **Services Deployed**: App services reference infrastructure
9. **APIs Rate Limited**: Public APIs should have rate limits
10. **Data Has Backup**: Critical data needs backup policies
11. **UX Accessibility**: UX meets WCAG standards

### Common Validation Errors

**Broken Reference**:

```
Error: business.service.orders references motivation.goal.missing
Fix: Create goal or remove reference
```

**Invalid ID Format**:

```
Error: Invalid ID: business.service.Order_Management
Fix: Use kebab-case: business.service.order-management
```

**Missing Required Field**:

```
Error: Element missing required field 'name'
Fix: Add name field to element
```

**Circular Reference**:

```
Error: Circular reference detected: A → B → C → A
Fix: Break the cycle by removing one reference
```

## Error Handling

### Error: Model not found

```
Error: No DR model found in current directory

Fix: Initialize a model first:
/dr-init <project-name>
```

### Error: Validation failed to run

```
Error: Validation command failed

Troubleshooting:
1. Check model structure: ls -la documentation-robotics/model/
2. Check manifest: cat documentation-robotics/model/manifest.yaml
3. Verify DR installation: dr --version
4. Check logs: cat .dr/logs/dr.log
```

## Example Interactions

### Example 1: Clean Validation

```
User: /dr-validate

You: Running model validation...

     dr validate

     ✓ Validation passed!

     Model health: Excellent
     - 45 elements validated
     - 0 errors
     - 0 warnings
     - All references valid
     - Full traceability

     Your model is production-ready!
```

### Example 2: With Fixes

```
User: /dr-validate --strict --validate-links

You: Running validation with auto-fix...

     dr validate --strict

     Found 5 issues (3 safe to fix):

     Auto-fixing:
     ✓ Added description to business.service.orders
     ✓ Fixed ID: business.service.order-mgmt → order-management
     ✓ Added missing documentation reference

     Require review (2):
     1. application.service.payment-api needs security policy
        → Suggest: /dr-model Add OAuth2 authentication

     2. business.service.checkout needs goal reference
        → Which goal? (run: dr list motivation goal)

     Re-validating...
     ✓ Fixed 3 issues, 2 remain
```

### Example 3: Detailed Analysis

```
User: /dr-validate --strict

You: Running comprehensive validation...

     dr validate --strict

     Validation Summary:
     ❌ 2 errors (must fix)
     ⚠️  4 warnings (should fix)
     ℹ️  3 info (suggestions)

     [Detailed breakdown with suggestions]

     Pattern Analysis:
     🔍 All critical services missing monitoring
        → Quick fix: /dr-model Add APM metrics to critical services

     Would you like me to:
     1. Fix errors automatically (where safe)
     2. Show detailed fix commands for each issue
     3. Create a fix plan for batch processing
```

## Related Commands

- `/dr-init` - Initialize new model
- `/dr-model` - Add/update elements
- `/dr-project` - Cross-layer projection
- `dr validate --help` - CLI validation options
