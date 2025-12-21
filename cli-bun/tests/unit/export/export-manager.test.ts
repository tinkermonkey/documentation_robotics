import { describe, it, expect, beforeEach } from "bun:test";
import { ExportManager } from "@/export/export-manager";
import type { Exporter } from "@/export/types";
import type { Model } from "@/core/model";

describe("ExportManager", () => {
  let manager: ExportManager;
  let mockExporter: Exporter;

  beforeEach(() => {
    manager = new ExportManager();

    mockExporter = {
      name: "TestFormat",
      supportedLayers: ["motivation", "business"],
      export: async (_model: Model) => "test output",
    };
  });

  it("should register an exporter", () => {
    manager.register("test", mockExporter, {
      description: "Test exporter",
      mimeType: "text/plain",
    });

    expect(manager.hasFormat("test")).toBe(true);
  });

  it("should return list of formats", () => {
    manager.register("test1", mockExporter, {
      description: "Test 1",
      mimeType: "text/plain",
    });
    manager.register("test2", mockExporter, {
      description: "Test 2",
      mimeType: "text/plain",
    });

    const formats = manager.listFormats();
    expect(formats.length).toBe(2);
    expect(formats.includes("test1")).toBe(true);
    expect(formats.includes("test2")).toBe(true);
  });

  it("should get supported layers for a format", () => {
    manager.register("test", mockExporter, {
      description: "Test",
      mimeType: "text/plain",
    });

    const layers = manager.getSupportedLayers("test");
    expect(layers).toEqual(["motivation", "business"]);
  });

  it("should return undefined for unknown format", () => {
    const info = manager.getFormatInfo("nonexistent");
    expect(info).toBeUndefined();
  });

  it("should reject export with unsupported layers", async () => {
    manager.register("test", mockExporter, {
      description: "Test",
      mimeType: "text/plain",
    });

    // Create a mock model
    const mockModel = {} as Model;

    try {
      await manager.export(mockModel, "test", {
        layers: ["api", "data-model"],
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      if (error instanceof Error) {
        expect(error.message).toContain(
          "does not support layers"
        );
      }
    }
  });

  it("should throw error for unknown format", async () => {
    const mockModel = {} as Model;

    try {
      await manager.export(mockModel, "unknown", {});
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      if (error instanceof Error) {
        expect(error.message).toContain("Unknown export format");
      }
    }
  });

  it("should get all formats with metadata", () => {
    manager.register("test1", mockExporter, {
      description: "Test 1",
      mimeType: "text/plain",
    });
    manager.register("test2", mockExporter, {
      description: "Test 2",
      mimeType: "application/json",
    });

    const allFormats = manager.getAllFormats();
    expect(allFormats.length).toBe(2);
    expect(allFormats[0].format).toBe("test1");
    expect(allFormats[1].format).toBe("test2");
    expect(allFormats[0].mimeType).toBe("text/plain");
    expect(allFormats[1].mimeType).toBe("application/json");
  });

  it("should handle format registration with metadata", () => {
    manager.register("test", mockExporter, {
      description: "Test exporter format",
      mimeType: "text/plain",
    });

    const info = manager.getFormatInfo("test");
    expect(info).toBeDefined();
    expect(info?.name).toBe("TestFormat");
    expect(info?.description).toBe("Test exporter format");
    expect(info?.mimeType).toBe("text/plain");
    expect(info?.supportedLayers).toEqual(["motivation", "business"]);
  });
});
