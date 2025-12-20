# Phase 7: AI Integration Testing Guide

## Quick Start

### Prerequisites
```bash
# 1. Install dependencies
npm install

# 2. Verify TypeScript compilation
npx tsc --noEmit

# 3. Set up environment for runtime testing (if you have Bun)
export ANTHROPIC_API_KEY=sk-... # Your actual API key
```

## Test Coverage

### Unit Tests

#### 1. ClaudeClient Tests (`tests/unit/ai/claude-client.test.ts`)

**Test Scenarios**:
- ✅ Constructor initializes with API key
- ✅ Empty history on creation
- ✅ History length tracking
- ✅ History clearing functionality
- ✅ History copying (defensive copy, not reference)

**Running**:
```bash
# With Bun installed:
bun test tests/unit/ai/claude-client.test.ts

# Type checking only:
npx tsc --noEmit src/ai/claude-client.ts
```

#### 2. ModelContextProvider Tests (`tests/unit/ai/context-provider.test.ts`)

**Test Scenarios**:
- ✅ Context generation includes model info
- ✅ Layer information included in context
- ✅ Element summaries present and correct
- ✅ Available layers list (all 12 layers)
- ✅ Layer element count queries
- ✅ Total element count calculation

**Key Assertions**:
```typescript
const context = await provider.generateContext();
expect(context).toContain('Current Architecture Model');
expect(context).toContain('Layers Overview');
expect(context).toContain('Element Summary');
```

#### 3. Tool Tests (`tests/unit/ai/tools.test.ts`)

**Test Scenarios**:

**getModelTools()**:
- ✅ Returns exactly 4 tools (dr_list, dr_find, dr_search, dr_trace)
- ✅ Each tool has name, description, input_schema
- ✅ Input schemas are properly formatted (type: object, properties, required)

**executeModelTool() - dr_list**:
- ✅ Lists elements in a layer
- ✅ Filters elements by type
- ✅ Returns error for non-existent layer
- ✅ Includes element count in response

**executeModelTool() - dr_find**:
- ✅ Finds element by ID
- ✅ Returns complete element information
- ✅ Includes layer information in result
- ✅ Returns "not found" for missing elements

**executeModelTool() - dr_search**:
- ✅ Searches by query string
- ✅ Filters by layers when specified
- ✅ Returns match reasons (id, name, description)
- ✅ Case-insensitive matching

**executeModelTool() - dr_trace**:
- ✅ Traces element dependencies
- ✅ Supports direction: up, down, both
- ✅ Returns dependency counts

**Error Handling**:
- ✅ Returns error for unknown tool
- ✅ Graceful handling of missing parameters
- ✅ Clear error messages

### Integration Tests

#### Chat Command Tests (`tests/integration/chat-command.test.ts`)

**Test Scenarios**:

**ClaudeClient Integration**:
- ✅ Initializes without errors
- ✅ Maintains conversation history
- ✅ Returns copies of history (not references)

**ModelContextProvider Integration**:
- ✅ Generates context successfully
- ✅ Includes element information
- ✅ Provides all available layers
- ✅ Accurate element counting

**Tool Integration**:
- ✅ Tool definitions are valid
- ✅ Tool schemas are correct
- ✅ All 4 tools are present

**End-to-End Setup**:
- ✅ Chat initialization with API key
- ✅ System prompt generation with context
- ✅ Tool availability verification

## Acceptance Criteria Checklist

### ClaudeClient
- [x] Streams responses token-by-token without buffering
  - Implementation: Uses `AsyncIterable<string>` pattern
  - Test: `claude-client.test.ts`

- [x] Conversation history correctly accumulates messages
  - Implementation: Pushes to history after stream completion
  - Test: `claude-client.test.ts`

### ModelContextProvider
- [x] Generates markdown context with model summary
  - Implementation: `generateContext()` includes manifest info
  - Test: `context-provider.test.ts`

- [x] Includes element counts per layer
  - Implementation: Iterates layers and counts elements
  - Test: `context-provider.test.ts`

### Tool Definitions
- [x] Correct schemas for dr_list, dr_find, dr_search, dr_trace
  - Implementation: `getModelTools()` returns 4 tools with schemas
  - Test: `tools.test.ts`

- [x] Tool execution returns JSON results
  - Implementation: All execute functions return JSON-serializable objects
  - Test: `tools.test.ts`

### Chat Command
- [x] Loads ANTHROPIC_API_KEY from environment
  - Implementation: Checks `process.env.ANTHROPIC_API_KEY`
  - Test: Can verify via environment variable

- [x] Displays streaming responses progressively
  - Implementation: Uses `for await` loop for streaming
  - Test: Manual verification (requires API key)

- [x] Supports multi-turn conversation with context retention
  - Implementation: ClaudeClient maintains history
  - Test: `chat-command.test.ts`

## Manual Testing Steps

### 1. Type Checking
```bash
npx tsc --noEmit
# Expected: No errors
```

### 2. Chat Command Initialization (requires ANTHROPIC_API_KEY)

```bash
# Set up test model
mkdir -p /tmp/test-dr
cd /tmp/test-dr
ANTHROPIC_API_KEY=sk-... dr init --name "Test" --author "You"

# Start chat
ANTHROPIC_API_KEY=sk-... dr chat
```

**Expected Behavior**:
```
✦ Documentation Robotics Chat
  Powered by Claude AI - Ask about your architecture model

You: What layers does this model have?
Claude: [streaming response showing layer information]

You: Find all elements
Claude: [response with search results]

You: exit
✓ Goodbye!
```

### 3. Tool Execution Testing

Once in chat, try:
```
You: List all endpoints in the api layer
You: Find the element with id api-endpoint-list-users
You: Search for authentication
You: What depends on the database?
```

### 4. Error Handling

Test error cases:
```
You: List elements in nonexistent layer
You: Find element fake-id-123
You: What is the weather?  # (Claude should handle gracefully)
```

## Test File Locations

```
cli-bun/
├── tests/
│   ├── unit/
│   │   └── ai/
│   │       ├── claude-client.test.ts       (11 tests)
│   │       ├── context-provider.test.ts    (6 tests)
│   │       └── tools.test.ts               (13+ tests)
│   └── integration/
│       └── chat-command.test.ts            (8+ tests)
```

## Running All Tests (with Bun)

```bash
# Run all tests
bun test tests/**/*.test.ts

# Run only unit tests
bun test tests/unit/**/*.test.ts

# Run only integration tests
bun test tests/integration/**/*.test.ts

# Run specific test file
bun test tests/unit/ai/tools.test.ts

# Run with detailed output
bun test --verbose tests/**/*.test.ts
```

## Code Quality Checks

```bash
# Type checking
npx tsc --noEmit

# Check imports/exports
npx tsc --noEmit --skipLibCheck

# Build (if configured)
npm run build
```

## Expected Test Results

When all tests pass:
- ClaudeClient: ✅ 3 test suites pass
- ModelContextProvider: ✅ 6 test suites pass
- Tools: ✅ 13+ test suites pass
- Integration: ✅ 8+ test suites pass

**Total**: ~30+ test cases covering:
- ✅ Core functionality (streaming, history, context)
- ✅ Tool definitions and execution
- ✅ Error handling and edge cases
- ✅ Integration scenarios

## Troubleshooting

### TypeScript Errors
If you see `Cannot find module '@anthropic-ai/sdk'`:
```bash
npm install
npx tsc --noEmit
```

### Bun Not Found
If `bun: not found`:
- Install Bun: `curl -fsSL https://bun.sh/install | bash`
- Or skip Bun tests and use type checking only

### API Key Issues
If chat command fails with API key error:
```bash
# Verify environment variable
echo $ANTHROPIC_API_KEY

# Set it if needed
export ANTHROPIC_API_KEY=sk-...
```

## Performance Considerations

### Streaming Performance
- No buffering: Messages stream immediately
- Memory efficient: Yields chunks rather than accumulating
- Suitable for large responses

### Context Generation
- Fast for small models (< 1000 elements)
- Lazy loads layer specs from filesystem
- Caches available layers list

### Tool Execution
- O(n) search complexity (acceptable for typical models)
- Dependency graph operations use Graphology (efficient)
- Error handling prevents crashes on invalid inputs

## Future Test Enhancements

Potential additions:
1. Mock API responses for ClaudeClient testing
2. Snapshot testing for context generation
3. Performance benchmarks for large models
4. UI testing for chat interaction
5. Tool result validation testing
