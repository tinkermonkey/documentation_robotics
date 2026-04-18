/**
 * Session State Unit Tests
 *
 * Tests for state file persistence including:
 * - Read/write round-trips for session, index meta, and status
 * - Graceful null return on missing files
 * - Directory creation with recursive flag
 * - JSON serialization/deserialization
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";
import {
  readSession,
  writeSession,
  readIndexMeta,
  writeIndexMeta,
  readStatus,
  writeStatus,
} from "@/analyzers/session-state";
import type { SessionState, IndexMeta, AnalyzerStatus } from "@/analyzers/types";

// Helper to get state directory path
function getStateDir(): string {
  return path.join(process.cwd(), ".dr", "analyzers");
}

// Helper to cleanup state files
async function cleanupStateDir(): Promise<void> {
  try {
    await fs.rm(getStateDir(), { recursive: true, force: true });
  } catch {
    // Ignore if directory doesn't exist
  }
}

describe("Session State Persistence", () => {
  beforeEach(async () => {
    await cleanupStateDir();
  });

  afterEach(async () => {
    await cleanupStateDir();
  });

  describe("readSession() / writeSession()", () => {
    it("should write and read session state", async () => {
      const session: SessionState = {
        active_analyzer: "cbm",
        selected_at: "2025-01-01T00:00:00Z",
      };

      await writeSession(session);
      const read = await readSession();

      expect(read).toEqual(session);
    });

    it("should return null when session file does not exist", async () => {
      const result = await readSession();
      expect(result).toBeNull();
    });

    it("should overwrite existing session", async () => {
      const session1: SessionState = {
        active_analyzer: "cbm",
        selected_at: "2025-01-01T00:00:00Z",
      };

      const session2: SessionState = {
        active_analyzer: "other",
        selected_at: "2025-01-02T00:00:00Z",
      };

      await writeSession(session1);
      await writeSession(session2);
      const read = await readSession();

      expect(read).toEqual(session2);
    });

    it("should create state directory if it does not exist", async () => {
      const stateDir = getStateDir();
      const exists = await fs
        .access(stateDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        await fs.rm(stateDir, { recursive: true, force: true });
      }

      const session: SessionState = {
        active_analyzer: "test",
        selected_at: "2025-01-01T00:00:00Z",
      };

      await writeSession(session);

      // Verify directory was created
      const dirExists = await fs
        .access(stateDir)
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
    });

    it("should use pretty-printed JSON format", async () => {
      const session: SessionState = {
        active_analyzer: "cbm",
        selected_at: "2025-01-01T00:00:00Z",
      };

      await writeSession(session);

      const filePath = path.join(getStateDir(), "session.json");
      const content = await fs.readFile(filePath, "utf-8");

      // Pretty-printed JSON should have newlines and indentation
      expect(content).toContain("\n");
      expect(content).toContain("  ");
    });
  });

  describe("readIndexMeta() / writeIndexMeta()", () => {
    it("should write and read index metadata", async () => {
      const meta: IndexMeta = {
        git_head: "abc123def456",
        timestamp: "2025-01-01T00:00:00Z",
        node_count: 100,
        edge_count: 250,
      };

      await writeIndexMeta(meta);
      const read = await readIndexMeta();

      expect(read).toEqual(meta);
    });

    it("should return null when index meta file does not exist", async () => {
      const result = await readIndexMeta();
      expect(result).toBeNull();
    });

    it("should handle optional fields", async () => {
      const meta: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await writeIndexMeta(meta);
      const read = await readIndexMeta();

      expect(read).toEqual(meta);
      expect(read?.node_count).toBeUndefined();
      expect(read?.edge_count).toBeUndefined();
    });

    it("should overwrite existing index meta", async () => {
      const meta1: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
        node_count: 50,
        edge_count: 100,
      };

      const meta2: IndexMeta = {
        git_head: "def456",
        timestamp: "2025-01-02T00:00:00Z",
        node_count: 75,
        edge_count: 150,
      };

      await writeIndexMeta(meta1);
      await writeIndexMeta(meta2);
      const read = await readIndexMeta();

      expect(read).toEqual(meta2);
    });

    it("should create state directory if it does not exist", async () => {
      const stateDir = getStateDir();
      const exists = await fs
        .access(stateDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        await fs.rm(stateDir, { recursive: true, force: true });
      }

      const meta: IndexMeta = {
        git_head: "test123",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await writeIndexMeta(meta);

      // Verify directory was created
      const dirExists = await fs
        .access(stateDir)
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
    });

    it("should use pretty-printed JSON format", async () => {
      const meta: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await writeIndexMeta(meta);

      const filePath = path.join(getStateDir(), "index.meta.json");
      const content = await fs.readFile(filePath, "utf-8");

      // Pretty-printed JSON should have newlines and indentation
      expect(content).toContain("\n");
      expect(content).toContain("  ");
    });
  });

  describe("readStatus() / writeStatus()", () => {
    it("should write and read analyzer status", async () => {
      const status: AnalyzerStatus = {
        detected: {
          installed: true,
          binary_path: "/usr/bin/cbm",
          version: "1.0.0",
        },
        indexed: true,
        index_meta: {
          git_head: "abc123",
          timestamp: "2025-01-01T00:00:00Z",
        },
        fresh: true,
        last_indexed: "2025-01-01T00:00:00Z",
      };

      await writeStatus(status);
      const read = await readStatus();

      expect(read).toEqual(status);
    });

    it("should return null when status file does not exist", async () => {
      const result = await readStatus();
      expect(result).toBeNull();
    });

    it("should handle optional fields", async () => {
      const status: AnalyzerStatus = {
        detected: {
          installed: false,
        },
        indexed: false,
        fresh: false,
      };

      await writeStatus(status);
      const read = await readStatus();

      expect(read).toEqual(status);
      expect(read?.index_meta).toBeUndefined();
      expect(read?.last_indexed).toBeUndefined();
    });

    it("should overwrite existing status", async () => {
      const status1: AnalyzerStatus = {
        detected: { installed: true, binary_path: "/usr/bin/cbm" },
        indexed: true,
        fresh: true,
      };

      const status2: AnalyzerStatus = {
        detected: { installed: false },
        indexed: false,
        fresh: false,
      };

      await writeStatus(status1);
      await writeStatus(status2);
      const read = await readStatus();

      expect(read).toEqual(status2);
    });

    it("should create state directory if it does not exist", async () => {
      const stateDir = getStateDir();
      const exists = await fs
        .access(stateDir)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        await fs.rm(stateDir, { recursive: true, force: true });
      }

      const status: AnalyzerStatus = {
        detected: { installed: true },
        indexed: false,
        fresh: false,
      };

      await writeStatus(status);

      // Verify directory was created
      const dirExists = await fs
        .access(stateDir)
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
    });

    it("should use pretty-printed JSON format", async () => {
      const status: AnalyzerStatus = {
        detected: { installed: true },
        indexed: false,
        fresh: false,
      };

      await writeStatus(status);

      const filePath = path.join(getStateDir(), "status.json");
      const content = await fs.readFile(filePath, "utf-8");

      // Pretty-printed JSON should have newlines and indentation
      expect(content).toContain("\n");
      expect(content).toContain("  ");
    });
  });

  describe("Multiple state files", () => {
    it("should maintain separate files for session, index meta, and status", async () => {
      const session: SessionState = {
        active_analyzer: "cbm",
        selected_at: "2025-01-01T00:00:00Z",
      };

      const meta: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
      };

      const status: AnalyzerStatus = {
        detected: { installed: true },
        indexed: true,
        fresh: true,
      };

      await writeSession(session);
      await writeIndexMeta(meta);
      await writeStatus(status);

      const readSession_result = await readSession();
      const readIndexMeta_result = await readIndexMeta();
      const readStatus_result = await readStatus();

      expect(readSession_result).toEqual(session);
      expect(readIndexMeta_result).toEqual(meta);
      expect(readStatus_result).toEqual(status);

      // Verify all files exist
      const stateDir = getStateDir();
      const files = await fs.readdir(stateDir);
      expect(files).toContain("session.json");
      expect(files).toContain("index.meta.json");
      expect(files).toContain("status.json");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty objects", async () => {
      const meta: IndexMeta = {
        git_head: "",
        timestamp: "",
      };

      await writeIndexMeta(meta);
      const read = await readIndexMeta();

      expect(read).toEqual(meta);
    });

    it("should preserve special characters in strings", async () => {
      const session: SessionState = {
        active_analyzer: 'test"with"quotes',
        selected_at: "2025-01-01T00:00:00Z",
      };

      await writeSession(session);
      const read = await readSession();

      expect(read?.active_analyzer).toBe(session.active_analyzer);
    });

    it("should handle concurrent operations", async () => {
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          writeSession({
            active_analyzer: `analyzer-${i}`,
            selected_at: new Date().toISOString(),
          })
        );
      }

      await Promise.all(promises);
      const read = await readSession();

      expect(read).toBeDefined();
      expect(read?.active_analyzer).toMatch(/^analyzer-/);
    });
  });
});
