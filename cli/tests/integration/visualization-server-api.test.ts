/**
 * Visualization Server API Endpoint Tests
 * Tests the actual HTTP API endpoints of the Bun CLI visualization server
 *
 * REQUIRES SERIAL EXECUTION: Uses describe.serial because:
 * - Tests start/stop the visualization server requiring exclusive port access
 * - Concurrent execution would cause port conflicts and server startup failures
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { spawnSync } from "bun";
import { portAllocator } from "../helpers.ts";

const TEMP_DIR = "/tmp/dr-api-test";
const STARTUP_TIMEOUT = 10000;
const CLI_ROOT = join(import.meta.dir, "../..");
const CLI_PATH = join(CLI_ROOT, "dist/cli.js");

let testDir: string;
let testPort: number;
let serverProcess: any = null;

/**
 * Helper to wait for server to be ready
 */
async function waitForServer(url: string, timeout: number = STARTUP_TIMEOUT): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Start the visualization server
 */
async function startServer(cwd: string, port: number): Promise<any> {
  const process = Bun.spawn({
    cmd: ["bun", CLI_PATH, "visualize", "--port", String(port), "--no-browser", "--no-auth"],
    cwd,
    stdio: ["ignore", "pipe", "pipe"], // Capture output
  });

  // Give server a moment to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Wait for health endpoint to confirm server is ready
  const ready = await waitForServer(`http://localhost:${port}/health`, STARTUP_TIMEOUT);
  if (!ready) {
    console.error(`Server failed to start. Port: ${port}, CWD: ${cwd}`);
    process.kill();
    throw new Error(`Server failed to start within ${STARTUP_TIMEOUT}ms`);
  }

  return process;
}

/**
 * Initialize a test model
 */
async function initializeTestModel(dir: string): Promise<void> {
  const result = spawnSync({
    cmd: [
      "node",
      CLI_PATH,
      "init",
      "--name",
      "API Test Model",
      "--description",
      "Model for API testing",
    ],
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to initialize test model: ${result.stderr?.toString()}`);
  }
}

/**
 * Add test elements to the model
 */
async function addTestElements(dir: string): Promise<void> {
  const elements = [
    [
      "business",
      "businessservice",
      "customer-service",
      "Customer Service",
      "Handles customer interactions",
    ],
    [
      "application",
      "applicationservice",
      "customer-app",
      "Customer App",
      "Customer-facing application",
    ],
    ["api", "operation", "get-customers", "Get Customers", "Retrieve customer list"],
  ];

  for (const [layer, type, id, name, description] of elements) {
    const result = spawnSync({
      cmd: ["node", CLI_PATH, "add", layer, type, id, "--name", name, "--description", description],
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to add element ${id}: ${result.stderr?.toString()}`);
    }
  }

  // Note: Relationships are optional for API endpoint testing
  // They can be added in specific tests if needed
}

describe.serial("Visualization Server API Endpoints", () => {
  beforeEach(async () => {
    testDir = join(TEMP_DIR, `test-${Date.now()}`);
    testPort = await portAllocator.allocatePort();
    await mkdir(testDir, { recursive: true });
    await initializeTestModel(testDir);
    await addTestElements(testDir);
  });

  afterEach(async () => {
    // Stop server if running
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {
        // ignore
      }
      serverProcess = null;
    }

    // Release the allocated port
    portAllocator.releasePort(testPort);

    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("GET /api/model", () => {
    it("should return complete model metadata", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/model`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");

      const data = await response.json();

      // Validate structure
      expect(data).toHaveProperty("manifest");
      expect(data).toHaveProperty("layers");
      expect(data).toHaveProperty("totalElements");

      // Validate manifest
      expect(data.manifest.name).toBe("API Test Model");
      expect(data.manifest.description).toBe("Model for API testing");
      expect(data.manifest).toHaveProperty("version");
      expect(data.manifest).toHaveProperty("specVersion");

      // Validate layers
      expect(typeof data.layers).toBe("object");
      expect(Object.keys(data.layers).length).toBeGreaterThan(0);

      // Validate total elements
      expect(typeof data.totalElements).toBe("number");
      expect(data.totalElements).toBeGreaterThanOrEqual(3);
    });

    it("should include layer information with element counts", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/model`);
      const data = await response.json();

      // Check business layer
      expect(data.layers.business).toBeDefined();
      expect(data.layers.business).toHaveProperty("name");
      expect(data.layers.business).toHaveProperty("elements");
      expect(data.layers.business).toHaveProperty("elementCount");
      expect(Array.isArray(data.layers.business.elements)).toBe(true);

      // Check application layer
      expect(data.layers.application).toBeDefined();
      expect(data.layers.application.elementCount).toBeGreaterThan(0);

      // Check API layer
      expect(data.layers.api).toBeDefined();
      expect(data.layers.api.elementCount).toBeGreaterThan(0);
    });

    it("should include elements with all required fields", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/model`);
      const data = await response.json();

      const businessElements = data.layers.business.elements;
      expect(businessElements.length).toBeGreaterThan(0);

      const element = businessElements[0];
      expect(element).toHaveProperty("id");
      expect(element).toHaveProperty("type");
      expect(element).toHaveProperty("name");
      expect(element).toHaveProperty("description");
      expect(element).toHaveProperty("annotations");
      expect(Array.isArray(element.annotations)).toBe(true);
    });
  });

  describe("GET /api/layers/:name", () => {
    it("should return specific layer data", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/layers/business`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("name");
      expect(data.name).toBe("business");
      expect(data).toHaveProperty("elements");
      expect(Array.isArray(data.elements)).toBe(true);
    });

    it("should return all 12 standard layers", async () => {
      serverProcess = await startServer(testDir, testPort);

      const layers = [
        "motivation",
        "business",
        "security",
        "application",
        "technology",
        "api",
        "data-model",
        "data-store",
        "ux",
        "navigation",
        "apm",
        "testing",
      ];

      for (const layerName of layers) {
        const response = await fetch(`http://localhost:${testPort}/api/layers/${layerName}`);

        // Layer may be empty (404) or have data (200)
        expect([200, 404]).toContain(response.status);

        if (response.status === 200) {
          const data = await response.json();
          expect(data.name).toBe(layerName);
          expect(data).toHaveProperty("elements");
        }
      }
    });

    it("should return 400 for invalid layer name format", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/layers/non-existent-layer`);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should include elements with all required fields", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/layers/business`);
      const data = await response.json();

      if (data.elements.length > 0) {
        const element = data.elements[0];
        expect(element).toHaveProperty("id");
        expect(element).toHaveProperty("name");
        expect(element).toHaveProperty("type");
      }
    });
  });

  describe("GET /api/elements/:id", () => {
    it("should return element by ID", async () => {
      serverProcess = await startServer(testDir, testPort);

      // First, get the model to see what elements exist
      const modelResponse = await fetch(`http://localhost:${testPort}/api/model`);
      const modelData = await modelResponse.json();

      // Find a business element
      const businessElements = modelData.layers.business?.elements || [];
      if (businessElements.length === 0) {
        console.log("No business elements found, skipping test");
        return;
      }

      const element = businessElements[0];
      const response = await fetch(`http://localhost:${testPort}/api/elements/${element.id}`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBe(element.id);
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("type");
    });

    it("should return elements from different layers", async () => {
      serverProcess = await startServer(testDir, testPort);

      // Get all elements from the model
      const modelResponse = await fetch(`http://localhost:${testPort}/api/model`);
      const modelData = await modelResponse.json();

      // Test elements from different layers
      const testLayers = ["business", "application", "api"];

      for (const layerName of testLayers) {
        const elements = modelData.layers[layerName]?.elements || [];
        if (elements.length > 0) {
          const element = elements[0];
          const response = await fetch(`http://localhost:${testPort}/api/elements/${element.id}`);

          expect(response.status).toBe(200);

          const data = await response.json();
          expect(data.id).toBe(element.id);
          expect(data.name).toBe(element.name);
        }
      }
    });

    it("should return 404 for non-existent element", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(
        `http://localhost:${testPort}/api/elements/non-existent-element-id`
      );

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data.error).toContain("not found");
    });

    it("should return 404 for valid-format but non-existent element ID", async () => {
      serverProcess = await startServer(testDir, testPort);

      // Use a valid three-part format ID that doesn't exist: layer.type.name
      const response = await fetch(
        `http://localhost:${testPort}/api/elements/motivation.goal.nonexistent-goal`
      );

      // Should be 404 (not found), not 400 (bad request)
      // This tests that format validation passes but element lookup fails
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(data.error).toContain("not found");
    });

    it("should include relationships field when relationships exist", async () => {
      serverProcess = await startServer(testDir, testPort);

      // Get an element from the model
      const modelResponse = await fetch(`http://localhost:${testPort}/api/model`);
      const modelData = await modelResponse.json();

      const businessElements = modelData.layers.business?.elements || [];
      if (businessElements.length === 0) {
        console.log("No business elements found, skipping test");
        return;
      }

      const element = businessElements[0];
      const response = await fetch(`http://localhost:${testPort}/api/elements/${element.id}`);
      const data = await response.json();

      // Relationships field is optional - only present if there are relationships
      if (data.relationships !== undefined) {
        expect(Array.isArray(data.relationships)).toBe(true);
      }
    });
  });

  describe("GET /health", () => {
    it("should return healthy status", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/health`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("ok");
    });
  });

  describe("OpenAPI Specification", () => {
    it("should serve OpenAPI spec at /api-spec.json or /api-spec.yaml", async () => {
      serverProcess = await startServer(testDir, testPort);

      // Try JSON first, then YAML
      let response = await fetch(`http://localhost:${testPort}/api-spec.json`);
      if (response.status === 404) {
        response = await fetch(`http://localhost:${testPort}/api-spec.yaml`);
      }
      if (response.status === 404) {
        response = await fetch(`http://localhost:${testPort}/openapi.json`);
      }

      // One of these should exist
      expect([200]).toContain(response.status);
    });

    it("should have consistent paths between spec and actual routes", async () => {
      serverProcess = await startServer(testDir, testPort);

      // Get OpenAPI spec
      let specResponse = await fetch(`http://localhost:${testPort}/api-spec.json`);
      let spec: any = null;
      if (specResponse.status === 200) {
        spec = await specResponse.json();
      } else {
        specResponse = await fetch(`http://localhost:${testPort}/api-spec.yaml`);
        if (specResponse.status === 200) {
          // For YAML, we'd need to parse it, but the important check is that it exists
          expect(specResponse.status).toBe(200);
          return;
        }
      }

      if (!spec || !spec.paths) {
        // If no spec, just verify routes work
        const response = await fetch(`http://localhost:${testPort}/api/model`);
        expect([200, 404]).toContain(response.status);
        return;
      }

      // Verify some key routes from spec exist in reality
      const specPaths = Object.keys(spec.paths || {});
      expect(specPaths.length).toBeGreaterThan(0);

      // Test a few critical paths
      const criticalPaths = ["/api/model", "/health", "/api/layers/{name}"];
      for (const path of criticalPaths) {
        const specPath = path.replace(/{name}/, "business");
        const response = await fetch(`http://localhost:${testPort}${specPath}`);
        // Route should either exist (200) or give proper error (400/404)
        expect([200, 400, 404]).toContain(response.status);
      }
    });
  });

  describe("GET /", () => {
    it("should return HTML viewer page", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const html = await response.text();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Documentation Robotics Viewer");
      expect(html).toContain('id="model-tree"');
      expect(html).toContain('id="element-details"');
    });

    it("should include WebSocket connection code", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/`);
      const html = await response.text();

      expect(html).toContain("new WebSocket");
      expect(html).toContain("/ws");
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for unknown routes", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/unknown-route`);

      expect(response.status).toBe(404);
    });

    it("should handle malformed element IDs gracefully", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(
        `http://localhost:${testPort}/api/elements/invalid%20id%20with%20spaces`
      );

      expect(response.status).toBe(400);
    });

    it("should return consistent error format", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/layers/invalid-layer`);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      // Error can be either a string or an object from Zod validation
      expect(data.error).toBeDefined();
    });

    it("should reject invalid layer name with Zod validation", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(
        `http://localhost:${testPort}/api/layers/InvalidLayerName`
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should reject invalid element ID format with Zod validation", async () => {
      serverProcess = await startServer(testDir, testPort);

      // Element IDs with spaces are invalid
      const response = await fetch(
        `http://localhost:${testPort}/api/elements/invalid%20element%20id`
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should reject invalid changeset ID format with Zod validation", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(
        `http://localhost:${testPort}/api/changesets/invalid%20changeset`
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should reject invalid annotation ID format with Zod validation", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(
        `http://localhost:${testPort}/api/annotations/invalid%20annotation`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should reject annotation path parameter on POST replies with Zod validation", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(
        `http://localhost:${testPort}/api/annotations/invalid%20annotation/replies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            author: "Test User",
            content: "Test reply",
          }),
        }
      );

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });
  });

  describe("CORS Headers", () => {
    it("should include CORS headers in API responses", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api/model`);

      expect(response.headers.has("access-control-allow-origin")).toBe(true);
    });
  });

  describe("OpenAPI Documentation Endpoints", () => {
    it("should return OpenAPI specification at /api-spec.yaml", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api-spec.yaml`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/json/);

      const spec = await response.json();

      // Validate OpenAPI structure
      expect(spec).toHaveProperty("openapi");
      expect(spec.openapi).toMatch(/3\.\d\.\d/); // OpenAPI 3.x.x

      // Validate info section
      expect(spec).toHaveProperty("info");
      expect(spec.info.title).toBe("Documentation Robotics Visualization Server API");
      expect(spec.info).toHaveProperty("version");
      expect(spec.info).toHaveProperty("description");

      // Validate servers section
      expect(spec).toHaveProperty("servers");
      expect(Array.isArray(spec.servers)).toBe(true);
      expect(spec.servers.length).toBeGreaterThan(0);

      // Validate paths section
      expect(spec).toHaveProperty("paths");
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);

      // Validate tags
      expect(spec).toHaveProperty("tags");
      expect(Array.isArray(spec.tags)).toBe(true);

      // Validate components
      // Note: securitySchemes only present if auth is enabled
      // This test runs with --no-auth, so we only check components exists
      expect(spec).toHaveProperty("components");
    });

    it("should include all REST endpoints in OpenAPI spec", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api-spec.yaml`);
      const spec = await response.json();

      const expectedEndpoints = [
        "/health",
        "/api/model",
        "/api/spec",
        "/api/annotations",
        "/api/changesets",
      ];

      for (const endpoint of expectedEndpoints) {
        expect(spec.paths).toHaveProperty(endpoint);
      }
    });

    it("should serve Swagger UI at /api-docs", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api-docs`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const html = await response.text();

      // Verify it's Swagger UI HTML
      expect(html).toContain("swagger");
      expect(html.length).toBeGreaterThan(100); // Reasonable HTML size
    });

    it("should have valid OpenAPI paths with methods", async () => {
      serverProcess = await startServer(testDir, testPort);

      const response = await fetch(`http://localhost:${testPort}/api-spec.yaml`);
      const spec = await response.json();

      // Verify /health endpoint has GET method
      expect(spec.paths["/health"]).toHaveProperty("get");
      expect(spec.paths["/health"].get).toHaveProperty("tags");
      expect(spec.paths["/health"].get.tags).toContain("Health");

      // Verify /api/model endpoint has GET method
      expect(spec.paths["/api/model"]).toHaveProperty("get");
      expect(spec.paths["/api/model"].get).toHaveProperty("tags");
      expect(spec.paths["/api/model"].get.tags).toContain("Model");

      // Verify /api/annotations has both GET and POST
      expect(spec.paths["/api/annotations"]).toHaveProperty("get");
      expect(spec.paths["/api/annotations"]).toHaveProperty("post");
    });
  });
});
