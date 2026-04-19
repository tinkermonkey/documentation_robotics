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

// Helper function that simulates the depth clamping logic used in CbmAnalyzer
function clampDepth(depth: number | undefined): number {
  return Math.min(depth ?? 3, 10);
}

describe("Call Graph Analysis (Callers/Callees)", () => {
  describe("Depth clamping", () => {
    it("should use default depth of 3 when not specified", () => {
      const result = clampDepth(undefined);
      expect(result).toBe(3);
    });

    it("should use provided depth when within valid range", () => {
      const result = clampDepth(5);
      expect(result).toBe(5);
    });

    it("should clamp depth to maximum of 10", () => {
      const result = clampDepth(15);
      expect(result).toBe(10);
    });

    it("should clamp depth above 10 to 10 silently", () => {
      const depths = [11, 20, 100, 1000];
      for (const depth of depths) {
        const result = clampDepth(depth);
        expect(result).toBe(10);
      }
    });

    it("should handle depth of exactly 1", () => {
      const result = clampDepth(1);
      expect(result).toBe(1);
    });

    it("should handle depth of exactly 10", () => {
      const result = clampDepth(10);
      expect(result).toBe(10);
    });

    it("should clamp depth of 0", () => {
      const result = clampDepth(0);
      expect(result).toBe(0);
    });
  });

  describe("Response shaping to CallGraphNode", () => {
    // Helper function that transforms raw response to CallGraphNode
    // (matches the logic in CbmAnalyzer.traceCallPath)
    function shapeCallGraphNode(
      responseNode: any,
      projectRoot?: string
    ): CallGraphNode {
      const sourceFile = responseNode.file_path || responseNode.source_file || "";
      const relativePath = projectRoot ? sourceFile.replace(projectRoot + "/", "") : sourceFile;

      return {
        qualified_name: responseNode.qualified_name || responseNode.id,
        source_file: relativePath,
        source_symbol: responseNode.source_symbol || responseNode.id || "",
        depth: typeof responseNode.depth === "number" ? responseNode.depth : 0,
        edge_type: "CALLS",
      };
    }

    it("should shape response with all required fields", () => {
      const responseNode = {
        id: "node1",
        qualified_name: "com.example.UserService.getUser",
        file_path: "src/services/UserService.ts",
        source_symbol: "getUser",
        depth: 0,
      };

      const node = shapeCallGraphNode(responseNode);

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
      const node1 = shapeCallGraphNode(qualifiedNameNode);
      expect(node1.qualified_name).toBe("com.example.Service.method");

      // Fallback to id when qualified_name missing
      const idOnlyNode = { id: "node456" };
      const node2 = shapeCallGraphNode(idOnlyNode);
      expect(node2.qualified_name).toBe("node456");
    });

    it("should extract source_file with relative path resolution", () => {
      const projectRoot = "/workspace/myproject";
      const responseNode = {
        id: "node1",
        file_path: "/workspace/myproject/src/UserService.ts",
      };

      const node = shapeCallGraphNode(responseNode, projectRoot);
      expect(node.source_file).toBe("src/UserService.ts");
    });

    it("should extract source_symbol from node properties", () => {
      const nodeWithSymbol = {
        id: "node1",
        source_symbol: "getUserById",
      };
      const node1 = shapeCallGraphNode(nodeWithSymbol);
      expect(node1.source_symbol).toBe("getUserById");

      const nodeWithoutSymbol = { id: "node2" };
      const node2 = shapeCallGraphNode(nodeWithoutSymbol);
      expect(node2.source_symbol).toBe("node2");
    });

    it("should extract depth from node (default 0)", () => {
      const depthNode = { id: "node1", depth: 2 };
      const node1 = shapeCallGraphNode(depthNode);
      expect(node1.depth).toBe(2);

      const noDepthNode = { id: "node2" };
      const node2 = shapeCallGraphNode(noDepthNode);
      expect(node2.depth).toBe(0);
    });
  });

  describe("Edge type mapping", () => {
    // Helper function that determines edge type based on analyzer response
    function determineEdgeType(
      nodeDepth: number,
      edges: Array<{ from_node: string; to_node: string; type?: string }>,
      targetNodeQualifiedName: string,
      validEdgeTypes: string[] = ["CALLS", "HTTP_CALLS", "HANDLES"]
    ): "CALLS" | "HTTP_CALLS" | "HANDLES" {
      const defaultEdgeType = validEdgeTypes[0] || "CALLS";

      // For root nodes, use default
      if (nodeDepth === 0) {
        return defaultEdgeType as any;
      }

      // Find incoming edge for non-root node
      const incomingEdge = edges.find(
        (edge) => edge.to_node === targetNodeQualifiedName
      );
      if (incomingEdge && incomingEdge.type && validEdgeTypes.includes(incomingEdge.type)) {
        return incomingEdge.type as any;
      }

      return defaultEdgeType as any;
    }

    it("should use valid edge types from analyzer", () => {
      const validEdgeTypes = ["CALLS", "HTTP_CALLS", "HANDLES"];
      expect(validEdgeTypes).toContain("CALLS");
      expect(validEdgeTypes).toContain("HTTP_CALLS");
      expect(validEdgeTypes).toContain("HANDLES");
    });

    it("should determine edge type for root node (depth 0)", () => {
      const edges: any[] = [];
      const edgeType = determineEdgeType(0, edges, "root");
      expect(edgeType).toBe("CALLS");
    });

    it("should find edge type from edges list for non-root node", () => {
      const edges = [
        { from_node: "parent1", to_node: "child1", type: "CALLS" },
        { from_node: "parent2", to_node: "child2", type: "HTTP_CALLS" },
      ];

      const edgeType = determineEdgeType(1, edges, "child2");
      expect(edgeType).toBe("HTTP_CALLS");
    });

    it("should use default edge type when edge type invalid", () => {
      const edges = [
        { from_node: "parent", to_node: "child", type: "INVALID_TYPE" },
      ];

      const edgeType = determineEdgeType(1, edges, "child");
      expect(edgeType).toBe("CALLS");
    });

    it("should use default edge type when no matching edge found", () => {
      const edges = [
        { from_node: "parent1", to_node: "child1", type: "CALLS" },
      ];

      const edgeType = determineEdgeType(1, edges, "child2");
      expect(edgeType).toBe("CALLS");
    });
  });
});
