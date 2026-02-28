# dr_engineering_guide — Engineering Guidance Skill

## Purpose

Provides structured engineering guidance across three phases of implementation work:

- **Mode 1: Requirements Review** — Before any code is written
- **Mode 2: Implementation Guidance** — While structuring implementation
- **Mode 3: Implementation Critique** — After code exists (PR review, code review)

This skill is advisory-only. It always recommends a DR command to run next rather than executing model changes directly.

## When This Skill Activates

This skill should activate when the user:

- Shares code or a PR for review
- Asks "does this make sense architecturally?"
- Asks "how should I implement X?"
- Asks "is this the right pattern?"
- Says "review my code" or "review this PR"
- Asks "am I missing anything?"
- Mentions a feature they're about to build
- Asks "what should I build first?"

## Routing Logic

```
Does the user have existing code/PR to show?
  └─ Yes → Mode 3: Implementation Critique

Is the user asking HOW to implement something?
  └─ Yes → Mode 2: Implementation Guidance

Is the user describing something they WANT to build (not yet built)?
  └─ Yes → Mode 1: Requirements Review
```

When ambiguous, ask: "Are you about to start building this, currently building it, or sharing finished code for review?"

---

## Mode 1: Requirements Review

**Triggered when:** User describes a feature or change they want to make, before implementation begins.

**Goal:** Surface architectural concerns, gaps, and alignment issues before any code is written.

### Checklist to Work Through

**1. Layer Coverage Check**
Map the proposed change to the 12-layer model:

- Which layers are touched? (List them explicitly)
- Which layers are conspicuously absent? (e.g., a new service with no APM or security)
- Flag: "This proposal affects X layers — are you planning to address all of them?"

**2. Layer Hierarchy Check**

- Does the proposal respect the "higher layers reference lower layers" rule?
- Example red flag: "A data-store change that has no corresponding data-model change"
- Example red flag: "An API endpoint that doesn't map to any application service"

**3. Motivation Alignment Check**

- Does the proposal trace back to an existing motivation element (goal, requirement)?
- If not: "I don't see a goal or requirement in the model for this. Is this a new business need? Consider adding one with /dr-design."

**4. Missing Concerns**
Explicitly check for:

- **Security**: Are there access controls defined? Who can use this feature?
- **Observability**: Are there metrics, spans, or alerts planned?
- **Testing**: What test cases validate this feature?
- **Error handling**: What happens when this fails? Is there a fallback?

**5. Cross-Layer Reference Completeness**

- If a new API endpoint is proposed, is there a corresponding application service?
- If a new application service is proposed, does it trace to a business service?

### Output Format

```
Requirements Review: [Feature Name]
=====================================

LAYER COVERAGE
  Touched: motivation, application, api, data-model
  Missing: security (⚠️ no access controls mentioned), apm (⚠️ no monitoring planned)

MOTIVATION ALIGNMENT
  ✓ Traces to: motivation.goal.customer-retention (existing)
  — or —
  ⚠️ No existing goal covers this. Recommend adding one before implementation.

LAYER HIERARCHY
  ✓ Layers flow correctly (application → api, application → data-model)
  — or —
  ⚠️ Issue: [specific hierarchy violation]

CONCERNS
  ⚠️ Security: No authentication scheme specified for the new endpoint
  ⚠️ APM: No SLO or latency target mentioned
  ℹ️  Testing: Integration tests should cover the state machine transitions

VERDICT
  [Approved / Approved with concerns / Needs revision]

RECOMMENDED NEXT STEP
  Run: /dr-design "[feature description]"
  This will generate a complete model design across all affected layers with reasoning.
```

---

## Mode 2: Implementation Guidance

**Triggered when:** User is about to implement something and asks how to structure it.

**Goal:** Ground the implementation in the existing model — find the patterns to follow, explain the expected structure.

### Steps to Follow

**1. Look Up Relevant Model Elements**

```bash
dr search "<key terms from the feature>"
dr list --layer <most relevant layer>
```

**2. Find Source-Tracked Elements as Canonical Patterns**

```bash
dr search --source-file <path> --layer application
```

Elements with source file tracking are the patterns to follow — they represent how the team has already built this kind of thing.

**3. Describe the Expected Patterns**
For each relevant layer the implementation touches, describe:

- What the canonical element type is (e.g., ApplicationService, ApiOperation)
- What the naming convention is (layer.type.kebab-name)
- What cross-layer relationships it should have
- What the implementation pattern looks like in code

**4. Cross-Reference with Spec Layer Types**

```bash
dr schema types <layer>
dr schema node <spec-node-id>
```

"Your service should match the ApplicationService spec type, which means: single responsibility, exposes at most one API contract, references exactly one business service."

**5. Suggest Implementation Order**
Based on the 12-layer model, suggest bottom-up implementation:

1. Data model / data store first (schema before logic)
2. Application service next (business logic)
3. API operations last (contract layer)
4. Cross-cutting: security, APM, testing alongside each layer

**6. Flag Common Pitfalls for This Change Type**
Draw on layer-specific knowledge:

- "Application services shouldn't directly call the data store — route through a repository pattern"
- "API operations should expose, not implement, business logic"

### Output Format

```
Implementation Guidance: [Feature Name]
=========================================

EXISTING PATTERNS TO FOLLOW
  Similar element: application.service.order-service
  Source: src/services/order.ts
  Pattern: Service class with repository injection, exposes via api.operation.*

EXPECTED STRUCTURE
  Layer: application
  Type: application.service (ApplicationService spec type)
  Naming: application.service.<kebab-name>
  Required relationships:
    - realizes → business.service.<matching-business-service>
    - exposes (via API layer) → api.operation.*

IMPLEMENTATION ORDER
  1. data-model.entity.<name> — define schema first
  2. data-store.table.<name> — create table/migration
  3. application.service.<name> — implement business logic
  4. api.operation.<name> — define contract

PITFALLS TO AVOID
  - Don't embed SQL in service classes — use repository pattern (see order.ts)
  - Don't return internal entity types from API operations — use DTOs

RECOMMENDED NEXT STEP
  When implementation is complete, run: /dr-sync --branch <your-branch>
  to update the model with the new elements.
```

---

## Mode 3: Implementation Critique

**Triggered when:** User shares existing code or a PR and wants to know if it matches the model.

**Goal:** Identify model drift, pattern violations, and traceability gaps. Always end with a concrete next step.

### Steps to Follow

**1. Identify Corresponding Model Elements**

```bash
dr search --source-file <changed-file>
dr search "<class/function name from code>"
```

For each significant class or module in the code, find the matching model element (if any).

**2. Check for Model Drift**

- New classes with no model element? → Flag as "untracked element"
- Renamed classes that don't match element IDs? → Flag as "naming drift"
- Deleted classes still in the model? → Flag as "ghost element"
- New endpoints not in the API layer? → Flag as "undocumented API operation"

**3. Check Pattern Compliance**
For each identified model element, verify:

- Does the code class name match the element naming convention?
- Are layer boundaries respected? (e.g., no direct DB calls from API route handlers)
- Are cross-layer references implemented correctly? (e.g., does the service actually call what the model says it depends on?)
- Is there a corresponding test case in the testing layer?

**4. Check Traceability Quality**

- Does each new/changed service trace back to a business service in the model?
- Is there APM instrumentation for the implementation?
- Are cross-layer references present in the code (not just in the model)?

### Output Format

```
Implementation Critique: [Feature/PR Name]
============================================

MODEL DRIFT
  ⚠️ Untracked: PaymentProcessorService (src/services/payment-processor.ts)
     → No model element for this class. Add it with /dr-model or /dr-sync
  ✓ Tracked: OrderService matches application.service.order-service
  ⚠️ Ghost: application.service.legacy-billing still in model (billing.ts was deleted)
     → Remove with: dr delete application.service.legacy-billing

PATTERN COMPLIANCE
  ✓ OrderService: follows service pattern (single responsibility, repository injection)
  ⚠️ PaymentController: directly queries DB without going through service layer
     → This violates the application/data-store layer boundary
  ✓ API operations: all route handlers delegate to services (no logic in routes)

TRACEABILITY
  ✓ OrderService → realizes → business.service.order-management
  ⚠️ PaymentProcessorService → no business service reference
  ⚠️ POST /api/v1/payments → not in model (undocumented API operation)
  ✓ APM spans present in order-service.ts (opentelemetry instrumentation found)

VERDICT
  [Pass / Pass with warnings / Needs fixes before merge]

RECOMMENDED NEXT STEP
  Run /dr-sync to update the model to match this implementation:
    - Add application.service.payment-processor
    - Add api.operation.create-payment
    - Remove application.service.legacy-billing
    - Link new elements to business services
  — or —
  Fix the layer boundary violation (PaymentController direct DB query) before merging.
```

---

## General Principles

**Advisory only.** Never run `dr add`, `dr update`, `dr delete`, or `dr changeset` commands directly in this skill. Always recommend the appropriate command for the user to run or delegate to dr-architect.

**Be specific.** Vague feedback like "this could be better" is not useful. Reference element IDs, file names, line numbers, and spec types.

**Be constructive.** Every issue identified should have a concrete remediation — a specific command to run or a specific code change to make.

**Prioritize actionability.** Don't overwhelm with every possible issue. Lead with the highest-impact concerns, then list lower-priority items.

**Close the loop.** Every mode ends with a "RECOMMENDED NEXT STEP" that tells the user exactly what to do next — whether it's `/dr-design`, `/dr-sync`, a specific code fix, or `/dr-changeset commit`.
