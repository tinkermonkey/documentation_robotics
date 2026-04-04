import { describe, it, expect } from "bun:test";
import { sanitizeMermaidId, buildMermaidFlowchartLR, buildMermaidFlowchartTB } from "../../../src/utils/mermaid-utils.js";

describe("sanitizeMermaidId", () => {
  it("should replace non-alphanumeric characters with underscores", () => {
    expect(sanitizeMermaidId("test-id")).toBe("test_id");
    expect(sanitizeMermaidId("test.id")).toBe("test_id");
    expect(sanitizeMermaidId("test@id")).toBe("test_id");
  });

  it("should handle multiple consecutive non-alphanumeric characters", () => {
    expect(sanitizeMermaidId("test---id")).toBe("test___id");
    expect(sanitizeMermaidId("test...id")).toBe("test___id");
  });

  it("should preserve alphanumeric characters", () => {
    expect(sanitizeMermaidId("testId123")).toBe("testId123");
    expect(sanitizeMermaidId("Test_ID_123")).toBe("Test_ID_123");
  });

  it("should handle spaces", () => {
    expect(sanitizeMermaidId("test id")).toBe("test_id");
    expect(sanitizeMermaidId("multiple  spaces")).toBe("multiple__spaces");
  });

  it("should handle special characters", () => {
    expect(sanitizeMermaidId("test/id")).toBe("test_id");
    expect(sanitizeMermaidId("test:id")).toBe("test_id");
    expect(sanitizeMermaidId("test#id")).toBe("test_id");
  });

  it("should handle empty string", () => {
    expect(sanitizeMermaidId("")).toBe("");
  });

  it("should handle only non-alphanumeric characters", () => {
    expect(sanitizeMermaidId("---")).toBe("___");
    expect(sanitizeMermaidId("!!!")).toBe("___");
  });

  it("should handle real-world node type names", () => {
    expect(sanitizeMermaidId("CustomEndpoint")).toBe("CustomEndpoint");
    expect(sanitizeMermaidId("data-model")).toBe("data_model");
    expect(sanitizeMermaidId("API-Gateway")).toBe("API_Gateway");
  });
});

describe("buildMermaidFlowchartLR", () => {
  it("should create basic flowchart with nodes and edges", () => {
    const nodes = [
      { id: "node1", label: "Node 1" },
      { id: "node2", label: "Node 2" },
    ];
    const edges = [{ from: "node1", to: "node2", label: "connects" }];

    const result = buildMermaidFlowchartLR("subgraph1", nodes, edges);

    expect(result).toContain("```mermaid");
    expect(result).toContain("flowchart LR");
    expect(result).toContain("subgraph subgraph1");
    expect(result).toContain('node1["Node 1"]');
    expect(result).toContain('node2["Node 2"]');
    expect(result).toContain("node1 -->|connects| node2");
    expect(result).toContain("end");
    expect(result).toContain("```");
  });

  it("should sanitize node IDs with special characters", () => {
    const nodes = [{ id: "node-1", label: "Node 1" }];
    const edges: Array<{ from: string; to: string; label?: string }> = [];

    const result = buildMermaidFlowchartLR("subgraph1", nodes, edges);

    expect(result).toContain('node_1["Node 1"]');
  });

  it("should sanitize subgraph ID", () => {
    const nodes: Array<{ id: string; label: string }> = [];
    const edges: Array<{ from: string; to: string; label?: string }> = [];

    const result = buildMermaidFlowchartLR("data-model", nodes, edges);

    expect(result).toContain("subgraph data_model");
  });

  it("should handle edges without labels", () => {
    const nodes = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    const edges = [{ from: "a", to: "b" }];

    const result = buildMermaidFlowchartLR("test", nodes, edges);

    expect(result).toContain("a --> b");
  });

  it("should handle multiple edges", () => {
    const nodes = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];
    const edges = [
      { from: "a", to: "b", label: "first" },
      { from: "b", to: "c", label: "second" },
    ];

    const result = buildMermaidFlowchartLR("test", nodes, edges);

    expect(result).toContain("a -->|first| b");
    expect(result).toContain("b -->|second| c");
  });

  it("should handle empty nodes and edges", () => {
    const result = buildMermaidFlowchartLR("empty", [], []);

    expect(result).toContain("```mermaid");
    expect(result).toContain("flowchart LR");
    expect(result).toContain("subgraph empty");
    expect(result).toContain("end");
  });
});

describe("buildMermaidFlowchartTB", () => {
  it("should create top-to-bottom flowchart", () => {
    const layers = [
      { id: "layer1", label: "Layer 1" },
      { id: "layer2", label: "Layer 2" },
    ];
    const edges = [{ from: "layer1", to: "layer2" }];

    const result = buildMermaidFlowchartTB(layers, edges);

    expect(result).toContain("```mermaid");
    expect(result).toContain("flowchart TB");
    expect(result).toContain('layer1["Layer 1"]');
    expect(result).toContain('layer2["Layer 2"]');
    expect(result).toContain("layer1 --> layer2");
  });

  it("should include class definition for styling", () => {
    const result = buildMermaidFlowchartTB([], []);

    expect(result).toContain("classDef current fill:#f9f,stroke:#333,stroke-width:2px");
  });

  it("should apply current layer styling", () => {
    const layers = [
      { id: "api", label: "API" },
      { id: "data-model", label: "Data Model" },
    ];
    const edges: Array<{ from: string; to: string }> = [];

    const result = buildMermaidFlowchartTB(layers, edges, "data-model");

    expect(result).toContain("class data_model current");
  });

  it("should sanitize layer IDs with special characters", () => {
    const layers = [{ id: "data-model", label: "Data Model" }];
    const edges: Array<{ from: string; to: string }> = [];

    const result = buildMermaidFlowchartTB(layers, edges);

    expect(result).toContain('data_model["Data Model"]');
  });

  it("should handle multiple edges", () => {
    const layers = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];

    const result = buildMermaidFlowchartTB(layers, edges);

    expect(result).toContain("a --> b");
    expect(result).toContain("b --> c");
  });
});
