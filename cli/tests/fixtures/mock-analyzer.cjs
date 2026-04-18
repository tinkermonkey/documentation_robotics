#!/usr/bin/env node
/**
 * Mock analyzer subprocess for testing JSON-RPC protocol
 *
 * Reads JSON-RPC requests from stdin and writes responses to stdout.
 * Supports testing request/response correlation, error handling, and timeouts.
 */

const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

// Track pending requests
const pendingRequests = new Map();

/**
 * Send a JSON-RPC response
 */
function sendResponse(id, result, error = null) {
  const response = {
    jsonrpc: "2.0",
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  console.log(JSON.stringify(response));
}

/**
 * Send a JSON-RPC error response
 */
function sendError(id, code, message, data = null) {
  const error = { code, message };
  if (data) {
    error.data = data;
  }
  sendResponse(id, null, error);
}

rl.on("line", (line) => {
  try {
    const request = JSON.parse(line);

    if (!request || typeof request !== "object") {
      return;
    }

    const { jsonrpc, method, params, id } = request;

    if (jsonrpc !== "2.0") {
      return;
    }

    // Handle notifications (no id)
    if (!id) {
      if (method === "shutdown") {
        process.exit(0);
      }
      return;
    }

    // Handle initialize
    if (method === "initialize") {
      sendResponse(id, { capabilities: {}, serverInfo: { name: "mock-analyzer" } });
      return;
    }

    // Handle tools/list (returns test tools)
    if (method === "tools/list") {
      sendResponse(id, {
        tools: [
          { name: "echo", description: "Echo back the input" },
          { name: "delay", description: "Delay and respond" },
          { name: "error", description: "Return an error" },
        ],
      });
      return;
    }

    // Handle tool calls
    if (method === "tools/call") {
      const { name, arguments: args } = params || {};

      if (name === "echo") {
        sendResponse(id, { echoed: args });
        return;
      }

      if (name === "delay") {
        const delay = (args?.delay || 100);
        // Store for later response
        pendingRequests.set(id, { method, params, delay, timestamp: Date.now() });

        setTimeout(() => {
          sendResponse(id, { delayed: true, delayMs: delay });
          pendingRequests.delete(id);
        }, delay);
        return;
      }

      if (name === "error") {
        const errorCode = args?.code || -32000;
        const errorMsg = args?.message || "Test error";
        const errorData = args?.data;
        sendError(id, errorCode, errorMsg, errorData);
        return;
      }
    }

    // Default: unknown method
    sendError(id, -32601, "Method not found");
  } catch (err) {
    // Invalid JSON — ignore
  }
});

rl.on("close", () => {
  process.exit(0);
});

// Graceful shutdown on signals
process.on("SIGTERM", () => {
  process.exit(0);
});
process.on("SIGINT", () => {
  process.exit(0);
});
