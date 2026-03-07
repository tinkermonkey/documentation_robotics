/**
 * Unit tests for VisualizationServer
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Model } from "../../../src/core/model.js";
import { VisualizationServer } from "../../../src/server/server.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";

// Test fixture setup
async function createTestModel(rootPath: string): Promise<Model> {
  // Create model directory structure (new documentation-robotics format)
  mkdirSync(join(rootPath, "documentation-robotics", "model", "01_motivation"), {
    recursive: true,
  });

  // Create manifest.yaml
  const manifestYaml = `version: '0.1.0'
schema: documentation-robotics-v1
cli_version: 0.1.0
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
project:
  name: Test Model
  description: Test Description
  version: '0.1.0'
documentation: .dr/README.md
layers:
  motivation:
    order: 1
    name: Motivation
    path: documentation-robotics/model/01_motivation/
    schema: .dr/schemas/01-motivation-layer.schema.json
    enabled: true
`;

  writeFileSync(join(rootPath, "documentation-robotics", "model", "manifest.yaml"), manifestYaml);

  // Create motivation layer YAML file
  const motivationYaml = `test-goal:
  id: motivation-goal-test-goal
  name: Test Goal
  type: goal
  documentation: A test goal
`;

  writeFileSync(
    join(rootPath, "documentation-robotics", "model", "01_motivation", "goals.yaml"),
    motivationYaml
  );

  // Eager loading required: Visualization server rendering requires all layers
  // to be available for complete UI composition and cross-layer reference display
  return Model.load(rootPath, { lazyLoad: false });
}

describe("VisualizationServer", () => {
  let testDir: string;
  let model: Model;
  let server: VisualizationServer;

  beforeAll(async () => {
    // Use UUID for completely unique directory
    testDir = join(tmpdir(), `dr-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    model = await createTestModel(testDir);
    server = new VisualizationServer(model, { authEnabled: false });
  });

  afterAll(() => {
    server.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create a server with a model", () => {
      expect(server).toBeDefined();
      expect(server["model"]).toBe(model);
    });

    it("should initialize with empty client set", () => {
      expect(server["clients"].size).toBe(0);
    });

    it("should initialize with empty annotations map", () => {
      expect(server["annotations"].size).toBe(0);
    });
  });

  describe("serializeModel", () => {
    it("should serialize model with nodes and links", async () => {
      const serialized = await server["serializeModel"]();

      expect(serialized).toHaveProperty("nodes");
      expect(serialized).toHaveProperty("links");
      expect(Array.isArray(serialized.nodes)).toBe(true);
      expect(Array.isArray(serialized.links)).toBe(true);
    });

    it("should include all elements as nodes", async () => {
      const serialized = await server["serializeModel"]();

      expect(serialized.nodes.length).toBeGreaterThan(0);
    });

    it("should include required fields on each node", async () => {
      const serialized = await server["serializeModel"]();

      const node = serialized.nodes[0];
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("spec_node_id");
      expect(node).toHaveProperty("type");
      expect(node).toHaveProperty("layer_id");
      expect(node).toHaveProperty("name");
    });

    it("should include annotations on nodes that have them", async () => {
      const serialized = await server["serializeModel"]();

      // Nodes without annotations omit the field; those with annotations carry an array
      for (const node of serialized.nodes) {
        if (Object.prototype.hasOwnProperty.call(node, "annotations")) {
          expect(Array.isArray(node.annotations)).toBe(true);
        }
      }
    });

    it("should tag nodes with correct layer_id", async () => {
      const serialized = await server["serializeModel"]();

      const motivationNodes = serialized.nodes.filter((n: any) => n.layer_id === "motivation");
      expect(motivationNodes.length).toBeGreaterThan(0);
    });

    it("should omit elementId for new-format elements without semantic IDs", async () => {
      const serialized = await server["serializeModel"]();

      const newFormatNode = serialized.nodes.find((n: any) => n.name === "Test Goal");
      expect(newFormatNode).toBeDefined();
      expect(newFormatNode).not.toHaveProperty("elementId");
    });

    it("should omit properties when empty", async () => {
      const serialized = await server["serializeModel"]();

      const newFormatNode = serialized.nodes.find((n: any) => n.name === "Test Goal");
      expect(newFormatNode).toBeDefined();
      expect(newFormatNode).not.toHaveProperty("properties");
    });
  });

  describe("findElement", () => {
    it("should find element by ID", async () => {
      const element = await server["findElement"]("motivation-goal-test-goal");

      expect(element).toBeDefined();
      // Element ID is a UUID after loading from model
      expect(typeof element?.id).toBe("string");
      expect(element?.id?.length).toBeGreaterThan(0);
      expect(element?.name).toBe("Test Goal");
    });

    it("should return null for non-existent element", async () => {
      const element = await server["findElement"]("non-existent-id");

      expect(element).toBeNull();
    });
  });

  describe("broadcastMessage", () => {
    it("should handle broadcasting with no clients", async () => {
      const message = {
        type: "annotation.added",
        annotationId: "test-annotation-id",
        elementId: "motivation.goal.test-goal",
        timestamp: new Date().toISOString(),
      };

      // Should not throw
      await server["broadcastMessage"](message);
    });

    it("should add annotation to map", async () => {
      const annotation = {
        elementId: "motivation.goal.test-goal",
        author: "Test Author",
        text: "Test annotation",
        timestamp: new Date().toISOString(),
      };

      const annotationsBefore = server["annotations"].get("motivation.goal.test-goal")?.length ?? 0;

      // Simulate adding annotation
      if (!server["annotations"].has("motivation.goal.test-goal")) {
        server["annotations"].set("motivation.goal.test-goal", []);
      }
      server["annotations"].get("motivation.goal.test-goal")!.push(annotation);

      const annotationsAfter = server["annotations"].get("motivation.goal.test-goal")?.length ?? 0;

      expect(annotationsAfter).toBe(annotationsBefore + 1);
    });
  });

  describe("handleWSMessage", () => {
    it("should handle subscribe message", async () => {
      const mockWs = {
        send: (msg: string) => {
          // Mock send
        },
      };

      const message = { type: "subscribe" as const };

      await server["handleWSMessage"](mockWs, message);
    });

    it("should handle annotate message", async () => {
      const mockWs = {
        send: (msg: string) => {
          // Mock send
        },
      };

      const message = {
        type: "annotate" as const,
        annotation: {
          elementId: "motivation-goal-test-goal",
          author: "Test",
          text: "Annotation",
          timestamp: new Date().toISOString(),
        },
      };

      await server["handleWSMessage"](mockWs, message);
    });
  });

  describe("getViewerHTML", () => {
    it("should return HTML string", () => {
      const html = server["getViewerHTML"]();

      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("should include required HTML elements", () => {
      const html = server["getViewerHTML"]();

      expect(html).toContain("Documentation Robotics Viewer");
      expect(html).toContain('<div id="model-tree">');
      expect(html).toContain('<div id="element-details">');
    });

    it("should include WebSocket script", () => {
      const html = server["getViewerHTML"]();

      expect(html).toContain("new WebSocket");
      expect(html).toContain("/ws");
    });

    it("should include styling", () => {
      const html = server["getViewerHTML"]();

      expect(html).toContain("<style>");
      expect(html).toContain("</style>");
    });
  });

  describe("setupFileWatcher", () => {
    it("should create watcher", () => {
      // Note: Cannot easily test actual file watching without integration tests
      // This test just verifies the method exists and doesn't throw
      expect(() => {
        server["setupFileWatcher"]();
      }).not.toThrow();
    });
  });

  describe("stop", () => {
    it("should handle stop without watcher", () => {
      const tempServer = new VisualizationServer(model, { authEnabled: false });
      expect(() => {
        tempServer.stop();
      }).not.toThrow();
    });
  });
});
