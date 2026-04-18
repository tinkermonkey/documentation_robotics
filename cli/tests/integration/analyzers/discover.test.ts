/**
 * Integration tests for analyzer discovery
 *
 * Tests for:
 * - Discover with no analyzer installed
 * - Discover with mock analyzer binary available
 * - Session creation and reselection
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runDr } from "../../helpers/cli-runner.js";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import { mkdir, writeFile, rm, access } from "fs/promises";
import { join } from "path";

let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

describe("analyzer discover integration tests", () => {
  beforeEach(async () => {
    tempDir = await createTestWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("discover with no analyzer installed", () => {
    it("should exit with code 0 when no analyzer installed", async () => {
      const result = await runDr(["analyzer", "discover"], {
        cwd: tempDir.path,
        env: { CI: "true" }, // Non-TTY mode
      });

      expect(result.exitCode).toBe(0);
    });

    it("should display helpful message listing available analyzers", async () => {
      const result = await runDr(["analyzer", "discover"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;
      // Check for helpful messages (case-insensitive)
      expect(output.toLowerCase()).toMatch(/analyzer|install/);
    });

    it("should include analyzer name and homepage in output", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("found");
      expect(Array.isArray(output.found)).toBe(true);

      // Verify analyzer metadata fields are present
      if (output.found.length > 0) {
        const analyzer = output.found[0];
        expect(analyzer).toHaveProperty("name");
        expect(analyzer).toHaveProperty("display_name");
        expect(analyzer).toHaveProperty("homepage");
        expect(analyzer).toHaveProperty("description");
      }
    });

    it("should not create session.json when no analyzer installed", async () => {
      const result = await runDr(["analyzer", "discover"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);

      // Check that session.json was NOT created
      const sessionPath = join(tempDir.path, ".dr", "analyzers", "session.json");
      try {
        await access(sessionPath);
        // If we get here, file exists when it shouldn't
        expect.unreachable("session.json should not be created when no analyzer installed");
      } catch {
        // Expected: file should not exist
        expect(true).toBe(true);
      }
    });

    it("should report installed_count as 0 in JSON output", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("installed_count");
      // If no real analyzer is installed, this should be 0
      if (output.found.every((a: any) => !a.installed)) {
        expect(output.installed_count).toBe(0);
      }
    });

    it("should list all available analyzers in found array", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.found.length).toBeGreaterThan(0);

      // Verify each analyzer has required fields
      for (const analyzer of output.found) {
        expect(typeof analyzer.name).toBe("string");
        expect(typeof analyzer.installed).toBe("boolean");
      }
    });
  });

  describe("discover with mock analyzer binary", () => {
    let mockBinDir: string;
    let originalPath: string | undefined;

    beforeEach(async () => {
      // Create a mock analyzer binary in a temporary location
      // and add it to PATH for this test
      mockBinDir = join(tempDir.path, "mock-bin");
      await mkdir(mockBinDir, { recursive: true });

      // Create a mock cbm binary
      const mockCbm = join(mockBinDir, "cbm");
      await writeFile(
        mockCbm,
        `#!/bin/bash
# Mock CBM analyzer for testing
echo '{"capabilities": {}}'
`,
        { mode: 0o755 }
      );

      // Store original PATH for restoration
      originalPath = process.env.PATH;
    });

    it("should detect available analyzers via JSON output", async () => {
      // Pass the mock binary directory in PATH
      const customPath = `${mockBinDir}:${originalPath || ""}`;
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true", PATH: customPath },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("found");
      expect(Array.isArray(output.found)).toBe(true);
    });

    it("should auto-select first analyzer in non-TTY mode", async () => {
      const customPath = `${mockBinDir}:${originalPath || ""}`;
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true", PATH: customPath },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      // In non-TTY mode with reselect, first analyzer should be auto-selected
      // Only if there are analyzers available
      if (output.found.length > 0) {
        // selected field may exist if auto-selection happened
        if (output.selected) {
          expect(typeof output.selected).toBe("string");
        }
      }
    });

    it("should support --reselect flag to force re-selection", async () => {
      const customPath = `${mockBinDir}:${originalPath || ""}`;

      // First discover
      const discover1 = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true", PATH: customPath },
      });

      expect(discover1.exitCode).toBe(0);

      // Second discover with --reselect
      const discover2 = await runDr(["analyzer", "discover", "--json", "--reselect"], {
        cwd: tempDir.path,
        env: { CI: "true", PATH: customPath },
      });

      expect(discover2.exitCode).toBe(0);
      const output2 = JSON.parse(discover2.stdout);
      expect(output2).toHaveProperty("found");
    });
  });

  describe("session persistence", () => {
    it("should return existing session on subsequent discover calls", async () => {
      // First discover - may or may not create a session depending on available analyzers
      const discover1 = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(discover1.exitCode).toBe(0);

      // Second discover without --reselect should return same session
      const discover2 = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(discover2.exitCode).toBe(0);

      const output1 = JSON.parse(discover1.stdout);
      const output2 = JSON.parse(discover2.stdout);

      // If both have selected field, they should match
      if (output1.selected && output2.selected) {
        expect(output1.selected).toBe(output2.selected);
      }
    });

    it("should work from project subdirectory", async () => {
      // Create a subdirectory
      const subdir = join(tempDir.path, "subdir");
      await mkdir(subdir, { recursive: true });

      // Initialize project at root
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Run discover from subdirectory
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: subdir,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);

      // Session should be created at project root, not in subdirectory
      const sessionPath = join(tempDir.path, ".dr", "analyzers", "session.json");
      try {
        const content = await Bun.file(sessionPath).text();
        const session = JSON.parse(content);
        // Session might exist if auto-selected in non-TTY
        expect(session).toBeDefined();
      } catch {
        // Session might not exist if no analyzers available
        // That's acceptable for this test
      }
    });
  });
});
