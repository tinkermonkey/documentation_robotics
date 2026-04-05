import { describe, it, expect } from "bun:test";
import { createDescriptiveLinkText } from "../../../src/utils/markdown-link.js";

describe("createDescriptiveLinkText", () => {
  it("should format CamelCase node types", () => {
    expect(createDescriptiveLinkText("CustomEndpoint")).toBe("Custom Endpoint");
    expect(createDescriptiveLinkText("DataModel")).toBe("Data Model");
    expect(createDescriptiveLinkText("APIGateway")).toBe("A P I Gateway");
  });

  it("should handle single word types", () => {
    expect(createDescriptiveLinkText("Endpoint")).toBe("Endpoint");
    expect(createDescriptiveLinkText("Service")).toBe("Service");
    expect(createDescriptiveLinkText("Goal")).toBe("Goal");
  });

  it("should avoid prohibited texts: click here", () => {
    expect(createDescriptiveLinkText("ClickHere")).toBe("Click Here node");
  });

  it("should avoid prohibited texts: here", () => {
    expect(createDescriptiveLinkText("Here")).toBe("Here node");
  });

  it("should avoid prohibited texts: link", () => {
    expect(createDescriptiveLinkText("Link")).toBe("Link node");
  });

  it("should avoid prohibited texts: more", () => {
    expect(createDescriptiveLinkText("More")).toBe("More node");
  });

  it("should not add node suffix to safe types", () => {
    expect(createDescriptiveLinkText("Endpoint")).toBe("Endpoint");
    expect(createDescriptiveLinkText("Component")).toBe("Component");
    expect(createDescriptiveLinkText("MicroService")).toBe("Micro Service");
  });

  it("should handle types starting with special patterns", () => {
    expect(createDescriptiveLinkText("MoreDetails")).toBe("More Details");
    expect(createDescriptiveLinkText("LinkTarget")).toBe("Link Target");
  });

  it("should handle case-insensitive prohibition matching", () => {
    // "CLICKHERE" becomes "C L I C K H E R E" (each letter is split)
    // lowercase: "c l i c k h e r e" which is not in prohibited list
    expect(createDescriptiveLinkText("CLICKHERE")).toBe("C L I C K H E R E");
    // "HERE" becomes "H E R E" (each letter is split)
    // lowercase: "h e r e" which is not in prohibited list (prohibited is "here" as a word)
    expect(createDescriptiveLinkText("HERE")).toBe("H E R E");
  });

  it("should handle numbers in type names", () => {
    // "Endpoint2" -> splits on capital E only -> ["Endpoint2"] -> "Endpoint2"
    expect(createDescriptiveLinkText("Endpoint2")).toBe("Endpoint2");
    // "HTTP2Protocol" -> splits on capital H, T, T, P, P -> ["H", "T", "T", "P2", "Protocol"]
    expect(createDescriptiveLinkText("HTTP2Protocol")).toBe("H T T P2 Protocol");
  });

  it("should format complex type names", () => {
    expect(createDescriptiveLinkText("CustomRESTEndpoint")).toBe("Custom R E S T Endpoint");
    expect(createDescriptiveLinkText("DataProcessingService")).toBe("Data Processing Service");
  });

  it("should handle empty string", () => {
    expect(createDescriptiveLinkText("")).toBe("");
  });

  it("should handle single character", () => {
    expect(createDescriptiveLinkText("A")).toBe("A");
    // "L" becomes "L" which when lowercased is "l", not in prohibited list
    expect(createDescriptiveLinkText("L")).toBe("L");
  });
});
