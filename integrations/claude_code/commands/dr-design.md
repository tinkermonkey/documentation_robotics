---
description: Design model changes for a proposed feature, with reasoning annotations per element
argument-hint: '"<feature description>"'
---

# Design Model Changes for a Proposed Feature

Given a natural language description of a proposed change, generate all implied model elements across affected layers — with reasoning for each decision. Output is a named changeset ready for review and refinement.

## What This Command Does

1. Parses the intent (new feature, refactor, compliance requirement, scaling change)
2. Identifies all layers that will have changes
3. Builds a complete impact map with a rationale per element
4. Creates a named changeset
5. Stages elements layer by layer with reasoning annotations
6. Presents the full design for review and offers refinements

## Usage

```
/dr-design "Add a real-time order tracking feature"
/dr-design "Migrate checkout domain from monolith to microservices"
/dr-design "Add SOC2 compliance controls to the payment flow"
/dr-design "Introduce a recommendation engine for the product catalog"
```

## How This Differs from `/dr-changeset`

`/dr-changeset` manages the lifecycle of changes you already know you want to make.

`/dr-design` **figures out what changes to make** from a high-level intent. You describe the goal; the command determines the elements, layers, and relationships, then builds the changeset for you with full reasoning.

## Instructions for Claude Code

### Step 1: Validate Prerequisites

Check that a DR model exists:

```bash
ls -la documentation-robotics/model/manifest.yaml 2>/dev/null
```

If no model, prompt: "Initialize a model first with /dr-init, then extract your baseline with /dr-ingest."

### Step 2: Parse Intent

Classify the proposed change into one of these intent types:

| Intent Type               | Examples                                      | Typical Affected Layers                                 |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| **New feature**           | "Add order tracking", "Add notifications"     | motivation, application, api, data-model, security, apm |
| **Compliance**            | "SOC2 compliance", "GDPR controls", "PCI-DSS" | motivation, security, business, testing                 |
| **Infrastructure change** | "Move to Kubernetes", "Switch to Postgres"    | technology, data-store, apm                             |
| **Domain refactor**       | "Extract microservice", "Split monolith"      | business, application, api, technology                  |
| **UX/Product**            | "Add mobile app", "Redesign checkout flow"    | ux, navigation, api, application                        |
| **Observability**         | "Add distributed tracing", "SLO dashboards"   | apm, application, motivation                            |
| **Data change**           | "Add new entity", "Redesign data model"       | data-model, data-store, api, application                |

Ask a clarifying question if the intent type is ambiguous or the scope is very broad.

### Step 3: Examine the Existing Model

Before proposing new elements, understand what already exists:

```bash
# Check what's already in the model for relevant layers
dr list --layer application
dr list --layer api
dr list --layer motivation

# Look for related existing elements
dr search "<key terms from the feature description>"
```

This prevents proposing elements that already exist and enables proposing relationships to existing elements.

### Step 4: Build the Impact Map

For each affected layer, determine:

- What elements need to be added (and why)
- What existing elements need to be updated (and what changes)
- What cross-layer relationships to add (e.g., the new API operation exposes the new application service)

**Impact map ordering** (design from intent down to implementation):

1. Motivation — what goal/requirement drives this?
2. Business — what business capability does it add or change?
3. Security — what access controls, policies, or threats does it introduce?
4. Technology — what infrastructure, platforms, or frameworks does it require?
5. Application — what services or components implement it?
6. API — what endpoints expose it?
7. Data Model — what entities or schemas does it require?
8. Data Store — what tables or indexes does it need?
9. UX — what screens or components does the user interact with? (if applicable)
10. Navigation — what routing changes does it require? (if applicable)
11. APM — what metrics, spans, or alerts should track it?
12. Testing — what test cases should validate it?

Reason about each layer explicitly. It's acceptable to skip layers that are genuinely not affected — but provide a rationale.

### Step 5: Create a Named Changeset

```bash
dr changeset create design-<kebab-feature-name>
```

Example: `dr changeset create design-real-time-order-tracking`

### Step 6: Stage Elements with Reasoning Annotations

Stage each element in the prescribed layer order (motivation first, then down). For each staged element, include a rationale in the description:

```bash
dr changeset stage design-real-time-order-tracking add \
  --element-id motivation.goal.real-time-order-visibility \
  --layer motivation \
  --type goal \
  --description "Customers can see live order status updates without refreshing. Drives the new tracking feature." \
  --source-provenance "design: real-time order tracking feature"
```

Show each staged element to the user as it's created with its reasoning:

```
Staging motivation layer...

+ motivation.goal.real-time-order-visibility
  Reasoning: "Real-time tracking" implies a business goal for order transparency.
  This goal will drive the new business service and API operations.

Staging application layer...

+ application.service.order-tracking-service
  Reasoning: Real-time tracking requires a dedicated service to manage WebSocket
  connections or SSE streams. Separate from order-service to isolate concerns.

+ application.service.notification-dispatcher
  Reasoning: Tracking updates must be pushed to clients. A dispatcher service
  decouples the tracking logic from the delivery mechanism.

Staging api layer...

+ api.operation.get-order-tracking-status
  Reasoning: REST polling endpoint for clients that can't use WebSockets.
  Path: GET /api/v1/orders/{id}/tracking

+ api.operation.subscribe-order-updates
  Reasoning: WebSocket endpoint for real-time push. Consider SSE as alternative
  if WebSocket complexity is undesirable.

Staging data-model layer...

+ data-model.objectschema.order-tracking-event
  Reasoning: Need to store tracking state transitions (submitted → shipped → delivered).
  This schema captures each event with timestamp, actor, and orderId.
```

### Step 7: Show Complete Changeset Preview

After staging all elements, display the full changeset with reasoning:

```bash
dr changeset preview design-real-time-order-tracking
```

Show output in annotated format:

```
DESIGN PROPOSAL: Real-Time Order Tracking
==========================================
Changeset: design-real-time-order-tracking

MOTIVATION (1 element):
  + motivation.goal.real-time-order-visibility
    [Goal] Customers can see live order status without refreshing

BUSINESS (1 element):
  + business.service.order-tracking-capability
    [BusinessService] Business capability for real-time order visibility

SECURITY (1 element):
  + security.policy.order-tracking-access-control
    [AccessPolicy] Only authenticated customers can view their own orders

APPLICATION (2 elements):
  + application.service.order-tracking-service
    [ApplicationService] Manages tracking state and WebSocket/SSE connections
  + application.service.notification-dispatcher
    [ApplicationService] Pushes tracking updates to subscribed clients

API (2 elements):
  + api.operation.get-order-tracking-status
    [Operation] GET /api/v1/orders/{id}/tracking — polling endpoint
  + api.operation.subscribe-order-updates
    [Operation] WS /api/v1/orders/{id}/tracking/ws — push endpoint

DATA MODEL (1 element):
  + data-model.objectschema.order-tracking-event
    [ObjectSchema] Immutable event log: status, timestamp, actor, orderId

DATA STORE (1 element):
  + data-store.collection.order-tracking-events
    [Collection] Append-only event collection with index on orderId

APM (2 elements):
  + apm.span.order-tracking-update
    [Span] Traces each status transition through the tracking service
  + apm.metric.tracking-update-latency
    [Metric] P95 latency for pushing updates to clients — alert if >500ms

TESTING (2 elements):
  + testing.testcasesketch.order-tracking-status-transitions
    [TestCaseSketch] Validates all valid state machine transitions
  + testing.testcasesketch.concurrent-tracking-subscribers
    [TestCaseSketch] Load test: 1000 concurrent WebSocket connections

CROSS-LAYER REFERENCES:
  api.operation.get-order-tracking-status → exposes → application.service.order-tracking-service
  application.service.order-tracking-service → realizes → business.service.order-tracking-capability
  application.service.order-tracking-service → stores → data-store.collection.order-tracking-events

Total: 13 new elements across 9 layers

Options:
  [c] Commit this design (apply to model)
  [r] Refine — add more detail to a layer
  [s] Skip a layer (remove its elements)
  [+] Add an element I didn't include
  [e] Edit a specific element
  [d] Discard design
```

### Step 8: Offer Refinements

Based on user feedback, iterate:

**Refine a layer:** Re-examine that layer and add more granular elements

**Skip a layer:** Remove staged elements for that layer

**Add an element:** Prompt user to describe it, then stage it

**Edit an element:** Update the staged element's properties

**Change scope:** Broaden or narrow the design

### Step 9: Commit or Save for Later

If user is ready to commit:

```bash
dr changeset commit design-real-time-order-tracking
dr validate --strict
```

If user wants to save for later:

```
Design saved as changeset: design-real-time-order-tracking
  13 elements staged, not yet committed to the model

Resume with: /dr-changeset preview design-real-time-order-tracking
Commit when ready: dr changeset commit design-real-time-order-tracking
```

## Design Principles

**Be opinionated about layer coverage:** A feature that touches the API layer almost certainly needs APM instrumentation and test cases. Flag when these are missing and add them unless the user explicitly skips.

**Reference existing elements:** Always check what's in the model before adding. New API operations should expose existing (or newly staged) application services, not float independently.

**Reason explicitly:** Every staged element must have a rationale — not just "this is needed" but "this is needed because..."

**Suggest alternatives:** When there are multiple valid design choices (WebSocket vs. SSE, separate service vs. extending existing), note both options in the reasoning and ask which to proceed with.

**Size appropriately:** A small feature shouldn't produce 30 elements. A large compliance initiative might. Use judgment about what's architecturally significant vs. implementation detail.

## Example Interactions

### Example 1: New Feature

```
User: /dr-design "Add a notification service for order status updates"

You:
Analyzing intent: new feature — cross-cutting notification capability
Affected layers: motivation, business, application, api, security, apm, testing
Skipping: technology (no new infra), data-store (events stored in existing order table),
          ux (backend feature only), navigation (no routing changes)

Checking existing model...
  Found: application.service.order-service (will need to trigger notifications)
  Found: api.operation.create-order (existing — notification triggered on order creation)

Staging design...
[... staged elements with reasoning ...]

Design ready. 11 elements across 7 layers.
[Review prompt as shown above]
```

### Example 2: Compliance

```
User: /dr-design "Add SOC2 Type II controls for our payment processing flow"

You:
Analyzing intent: compliance — SOC2 Type II for payment domain
Affected layers: motivation (requirements), security (controls), business (process),
                 testing (audit evidence), apm (audit logging)

Checking existing model for payment elements...
  Found: application.service.payment-service
  Found: api.operation.create-payment
  Found: data-store.collection.payments

Staging SOC2 controls mapped to existing elements...
[... staged elements with reasoning ...]
```

## Related Commands

- `/dr-sync` — Update model from actual code changes after implementation
- `/dr-changeset` — Manage changeset lifecycle directly
- `/dr-model` — Add individual elements manually
- `/dr-advisor` — Get architectural advice before designing
