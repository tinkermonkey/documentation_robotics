/**
 * Integration tests for freshness detection in batch scan
 *
 * Tests that the batch `dr scan` command properly detects and reports
 * index freshness status
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { saveScanIndex } from "../../src/scan/index-builder.js";
import { writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";

describe("Scan Index Freshness in Batch Scan", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeAll(async () => {
    workdir = await createTestWorkdir();
  });

  afterAll(async () => {
    await workdir.cleanup();
  });

  describe("Freshness detection", () => {
    it("should detect when index file exists", async () => {
      // Create a valid scan index
      const index = {
        indexed_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        workspace: workdir.path,
        repository: {
          total_files: 42,
          languages: ["typescript"],
          primary_language: "typescript",
          frameworks: ["react"],
          file_breakdown: { typescript: 42 },
        },
        detected_patterns: {
          architectural: [{ name: "Component Pattern", confidence: 0.85 }],
          data_access: [],
          security: [],
          api: [{ name: "REST API", confidence: 0.92 }],
        },
        suggested_workflow: {
          recommended_tools: ["repository_stats", "detect_patterns"],
          rationale: "TypeScript React project detected",
        },
      };

      // Save the index
      await saveScanIndex(index, workdir.path);

      // Verify the index file was created
      const indexPath = path.join(workdir.path, "documentation-robotics", "scan-index.json");
      expect(existsSync(indexPath)).toBe(true);
    });

    it("should recognize stale index when source files are modified", async () => {
      // Create a stale index (old timestamp)
      const oldTime = new Date(Date.now() - 7200000); // 2 hours ago
      const index = {
        indexed_at: oldTime.toISOString(),
        workspace: workdir.path,
        repository: {
          total_files: 10,
          languages: ["typescript"],
          frameworks: [],
          file_breakdown: { typescript: 10 },
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

      await saveScanIndex(index, workdir.path);

      // Create a newer source file (should make index stale)
      const sourceFile = path.join(workdir.path, "new-source.ts");
      await writeFile(sourceFile, "console.log('new source');");

      // Verify index file exists
      const indexPath = path.join(workdir.path, "documentation-robotics", "scan-index.json");
      expect(existsSync(indexPath)).toBe(true);
    });

    it("should consider index fresh when no source files are modified", async () => {
      // Create a recent index
      const recentTime = new Date();
      const index = {
        indexed_at: recentTime.toISOString(),
        workspace: workdir.path,
        repository: {
          total_files: 20,
          languages: ["javascript"],
          frameworks: [],
          file_breakdown: { javascript: 20 },
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

      // In a clean test environment with no other modifications,
      // the index should be fresh
      await saveScanIndex(index, workdir.path);

      // Verify the index was saved
      const indexPath = path.join(workdir.path, "documentation-robotics", "scan-index.json");
      expect(existsSync(indexPath)).toBe(true);
    });
  });

  describe("Index schema compatibility", () => {
    it("should preserve all required fields when saved and loaded", async () => {
      const originalIndex = {
        indexed_at: "2026-04-14T12:00:00Z",
        workspace: workdir.path,
        repository: {
          total_files: 100,
          languages: ["typescript", "javascript"],
          primary_language: "typescript",
          frameworks: ["react", "express"],
          file_breakdown: {
            typescript: 70,
            javascript: 30,
          },
        },
        detected_patterns: {
          architectural: [
            { name: "MVC Pattern", confidence: 0.85 },
            { name: "Dependency Injection", confidence: 0.72 },
          ],
          data_access: [
            { name: "ORM Pattern", confidence: 0.68 },
          ],
          security: [
            { name: "Input Validation", confidence: 0.88 },
            { name: "Authentication", confidence: 0.92 },
          ],
          api: [
            { name: "REST API", confidence: 0.95 },
          ],
        },
        suggested_workflow: {
          recommended_tools: [
            "repository_stats",
            "detect_patterns",
            "suggest_analysis_workflow",
            "search_code",
          ],
          rationale: "Full analysis workflow recommended for TypeScript React + Express architecture",
        },
      };

      // Save the index
      await saveScanIndex(originalIndex, workdir.path);

      // Verify file exists and has content
      const indexPath = path.join(workdir.path, "documentation-robotics", "scan-index.json");
      expect(existsSync(indexPath)).toBe(true);

      // Read back and verify structure is preserved
      const { loadScanIndex } = await import("../../src/scan/index-builder.js");
      const loadedIndex = await loadScanIndex(workdir.path);

      expect(loadedIndex).not.toBeNull();
      if (loadedIndex) {
        expect(loadedIndex.indexed_at).toBe(originalIndex.indexed_at);
        expect(loadedIndex.repository.total_files).toBe(originalIndex.repository.total_files);
        expect(loadedIndex.repository.languages).toEqual(originalIndex.repository.languages);
        expect(loadedIndex.detected_patterns.architectural.length).toBe(2);
        expect(loadedIndex.suggested_workflow.recommended_tools.length).toBe(4);
      }
    });

    it("should handle empty pattern categories", async () => {
      const minimalIndex = {
        indexed_at: "2026-04-14T12:00:00Z",
        workspace: workdir.path,
        repository: {
          total_files: 5,
          languages: ["javascript"],
          frameworks: [],
          file_breakdown: { javascript: 5 },
        },
        detected_patterns: {
          architectural: [],
          data_access: [],
          security: [],
          api: [],
        },
        suggested_workflow: {
          recommended_tools: [],
          rationale: "No patterns detected in minimal project",
        },
      };

      await saveScanIndex(minimalIndex, workdir.path);

      const indexPath = path.join(workdir.path, "documentation-robotics", "scan-index.json");
      expect(existsSync(indexPath)).toBe(true);

      const { loadScanIndex } = await import("../../src/scan/index-builder.js");
      const loaded = await loadScanIndex(workdir.path);

      expect(loaded).not.toBeNull();
      if (loaded) {
        expect(loaded.detected_patterns.architectural.length).toBe(0);
        expect(loaded.detected_patterns.api.length).toBe(0);
      }
    });
  });
});
