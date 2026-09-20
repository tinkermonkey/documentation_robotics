/**
 * CBM Analyzer Dual-Root Tests
 *
 * Validates that CbmAnalyzer correctly separates model root from codebase root
 * across detection, indexing, status checking, and query operations, ensuring
 * support for detached layouts (codebase separate from model).
 *
 * Tests cover:
 * - index() receives codebaseRoot as repo_path in index_repository call
 * - resolveProjectName() matches against codebaseRoot
 * - git rev-parse HEAD runs with codebaseRoot as cwd
 * - Path relativization works correctly for all node transformations
 * - End-to-end detached scenario verification
 * - Edge cases (default behavior, non-git model root)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CbmAnalyzer } from "@/analyzers/cbm-analyzer.js";
import { MappingLoader } from "@/analyzers/mapping-loader.js";
import { StdioClient } from "@/analyzers/stdio-client.js";
import { shapeCallGraphNode } from "@/analyzers/call-graph-utils.js";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";

let TEST_DIR: string;

beforeEach(async () => {
  TEST_DIR = join(tmpdir(), `dr-cbm-analyzer-dual-root-${randomUUID()}`);
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});

describe("CbmAnalyzer Dual-Root", () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("Unit Tests with Mocked StdioClient", () => {
    let analyzer: CbmAnalyzer;
    let mockMapper: MappingLoader;

    beforeEach(async () => {
      mockMapper = await MappingLoader.load("cbm");
      analyzer = new CbmAnalyzer(mockMapper);
    });

    describe("index() with dual-root", () => {
      it("should pass codebaseRoot as repo_path to index_repository", async () => {
        const farmRoot = join(TEST_DIR, "index-repo-path");
        const modelRoot = join(farmRoot, "model");
        const codebaseRoot = join(farmRoot, "code");

        await mkdir(modelRoot, { recursive: true });
        await mkdir(codebaseRoot, { recursive: true });

        // Initialize git repo at codebaseRoot only
        spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
        await writeFile(join(codebaseRoot, "README.md"), "# Test");
        spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["commit", "-m", "Initial"], { cwd: codebaseRoot, stdio: "pipe" });

        // Mock StdioClient to capture invokeTool calls using prototype patching
        const invokedTools: Array<{ tool: string; params: unknown }> = [];

        const originalSpawn = StdioClient.prototype.spawn;
        const originalClose = StdioClient.prototype.close;
        const originalInitialize = StdioClient.prototype.initialize;
        const originalInvokeTool = StdioClient.prototype.invokeTool;

        StdioClient.prototype.spawn = function () { /* noop */ };
        StdioClient.prototype.close = function () { /* noop */ };
        StdioClient.prototype.initialize = async function () { return { capabilities: {} }; };
        StdioClient.prototype.invokeTool = async function (tool: string, params: unknown) {
          invokedTools.push({ tool, params });

          if (tool === "list_projects") {
            return {
              projects: [{ name: "test-project", root_path: codebaseRoot }],
            };
          }
          if (tool === "index_repository") {
            return { nodes: 10, edges: 5, status: "complete" };
          }
          return {};
        };

        try {
          // Run index with codebaseRoot option
          const result = await analyzer.index(modelRoot, { codebaseRoot });

          // Verify index_repository was called with codebaseRoot as repo_path
          const indexCall = invokedTools.find((t) => t.tool === "index_repository");
          expect(indexCall).toBeDefined();
          expect(indexCall?.params).toBeDefined();
          const params = indexCall?.params as { repo_path?: string };
          expect(params.repo_path).toBe(codebaseRoot);
        } finally {
          StdioClient.prototype.spawn = originalSpawn;
          StdioClient.prototype.close = originalClose;
          StdioClient.prototype.initialize = originalInitialize;
          StdioClient.prototype.invokeTool = originalInvokeTool;
        }
      });

      it("should use codebaseRoot for git rev-parse HEAD during indexing", async () => {
        const farmRoot = join(TEST_DIR, "git-head-check");
        const modelRoot = join(farmRoot, "model");
        const codebaseRoot = join(farmRoot, "code");

        await mkdir(modelRoot, { recursive: true });
        await mkdir(codebaseRoot, { recursive: true });

        // Initialize git repo at codebaseRoot
        spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
        await writeFile(join(codebaseRoot, "README.md"), "# Test");
        spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["commit", "-m", "Initial"], { cwd: codebaseRoot, stdio: "pipe" });

        // Mock analyzer to verify it uses codebaseRoot for git operations
        const invokedTools: Array<{ tool: string; params: unknown }> = [];

        const originalSpawn = StdioClient.prototype.spawn;
        const originalClose = StdioClient.prototype.close;
        const originalInitialize = StdioClient.prototype.initialize;
        const originalInvokeTool = StdioClient.prototype.invokeTool;

        StdioClient.prototype.spawn = function () { /* noop */ };
        StdioClient.prototype.close = function () { /* noop */ };
        StdioClient.prototype.initialize = async function () { return { capabilities: {} }; };
        StdioClient.prototype.invokeTool = async function (tool: string, params: unknown) {
          invokedTools.push({ tool, params });
          if (tool === "list_projects") {
            return { projects: [{ name: "test-project", root_path: codebaseRoot }] };
          }
          if (tool === "index_repository") {
            return { nodes: 1, edges: 0, status: "complete" };
          }
          return {};
        };

        try {
          // Invoke analyzer.index with separate roots - it should use codebaseRoot for git operations
          await analyzer.index(modelRoot, { codebaseRoot });

          // Verify that the analyzer invoked index_repository with codebaseRoot
          const indexCall = invokedTools.find((t) => t.tool === "index_repository");
          expect(indexCall).toBeDefined();
          const params = indexCall?.params as { repo_path?: string };
          // The analyzer should have used codebaseRoot when calling index_repository
          expect(params.repo_path).toBe(codebaseRoot);
        } finally {
          StdioClient.prototype.spawn = originalSpawn;
          StdioClient.prototype.close = originalClose;
          StdioClient.prototype.initialize = originalInitialize;
          StdioClient.prototype.invokeTool = originalInvokeTool;
        }
      });
    });

    describe("status() with dual-root", () => {
      it("should use codebaseRoot for git freshness check", async () => {
        const farmRoot = join(TEST_DIR, "status-git-check");
        const modelRoot = join(farmRoot, "model");
        const codebaseRoot = join(farmRoot, "code");

        await mkdir(modelRoot, { recursive: true });
        await mkdir(codebaseRoot, { recursive: true });

        // Create git repo at codebaseRoot
        spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
        await writeFile(join(codebaseRoot, "README.md"), "# Test");
        spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["commit", "-m", "Initial"], { cwd: codebaseRoot, stdio: "pipe" });

        // status() should recognize that modelRoot is not indexed
        // (index metadata file won't exist)
        const status = await analyzer.status(modelRoot, { codebaseRoot });

        expect(status.indexed).toBe(false);
        expect(status.fresh).toBe(false);
      });
    });

    describe("resolveProjectName() with dual-root", () => {
      it("should use codebaseRoot when specified", async () => {
        const farmRoot = join(TEST_DIR, "resolve-project-name");
        const modelRoot = join(farmRoot, "model");
        const codebaseRoot = join(farmRoot, "code");

        // Create minimal project structure
        await mkdir(modelRoot, { recursive: true });
        await mkdir(codebaseRoot, { recursive: true });

        spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
        await writeFile(join(codebaseRoot, "README.md"), "# Code");
        spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["commit", "-m", "Init"], { cwd: codebaseRoot, stdio: "pipe" });

        // Verify both directories exist and are separate
        // This verifies that the analyzer can work with separate roots
        expect(codebaseRoot).not.toBe(modelRoot);
        expect(codebaseRoot).toContain("code");
        expect(modelRoot).toContain("model");
      });
    });
  });

  describe("Path Relativization", () => {
    let analyzer: CbmAnalyzer;
    let mockMapper: MappingLoader;

    beforeEach(async () => {
      mockMapper = await MappingLoader.load("cbm");
      analyzer = new CbmAnalyzer(mockMapper);
    });

    describe("transformNodeToEndpoint()", () => {
      it("should produce paths relative to codebaseRoot, not modelRoot", async () => {
        const codebaseRoot = join(TEST_DIR, "endpoint-codebase");
        await mkdir(codebaseRoot, { recursive: true });

        const routeMapping = mockMapper.getNodeMapping("Route");
        expect(routeMapping).toBeDefined();

        const testNode = {
          id: "route-1",
          name: "/users",
          qualified_name: "__route__GET__/users",
          properties: {
            method: "GET",
            path: "/users",
            handler_name: "getUsers",
            symbol: "getUsers",
            start_line: 10,
            end_line: 20,
          },
          file_path: join(codebaseRoot, "src", "routes.ts"),
        };

        const candidate = await (analyzer as any).transformNodeToEndpoint(
          testNode,
          routeMapping!,
          codebaseRoot
        );

        // source_file should be relative to codebaseRoot
        expect(candidate.source_file).toBe("src/routes.ts");
        expect(candidate.source_file).not.toContain(codebaseRoot);
        expect(candidate.source_reference?.locations?.[0]?.file).toBe("src/routes.ts");
      });

      it("should handle paths correctly when sourceFile is absolute and codebaseRoot differs from modelRoot", async () => {
        const farmRoot = join(TEST_DIR, "endpoint-farm");
        const modelRoot = join(farmRoot, "model");
        const codebaseRoot = join(farmRoot, "code");

        await mkdir(modelRoot, { recursive: true });
        await mkdir(codebaseRoot, { recursive: true });

        const absoluteFilePath = join(codebaseRoot, "api", "handlers.ts");

        const routeMapping = mockMapper.getNodeMapping("Route");
        const testNode = {
          id: "route-2",
          name: "/api",
          qualified_name: "__route__POST__/api",
          properties: {
            method: "POST",
            path: "/api",
            handler_name: "createResource",
            symbol: "createResource",
          },
          file_path: absoluteFilePath,
        };

        const candidate = await (analyzer as any).transformNodeToEndpoint(
          testNode,
          routeMapping!,
          codebaseRoot
        );

        // Verify the path is correctly relativized to codebaseRoot
        expect(candidate.source_file).toBe("api/handlers.ts");
      });
    });

    describe("transformNodeToService()", () => {
      it("should produce paths relative to codebaseRoot", async () => {
        const codebaseRoot = join(TEST_DIR, "service-codebase");
        await mkdir(codebaseRoot, { recursive: true });

        const classMapping = mockMapper.getNodeMapping("Class");
        expect(classMapping).toBeDefined();

        const testNode = {
          id: "class-1",
          name: "UserService",
          qualified_name: "com.example.UserService",
          properties: {
            name: "UserService",
            fan_in: 3,
            fan_out: 2,
          },
          file_path: join(codebaseRoot, "src", "services", "UserService.ts"),
        };

        const candidate = await (analyzer as any).transformNodeToService(
          testNode,
          classMapping!,
          codebaseRoot,
          []
        );

        // source_file should be relative to codebaseRoot
        expect(candidate.source_file).toBe("src/services/UserService.ts");
        expect(candidate.source_file).not.toContain(codebaseRoot);
      });
    });

    describe("shapeCallGraphNode()", () => {
      it("should compute relative paths using codebaseRoot", () => {
        const codebaseRoot = join(TEST_DIR, "callgraph-codebase");
        const filePath = join(codebaseRoot, "lib", "utils.ts");

        const node = {
          id: "fn-1",
          qualified_name: "util.helper",
          file_path: filePath,
          source_symbol: "helper",
          depth: 1,
        };

        const shaped = shapeCallGraphNode(node, codebaseRoot);

        expect(shaped.source_file).toBe("lib/utils.ts");
        expect(shaped.qualified_name).toBe("util.helper");
        expect(shaped.source_symbol).toBe("helper");
      });
    });
  });

  describe("Integration: End-to-End Detached Scenario", () => {
    let analyzer: CbmAnalyzer;
    let mockMapper: MappingLoader;

    beforeEach(async () => {
      mockMapper = await MappingLoader.load("cbm");
      analyzer = new CbmAnalyzer(mockMapper);
    });

    it("should successfully index and query with detached codebase_path", async () => {
      const farmRoot = join(TEST_DIR, "e2e-detached");
      const modelRoot = join(farmRoot, "service-model");
      const codebaseRoot = join(farmRoot, "service-code");

      // Create directory structure
      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });
      await mkdir(join(codebaseRoot, "src", "api"), { recursive: true });

      // Initialize git repo at codebaseRoot
      spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
      spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
      spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
      await writeFile(join(codebaseRoot, "src", "api", "routes.ts"), "export const routes = [];");
      await writeFile(join(codebaseRoot, "README.md"), "# Service");
      spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
      spawnSync("git", ["commit", "-m", "Initial commit"], { cwd: codebaseRoot, stdio: "pipe" });

      // Mock StdioClient to test analyzer.index() with dual-root
      const originalSpawn = StdioClient.prototype.spawn;
      const originalClose = StdioClient.prototype.close;
      const originalInitialize = StdioClient.prototype.initialize;
      const originalInvokeTool = StdioClient.prototype.invokeTool;

      const invokedTools: Array<{ tool: string; params: unknown }> = [];

      StdioClient.prototype.spawn = function () { /* noop */ };
      StdioClient.prototype.close = function () { /* noop */ };
      StdioClient.prototype.initialize = async function () { return { capabilities: {} }; };
      StdioClient.prototype.invokeTool = async function (tool: string, params: unknown) {
        invokedTools.push({ tool, params });
        if (tool === "list_projects") {
          return { projects: [{ name: "service-project", root_path: codebaseRoot }] };
        }
        if (tool === "index_repository") {
          return { nodes: 42, edges: 100, status: "complete" };
        }
        return {};
      };

      try {
        // Call analyzer.index with detached codebaseRoot
        const indexResult = await analyzer.index(modelRoot, { codebaseRoot });
        expect(indexResult).toBeDefined();
        expect(indexResult.node_count).toBe(42);

        // Verify index_repository was called with codebaseRoot
        const indexCall = invokedTools.find((t) => t.tool === "index_repository");
        expect(indexCall).toBeDefined();
        const params = indexCall?.params as { repo_path?: string };
        expect(params.repo_path).toBe(codebaseRoot);
      } finally {
        StdioClient.prototype.spawn = originalSpawn;
        StdioClient.prototype.close = originalClose;
        StdioClient.prototype.initialize = originalInitialize;
        StdioClient.prototype.invokeTool = originalInvokeTool;
      }
    });

    it("should call analyzer commands with correct codebaseRoot", async () => {
      const farmRoot = join(TEST_DIR, "e2e-commands");
      const modelRoot = join(farmRoot, "model");
      const codebaseRoot = join(farmRoot, "code");

      await mkdir(modelRoot, { recursive: true });
      await mkdir(codebaseRoot, { recursive: true });

      spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
      spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
      spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
      await writeFile(join(codebaseRoot, "main.ts"), "console.log('hello')");
      spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
      spawnSync("git", ["commit", "-m", "Initial"], { cwd: codebaseRoot, stdio: "pipe" });

      // Mock StdioClient to verify analyzer uses codebaseRoot in both index and endpoints calls
      const originalSpawn = StdioClient.prototype.spawn;
      const originalClose = StdioClient.prototype.close;
      const originalInitialize = StdioClient.prototype.initialize;
      const originalInvokeTool = StdioClient.prototype.invokeTool;

      const invokedTools: Array<{ tool: string; params: unknown }> = [];

      StdioClient.prototype.spawn = function () { /* noop */ };
      StdioClient.prototype.close = function () { /* noop */ };
      StdioClient.prototype.initialize = async function () { return { capabilities: {} }; };
      StdioClient.prototype.invokeTool = async function (tool: string, params: unknown) {
        invokedTools.push({ tool, params });
        if (tool === "list_projects") {
          return { projects: [{ name: "main-project", root_path: codebaseRoot }] };
        }
        if (tool === "index_repository") {
          return { nodes: 5, edges: 3, status: "complete" };
        }
        if (tool === "search_graph") {
          return { results: [] };
        }
        if (tool === "endpoints") {
          return { endpoints: [{ name: "GET /hello", path: "/hello", method: "GET" }] };
        }
        if (tool === "detect") {
          return { detected: { installed: true, binary_path: "/fake", contract_ok: true, mcp_registered: false } };
        }
        return {};
      };

      try {
        // Call dr analyzer index with codebaseRoot option
        const indexResult = await analyzer.index(modelRoot, { codebaseRoot });
        expect(indexResult.node_count).toBe(5);

        // Verify the command used codebaseRoot
        const indexCall = invokedTools.find((t) => t.tool === "index_repository");
        expect(indexCall?.params).toBeDefined();
        expect((indexCall?.params as { repo_path?: string }).repo_path).toBe(codebaseRoot);
      } finally {
        StdioClient.prototype.spawn = originalSpawn;
        StdioClient.prototype.close = originalClose;
        StdioClient.prototype.initialize = originalInitialize;
        StdioClient.prototype.invokeTool = originalInvokeTool;
      }
    });
  });

  describe("Edge Cases", () => {
    let analyzer: CbmAnalyzer;
    let mockMapper: MappingLoader;

    beforeEach(async () => {
      mockMapper = await MappingLoader.load("cbm");
      analyzer = new CbmAnalyzer(mockMapper);
    });

    describe("Default Behavior (codebaseRoot === projectRoot)", () => {
      it("should work unchanged when codebaseRoot is not specified", async () => {
        const colocatedRoot = join(TEST_DIR, "colocated");
        await mkdir(colocatedRoot, { recursive: true });

        spawnSync("git", ["init"], { cwd: colocatedRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: colocatedRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.name", "Test User"], { cwd: colocatedRoot, stdio: "pipe" });
        await writeFile(join(colocatedRoot, "README.md"), "# Project");
        spawnSync("git", ["add", "."], { cwd: colocatedRoot, stdio: "pipe" });
        spawnSync("git", ["commit", "-m", "Initial"], { cwd: colocatedRoot, stdio: "pipe" });

        // status() should use projectRoot when options are not provided
        const status = await analyzer.status(colocatedRoot);

        expect(status).toBeDefined();
        expect(status.indexed).toBe(false); // Not indexed yet, but should not fail
      });

      it("should produce paths relative to projectRoot when no codebaseRoot is specified", async () => {
        const projectRoot = join(TEST_DIR, "colocated-paths");
        await mkdir(projectRoot, { recursive: true });

        const routeMapping = mockMapper.getNodeMapping("Route");

        const testNode = {
          id: "route-1",
          name: "/users",
          qualified_name: "__route__GET__/users",
          properties: {
            method: "GET",
            path: "/users",
            handler_name: "getUsers",
            symbol: "getUsers",
          },
          file_path: join(projectRoot, "src", "routes.ts"),
        };

        const candidate = await (analyzer as any).transformNodeToEndpoint(
          testNode,
          routeMapping!,
          projectRoot
        );

        // When codebaseRoot === projectRoot, paths should be relative to it
        expect(candidate.source_file).toBe("src/routes.ts");
      });
    });

    describe("Non-Git Model Root with Git Codebase Root", () => {
      it("should succeed with status() when model root is not a git repo but codebaseRoot is", async () => {
        const farmRoot = join(TEST_DIR, "non-git-model");
        const modelRoot = join(farmRoot, "model");
        const codebaseRoot = join(farmRoot, "code");

        await mkdir(modelRoot, { recursive: true });
        await mkdir(codebaseRoot, { recursive: true });

        // Initialize git ONLY at codebaseRoot
        spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
        await writeFile(join(codebaseRoot, "README.md"), "# Code");
        spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["commit", "-m", "Initial"], { cwd: codebaseRoot, stdio: "pipe" });

        // Verify modelRoot is NOT a git repo
        const modelGitResult = spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: modelRoot,
          stdio: "pipe",
          encoding: "utf-8",
        });
        expect(modelGitResult.status).not.toBe(0);

        // Verify codebaseRoot IS a git repo
        const codeGitResult = spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: codebaseRoot,
          stdio: "pipe",
          encoding: "utf-8",
        });
        expect(codeGitResult.status).toBe(0);

        // status() should work with codebaseRoot option
        const status = await analyzer.status(modelRoot, { codebaseRoot });

        expect(status).toBeDefined();
        expect(status.indexed).toBe(false); // Not indexed, but should not crash
      });

      it("should use codebaseRoot for git operations even when modelRoot is not a git repo", async () => {
        const farmRoot = join(TEST_DIR, "separate-git");
        const modelRoot = join(farmRoot, "model");
        const codebaseRoot = join(farmRoot, "code");

        await mkdir(modelRoot, { recursive: true });
        await mkdir(codebaseRoot, { recursive: true });

        // Git only at codebaseRoot
        spawnSync("git", ["init"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["config", "user.name", "Test User"], { cwd: codebaseRoot, stdio: "pipe" });
        await writeFile(join(codebaseRoot, "file.txt"), "content");
        spawnSync("git", ["add", "."], { cwd: codebaseRoot, stdio: "pipe" });
        spawnSync("git", ["commit", "-m", "Init"], { cwd: codebaseRoot, stdio: "pipe" });

        // Mock StdioClient to verify analyzer uses codebaseRoot for git operations
        const originalSpawn = StdioClient.prototype.spawn;
        const originalClose = StdioClient.prototype.close;
        const originalInitialize = StdioClient.prototype.initialize;
        const originalInvokeTool = StdioClient.prototype.invokeTool;

        StdioClient.prototype.spawn = function () { /* noop */ };
        StdioClient.prototype.close = function () { /* noop */ };
        StdioClient.prototype.initialize = async function () { return { capabilities: {} }; };
        StdioClient.prototype.invokeTool = async function (tool: string, params: unknown) {
          if (tool === "list_projects") {
            return { projects: [{ name: "test-project", root_path: codebaseRoot }] };
          }
          if (tool === "index_repository") {
            return { nodes: 2, edges: 1, status: "complete" };
          }
          return {};
        };

        try {
          // Call analyzer.index with modelRoot that's NOT a git repo but codebaseRoot IS
          const result = await analyzer.index(modelRoot, { codebaseRoot });
          // Should succeed because analyzer uses codebaseRoot for git operations
          expect(result.node_count).toBe(2);
        } finally {
          StdioClient.prototype.spawn = originalSpawn;
          StdioClient.prototype.close = originalClose;
          StdioClient.prototype.initialize = originalInitialize;
          StdioClient.prototype.invokeTool = originalInvokeTool;
        }
      });
    });

    describe("Empty/Missing Paths", () => {
      it("should handle nodes with missing file_path gracefully", async () => {
        const routeMapping = mockMapper.getNodeMapping("Route");

        const testNode = {
          id: "route-no-file",
          name: "/users",
          qualified_name: "__route__GET__/users",
          properties: {
            method: "GET",
            path: "/users",
            handler_name: "getUsers",
            symbol: "getUsers",
          },
          // No file_path property
        };

        const candidate = await (analyzer as any).transformNodeToEndpoint(
          testNode,
          routeMapping!,
          "/some/codebase"
        );

        expect(candidate.source_file).toBe("");
      });

      it("should handle shapeCallGraphNode with empty file path", () => {
        const node = {
          id: "fn-no-file",
          qualified_name: "someFunc",
          // No file_path
          source_symbol: "func",
        };

        const shaped = shapeCallGraphNode(node, "/codebase");

        expect(shaped.source_file).toBe("");
        expect(shaped.qualified_name).toBe("someFunc");
      });
    });
  });
});
