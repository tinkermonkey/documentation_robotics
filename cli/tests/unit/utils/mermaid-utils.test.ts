import { describe, it, expect } from "bun:test";
import { sanitizeMermaidId } from "../../../src/utils/mermaid-utils.js";

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
