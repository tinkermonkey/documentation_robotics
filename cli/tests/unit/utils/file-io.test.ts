import { describe, it, expect } from "bun:test";
import {
  ensureDir,
  fileExists,
  readFile,
  writeFile,
  readJSON,
  writeJSON,
  atomicWrite,
} from "@/utils/file-io";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Helper to run a test with an isolated temporary directory
async function withTestDir<T>(testFn: (testDir: string) => Promise<T>): Promise<T> {
  const testDir = await mkdtemp(join(tmpdir(), "dr-fileio-test-"));
  try {
    return await testFn(testDir);
  } finally {
    if (await fileExists(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  }
}

describe("File I/O Utilities", () => {
  describe("ensureDir", () => {
    it("should create a directory", async () => {
      await withTestDir(async (testDir) => {
        const dir = `${testDir}/test/nested/dir`;
        expect(await fileExists(dir)).toBe(false);

        await ensureDir(dir);

        expect(await fileExists(dir)).toBe(true);
      });
    });

    it("should not error if directory already exists", async () => {
      await withTestDir(async (testDir) => {
        const dir = `${testDir}/test`;
        await ensureDir(dir);
        await ensureDir(dir); // Should not throw

        expect(await fileExists(dir)).toBe(true);
      });
    });
  });

  describe("fileExists", () => {
    it("should return true for existing file", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;
        await writeFile(file, "test");

        const exists = await fileExists(file);

        expect(exists).toBe(true);
      });
    });

    it("should return false for nonexistent file", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/nonexistent.txt`;

        const exists = await fileExists(file);

        expect(exists).toBe(false);
      });
    });
  });

  describe("readFile and writeFile", () => {
    it("should write and read a file", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;
        const content = "Hello, World!";

        await writeFile(file, content);
        const read = await readFile(file);

        expect(read).toBe(content);
      });
    });

    it("should overwrite existing file", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;

        await writeFile(file, "First");
        await writeFile(file, "Second");
        const read = await readFile(file);

        expect(read).toBe("Second");
      });
    });

    it("should handle multiline content", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;
        const content = `Line 1
Line 2
Line 3`;

        await writeFile(file, content);
        const read = await readFile(file);

        expect(read).toBe(content);
      });
    });
  });

  describe("readJSON and writeJSON", () => {
    it("should write and read JSON with pretty formatting", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.json`;
        const data = { name: "Test", value: 42, nested: { key: "value" } };

        await writeJSON(file, data, true);
        const read = await readJSON<typeof data>(file);

        expect(read).toEqual(data);
      });
    });

    it("should write and read JSON without formatting", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.json`;
        const data = { name: "Test", value: 42 };

        await writeJSON(file, data, false);
        const read = await readJSON<typeof data>(file);

        expect(read).toEqual(data);
      });
    });

    it("should handle complex nested structures", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.json`;
        const data = {
          array: [1, 2, 3],
          nested: {
            deep: {
              value: "test",
            },
          },
          boolean: true,
          null: null,
        };

        await writeJSON(file, data);
        const read = await readJSON<typeof data>(file);

        expect(read).toEqual(data);
      });
    });

    it("should format JSON with indentation by default", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.json`;
        const data = { name: "Test", value: 42 };

        await writeJSON(file, data);
        const content = await readFile(file);

        // Pretty-formatted JSON should have newlines and indentation
        expect(content).toContain("\n");
        expect(content).toContain("  ");
      });
    });
  });

  describe("atomicWrite", () => {
    it("should write file atomically", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;
        const content = "Atomic content";

        await atomicWrite(file, content);
        const read = await readFile(file);

        expect(read).toBe(content);
      });
    });

    it("should not leave temp file on success", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;
        const content = "Atomic content";

        await atomicWrite(file, content);

        const tempFile = `${file}.tmp`;
        expect(await fileExists(tempFile)).toBe(false);
      });
    });

    it("should overwrite existing file", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;

        await writeFile(file, "Original");
        await atomicWrite(file, "Updated");

        const read = await readFile(file);

        expect(read).toBe("Updated");
      });
    });

    it("should handle large content", async () => {
      await withTestDir(async (testDir) => {
        const file = `${testDir}/test.txt`;
        const content = "x".repeat(10000);

        await atomicWrite(file, content);
        const read = await readFile(file);

        expect(read).toBe(content);
      });
    });
  });
});
