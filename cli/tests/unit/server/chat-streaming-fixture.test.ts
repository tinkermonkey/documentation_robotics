/**
 * Fixture-based end-to-end tests for launchClaudeCodeChat and launchCopilotChat
 *
 * Tests the real implementations in server.ts using mock fixture scripts that emulate
 * the expected output from Claude Code CLI and GitHub Copilot. Covers:
 *
 * Claude Code path:
 * - Happy path with JSON event streaming
 * - Tool status: executing, then completed or failed by tool_use_id (a denial is failed)
 * - Split-chunk buffering (JSON events split across multiple writes)
 * - No-trailing-newline handling (final unterminated line delivery)
 * - Non-JSON line fallback (unparseable lines sent as raw text chunks)
 * - Non-zero exit codes
 * - Process cleanup
 *
 * Copilot path:
 * - Happy path with plain text streaming
 * - Non-zero exit codes
 * - Process cleanup
 *
 * Each test uses:
 * - Unique temp directory and conversation IDs
 * - Injection mechanism to substitute fixture script for real command
 * - Shared helpers (createFakeWs, waitFor) to assert WebSocket sends
 */

import { describe, it, expect } from "bun:test";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import { createFakeWs, waitFor } from "./helpers.js";

/**
 * Helper to create a VisualizationServer with injection override
 */
async function createTestServer(
  overrideProp: "_testClaudeCmdOverride" | "_testCopilotCmdOverride",
  overrideCmd: string[]
) {
  const testDir = join(tmpdir(), `dr-chat-fixture-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });

  const model = await Model.init(
    testDir,
    {
      name: "Chat Fixture Test",
      version: "0.1.0",
      description: "Model for chat streaming fixture tests",
      specVersion: "0.6.0",
      created: new Date().toISOString(),
    },
    { lazyLoad: false }
  );

  const server = new VisualizationServer(model, { authEnabled: false });

  // Set the injection override
  (server as any)[overrideProp] = overrideCmd;

  return { server, model, testDir };
}

/**
 * Clean up test server and temp directory
 */
async function cleanupTestServer(server: VisualizationServer, testDir: string) {
  server.stop();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors in tests
  }
}

describe("VisualizationServer Claude Code chat streaming with fixtures", () => {
  // Get the path to the mock-claude-stream fixture
  const mockClaudeScriptPath = join(import.meta.dir, "../../fixtures/mock-claude-stream.cjs");

  it("happy path: emits ordered chat.response.chunk, chat.tool.invoke, chat.response.complete notifications", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
    ]);

    const conversationId = `conv-happy-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", "req-1");

    // Wait for completion response
    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-1" && m.result)
    );

    expect(completion.id).toBe("req-1");
    expect(completion.result.status).toBe("complete");
    expect(completion.result.exit_code).toBe(0);

    // Verify notification sequence
    const notifications = ws.sent.filter((m) => m.method);
    expect(notifications.length).toBeGreaterThan(0);

    // Should have text chunks
    const textChunks = notifications.filter((m) => m.method === "chat.response.chunk");
    expect(textChunks.length).toBeGreaterThan(0);
    expect(textChunks.some((m) => m.params.content.includes("Claude"))).toBe(true);

    // Should have tool invocation
    const toolInvokes = notifications.filter((m) => m.method === "chat.tool.invoke");
    expect(toolInvokes.length).toBeGreaterThan(0);

    // The end-of-turn `result` event becomes one chat.response.complete; chat.tool.result is gone
    const completes = notifications.filter((m) => m.method === "chat.response.complete");
    expect(completes.length).toBe(1);
    expect(completes[0].params.conversation_id).toBe(conversationId);
    expect(completes[0].params.result).toBe(
      "The function is straightforward and returns the constant 42."
    );
    expect(completes[0].params.is_error).toBe(false);
    expect(notifications.some((m) => m.method === "chat.tool.result")).toBe(false);

    // Cleanup
    expect((server as any).activeChatProcesses.has(conversationId)).toBe(false);
    await cleanupTestServer(server, testDir);
  });

  it("full_response equals concatenation of all emitted assistant text blocks", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
    ]);

    const conversationId = `conv-concat-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", "req-2");

    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-2" && m.result)
    );

    // Collect all text content from chat.response.chunk notifications
    const notifications = ws.sent.filter((m) => m.method);
    const textChunks = notifications.filter((m) => m.method === "chat.response.chunk");
    const concatenated = textChunks.map((m) => m.params.content).join("");

    expect(completion.result.full_response).toBe(concatenated);

    await cleanupTestServer(server, testDir);
  });

  it("split-chunk buffering: JSON event split across two stdout writes yields exactly one notification", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
      "--split-chunks",
    ]);

    const conversationId = `conv-split-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", "req-3");

    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-3" && m.result)
    );

    expect(completion.result.status).toBe("complete");

    // The split happens on the second event (tool_use at i === 1)
    // Verify it appears exactly once with correct values
    const notifications = ws.sent.filter((m) => m.method);
    const toolInvokes = notifications.filter((m) => m.method === "chat.tool.invoke");

    const executing = toolInvokes.filter(
      (m) => m.params.tool_use_id === "tool_123" && m.params.status === "executing"
    );
    expect(executing.length).toBe(1);
    expect(executing[0].params.tool_name).toBe("analyze_code");
    expect(executing[0].params.tool_input).toEqual({
      code: "function test() { return 42; }",
    });

    await cleanupTestServer(server, testDir);
  });

  it("no-trailing-newline handling: final unterminated JSON event is still handled", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
      "--no-final-newline",
    ]);

    const conversationId = `conv-no-newline-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", "req-4");

    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-4" && m.result)
    );

    expect(completion.result.status).toBe("complete");

    // The last line is the `result` event with no newline after it: parsed, not sent as text
    const completes = ws.sent.filter((m) => m.method === "chat.response.complete");
    expect(completes.length).toBe(1);
    const chunks = ws.sent.filter((m) => m.method === "chat.response.chunk");
    expect(chunks.some((m) => m.params.content.includes('"type":"result"'))).toBe(false);

    await cleanupTestServer(server, testDir);
  });

  it("non-JSON line fallback: unparseable line is forwarded as raw text chunk", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
      "--emit-non-json",
    ]);

    const conversationId = `conv-non-json-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", "req-5");

    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-5" && m.result)
    );

    expect(completion.result.status).toBe("complete");

    // Verify that the non-JSON line was forwarded as a raw text chunk
    const notifications = ws.sent.filter((m) => m.method);
    const textChunks = notifications.filter((m) => m.method === "chat.response.chunk");

    // Should have at least one text chunk containing the raw non-JSON line
    expect(
      textChunks.some((m) => m.params.content && m.params.content.includes("This is not JSON"))
    ).toBe(true);

    await cleanupTestServer(server, testDir);
  });

  it("non-zero exit code: final result has status error and matching exit_code", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
      "--exit-code",
      "42",
    ]);

    const conversationId = `conv-exit-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", "req-6");

    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-6" && m.result)
    );

    expect(completion.result.status).toBe("error");
    expect(completion.result.exit_code).toBe(42);

    await cleanupTestServer(server, testDir);
  });

  it("process cleanup: activeChatProcesses.has(conversationId) is false after successful run", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
    ]);

    const conversationId = `conv-cleanup-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", "req-7");

    // Wait for completion
    await waitFor(() => ws.sent.find((m) => m.id === "req-7" && m.result));

    // Verify cleanup
    expect((server as any).activeChatProcesses.has(conversationId)).toBe(false);

    await cleanupTestServer(server, testDir);
  });

  it("tool status: each tool_use is executing, then completed by the same tool_use_id", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
    ]);
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, `conv-tools-${randomUUID()}`, "hi", "req-tools");
    await waitFor(() => ws.sent.find((m) => m.id === "req-tools" && m.result));

    const updates = ws.sent
      .filter((m) => m.method === "chat.tool.invoke" && m.params.tool_use_id === "tool_123")
      .map((m) => m.params);
    expect(updates.map((u) => u.status)).toEqual(["executing", "completed"]);
    expect(updates[1]).toMatchObject({
      tool_name: "analyze_code",
      is_error: false,
      result: "Analysis complete: function returns a number literal.",
    });
    expect(updates[1].error).toBeUndefined();

    await cleanupTestServer(server, testDir);
  });

  it("tool status: a call denied at the permission prompt reports as failed", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
    ]);
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, `conv-denied-${randomUUID()}`, "hi", "req-denied");
    await waitFor(() => ws.sent.find((m) => m.id === "req-denied" && m.result));

    const updates = ws.sent
      .filter((m) => m.method === "chat.tool.invoke" && m.params.tool_use_id === "tool_456")
      .map((m) => m.params);
    // One executing and one failed: the result event's permission_denials entry for the same
    // call doesn't report it a second time.
    expect(updates.map((u) => u.status)).toEqual(["executing", "failed"]);
    expect(updates[1].is_error).toBe(true);
    expect(updates[1].tool_name).toBe("Bash");
    expect(updates[1].error).toContain("requested permissions to use Bash");

    await cleanupTestServer(server, testDir);
  });

  it("tool status: a tool with no result by the end of the reply reports as failed", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
      "--unanswered-tool",
    ]);
    const ws = createFakeWs();

    await (server as any).launchClaudeCodeChat(ws, `conv-pending-${randomUUID()}`, "hi", "req-pending");
    const completion = await waitFor(() => ws.sent.find((m) => m.id === "req-pending" && m.result));

    const updates = ws.sent
      .filter((m) => m.method === "chat.tool.invoke" && m.params.tool_use_id === "tool_789")
      .map((m) => m.params);
    expect(updates.map((u) => u.status)).toEqual(["executing", "failed"]);
    expect(updates[1].error).toContain("no result");
    // ...and it is reported before the chat.send response that ends the turn
    expect(ws.sent.indexOf(ws.sent.find((m) => m.params?.tool_use_id === "tool_789" && m.params.status === "failed"))).toBeLessThan(
      ws.sent.indexOf(completion)
    );

    await cleanupTestServer(server, testDir);
  });

  it("JSON-RPC response id matches request id", async () => {
    const { server, testDir } = await createTestServer("_testClaudeCmdOverride", [
      "node",
      mockClaudeScriptPath,
    ]);

    const conversationId = `conv-req-id-${randomUUID()}`;
    const ws = createFakeWs();
    const requestId = "req-match-123";

    await (server as any).launchClaudeCodeChat(ws, conversationId, "test message", requestId);

    const completion = await waitFor(() => ws.sent.find((m) => m.id === requestId && m.result));

    expect(completion.id).toBe(requestId);
    expect(completion.jsonrpc).toBe("2.0");

    await cleanupTestServer(server, testDir);
  });
});

describe("VisualizationServer Copilot chat streaming with fixtures", () => {
  // Get the path to the mock-copilot-stream fixture
  const mockCopilotScriptPath = join(import.meta.dir, "../../fixtures/mock-copilot-stream.cjs");

  it("happy path: emits chat.response.chunk notifications with concatenated content", async () => {
    const { server, testDir } = await createTestServer("_testCopilotCmdOverride", [
      "node",
      mockCopilotScriptPath,
    ]);

    const conversationId = `conv-copilot-happy-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchCopilotChat(ws, conversationId, "test message", "req-1");

    // Wait for completion response
    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-1" && m.result)
    );

    expect(completion.id).toBe("req-1");
    expect(completion.result.status).toBe("complete");
    expect(completion.result.exit_code).toBe(0);

    // Verify notification sequence
    const notifications = ws.sent.filter((m) => m.method);
    expect(notifications.length).toBeGreaterThan(0);

    // Should have text chunks
    const textChunks = notifications.filter((m) => m.method === "chat.response.chunk");
    expect(textChunks.length).toBeGreaterThan(0);

    // No JSON parsing for Copilot - plain text content
    expect(
      textChunks.some((m) => m.params.content && typeof m.params.content === "string")
    ).toBe(true);

    // Cleanup
    expect((server as any).activeChatProcesses.has(conversationId)).toBe(false);
    await cleanupTestServer(server, testDir);
  });

  it("full_response accumulation matches fixture's full text output", async () => {
    const { server, testDir } = await createTestServer("_testCopilotCmdOverride", [
      "node",
      mockCopilotScriptPath,
    ]);

    const conversationId = `conv-copilot-concat-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchCopilotChat(ws, conversationId, "test message", "req-2");

    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-2" && m.result)
    );

    // Collect all text content from chat.response.chunk notifications
    const notifications = ws.sent.filter((m) => m.method);
    const textChunks = notifications.filter((m) => m.method === "chat.response.chunk");
    const concatenated = textChunks.map((m) => m.params.content).join("");

    expect(completion.result.full_response).toBe(concatenated);
    expect(completion.result.full_response.length).toBeGreaterThan(0);

    await cleanupTestServer(server, testDir);
  });

  it("non-zero exit code: status is error with matching exit_code", async () => {
    const { server, testDir } = await createTestServer("_testCopilotCmdOverride", [
      "node",
      mockCopilotScriptPath,
      "--exit-code",
      "5",
    ]);

    const conversationId = `conv-copilot-exit-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchCopilotChat(ws, conversationId, "test message", "req-3");

    const completion = await waitFor(() =>
      ws.sent.find((m) => m.id === "req-3" && m.result)
    );

    expect(completion.result.status).toBe("error");
    expect(completion.result.exit_code).toBe(5);

    await cleanupTestServer(server, testDir);
  });

  it("process cleanup: activeChatProcesses is empty after successful run", async () => {
    const { server, testDir } = await createTestServer("_testCopilotCmdOverride", [
      "node",
      mockCopilotScriptPath,
    ]);

    const conversationId = `conv-copilot-cleanup-${randomUUID()}`;
    const ws = createFakeWs();

    await (server as any).launchCopilotChat(ws, conversationId, "test message", "req-4");

    // Wait for completion
    await waitFor(() => ws.sent.find((m) => m.id === "req-4" && m.result));

    // Verify cleanup
    expect((server as any).activeChatProcesses.has(conversationId)).toBe(false);

    await cleanupTestServer(server, testDir);
  });

  it("JSON-RPC response id matches request id", async () => {
    const { server, testDir } = await createTestServer("_testCopilotCmdOverride", [
      "node",
      mockCopilotScriptPath,
    ]);

    const conversationId = `conv-copilot-req-id-${randomUUID()}`;
    const ws = createFakeWs();
    const requestId = "req-copilot-match-456";

    await (server as any).launchCopilotChat(ws, conversationId, "test message", requestId);

    const completion = await waitFor(() => ws.sent.find((m) => m.id === requestId && m.result));

    expect(completion.id).toBe(requestId);
    expect(completion.jsonrpc).toBe("2.0");

    await cleanupTestServer(server, testDir);
  });

  it("concurrent runs with unique conversation IDs don't interfere", async () => {
    const { server, testDir } = await createTestServer("_testCopilotCmdOverride", [
      "node",
      mockCopilotScriptPath,
    ]);

    const conversationId1 = `conv-concurrent-1-${randomUUID()}`;
    const conversationId2 = `conv-concurrent-2-${randomUUID()}`;
    const ws1 = createFakeWs();
    const ws2 = createFakeWs();

    // Launch both concurrently
    await Promise.all([
      (server as any).launchCopilotChat(ws1, conversationId1, "message 1", "req-c1"),
      (server as any).launchCopilotChat(ws2, conversationId2, "message 2", "req-c2"),
    ]);

    // Wait for both to complete
    const completion1 = await waitFor(() => ws1.sent.find((m) => m.id === "req-c1" && m.result));
    const completion2 = await waitFor(() => ws2.sent.find((m) => m.id === "req-c2" && m.result));

    expect(completion1.result.status).toBe("complete");
    expect(completion2.result.status).toBe("complete");

    // Both should be cleaned up
    expect((server as any).activeChatProcesses.has(conversationId1)).toBe(false);
    expect((server as any).activeChatProcesses.has(conversationId2)).toBe(false);

    await cleanupTestServer(server, testDir);
  });
});
