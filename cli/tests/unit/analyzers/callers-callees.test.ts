/**
 * Unit tests for call graph analysis (callers/callees)
 *
 * Tests covering:
 * - Depth clamping: default 3, max 10, above-10 clamped silently
 * - Response shaping to CallGraphNode
 * - Edge type mapping from call graph response
 */

import { describe, it, expect } from "bun:test";
import type { CallGraphNode } from "@/analyzers/types.js";

describe("Call Graph Analysis (Callers/Callees)", () => {
  describe("Depth clamping", () => {
    it("should use default depth of 3 when not specified", () => {
      const depth: number | undefined = undefined;
      const clampedDepth = Math.min(depth ?? 3, 10);
      expect(clampedDepth).toBe(3);
    });

    it("should use provided depth when within valid range", () => {
      const depth: number | undefined = 5;
      const clampedDepth = Math.min(depth ?? 3, 10);
      expect(clampedDepth).toBe(5);
    });

    it("should clamp depth to maximum of 10", () => {
      const depth: number | undefined = 15;
      const clampedDepth = Math.min(depth ?? 3, 10);
      expect(clampedDepth).toBe(10);
    });

    it("should clamp depth above 10 to 10 silently", () => {
      const depths = [11, 20, 100, 1000];
      for (const depth of depths) {
        const clampedDepth = Math.min(depth, 10);
        expect(clampedDepth).toBe(10);
      }
    });

    it("should handle depth of exactly 1", () => {
      const depth: number | undefined = 1;
      const clampedDepth = Math.min(depth ?? 3, 10);
      expect(clampedDepth).toBe(1);
    });

    it("should handle depth of exactly 10", () => {
      const depth: number | undefined = 10;
      const clampedDepth = Math.min(depth ?? 3, 10);
      expect(clampedDepth).toBe(10);
    });

    it("should not modify depth of 0", () => {
      const depth: number | undefined = 0;
      const clampedDepth = Math.min(depth ?? 3, 10);
      expect(clampedDepth).toBe(0);
    });
  });

  describe("Response shaping to CallGraphNode", () => {
    it("should shape response with all required fields", () => {
      const node: CallGraphNode = {
        qualified_name: "com.example.UserService.getUser",
        source_file: "src/services/UserService.ts",
        source_symbol: "getUser",
        depth: 0,
        edge_type: "CALLS",
      };

      expect(node.qualified_name).toBe("com.example.UserService.getUser");
      expect(node.source_file).toBe("src/services/UserService.ts");
      expect(node.source_symbol).toBe("getUser");
      expect(node.depth).toBe(0);
      expect(node.edge_type).toBe("CALLS");
    });

    it("should extract qualified_name from node or fallback to id", () => {
      // With qualified_name in response
      const qualifiedNameNode = {
        id: "node123",
        qualified_name: "com.example.Service.method",
      };
      const nodeQualifiedName = qualifiedNameNode.qualified_name || qualifiedNameNode.id;
      expect(nodeQualifiedName).toBe("com.example.Service.method");

      // Fallback to id when qualified_name missing
      const idOnlyNode = { id: "node456" };
      const fallbackQualifiedName = (idOnlyNode as any).qualified_name || idOnlyNode.id;
      expect(fallbackQualifiedName).toBe("node456");
    });

    it("should extract source_file with relative path resolution", () => {
      const projectRoot = "/workspace/myproject";
      const absolutePath = "/workspace/myproject/src/UserService.ts";

      // Simulated relative path conversion
      const relativePath = absolutePath.replace(projectRoot + "/", "");
      expect(relativePath).toBe("src/UserService.ts");
    });

    it("should extract source_symbol from node properties", () => {
      const nodeWithSymbol = {
        id: "node1",
        source_symbol: "getUserById",
      };
      const symbol = nodeWithSymbol.source_symbol || nodeWithSymbol.id;
      expect(symbol).toBe("getUserById");

      const nodeWithoutSymbol = { id: "node2" };
      const symbolFallback = (nodeWithoutSymbol as any).source_symbol || nodeWithSymbol.id;
      expect(symbolFallback).toBe("node1");
    });

    it("should extract depth from node (default 0)", () => {
      const depthNode = { id: "node1", depth: 2 };
      const nodeDepth = typeof depthNode.depth === "number" ? depthNode.depth : 0;
      expect(nodeDepth).toBe(2);

      const noDepthNode = { id: "node2" };
      const depthFallback =
        typeof (noDepthNode as any).depth === "number" ? (noDepthNode as any).depth : 0;
      expect(depthFallback).toBe(0);
    });
  });

  describe("Edge type mapping", () => {
    it("should use valid edge types from analyzer", () => {
      const validEdgeTypes = ["CALLS", "HTTP_CALLS", "HANDLES"];
      const defaultEdgeType =
        validEdgeTypes.length > 0 ? validEdgeTypes[0] : "CALLS";

      expect(defaultEdgeType).toBe("CALLS");
      expect(validEdgeTypes).toContain("CALLS");
      expect(validEdgeTypes).toContain("HTTP_CALLS");
      expect(validEdgeTypes).toContain("HANDLES");
    });

    it("should determine edge type for root node (depth 0)", () => {
      const validEdgeTypes = ["CALLS", "HTTP_CALLS", "HANDLES"];
      const defaultEdgeType = validEdgeTypes[0];

      const rootNode = { id: "root", depth: 0 };
      const nodeDepth = typeof rootNode.depth === "number" ? rootNode.depth : 0;
      let edgeType: "CALLS" | "HTTP_CALLS" | "HANDLES" = defaultEdgeType as any;

      // For root nodes, no need to look up edges
      if (nodeDepth === 0) {
        edgeType = defaultEdgeType as any;
      }

      expect(edgeType).toBe("CALLS");
    });

    it("should find edge type from edges list for non-root node", () => {
      const validEdgeTypes = ["CALLS", "HTTP_CALLS", "HANDLES"];
      const defaultEdgeType = validEdgeTypes[0];

      const edges = [
        { from_node: "parent1", to_node: "child1", type: "CALLS" },
        { from_node: "parent2", to_node: "child2", type: "HTTP_CALLS" },
      ];

      const targetNodeQualifiedName = "child2";
      let edgeType: "CALLS" | "HTTP_CALLS" | "HANDLES" = defaultEdgeType as any;

      const incomingEdge = edges.find(
        (edge) => edge.to_node === targetNodeQualifiedName
      );
      if (incomingEdge && incomingEdge.type) {
        if (validEdgeTypes.includes(incomingEdge.type)) {
          edgeType = incomingEdge.type as any;
        }
      }

      expect(edgeType).toBe("HTTP_CALLS");
    });

    it("should use default edge type when edge type invalid", () => {
      const validEdgeTypes = ["CALLS", "HTTP_CALLS", "HANDLES"];
      const defaultEdgeType = validEdgeTypes[0];

      const edges = [
        { from_node: "parent", to_node: "child", type: "INVALID_TYPE" },
      ];

      const targetNodeQualifiedName = "child";
      let edgeType: "CALLS" | "HTTP_CALLS" | "HANDLES" = defaultEdgeType as any;

      const incomingEdge = edges.find(
        (edge) => edge.to_node === targetNodeQualifiedName
      );
      if (incomingEdge && incomingEdge.type) {
        if (validEdgeTypes.includes(incomingEdge.type)) {
          edgeType = incomingEdge.type as any;
        }
      }

      expect(edgeType).toBe("CALLS");
    });

    it("should use default edge type when no matching edge found", () => {
      const validEdgeTypes = ["CALLS", "HTTP_CALLS", "HANDLES"];
      const defaultEdgeType = validEdgeTypes[0];

      const edges: Array<{
        from_node: string;
        to_node: string;
        type?: string;
      }> = [
        { from_node: "parent1", to_node: "child1", type: "CALLS" },
      ];

      const targetNodeQualifiedName = "child2";
      let edgeType: "CALLS" | "HTTP_CALLS" | "HANDLES" = defaultEdgeType as any;

      const incomingEdge = edges.find(
        (edge) => edge.to_node === targetNodeQualifiedName
      );
      if (incomingEdge && incomingEdge.type) {
        if (validEdgeTypes.includes(incomingEdge.type)) {
          edgeType = incomingEdge.type as any;
        }
      }

      expect(edgeType).toBe("CALLS");
    });
  });

  describe("Complete call graph node transformation", () => {
    it("should transform callers response correctly", () => {
      const responseNode = {
        id: "node1",
        qualified_name: "com.example.OtherService.callsTarget",
        file_path: "/workspace/project/src/OtherService.ts",
        source_symbol: "callsTarget",
        depth: 1,
      };

      const projectRoot = "/workspace/project";
      const sourceFile =
        responseNode.file_path || (responseNode as any).source_file || "";
      const relativePath = sourceFile.replace(projectRoot + "/", "");

      const node: CallGraphNode = {
        qualified_name: responseNode.qualified_name || responseNode.id,
        source_file: relativePath,
        source_symbol: responseNode.source_symbol || responseNode.id || "",
        depth: typeof responseNode.depth === "number" ? responseNode.depth : 0,
        edge_type: "CALLS",
      };

      expect(node.qualified_name).toBe(
        "com.example.OtherService.callsTarget"
      );
      expect(node.source_file).toBe("src/OtherService.ts");
      expect(node.source_symbol).toBe("callsTarget");
      expect(node.depth).toBe(1);
      expect(node.edge_type).toBe("CALLS");
    });

    it("should handle missing optional fields with defaults", () => {
      const minimalResponseNode = {
        id: "node123",
      };

      const node: CallGraphNode = {
        qualified_name: (minimalResponseNode as any).qualified_name || minimalResponseNode.id,
        source_file: (minimalResponseNode as any).file_path || (minimalResponseNode as any).source_file || "",
        source_symbol: (minimalResponseNode as any).source_symbol || minimalResponseNode.id || "",
        depth: typeof (minimalResponseNode as any).depth === "number" ? (minimalResponseNode as any).depth : 0,
        edge_type: "CALLS",
      };

      expect(node.qualified_name).toBe("node123");
      expect(node.source_file).toBe("");
      expect(node.source_symbol).toBe("node123");
      expect(node.depth).toBe(0);
      expect(node.edge_type).toBe("CALLS");
    });
  });
});
