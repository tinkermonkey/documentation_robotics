# Claude Code Integration Testing

This document describes how to test the Claude Code integration for Documentation Robotics.

## Test Overview

### Testing Goals

1. **Functional Correctness**: All commands and agents work as designed
2. **Token Efficiency**: Reference sheets stay within budget
3. **User Experience**: Workflows are intuitive and effective
4. **Performance**: Operations complete in reasonable time
5. **Error Handling**: Graceful handling of edge cases

### Test Levels

1. **Unit Tests**: Individual components
2. **Integration Tests**: End-to-end workflows
3. **Performance Tests**: Token usage and execution time
4. **User Acceptance Tests**: Real-world scenarios

---

## Unit Tests

### Reference Sheets

**Test: Token Counts**

```bash
# Count tokens in each tier
for file in .claude/knowledge/dr-tier*.md; do
  echo "Testing: $file"
  tokens=$(wc -w < "$file" | awk '{print int($1 * 1.3)}')  # Rough estimate
  echo "Approximate tokens: $tokens"
done
```

**Expected**:

- Tier 1: 300-500 tokens ✓
- Tier 2: 800-1200 tokens ✓
- Tier 3: 2000-3000 tokens ✓

**Test: Content Completeness**

Check each tier contains required information:

```bash
# Tier 1 must have:
grep -q "12 layers" .claude/knowledge/dr-tier1-essentials.md || echo "FAIL: Missing layers"
grep -q "Element ID format" .claude/knowledge/dr-tier1-essentials.md || echo "FAIL: Missing ID format"
grep -q "dr add" .claude/knowledge/dr-tier1-essentials.md || echo "FAIL: Missing dr add command"
```

### Slash Commands

**Test: Command Files Exist**

```bash
commands=("dr-init" "dr-model" "dr-ingest" "dr-project" "dr-validate")
for cmd in "${commands[@]}"; do
  if [ -f ".claude/commands/${cmd}.md" ]; then
    echo "✓ ${cmd}.md exists"
  else
    echo "✗ ${cmd}.md missing"
  fi
done
```

**Test: Command Structure**

Each command should have:

- Purpose section
- Workflow section
- Examples
- Expected behavior

```bash
for file in .claude/commands/dr-*.md; do
  echo "Checking: $file"
  grep -q "## Purpose" "$file" || echo "  FAIL: Missing Purpose"
  grep -q "## Workflow" "$file" || echo "  FAIL: Missing Workflow"
  grep -q "## Example" "$file" || echo "  FAIL: Missing Examples"
done
```

### Agent Definitions

**Test: Agent Files Exist**

```bash
agents=("dr-extractor" "dr-validator" "dr-documenter")
for agent in "${agents[@]}"; do
  if [ -f ".claude/agents/${agent}.md" ]; then
    echo "✓ ${agent}.md exists"
  else
    echo "✗ ${agent}.md missing"
  fi
done
```

**Test: Agent Structure**

Each agent should have:

- Agent Type
- Purpose
- Capabilities
- Workflow phases

```bash
for file in .claude/agents/dr-*.md; do
  echo "Checking: $file"
  grep -q "**Agent Type:**" "$file" || echo "  FAIL: Missing Agent Type"
  grep -q "## Capabilities" "$file" || echo "  FAIL: Missing Capabilities"
  grep -q "## Workflow" "$file" || echo "  FAIL: Missing Workflow"
  grep -q "## Tools Available" "$file" || echo "  FAIL: Missing Tools"
done
```

---

## Integration Tests

### Test 1: Fresh Project Setup

**Objective**: Verify complete installation and initial modeling workflow

**Steps**:

1. **Setup**:

   ```bash
   mkdir /tmp/dr-test-project
   cd /tmp/dr-test-project
   dr init --name "Test Project" --description "Integration test"
   ```

2. **Install Claude Integration**:

   ```bash
   dr claude install
   ```

3. **Verify Installation**:

   ```bash
   dr claude status
   # Should show: 3 reference sheets, 5 commands, 3 agents
   ```

4. **Test with Claude Code**:

   ```
   Launch Claude Code and run:

   /dr-model Add a business service called "Order Management"
   ```

5. **Verify Model Created**:

   ```bash
   dr list business service
   # Should show: business.service.order-management
   ```

6. **Validate**:

   ```bash
   dr validate
   # Should pass (or have only minor warnings)
   ```

**Expected Result**: ✓ Service created and validated

**Cleanup**:

```bash
rm -rf /tmp/dr-test-project
```

### Test 2: Code Extraction Workflow

**Objective**: Verify model extraction from existing code

**Steps**:

1. **Setup Test Code**:

   ```bash
   mkdir -p /tmp/dr-test-extract/src/api
   ```

   Create `/tmp/dr-test-extract/src/api/main.py`:

   ```python
   from fastapi import FastAPI

   app = FastAPI()

   @app.get("/users/{user_id}")
   def get_user(user_id: int):
       return {"user_id": user_id}

   @app.post("/users")
   def create_user(name: str):
       return {"name": name}
   ```

2. **Initialize DR**:

   ```bash
   cd /tmp/dr-test-extract
   dr init
   dr claude install
   ```

3. **Extract with Claude Code**:

   ```
   /dr-ingest ./src/api --layers application,api
   ```

4. **Verify Extraction**:

   ```bash
   dr list api operation
   # Should show: api.operation.get-user, api.operation.create-user
   ```

5. **Check Confidence**:

   ```bash
   dr validate --format json | jq '.summary'
   # Should show high confidence and no critical errors
   ```

**Expected Result**: ✓ API operations extracted with high confidence

**Cleanup**:

```bash
rm -rf /tmp/dr-test-extract
```

### Test 3: Validation and Auto-Fix

**Objective**: Verify validation and auto-fix functionality

**Steps**:

1. **Setup with Intentional Issues**:

   ```bash
   mkdir /tmp/dr-test-validate
   cd /tmp/dr-test-validate
   dr init
   dr claude install
   ```

   Create business service manually with issues:

   ```bash
   # Create with missing description and wrong naming
   dr add business service --name "Order_Management"
   # (No description, underscore instead of hyphen)
   ```

2. **Run Validation**:

   ```bash
   dr validate --strict
   # Should show: naming convention error, missing description
   ```

3. **Auto-Fix with Claude**:

   ```
   /dr-validate --fix
   ```

4. **Verify Fixes**:

   ```bash
   dr validate --strict
   # Should show: reduced errors
   dr find business.service.order-management
   # Should show: fixed naming, added description
   ```

**Expected Result**: ✓ Issues detected and fixed automatically

**Cleanup**:

```bash
rm -rf /tmp/dr-test-validate
```

### Test 4: End-to-End Feature Addition

**Objective**: Complete workflow from goal to implementation

**Steps**:

1. **Setup**:

   ```bash
   mkdir /tmp/dr-test-e2e
   cd /tmp/dr-test-e2e
   dr init
   dr claude install
   ```

2. **Add Feature with Claude**:

   ```
   I need to add a payment processing feature. It should:
   - Support credit card payments
   - Be PCI-DSS compliant
   - Have 99.9% availability SLO
   - Integrate with Stripe

   Can you model this across all relevant layers?
   ```

3. **Verify All Layers**:

   ```bash
   # Business layer
   dr find business.service.payment-processing
   # Should exist with criticality=critical

   # Application layer
   dr find application.service.payment-api
   # Should exist with realizes reference

   # Security layer
   dr list security policy | grep -i pci
   # Should show PCI-DSS policy

   # Monitoring layer
   dr list apm metric | grep payment
   # Should show availability metric with 99.9% target
   ```

4. **Validate Traceability**:

   ```bash
   dr validate --check traceability
   # Should show complete chain
   ```

5. **Generate Documentation**:

   ```bash
   dr export --format markdown --filter "service=payment" --output docs/
   ls docs/
   # Should contain payment documentation
   ```

**Expected Result**: ✓ Complete feature modeled with traceability

**Cleanup**:

```bash
rm -rf /tmp/dr-test-e2e
```

### Test 5: Update Workflow

**Objective**: Verify update preserves customizations

**Steps**:

1. **Setup**:

   ```bash
   mkdir /tmp/dr-test-update
   cd /tmp/dr-test-update
   dr init
   dr claude install
   ```

2. **Customize a Command**:

   ```bash
   echo "# CUSTOM CONTENT" >> .claude/commands/dr-model.md
   ```

3. **Check Status**:

   ```bash
   dr claude status
   # Should show: dr-model.md modified
   ```

4. **Attempt Update**:

   ```bash
   dr claude update --dry-run
   # Should show: dr-model.md will be skipped (modified)
   ```

5. **Force Update with Backup**:

   ```bash
   dr claude update --force
   # Should create: .claude/commands/dr-model.md.bak
   ls .claude/commands/*.bak
   ```

**Expected Result**: ✓ Customizations preserved or backed up

**Cleanup**:

```bash
rm -rf /tmp/dr-test-update
```

---

## Performance Tests

### Test: Token Efficiency

**Objective**: Verify reference sheets stay within token budget

**Method**:

```python
# Token counter script (save as test_tokens.py)
import tiktoken

def count_tokens(file_path):
    encoding = tiktoken.get_encoding("cl100k_base")
    with open(file_path, 'r') as f:
        text = f.read()
    tokens = encoding.encode(text)
    return len(tokens)

# Test each tier
files = {
    "Tier 1": ".claude/knowledge/dr-tier1-essentials.md",
    "Tier 2": ".claude/knowledge/dr-tier2-developer-guide.md",
    "Tier 3": ".claude/knowledge/dr-tier3-complete-reference.md"
}

budgets = {
    "Tier 1": (300, 500),
    "Tier 2": (800, 1200),
    "Tier 3": (2000, 3000)
}

for name, file_path in files.items():
    count = count_tokens(file_path)
    min_tokens, max_tokens = budgets[name]

    status = "✓" if min_tokens <= count <= max_tokens else "✗"
    print(f"{status} {name}: {count} tokens (target: {min_tokens}-{max_tokens})")
```

**Run**:

```bash
python test_tokens.py
```

**Expected Output**:

```
✓ Tier 1: 432 tokens (target: 300-500)
✓ Tier 2: 1087 tokens (target: 800-1200)
✓ Tier 3: 2456 tokens (target: 2000-3000)
```

### Test: Execution Time

**Objective**: Verify operations complete in reasonable time

**Tests**:

```bash
# Test dr claude install
time dr claude install
# Target: < 5 seconds

# Test dr validate
time dr validate --strict
# Target: < 10 seconds for small model (< 50 elements)

# Test dr export
time dr export --format markdown --output /tmp/docs
# Target: < 15 seconds for small model
```

**Expected**:

- Install: ✓ < 5s
- Validate: ✓ < 10s
- Export: ✓ < 15s

---

## User Acceptance Tests

### UAT 1: Developer Onboarding

**Scenario**: New developer joining team

**Steps**:

1. Give new developer documentation link
2. Ask them to install and create a simple model
3. Time to first successful model creation
4. Collect feedback on clarity

**Success Criteria**:

- ✓ First model created within 30 minutes
- ✓ No blocking issues
- ✓ Positive feedback on ease of use

### UAT 2: Architect Documentation

**Scenario**: Senior architect documenting existing system

**Steps**:

1. Provide codebase to architect
2. Ask to extract and document architecture
3. Measure completeness and accuracy
4. Collect feedback on agent helpfulness

**Success Criteria**:

- ✓ Model extracted within 2 hours
- ✓ 80%+ accuracy (verified manually)
- ✓ Architecture diagrams generated
- ✓ Positive feedback on automation

### UAT 3: Team Collaboration

**Scenario**: Multiple team members working on same model

**Steps**:

1. Have 3-4 developers each add features
2. Track merge conflicts
3. Measure validation effectiveness
4. Collect feedback on workflow

**Success Criteria**:

- ✓ < 10% merge conflicts
- ✓ Validation catches cross-feature issues
- ✓ Team finds workflow productive

---

## Regression Tests

Run these tests before each release to ensure no regressions.

### Regression Test Suite

```bash
#!/bin/bash
# Save as: test-integration.sh

set -e  # Exit on first failure

echo "=== Running DR Claude Integration Tests ==="

# Test 1: Installation
echo "Test 1: Installation"
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"
dr init --name "Test" --description "Test" > /dev/null
dr claude install > /dev/null
dr claude status | grep -q "reference_sheets.*3" || (echo "FAIL: Wrong file count"; exit 1)
echo "✓ Installation test passed"

# Test 2: Basic Modeling
echo "Test 2: Basic Modeling"
dr add business service --name "TestService" --description "Test" > /dev/null
dr find business.service.testservice > /dev/null || (echo "FAIL: Service not found"; exit 1)
echo "✓ Basic modeling test passed"

# Test 3: Validation
echo "Test 3: Validation"
dr validate > /dev/null || (echo "FAIL: Validation failed"; exit 1)
echo "✓ Validation test passed"

# Test 4: Export
echo "Test 4: Export"
dr export --format markdown --output docs/ > /dev/null
[ -d "docs/" ] || (echo "FAIL: Docs not generated"; exit 1)
echo "✓ Export test passed"

# Cleanup
cd /
rm -rf "$TMP_DIR"

echo "=== All tests passed! ==="
```

**Run**:

```bash
chmod +x test-integration.sh
./test-integration.sh
```

---

## Error Cases

Test error handling for common failure scenarios.

### Error Test 1: Missing DR CLI

**Setup**:

```bash
# Temporarily rename DR CLI
mv $(which dr) $(which dr).bak
```

**Test**:

```
Launch Claude Code:
/dr-model Add a service
```

**Expected**:

- ✗ Should show clear error: "DR CLI not found"
- ✓ Should suggest: "Install with: pip install documentation-robotics"

**Cleanup**:

```bash
mv $(which dr).bak $(which dr)
```

### Error Test 2: Invalid Model

**Setup**:

```bash
mkdir /tmp/dr-test-error
cd /tmp/dr-test-error
# Don't run dr init - no model exists
```

**Test**:

```bash
dr claude install  # This should still work
dr validate  # This should fail gracefully
```

**Expected**:

- ✓ Install succeeds
- ✗ Validate shows: "No model found. Run: dr init"

### Error Test 3: Network Failure (External Dependencies)

**Setup**:

```bash
# Disable network for external calls
# (This depends on your OS)
```

**Test**:

```
Test commands that don't need network:
/dr-model Add a local service
/dr-validate
```

**Expected**:

- ✓ Local operations succeed
- ✗ External operations (if any) fail gracefully with retry suggestion

---

## Performance Benchmarks

### Benchmark: Large Model

**Setup**:

```bash
# Create model with 100 elements
for i in {1..100}; do
  dr add business service --name "Service-$i" --description "Test service $i"
done
```

**Tests**:

```bash
# Validate
time dr validate --strict
# Target: < 30s for 100 elements

# Export
time dr export --format markdown --output docs/
# Target: < 30s for 100 elements

# Search
time dr list business service | grep "Service-50"
# Target: < 2s
```

**Acceptance Criteria**:

- Validate: ✓ < 30s
- Export: ✓ < 30s
- Search: ✓ < 2s

---

## Test Checklist

Use this checklist before each release:

### Pre-Release Testing

- [ ] All reference sheets within token budget
- [ ] All slash commands have proper structure
- [ ] All agents have complete workflows
- [ ] Installation test passes
- [ ] Fresh project setup works
- [ ] Code extraction works
- [ ] Validation and auto-fix works
- [ ] End-to-end feature addition works
- [ ] Update workflow preserves customizations
- [ ] Token efficiency verified
- [ ] Execution times acceptable
- [ ] UAT feedback positive
- [ ] Regression tests pass
- [ ] Error handling graceful
- [ ] Performance benchmarks met

### Documentation Review

- [ ] User guide complete
- [ ] Examples tested
- [ ] Troubleshooting covers common issues
- [ ] API reference updated
- [ ] Changelog complete

### Release Preparation

- [ ] Version bumped
- [ ] Changelog merged
- [ ] Tests passing in CI
- [ ] Documentation deployed
- [ ] Release notes drafted

---

## Continuous Testing

### Automated Testing in CI

```yaml
# .github/workflows/claude-integration-test.yml
name: Claude Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: "3.11"

      - name: Install DR
        run: pip install -e ./cli

      - name: Run Integration Tests
        run: ./cli/tests/test-integration.sh

      - name: Check Token Counts
        run: python ./cli/tests/test_tokens.py

      - name: Verify File Structure
        run: |
          test -f cli/src/documentation_robotics/claude_integration/knowledge/dr-tier1-essentials.md
          test -f cli/src/documentation_robotics/claude_integration/commands/dr-model.md
          test -f cli/src/documentation_robotics/claude_integration/agents/dr-extractor.md
```

---

## Reporting Issues

When a test fails, report with:

1. **Test Name**: Which test failed
2. **Environment**: OS, DR version, Python version
3. **Steps to Reproduce**: Exact commands run
4. **Expected Result**: What should happen
5. **Actual Result**: What actually happened
6. **Logs**: Error messages and relevant output

**Example Issue Report**:

```markdown
## Test Failure: Code Extraction Workflow

**Environment:**

- OS: macOS 14.1
- DR Version: 0.3.3
- Python: 3.11.5

**Steps:**

1. Created FastAPI test app
2. Ran: dr claude install
3. Ran: /dr-ingest ./src/api --layers application,api

**Expected:**
API operations extracted with high confidence

**Actual:**
No operations extracted, error: "Framework not detected"

**Logs:**
```

[Extractor Agent] Analyzing ./src/api...
[Extractor Agent] No framework patterns found

```

**Potential Cause:**
FastAPI detection pattern may need update

```

---

## Success Metrics

Track these metrics to measure integration quality:

### Functional Metrics

- **Test Pass Rate**: Target > 95%
- **Bug Reports**: Target < 5 per release
- **User-Reported Issues**: Target < 3 per release

### Performance Metrics

- **Installation Time**: Target < 5s
- **Validation Time**: Target < 10s per 50 elements
- **Token Efficiency**: Within budget 100%

### Adoption Metrics

- **Install Rate**: Track `dr claude install` usage
- **Command Usage**: Most used slash commands
- **Agent Launch Rate**: Agent usage frequency

### Quality Metrics

- **Model Accuracy**: Extraction accuracy > 80%
- **Auto-Fix Success**: Fix rate > 80%
- **Documentation Coverage**: 100% of features documented

---

## Maintenance

### Regular Testing Schedule

- **Pre-commit**: Lint and format checks
- **Pre-PR**: Unit tests and integration tests
- **Pre-release**: Full test suite + UAT
- **Post-release**: Monitor adoption metrics

### Test Maintenance

- **Monthly**: Review and update test cases
- **Quarterly**: Add new edge case tests
- **Per Release**: Update regression tests
- **Annually**: Review and prune obsolete tests

---

## Summary

This testing plan ensures:

- ✓ All components work correctly
- ✓ Token budgets maintained
- ✓ Performance acceptable
- ✓ User experience positive
- ✓ Regressions caught early

**Key Testing Commands**:

```bash
# Quick smoke test
./test-integration.sh

# Token efficiency
python test_tokens.py

# Full regression
./run-all-tests.sh
```

**Before each release**: Complete the test checklist above.
