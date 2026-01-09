# Agent Abstraction Layer Examples

This directory contains example scripts demonstrating how to use the Agent Abstraction Layer.

## Prerequisites

Build the CLI before running examples:

```bash
cd cli
npm install
npm run build
```

## Examples

### agent-usage.js

Demonstrates the core features of the Agent Abstraction Layer:

- Creating an agent instance
- Checking agent availability
- Parsing agent output events
- Spawning agent processes (example code)

**Run:**
```bash
node examples/agent-usage.js
```

**Expected Output:**
```
=== Agent Abstraction Layer Example ===

Agent: Claude Code
Command: claude

Checking availability...
Available: true/false

=== Testing Output Parsing ===

Parsed 4 events:

Event 1:
  Type: text
  Content: I'll help you with that.

Event 2:
  Type: tool_use
  Tool: Bash
  Input: {"command":"dr list api"}

...
```

## Creating Your Own Examples

To create an example using the abstraction layer:

```javascript
import { ClaudeCodeAgent } from '../dist/ai/agents/index.js';

const agent = new ClaudeCodeAgent();

// Check availability
if (await agent.isAvailable()) {
  // Spawn and interact with agent
  const proc = agent.spawn({
    cwd: process.cwd(),
    message: 'Your message here',
  });
  
  // Process events...
}
```

## See Also

- [Agent Abstraction Documentation](../docs/AGENT_ABSTRACTION.md)
- [Unit Tests](../tests/unit/ai/)
- [Integration Tests](../tests/integration/agent-abstraction.test.ts)
