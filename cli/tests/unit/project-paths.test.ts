/**
 * Tests for project-paths utilities
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  findProjectRoot,
  getDocumentationRobotsPath,
  getModelPath,
  getSpecReferencePath,
  isInDRProject,
} from "../../src/utils/project-paths.js";

describe("Project Paths Utilities", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing with UUID for concurrent safety
    testDir = join(tmpdir(), `dr-paths-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors
    }
  });

  describe("findProjectRoot", () => {
    it("should find project root when in root directory", async () => {
      // Create documentation-robotics folder
      await mkdir(join(testDir, "documentation-robotics"));

      const result = await findProjectRoot(testDir);
      expect(result).toBe(testDir);
    });

    it("should find project root when in subdirectory", async () => {
      // Create documentation-robotics folder and subdirectories
      await mkdir(join(testDir, "documentation-robotics"), { recursive: true });
      await mkdir(join(testDir, "src", "components"), { recursive: true });

      const result = await findProjectRoot(join(testDir, "src", "components"));
      expect(result).toBe(testDir);
    });

    it("should find project root within search depth limit", async () => {
      // Create nested structure
      await mkdir(join(testDir, "documentation-robotics"));
      await mkdir(join(testDir, "a", "b", "c", "d", "e"), { recursive: true });

      // Should find within 5 levels
      const result = await findProjectRoot(join(testDir, "a", "b", "c", "d"));
      expect(result).toBe(testDir);
    });

    it("should return null if documentation-robotics not found", async () => {
      const result = await findProjectRoot(testDir);
      expect(result).toBeNull();
    });

    it("should return null if beyond search depth limit", async () => {
      // Create documentation-robotics at root
      await mkdir(join(testDir, "documentation-robotics"));
      // Create deep nested directory (6 levels deep)
      await mkdir(join(testDir, "a", "b", "c", "d", "e", "f"), { recursive: true });

      // Should NOT find (beyond 5 level limit)
      const result = await findProjectRoot(join(testDir, "a", "b", "c", "d", "e", "f"));
      expect(result).toBeNull();
    });
  });

  describe("getDocumentationRobotsPath", () => {
    it("should return documentation-robotics path when found", async () => {
      await mkdir(join(testDir, "documentation-robotics"));

      const result = await getDocumentationRobotsPath(testDir);
      expect(result).toBe(join(testDir, "documentation-robotics"));
    });

    it("should return null when not found", async () => {
      const result = await getDocumentationRobotsPath(testDir);
      expect(result).toBeNull();
    });
  });

  describe("getModelPath", () => {
    it("should return model path when it exists", async () => {
      await mkdir(join(testDir, "documentation-robotics", "model"), { recursive: true });

      const result = await getModelPath(testDir);
      expect(result).toBe(join(testDir, "documentation-robotics", "model"));
    });

    it("should return null when documentation-robotics exists but no model", async () => {
      await mkdir(join(testDir, "documentation-robotics"));

      const result = await getModelPath(testDir);
      expect(result).toBeNull();
    });

    it("should return null when project not found", async () => {
      const result = await getModelPath(testDir);
      expect(result).toBeNull();
    });
  });

  describe("getSpecReferencePath", () => {
    it("should return .dr path when it exists", async () => {
      await mkdir(join(testDir, "documentation-robotics"));
      await mkdir(join(testDir, ".dr"));

      const result = await getSpecReferencePath(testDir);
      expect(result).toBe(join(testDir, ".dr"));
    });

    it("should return null when .dr does not exist", async () => {
      await mkdir(join(testDir, "documentation-robotics"));

      const result = await getSpecReferencePath(testDir);
      expect(result).toBeNull();
    });

    it("should return null when project not found", async () => {
      const result = await getSpecReferencePath(testDir);
      expect(result).toBeNull();
    });
  });

  describe("isInDRProject", () => {
    it("should return true when in DR project", async () => {
      await mkdir(join(testDir, "documentation-robotics"));

      const result = await isInDRProject(testDir);
      expect(result).toBe(true);
    });

    it("should return false when not in DR project", async () => {
      const result = await isInDRProject(testDir);
      expect(result).toBe(false);
    });
  });

  describe("Complete Project Structure", () => {
    it("should find all paths in complete project structure", async () => {
      // Create complete structure
      await mkdir(join(testDir, ".dr"), { recursive: true });
      await mkdir(join(testDir, "documentation-robotics", "model"), { recursive: true });
      await mkdir(join(testDir, "documentation-robotics", "annotations"), { recursive: true });
      await mkdir(join(testDir, "src", "components"), { recursive: true });

      // Create manifest files
      await writeFile(join(testDir, ".dr", "manifest.json"), '{"specVersion":"0.7.0"}');
      await writeFile(
        join(testDir, "documentation-robotics", "model", "manifest.yaml"),
        "specVersion: 0.6.0"
      );

      // Test from subdirectory
      const startPath = join(testDir, "src", "components");

      const projectRoot = await findProjectRoot(startPath);
      expect(projectRoot).toBe(testDir);

      const drPath = await getDocumentationRobotsPath(startPath);
      expect(drPath).toBe(join(testDir, "documentation-robotics"));

      const modelPath = await getModelPath(startPath);
      expect(modelPath).toBe(join(testDir, "documentation-robotics", "model"));

      const specPath = await getSpecReferencePath(startPath);
      expect(specPath).toBe(join(testDir, ".dr"));

      const inProject = await isInDRProject(startPath);
      expect(inProject).toBe(true);
    });
  });
});
