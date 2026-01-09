# Agent Abstraction Layer

The Agent Abstraction Layer provides a unified interface for integrating multiple coding agent CLIs (Claude Code, GitHub Copilot, etc.) with consistent availability checking, process spawning, and output parsing.

## Overview

This abstraction layer enables the DR CLI to support multiple AI coding assistants through a common interface, hiding implementation details while providing:

1. **Availability Detection** - Check if agent CLI is installed
2. **Process Spawning** - Launch agent with configuration
3. **Live Output Monitoring** - Parse streaming output in real-time
4. **Final Output Capture** - Accumulate complete response

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Chat Command                       │
│            (commands/chat.ts)                       │
└──────────────────┬──────────────────────────────────┘
                   │
                   │ uses
                   ▼
┌─────────────────────────────────────────────────────┐
│              CodingAgent Interface                   │
│  ┌────────────────────────────────────────────────┐ │
│  │ - isAvailable(): Promise<boolean>              │ │
│  │ - spawn(options): AgentProcess                 │ │
│  │ - parseOutput(chunk): ChatEvent[]              │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────┐    ┌──────────────────┐
│ ClaudeCode   │    │ GitHub Copilot   │
│    Agent     │    │     Agent        │
│              │    │  (Phase 2)       │
└──────────────┘    └──────────────────┘
```

## Core Types

### CodingAgent

The main interface all agent implementations must satisfy:

```typescript
interface CodingAgent {
  readonly name: string;          // Human-readable name
  readonly command: string;        // CLI command
  
  isAvailable(): Promise<boolean>;
  spawn(options: SpawnAgentOptions): AgentProcess;
  parseOutput(chunk: string): ChatEvent[];
}
```

### AgentProcess

Wrapper for spawned subprocess:

```typescript
interface AgentProcess {
  process: ChildProcess;           // Node.js child process
  conversationId: string;          // Unique identifier
  completion: Promise<AgentProcessResult>;  // Resolves on completion
}
```

### ChatEvent

Structured event from agent output:

```typescript
interface ChatEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'complete';
  content?: string;                // Text content
  toolName?: string;               // Tool being used
  toolInput?: any;                 // Tool input parameters
  toolResult?: any;                // Tool execution result
  error?: string;                  // Error message
}
```

## Using the Abstraction Layer

### 1. Check Availability

```typescript
import { ClaudeCodeAgent } from './ai/agents';

const agent = new ClaudeCodeAgent();
const available = await agent.isAvailable();

if (!available) {
  console.error('Agent not installed');
  process.exit(1);
}
```

### 2. Spawn Agent Process

```typescript
const agentProcess = agent.spawn({
  cwd: '/path/to/project',
  message: 'What layers are in this model?',
  agentName: 'dr-architect',  // Optional
  additionalArgs: ['--verbose'],  // Optional
});

console.log('Conversation ID:', agentProcess.conversationId);
```

### 3. Monitor Live Output

```typescript
agentProcess.process.stdout?.on('data', (data: Buffer) => {
  const chunk = data.toString();
  const events = agent.parseOutput(chunk);
  
  for (const event of events) {
    if (event.type === 'text') {
      process.stdout.write(event.content || '');
    } else if (event.type === 'tool_use') {
      console.log(`[Using tool: ${event.toolName}]`);
    }
  }
});
```

### 4. Wait for Completion

```typescript
const result = await agentProcess.completion;

console.log('Exit code:', result.exitCode);
console.log('Full response:', result.fullResponse);
console.log('Total events:', result.events.length);

if (result.error) {
  console.error('Error:', result.error);
}
```

## Implementing a New Agent

To add support for a new coding agent CLI:

### 1. Create Agent Class

```typescript
import { CodingAgent, AgentProcess, ChatEvent, SpawnAgentOptions } from './types';

export class MyCustomAgent implements CodingAgent {
  readonly name = 'My Custom Agent';
  readonly command = 'my-agent';
  
  async isAvailable(): Promise<boolean> {
    // Check if command exists in PATH
    // Should be fast (< 100ms)
    try {
      const result = spawnSync('which', [this.command], {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }
  
  spawn(options: SpawnAgentOptions): AgentProcess {
    // Build command arguments
    const args = [/* ... */];
    
    // Spawn subprocess
    const proc = spawn(this.command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    // Send initial message
    proc.stdin.write(options.message);
    proc.stdin.end();
    
    // Return process wrapper
    return {
      process: proc,
      conversationId: `myagent-${Date.now()}`,
      completion: this.monitorProcess(proc),
    };
  }
  
  parseOutput(chunk: string): ChatEvent[] {
    // Parse agent-specific output format
    // Return structured ChatEvent array
    const events: ChatEvent[] = [];
    
    // Example: plain text line by line
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        events.push({
          type: 'text',
          content: line,
        });
      }
    }
    
    return events;
  }
  
  private monitorProcess(proc: ChildProcess): Promise<AgentProcessResult> {
    // Set up stdout/stderr monitoring
    // Accumulate results
    // Return promise that resolves on completion
  }
}
```

### 2. Export from Index

```typescript
// src/ai/agents/index.ts
export { MyCustomAgent } from './my-custom-agent.js';
```

### 3. Add Tests

Create comprehensive tests in `tests/unit/ai/my-custom-agent.test.ts`:

- Agent properties and interface compliance
- Availability detection
- Output parsing for all event types
- Process spawning and configuration
- Error handling
- Integration scenarios

### 4. Update Chat Command

Modify `commands/chat.ts` to detect and use your agent:

```typescript
// Detect available agents
const agents = [
  new ClaudeCodeAgent(),
  new MyCustomAgent(),
];

let selectedAgent: CodingAgent | undefined;
for (const agent of agents) {
  if (await agent.isAvailable()) {
    selectedAgent = agent;
    break;
  }
}

if (!selectedAgent) {
  console.error('No coding agent available');
  process.exit(1);
}
```

## Agent Implementations

### ClaudeCodeAgent

**Command:** `claude`  
**Output Format:** Line-delimited JSON (`--output-format stream-json`)  
**Features:**
- Uses `dr-architect` agent by default
- Supports tool use events
- Parses structured JSON events

**Example Event:**
```json
{
  "type": "assistant",
  "message": {
    "content": [
      {"type": "text", "text": "Response text"},
      {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}
    ]
  }
}
```

### GitHubCopilotAgent (Planned)

**Command:** `gh copilot` or `@github/copilot`  
**Output Format:** Plain text/markdown  
**Features:**
- Session-based context
- `--continue` flag for conversation
- Plain text output parsing

## Testing

### Unit Tests

Test individual agent implementations:

```bash
bun test tests/unit/ai/agent-interface.test.ts
bun test tests/unit/ai/claude-code-agent.test.ts
```

### Integration Tests

Test end-to-end scenarios:

```bash
bun test tests/integration/agent-abstraction.test.ts
```

### Test Coverage

Current coverage: **79 tests passing**

- Interface contracts (20 tests)
- ClaudeCodeAgent implementation (33 tests)
- Integration scenarios (26 tests)

## Design Principles

1. **Interface Segregation** - Clean separation between interface and implementation
2. **Polymorphism** - All agents usable through common `CodingAgent` interface
3. **Extensibility** - Easy to add new agents without modifying existing code
4. **Testability** - Comprehensive test coverage for all components
5. **Error Resilience** - Graceful handling of malformed output and process errors

## Future Enhancements

1. **Agent Auto-Detection** - Detect and select available agents automatically
2. **Preference Storage** - Save user's preferred agent in manifest
3. **Parallel Agents** - Support multiple agents simultaneously
4. **Agent Capabilities** - Query agent for supported features
5. **Streaming API** - Unified streaming interface across all agents

## Related Files

- `src/ai/agents/types.ts` - Core types and interfaces
- `src/ai/agents/claude-code.ts` - Claude Code implementation
- `src/ai/agents/index.ts` - Public API exports
- `tests/unit/ai/` - Unit tests
- `tests/integration/agent-abstraction.test.ts` - Integration tests
- `src/commands/chat.ts` - Chat command using agents

## References

- Claude Code CLI: https://claude.ai
- GitHub Copilot CLI: https://github.com/github/copilot-cli
- Node.js Child Process: https://nodejs.org/api/child_process.html
