import { describe, it, expect } from "bun:test";
import { sanitizeMermaidId, escapeMermaidLabel } from "../../../src/utils/mermaid-utils.js";

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

describe("escapeMermaidLabel", () => {
  it("should escape double quotes", () => {
    expect(escapeMermaidLabel('test"label')).toBe('test\\"label');
    expect(escapeMermaidLabel('test"label"with"quotes')).toBe('test\\"label\\"with\\"quotes');
  });

  it("should escape backslashes", () => {
    expect(escapeMermaidLabel("test\\label")).toBe("test\\\\label");
    expect(escapeMermaidLabel("test\\\\label")).toBe("test\\\\\\\\label");
  });

  it("should escape backslash before double quote", () => {
    // Backslash must be escaped first to avoid double-escaping
    expect(escapeMermaidLabel('test\\"label')).toBe('test\\\\\\"label');
  });

  it("should not escape markdown special characters", () => {
    // Mermaid renders these literally, unlike markdown
    expect(escapeMermaidLabel("test|label")).toBe("test|label");
    expect(escapeMermaidLabel("test*label")).toBe("test*label");
    expect(escapeMermaidLabel("test[label]")).toBe("test[label]");
    expect(escapeMermaidLabel("test{label}")).toBe("test{label}");
  });

  it("should handle complex labels with special characters", () => {
    const label = 'API "Gateway" | v2.0';
    expect(escapeMermaidLabel(label)).toBe('API \\"Gateway\\" | v2.0');
  });

  it("should handle empty string", () => {
    expect(escapeMermaidLabel("")).toBe("");
  });

  it("should handle plain text without special characters", () => {
    expect(escapeMermaidLabel("customer satisfaction")).toBe("customer satisfaction");
    expect(escapeMermaidLabel("123")).toBe("123");
  });

  it("should correctly escape element names with quotes", () => {
    // Real-world example: element names that contain quotes
    expect(escapeMermaidLabel("John's Order")).toBe("John's Order");
    expect(escapeMermaidLabel('Object "Foo"')).toBe('Object \\"Foo\\"');
  });
});
