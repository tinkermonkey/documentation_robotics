/**
 * Quick test of mock MCP client
 */

import { createMockMcpClient } from "./cli/tests/helpers/mock-mcp-client.js";

async function testMock() {
  const mockResults = [
    {
      type: "text" as const,
      text: JSON.stringify([
        { path: "/api/users", method: "GET" },
        { path: "/api/products", method: "POST" },
      ]),
    },
  ];

  const client = createMockMcpClient({
    search_code: mockResults,
  });

  console.log("Testing mock MCP client...");
  console.log("Connected:", client.isConnected);
  console.log("Endpoint:", client.endpoint);

  // Test tool invocation
  const results = await client.callTool("search_code", {
    pattern: "test",
    language: "javascript",
  });

  console.log("Tool results:", results);
  console.log("Result text:", results[0].text);

  // Parse JSON
  if (results[0].text) {
    const parsed = JSON.parse(results[0].text);
    console.log("Parsed matches:", parsed);
  }

  // Test list tools
  const tools = await client.listTools();
  console.log("Available tools:", tools.length);

  // Test disconnect
  await client.disconnect();
  console.log("Disconnected. isConnected:", client.isConnected);

  console.log("\n✓ Mock MCP client test passed!");
}

testMock().catch(console.error);
