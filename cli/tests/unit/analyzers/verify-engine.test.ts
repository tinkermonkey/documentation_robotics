/**
 * Unit tests for VerifyEngine
 *
 * Tests covering:
 * - Bucket computation with known fixture inputs
 * - Dual-index matching (source-ref primary, method+path secondary)
 * - in_model_only file-existence filter
 * - Correct changeset_context for both base-model and changeset-view paths
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawnSync } from "child_process";
import { VerifyEngine, type DiscoveredRoute } from "@/analyzers/verify-engine.js";

let testProjectRoot: string = "";

describe("VerifyEngine - Bucket Computation", () => {
  beforeEach(async () => {
    // Create temporary test project
    testProjectRoot = `/tmp/verify-unit-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

  describe("Dual-index matching logic", () => {
    it("should match by primary index (file:symbol)", async () => {
      // Create model structure
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

      // Create API layer with operation having source reference
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
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/users.ts"
          symbol: "getUsers"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      // Discovered route matching by primary index
      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          source_file: "src/handlers/users.ts",
          source_symbol: "getUsers",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Should match via primary index (file:symbol)
      expect(report.buckets.matched.length).toBe(1);
      // The matched entry should have the operation type
      expect(report.buckets.matched[0].type).toBe("operation");
    });

    it("should match by secondary index (http_method:http_path)", async () => {
      // Create model structure
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

      // Create API layer with operation (no source reference, will use secondary index)
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

      // Discovered route matching by secondary index
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

      // Should match via secondary index (http_method:http_path)
      expect(report.buckets.matched.length).toBe(1);
      expect(report.buckets.matched[0].type).toBe("operation");
    });

    it("should prefer primary index over secondary", async () => {
      // Create model structure
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

      // Create API layer with both source reference and http attributes
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
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/users.ts"
          symbol: "getUsers"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      // Discovered route with both primary and secondary index keys
      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          http_method: "GET",
          http_path: "/users",
          source_file: "src/handlers/users.ts",
          source_symbol: "getUsers",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Should use primary index
      expect(report.buckets.matched.length).toBe(1);
      expect(report.buckets.matched[0].type).toBe("operation");
    });

    it("should fallback to secondary when primary doesn't match", async () => {
      // Create model structure
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

      // Create API layer with both endpoints
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
    source_reference:
      provenance: "extracted"
      locations:
        - file: "src/handlers/other.ts"
          symbol: "getUsers"

post-users:
  id: "api.operation.post-users"
  path: "api.operation.post-users"
  type: "operation"
  name: "Create User"
  layer_id: "api"
  attributes:
    http_method: "POST"
    http_path: "/users"
`;
      await writeFile(join(modelDir, "operations.yaml"), apiYaml);

      // Discovered route that doesn't match primary index but matches secondary
      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          http_method: "POST",
          http_path: "/users",
          source_file: "src/handlers/users.ts",
          source_symbol: "createUser",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Should fall back to secondary index
      expect(report.buckets.matched.length).toBe(1);
      expect(report.buckets.matched[0].type).toBe("operation");
    });

    it("should not match if neither index has entry", async () => {
      // Create model structure
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

      // Discovered route with no matching model element
      const routes: DiscoveredRoute[] = [
        {
          id: "route-1",
          http_method: "GET",
          http_path: "/unknown",
          source_file: "src/handlers/unknown.ts",
          source_symbol: "unknown",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      // Should be in_graph_only since no match
      expect(report.buckets.in_graph_only.length).toBe(1);
      expect(report.buckets.matched.length).toBe(0);
    });
  });

  describe("Bucket computation", () => {
    it("should compute matched bucket from successful index lookups", async () => {
      // Create model structure
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

      expect(report.buckets.matched.length).toBe(1);
      expect(report.buckets.matched[0].type).toBe("operation");
    });

    it("should compute in_graph_only bucket from unmatched routes", async () => {
      // Create minimal model structure (no API layer)
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
          id: "route-unmapped-1",
          http_method: "POST",
          http_path: "/users",
          source_file: "src/handlers/users.ts",
          source_symbol: "createUser",
        },
        {
          id: "route-unmapped-2",
          http_method: "DELETE",
          http_path: "/users/:id",
          source_file: "src/handlers/users.ts",
          source_symbol: "deleteUser",
        },
      ];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      expect(report.buckets.in_graph_only.length).toBe(2);
      expect(report.buckets.in_graph_only[0].http_method).toBe("POST");
      expect(report.buckets.in_graph_only[1].http_path).toBe("/users/:id");
    });

    it("should compute in_model_only bucket from unmatched elements", async () => {
      // Create model structure
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

      // Create handler files
      const handlersDir = join(testProjectRoot, "src", "handlers");
      await mkdir(handlersDir, { recursive: true });
      await writeFile(join(handlersDir, "products.ts"), "export class ProductsHandler {}");

      // Create API layer with operation
      const apiYaml = `
get-products:
  id: "api.operation.get-products"
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

      // No routes discovered
      const routes: DiscoveredRoute[] = [];

      const engine = new VerifyEngine();
      const report = await engine.computeReport(testProjectRoot, routes, {
        changesetAware: false,
      });

      expect(report.buckets.in_model_only.length).toBe(1);
      expect(report.buckets.in_model_only[0].type).toBe("operation");
      expect(report.buckets.in_model_only[0].source_file).toBe("src/handlers/products.ts");
    });
  });

  describe("Changeset context determination", () => {
    it("should use base_model when changesetAware is explicitly false", async () => {
      // Create model structure
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

      expect(report.changeset_context.verified_against).toBe("base_model");
      expect(report.buckets.matched.length).toBe(1);
    });

    it("should default to changesetAware=true when not specified", async () => {
      // Create model structure
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
      // Note: changesetAware is now optional, so we don't provide it
      const report = await engine.computeReport(testProjectRoot, routes, {});

      // Should still work without explicit changesetAware option
      expect(report.buckets.matched.length).toBe(1);
    });
  });

  describe("Error handling", () => {
    it("should throw helpful error with dr init suggestion when model directory is missing", async () => {
      // Create a project root with no model directory
      const emptyProjectRoot = `/tmp/verify-error-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      await mkdir(emptyProjectRoot, { recursive: true });

      // Initialize git repository
      spawnSync("git", ["init"], { cwd: emptyProjectRoot, stdio: "pipe" });
      spawnSync("git", ["config", "user.email", "test@example.com"], {
        cwd: emptyProjectRoot,
        stdio: "pipe",
      });
      spawnSync("git", ["config", "user.name", "Test User"], {
        cwd: emptyProjectRoot,
        stdio: "pipe",
      });

      // Create initial commit
      await writeFile(join(emptyProjectRoot, "README.md"), "# Test Project\n");
      spawnSync("git", ["add", "."], { cwd: emptyProjectRoot, stdio: "pipe" });
      spawnSync("git", ["commit", "-m", "Initial commit"], {
        cwd: emptyProjectRoot,
        stdio: "pipe",
      });

      const engine = new VerifyEngine();

      try {
        await engine.computeReport(emptyProjectRoot, [], {});
        // If we get here, the test should fail
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain("Failed to load DR model");
        expect(message).toContain("dr init");
      }

      // Cleanup
      try {
        await rm(emptyProjectRoot, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
  });
});
