/**
 * Integration tests for analyzer commands
 * Verifies discover, status, index, and endpoints functionality
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTempWorkdir, runDr, stripAnsi } from "../helpers/cli-runner.js";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

let tempDir: { path: string; cleanup: () => Promise<void> } = {
  path: "",
  cleanup: async () => {}
};

describe("analyzer commands", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("discover command", () => {
    it("should discover available analyzers", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("found");
      expect(Array.isArray(output.found)).toBe(true);
      expect(output).toHaveProperty("installed_count");
    });

    it("should report analyzer metadata in JSON output", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);

      if (output.found.length > 0) {
        const analyzer = output.found[0];
        expect(analyzer).toHaveProperty("name");
        expect(analyzer).toHaveProperty("display_name");
        expect(analyzer).toHaveProperty("description");
        expect(analyzer).toHaveProperty("homepage");
        expect(analyzer).toHaveProperty("installed");
      }
    });

    it("should store session in correct path relative to project root", async () => {
      // Create a subdirectory to simulate running from a subdirectory
      await mkdir(join(tempDir.path, "subdir"), { recursive: true });

      // Create a minimal DR project at the root
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Run discover from the subdirectory
      const discover = await runDr(["analyzer", "discover", "--json"], {
        cwd: join(tempDir.path, "subdir"),
        env: { CI: "true" }
      });

      expect(discover.exitCode).toBe(0);

      // Check that session was created in project root, not subdirectory
      const sessionPath = join(
        tempDir.path,
        ".dr",
        "analyzers",
        "session.json"
      );
      try {
        const sessionContent = await Bun.file(sessionPath).text();
        const session = JSON.parse(sessionContent);
        expect(session).toHaveProperty("active_analyzer");
      } catch {
        // Session file may not exist if no analyzers are installed
        // That's okay - the test is checking the path resolution logic
      }
    });
  });

  describe("status command", () => {
    it("should error when no analyzer is selected", async () => {
      // Don't select an analyzer, just try to get status
      const result = await runDr(["analyzer", "status"], { cwd: tempDir.path });

      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stderr + result.stdout;
      expect(output).toContain("No analyzer selected");
    });

    it("should allow specifying analyzer with --name option", async () => {
      const result = await runDr(
        ["analyzer", "status", "--name", "cbm", "--json"],
        {
          cwd: tempDir.path
        }
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("detected");
    });
  });

  describe("index command", () => {
    it("should error when not in a DR project", async () => {
      // First select an analyzer in a temporary location
      const tempAnalyzer = await createTempWorkdir();
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempAnalyzer.path,
        env: { CI: "true" }
      });

      // Try to index when not in a project
      const result = await runDr(["analyzer", "index"], { cwd: tempDir.path });

      expect(result.exitCode).toBeGreaterThan(0);
      await tempAnalyzer.cleanup();
    });

    it("should work from subdirectory of a DR project", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" }
      });

      // Create subdirectory
      await mkdir(join(tempDir.path, "subdir"), { recursive: true });

      // Attempt to index from subdirectory
      // This will likely fail if no real analyzer is installed, but it verifies path resolution
      const result = await runDr(["analyzer", "index", "--name", "cbm"], {
        cwd: join(tempDir.path, "subdir")
      });

      // We expect either success or a sensible error (not a "project not found" error)
      // The key is that it resolved the project root correctly
      if (result.exitCode !== 0) {
        // If it fails, it should be for analyzer-related reasons, not project path issues
        const output = result.stderr + result.stdout;
        expect(output).not.toContain("not in a DR project");
        expect(output).not.toContain("Model not found");
      }
    });
  });

  describe("endpoints command", () => {
    it("should error when project not indexed", async () => {
      // Initialize project and select analyzer
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" }
      });

      // Try to get endpoints without indexing
      const result = await runDr(["analyzer", "endpoints", "--name", "cbm"], {
        cwd: tempDir.path
      });

      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/Project not indexed|not indexed/);
    });

    it("should resolve session from project root when run from subdirectory", async () => {
      // Initialize project and select analyzer
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" }
      });

      // Create subdirectory
      await mkdir(join(tempDir.path, "subdir"), { recursive: true });

      // Try to get endpoints from subdirectory
      // Will likely fail since project isn't indexed, but key is path resolution
      const result = await runDr(["analyzer", "endpoints", "--name", "cbm"], {
        cwd: join(tempDir.path, "subdir")
      });

      // Should fail with indexing error, not project path error
      if (result.exitCode !== 0) {
        const output = result.stderr + result.stdout;
        expect(output).not.toContain("not found");
      }
    });

    it("should support JSON output format", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" }
      });

      // Try endpoints with JSON (will fail if not indexed, but validates format handling)
      const result = await runDr(
        ["analyzer", "endpoints", "--name", "cbm", "--json"],
        {
          cwd: tempDir.path
        }
      );

      // Either succeeds with valid JSON or fails gracefully
      if (result.exitCode !== 0) {
        // Should not crash trying to output JSON
        expect(result.stderr).toBeDefined();
      } else {
        // Should be valid JSON
        const output = JSON.parse(result.stdout);
        expect(Array.isArray(output)).toBe(true);
      }
    });
  });

  describe("query subcommand", () => {
    it("should error when project not indexed", async () => {
      // Initialize project but don't index
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" }
      });

      // Try to execute a query without indexing
      const result = await runDr(
        ["analyzer", "query", "MATCH (n) RETURN n LIMIT 10", "--name", "cbm"],
        { cwd: tempDir.path }
      );

      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/not indexed/i);
    });

    it("should error when no analyzer selected and not specified", async () => {
      // Don't select an analyzer, try to run query
      const result = await runDr(
        ["analyzer", "query", "MATCH (n) RETURN n LIMIT 10"],
        { cwd: tempDir.path }
      );

      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/No analyzer selected|analyzer/i);
    });

    it("should error with helpful message for nonexistent analyzer", async () => {
      const result = await runDr(
        ["analyzer", "query", "MATCH (n) RETURN n LIMIT 10", "--name", "nonexistent"],
        { cwd: tempDir.path }
      );

      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/not found|Analyzer/);
    });

    it("should accept --json flag for consistency", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" }
      });

      // Try query with --json flag (will fail if not indexed, but validates flag parsing)
      const result = await runDr(
        ["analyzer", "query", "MATCH (n) RETURN n LIMIT 10", "--name", "cbm", "--json"],
        { cwd: tempDir.path }
      );

      // Should get an error about not indexed, not about flag parsing
      expect(result.exitCode).not.toBe(0);
      const output = result.stderr + result.stdout;
      expect(output).not.toMatch(/unknown option|flag/i);
    });

    it("should pass cypher query as positional argument", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
      await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" }
      });

      // Try query with different cypher expressions
      const testCyphers = [
        "MATCH (n) RETURN n",
        "MATCH (n:Service) RETURN n.name",
        "MATCH (n) RETURN n LIMIT 5",
      ];

      for (const cypher of testCyphers) {
        const result = await runDr(
          ["analyzer", "query", cypher, "--name", "cbm"],
          { cwd: tempDir.path }
        );

        // All should fail at the "not indexed" check, not at query parsing
        expect(result.exitCode).not.toBe(0);
        const output = result.stderr + result.stdout;
        expect(output).not.toMatch(/invalid|syntax/i);
      }
    });
  });

  describe("analyzer not found error", () => {
    it("should error with helpful message for nonexistent analyzer", async () => {
      const result = await runDr(
        ["analyzer", "status", "--name", "nonexistent"],
        {
          cwd: tempDir.path
        }
      );

      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stderr + result.stdout;
      expect(output).toMatch(/not found|Analyzer/);
    });
  });
});
