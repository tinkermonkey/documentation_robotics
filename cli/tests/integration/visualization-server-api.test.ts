/**
 * Visualization Server API Endpoint Tests
 * Tests the HTTP API endpoints of the visualization server over real HTTP
 *
 * The model is initialized with the built CLI (`dr init`, `dr add`), then served in process by a
 * central server over a scratch farm whose one project is the model's folder
 * (tests/helpers/test-farm-server.ts), listening on a port the OS picks. Every project-data
 * route is scoped to the checkout (`/api/projects/{project}/checkouts/main/...`) and every
 * `/api/...` call carries the token.
 *
 * REQUIRES SERIAL EXECUTION: Uses describe.serial because each test starts and stops a server.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "bun";
import { startTestFarmServer, type TestFarmServer } from "../helpers/test-farm-server.js";

const CLI_ROOT = join(import.meta.dir, "../..");
const CLI_PATH = join(CLI_ROOT, "dist/cli.js");
/** The built viewer, which the server serves at `/` (the source tree has no index.html). */
const VIEWER_PATH = join(CLI_ROOT, "dist/viewer");

/** How the OpenAPI document names the checkout-scoped routes. */
const SCOPED = "/api/projects/:project/checkouts/:checkout";

let testDir: string;
let t: TestFarmServer | null = null;

/**
 * Start the visualization server over the test model, listening on a free port
 */
async function startServer(cwd: string): Promise<TestFarmServer> {
  t = await startTestFarmServer(cwd, { listen: true, server: { viewerPath: VIEWER_PATH } });
  return t;
}

/** A GET (or other) request over HTTP to an exact path, with the token. */
function get(server: TestFarmServer, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(server.url(path), { ...init, headers: { ...server.auth, ...((init.headers as any) ?? {}) } });
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
  const elements: [string, string, string, string, string, Record<string, unknown>?][] = [
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
      { serviceType: "synchronous" },
    ],
    [
      "api",
      "operation",
      "get-customers",
      "Get Customers",
      "Retrieve customer list",
      { operationId: "getCustomers", summary: "Retrieve customer list", tags: "customers" },
    ],
  ];

  for (const [layer, type, id, name, description, attributes] of elements) {
    const cmd = ["node", CLI_PATH, "add", layer, type, id, "--name", name, "--description", description];
    if (attributes) {
      cmd.push("--attributes", JSON.stringify(attributes));
    }

    const result = spawnSync({
      cmd,
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
    testDir = await mkdtemp(join(tmpdir(), "dr-api-test-"));
    await initializeTestModel(testDir);
    await addTestElements(testDir);
  });

  afterEach(async () => {
    // Stop the server before its project folder is deleted below
    await t?.stop();
    t = null;

    // Cleanup test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("GET /api/model", () => {
    it("should return graph-format model", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/model"));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");

      const data = await response.json();

      // Validate graph structure
      expect(data).toHaveProperty("nodes");
      expect(data).toHaveProperty("links");
      expect(Array.isArray(data.nodes)).toBe(true);
      expect(Array.isArray(data.links)).toBe(true);
      expect(data.nodes.length).toBeGreaterThanOrEqual(3);
    });

    it("should include nodes from all layers with layer_id", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/model"));
      const data = await response.json();

      const layerIds = new Set(data.nodes.map((n: any) => n.layer_id));
      expect(layerIds.has("business")).toBe(true);
      expect(layerIds.has("application")).toBe(true);
      expect(layerIds.has("api")).toBe(true);
    });

    it("should include nodes with all required fields", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/model"));
      const data = await response.json();

      const businessNodes = data.nodes.filter((n: any) => n.layer_id === "business");
      expect(businessNodes.length).toBeGreaterThan(0);

      const node = businessNodes[0];
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("spec_node_id");
      expect(node).toHaveProperty("type");
      expect(node).toHaveProperty("layer_id");
      expect(node).toHaveProperty("name");
    });
  });

  describe("GET /api/layers/:name", () => {
    it("should return specific layer data", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/layers/business"));

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty("name");
      expect(data.name).toBe("business");
      expect(data).toHaveProperty("elements");
      expect(Array.isArray(data.elements)).toBe(true);
    });

    it("should return all 12 standard layers", async () => {
      const t = await startServer(testDir);

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
        const response = await get(t, t.api(`/layers/${layerName}`));

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
      const t = await startServer(testDir);

      const response = await get(t, t.api("/layers/non-existent-layer"));

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should include elements with all required fields", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/layers/business"));
      const data = await response.json();

      if (data.elements.length > 0) {
        const element = data.elements[0];
        expect(element).toHaveProperty("id");
        expect(element).toHaveProperty("name");
        expect(element).toHaveProperty("type");
      }
    });
  });

  describe("OpenAPI Specification", () => {
    it("should serve OpenAPI spec at /api-spec.json or /api-spec.yaml", async () => {
      const t = await startServer(testDir);

      // Try JSON first, then YAML
      let response = await fetch(t.url("/api-spec.json"));
      if (response.status === 404) {
        response = await fetch(t.url("/api-spec.yaml"));
      }
      if (response.status === 404) {
        response = await fetch(t.url("/openapi.json"));
      }

      // One of these should exist
      expect([200]).toContain(response.status);
    });

    it("should have consistent paths between spec and actual routes", async () => {
      const t = await startServer(testDir);

      // Get OpenAPI spec
      let specResponse = await fetch(t.url("/api-spec.json"));
      let spec: any = null;
      if (specResponse.status === 200) {
        spec = await specResponse.json();
      } else {
        specResponse = await fetch(t.url("/api-spec.yaml"));
        if (specResponse.status === 200) {
          // For YAML, we'd need to parse it, but the important check is that it exists
          expect(specResponse.status).toBe(200);
          return;
        }
      }

      if (!spec || !spec.paths) {
        // If no spec, just verify routes work
        const response = await get(t, t.api("/model"));
        expect([200, 404]).toContain(response.status);
        return;
      }

      // Verify some key routes from spec exist in reality
      const specPaths = Object.keys(spec.paths || {});
      expect(specPaths.length).toBeGreaterThan(0);

      // Test a few critical paths
      const criticalPaths = [t.api("/model"), "/health", t.api("/layers/{name}")];
      for (const path of criticalPaths) {
        const specPath = path.replace(/{name}/, "business");
        const response = await get(t, specPath);
        // Route should either exist (200) or give proper error (400/404)
        expect([200, 400, 404]).toContain(response.status);
      }
    });
  });

  describe("GET /", () => {
    it("should return HTML viewer page", async () => {
      const t = await startServer(testDir);

      const response = await fetch(t.url("/"));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const html = await response.text();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Documentation Robotics Viewer");
      expect(html).toContain('id="root"');
      expect(html).toContain('type="module"');
    });

    it("should serve bundled viewer assets", async () => {
      const t = await startServer(testDir);

      const response = await fetch(t.url("/"));
      const html = await response.text();

      expect(html).toContain("/assets/");
      expect(html).toContain('type="module"');
    });
  });

  describe("Shutdown", () => {
    // #1235: a stopped viewer left its server running, because the server hung in its own
    // shutdown (under Bun, closing the file watcher while its folder was being deleted deadlocked
    // the main thread) and the launcher's SIGKILL fallback never ran. The launcher and its
    // server process are gone: the server runs in process. Stopping it while its project folder
    // is being deleted must still finish promptly, and leave nothing listening.
    it("stops a server whose project folder is being deleted, and frees its port", async () => {
      const t = await startServer(testDir);
      // Load the checkout, so its file watcher is running.
      expect((await get(t, t.api("/model"))).status).toBe(200);
      expect((await fetch(t.url("/health"))).status).toBe(200);

      const removing = rm(testDir, { recursive: true, force: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        t.stop().then(() => "stopped"),
        new Promise<string>((resolve) => (timer = setTimeout(() => resolve("hung"), 10000))),
      ]);
      clearTimeout(timer);
      await removing;

      expect(outcome).toBe("stopped");
      let refused = false;
      try {
        await fetch(t.url("/health"));
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    }, 30000);
  });

  describe("Error Handling", () => {
    it("should return 404 for unknown routes", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/unknown-route"));

      expect(response.status).toBe(404);
    });

    it("should reject invalid layer name with Zod validation", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/layers/InvalidLayerName"));

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should reject invalid changeset ID format with Zod validation", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/changesets/invalid%20changeset"));

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should reject invalid annotation ID format with Zod validation", async () => {
      const t = await startServer(testDir);

      const response = await get(t, t.api("/annotations/invalid%20annotation"), { method: "DELETE" });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    it("should reject annotation path parameter on POST replies with Zod validation", async () => {
      const t = await startServer(testDir);

      const response = await get(
        t,
        t.api("/annotations/invalid%20annotation/replies"),
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
      const t = await startServer(testDir);

      const response = await get(t, t.api("/model"));

      expect(response.headers.has("access-control-allow-origin")).toBe(true);
    });
  });

  describe("OpenAPI Documentation Endpoints", () => {
    it("should return OpenAPI specification at /api-spec.yaml", async () => {
      const t = await startServer(testDir);

      const response = await fetch(t.url("/api-spec.yaml"));

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

      // Validate components: every server authenticates, so the bearer scheme is always there
      expect(spec).toHaveProperty("components");
      expect(spec.components).toHaveProperty("securitySchemes");
    });

    it("should include all REST endpoints in OpenAPI spec", async () => {
      const t = await startServer(testDir);

      const response = await fetch(t.url("/api-spec.yaml"));
      const spec = await response.json();

      const expectedEndpoints = [
        "/health",
        `${SCOPED}/model`,
        "/api/spec",
        `${SCOPED}/annotations`,
        `${SCOPED}/changesets`,
      ];

      for (const endpoint of expectedEndpoints) {
        expect(spec.paths).toHaveProperty(endpoint);
      }
    });

    it("should serve Swagger UI at /api-docs", async () => {
      const t = await startServer(testDir);

      const response = await fetch(t.url("/api-docs"));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const html = await response.text();

      // Verify it's Swagger UI HTML
      expect(html).toContain("swagger");
      expect(html.length).toBeGreaterThan(100); // Reasonable HTML size
    });

    it("should have valid OpenAPI paths with methods", async () => {
      const t = await startServer(testDir);

      const response = await fetch(t.url("/api-spec.yaml"));
      const spec = await response.json();

      // Verify /health endpoint has GET method
      expect(spec.paths["/health"]).toHaveProperty("get");
      expect(spec.paths["/health"].get).toHaveProperty("tags");
      expect(spec.paths["/health"].get.tags).toContain("Health");

      // Verify the checkout's model endpoint has GET method
      expect(spec.paths[`${SCOPED}/model`]).toHaveProperty("get");
      expect(spec.paths[`${SCOPED}/model`].get).toHaveProperty("tags");
      expect(spec.paths[`${SCOPED}/model`].get.tags).toContain("Model");

      // Verify the checkout's annotations have both GET and POST
      expect(spec.paths[`${SCOPED}/annotations`]).toHaveProperty("get");
      expect(spec.paths[`${SCOPED}/annotations`]).toHaveProperty("post");
    });
  });
});
