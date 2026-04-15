import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionFileSchema,
  getSessionPath,
  isProcessAlive,
  calculateUptime,
  loadSessionFile,
  saveSessionFile,
  removeSessionFile,
  getSessionState,
  startSession,
  stopSession,
  querySession,
  createSessionClient,
  __test_setActiveSession,
  __test_clearActiveSessions,
} from "../../../src/scan/session-manager.js";
import { CLIError } from "../../../src/utils/errors.js";
import type { MCPClient, LoadedScanConfig } from "../../../src/scan/mcp-client.js";

describe("Session Manager", () => {
  let testWorkspace: string;

  beforeEach(() => {
    // Create temporary workspace directory
    testWorkspace = join(tmpdir(), `test-session-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });
    mkdirSync(join(testWorkspace, "documentation-robotics"), { recursive: true });
  });

  afterEach(async () => {
    // Clean up test workspace and sessions
    __test_clearActiveSessions();
    try {
      const sessionPath = getSessionPath(testWorkspace);
      if (existsSync(sessionPath)) {
        unlinkSync(sessionPath);
      }
      if (existsSync(testWorkspace)) {
        const { rm } = await import("node:fs/promises");
        await rm(testWorkspace, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("SessionFileSchema", () => {
    it("should validate session with positive PID", () => {
      const session = {
        pid: 12345,
        workspace: "/workspace",
        status: "ready" as const,
        indexed_files: 100,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      const result = SessionFileSchema.safeParse(session);
      expect(result.success).toBe(true);
    });

    it("should validate session with pid=-1 (persistent marker)", () => {
      const session = {
        pid: -1,
        workspace: "/workspace",
        status: "ready" as const,
        indexed_files: 100,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      const result = SessionFileSchema.safeParse(session);
      expect(result.success).toBe(true);
    });

    it("should reject session with invalid status", () => {
      const session = {
        pid: 12345,
        workspace: "/workspace",
        status: "invalid",
        indexed_files: 100,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      const result = SessionFileSchema.safeParse(session);
      expect(result.success).toBe(false);
    });

    it("should reject session with negative indexed_files", () => {
      const session = {
        pid: 12345,
        workspace: "/workspace",
        status: "ready" as const,
        indexed_files: -5,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      const result = SessionFileSchema.safeParse(session);
      expect(result.success).toBe(false);
    });
  });

  describe("getSessionPath", () => {
    it("should return correct path for workspace", () => {
      const path = getSessionPath("/some/workspace");
      expect(path).toBe("/some/workspace/documentation-robotics/.scan-session");
    });
  });

  describe("isProcessAlive", () => {
    it("should return true for current process PID", () => {
      const alive = isProcessAlive(process.pid);
      expect(alive).toBe(true);
    });

    it("should return false for invalid PID", () => {
      const alive = isProcessAlive(999999); // Unlikely to exist
      expect(alive).toBe(false);
    });
  });

  describe("calculateUptime", () => {
    it("should calculate uptime in seconds", () => {
      const now = new Date();
      const past = new Date(now.getTime() - 45000); // 45 seconds ago
      const uptime = calculateUptime(past.toISOString());
      expect(uptime).toMatch(/\d+s/);
    });

    it("should calculate uptime in minutes", () => {
      const now = new Date();
      const past = new Date(now.getTime() - 5 * 60000); // 5 minutes ago
      const uptime = calculateUptime(past.toISOString());
      expect(uptime).toMatch(/\d+m/);
    });

    it("should calculate uptime in hours", () => {
      const now = new Date();
      const past = new Date(now.getTime() - 2 * 3600000); // 2 hours ago
      const uptime = calculateUptime(past.toISOString());
      expect(uptime).toMatch(/\d+h/);
    });
  });

  describe("loadSessionFile", () => {
    it("should return null when session file does not exist", async () => {
      const session = await loadSessionFile(testWorkspace);
      expect(session).toBe(null);
    });

    it("should load valid session file", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: 12345,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      const loaded = await loadSessionFile(testWorkspace);
      expect(loaded).toBeDefined();
      expect(loaded?.pid).toBe(12345);
      expect(loaded?.workspace).toBe(testWorkspace);
    });

    it("should load session file with pid=-1 marker", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      const loaded = await loadSessionFile(testWorkspace);
      expect(loaded).toBeDefined();
      expect(loaded?.pid).toBe(-1);
    });

    it("should throw CLIError for corrupted session file", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      writeFileSync(sessionPath, "invalid json {");

      try {
        await loadSessionFile(testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
      }
    });

    it("should throw CLIError for invalid session data", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const invalidData = {
        pid: -1,
        workspace: testWorkspace,
        status: "invalid_status",
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(invalidData));

      try {
        await loadSessionFile(testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
      }
    });
  });

  describe("saveSessionFile", () => {
    it("should save valid session file", async () => {
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };

      await saveSessionFile(testWorkspace, sessionData);

      const sessionPath = getSessionPath(testWorkspace);
      expect(existsSync(sessionPath)).toBe(true);

      const loaded = await loadSessionFile(testWorkspace);
      expect(loaded?.pid).toBe(-1);
      expect(loaded?.indexed_files).toBe(150);
    });

    it("should throw CLIError for invalid session data", async () => {
      const invalidData = {
        pid: -1,
        workspace: testWorkspace,
        status: "invalid_status",
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      } as any;

      try {
        await saveSessionFile(testWorkspace, invalidData);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
      }
    });
  });

  describe("removeSessionFile", () => {
    it("should remove existing session file", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: 12345,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));
      expect(existsSync(sessionPath)).toBe(true);

      await removeSessionFile(testWorkspace);

      expect(existsSync(sessionPath)).toBe(false);
    });

    it("should not throw when session file does not exist", async () => {
      // Should not throw
      await removeSessionFile(testWorkspace);
      expect(true).toBe(true);
    });
  });

  describe("getSessionState", () => {
    it("should return null when no session file exists", async () => {
      const state = await getSessionState(testWorkspace);
      expect(state).toBe(null);
    });

    it("should return inactive state for pid=-1 when not in cache", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      const state = await getSessionState(testWorkspace);
      expect(state).toBeDefined();
      expect(state?.isActive).toBe(false);
      expect(state?.status).toBe("stopped");
      expect(state?.pid).toBe(-1);
    });

    it("should return inactive state for positive PID when process is not alive", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: 999999, // Non-existent PID
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      const state = await getSessionState(testWorkspace);
      expect(state).toBeDefined();
      expect(state?.isActive).toBe(false);
      expect(state?.pid).toBe(999999);
    });

    it("should return active state for current process PID", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: process.pid,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: new Date().toISOString(),
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      const state = await getSessionState(testWorkspace);
      expect(state).toBeDefined();
      expect(state?.isActive).toBe(true);
      expect(state?.pid).toBe(process.pid);
    });

    it("should include uptime calculation in state", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const now = new Date();
      const startTime = new Date(now.getTime() - 60000); // 1 minute ago
      const sessionData = {
        pid: process.pid,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: startTime.toISOString(),
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      const state = await getSessionState(testWorkspace);
      expect(state?.uptime).toBeDefined();
      expect(state?.uptime).toMatch(/\d+m/);
    });
  });

  describe("startSession", () => {
    it("should throw error when session already exists and is active", async () => {
      // Create an existing session
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: process.pid,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: new Date().toISOString(),
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      const config: LoadedScanConfig = {
        codeprism: {
          command: "codeprism",
          args: ["--mcp"],
          timeout: 5000,
        },
        confidence_threshold: 0.7,
        disabled_patterns: [],
      };

      try {
        await startSession(testWorkspace, config);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("already active");
      }
    });

    it("should throw timeout error when indexing takes too long", async () => {
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async () => {
          // Always throw an error to simulate CodePrism not responding
          throw new Error("CodePrism not responding");
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {}),
      };

      const config: LoadedScanConfig = {
        codeprism: {
          command: "codeprism",
          args: ["--mcp"],
          timeout: 5000,
        },
        confidence_threshold: 0.7,
        disabled_patterns: [],
      };

      // Use a mock client factory and very short timeout to test timeout behavior
      const mockFactory = mock(async () => mockClient);

      try {
        await startSession(testWorkspace, config, {
          maxWaitMs: 100, // Very short timeout to trigger immediately
          pollIntervalMs: 10,
          clientFactory: mockFactory,
        });
        throw new Error("Should have thrown timeout error");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("timeout");
      }
    });
  });

  describe("stopSession", () => {
    it("should throw error when no session exists", async () => {
      try {
        await stopSession(testWorkspace);
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("No active session");
      }
    });

    it("should remove session file when session exists", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      expect(existsSync(sessionPath)).toBe(true);

      // Create a mock client and cache it
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async () => []),
        listTools: mock(async () => []),
        disconnect: mock(async () => {}),
      };

      // We would need to inject the client into the cache for this to work
      // Instead, we test the file removal behavior directly
      await stopSession(testWorkspace);

      expect(existsSync(sessionPath)).toBe(false);
    });

    it("should handle disconnect errors gracefully", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      // Create a mock client that throws on disconnect
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async () => []),
        listTools: mock(async () => []),
        disconnect: mock(async () => {
          throw new Error("Failed to disconnect");
        }),
      };

      // Inject the client into the active sessions
      __test_setActiveSession(testWorkspace, mockClient);

      // stopSession should log the error but still remove the session file
      await stopSession(testWorkspace);

      // Session file should be removed even though disconnect failed
      expect(existsSync(sessionPath)).toBe(false);
    });
  });

  describe("querySession", () => {
    it("should throw error when no session exists", async () => {
      try {
        await querySession(testWorkspace, "repository_stats", {});
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("No active session");
      }
    });

    it("should throw error when session not in cache", async () => {
      // Create a session file without caching a client
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      try {
        await querySession(testWorkspace, "repository_stats", {});
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("not found in cache");
      }
    });

    it("should forward tool call to cached client", async () => {
      // Create a session file
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      // Create a mock client and inject it into the cache
      const mockToolResult = [
        { type: "text" as const, text: "test result" },
      ];
      const mockClient: MCPClient = {
        isConnected: true,
        callTool: mock(async (toolName: string, toolArgs) => {
          expect(toolName).toBe("test_tool");
          expect(toolArgs).toEqual({ param: "value" });
          return mockToolResult;
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {}),
      };

      // Inject the mock client into the active sessions
      __test_setActiveSession(testWorkspace, mockClient);

      // Now querySession should delegate to the cached client
      const result = await querySession(testWorkspace, "test_tool", {
        param: "value",
      });

      expect(result).toEqual(mockToolResult);
      expect(mockClient.callTool).toHaveBeenCalled();
    });

    it("should invalidate session when connection is lost", async () => {
      // Create a session file
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      // Create a mock client that's marked as disconnected
      const mockClient: MCPClient = {
        isConnected: false, // Connection is lost
        callTool: mock(async () => {
          throw new Error("Connection lost");
        }),
        listTools: mock(async () => []),
        disconnect: mock(async () => {}),
      };

      // Inject the disconnected client into the active sessions
      __test_setActiveSession(testWorkspace, mockClient);

      // querySession should detect the lost connection and invalidate the session
      try {
        await querySession(testWorkspace, "test_tool", {});
        throw new Error("Should have thrown CLIError");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("connection lost");
      }
    });
  });

  describe("createSessionClient", () => {
    it("should create a session-based MCP client wrapper when session is in cache", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      // Set up a mock client in the cache
      const mockClient: MCPClient = {
        isConnected: true,
        async callTool() {
          return [];
        },
        async listTools() {
          return [];
        },
        async disconnect() {},
      };
      __test_setActiveSession(testWorkspace, mockClient);

      const client = createSessionClient(testWorkspace);

      expect(client.isConnected).toBe(true);

      // listTools should throw as documented
      try {
        await client.listTools();
        throw new Error("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("not supported");
      }

      // disconnect should be a no-op
      await client.disconnect();
      // Should not throw
    });

    it("should throw when session is not in cache", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      // Don't set up a client in the cache - this simulates cross-process invocation
      try {
        createSessionClient(testWorkspace);
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error instanceof CLIError).toBe(true);
        expect((error as CLIError).message).toContain("Session not found in current process");
      }
    });

    it("should delegate callTool to querySession when client is in cache", async () => {
      const sessionPath = getSessionPath(testWorkspace);
      const sessionData = {
        pid: -1,
        workspace: testWorkspace,
        status: "ready" as const,
        indexed_files: 150,
        started_at: "2026-01-01T00:00:00Z",
        endpoint: "codeprism:--mcp",
      };
      writeFileSync(sessionPath, JSON.stringify(sessionData));

      // Set up a mock client in the cache
      const mockClient: MCPClient = {
        isConnected: true,
        async callTool(toolName: string, toolArgs: Record<string, unknown>) {
          return [{ type: "text" as const, text: "test result" }];
        },
        async listTools() {
          return [];
        },
        async disconnect() {},
      };
      __test_setActiveSession(testWorkspace, mockClient);

      const client = createSessionClient(testWorkspace);

      // callTool should delegate to querySession successfully
      const result = await client.callTool("test_tool", {});
      expect(result).toEqual([{ type: "text", text: "test result" }]);
    });
  });
});
