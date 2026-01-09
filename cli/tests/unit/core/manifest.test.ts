import { describe, it, expect, beforeEach } from "bun:test";
import { Manifest } from "@/core/manifest";

describe("Manifest", () => {
  it("should create a manifest with required fields", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    expect(manifest.name).toBe("Test Model");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.description).toBeUndefined();
    expect(manifest.author).toBeUndefined();
    expect(manifest.created).toBeDefined();
    expect(manifest.modified).toBeDefined();
    expect(manifest.specVersion).toBeUndefined();
  });

  it("should create a manifest with all fields", () => {
    const created = "2024-01-01T00:00:00Z";
    const modified = "2024-01-02T00:00:00Z";

    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "A test model",
      author: "Test Author",
      created,
      modified,
      specVersion: "0.6.0",
    });

    expect(manifest.name).toBe("Test Model");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.description).toBe("A test model");
    expect(manifest.author).toBe("Test Author");
    expect(manifest.created).toBe(created);
    expect(manifest.modified).toBe(modified);
    expect(manifest.specVersion).toBe("0.6.0");
  });

  it("should auto-generate created and modified timestamps", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    expect(manifest.created).toBeDefined();
    expect(manifest.modified).toBeDefined();

    // Timestamps should be ISO strings
    expect(() => new Date(manifest.created)).not.toThrow();
    expect(() => new Date(manifest.modified)).not.toThrow();
  });

  it("should update modified timestamp", async () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      modified: "2024-01-01T00:00:00Z",
    });

    const originalModified = manifest.modified;

    // Wait to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 10));

    manifest.updateModified();

    expect(manifest.modified).not.toBe(originalModified);
    expect(new Date(manifest.modified).getTime()).toBeGreaterThan(
      new Date(originalModified).getTime()
    );
  });

  it("should serialize to JSON with optional fields omitted", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    const json = manifest.toJSON();

    expect(json.name).toBe("Test Model");
    expect(json.version).toBe("1.0.0");
    expect(json.created).toBeDefined();
    expect(json.modified).toBeDefined();
    expect(json.description).toBeUndefined();
    expect(json.author).toBeUndefined();
    expect(json.specVersion).toBeUndefined();
  });

  it("should serialize to JSON with optional fields included", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "A test model",
      author: "Test Author",
      specVersion: "0.6.0",
    });

    const json = manifest.toJSON();

    expect(json.name).toBe("Test Model");
    expect(json.version).toBe("1.0.0");
    expect(json.description).toBe("A test model");
    expect(json.author).toBe("Test Author");
    expect(json.specVersion).toBe("0.6.0");
  });

  it("should deserialize from JSON", () => {
    const json = JSON.stringify({
      name: "Test Model",
      version: "1.0.0",
      description: "A test model",
      author: "Test Author",
      created: "2024-01-01T00:00:00Z",
      modified: "2024-01-02T00:00:00Z",
      specVersion: "0.6.0",
    });

    const manifest = Manifest.fromJSON(json);

    expect(manifest.name).toBe("Test Model");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.description).toBe("A test model");
    expect(manifest.author).toBe("Test Author");
    expect(manifest.created).toBe("2024-01-01T00:00:00Z");
    expect(manifest.modified).toBe("2024-01-02T00:00:00Z");
    expect(manifest.specVersion).toBe("0.6.0");
  });

  it("should round-trip JSON serialization", () => {
    const originalManifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      description: "A test model",
      author: "Test Author",
      specVersion: "0.6.0",
    });

    const json = JSON.stringify(originalManifest.toJSON());
    const deserializedManifest = Manifest.fromJSON(json);

    expect(deserializedManifest.name).toBe(originalManifest.name);
    expect(deserializedManifest.version).toBe(originalManifest.version);
    expect(deserializedManifest.description).toBe(originalManifest.description);
    expect(deserializedManifest.author).toBe(originalManifest.author);
    expect(deserializedManifest.specVersion).toBe(originalManifest.specVersion);
  });

  it("should return correct toString representation", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
    });

    expect(manifest.toString()).toBe("Manifest(Test Model v1.0.0)");
  });

  describe("getCodingAgent/setCodingAgent helpers", () => {
    it("should support setCodingAgent helper", () => {
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
      });

      // Initially undefined
      expect(manifest.preferred_chat_client).toBeUndefined();
      expect(manifest.getCodingAgent()).toBeUndefined();

      // Set coding agent
      manifest.setCodingAgent("Claude Code");
      expect(manifest.preferred_chat_client).toBe("Claude Code");
      expect(manifest.getCodingAgent()).toBe("Claude Code");
    });

    it("should serialize and deserialize preferred_chat_client via helpers", () => {
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
      });

      manifest.setCodingAgent("GitHub Copilot");

      const json = manifest.toJSON();
      expect(json.preferred_chat_client).toBe("GitHub Copilot");

      const deserialized = new Manifest(json);
      expect(deserialized.getCodingAgent()).toBe("GitHub Copilot");
    });

    it("should work with preferred_chat_client directly", () => {
      const manifest = new Manifest({
        name: "Test Model",
        version: "1.0.0",
      });

      // Setting via setCodingAgent should set preferred_chat_client
      manifest.setCodingAgent("Claude Code");
      expect(manifest.preferred_chat_client).toBe("Claude Code");

      const json = manifest.toJSON();
      expect(json.preferred_chat_client).toBe("Claude Code");
    });

    it("should read preferred_chat_client when set", () => {
      const data: any = {
        name: "Test Model",
        version: "1.0.0",
        preferred_chat_client: "GitHub Copilot",
      };

      const manifest = new Manifest(data);
      
      expect(manifest.preferred_chat_client).toBe("GitHub Copilot");
      expect(manifest.getCodingAgent()).toBe("GitHub Copilot");
    });

    it("should handle undefined preferred_chat_client", () => {
      const data: any = {
        name: "Test Model",
        version: "1.0.0",
      };

      const manifest = new Manifest(data);
      
      expect(manifest.preferred_chat_client).toBeUndefined();
      expect(manifest.getCodingAgent()).toBeUndefined();
    });
  });
});
