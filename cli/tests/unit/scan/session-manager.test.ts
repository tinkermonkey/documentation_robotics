import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
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
} from "../../../src/scan/session-manager.js";
import { CLIError } from "../../../src/utils/errors.js";

describe("Session Manager", () => {
  let testWorkspace: string;

  beforeEach(() => {
    // Create temporary workspace directory
    testWorkspace = join(tmpdir(), `test-session-${Date.now()}`);
    mkdirSync(testWorkspace, { recursive: true });
    mkdirSync(join(testWorkspace, "documentation-robotics"), { recursive: true });
  });

  afterEach(() => {
    // Clean up test workspace
    try {
      const sessionPath = getSessionPath(testWorkspace);
      if (existsSync(sessionPath)) {
        unlinkSync(sessionPath);
      }
      const docRoboticsPath = join(testWorkspace, "documentation-robotics");
      if (existsSync(docRoboticsPath)) {
        unlinkSync(docRoboticsPath);
      }
      if (existsSync(testWorkspace)) {
        unlinkSync(testWorkspace);
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
});
