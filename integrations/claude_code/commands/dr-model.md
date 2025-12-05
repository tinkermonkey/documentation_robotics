---
description: Use natural language to add, update, or query architecture model elements across all 11 layers
argument-hint: "<natural language request>"
---

# Interactive Architecture Modeling

Use natural language to add, update, or query architecture model elements.

## What This Command Does

Interprets natural language requests to perform modeling operations:

- Add new elements to any layer
- Update existing elements
- Query and search for elements
- Create cross-layer projections
- Establish traceability links
- Add security and monitoring

## Usage

```
/dr-model <natural language request>
```

## Instructions for Claude Code

When the user runs this command, interpret their intent and execute the appropriate DR CLI commands. Always:

1. **Parse the Intent**: Understand what the user wants to do
2. **Query Context**: Check existing model elements when relevant
3. **Propose Changes**: Show what you plan to do before executing
4. **Execute Commands**: Run the appropriate `dr` commands
5. **Validate**: Check that changes are valid
6. **Suggest Related Actions**: Recommend complementary operations

### Supported Operations

#### 1. Add New Elements

**User intent patterns:**

- "Add a [service/component/etc] called [name]"
- "Create a [type] named [name] in [layer]"
- "Model a [description]"

**Your process:**

1. Identify the layer and type
2. Extract name and properties from description
3. Query similar existing elements (avoid duplicates)
4. Build the `dr add` command
5. Show the command you'll run
6. Execute and confirm
7. Suggest related actions (projection, security, monitoring)

**Example:**

```
User: /dr-model Add a payment service that handles credit card processing

You should:
1. Identify: business layer, service type
2. Check for existing payment services:
   dr search "payment" --layer business
3. Propose:
   "I'll create a business service for payment processing with these details:
   - Name: Payment Processing
   - Layer: business
   - Type: service
   - Description: Handles credit card transactions
   - Properties: criticality=high (financial service)

   Command: dr add business service --name \"Payment Processing\" \
     --description \"Handles credit card transactions\" \
     --property criticality=high"

4. Get confirmation (or proceed if obvious)
5. Execute:
   dr add business service --name "Payment Processing" \
     --description "Handles credit card transactions\" \
     --property criticality=high
6. Validate:
   dr validate --layer business
7. Suggest next steps:
   "✓ Payment service created: business.service.payment-processing

   Recommended next steps:
   - Project to application layer: /dr-model Create app service for payment processing
   - Add security: /dr-model Add PCI-DSS compliance for payment service
   - Add monitoring: /dr-model Add availability metric for payment service"
```

#### 2. Add with Cross-Layer References

**User intent patterns:**

- "Add [element] that supports [goal]"
- "Create [element] that realizes [business service]"
- "Add [element] secured by [policy]"

**Your process:**

1. Parse the element to create and the reference
2. Verify the referenced element exists
3. Create element with proper references in properties

**Example:**

```
User: /dr-model Add order management service that supports the customer satisfaction goal

You should:
1. Check goal exists:
   dr search "customer satisfaction" --layer motivation
2. If found (e.g., motivation.goal.customer-satisfaction):
   dr add business service --name "Order Management" \
     --description "Manages customer orders lifecycle" \
     --property supports-goals=motivation.goal.customer-satisfaction
3. If not found, ask:
   "I couldn't find a 'customer satisfaction' goal. Would you like me to:
   1. Create the goal first
   2. List existing goals to choose from
   3. Create the service without goal reference"
```

#### 3. Project Across Layers

**User intent patterns:**

- "Project [element] to [layer]"
- "Create application service from [business service]"
- "Generate API for [application service]"

**Your process:**

1. Verify source element exists
2. Check projection rules
3. Use `dr project` or manual creation
4. Validate cross-layer references

**Example:**

```
User: /dr-model Create application service for payment processing

You should:
1. Find business service:
   dr search "payment" --layer business
2. If found, project:
   dr project business.service.payment-processing --to application
3. Verify creation:
   dr find application.service.payment-processing
4. Suggest:
   "✓ Application service created and linked to business service

   Next steps:
   - Add security policy: /dr-model Add OAuth2 authentication for payment API
   - Add monitoring: /dr-model Add latency and error rate metrics
   - Define API endpoints: /dr-model Create REST API for payment operations"
```

#### 4. Add Security Controls

**User intent patterns:**

- "Add authentication for [element]"
- "Secure [element] with [scheme/policy]"
- "Add [compliance standard] to [element]"

**Your process:**

1. Identify the element to secure
2. Create appropriate security control
3. Link via `securedBy` property

**Example:**

```
User: /dr-model Add PCI-DSS compliance for payment service

You should:
1. Find payment service:
   dr find application.service.payment-processing
2. Create security policy:
   dr add security policy --name "PCI-DSS Compliance" \
     --description "Payment Card Industry Data Security Standard" \
     --property type=compliance \
     --property applies_to=application.service.payment-processing
3. Update service to reference policy:
   dr update application.service.payment-processing \
     --property securedBy=security.policy.pci-dss-compliance
4. Validate:
   dr validate --layer security
```

#### 5. Add Monitoring

**User intent patterns:**

- "Add monitoring for [element]"
- "Create [metric type] metric for [element]"
- "Monitor [element] availability/latency/errors"

**Your process:**

1. Identify element and metric type
2. Create APM metric
3. Link via `instrumentedBy` property

**Example:**

```
User: /dr-model Add availability and latency metrics for payment API

You should:
1. Find element:
   dr find application.service.payment-api
2. Create availability metric:
   dr add apm metric --name "payment-api-availability" \
     --description "Payment API availability SLI" \
     --property type=availability \
     --property instruments=application.service.payment-api \
     --property threshold=99.9%
3. Create latency metric:
   dr add apm metric --name "payment-api-latency" \
     --description "Payment API P95 latency" \
     --property type=latency \
     --property aggregation=p95 \
     --property instruments=application.service.payment-api \
     --property threshold=200ms
4. Validate and report
```

#### 6. Query and Search

**User intent patterns:**

- "Show me [elements]"
- "List all [type] in [layer]"
- "Find [element name]"
- "What [elements] support [goal]?"

**Your process:**

1. Build appropriate search/query
2. Display results in readable format
3. Offer to take action on results

**Example:**

```
User: /dr-model Show me all critical services

You should:
1. Search:
   dr search --property criticality=critical --output json
2. Parse and display:
   "Found 3 critical services:

   Business Layer:
   - Payment Processing (business.service.payment-processing)
   - Order Management (business.service.order-management)

   Application Layer:
   - Payment API (application.service.payment-api)

   Would you like me to:
   - Check if all have security policies
   - Verify monitoring is configured
   - Show their dependencies"
```

#### 7. Update Existing Elements

**User intent patterns:**

- "Update [element] to [change]"
- "Change [element] [property] to [value]"
- "Mark [element] as [value]"

**Your process:**

1. Find the element
2. Determine what to update
3. Use `dr update` command
4. Validate changes

**Example:**

```
User: /dr-model Mark payment service as critical priority

You should:
1. Find service:
   dr search "payment" --layer business --type service
2. Update:
   dr update business.service.payment-processing \
     --property criticality=critical
3. Check implications:
   "✓ Updated business.service.payment-processing to critical

   Critical services should have:
   ✓ Security policy - checking...
   ✗ Monitoring - missing
   ✗ Backup strategy - missing

   Would you like me to add missing controls?"
```

### Best Practices

1. **Always Query First**: Check existing elements before creating new ones
2. **Be Specific**: Use exact element IDs when updating
3. **Validate After Changes**: Run validation to catch issues early
4. **Suggest Next Steps**: Help users complete related tasks
5. **Show Your Work**: Display commands before executing
6. **Handle Ambiguity**: Ask for clarification when intent is unclear
7. **Check Dependencies**: Verify referenced elements exist

### Handling Ambiguity

When the request is unclear, ask specific questions:

```
User: /dr-model Add a service

You should ask:
"I'd be happy to add a service! To help me create it correctly, could you tell me:
1. What layer? (business, application, or another layer?)
2. What should it be called?
3. What does it do? (brief description)
4. Any special properties? (criticality, owner, etc.)"
```

### Error Recovery

If a command fails:

1. **Explain the Error**: Translate technical errors to plain language
2. **Suggest Fixes**: Offer specific solutions
3. **Show Alternatives**: Provide other ways to achieve the goal

**Example:**

```
Error: Reference not found: motivation.goal.missing

You should:
"The goal 'motivation.goal.missing' doesn't exist in the model.

I can:
1. Create the goal first, then add your service
2. Show you existing goals to reference instead
3. Create the service without a goal reference (you can add it later)

Which would you prefer?"
```

### Complex Workflows

For complex requests, break into steps:

```
User: /dr-model Create a complete payment feature with business service, app service, API, security, and monitoring

You should:
"I'll create a complete payment feature with full traceability. Here's my plan:

1. Business Service
   - Create business.service.payment-processing
   - Link to revenue goals

2. Application Service
   - Project to application layer
   - Set criticality to high

3. API Layer
   - Create RESTful endpoints for payments
   - Define request/response schemas

4. Security
   - Add PCI-DSS compliance policy
   - Require OAuth2 authentication

5. Monitoring
   - Availability metric (99.9% SLO)
   - Latency metric (P95 < 200ms)
   - Error rate metric

6. Validate
   - Run strict validation
   - Check all references

Proceed with this plan? (I can adjust any step)"
```

## Example Interactions

### Example 1: Simple Addition

```
User: /dr-model Add inventory management business service

You: Creating business service for inventory management...

     dr add business service --name "Inventory Management" \
       --description "Manages product inventory and stock levels"

     ✓ Created: business.service.inventory-management

     Suggested next steps:
     - Project to application: /dr-model Create app service for inventory
     - Add monitoring: /dr-model Monitor inventory service availability
```

### Example 2: With Traceability

```
User: /dr-model Add checkout service that supports the improve conversion goal

You: I'll create a checkout service linked to the conversion goal.

     First, let me verify the goal exists...
     dr search "conversion" --layer motivation

     ✓ Found: motivation.goal.improve-conversion

     Creating service:
     dr add business service --name "Checkout Service" \
       --description "Handles customer checkout process" \
       --property supports-goals=motivation.goal.improve-conversion \
       --property criticality=high

     ✓ Created: business.service.checkout
     ✓ Linked to goal
     ✓ Validation passed
```

### Example 3: Query Then Act

```
User: /dr-model Show me services without security policies

You: Searching for unsecured services...

     dr search --layer application --type service --output json

     (analyzing results...)

     Found 2 services without security policies:
     1. application.service.notification-service
     2. application.service.reporting-service

     Should I add authentication policies to these services?
```

## Related Commands

- `/dr-init` - Initialize a new model
- `/dr-ingest` - Extract model from code
- `/dr-project` - Automated cross-layer projection
- `/dr-validate` - Validate model and check for issues
- `dr --help` - View all DR CLI commands
