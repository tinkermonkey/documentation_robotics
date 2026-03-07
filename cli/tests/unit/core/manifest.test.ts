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
});

describe("Manifest.migrateChangesetHistory", () => {
  it("should return empty array for undefined history", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: undefined,
    });

    expect(manifest.changeset_history).toEqual([]);
  });

  it("should return empty array for empty history", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [],
    });

    expect(manifest.changeset_history).toEqual([]);
  });

  it("should migrate legacy 'applied' action to 'committed'", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [
        {
          name: "legacy-changeset",
          action: "applied" as any,
          applied_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    expect(manifest.changeset_history).toHaveLength(1);
    expect(manifest.changeset_history![0].action).toBe("committed");
    expect(manifest.changeset_history![0].committed_at).toBe("2024-01-01T00:00:00Z");
    expect(manifest.changeset_history![0].name).toBe("legacy-changeset");
  });

  it("should migrate legacy 'reverted' action to 'discarded'", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [
        {
          name: "reverted-changeset",
          action: "reverted" as any,
          applied_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    expect(manifest.changeset_history).toHaveLength(1);
    expect(manifest.changeset_history![0].action).toBe("discarded");
    expect(manifest.changeset_history![0].committed_at).toBe("2024-01-01T00:00:00Z");
  });

  it("should preserve 'committed' action as-is", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [
        {
          name: "new-changeset",
          action: "committed",
          committed_at: "2024-01-02T00:00:00Z",
        },
      ],
    });

    expect(manifest.changeset_history).toHaveLength(1);
    expect(manifest.changeset_history![0].action).toBe("committed");
    expect(manifest.changeset_history![0].committed_at).toBe("2024-01-02T00:00:00Z");
  });

  it("should preserve 'discarded' action as-is", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [
        {
          name: "discarded-changeset",
          action: "discarded",
          committed_at: "2024-01-02T00:00:00Z",
        },
      ],
    });

    expect(manifest.changeset_history).toHaveLength(1);
    expect(manifest.changeset_history![0].action).toBe("discarded");
    expect(manifest.changeset_history![0].committed_at).toBe("2024-01-02T00:00:00Z");
  });

  it("should prefer committed_at over legacy applied_at field", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [
        {
          name: "mixed-changeset",
          action: "committed",
          committed_at: "2024-01-02T00:00:00Z",
          applied_at: "2024-01-01T00:00:00Z", // Older legacy field - should be ignored
        },
      ],
    });

    expect(manifest.changeset_history).toHaveLength(1);
    expect(manifest.changeset_history![0].committed_at).toBe("2024-01-02T00:00:00Z");
  });

  it("should throw error for unrecognized action value", () => {
    expect(() => {
      new Manifest({
        name: "Test Model",
        version: "1.0.0",
        changeset_history: [
          {
            name: "invalid-changeset",
            action: "invalid" as any,
            applied_at: "2024-01-01T00:00:00Z",
          },
        ],
      });
    }).toThrow(/Invalid changeset history action/);
  });

  it("should handle multiple changesets with mixed legacy and new formats", () => {
    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [
        {
          name: "legacy-changeset-1",
          action: "applied" as any,
          applied_at: "2024-01-01T00:00:00Z",
        },
        {
          name: "new-changeset",
          action: "committed",
          committed_at: "2024-01-02T00:00:00Z",
        },
        {
          name: "legacy-changeset-2",
          action: "reverted" as any,
          applied_at: "2024-01-03T00:00:00Z",
        },
      ],
    });

    expect(manifest.changeset_history).toHaveLength(3);
    expect(manifest.changeset_history![0].action).toBe("committed");
    expect(manifest.changeset_history![0].name).toBe("legacy-changeset-1");
    expect(manifest.changeset_history![1].action).toBe("committed");
    expect(manifest.changeset_history![1].name).toBe("new-changeset");
    expect(manifest.changeset_history![2].action).toBe("discarded");
    expect(manifest.changeset_history![2].name).toBe("legacy-changeset-2");
  });

  it("should use current timestamp if neither committed_at nor applied_at is provided", () => {
    const beforeTime = new Date().toISOString();

    const manifest = new Manifest({
      name: "Test Model",
      version: "1.0.0",
      changeset_history: [
        {
          name: "undated-changeset",
          action: "committed",
        },
      ],
    });

    const afterTime = new Date().toISOString();

    expect(manifest.changeset_history).toHaveLength(1);
    const timestamp = manifest.changeset_history![0].committed_at;
    // ISO strings can be compared lexicographically since format is fixed (YYYY-MM-DDTHH:mm:ss.sssZ)
    expect(timestamp! >= beforeTime).toBe(true);
    expect(timestamp! <= afterTime).toBe(true);
  });
});
