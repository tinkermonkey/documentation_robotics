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

      await writeIndexMeta(meta, tempDir, "cbm");
      const read = await readIndexMeta(tempDir, "cbm");

      expect(read).toEqual(meta);
    });

    it("should return null when index meta file does not exist", async () => {
      const result = await readIndexMeta(tempDir, "cbm");
      expect(result).toBeNull();
    });

    it("should write and read all required fields", async () => {
      const meta: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
        node_count: 42,
        edge_count: 99,
      };

      await writeIndexMeta(meta, tempDir, "cbm");
      const read = await readIndexMeta(tempDir, "cbm");

      expect(read).toEqual(meta);
      expect(read?.node_count).toBe(42);
      expect(read?.edge_count).toBe(99);
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

      await writeIndexMeta(meta1, tempDir, "cbm");
      await writeIndexMeta(meta2, tempDir, "cbm");
      const read = await readIndexMeta(tempDir, "cbm");

      expect(read).toEqual(meta2);
    });

    it("should create state directory including analyzer subdirectory if it does not exist", async () => {
      const meta: IndexMeta = {
        git_head: "test123",
        timestamp: "2025-01-01T00:00:00Z",
        node_count: 0,
        edge_count: 0,
      };

      await writeIndexMeta(meta, tempDir, "cbm");

      // Verify analyzer subdirectory was created
      const analyzerStateDir = path.join(tempDir, ".dr", "analyzers", "cbm");
      const dirExists = await fs
        .access(analyzerStateDir)
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
    });

    it("should support multiple analyzers with separate state files", async () => {
      const meta1: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
        node_count: 10,
        edge_count: 20,
      };

      const meta2: IndexMeta = {
        git_head: "def456",
        timestamp: "2025-01-02T00:00:00Z",
        node_count: 30,
        edge_count: 40,
      };

      // Write metadata for two different analyzers
      await writeIndexMeta(meta1, tempDir, "cbm");
      await writeIndexMeta(meta2, tempDir, "other");

      // Read them back separately
      const read1 = await readIndexMeta(tempDir, "cbm");
      const read2 = await readIndexMeta(tempDir, "other");

      expect(read1).toEqual(meta1);
      expect(read2).toEqual(meta2);

      // Verify files exist in separate directories
      const cbmFile = path.join(tempDir, ".dr", "analyzers", "cbm", "index-meta.json");
      const otherFile = path.join(tempDir, ".dr", "analyzers", "other", "index-meta.json");

      const cbmExists = await fs
        .access(cbmFile)
        .then(() => true)
        .catch(() => false);
      const otherExists = await fs
        .access(otherFile)
        .then(() => true)
        .catch(() => false);

      expect(cbmExists).toBe(true);
      expect(otherExists).toBe(true);
    });

    it("should use pretty-printed JSON format", async () => {
      const meta: IndexMeta = {
        git_head: "abc123",
        timestamp: "2025-01-01T00:00:00Z",
      };

      await writeIndexMeta(meta, tempDir, "cbm");

      const filePath = path.join(tempDir, ".dr", "analyzers", "cbm", "index-meta.json");
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
          node_count: 100,
          edge_count: 250,
        },
        fresh: true,
        last_indexed: "2025-01-01T00:00:00Z",
      };

      await writeStatus(status, tempDir, "cbm");
      const read = await readStatus(tempDir, "cbm");

      expect(read).toEqual(status);
    });

    it("should return null when status file does not exist", async () => {
      const result = await readStatus(tempDir, "cbm");
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

      await writeStatus(status, tempDir, "cbm");
      const read = await readStatus(tempDir, "cbm");

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

      await writeStatus(status1, tempDir, "cbm");
      await writeStatus(status2, tempDir, "cbm");
      const read = await readStatus(tempDir, "cbm");

      expect(read).toEqual(status2);
    });

    it("should create state directory including analyzer subdirectory if it does not exist", async () => {
      const status: AnalyzerStatus = {
        detected: { installed: true },
        indexed: false,
        fresh: false,
      };

      await writeStatus(status, tempDir, "cbm");

      // Verify analyzer subdirectory was created
      const analyzerStateDir = path.join(tempDir, ".dr", "analyzers", "cbm");
      const dirExists = await fs
        .access(analyzerStateDir)
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

      await writeStatus(status, tempDir, "cbm");

      const filePath = path.join(tempDir, ".dr", "analyzers", "cbm", "status.json");
      const content = await fs.readFile(filePath, "utf-8");

      // Pretty-printed JSON should have newlines and indentation
      expect(content).toContain("\n");
      expect(content).toContain("  ");
    });

    it("should support multiple analyzers with separate state files", async () => {
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

      // Write status for two different analyzers
      await writeStatus(status1, tempDir, "cbm");
      await writeStatus(status2, tempDir, "other");

      // Read them back separately
      const read1 = await readStatus(tempDir, "cbm");
      const read2 = await readStatus(tempDir, "other");

      expect(read1).toEqual(status1);
      expect(read2).toEqual(status2);

      // Verify files exist in separate directories
      const cbmFile = path.join(tempDir, ".dr", "analyzers", "cbm", "status.json");
      const otherFile = path.join(tempDir, ".dr", "analyzers", "other", "status.json");

      const cbmExists = await fs
        .access(cbmFile)
        .then(() => true)
        .catch(() => false);
      const otherExists = await fs
        .access(otherFile)
        .then(() => true)
        .catch(() => false);

      expect(cbmExists).toBe(true);
      expect(otherExists).toBe(true);
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
        node_count: 5,
        edge_count: 15,
      };

      const status: AnalyzerStatus = {
        detected: { installed: true },
        indexed: true,
        fresh: true,
      };

      // Session is global, index meta and status are per-analyzer
      await writeSession(session, tempDir);
      await writeIndexMeta(meta, tempDir, "cbm");
      await writeStatus(status, tempDir, "cbm");

      const readSession_result = await readSession(tempDir);
      const readIndexMeta_result = await readIndexMeta(tempDir, "cbm");
      const readStatus_result = await readStatus(tempDir, "cbm");

      expect(readSession_result).toEqual(session);
      expect(readIndexMeta_result).toEqual(meta);
      expect(readStatus_result).toEqual(status);

      // Verify files exist in correct locations
      const sessionFile = path.join(tempDir, ".dr", "analyzers", "session.json");
      const indexMetaFile = path.join(tempDir, ".dr", "analyzers", "cbm", "index-meta.json");
      const statusFile = path.join(tempDir, ".dr", "analyzers", "cbm", "status.json");

      const sessionExists = await fs
        .access(sessionFile)
        .then(() => true)
        .catch(() => false);
      const indexMetaExists = await fs
        .access(indexMetaFile)
        .then(() => true)
        .catch(() => false);
      const statusExists = await fs
        .access(statusFile)
        .then(() => true)
        .catch(() => false);

      expect(sessionExists).toBe(true);
      expect(indexMetaExists).toBe(true);
      expect(statusExists).toBe(true);
    });
  });

  describe("Validation", () => {
    it("should reject corrupted session state (missing required fields)", async () => {
      const corruptedPath = path.join(tempDir, ".dr", "analyzers", "session.json");
      await fs.mkdir(path.dirname(corruptedPath), { recursive: true });
      await fs.writeFile(corruptedPath, JSON.stringify({}), "utf-8");

      const error = await readSession(tempDir)
        .then(() => null)
        .catch((e) => e);

      expect(error).toBeDefined();
      expect(error instanceof Error).toBe(true);
    });

    it("should reject corrupted index metadata (missing required fields)", async () => {
      const corruptedPath = path.join(
        tempDir,
        ".dr",
        "analyzers",
        "cbm",
        "index-meta.json"
      );
      await fs.mkdir(path.dirname(corruptedPath), { recursive: true });
      await fs.writeFile(
        corruptedPath,
        JSON.stringify({ git_head: "abc123" }),
        "utf-8"
      );

      const error = await readIndexMeta(tempDir, "cbm")
        .then(() => null)
        .catch((e) => e);

      expect(error).toBeDefined();
      expect(error instanceof Error).toBe(true);
    });

    it("should reject corrupted analyzer status (missing required fields)", async () => {
      const corruptedPath = path.join(
        tempDir,
        ".dr",
        "analyzers",
        "cbm",
        "status.json"
      );
      await fs.mkdir(path.dirname(corruptedPath), { recursive: true });
      await fs.writeFile(corruptedPath, JSON.stringify({}), "utf-8");

      const error = await readStatus(tempDir, "cbm")
        .then(() => null)
        .catch((e) => e);

      expect(error).toBeDefined();
      expect(error instanceof Error).toBe(true);
    });

    it("should reject malformed JSON", async () => {
      const badPath = path.join(tempDir, ".dr", "analyzers", "session.json");
      await fs.mkdir(path.dirname(badPath), { recursive: true });
      await fs.writeFile(badPath, "{ invalid json }", "utf-8");

      const error = await readSession(tempDir)
        .then(() => null)
        .catch((e) => e);

      expect(error).toBeDefined();
      expect(error instanceof Error).toBe(true);
    });

    it("should reject null values for required fields", async () => {
      const badPath = path.join(
        tempDir,
        ".dr",
        "analyzers",
        "cbm",
        "index-meta.json"
      );
      await fs.mkdir(path.dirname(badPath), { recursive: true });
      await fs.writeFile(
        badPath,
        JSON.stringify({ git_head: null, timestamp: "2025-01-01T00:00:00Z" }),
        "utf-8"
      );

      const error = await readIndexMeta(tempDir, "cbm")
        .then(() => null)
        .catch((e) => e);

      expect(error).toBeDefined();
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle minimal valid data", async () => {
      const meta: IndexMeta = {
        git_head: "",
        timestamp: "",
        node_count: 0,
        edge_count: 0,
      };

      await writeIndexMeta(meta, tempDir, "cbm");
      const read = await readIndexMeta(tempDir, "cbm");

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
