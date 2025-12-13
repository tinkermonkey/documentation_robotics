# DrBot Orchestrator

> Claude-native intent routing for Documentation Robotics model interaction

## Overview

DrBot is a conversational AI assistant that enables natural language interaction with Documentation Robotics (DR) models. Unlike traditional keyword-matching chatbots, DrBot uses **Claude's reasoning capabilities** to understand user intent and decide which tools to invoke.

## Architecture

### Core Design Principle

**Claude is the router.** Instead of static keyword matching, DrBot delegates all decision-making to Claude, which has access to:

1. **DR CLI tools** for read operations (`dr list`, `dr find`, `dr search`, `dr trace`)
2. **dr-architect agent** for model modifications (via Claude Agent SDK subagent delegation)

### Component Diagram

```
User Message
     ↓
DrBot Orchestrator
     ↓
Claude (with system prompt + model context)
     ↓
   ┌─────────────┴──────────────┐
   │                            │
   ▼                            ▼
DR CLI Tools              dr-architect Agent
(read operations)         (write operations)
   │                            │
   └─────────────┬──────────────┘
                 ↓
            DR Model
```

## Features

### FR-4: DR Domain Expertise

DrBot has deep knowledge of the 12-layer DR architecture:

1. **Motivation** - WHY (goals, principles, requirements, constraints)
2. **Business** - WHAT (capabilities, processes, services, actors)
3. **Security** - WHO/PROTECTION (actors, roles, policies, threats)
4. **Application** - HOW (components, services, interfaces, events)
5. **Technology** - WITH (platforms, frameworks, infrastructure)
6. **API** - CONTRACTS (OpenAPI 3.0.3 specs - 26 entity types)
7. **Data Model** - STRUCTURE (JSON Schema Draft 7 - 17 entity types)
8. **Datastore** - PERSISTENCE (SQL DDL - 10 entity types)
9. **UX** - EXPERIENCE (Three-Tier Architecture - 26 entity types)
10. **Navigation** - FLOW (Multi-Modal routing - 10 entity types)
11. **APM** - OBSERVE (OpenTelemetry 1.0+ - 14 entity types)
12. **Testing** - VERIFY (ISP Coverage Model - 17 entity types)

### FR-5: Model Query Capabilities

DrBot provides custom tools that wrap DR CLI commands:

#### `dr_list`

```python
dr_list(layer: str, element_type: str = "") -> str
```

Lists all elements of a specific type in a layer.

**Example**: "Show me all API operations"

#### `dr_find`

```python
dr_find(element_id: str) -> str
```

Gets detailed information about a specific element by ID.

**Example**: "What is business.service.orders?"

#### `dr_search`

```python
dr_search(pattern: str) -> str
```

Searches for elements by pattern or keyword.

**Example**: "Find anything related to payments"

#### `dr_trace`

```python
dr_trace(element_id: str) -> str
```

Traces cross-layer dependencies for an element.

**Example**: "What depends on the Order API?"

### FR-6: Model Modification Capabilities

DrBot delegates all write operations to the **dr-architect agent** through the Claude Agent SDK's subagent pattern:

#### `delegate_to_architect`

```python
delegate_to_architect(task_description: str) -> str
```

Delegates modeling tasks to the expert dr-architect agent.

**Examples**:

- "Add a new REST API endpoint for user login"
- "Update the Orders service to link to the revenue goal"
- "Create a business service for order processing"

### FR-10: Tool Invocation Visibility

The chat handler displays which commands are being executed in real-time:

```json
{
  "jsonrpc": "2.0",
  "method": "chat.tool.invoke",
  "params": {
    "conversation_id": "conv-123",
    "tool_name": "dr list api operation",
    "status": "executing"
  }
}
```

## Implementation Details

### System Prompt

DrBot's system prompt is built dynamically with:

1. **Base expertise** - Understanding of all 12 layers
2. **Current model context** - Statistics, recent elements, manifest info
3. **Tool descriptions** - What each tool does and when to use it
4. **Conversation history** - Recent exchanges for context continuity

### Model Context Building

The orchestrator builds rich context from the model directory:

```python
context = {
    "manifest": {
        "name": "My DR Model",
        "specVersion": "0.5.0"
    },
    "layer_stats": {
        "business": 15,  # 15 elements in business layer
        "api": 32,
        "application": 28
    },
    "recent_elements": [
        "api.operation.create-order",
        "business.service.orders",
        ...
    ]
}
```

This context is injected into Claude's system prompt, allowing it to provide specific, contextually relevant responses.

### CLI Execution

All CLI commands are executed via subprocess with:

- **Timeouts** (default: 120 seconds)
- **Error handling** with user-friendly messages
- **JSON output parsing** for structured responses
- **Working directory** set to the model path

```python
async def _execute_cli(self, cmd_parts: List[str]) -> str:
    proc = await asyncio.create_subprocess_exec(
        *cmd_parts,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(self.model_path),
    )

    stdout, stderr = await asyncio.wait_for(
        proc.communicate(),
        timeout=self.timeout
    )

    # Returns JSON with results or error
```

### Agent Delegation

For write operations, DrBot configures the dr-architect agent as a subagent:

```python
options = ClaudeAgentOptions(
    system_prompt=system_prompt,
    tools=[...],  # DR CLI tools
    agents={
        "dr-architect": {
            "description": "Expert DR modeler for creating and modifying elements",
            "prompt": load_dr_architect_prompt(),
            "tools": ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
        }
    },
    cwd=str(self.model_path),
    permission_mode="acceptEdits",
)
```

Claude decides when to delegate to dr-architect based on the user's intent.

## Usage

### Basic Initialization

```python
from documentation_robotics.server.drbot_orchestrator import DrBotOrchestrator

orchestrator = DrBotOrchestrator(
    model_path=Path("/path/to/dr/model"),
    timeout=120  # seconds
)
```

### Handling Messages

```python
# Build model context
context = orchestrator.build_model_context()

# Get conversation history from session
history = session.get_conversation_for_sdk()

# Process user message
async for message in orchestrator.handle_message(
    user_message="Which APIs model the Product entities?",
    context=context,
    conversation_history=history
):
    # message contains Claude's response
    # - Text blocks
    # - Tool invocations
    # - Results
    pass
```

### Example Interactions

#### Query Example

```
User: Which APIs model the Product entities?

DrBot: Let me search for Product-related APIs...
[Invokes: dr_search("Product")]

I found 3 API operations related to Products:
1. api.operation.create-product - POST /api/v1/products
2. api.operation.get-product - GET /api/v1/products/{id}
3. api.operation.list-products - GET /api/v1/products

These operations are defined in the API layer and link to the
data_model.object-schema.product schema.
```

#### Modification Example

```
User: Add a new REST API endpoint for user login

DrBot: I'll delegate this to dr-architect to create the API endpoint properly...
[Delegates to dr-architect agent]

dr-architect: Creating API operation with proper validation and links...
[Executes: dr add api operation --name "User Login" --property path="/api/v1/auth/login" --property method="POST"]
[Validates: dr validate --layer api]

✓ Created api.operation.user-login
  - POST /api/v1/auth/login
  - Linked to application.service.authentication
  - Validation: PASSED

Would you like me to also create the corresponding data schemas
for the login request and response?
```

#### Trace Example

```
User: What depends on the Order API?

DrBot: Let me trace the dependencies...
[Invokes: dr_trace("api.operation.create-order")]

The Create Order API has the following dependencies:

Upward Links (supports):
- business.service.order-management
- motivation.goal.increase-revenue

Downward Links (uses):
- data_model.object-schema.order
- application.service.order-processor
- datastore.table.orders

Elements that depend on it:
- ux.component.order-form
- testing.test-case.order-creation-happy-path
```

## Configuration

### Timeout Configuration

Adjust the timeout for long-running operations:

```python
orchestrator = DrBotOrchestrator(
    model_path=model_path,
    timeout=300  # 5 minutes for complex operations
)
```

### Custom dr-architect Prompt

Place a custom dr-architect prompt at:

```
/workspace/cli/src/documentation_robotics/claude_integration/agents/dr-architect.md
```

The orchestrator will automatically load it. Otherwise, a fallback prompt is used.

## Testing

### Running Tests

```bash
# Run all DrBot tests
pytest tests/unit/server/test_drbot_orchestrator.py -v

# Run with coverage
pytest tests/unit/server/test_drbot_orchestrator.py --cov=documentation_robotics.server.drbot_orchestrator
```

### Test Coverage

The test suite covers:

- ✓ Orchestrator initialization
- ✓ Model context building
- ✓ System prompt generation
- ✓ CLI command execution (success, error, timeout, not found)
- ✓ Tool creation (all 5 tools)
- ✓ dr-architect prompt loading
- ✓ Message handling (requires SDK)

**Current Coverage**: 81% (151 statements, 28 missing)

### Testing Without SDK

Tests that require the Claude Agent SDK are automatically skipped if the SDK is not installed:

```python
@pytest.mark.skipif(not HAS_SDK, reason="Claude Agent SDK not installed")
async def test_handle_message(self, mock_model_path):
    ...
```

## Dependencies

### Required

- Python 3.11+
- `asyncio` - Async subprocess execution
- `json` - CLI output parsing
- `pathlib` - Path manipulation
- `pyyaml` - Manifest parsing

### Optional

- `claude-agent-sdk` - Required for full functionality

  ```bash
  pip install claude-agent-sdk
  ```

## Error Handling

DrBot provides user-friendly error messages:

### CLI Not Found

```json
{
  "error": "DR CLI not found. Is it installed?",
  "command": "dr list business"
}
```

### Command Timeout

```json
{
  "error": "Command timed out after 120 seconds",
  "command": "dr validate --strict"
}
```

### Command Failure

```json
{
  "error": "Layer not found: invalid_layer",
  "command": "dr list invalid_layer",
  "returncode": 1
}
```

## Integration with Visualization Server

DrBot is designed to integrate with the visualization server's chat handler:

```python
from documentation_robotics.server.drbot_orchestrator import DrBotOrchestrator
from documentation_robotics.server.chat_session import ChatSession

# In chat handler
orchestrator = DrBotOrchestrator(model_path)
context = orchestrator.build_model_context()

async for message in orchestrator.handle_message(
    user_message=request.message,
    context=context,
    conversation_history=session.get_conversation_for_sdk()
):
    # Stream responses to frontend via WebSocket
    await send_response_chunk(message)
```

## Performance Considerations

### Context Caching

Model context building is fast (< 100ms for typical models):

- Manifest: Single file read
- Layer stats: Directory iteration with counting
- Recent elements: Sorted by mtime, limited to 10

### CLI Execution

CLI commands are executed asynchronously:

- Non-blocking subprocess calls
- Configurable timeouts
- Parallel tool invocations (when Claude calls multiple tools)

### Conversation History

Limit conversation history to prevent context window bloat:

```python
# In chat session
SDK_CONTEXT_MESSAGES = 10  # Last 10 messages
```

## Future Enhancements

Potential improvements for future releases:

1. **Caching** - Cache CLI results for frequently accessed elements
2. **Batch Operations** - Combine multiple CLI calls into single execution
3. **Streaming** - Stream CLI output for long-running commands
4. **Metrics** - Track tool usage, response times, error rates
5. **Permissions** - Granular control over what operations DrBot can perform

## See Also

- [Chat Handler](./chat_handler.py) - WebSocket message handling
- [Chat Protocol](./chat_protocol.py) - JSON-RPC message definitions
- [dr-architect Agent](../claude_integration/agents/dr-architect.md) - Modeling expert
- [Visualization Server](./visualization_server.py) - Main server implementation

---

**Version**: 0.7.3
**Author**: Documentation Robotics Team
**License**: MIT
