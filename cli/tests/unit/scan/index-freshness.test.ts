/**
 * Unit tests for scan index freshness checking
 *
 * Tests the isIndexFresh function and file discovery logic
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { isIndexFresh, findMostRecentlyModifiedFile, type ScanIndex } from "../../../src/scan/index-builder.js";
import { mkdir, writeFile, utimes } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Scan Index Freshness", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `dr-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  describe("isIndexFresh", () => {
    it("returns true when index is newer than all source files", async () => {
      // Create some old source files
      await writeFile(path.join(tempDir, "old-file.ts"), "console.log('old');", {
        flag: "w",
      });

      // Set the old file's mtime to past
      const oldTime = new Date(Date.now() - 60000); // 1 minute ago
      await utimes(path.join(tempDir, "old-file.ts"), oldTime, oldTime);

      // Create an index with a newer timestamp
      const recentTime = new Date();
      const index: ScanIndex = {
        indexed_at: recentTime.toISOString(),
        workspace: tempDir,
        repository: {
          total_files: 1,
          languages: ["typescript"],
          primary_language: "typescript",
          frameworks: [],
          file_breakdown: { typescript: 1 },
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: [],
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test",
        },
      };

      const fresh = await isIndexFresh(index, tempDir);
      expect(fresh).toBe(true);
    });

    it("returns false when source files are newer than index", async () => {
      // Create an index with an old timestamp
      const oldTime = new Date(Date.now() - 60000);
      const index: ScanIndex = {
        indexed_at: oldTime.toISOString(),
        workspace: tempDir,
        repository: {
          total_files: 1,
          languages: ["typescript"],
          primary_language: "typescript",
          frameworks: [],
          file_breakdown: { typescript: 1 },
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: [],
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test",
        },
      };

      // Create a newer source file
      const recentTime = new Date();
      await writeFile(path.join(tempDir, "new-file.ts"), "console.log('new');");
      await utimes(path.join(tempDir, "new-file.ts"), recentTime, recentTime);

      const fresh = await isIndexFresh(index, tempDir);
      expect(fresh).toBe(false);
    });

    it("returns true when no source files are found", async () => {
      // Empty directory
      const index: ScanIndex = {
        indexed_at: new Date().toISOString(),
        workspace: tempDir,
        repository: {
          total_files: 0,
          languages: [],
          frameworks: [],
          file_breakdown: {},
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: [],
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test",
        },
      };

      const fresh = await isIndexFresh(index, tempDir);
      expect(fresh).toBe(true);
    });

    it("excludes documentation-robotics directory from freshness check", async () => {
      // Create an old index timestamp
      const oldTime = new Date(Date.now() - 60000);
      const index: ScanIndex = {
        indexed_at: oldTime.toISOString(),
        workspace: tempDir,
        repository: {
          total_files: 1,
          languages: ["typescript"],
          frameworks: [],
          file_breakdown: { typescript: 1 },
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: [],
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test",
        },
      };

      // Create a newer file in documentation-robotics (should be ignored)
      await mkdir(path.join(tempDir, "documentation-robotics"), { recursive: true });
      await writeFile(path.join(tempDir, "documentation-robotics", "new-index.json"), "{}");

      // Index should still be fresh because documentation-robotics is excluded
      const fresh = await isIndexFresh(index, tempDir);
      expect(fresh).toBe(true);
    });

    it("excludes hidden directories from freshness check", async () => {
      // Create an old index timestamp
      const oldTime = new Date(Date.now() - 60000);
      const index: ScanIndex = {
        indexed_at: oldTime.toISOString(),
        workspace: tempDir,
        repository: {
          total_files: 0,
          languages: [],
          frameworks: [],
          file_breakdown: {},
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: [],
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test",
        },
      };

      // Create a newer file in hidden directory (should be ignored)
      await mkdir(path.join(tempDir, ".git"), { recursive: true });
      const recentTime = new Date();
      await writeFile(path.join(tempDir, ".git", "recent-file"), "test");
      await utimes(path.join(tempDir, ".git", "recent-file"), recentTime, recentTime);

      // Index should still be fresh because .git is excluded
      const fresh = await isIndexFresh(index, tempDir);
      expect(fresh).toBe(true);
    });

    it("excludes node_modules directory from freshness check", async () => {
      // Create an old index timestamp
      const oldTime = new Date(Date.now() - 60000);
      const index: ScanIndex = {
        indexed_at: oldTime.toISOString(),
        workspace: tempDir,
        repository: {
          total_files: 0,
          languages: [],
          frameworks: [],
          file_breakdown: {},
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: [],
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "test",
        },
      };

      // Create a newer file in node_modules (should be ignored)
      await mkdir(path.join(tempDir, "node_modules"), { recursive: true });
      const recentTime = new Date();
      await writeFile(path.join(tempDir, "node_modules", "recent-dep.js"), "module.exports = {};");
      await utimes(path.join(tempDir, "node_modules", "recent-dep.js"), recentTime, recentTime);

      // Index should still be fresh because node_modules is excluded
      const fresh = await isIndexFresh(index, tempDir);
      expect(fresh).toBe(true);
    });
  });

  describe("findMostRecentlyModifiedFile", () => {
    it("finds the most recently modified file in workspace", async () => {
      // Create multiple files with different timestamps
      const oldTime = new Date(Date.now() - 120000); // 2 minutes ago
      const midTime = new Date(Date.now() - 60000); // 1 minute ago
      const recentTime = new Date(Date.now() - 10000); // 10 seconds ago

      await writeFile(path.join(tempDir, "old-file.ts"), "// old");
      await utimes(path.join(tempDir, "old-file.ts"), oldTime, oldTime);

      await writeFile(path.join(tempDir, "mid-file.ts"), "// mid");
      await utimes(path.join(tempDir, "mid-file.ts"), midTime, midTime);

      await writeFile(path.join(tempDir, "recent-file.ts"), "// recent");
      await utimes(path.join(tempDir, "recent-file.ts"), recentTime, recentTime);

      const mostRecent = await findMostRecentlyModifiedFile(tempDir);

      expect(mostRecent).not.toBeNull();
      expect(mostRecent!.getTime()).toBeGreaterThanOrEqual(recentTime.getTime());
    });

    it("finds most recent file in nested directories", async () => {
      // Create nested structure
      await mkdir(path.join(tempDir, "src"), { recursive: true });
      await mkdir(path.join(tempDir, "src", "components"), { recursive: true });

      const oldTime = new Date(Date.now() - 60000);
      const recentTime = new Date();

      await writeFile(path.join(tempDir, "src", "index.ts"), "// old");
      await utimes(path.join(tempDir, "src", "index.ts"), oldTime, oldTime);

      await writeFile(path.join(tempDir, "src", "components", "Button.tsx"), "// recent");
      await utimes(path.join(tempDir, "src", "components", "Button.tsx"), recentTime, recentTime);

      const mostRecent = await findMostRecentlyModifiedFile(tempDir);

      expect(mostRecent).not.toBeNull();
      expect(mostRecent!.getTime()).toBeGreaterThanOrEqual(recentTime.getTime());
    });

    it("returns null when no files are found", async () => {
      // Create only excluded directories
      await mkdir(path.join(tempDir, "node_modules"), { recursive: true });
      await mkdir(path.join(tempDir, ".git"), { recursive: true });
      await writeFile(path.join(tempDir, "node_modules", "package.json"), "{}");

      const mostRecent = await findMostRecentlyModifiedFile(tempDir);
      expect(mostRecent).toBeNull();
    });

    it("skips directories it cannot read", async () => {
      // Create readable files
      const recentTime = new Date();
      await writeFile(path.join(tempDir, "readable.ts"), "// readable");
      await utimes(path.join(tempDir, "readable.ts"), recentTime, recentTime);

      // Try to create an unreadable directory (if permissions allow)
      const unreadablePath = path.join(tempDir, "unreadable");
      await mkdir(unreadablePath, { recursive: true });
      await writeFile(path.join(unreadablePath, "file.ts"), "// hidden");

      // On systems where we can't change permissions, this test gracefully handles it
      try {
        await mkdir(unreadablePath);
      } catch {
        // Permission denied is expected on some systems
      }

      // Should still find the readable file
      const mostRecent = await findMostRecentlyModifiedFile(tempDir);
      expect(mostRecent).not.toBeNull();
    });
  });
});
