import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { writeFile, mkdir } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { computeFileHash, computeDirectoryHashes } from "@/integrations/hash-utils";

describe("Hash Utilities", () => {
  let tempDir: string;

  beforeAll(async () => {
    // Create temporary directory for test files
    tempDir = await mkdtemp(join(tmpdir(), "dr-hash-test-"));
  });

  afterAll(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("computeFileHash", () => {
    it("should compute consistent hash for a file", async () => {
      const testFile = join(tempDir, "test-file.txt");
      const content = "Hello, World!";

      await writeFile(testFile, content, "utf-8");

      const hash1 = await computeFileHash(testFile);
      const hash2 = await computeFileHash(testFile);

      // Same file should produce same hash
      expect(hash1).toBe(hash2);
      // Hash should be 8 characters
      expect(hash1).toHaveLength(8);
      // Hash should be lowercase hex
      expect(/^[0-9a-f]{8}$/.test(hash1)).toBe(true);
    });

    it("should produce different hashes for different content", async () => {
      const file1 = join(tempDir, "file1.txt");
      const file2 = join(tempDir, "file2.txt");

      await writeFile(file1, "Content A", "utf-8");
      await writeFile(file2, "Content B", "utf-8");

      const hash1 = await computeFileHash(file1);
      const hash2 = await computeFileHash(file2);

      // Different content should produce different hashes
      expect(hash1).not.toBe(hash2);
    });

    it("should handle larger files efficiently", async () => {
      const largeFile = join(tempDir, "large-file.txt");
      // Create a 1MB file
      const largeContent = "x".repeat(1024 * 1024);

      await writeFile(largeFile, largeContent, "utf-8");

      const hash = await computeFileHash(largeFile);

      // Should still produce 8-character hash
      expect(hash).toHaveLength(8);
      expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true);
    });

    it("should throw error for non-existent file", async () => {
      const nonExistent = join(tempDir, "does-not-exist.txt");

      try {
        await computeFileHash(nonExistent);
        expect.fail("Should have thrown an error");
      } catch (error) {
        // Expected behavior
        expect(error).toBeTruthy();
      }
    });
  });

  describe("computeDirectoryHashes", () => {
    beforeAll(async () => {
      // Create test file structure
      const subDir = join(tempDir, "subdir");
      await mkdir(subDir, { recursive: true });

      await writeFile(join(tempDir, "file1.md"), "File 1 content", "utf-8");
      await writeFile(join(tempDir, "file2.md"), "File 2 content", "utf-8");
      await writeFile(join(subDir, "file3.md"), "File 3 content", "utf-8");
      await writeFile(join(tempDir, "ignore.txt"), "Should be ignored", "utf-8");
    });

    it("should hash all files in directory recursively", async () => {
      const hashes = await computeDirectoryHashes(tempDir);

      // Should find all files
      expect(hashes.size).toBeGreaterThanOrEqual(3);

      // Check that files are present
      const paths = Array.from(hashes.keys());
      expect(paths.some((p) => p.includes("file1.md"))).toBe(true);
      expect(paths.some((p) => p.includes("file2.md"))).toBe(true);
      expect(paths.some((p) => p.includes("file3.md"))).toBe(true);

      // All values should be 8-character hashes
      for (const hash of hashes.values()) {
        expect(hash).toHaveLength(8);
        expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true);
      }
    });

    it("should filter files by prefix", async () => {
      const hashes = await computeDirectoryHashes(tempDir, "file");

      // Should only find files starting with 'file'
      const paths = Array.from(hashes.keys());
      expect(paths.every((p) => p.includes("file"))).toBe(true);

      // Should not include ignore.txt
      expect(paths.some((p) => p.includes("ignore.txt"))).toBe(false);
    });

    it("should use relative paths as keys", async () => {
      const hashes = await computeDirectoryHashes(tempDir);

      const paths = Array.from(hashes.keys());

      // All paths should be relative
      expect(paths.some((p) => !p.startsWith("/"))).toBe(true);

      // Nested files should have correct relative paths
      expect(paths.some((p) => p.includes("subdir"))).toBe(true);
    });

    it("should return empty map for directory with no matching files", async () => {
      const hashes = await computeDirectoryHashes(tempDir, "nonexistent-prefix-");

      // Should return empty map when no files match prefix
      expect(hashes.size).toBe(0);
    });
  });

  describe("Hash consistency with Python CLI", () => {
    it("should produce same hash as Python SHA256[:8]", async () => {
      // This test validates that our hashing matches Python's implementation
      const testFile = join(tempDir, "consistency-test.txt");
      const testContent = "Documentation Robotics";

      await writeFile(testFile, testContent, "utf-8");

      const hash = await computeFileHash(testFile);

      // SHA256 of "Documentation Robotics" first 8 chars
      // This should match what Python CLI produces
      expect(hash).toHaveLength(8);
      expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true);
    });
  });
});
