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
import { randomUUID } from "crypto";
import * as os from "os";
import {
  readSession,
  writeSession,
  readIndexMeta,
  writeIndexMeta,
  readStatus,
  writeStatus,
} from "../../../src/analyzers/session-state.js";
import type { SessionState, IndexMeta, AnalyzerStatus } from "../../../src/analyzers/types.js";

// Helper to create a unique temp directory for each test
function createTempDir(): string {
  return path.join(os.tmpdir(), `session-state-test-${randomUUID()}`);
}

describe("Session State Persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
  });

  describe("readSession() / writeSession()", () => {
    it("should write and read session state", async () => {
      const session: SessionState = {
        active_analyzer: "cbm",
        selected_at: "2025-01-01T00:00:00Z",
      };

      await writeSession(session, tempDir);
      const read = await readSession(tempDir);

      expect(read).toEqual(session);
    });

    it("should return null when session file does not exist", async () => {
      const result = await readSession(tempDir);
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

      await writeSession(session1, tempDir);
      await writeSession(session2, tempDir);
      const read = await readSession(tempDir);

      expect(read).toEqual(session2);
    });

    it("should create state directory if it does not exist", async () => {
      const session: SessionState = {
        active_analyzer: "test",
        selected_at: "2025-01-01T00:00:00Z",
      };

      await writeSession(session, tempDir);

      // Verify directory was created
      const stateDir = path.join(tempDir, ".dr", "analyzers");
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

      await writeSession(session, tempDir);

      const filePath = path.join(tempDir, ".dr", "analyzers", "session.json");
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

      await writeIndexMeta(meta, tempDir);
      const read = await readIndexMeta(tempDir);

      expect(read).toEqual(meta);
    });

    it("should return null when index meta file does not exist", async () => {
      const result = await readIndexMeta(tempDir);
      expect(result).toBeNull();
    });

    it("should handle optional fields", async () => {
      const meta: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await writeIndexMeta(meta, tempDir);
      const read = await readIndexMeta(tempDir);

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

      await writeIndexMeta(meta1, tempDir);
      await writeIndexMeta(meta2, tempDir);
      const read = await readIndexMeta(tempDir);

      expect(read).toEqual(meta2);
    });

    it("should create state directory if it does not exist", async () => {
      const meta: IndexMeta = {
        git_head: "test123",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await writeIndexMeta(meta, tempDir);

      // Verify directory was created
      const stateDir = path.join(tempDir, ".dr", "analyzers");
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

      await writeIndexMeta(meta, tempDir);

      const filePath = path.join(tempDir, ".dr", "analyzers", "index.meta.json");
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

      await writeStatus(status, tempDir);
      const read = await readStatus(tempDir);

      expect(read).toEqual(status);
    });

    it("should return null when status file does not exist", async () => {
      const result = await readStatus(tempDir);
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

      await writeStatus(status, tempDir);
      const read = await readStatus(tempDir);

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

      await writeStatus(status1, tempDir);
      await writeStatus(status2, tempDir);
      const read = await readStatus(tempDir);

      expect(read).toEqual(status2);
    });

    it("should create state directory if it does not exist", async () => {
      const status: AnalyzerStatus = {
        detected: { installed: true },
        indexed: false,
        fresh: false,
      };

      await writeStatus(status, tempDir);

      // Verify directory was created
      const stateDir = path.join(tempDir, ".dr", "analyzers");
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

      await writeStatus(status, tempDir);

      const filePath = path.join(tempDir, ".dr", "analyzers", "status.json");
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

      await writeSession(session, tempDir);
      await writeIndexMeta(meta, tempDir);
      await writeStatus(status, tempDir);

      const readSession_result = await readSession(tempDir);
      const readIndexMeta_result = await readIndexMeta(tempDir);
      const readStatus_result = await readStatus(tempDir);

      expect(readSession_result).toEqual(session);
      expect(readIndexMeta_result).toEqual(meta);
      expect(readStatus_result).toEqual(status);

      // Verify all files exist
      const stateDir = path.join(tempDir, ".dr", "analyzers");
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

      await writeIndexMeta(meta, tempDir);
      const read = await readIndexMeta(tempDir);

      expect(read).toEqual(meta);
    });

    it("should preserve special characters in strings", async () => {
      const session: SessionState = {
        active_analyzer: 'test"with"quotes',
        selected_at: "2025-01-01T00:00:00Z",
      };

      await writeSession(session, tempDir);
      const read = await readSession(tempDir);

      expect(read?.active_analyzer).toBe(session.active_analyzer);
    });

    it("should handle concurrent operations", async () => {
      const promises = [];

      for (let i = 0; i < 5; i++) {
        promises.push(
          writeSession({
            active_analyzer: `analyzer-${i}`,
            selected_at: new Date().toISOString(),
          }, tempDir)
        );
      }

      await Promise.all(promises);
      const read = await readSession(tempDir);

      expect(read).toBeDefined();
      expect(read?.active_analyzer).toMatch(/^analyzer-/);
    });
  });
});
