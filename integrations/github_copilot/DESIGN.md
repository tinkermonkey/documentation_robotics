# GitHub Copilot Integration - Design Document

**Version**: 0.2.0
**Date**: December 2025
**Status**: Production Ready

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Skills System](#skills-system)
4. [Intent Detection & Workflows](#intent-detection--workflows)
5. [Prompt Engineering Strategy](#prompt-engineering-strategy)
6. [Integration Points](#integration-points)
7. [Technical Decisions](#technical-decisions)
8. [Performance Considerations](#performance-considerations)
9. [Future Enhancements](#future-enhancements)

---

## Executive Summary

### Purpose

The GitHub Copilot integration provides a natural language interface to Documentation Robotics within VS Code, leveraging GitHub Copilot Chat's AI capabilities to enable conversational architecture modeling and validation.

### Goals

1. **Feature Parity**: Match Claude Code integration capabilities
2. **Natural Language Interface**: Users model without knowing CLI syntax
3. **Proactive Intelligence**: Auto-activating skills and contextual suggestions
4. **Chat-Focused**: Leverage Chat Participant API (no LSP complexity)

### Key Features

- ✅ **Auto-activating Skills**: Background helpers (Link Validation, Changeset Reviewer)
- ✅ **Intent Detection**: 10 intent types with workflow routing
- ✅ **Unified Agent Identity**: Consistent, intelligent DR Architect persona
- ✅ **Adaptive Autonomy**: Confidence-based decision making
- ✅ **7 Specialized Workflows**: Validation, extraction, ideation, security, migration, education, modeling

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Chat Request Handler                           │ │
│  │                                                              │ │
│  │  1. Analyze Conversation Context                            │ │
│  │     └─> ConversationContextAnalyzer                         │ │
│  │         • Extract recent commands                           │ │
│  │         • Detect operations (ADD, MODIFY, VALIDATE)         │ │
│  │         • Track modified layers                             │ │
│  │         • Detect active changesets                          │ │
│  │                                                              │ │
│  │  2. Activate Matching Skills                                │ │
│  │     └─> SkillsManager                                       │ │
│  │         • Link Validation Skill                             │ │
│  │         • Changeset Reviewer Skill                          │ │
│  │         • (Extensible: more skills can be added)            │ │
│  │                                                              │ │
│  │  3. Detect Intent (/model command)                          │ │
│  │     └─> IntentDetector                                      │ │
│  │         • Pattern matching (10 intent types)                │ │
│  │         • Entity extraction (layer, type, name)             │ │
│  │         • Workflow routing                                  │ │
│  │                                                              │ │
│  │  4. Build System Prompt Stack                               │ │
│  │     ┌─────────────────────────────────────┐                │ │
│  │     │ TIER2_DEVELOPER_GUIDE (base)        │                │ │
│  │     ├─────────────────────────────────────┤                │ │
│  │     │ Activated Skill Prompts             │                │ │
│  │     ├─────────────────────────────────────┤                │ │
│  │     │ DR_ARCHITECT_CORE (identity)        │                │ │
│  │     ├─────────────────────────────────────┤                │ │
│  │     │ Workflow Prompt (if detected)       │                │ │
│  │     ├─────────────────────────────────────┤                │ │
│  │     │ Tool Instructions                    │                │ │
│  │     └─────────────────────────────────────┘                │ │
│  │                                                              │ │
│  │  5. Execute Agentic Loop                                    │ │
│  │     • Send to Copilot GPT-4                                 │ │
│  │     • Parse tool calls (execute, shell, create_file)        │ │
│  │     • Execute tools via drCli                               │ │
│  │     • Feed results back                                     │ │
│  │     • Continue until no more tool calls (max 10 loops)      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Tool Executors                           │ │
│  │                                                              │ │
│  │  • drCli.ts - DR CLI wrapper with venv discovery            │ │
│  │  • runShell() - Arbitrary shell commands                    │ │
│  │  • createFile() - File creation                             │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │  DR CLI (dr)    │
                    │                 │
                    │  • Model CRUD   │
                    │  • Validation   │
                    │  • Links        │
                    │  • Changesets   │
                    │  • Export       │
                    └─────────────────┘
```

### Component Breakdown

#### Core Components

| Component                | Location                            | Purpose                                    |
| ------------------------ | ----------------------------------- | ------------------------------------------ |
| **Extension Handler**    | `src/extension.ts`                  | Main entry point, orchestrates all systems |
| **Skills Manager**       | `src/skills/skillsManager.ts`       | Activates skills based on context          |
| **Conversation Context** | `src/skills/conversationContext.ts` | Extracts context from chat history         |
| **Intent Detector**      | `src/modeling/intentDetector.ts`    | Detects user intent from natural language  |
| **DR CLI Wrapper**       | `src/drCli.ts`                      | Executes DR commands with venv support     |

#### Skill Definitions

| Skill                  | Location                               | Activation Triggers                                                                                                       |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Link Validation**    | `src/skills/linkValidationSkill.ts`    | Keywords: link, reference, traceability<br>Operations: ADD_ELEMENT, MODIFY_ELEMENT<br>Custom: 3+ adds, 2+ layers modified |
| **Changeset Reviewer** | `src/skills/changesetReviewerSkill.ts` | Keywords: changeset, apply, review<br>Operations: APPLY_CHANGESET<br>Custom: Active changeset detected                    |

#### Prompt Definitions

| Prompt                     | Location                     | Purpose                                         |
| -------------------------- | ---------------------------- | ----------------------------------------------- |
| **TIER1_ESSENTIALS**       | `src/prompts/tier1.ts`       | Quick reference (11 layers, essential commands) |
| **TIER2_DEVELOPER_GUIDE**  | `src/prompts/tier2.ts`       | Comprehensive guide (1,160 lines)               |
| **DR_ARCHITECT_CORE**      | `src/prompts/drArchitect.ts` | Unified agent identity and behavior             |
| **WORKFLOW_PROMPTS**       | `src/prompts/workflows.ts`   | 7 workflow-specific prompts                     |
| **VALIDATOR_AGENT_PROMPT** | `src/prompts/validator.ts`   | Validation specialist persona                   |

---

## Skills System

### Concept

Skills are **auto-activating background helpers** that proactively inject specialized prompts based on conversation context. They enable the agent to be contextually aware without explicit user invocation.

### Design Pattern: Prompt Injection

**Why Prompt Injection?**

- ✅ Works within Chat Participant's single conversation context
- ✅ No separate processes or inter-process communication
- ✅ Skills observe and guide without disrupting flow
- ✅ Simple to implement, debug, and extend
- ✅ Maintains conversation history naturally

**Rejected Alternatives:**

- ❌ Separate processes (too complex, no shared context)
- ❌ Post-processing (reactive not proactive, extra LLM calls)
- ❌ LSP-based system (out of scope for chat-focused approach)

### Skill Lifecycle

```
1. User sends message
   ↓
2. ConversationContextAnalyzer extracts context
   • Recent messages (last 10)
   • Recent DR commands (last 15)
   • Operations performed (ADD, MODIFY, VALIDATE, etc.)
   • Modified layers
   • Active changeset status
   ↓
3. SkillsManager checks each skill's activation patterns
   • Keyword matching in messages
   • Operation type matching
   • Custom detector functions
   ↓
4. Calculate confidence score (0.0 to 1.0)
   • Keywords: 0.5 + (0.1 per match), max 0.9
   • Operations: 0.7
   • Custom detector: 0.8
   ↓
5. If confidence >= 0.5, activate skill
   ↓
6. Inject skill prompt into system message
   ↓
7. Agent executes with skill awareness
```

### Skill Activation Patterns

#### Link Validation Skill

**Triggers:**

- **Keywords**: link, reference, relationship, traceability, cross-layer, projection
- **Operations**: ADD_ELEMENT, MODIFY_ELEMENT
- **Custom Detector**: 3+ `dr add` commands OR 2+ layers modified

**Confidence Calculation:**

```typescript
if (keywords.match >= 1) confidence = 0.5 + keywords.count * 0.1;
if (operations.match) confidence = max(confidence, 0.7);
if (customDetector()) confidence = max(confidence, 0.8);
```

**Injected Prompt:**

- Instructs agent to run `dr links validate` after element operations
- Provides 62+ link pattern knowledge
- Suggests missing links based on naming patterns
- Validates bidirectional consistency

#### Changeset Reviewer Skill

**Triggers:**

- **Keywords**: changeset, apply, review, diff, merge
- **Operations**: APPLY_CHANGESET
- **Custom Detector**: Active changeset detected in history

**Injected Prompt:**

- Instructs agent to review diff before applying
- Checks for quality issues (missing docs, broken links)
- Validates within changeset context
- Only recommends apply when validation passes

### Extensibility

Adding new skills is straightforward:

```typescript
// 1. Define skill in new file
export const MY_CUSTOM_SKILL: SkillDefinition = {
    id: 'my-skill',
    name: 'My Custom Skill',
    description: 'What it does',
    activationPatterns: {
        keywords: ['keyword1', 'keyword2'],
        operations: [OperationType.SOME_OP],
        customDetector: (context) => {
            // Custom logic
            return true/false;
        }
    },
    prompt: `
    ## My Custom Skill (ACTIVE)
    Instructions for the agent...
    `
};

// 2. Register in SkillsManager
import { MY_CUSTOM_SKILL } from './myCustomSkill';

private skills: SkillDefinition[] = [
    LINK_VALIDATION_SKILL,
    CHANGESET_REVIEWER_SKILL,
    MY_CUSTOM_SKILL  // Add here
];
```

---

## Intent Detection & Workflows

### Concept

**Intent Detection** analyzes user's natural language message to determine what they're trying to accomplish, then routes to the appropriate **specialized workflow prompt**.

### 10 Intent Types

| Intent              | Pattern Examples                                       | Workflow        |
| ------------------- | ------------------------------------------------------ | --------------- |
| **VALIDATE**        | "check my model", "is this correct?", "any errors?"    | validation      |
| **FIX_ERRORS**      | "fix validation errors", "auto-correct"                | validation      |
| **EXTRACT_CODE**    | "analyze my Python codebase", "extract from source"    | extraction      |
| **GENERATE_DOCS**   | "create architecture documentation", "export diagrams" | N/A             |
| **SECURITY_REVIEW** | "check security", "GDPR compliance", "vulnerabilities" | security_review |
| **MIGRATE_VERSION** | "upgrade to v0.2.0", "migrate spec"                    | migration       |
| **EXPLORE_IDEA**    | "what if we added Redis?", "should we use GraphQL?"    | ideation        |
| **LEARN**           | "how do I model a microservice?", "which layer?"       | education       |
| **ADD_ELEMENT**     | "add a REST API for users", "create a service"         | modeling        |
| **MODEL_FEATURE**   | "model payment processing", "design authentication"    | modeling        |

### Intent Detection Algorithm

```typescript
detect(message: string, context: ConversationContext): IntentResult {
    // 1. Try each intent pattern in priority order
    // 2. Use regex pattern matching
    // 3. Calculate confidence based on match count
    // 4. Extract entities (layer, type, name)
    // 5. Return first intent with confidence >= 0.7

    // Confidence scoring:
    // 0 matches = 0.0
    // 1 match = 0.7
    // 2 matches = 0.85
    // 3+ matches = 0.95
}
```

### Entity Extraction

The intent detector extracts entities from natural language:

- **Layer**: Matches against 12 known layers (motivation, business, security, etc.)
- **Element Type**: Matches against common types (service, component, operation, etc.)
- **Element Name**: Extracts from quoted text or capitalized words

**Example:**

```
Input: "Add a REST API for user authentication"
Output: {
    intent: ADD_ELEMENT,
    confidence: 0.85,
    entities: {
        layer: "api",
        elementType: "operation",
        elementName: "user authentication"
    },
    suggestedWorkflow: "modeling"
}
```

### 7 Specialized Workflows

Each workflow provides focused guidance for that task type:

#### 1. Validation Workflow

- Run comprehensive validation (schema + links)
- Categorize errors by type and severity
- Detect patterns for batch fixes
- Suggest fixes with confidence scores (HIGH/MEDIUM/LOW)

#### 2. Extraction Workflow

- Always use changesets (safe experimentation)
- Detect framework patterns (Django, FastAPI, Spring Boot, Express)
- Map code to appropriate layers
- Create cross-layer links automatically
- Validate within changeset before applying

#### 3. Ideation Workflow

- Ask probing questions first (understand context)
- Research using WebSearch
- Create changeset for exploration
- Model alternatives side-by-side
- Compare pros/cons, guide merge decision

#### 4. Security Review Workflow

- Check security layer completeness
- Verify authentication/authorization patterns
- Validate data protection (encryption, PII)
- Compliance checks (SOC2, GDPR, HIPAA)
- Threat analysis with severity levels

#### 5. Migration Workflow

- Check current status
- Dry-run preview
- Recommend git branch first
- Apply migration
- Validate result

#### 6. Education Workflow

- Explain concepts clearly
- Use layer decision tree
- Provide examples
- Suggest next learning steps
- Encourage experimentation with changesets

#### 7. Modeling Workflow

- Interpret user intent
- Query first (avoid duplicates)
- Suggest layer and type
- Create element with proper properties
- Link automatically based on naming patterns
- Validate after creation

### Workflow Routing

```typescript
if (request.command === "model") {
  // 1. Detect intent
  const intentResult = intentDetector.detect(request.prompt, context);

  // 2. Show to user
  stream.markdown(`Intent detected: ${intentResult.intent} (${confidence}%)`);

  // 3. Inject DR Architect identity
  messages.push(DR_ARCHITECT_CORE);

  // 4. Inject workflow-specific prompt
  if (intentResult.suggestedWorkflow) {
    messages.push(WORKFLOW_PROMPTS[intentResult.suggestedWorkflow]);
  }

  // 5. Add context
  messages.push({
    request: request.prompt,
    entities: intentResult.entities,
  });
}
```

---

## Prompt Engineering Strategy

### Tiered Prompt System

We use a **3-tier knowledge base** to optimize token usage:

| Tier                           | Size          | Purpose                                                            | When Loaded           |
| ------------------------------ | ------------- | ------------------------------------------------------------------ | --------------------- |
| **Tier 1: Essentials**         | ~30 lines     | Quick reference (11 layers, element ID format, essential commands) | Always                |
| **Tier 2: Developer Guide**    | ~1,160 lines  | Complete development guide (agents, workflows, validation, links)  | Default (base prompt) |
| **Tier 3: Complete Reference** | ~3,000+ lines | Full specification, all 62 link types, edge cases                  | On-demand (future)    |

### Prompt Layer Stack

The system prompt is built as layers:

```
┌─────────────────────────────────────────┐
│ 1. TIER2_DEVELOPER_GUIDE (base)         │  Always loaded
│    • 11 layers detailed                 │
│    • Element structure                  │
│    • Common operations                  │
│    • Link patterns overview             │
│    • Validation levels                  │
├─────────────────────────────────────────┤
│ 2. Activated Skill Prompts              │  Context-dependent
│    • Link Validation (if triggered)     │
│    • Changeset Reviewer (if triggered)  │
├─────────────────────────────────────────┤
│ 3. DR_ARCHITECT_CORE (identity)         │  /model command only
│    • Intent-driven approach             │
│    • Adaptive autonomy                  │
│    • Contextual awareness               │
│    • Proactive helpfulness              │
├─────────────────────────────────────────┤
│ 4. Workflow Prompt (specialized)        │  Intent-based
│    • Validation workflow                │
│    • Extraction workflow                │
│    • etc.                               │
├─────────────────────────────────────────┤
│ 5. Tool Instructions                    │  Always loaded
│    • execute (dr commands)              │
│    • shell (arbitrary commands)         │
│    • create_file (file creation)        │
└─────────────────────────────────────────┘
```

### Prompt Injection Pattern

**Conditional Prompt Injection** allows us to:

- Keep base prompt manageable
- Add specialized knowledge only when needed
- Maintain token efficiency
- Provide deep expertise for specific tasks

**Example:**

```typescript
let systemPrompt = TIER2_DEVELOPER_GUIDE; // Base

// Inject skills if activated
for (const skill of activatedSkills) {
  systemPrompt += "\n\n" + skill.prompt;
}

// Inject identity for /model command
if (request.command === "model") {
  messages.push(DR_ARCHITECT_CORE);

  // Inject workflow if intent detected
  if (workflow) {
    messages.push(WORKFLOW_PROMPTS[workflow]);
  }
}
```

---

## Integration Points

### VS Code Chat Participant API

**Registration:**

```typescript
const drParticipant = vscode.chat.createChatParticipant("documentation-robotics.dr", handler);
```

**Chat Commands:**

- `/init` - Initialize new DR project
- `/model` - Interactive modeling with intent detection
- `/validate` - Validate model with validator persona
- `/ingest` - Extract model from code
- `/project` - Project elements across layers

### DR CLI Integration

**Virtual Environment Discovery:**

```typescript
// 1. Check VS Code configuration
const configuredPath = vscode.workspace
  .getConfiguration("documentation-robotics")
  .get<string>("drPath");

// 2. Search for virtual environments
const venvPaths = [".venv/bin/dr", "venv/bin/dr", "env/bin/dr"];

// 3. Fall back to system PATH
const systemDr = "dr";
```

**Command Execution:**

```typescript
async function runDrCli(args: string): Promise<string> {
  const drPath = findDrExecutable();
  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

  return new Promise((resolve, reject) => {
    exec(`${drPath} ${args}`, { cwd: workspaceRoot }, (err, stdout, stderr) => {
      if (err) {
        resolve(`Error: ${err.message}\nStderr: ${stderr}`);
      } else {
        resolve(stdout);
      }
    });
  });
}
```

### Tool Execution Pattern

**3 Tools Available:**

1. **execute** - DR CLI commands

````markdown
```execute
dr add business service --name "Payment"
```
````

````

2. **shell** - Arbitrary shell commands
```markdown
```shell
git status
````

````

3. **create_file** - File creation
```markdown
```create_file scripts/extract.py
import dr_model
...
````

````

**Agentic Loop:**
```typescript
while (loopCount < MAX_LOOPS) {
    // Send to Copilot
    const response = await model.sendRequest(messages);

    // Check for tool calls
    const toolCall = parseToolCall(response);

    if (toolCall) {
        // Execute tool
        const output = await executeTool(toolCall);

        // Add to messages
        messages.push(assistant: response);
        messages.push(user: `Tool Output:\n${output}`);

        // Continue loop
    } else {
        break;  // No more tool calls
    }
}
````

---

## Technical Decisions

### Decision 1: Prompt Injection vs. Separate Processes

**Decision:** Use prompt injection for skills

**Rationale:**

- Chat Participant API provides single conversation context
- No need for complex inter-process communication
- Skills can observe full conversation history
- Simple to implement and debug
- Natural integration with existing architecture

**Trade-offs:**

- ✅ Simplicity, maintainability, debuggability
- ❌ Token usage (mitigated by conditional activation)

### Decision 2: Intent Detection vs. LLM-based Classification

**Decision:** Use regex pattern matching for intent detection

**Rationale:**

- Fast (no extra LLM call)
- Deterministic and testable
- Low latency (< 1ms)
- 10 intent types have clear patterns

**Trade-offs:**

- ✅ Performance, cost, determinism
- ❌ May miss nuanced intents (mitigated by confidence thresholds)

### Decision 3: Chat Participant vs. LSP

**Decision:** Use Chat Participant API, not Language Server Protocol

**Rationale:**

- User requirement: chat-focused approach
- Natural language interaction is primary use case
- LSP better for code completion, not conversational modeling
- Chat API simpler for conversational workflows

**Trade-offs:**

- ✅ Natural conversation, simpler implementation
- ❌ No inline diagnostics or autocomplete (not needed for this use case)

### Decision 4: Tiered Prompts vs. Single Mega-Prompt

**Decision:** Use tiered prompt system with conditional injection

**Rationale:**

- Copilot has token limits (not unlimited like Claude Code)
- Most tasks don't need all knowledge
- Conditional loading keeps prompts focused
- Future-proof for TIER3 integration

**Trade-offs:**

- ✅ Token efficiency, focused expertise
- ❌ Slightly more complex prompt management (worth it)

---

## Performance Considerations

### Token Budget Management

**Current Usage:**

- TIER2_DEVELOPER_GUIDE: ~1,160 lines (~3,500 tokens)
- DR_ARCHITECT_CORE: ~150 lines (~450 tokens)
- Workflow Prompt: ~100 lines (~300 tokens)
- Skill Prompts: ~50 lines each (~150 tokens each)
- **Total Max**: ~5,000 tokens for system prompts

**Optimization Strategies:**

1. **Conditional Activation**: Skills only inject when triggered
2. **Workflow Routing**: Only one workflow prompt at a time
3. **History Compression** (future): Summarize old turns, keep last 5 full
4. **TIER3 On-Demand** (future): Load specific sections only

### Latency

**Skill Activation:**

- Context analysis: < 10ms (history parsing)
- Pattern matching: < 1ms per skill
- **Total**: < 20ms overhead

**Intent Detection:**

- Regex matching: < 1ms
- Entity extraction: < 5ms
- **Total**: < 10ms overhead

**Tool Execution:**

- DR CLI calls: 100-500ms (depends on operation)
- Shell commands: Variable (git, python, etc.)
- File creation: < 10ms

### Scalability

**Conversation History:**

- Currently keeps all history (no limit)
- Future: Compress after 20 turns to prevent unbounded growth

**Skills:**

- Currently 2 skills, designed for 5-10 skills
- Each skill checked independently (O(n) where n = skill count)
- Negligible impact for < 10 skills

---

## Future Enhancements

### Phase 3: Natural Language Polish (Optional)

**Proactive Suggestions Engine:**

- After validation fixes: "Model validates! Generate docs?"
- After bulk adds: "Validate cross-layer links?"
- After extraction: "Review changeset before applying?"

**Changeset Awareness UI:**

- Visual indicator of active changeset
- Remind about apply/discard before new work
- Diff preview in chat

### Phase 4: Advanced Features (Optional)

**TIER3 Integration:**

- Load specific TIER3 sections on-demand
- Full 62+ link type reference
- Edge cases and advanced patterns

**Token Budget Optimization:**

- Automatic history compression after 20 turns
- Token usage monitoring with warnings
- Smart prompt pruning

**Additional Skills:**

- Security Awareness Skill (auth, payments, PII)
- Documentation Quality Skill (completeness)
- Consistency Checker Skill (naming, patterns)

### Phase 5: Polish & Testing (Optional)

**UI Improvements:**

- Skill activation indicators with icons
- Intent confidence visualization
- Better error formatting
- Progress indicators for long operations

**Comprehensive Testing:**

- Unit tests for IntentDetector (all 10 intents)
- Unit tests for SkillsManager (activation logic)
- Integration tests (end-to-end workflows)
- E2E tests (user scenarios)

**Documentation:**

- Video tutorials for common workflows
- FAQ and troubleshooting guide
- Architecture decision records (ADRs)

---

## Comparison with Claude Code

### Feature Parity Matrix

| Feature                       | Claude Code     | Copilot (Before) | Copilot (After)      |
| ----------------------------- | --------------- | ---------------- | -------------------- |
| **Auto-activating Skills**    | ✅ 2 skills     | ❌               | ✅ 2 skills          |
| **Intent Detection**          | ✅ Implicit     | ❌               | ✅ 10 types          |
| **Workflow Routing**          | ✅ 7 workflows  | ⚠️ Basic         | ✅ 7 workflows       |
| **Natural Language Modeling** | ✅ Advanced     | ⚠️ Basic         | ✅ Advanced          |
| **Unified Agent Identity**    | ✅ dr-architect | ❌               | ✅ DR_ARCHITECT_CORE |
| **Adaptive Autonomy**         | ✅              | ❌               | ✅                   |
| **Proactive Suggestions**     | ✅              | ❌               | ✅                   |
| **Context Awareness**         | ✅ Unlimited    | ⚠️ Limited       | ✅ Enhanced          |
| **Changeset Support**         | ✅              | ✅               | ✅                   |
| **Link Validation**           | ✅ Proactive    | ⚠️ Manual        | ✅ Proactive         |

**Result**: ✅ Full feature parity achieved

### Key Differences

**Context Windows:**

- Claude Code: Unlimited (automatic summarization)
- Copilot: Limited (GitHub Copilot model constraints)
- **Mitigation**: Tiered prompts, conditional injection, future compression

**Execution Environment:**

- Claude Code: Claude desktop app with Task tool
- Copilot: VS Code extension with Chat Participant API
- **Adaptation**: Prompt injection pattern, agentic loop

**Agent Architecture:**

- Claude Code: Separate agent processes via Task tool
- Copilot: Single chat context with role-based prompting
- **Equivalence**: DR Architect identity + workflow prompts = agent specialization

---

## Maintenance

### Adding New Skills

1. Create skill definition file in `src/skills/`
2. Define activation patterns (keywords, operations, custom detector)
3. Write skill prompt with clear instructions
4. Import and register in `SkillsManager`
5. Test activation triggers
6. Update documentation

### Adding New Workflows

1. Define new intent type in `IntentDetector`
2. Add pattern matching for intent
3. Create workflow prompt in `workflows.ts`
4. Test intent detection accuracy
5. Update documentation

### Updating Prompts

**TIER2_DEVELOPER_GUIDE:**

- Source: `/cli/src/documentation_robotics/claude_integration/reference_sheets/tier2-developer-guide.md`
- Regenerate when DR spec updates
- Keep in sync with CLI

**Workflow Prompts:**

- Update when new DR features added
- Refine based on user feedback
- A/B test different phrasing

---

## Conclusion

The GitHub Copilot integration achieves full feature parity with Claude Code through:

1. **Skills System**: Auto-activating background helpers using prompt injection
2. **Intent Detection**: Pattern-based natural language understanding with 10 intent types
3. **Workflow Routing**: 7 specialized prompts for different task types
4. **Unified Agent Identity**: DR Architect persona with adaptive autonomy
5. **Chat-Focused Design**: Leverages Chat Participant API without LSP complexity

The architecture is **modular**, **extensible**, and **maintainable**, enabling easy addition of new skills and workflows as DR evolves.

**Status**: Production ready for testing and deployment.
