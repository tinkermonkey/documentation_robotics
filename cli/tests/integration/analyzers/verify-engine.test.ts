/**
 * Verify Engine Integration Tests
 *
 * Tests the verification engine for:
 * - Dual-index matching (source_reference + http_method:http_path)
 * - Changeset-aware model view resolution
 * - Bucket computation (matched, in_graph_only, in_model_only, ignored)
 * - File-existence filtering for in_model_only
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import * as path from "path";
import { fileURLToPath } from "url";
import { VerifyEngine, type DiscoveredRoute } from "@/analyzers/verify-engine.js";
import { IgnoreFileLoader } from "@/analyzers/verify-ignore.js";
import { Model } from "@/core/model.js";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let testProjectRoot: string = "";

describe("Verify Engine", () => {
  beforeEach(async () => {
    // Create temporary test project
    testProjectRoot = `/tmp/verify-engine-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

  describe("IgnoreFileLoader", () => {
    it("should load ignore rules from YAML file", async () => {
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      const content = `version: 1
ignore:
  - handler: "*HealthHandler*"
    reason: "Health check endpoints ignored"
  - path: "/admin"
    reason: "Admin routes ignored"
  - element_ids: ["api.operation.get-status"]
    reason: "Status endpoint ignored"`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(3);
      expect(rules[0].handler).toBe("*HealthHandler*");
      expect(rules[1].path).toBe("/admin");
      expect(rules[2].element_ids).toContain("api.operation.get-status");
    });

    it("should return empty rules when file doesn't exist", async () => {
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(0);
    });

    it("should return empty rules when version is not 1", async () => {
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      const content = `version: 2
ignore:
  - handler: "*HealthHandler*"
    reason: "Health check endpoints ignored"`;

      await writeFile(ignoreFile, content);

      const rules = await IgnoreFileLoader.load(ignoreFile);
      expect(rules.length).toBe(0);
    });

    it("should match handler with glob pattern", () => {
      const rules = [
        {
          handler: "*HealthHandler*",
          reason: "Health check endpoints ignored",
        },
      ];

      const match1 = IgnoreFileLoader.matches(
        { handler: "com.example.HealthHandler" },
        "route",
        rules
      );
      expect(match1).toBe("Health check endpoints ignored");

      const match2 = IgnoreFileLoader.matches(
        { handler: "com.example.UserHandler" },
        "route",
        rules
      );
      expect(match2).toBeNull();
    });

    it("should match path with exact matching", () => {
      const rules = [
        {
          path: "/health",
          reason: "Health endpoint ignored",
        },
      ];

      const match1 = IgnoreFileLoader.matches(
        { path: "/health" },
        "route",
        rules
      );
      expect(match1).toBe("Health endpoint ignored");

      const match2 = IgnoreFileLoader.matches(
        { path: "/healthcheck" },
        "route",
        rules
      );
      expect(match2).toBeNull();
    });

    it("should match element_ids with exact matching", () => {
      const rules = [
        {
          element_ids: ["api.operation.get-health", "api.operation.get-status"],
          reason: "Monitoring endpoints ignored",
        },
      ];

      const match1 = IgnoreFileLoader.matches(
        { element_id: "api.operation.get-health" },
        "element",
        rules
      );
      expect(match1).toBe("Monitoring endpoints ignored");

      const match2 = IgnoreFileLoader.matches(
        { element_id: "api.operation.get-users" },
        "element",
        rules
      );
      expect(match2).toBeNull();
    });
  });

  describe("computeReport", () => {
    it("should handle projects with no API layer", async () => {
      // Create minimal model structure without API layer
      const modelDir = join(testProjectRoot, "documentation-robotics", "model");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(modelDir, "manifest.yaml");
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

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
        changesetAware: false,
      });

      expect(report.buckets.in_graph_only.length).toBe(1);
      expect(report.buckets.matched.length).toBe(0);
      expect(report.buckets.in_model_only.length).toBe(0);
      expect(report.changeset_context.verified_against).toBe("base_model");
    });

    it("should compute correct buckets with known fixture data", async () => {
      // Create model structure with API layer
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

      // Create source files that will be checked
      const handlersDir = join(testProjectRoot, "src", "handlers");
      await mkdir(handlersDir, { recursive: true });
      await writeFile(
        join(handlersDir, "users.ts"),
        "export class UsersHandler {}"
      );
      await writeFile(
        join(handlersDir, "products.ts"),
        "export class ProductsHandler {}"
      );

      // Create API layer with some operations
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

get-products:
  id: "223e4567-e89b-12d3-a456-426614174001"
  path: "api.operation.get-products"
  type: "operation"
  name: "Get Products"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/products"
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/products.ts"
          symbol: "ProductsHandler.getProducts"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      // Create routes discovered from graph
      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          http_method: "GET",
          http_path: "/users",
          handler: "UsersHandler",
          source_file: "src/handlers/users.ts",
          source_symbol: "UsersHandler.getUsers",
        },
        // This route is in graph only (not in model)
        {
          id: "route-2",
          http_method: "POST",
          http_path: "/users",
          handler: "UsersHandler",
          source_file: "src/handlers/users.ts",
          source_symbol: "UsersHandler.createUser",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      expect(report.buckets.matched.length).toBe(1);
      expect(report.buckets.in_graph_only.length).toBe(1);
      expect(report.buckets.in_model_only.length).toBe(1);
      expect(report.summary.matched_count).toBe(1);
      expect(report.summary.in_graph_only_count).toBe(1);
      expect(report.summary.in_model_only_count).toBe(1);
    });

    it("should exclude in_model_only elements with no source_reference", async () => {
      // Create model structure with API layer
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

get-products:
  id: "223e4567-e89b-12d3-a456-426614174001"
  path: "api.operation.get-products"
  type: "operation"
  name: "Get Products"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/products"
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/products.ts"
          symbol: "ProductsHandler.getProducts"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      // Create the products file
      const handlersDir = join(testProjectRoot, "src", "handlers");
      await mkdir(handlersDir, { recursive: true });
      await writeFile(
        join(handlersDir, "products.ts"),
        "export class ProductsHandler {}"
      );

      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Only the operation with source_reference should appear in in_model_only
      expect(report.buckets.in_model_only.length).toBe(1);
      expect(report.buckets.in_model_only[0].source_file).toBe(
        "src/handlers/products.ts"
      );
    });

    it("should set changeset context correctly when no changeset is active", async () => {
      const modelDir = join(testProjectRoot, "documentation-robotics", "model");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(modelDir, "manifest.yaml");
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: true,
      });

      expect(report.changeset_context.verified_against).toBe("base_model");
      expect(report.changeset_context.active_changeset).toBeNull();
    });

    it("should match using secondary index (http_method:http_path) when primary index fails", async () => {
      // Create model structure with API layer
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

      // Create API layer with operation that has http_method/http_path but no source_reference
      // The route will match via secondary index (http_method:http_path)
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

      // Create route discovered from graph with matching http_method:http_path
      // but different source_file:source_symbol (won't match primary index)
      const routes: DiscoveredRoute[] = [
        {
          id: "different-file:symbol",
          http_method: "GET",
          http_path: "/users",
          handler: "UsersHandler",
          source_file: "src/handlers/other.ts",
          source_symbol: "OtherHandler.getUsers",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Should match via secondary index (http_method:http_path)
      // The matched element ID is the UUID from the YAML, not the path
      expect(report.buckets.matched.length).toBe(1);
      expect(report.buckets.matched[0].id).toBe(
        "123e4567-e89b-12d3-a456-426614174000"
      );
      expect(report.buckets.in_graph_only.length).toBe(0);
    });

    it("should apply ignore rules to routes during bucketing", async () => {
      // Create model structure with API layer
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

      // Create source file for the matched route
      const handlersDir = join(testProjectRoot, "src", "handlers");
      await mkdir(handlersDir, { recursive: true });
      await writeFile(
        join(handlersDir, "users.ts"),
        "export class UsersHandler {}"
      );

      // Create ignore file
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      await writeFile(
        ignoreFile,
        `version: 1
ignore:
  - handler: "*HealthHandler*"
    reason: "Health check endpoints ignored"`
      );

      // Create API layer with one operation (matched route)
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

      // Create routes - one matching model (users), one matching ignore rule (health)
      const routes: DiscoveredRoute[] = [
        {
          id: "route-users",
          http_method: "GET",
          http_path: "/users",
          handler: "UsersHandler",
          source_file: "src/handlers/users.ts",
          source_symbol: "UsersHandler.getUsers",
        },
        {
          id: "route-health",
          http_method: "GET",
          http_path: "/health",
          handler: "HealthHandler",
          source_file: "src/handlers/health.ts",
          source_symbol: "HealthHandler.getHealth",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
        ignoreFilePath: ignoreFile,
      });

      // The health route should be ignored, users route should be matched
      expect(report.buckets.ignored.length).toBe(1);
      expect(report.buckets.ignored[0].id).toBe("route-health");
      expect(report.buckets.ignored[0].entry_type).toBe("route");
      expect(report.buckets.ignored[0].reason).toBe(
        "Health check endpoints ignored"
      );
      expect(report.buckets.matched.length).toBe(1);
      // The matched element ID is the UUID from the YAML
      expect(report.buckets.matched[0].id).toBe(
        "123e4567-e89b-12d3-a456-426614174000"
      );
    });

    it("should apply ignore rules to in_model_only elements", async () => {
      // Create model structure with API layer
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
        join(handlersDir, "api.ts"),
        "export class ApiHandler {}"
      );

      // Create ignore file with UUID-based element IDs (since model uses UUID as element ID)
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      await writeFile(
        ignoreFile,
        `version: 1
ignore:
  - element_ids: ["223e4567-e89b-12d3-a456-426614174001"]
    reason: "Monitoring endpoint ignored"`
      );

      // Create API layer with two operations
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
        - file: "src/handlers/api.ts"
          symbol: "ApiHandler.getUsers"

get-health:
  id: "223e4567-e89b-12d3-a456-426614174001"
  path: "api.operation.get-health"
  type: "operation"
  name: "Get Health"
  layer_id: "api"
  attributes:
    http_method: "GET"
    http_path: "/health"
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/api.ts"
          symbol: "ApiHandler.getHealth"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
        ignoreFilePath: ignoreFile,
      });

      // The health operation (UUID 223e...) should be in ignored, users should be in in_model_only
      expect(report.buckets.ignored.length).toBe(1);
      expect(report.buckets.ignored[0].id).toBe(
        "223e4567-e89b-12d3-a456-426614174001"
      );
      expect(report.buckets.ignored[0].entry_type).toBe("element");
      expect(report.buckets.ignored[0].reason).toBe("Monitoring endpoint ignored");
      expect(report.buckets.in_model_only.length).toBe(1);
      expect(report.buckets.in_model_only[0].id).toBe(
        "123e4567-e89b-12d3-a456-426614174000"
      );
    });

    it("should throw on malformed YAML in ignore file", async () => {
      const modelDir = join(testProjectRoot, "documentation-robotics", "model");
      await mkdir(modelDir, { recursive: true });

      const manifestPath = join(modelDir, "manifest.yaml");
      await writeFile(
        manifestPath,
        `project:
  name: "Test Project"
  version: "1.0.0"
spec_version: "0.8.3"`
      );

      // Create a malformed YAML file
      const ignoreFile = join(testProjectRoot, ".dr-verify-ignore.yaml");
      await writeFile(
        ignoreFile,
        `version: 1
ignore:
  - handler: "*HealthHandler*
    reason: "Unclosed string`
      );

      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();

      try {
        await engine.computeReport(testProjectRoot, routes, {
          changesetAware: false,
          ignoreFilePath: ignoreFile,
        });
        expect.unreachable("Should have thrown on malformed YAML");
      } catch (error) {
        // Expected - malformed YAML should throw
        expect(error).toBeDefined();
      }
    });
  });
});
