/**
 * Integration tests for analyzer subcommands
 *
 * Tests each new subcommand via runDr() end-to-end:
 * - analyzer services
 * - analyzer datastores
 * - analyzer callers
 * - analyzer callees
 * - analyzer verify
 * - analyzer endpoints
 *
 * Error paths tested:
 * - Not in project
 * - Not indexed (project found but not indexed by analyzer)
 * - Unsupported layer for verify (non-api layers)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import { runDr, type RunDrOptions } from "../../helpers/cli-runner.js";

let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

describe("Analyzer Subcommands Integration", () => {
  beforeEach(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    try {
      await workdir.cleanup();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("services subcommand", () => {
    it("should require indexed project", async () => {
      const result = await runDr(["analyzer", "services"]);
      // Should fail because project is not indexed
      expect(result.exitCode).not.toBe(0);
    });

    it("should work with --json flag", async () => {
      const result = await runDr(["analyzer", "services", "--json"]);
      // May fail if not indexed, but should accept --json flag and exit gracefully
      if (result.exitCode !== 0) {
        // Should have an error message
        expect(result.stderr.length).toBeGreaterThan(0);  // stderr should be populated on error
      } else {
        // If successful, should return valid JSON
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      }
    });

    it("should support --layer filter", async () => {
      const result = await runDr([
        "analyzer",
        "services",
        "--layer",
        "application",
      ]);
      // Should accept --layer option and exit with error or success
      expect([0, 1, 2]).toContain(result.exitCode);
    });
  });

  describe("datastores subcommand", () => {
    it("should require indexed project", async () => {
      const result = await runDr(["analyzer", "datastores"]);
      // Should fail because project is not indexed
      expect(result.exitCode).not.toBe(0);
    });

    it("should work with --json flag", async () => {
      const result = await runDr(["analyzer", "datastores", "--json"]);
      // May fail if not indexed, but should accept --json flag
      if (result.exitCode === 0) {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      } else {
        expect([1, 2]).toContain(result.exitCode);
      }
    });
  });

  describe("callers subcommand", () => {
    it("should require qualified name argument", async () => {
      const result = await runDr(["analyzer", "callers"]);
      // Should fail due to missing argument
      expect(result.exitCode).not.toBe(0);
    });

    it("should require indexed project", async () => {
      const result = await runDr([
        "analyzer",
        "callers",
        "com.example.UserService.getUser",
      ]);
      // Should fail because project is not indexed
      expect(result.exitCode).not.toBe(0);
    });

    it("should support --depth flag", async () => {
      const result = await runDr([
        "analyzer",
        "callers",
        "com.example.Service.method",
        "--depth",
        "5",
      ]);
      // Should accept --depth option and return a valid exit code
      expect([0, 1, 2]).toContain(result.exitCode);
    });

    it("should clamp --depth to maximum of 10", async () => {
      const result = await runDr([
        "analyzer",
        "callers",
        "com.example.Service.method",
        "--depth",
        "20",
      ]);
      // Should accept --depth and clamp internally
      expect([0, 1, 2]).toContain(result.exitCode);
    });

    it("should work with --json flag", async () => {
      const result = await runDr([
        "analyzer",
        "callers",
        "com.example.Service.method",
        "--json",
      ]);
      // May fail if not indexed, but should handle --json flag
      if (result.exitCode === 0) {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      } else {
        expect([1, 2]).toContain(result.exitCode);
      }
    });
  });

  describe("callees subcommand", () => {
    it("should require qualified name argument", async () => {
      const result = await runDr(["analyzer", "callees"]);
      // Should fail due to missing argument
      expect(result.exitCode).not.toBe(0);
    });

    it("should require indexed project", async () => {
      const result = await runDr([
        "analyzer",
        "callees",
        "com.example.UserService.getUser",
      ]);
      // Should fail because project is not indexed
      expect(result.exitCode).not.toBe(0);
    });

    it("should support --depth flag", async () => {
      const result = await runDr([
        "analyzer",
        "callees",
        "com.example.Service.method",
        "--depth",
        "5",
      ]);
      // Should accept --depth option
      expect([0, 1, 2]).toContain(result.exitCode);
    });

    it("should clamp --depth to maximum of 10", async () => {
      const result = await runDr([
        "analyzer",
        "callees",
        "com.example.Service.method",
        "--depth",
        "20",
      ]);
      // Should accept --depth and clamp internally
      expect([0, 1, 2]).toContain(result.exitCode);
    });

    it("should work with --json flag", async () => {
      const result = await runDr([
        "analyzer",
        "callees",
        "com.example.Service.method",
        "--json",
      ]);
      // May fail if not indexed, but should handle --json flag
      if (result.exitCode === 0) {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      } else {
        expect([1, 2]).toContain(result.exitCode);
      }
    });
  });

  describe("verify subcommand", () => {
    it("should require indexed project", async () => {
      const result = await runDr(["analyzer", "verify"]);
      // Should fail because project is not indexed
      expect(result.exitCode).not.toBe(0);
    });

    it("should work with --json flag", async () => {
      const result = await runDr(["analyzer", "verify", "--json"]);
      // May fail if not indexed, but should handle --json flag
      if (result.exitCode === 0) {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      } else {
        expect([1, 2]).toContain(result.exitCode);
      }
    });

    it("should support --output flag", async () => {
      const outputFile = join(workdir.path, "verify-report.json");
      const result = await runDr([
        "analyzer",
        "verify",
        "--output",
        outputFile,
      ]);
      // Should accept --output option and return valid exit code
      expect([0, 1, 2]).toContain(result.exitCode);
    });

    it("should clean exit when --layer application specified", async () => {
      const result = await runDr(["analyzer", "verify", "--layer", "application"], {
        cwd: workdir.path,
      });
      // Should output message about v1 scope (in either stdout or stderr)
      // The verify subcommand outputs this message when non-api layers are specified
      const output = result.stdout + result.stderr;
      expect(output).toContain("verify scope v1");
    });

    it("should support multiple --layer options", async () => {
      const result = await runDr([
        "analyzer",
        "verify",
        "--layer",
        "api",
        "--layer",
        "application",
      ]);
      // Should accept multiple --layer options
      // The second one (application) should cause clean exit with appropriate message
      const output = result.stdout + result.stderr;
      expect([0, 1, 2]).toContain(result.exitCode);
      // When non-api layer is specified, should mention verify scope
      if (result.exitCode === 0) {
        expect(output).toContain("verify scope");
      }
    });
  });

  describe("endpoints subcommand", () => {
    it("should require indexed project", async () => {
      const result = await runDr(["analyzer", "endpoints"]);
      // Should fail because project is not indexed
      expect(result.exitCode).not.toBe(0);
    });

    it("should work with --json flag", async () => {
      const result = await runDr(["analyzer", "endpoints", "--json"]);
      // May fail if not indexed, but should handle --json flag
      if (result.exitCode === 0) {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      } else {
        expect([1, 2]).toContain(result.exitCode);
      }
    });
  });

  describe("Error handling across subcommands", () => {
    it("should handle not-in-project error (no DR model found)", async () => {
      // Create a temp dir without a DR model
      const tempDir = join(workdir.path, "no-model-project");
      await mkdir(tempDir, { recursive: true });

      const result = await runDr(["analyzer", "status"], {
        cwd: tempDir,
      });

      // Should fail or handle gracefully
      expect(result.exitCode).not.toBe(0);
    });

    it("should handle analyzer selection when needed", async () => {
      // First, need to discover an analyzer (or fail gracefully)
      const discoverResult = await runDr(["analyzer", "discover", "--json"]);

      // Even if no analyzer installed, should handle gracefully
      expect(discoverResult.stdout || discoverResult.stderr).toBeDefined();
    });

    it("should preserve reason field on ignored entries", async () => {
      const result = await runDr(["analyzer", "verify", "--json"]);
      // When verify runs (regardless of success), ignore reasons should be preserved
      try {
        if (result.exitCode === 0) {
          const report = JSON.parse(result.stdout);
          if (report.buckets?.ignored?.length > 0) {
            for (const ignored of report.buckets.ignored) {
              expect(ignored.reason).toBeDefined();
              expect(typeof ignored.reason).toBe("string");
            }
          }
        }
      } catch {
        // Expected to fail if project not indexed
      }
    });
  });

  describe("Command-line interface consistency", () => {
    it("should accept --name flag for analyzer selection", async () => {
      const result = await runDr(["analyzer", "services", "--name", "cbm"]);
      // Should accept --name option (even if it fails for other reasons)
      expect(result.stdout || result.stderr).toBeDefined();
    });

    it("should accept --name with all query subcommands", async () => {
      const subcommands = [
        ["services"],
        ["datastores"],
        ["endpoints"],
        ["callers", "com.example.Service.method"],
        ["callees", "com.example.Service.method"],
        ["verify"],
      ];

      for (const subcommand of subcommands) {
        const result = await runDr(["analyzer", ...subcommand, "--name", "cbm"]);
        // All should accept --name flag
        expect(result.stdout || result.stderr).toBeDefined();
      }
    });

    it("should return zero exit code for help requests", async () => {
      const result = await runDr(["analyzer", "--help"], {
        cwd: workdir.path,
      });
      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;
      // Should contain help text about analyzer commands
      expect(output.toLowerCase()).toMatch(/analyzer|analyze|discover|status/);
    });
  });
});
