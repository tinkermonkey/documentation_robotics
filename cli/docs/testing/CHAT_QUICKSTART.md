# DrBot Chat Quick Start Guide

## 🚀 Quick Start (5 minutes)

This guide shows you how to test DrBot's chat capabilities using the command-line test harness.

### Step 1: Start the Visualization Server

In your first terminal, navigate to a DR model directory and start the visualization server:

```bash
cd /path/to/your/dr/model
dr visualize --port 8080
```

You should see output like:
```
Starting visualization server...

✓ Model loaded successfully (12 layers)

┌─────────────────────────────────────────────────────────────┐
│ Open in browser                                             │
│                                                             │
│ http://localhost:8080?token=abc123...                      │
│                                                             │
│ This link includes a secure authentication token           │
└─────────────────────────────────────────────────────────────┘

Server: localhost:8080
Model:  /path/to/your/dr/model

Press Ctrl+C to stop the server
```

**Keep this terminal running!** The chat needs the server to be active.

### Step 2: Start the Chat in a New Terminal

Open a **second terminal** and run:

```bash
dr chat --port 8080
```

You should see:
```
DrBot Chat Test Harness

Connecting to localhost:8080...
Conversation ID: 550e8400-e29b-41d4-a716-446655440000

✓ Connected to DrBot

Type your message and press Enter.
Type 'exit' or 'quit' to end the session.
Type 'help' for available commands.

You:
```

### Step 3: Chat with DrBot

Try these example queries:

#### List Elements
```
You: List all services in the business layer

DrBot: I'll list all services in the business layer for you.
🔧 Tool invoked: dr_list

DrBot: I found 3 services in the business layer:
1. business-service-orders
2. business-service-payments
3. business-service-inventory
```

#### Find Specific Element
```
You: Find business-service-orders

DrBot: Let me look up that element.
🔧 Tool invoked: dr_find

DrBot: Found element: business-service-orders
[Details about the service...]
```

#### Search
```
You: Search for anything related to authentication

DrBot: Searching for authentication-related elements...
🔧 Tool invoked: dr_search

DrBot: Found 5 elements matching "authentication":
[Search results...]
```

#### Trace Dependencies
```
You: What depends on api-endpoint-create-order?

DrBot: Let me trace the dependencies for that endpoint.
🔧 Tool invoked: dr_trace

DrBot: The api-endpoint-create-order has these dependencies:
[Dependency graph...]
```

### Step 4: Exit

When done, type:
```
You: exit
```

Or press `Ctrl+C` to exit.

## 📋 Prerequisites

Before you can use the chat test harness, make sure you have:

### 1. Claude Agent SDK (Required)

The chat functionality requires the Claude Agent SDK. Install it:

```bash
pip install claude-agent-sdk
```

Or if using the dev dependencies:
```bash
pip install -e ".[dev]"
```

### 2. A DR Model

You need an existing DR model to chat about. If you don't have one:

```bash
dr init my-test-model
cd my-test-model
```

### 3. The Visualization Server Running

The chat connects to the WebSocket endpoint provided by the visualization server, so it must be running first.

## 🎯 Common Use Cases

### Testing DrBot's Understanding

Ask DrBot questions to test its knowledge of your model:

```
You: What layers exist in this model?
You: How many elements are in the API layer?
You: What is the purpose of the security layer?
```

### Testing Tool Invocation

Verify that DrBot correctly invokes DR CLI tools:

```
You: List all endpoints in the API layer
# Should invoke dr_list with layer="api" and element_type="endpoint"

You: Find business-process-order-fulfillment
# Should invoke dr_find with element_id="business-process-order-fulfillment"
```

### Testing Delegation

Test that DrBot delegates write operations to dr-architect:

```
You: Add a new service called user-authentication to the security layer
# Should delegate to dr-architect agent
```

### Testing Context Awareness

Test if DrBot maintains conversation context:

```
You: List services in the business layer

DrBot: [Lists services...]

You: Tell me more about the first one
# Should remember the context and know which service you mean
```

## 🔍 Monitoring and Debugging

### Watch Server Logs

In the terminal where `dr visualize` is running, you'll see:
- Incoming chat requests
- Tool invocations
- Errors and warnings

### Check Response Times

The status messages show processing time and costs:
```
⏳ Processing your request...
✓ Completed (cost: $0.0123)
```

### Verbose Output

For more detailed output, you can modify the chat handler's logging in:
```
src/documentation_robotics/server/chat_handler.py
```

## 🛠️ Troubleshooting

### "Could not connect to server"

**Problem:** Chat can't connect to the server

**Solutions:**
1. Make sure `dr visualize` is running in another terminal
2. Check the port matches: `dr visualize --port 8080` and `dr chat --port 8080`
3. Check for firewall issues blocking localhost connections

### "No response from DrBot"

**Problem:** Message sent but no response appears

**Possible causes:**
1. **Claude Agent SDK not installed** - Install with `pip install claude-agent-sdk`
2. **SDK initialization failed** - Check the visualize server logs for errors
3. **Model path issue** - Make sure the server has access to your model

**Debug steps:**
1. Check the visualize server terminal for errors
2. Verify SDK is available: `python -c "import claude_agent_sdk; print('OK')"`
3. Try a simple query first: "help"

### "Authentication required"

**Problem:** Connection rejected due to auth failure

**Solution:**
Get the token from the visualize server output and use it:
```bash
dr chat --port 8080 --token <token-from-server-output>
```

### Chat freezes or hangs

**Problem:** Chat becomes unresponsive

**Solutions:**
1. Press `Ctrl+C` to interrupt
2. Restart both the server and chat
3. Check for deadlocks in server logs

## 📊 What Gets Tested

Using the chat test harness validates:

- ✅ **WebSocket connectivity** - Can the client connect to the server?
- ✅ **JSON-RPC protocol** - Are messages formatted correctly?
- ✅ **DrBot orchestrator** - Does it route requests properly?
- ✅ **Tool invocation** - Are DR CLI tools called correctly?
- ✅ **Streaming responses** - Do partial responses stream correctly?
- ✅ **Error handling** - Are errors reported clearly?
- ✅ **Context management** - Does conversation history work?
- ✅ **Agent delegation** - Does dr-architect get called for write ops?

## 🔗 Related Documentation

- [Chat Test Harness Details](./chat-test-harness.md) - Full technical documentation
- [DrBot README](../DRBOT_README.md) - DrBot architecture and features
- [Visualization Server](../user-guide/visualization.md) - Server configuration
- [Claude Integration](../user-guide/claude-code-integration.md) - Claude Agent SDK setup

## 💡 Tips

1. **Use descriptive queries** - DrBot works best with clear, specific questions
2. **Test incrementally** - Start with simple queries, then try complex ones
3. **Check the logs** - The visualize server logs show what's happening
4. **Save conversation IDs** - Use `--conversation-id` to resume conversations
5. **Test edge cases** - Try invalid inputs, non-existent elements, etc.

## 🎓 Next Steps

Once you're comfortable with the chat test harness:

1. **Build a web UI** - Use the same WebSocket protocol from a browser
2. **Automate testing** - Create pytest tests that use the chat protocol
3. **Extend DrBot** - Add new tools or modify the system prompt
4. **Monitor usage** - Track which queries are most common

Happy chatting! 🤖
