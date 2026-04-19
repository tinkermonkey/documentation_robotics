/**
 * Integration tests for dr analyzer verify subcommand
 *
 * Tests full verify flow using fixture projects with known ground-truth outcomes:
 * - No active changeset → verified_against: "base_model"
 * - Active changeset with staged addition → element appears in index
 * - Active changeset with staged deletion → element absent from index
 * - .dr-verify-ignore.yaml rules honored (path/handler/element_id)
 * - --layer application → clean exit with message
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawnSync } from "child_process";
import { VerifyEngine, type DiscoveredRoute } from "@/analyzers/verify-engine.js";
import { Model } from "@/core/model.js";
import { StagingAreaManager } from "@/core/staging-area.js";

let testProjectRoot: string = "";

describe("Verify Integration - Full Verify Flow", () => {
  beforeEach(async () => {
    // Create temporary test project
    testProjectRoot = `/tmp/verify-integration-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await mkdir(testProjectRoot, { recursive: true });

    // Initialize git repository
    spawnSync("git", ["init"], { cwd: testProjectRoot, stdio: "pipe" });
    spawnSync("git", ["config", "user.email", "test@example.com"], {
      cwd: testProjectRoot,
      stdio: "pipe",
    });
    spawnSync("git", ["config", "user.name", "Test User"], {
      cwd: testProjectRoot,
      stdio: "pipe",
    });

    // Create initial commit
    await writeFile(join(testProjectRoot, "README.md"), "# Test Project\n");
    spawnSync("git", ["add", "."], { cwd: testProjectRoot, stdio: "pipe" });
    spawnSync("git", ["commit", "-m", "Initial commit"], {
      cwd: testProjectRoot,
      stdio: "pipe",
    });
  });

  afterEach(async () => {
    try {
      if (testProjectRoot && testProjectRoot.startsWith("/tmp/")) {
        await rm(testProjectRoot, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Changeset-aware verification path", () => {
    it("should use base_model when changesetAware=false explicitly", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create API layer with operation
      const apiYaml = `
get-users:
  id: "api.operation.get-users"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          http_method: "GET",
          http_path: "/users",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Should verify against base_model when explicitly false
      expect(report.changeset_context.verified_against).toBe("base_model");
      expect(report.buckets.matched.length).toBe(1);
    });

    it("should default to base_model when changesetAware is undefined and no active changeset", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create API layer
      const apiYaml = `
get-users:
  id: "api.operation.get-users"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          http_method: "GET",
          http_path: "/users",
        },
      ];

      const engine = new VerifyEngine();
      // Note: changesetAware is now optional and defaults to true when undefined
      // But with no active changeset, it should still use base_model
      const report = await engine.computeReport(testProjectRoot, routes, {
        // changesetAware not specified - uses default (true)
      });

      expect(report.changeset_context.verified_against).toBe("base_model");
      expect(report.changeset_context.active_changeset).toBeNull();
      expect(report.buckets.matched.length).toBe(1);
    });

    it("should use changeset_view when changesetAware=true with active changeset", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create API layer with one operation
      const apiYaml = `
get-users:
  id: "api.operation.get-users"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      // Create and activate a changeset with a new operation
      const model = await Model.load(testProjectRoot, { lazyLoad: false });
      const manager = new StagingAreaManager(testProjectRoot, model);

      const changeset = await manager.create(
        "test-verify-changeset",
        "Test changeset for verify-aware path"
      );
      await manager.setActive(changeset.id!);

      // Stage a new operation in the changeset
      await manager.stage(changeset.id!, {
        type: "add",
        elementId: "api.operation.create-users",
        layerName: "api",
        timestamp: new Date().toISOString(),
        after: {
          type: "operation",
          name: "Create Users",
          attributes: {
            http_method: "POST",
            http_path: "/users",
          },
        },
      });

      // Routes include both base and staged operations
      const routes: DiscoveredRoute[] = [
        {
          id: "route-get",
          http_method: "GET",
          http_path: "/users",
        },
        {
          id: "route-post",
          http_method: "POST",
          http_path: "/users",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: true,  // Explicitly true to use changeset view
      });

      // Should verify against changeset_view
      expect(report.changeset_context.verified_against).toBe("changeset_view");
      expect(report.changeset_context.active_changeset).toBe(changeset.id);
      // Both operations should be matched (one from base, one from changeset)
      expect(report.buckets.matched.length).toBe(2);
    });
  });

  describe("Base model path (no active changeset)", () => {
    it("should verify against base model when no changeset is active", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create source file
      const handlersDir = join(testProjectRoot, "src", "handlers");
      await mkdir(handlersDir, { recursive: true });
      await writeFile(
        join(handlersDir, "users.ts"),
        "export class UsersHandler {}"
      );

      // Create API layer with operation
      const apiYaml = `
get-users:
  id: "123e4567-e89b-12d3-a456-426614174000"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/users.ts"
          symbol: "UsersHandler.getUsers"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          http_method: "GET",
          http_path: "/users",
          handler: "UsersHandler",
          source_file: "src/handlers/users.ts",
          source_symbol: "UsersHandler.getUsers",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: true,
      });

      expect(report.changeset_context.verified_against).toBe("base_model");
      expect(report.changeset_context.active_changeset).toBeNull();
      expect(report.buckets.matched.length).toBe(1);
    });
  });

  describe("Ignore file handling", () => {
    it("should honor .dr-verify-ignore.yaml rules with path matching", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create ignore file with path rule
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      await writeFile(
        ignoreFile,
        `version: 1
ignore:
  - patterns:
      - path: "/health"
    reason: "Health check endpoints ignored"
    match: "graph_only"
  - patterns:
      - path: "/admin"
    reason: "Admin endpoints ignored"
    match: "graph_only"`
      );

      const apiYaml = `
get-users:
  id: "123e4567-e89b-12d3-a456-426614174000"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [
        {
          id: "route-health",
          http_method: "GET",
          http_path: "/health",
          handler: "HealthHandler",
          source_file: "src/handlers/health.ts",
          source_symbol: "HealthHandler.getHealth",
        },
        {
          id: "route-users",
          http_method: "GET",
          http_path: "/users",
          handler: "UsersHandler",
          source_file: "src/handlers/users.ts",
          source_symbol: "UsersHandler.getUsers",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
        ignoreFilePath: ignoreFile,
      });

      // Health route should be ignored
      expect(report.buckets.ignored.length).toBe(1);
      expect(report.buckets.ignored[0].id).toBe("route-health");
      expect(report.buckets.ignored[0].reason).toBe(
        "Health check endpoints ignored"
      );

      // Users route should match
      expect(report.buckets.matched.length).toBe(1);
    });

    it("should honor .dr-verify-ignore.yaml rules with handler glob matching", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create ignore file with handler glob rule
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      await writeFile(
        ignoreFile,
        `version: 1
ignore:
  - patterns:
      - handler: "*HealthHandler*"
    reason: "Health-related handlers ignored"
    match: "graph_only"`
      );

      const apiYaml = `
get-users:
  id: "123e4567-e89b-12d3-a456-426614174000"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [
        {
          id: "route-health-check",
          http_method: "GET",
          http_path: "/health/check",
          handler: "com.example.HealthHandler",
          source_file: "src/handlers/health.ts",
          source_symbol: "HealthHandler.check",
        },
        {
          id: "route-users",
          http_method: "GET",
          http_path: "/users",
          handler: "UsersHandler",
          source_file: "src/handlers/users.ts",
          source_symbol: "UsersHandler.getUsers",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
        ignoreFilePath: ignoreFile,
      });

      // Health route should be ignored by handler glob
      expect(report.buckets.ignored.length).toBe(1);
      expect(report.buckets.ignored[0].id).toBe("route-health-check");
      expect(report.buckets.ignored[0].reason).toBe(
        "Health-related handlers ignored"
      );

      // Users route should match
      expect(report.buckets.matched.length).toBe(1);
    });

    it("should honor .dr-verify-ignore.yaml rules with element_id matching", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create source file
      const handlersDir = join(testProjectRoot, "src", "handlers");
      await mkdir(handlersDir, { recursive: true });
      await writeFile(join(handlersDir, "api.ts"), "export class ApiHandler {}");

      // Create ignore file with element_ids rule
      // Note: element_ids use the UUID from the YAML, not the path field
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      await writeFile(
        ignoreFile,
        `version: 1
ignore:
  - patterns:
      - element_ids: ["123e4567-e89b-12d3-a456-426614174001"]
    reason: "Status endpoint ignored"
    match: "model_only"`
      );

      const apiYaml = `
get-status:
  id: "123e4567-e89b-12d3-a456-426614174001"
  path: "api.operation.get-status"
  type: "operation"
  name: "Get Status"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/status"
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/api.ts"
          symbol: "ApiHandler.getStatus"

get-users:
  id: "223e4567-e89b-12d3-a456-426614174002"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/api.ts"
          symbol: "ApiHandler.getUsers"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
        ignoreFilePath: ignoreFile,
      });

      // get-status should be ignored by element_id rule, get-users should be in_model_only
      expect(report.buckets.ignored.length).toBe(1);
      expect(report.buckets.ignored[0].reason).toBe("Status endpoint ignored");
      expect(report.buckets.in_model_only.length).toBe(1);
      expect(report.buckets.in_model_only[0].id).toBe(
        "223e4567-e89b-12d3-a456-426614174002"
      );
    });
  });

  describe("Layer filtering", () => {
    it("should verify only api layer regardless of layer option", async () => {
      // Create minimal model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(testProjectRoot, "documentation-robotics", "model", "manifest.yaml");
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create empty API layer
      await writeFile(join(modelDir, "operations.yaml"), "");

      // Test that verify engine always operates on api layer
      // Even if other layers are requested, only api is verified
      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
        layers: ["application", "data-model"],  // Request non-api layers
      });

      // Report should indicate only api layer was verified
      expect(report.layers_verified).toEqual(["api"]);
      // With no routes, api layer buckets should be empty
      expect(report.buckets.matched.length).toBe(0);
      expect(report.buckets.in_graph_only.length).toBe(0);
    });
  });

  describe("Report structure and metadata", () => {
    it("should include all required fields in verify report", async () => {
      // Create model structure
      const modelDir = join(testProjectRoot, "documentation-robotics", "model", "06_api");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(
        testProjectRoot,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      const apiYaml = `
get-users:
  id: "123e4567-e89b-12d3-a456-426614174000"
  path: "api.operation.get-users"
  type: "operation"
  name: "Get Users"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/users"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Verify all required fields are present
      expect(report.generated_at).toBeDefined();
      expect(new Date(report.generated_at).getTime()).toBeGreaterThan(0);
      expect(report.project_root).toBe(testProjectRoot);
      expect(report.analyzer).toBe("codebase-memory-mcp");
      expect(report.analyzer_indexed_at).toBeDefined();
      expect(report.changeset_context).toBeDefined();
      expect(report.layers_verified).toContain("api");
      expect(report.buckets).toBeDefined();
      expect(report.summary).toBeDefined();
    });
  });
});
