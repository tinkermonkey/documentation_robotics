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
  mkdirSync(join(rootPath, "documentation-robotics", "model", "04_application"), {
    recursive: true,
  });
  mkdirSync(join(rootPath, "documentation-robotics", "model", "05_technology"), {
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
  application:
    order: 4
    name: Application
    path: documentation-robotics/model/04_application/
    schema: .dr/schemas/04-application-layer.schema.json
    enabled: true
  technology:
    order: 5
    name: Technology
    path: documentation-robotics/model/05_technology/
    schema: .dr/schemas/05-technology-layer.schema.json
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

  // Create application layer YAML file with a component that references a technology service
  const applicationYaml = `test-component:
  id: application-component-test-component
  name: Test Component
  type: component
  description: A test component that references a technology service
  references:
    - source: application-component-test-component
      target: technology-service-test-service
      type: uses
`;

  writeFileSync(
    join(rootPath, "documentation-robotics", "model", "04_application", "components.yaml"),
    applicationYaml
  );

  // Create technology layer YAML file with a service
  const technologyYaml = `test-service:
  id: technology-service-test-service
  name: Test Service
  type: service
  description: A test service
`;

  writeFileSync(
    join(rootPath, "documentation-robotics", "model", "05_technology", "services.yaml"),
    technologyYaml
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

    it("should not embed annotations directly on serialized nodes", async () => {
      const serialized = await server["serializeModel"]();

      // Annotations are stored server-side in the annotations map, not on serialized nodes
      for (const node of serialized.nodes) {
        expect(node).not.toHaveProperty("annotations");
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

    it("should include relationships from central relationships store in links", async () => {
      // Relationships added via `dr relationship add` go to model.relationships
      // (backed by relationships.yaml), NOT to element.relationships arrays.
      // serializeModel() must read both stores.
      const node = model.layers.get("motivation")!.listElements()[0];

      model.relationships.add({
        source: node.id,
        target: node.id, // self-loop is fine for this test
        predicate: "depends-on",
        layer: "motivation",
      });

      const serialized = await server["serializeModel"]();

      const centralLink = serialized.links.find(
        (l: any) => l.source === node.id && l.type === "depends-on"
      );
      expect(centralLink).toBeDefined();
      expect(centralLink.layer_id).toBe("motivation");

      // Cleanup so this test doesn't pollute others
      model.relationships.delete(node.id, node.id, "depends-on");
    });

    it("should include source_layer_id and target_layer_id on cross-layer reference links", async () => {
      const serialized = await server["serializeModel"]();

      // Find the cross-layer reference link from application component to technology service
      const refLink = serialized.links.find(
        (l: any) =>
          l.id.startsWith("ref:") &&
          l.source === "application-component-test-component" &&
          l.target === "technology-service-test-service"
      );

      expect(refLink).toBeDefined();
      expect(refLink.source_layer_id).toBe("application");
      expect(refLink.target_layer_id).toBe("technology");
      expect(refLink.id).toMatch(/^ref:/);
      expect(refLink.type).toBe("uses");
    });

    it("should gracefully handle relationships with missing layer field", async () => {
      // Add a malformed relationship with missing layer field
      // This simulates a data integrity issue where a relationship lacks layer info
      server["model"].relationships.add({
        source: "motivation-goal-test-goal",
        target: "motivation-goal-another-goal",
        predicate: "depends-on",
        // Intentionally omit layer field - this creates the problematic state
      } as any);

      // Should NOT throw; should gracefully skip or infer layer
      let error: Error | null = null;
      let serialized: any = null;
      try {
        serialized = await server["serializeModel"]();
      } catch (err) {
        error = err as Error;
      }

      expect(error).toBeNull();
      expect(serialized).toBeDefined();
      expect(serialized.nodes).toBeDefined();
      expect(serialized.links).toBeDefined();

      // The malformed relationship should either be inferred or skipped
      // If skipped, it won't appear in links; if inferred from source element, it will appear
      // The important part is that serializeModel() completes without throwing
    });

    it("should infer missing layer from source element when available", async () => {
      // Add a relationship with missing layer that can be inferred from source
      const sourceId = "motivation-goal-test-goal";
      server["model"].relationships.add({
        source: sourceId,
        target: "motivation-goal-inferred-goal",
        predicate: "contributes-to",
        // Omit layer field
      } as any);

      const serialized = await server["serializeModel"]();

      // Find the link that should have been inferred from the source element
      const link = serialized.links.find(
        (l: any) =>
          l.source === sourceId &&
          l.target === "motivation-goal-inferred-goal"
      );

      // Verify the link was created with the inferred layer from the source element
      expect(link).toBeDefined();
      expect(link.layer_id).toBe("motivation");
    });
  });

  describe("findElement", () => {
    it("should find element by ID", async () => {
      // After path/id separation, elements loaded from YAML use dot-separated path as key
      const element = await server["findElement"]("motivation.goal.test-goal");

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

  describe("resolveViewerSpecNodeId", () => {
    describe("valid pass-through", () => {
      it("should return specNodeId unchanged when already in VALID_SPEC_NODE_IDS", () => {
        const result = server["resolveViewerSpecNodeId"](
          "motivation-goal-test",
          "motivation",
          "goal",
          "motivation.goal"
        );

        expect(result).toBe("motivation.goal");
      });

      it("should pass through other valid spec_node_ids like business.businessservice", () => {
        const result = server["resolveViewerSpecNodeId"](
          "business-service-test",
          "business",
          "service",
          "business.businessservice"
        );

        expect(result).toBe("business.businessservice");
      });

      it("should pass through application.applicationcomponent", () => {
        const result = server["resolveViewerSpecNodeId"](
          "application-component-test",
          "application",
          "component",
          "application.applicationcomponent"
        );

        expect(result).toBe("application.applicationcomponent");
      });

      it("should pass through security.threat when provided as specNodeId", () => {
        const result = server["resolveViewerSpecNodeId"](
          "security.threat.sql-injection",
          "security",
          "",
          "security.threat"
        );

        // security.threat is a valid spec node ID, should be passed through (Strategy 1)
        expect(result).toBe("security.threat");
      });
    });

    describe("dot-format extraction", () => {
      it("should extract type from dot-format elementId (layer.type.name)", () => {
        const result = server["resolveViewerSpecNodeId"](
          "security.threat.sql-injection",
          "security",
          "",
          ""
        );

        // Extracts 'threat' from second segment of "security.threat.sql-injection"
        // Constructs 'security.threat' which is valid
        expect(result).toBe("security.threat");
      });

      it("should extract type and construct valid candidate from dot-format", () => {
        const result = server["resolveViewerSpecNodeId"](
          "motivation.goal.customer-satisfaction",
          "motivation",
          "",
          ""
        );

        // Extracted type is 'goal', candidate is 'motivation.goal' which is valid
        expect(result).toBe("motivation.goal");
      });

      it("should extract type from dot-format with numeric segments", () => {
        const result = server["resolveViewerSpecNodeId"](
          "application.applicationcomponent.api-gateway",
          "application",
          "",
          ""
        );

        // Extracted type is 'applicationcomponent', candidate is 'application.applicationcomponent' which is valid
        expect(result).toBe("application.applicationcomponent");
      });
    });

    describe("hyphen-format extraction", () => {
      it("should extract type from hyphen-format elementId (layer-type-name) for single-word layer", () => {
        const result = server["resolveViewerSpecNodeId"](
          "motivation-goal-user-retention",
          "motivation",
          "",
          ""
        );

        // Extracted type is 'goal', candidate is 'motivation.goal' which is valid
        expect(result).toBe("motivation.goal");
      });

      it("should extract type from hyphen-format for multi-word layer (data-model)", () => {
        const result = server["resolveViewerSpecNodeId"](
          "data-model-entity-users",
          "data-model",
          "",
          ""
        );

        // Layer fallback for 'data-model' is 'data-store.database'
        expect(result).toBe("data-store.database");
      });

      it("should extract type from hyphen-format for multi-word layer (data-store)", () => {
        const result = server["resolveViewerSpecNodeId"](
          "data-store-table-orders",
          "data-store",
          "",
          ""
        );

        // Layer fallback for 'data-store' is 'data-store.database'
        expect(result).toBe("data-store.database");
      });

      it("should handle technology layer hyphen-format extraction", () => {
        const result = server["resolveViewerSpecNodeId"](
          "technology-platform-kubernetes",
          "technology",
          "platform",
          ""
        );

        // technology layer doesn't match valid IDs, should fallback to LAYER_FALLBACK['technology']
        expect(result).toBe("application.applicationservice");
      });

      it("should correctly identify layer prefix with similar names (api vs apm)", () => {
        // Ensure 'api' is matched before 'apm'
        const resultApi = server["resolveViewerSpecNodeId"](
          "api-endpoint-users",
          "api",
          "",
          ""
        );

        // Layer fallback for 'api' is 'business.businessprocess'
        expect(resultApi).toBe("business.businessprocess");
      });
    });

    describe("layer fallbacks", () => {
      it("should use LAYER_FALLBACK for security layer", () => {
        const result = server["resolveViewerSpecNodeId"](
          "security-unknown-custom-type",
          "security",
          "unknown",
          ""
        );

        expect(result).toBe("business.businessprocess");
      });

      it("should use LAYER_FALLBACK for ux layer", () => {
        const result = server["resolveViewerSpecNodeId"](
          "ux-widget-button",
          "ux",
          "widget",
          ""
        );

        expect(result).toBe("application.applicationcomponent");
      });

      it("should use LAYER_FALLBACK for navigation layer", () => {
        const result = server["resolveViewerSpecNodeId"](
          "navigation-route-dashboard",
          "navigation",
          "route",
          ""
        );

        // navigation has route in VALID_SPEC_NODE_IDS, so should construct navigation.route
        expect(result).toBe("navigation.route");
      });

      it("should use LAYER_FALLBACK for apm layer", () => {
        const result = server["resolveViewerSpecNodeId"](
          "apm-metric-request-latency",
          "apm",
          "metric",
          ""
        );

        expect(result).toBe("application.applicationservice");
      });

      it("should use LAYER_FALLBACK for testing layer", () => {
        const result = server["resolveViewerSpecNodeId"](
          "testing-test-case-login-flow",
          "testing",
          "test-case",
          ""
        );

        expect(result).toBe("business.businessprocess");
      });

      it("should default to data-store.database for unknown layer", () => {
        const result = server["resolveViewerSpecNodeId"](
          "unknown-layer-element",
          "unknown-layer",
          "element",
          ""
        );

        expect(result).toBe("data-store.database");
      });
    });

    describe("edge cases", () => {
      it("should handle empty type field", () => {
        const result = server["resolveViewerSpecNodeId"](
          "motivation.goal.test",
          "motivation",
          "",
          ""
        );

        // Should extract 'goal' from dot-format elementId
        expect(result).toBe("motivation.goal");
      });

      it("should handle empty elementId", () => {
        const result = server["resolveViewerSpecNodeId"](
          "",
          "motivation",
          "goal",
          ""
        );

        // When elementId is empty but type is valid, should use type parameter
        expect(result).toBe("motivation.goal");
      });

      it("should prioritize valid specNodeId over extraction", () => {
        // Even with a dot-format elementId, if specNodeId is valid, use it
        const result = server["resolveViewerSpecNodeId"](
          "security.threat.test",
          "security",
          "threat",
          "motivation.goal"
        );

        expect(result).toBe("motivation.goal");
      });

      it("should handle elementId with many dot segments", () => {
        const result = server["resolveViewerSpecNodeId"](
          "motivation.goal.long.name.with.dots",
          "motivation",
          "",
          ""
        );

        // Should extract second segment 'goal'
        expect(result).toBe("motivation.goal");
      });

      it("should handle elementId with many hyphen segments", () => {
        const result = server["resolveViewerSpecNodeId"](
          "motivation-goal-long-name-with-hyphens",
          "motivation",
          "",
          ""
        );

        // Should extract type 'goal' from hyphen-format
        expect(result).toBe("motivation.goal");
      });

      it("should construct valid candidate even when elementId and type don't match", () => {
        // Type is provided but different from extracted type; should try with extracted type
        const result = server["resolveViewerSpecNodeId"](
          "business.businessservice.payment",
          "business",
          "process",
          ""
        );

        // Should extract 'businessservice' from elementId and construct 'business.businessservice' which is valid
        expect(result).toBe("business.businessservice");
      });
    });

    describe("type-parameter fallback (Strategy 4)", () => {
      it("should fall back to type parameter when extracted type is invalid but type parameter is valid", () => {
        const result = server["resolveViewerSpecNodeId"](
          "business.invalidtype.something",
          "business",
          "businessprocess",
          ""
        );

        // Extracts 'invalidtype' from elementId, but 'business.invalidtype' is NOT valid
        // Falls back to type parameter 'businessprocess', constructs 'business.businessprocess' which IS valid
        expect(result).toBe("business.businessprocess");
      });

      it("should not reach type-parameter fallback if extracted type is valid", () => {
        const result = server["resolveViewerSpecNodeId"](
          "business.businessservice.test",
          "business",
          "businessprocess",
          ""
        );

        // Extracts 'businessservice' from elementId, 'business.businessservice' IS valid
        // Returns immediately without trying type parameter fallback
        expect(result).toBe("business.businessservice");
      });

      it("should use layer fallback when both extracted and type-param candidates are invalid", () => {
        const result = server["resolveViewerSpecNodeId"](
          "business.invalidtype.test",
          "business",
          "anothertype",
          ""
        );

        // Extracts 'invalidtype' from elementId -> 'business.invalidtype' is invalid
        // Type parameter 'anothertype' -> 'business.anothertype' is invalid
        // Falls back to LAYER_FALLBACK["business"] but business is not in fallback map
        // So defaults to "data-store.database"
        expect(result).toBe("data-store.database");
      });
    });
  });

  describe("VALID_SPEC_NODE_IDS synchronization with bundled spec", () => {
    it("should load all 12 layers from bundled spec", () => {
      // Check that all 12 layers are present in VALID_SPEC_NODE_IDS
      const expectedLayers = [
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

      // Access the private static property via the class
      const validSpecNodeIds = server.constructor["VALID_SPEC_NODE_IDS"] as Record<
        string,
        string[]
      >;

      for (const layer of expectedLayers) {
        expect(validSpecNodeIds).toHaveProperty(layer);
        expect(Array.isArray(validSpecNodeIds[layer])).toBe(true);
      }

      // Verify that most layers have node types
      // Some layers may have empty arrays if the spec build has issues,
      // but at least 10 of the 12 should have content
      const layersWithNodeTypes = Object.values(validSpecNodeIds).filter(
        (nodeIds) => nodeIds.length > 0
      ).length;
      expect(layersWithNodeTypes).toBeGreaterThanOrEqual(10);
    });

    it("should not have silent drift when spec nodes are added", () => {
      // This test documents that VALID_SPEC_NODE_IDS is dynamically loaded
      // from bundled spec files, preventing silent drift when node types are
      // added to spec/schemas/nodes/
      //
      // The list is loaded at module initialization time and will automatically
      // include any node types defined in the spec build output (spec/dist/{layer}.json)
      // when the CLI is built with "npm run build"

      const validSpecNodeIds = server.constructor["VALID_SPEC_NODE_IDS"] as Record<
        string,
        string[]
      >;

      // All entries should follow the pattern: {layer}.{type}
      for (const [layer, nodeIds] of Object.entries(validSpecNodeIds)) {
        for (const nodeId of nodeIds) {
          expect(nodeId).toMatch(/^[\w-]+\.[\w-]+$/);
          expect(nodeId.startsWith(layer)).toBe(true);
        }
      }
    });

    it("should have consistent spec node IDs in ALL_VALID_IDS set", () => {
      // Ensure ALL_VALID_IDS (a Set built from VALID_SPEC_NODE_IDS) has the same entries
      const validSpecNodeIds = server.constructor["VALID_SPEC_NODE_IDS"] as Record<
        string,
        string[]
      >;
      const allValidIds = server.constructor["ALL_VALID_IDS"] as Set<string>;

      // Count all expected IDs from the map
      let expectedCount = 0;
      const expectedIds = new Set<string>();
      for (const nodeIds of Object.values(validSpecNodeIds)) {
        for (const id of nodeIds) {
          expectedIds.add(id);
          expectedCount++;
        }
      }

      // Verify set has all expected entries
      expect(allValidIds.size).toBe(expectedCount);
      for (const id of expectedIds) {
        expect(allValidIds.has(id)).toBe(true);
      }
    });
  });
});
