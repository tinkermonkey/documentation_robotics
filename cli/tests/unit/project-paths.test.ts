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
  findFarmRoot,
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

  describe("findFarmRoot", () => {
    it("should find farm.yaml in current directory", async () => {
      await writeFile(join(testDir, "farm.yaml"), "schema: dr-farm-v1\n");

      const result = await findFarmRoot(testDir);
      expect(result).toBe(testDir);
    });

    it("should find farm.yaml in parent directory", async () => {
      const subdir = join(testDir, "subdir");
      await mkdir(subdir, { recursive: true });
      await writeFile(join(testDir, "farm.yaml"), "schema: dr-farm-v1\n");

      const result = await findFarmRoot(subdir);
      expect(result).toBe(testDir);
    });

    it("should find farm.yaml multiple levels up", async () => {
      const deepPath = join(testDir, "a", "b", "c");
      await mkdir(deepPath, { recursive: true });
      await writeFile(join(testDir, "farm.yaml"), "schema: dr-farm-v1\n");

      const result = await findFarmRoot(deepPath);
      expect(result).toBe(testDir);
    });

    it("should return null when farm.yaml is not found", async () => {
      const subdir = join(testDir, "no-farm");
      await mkdir(subdir, { recursive: true });

      const result = await findFarmRoot(subdir);
      expect(result).toBeNull();
    });

    it("should respect MAX_SEARCH_DEPTH limit", async () => {
      // Create a directory structure that exceeds MAX_SEARCH_DEPTH (5)
      let deepPath = testDir;
      for (let i = 0; i < 10; i++) {
        deepPath = join(deepPath, `level${i}`);
      }
      await mkdir(deepPath, { recursive: true });

      // farm.yaml is at the root, but we're searching from beyond MAX_SEARCH_DEPTH
      await writeFile(join(testDir, "farm.yaml"), "schema: dr-farm-v1\n");

      const result = await findFarmRoot(deepPath);
      // Should return null because farm.yaml is beyond MAX_SEARCH_DEPTH
      expect(result).toBeNull();
    });

    it("should find farm.yaml in a detached model farm layout", async () => {
      const farmRoot = testDir;
      const serviceModelDir = join(farmRoot, "service-a-model", "documentation-robotics", "model");
      await mkdir(serviceModelDir, { recursive: true });
      await writeFile(join(farmRoot, "farm.yaml"), "schema: dr-farm-v1\n");

      // Starting from the model directory, should find farm.yaml at the farm root
      const result = await findFarmRoot(serviceModelDir);
      expect(result).toBe(farmRoot);
    });

    it("should use DR_FARM_PATH environment variable when set", async () => {
      const farmRoot = testDir;
      const subfolder = join(testDir, "subfolder");
      await mkdir(subfolder, { recursive: true });
      await writeFile(join(farmRoot, "farm.yaml"), "schema: dr-farm-v1\n");

      // Store original env var
      const originalDRFarmPath = process.env.DR_FARM_PATH;

      try {
        // Set DR_FARM_PATH to point to the farm root
        process.env.DR_FARM_PATH = farmRoot;

        // findFarmRoot should return the DR_FARM_PATH value
        const result = await findFarmRoot(subfolder);
        expect(result).toBe(farmRoot);
      } finally {
        // Restore original env var
        if (originalDRFarmPath !== undefined) {
          process.env.DR_FARM_PATH = originalDRFarmPath;
        } else {
          delete process.env.DR_FARM_PATH;
        }
      }
    });

    it("should return null if DR_FARM_PATH is set but farm.yaml does not exist", async () => {
      const invalidFarmPath = join(testDir, "nonexistent");
      await mkdir(invalidFarmPath, { recursive: true });

      // Store original env var
      const originalDRFarmPath = process.env.DR_FARM_PATH;

      try {
        // Set DR_FARM_PATH to an invalid path
        process.env.DR_FARM_PATH = invalidFarmPath;

        // findFarmRoot should return null
        const result = await findFarmRoot(testDir);
        expect(result).toBeNull();
      } finally {
        // Restore original env var
        if (originalDRFarmPath !== undefined) {
          process.env.DR_FARM_PATH = originalDRFarmPath;
        } else {
          delete process.env.DR_FARM_PATH;
        }
      }
    });

    it("should prefer DR_FARM_PATH over directory walk", async () => {
      const explicitFarmRoot = join(testDir, "explicit-farm");
      const defaultFarmRoot = testDir;

      await mkdir(explicitFarmRoot, { recursive: true });
      await writeFile(join(explicitFarmRoot, "farm.yaml"), "schema: dr-farm-v1\n");
      await writeFile(join(defaultFarmRoot, "farm.yaml"), "schema: dr-farm-v1\n");

      // Store original env var
      const originalDRFarmPath = process.env.DR_FARM_PATH;

      try {
        // Set DR_FARM_PATH to explicit farm
        process.env.DR_FARM_PATH = explicitFarmRoot;

        // findFarmRoot should return the explicit farm path, not the default one
        const result = await findFarmRoot(defaultFarmRoot);
        expect(result).toBe(explicitFarmRoot);
      } finally {
        // Restore original env var
        if (originalDRFarmPath !== undefined) {
          process.env.DR_FARM_PATH = originalDRFarmPath;
        } else {
          delete process.env.DR_FARM_PATH;
        }
      }
    });
  });
});
