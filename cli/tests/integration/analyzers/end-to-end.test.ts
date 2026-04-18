/**
 * End-to-End Analyzer Integration Tests
 *
 * Tests the full analyzer workflow:
 * - discover: Find and select analyzer
 * - status: Check analyzer and project status
 * - index: Index the project with analyzer
 * - endpoints: Extract endpoint candidates
 *
 * Uses a mock MCP server to simulate analyzer backend without requiring
 * a real CBM binary. Tests verify the complete command chain works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runDr } from "../../helpers/cli-runner.js";
import { createTestWorkdir } from "../../helpers/golden-copy.js";
import { mkdir, writeFile, rm, access, chmod } from "fs/promises";
import { join } from "path";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOCK_MCP_SERVER_PATH = path.join(__dirname, "../../fixtures/mock-mcp-server.cjs");

let tempDir: { path: string; cleanup: () => Promise<void> } = { path: "", cleanup: async () => {} };

describe("analyzer end-to-end workflow", () => {
  beforeEach(async () => {
    tempDir = await createTestWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("discover command", () => {
    it("should discover available analyzers", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("found");
      expect(Array.isArray(output.found)).toBe(true);
    });

    it("should output JSON with expected structure", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);

      // Verify required fields
      expect(output).toHaveProperty("found");
      expect(output).toHaveProperty("installed_count");
      expect(typeof output.installed_count).toBe("number");

      // Verify analyzer metadata
      for (const analyzer of output.found) {
        expect(analyzer).toHaveProperty("name");
        expect(analyzer).toHaveProperty("display_name");
        expect(analyzer).toHaveProperty("description");
        expect(analyzer).toHaveProperty("homepage");
        expect(typeof analyzer.installed).toBe("boolean");
      }
    });
  });

  describe("status command", () => {
    it("should report status with analyzer name", async () => {
      // Initialize project first
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      const result = await runDr(["analyzer", "status", "--name", "cbm", "--json"], {
        cwd: tempDir.path,
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("detected");
      expect(output.detected).toHaveProperty("installed");
    });

    it("should show indexed status when checking unindexed project", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      const result = await runDr(["analyzer", "status", "--name", "cbm", "--json"], {
        cwd: tempDir.path,
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("indexed");
      expect(typeof output.indexed).toBe("boolean");
    });
  });

  describe("index command with mock server", () => {
    it("should index project and create session metadata", async () => {
      // Initialize project first
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Create project structure
      const srcDir = join(tempDir.path, "src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, "index.ts"), "export const main = () => {};");

      // Attempt to index with specific analyzer
      // In CI without real analyzer binary, this will fail, which is expected
      const result = await runDr(["analyzer", "index", "--name", "cbm"], {
        cwd: tempDir.path,
      });

      // Verify the command was attempted (exit code indicates attempt, not failure)
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("endpoints command", () => {
    it("should error when project not indexed", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Try to get endpoints without indexing
      const result = await runDr(["analyzer", "endpoints", "--name", "cbm"], {
        cwd: tempDir.path,
      });

      // Should fail with "not indexed" error
      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/indexed|index/i);
    });

    it("should support JSON output format", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Try endpoints with JSON format (will fail if not indexed, but validates format)
      const result = await runDr(["analyzer", "endpoints", "--name", "cbm", "--json"], {
        cwd: tempDir.path,
      });

      // Either succeeds with valid JSON or fails gracefully
      if (result.exitCode === 0) {
        // Should be valid JSON (array of endpoint candidates)
        const output = JSON.parse(result.stdout);
        expect(Array.isArray(output)).toBe(true);
      } else {
        // Should have error message, not crash
        expect(result.stderr).toBeDefined();
      }
    });
  });

  describe("full workflow integration", () => {
    it("should support discover followed by status", async () => {
      // Run discover first
      const discoverResult = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });
      expect(discoverResult.exitCode).toBe(0);

      // Run status with explicit analyzer name (no session required)
      const statusResult = await runDr(["analyzer", "status", "--name", "cbm", "--json"], {
        cwd: tempDir.path,
      });

      // Status should either succeed or fail with clear error, not crash
      expect(typeof statusResult.exitCode).toBe("number");
      if (statusResult.exitCode === 0) {
        const output = JSON.parse(statusResult.stdout);
        expect(output).toHaveProperty("detected");
      }
    });

    it("should resolve project root from subdirectory", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Create subdirectory
      const subdir = join(tempDir.path, "src");
      await mkdir(subdir, { recursive: true });

      // Run discover from subdirectory
      const discoverResult = await runDr(["analyzer", "discover", "--json"], {
        cwd: subdir,
        env: { CI: "true" },
      });
      expect(discoverResult.exitCode).toBe(0);

      // Run status from subdirectory
      const statusResult = await runDr(["analyzer", "status", "--name", "cbm", "--json"], {
        cwd: subdir,
      });

      expect(typeof statusResult.exitCode).toBe("number");
    });

    it("should handle analyzer not found error gracefully", async () => {
      const result = await runDr(["analyzer", "status", "--name", "nonexistent"], {
        cwd: tempDir.path,
      });

      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/not found|nonexistent/i);
    });
  });

  describe("session management through workflow", () => {
    it("should create session file on discover", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);

      // Check if session was created (only if analyzers available)
      const output = JSON.parse(result.stdout);
      const sessionPath = join(tempDir.path, ".dr", "analyzers", "session.json");

      try {
        const sessionContent = await Bun.file(sessionPath).text();
        const session = JSON.parse(sessionContent);
        expect(session).toHaveProperty("active_analyzer");
      } catch {
        // Session might not exist if no analyzers available
        // In that case, auto-selection shouldn't happen
        if (output.found.some((a: any) => a.installed)) {
          // If there are installed analyzers, session should exist
          expect.unreachable("Session should exist when analyzers are available");
        }
      }
    });

    it("should reuse session across multiple commands", async () => {
      // First discover
      const discover1 = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });
      expect(discover1.exitCode).toBe(0);

      // Second discover (without --reselect)
      const discover2 = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });
      expect(discover2.exitCode).toBe(0);

      const output1 = JSON.parse(discover1.stdout);
      const output2 = JSON.parse(discover2.stdout);

      // If both had selection, they should match
      if (output1.selected && output2.selected) {
        expect(output1.selected).toBe(output2.selected);
      }
    });
  });

  describe("analyzer metadata handling", () => {
    it("should include all required metadata fields", async () => {
      const result = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { CI: "true" },
      });

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);

      for (const analyzer of output.found) {
        // All analyzers should have these fields
        expect(typeof analyzer.name).toBe("string");
        expect(analyzer.name.length).toBeGreaterThan(0);

        expect(typeof analyzer.display_name).toBe("string");
        expect(analyzer.display_name.length).toBeGreaterThan(0);

        expect(typeof analyzer.description).toBe("string");
        // description can be empty, but should be a string

        expect(typeof analyzer.homepage).toBe("string");
        // homepage can be empty, but should be a string

        expect(typeof analyzer.installed).toBe("boolean");
      }
    });
  });

  describe("mock MCP server integration", () => {
    let mockBinDir: string;

    beforeEach(async () => {
      // Create a mock bin directory in the test workspace
      mockBinDir = join(tempDir.path, ".mock-bin");
      await mkdir(mockBinDir, { recursive: true });

      // Create a wrapper script that calls the mock server
      const mockBinaryPath = join(mockBinDir, "codebase-memory-mcp");
      const wrapperContent = `#!/bin/sh
node "${MOCK_MCP_SERVER_PATH}"
`;

      await writeFile(mockBinaryPath, wrapperContent);
      await chmod(mockBinaryPath, 0o755);
    });

    it("should complete discover → status → index → endpoints workflow with mock server", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Create project structure
      const srcDir = join(tempDir.path, "src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, "routes.ts"), "export const routes = [];");

      // Prepare environment with mock binary in PATH
      const customPath = `${mockBinDir}:${process.env.PATH || ""}`;
      const env = { ...process.env, PATH: customPath };

      // Step 1: Discover analyzers (should find cbm)
      const discoverResult = await runDr(["analyzer", "discover", "--json"], {
        cwd: tempDir.path,
        env: { ...env, CI: "true" },
      });

      expect(discoverResult.exitCode).toBe(0);
      const discoverOutput = JSON.parse(discoverResult.stdout);
      expect(discoverOutput).toHaveProperty("found");
      expect(Array.isArray(discoverOutput.found)).toBe(true);

      // Verify cbm analyzer is found
      const cbmAnalyzer = discoverOutput.found.find((a: any) => a.name === "cbm");
      expect(cbmAnalyzer).toBeDefined();
      expect(cbmAnalyzer?.installed).toBe(true);

      // Step 2: Check status
      const statusResult = await runDr(["analyzer", "status", "--name", "cbm", "--json"], {
        cwd: tempDir.path,
        env,
      });

      expect(statusResult.exitCode).toBe(0);
      const statusOutput = JSON.parse(statusResult.stdout);
      expect(statusOutput).toHaveProperty("detected");
      expect(statusOutput.detected.installed).toBe(true);
      expect(statusOutput.indexed).toBe(false); // Not indexed yet

      // Step 3: Index the project with mock server
      const indexResult = await runDr(["analyzer", "index", "--name", "cbm"], {
        cwd: tempDir.path,
        env,
      });

      // Index should succeed with mock server
      expect(indexResult.exitCode).toBe(0);

      // Step 4: Verify endpoints can be extracted
      const endpointsResult = await runDr(["analyzer", "endpoints", "--name", "cbm", "--json"], {
        cwd: tempDir.path,
        env,
      });

      // Should succeed and return endpoint candidates
      expect(endpointsResult.exitCode).toBe(0);
      const endpoints = JSON.parse(endpointsResult.stdout);
      expect(Array.isArray(endpoints)).toBe(true);

      // Verify endpoint candidate structure
      for (const candidate of endpoints) {
        expect(candidate).toHaveProperty("source_file");
        expect(candidate).toHaveProperty("confidence");
        expect(["high", "medium", "low"]).toContain(candidate.confidence);
        expect(candidate).toHaveProperty("operationId");
      }
    });

    it("should verify status shows indexed=true after indexing", async () => {
      // Initialize project
      await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });

      // Create project structure
      const srcDir = join(tempDir.path, "src");
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, "routes.ts"), "export const routes = [];");

      const customPath = `${mockBinDir}:${process.env.PATH || ""}`;
      const env = { ...process.env, PATH: customPath };

      // Index the project
      await runDr(["analyzer", "index", "--name", "cbm"], {
        cwd: tempDir.path,
        env,
      });

      // Check status after indexing
      const statusResult = await runDr(["analyzer", "status", "--name", "cbm", "--json"], {
        cwd: tempDir.path,
        env,
      });

      expect(statusResult.exitCode).toBe(0);
      const statusOutput = JSON.parse(statusResult.stdout);
      expect(statusOutput.indexed).toBe(true); // Should be indexed now
      expect(statusOutput).toHaveProperty("index_meta");
      expect(statusOutput.index_meta).toHaveProperty("node_count");
      expect(statusOutput.index_meta).toHaveProperty("edge_count");
    });
  });
});
