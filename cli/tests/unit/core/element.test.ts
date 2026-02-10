import { describe, it, expect } from "bun:test";
import { Element } from "@/core/element";
import type { Reference, Relationship } from "@/types/index";

describe("Element", () => {
  it("should create an element with required fields", () => {
    const element = new Element({
      id: "motivation-goal-test-goal",
      type: "Goal",
      name: "Test Goal",
    });

    expect(element.id).toBe("motivation-goal-test-goal");
    expect(element.type).toBe("Goal");
    expect(element.name).toBe("Test Goal");
    expect(element.description).toBeUndefined();
  });

  it("should create an element with all fields", () => {
    const references: Reference[] = [
      {
        source: "motivation-goal-test",
        target: "business-process-test",
        type: "implements",
        description: "implements process",
      },
    ];

    const relationships: Relationship[] = [
      {
        source: "motivation-goal-test",
        target: "motivation-goal-other",
        predicate: "depends-on",
      },
    ];

    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
      description: "A test goal",
      properties: { priority: "high" },
      references,
      relationships,
    });

    expect(element.id).toBe("motivation-goal-test");
    expect(element.type).toBe("Goal");
    expect(element.name).toBe("Test Goal");
    expect(element.description).toBe("A test goal");
    expect(element.properties).toEqual({ priority: "high" });
    expect(element.references).toEqual(references);
    expect(element.relationships).toEqual(relationships);
  });

  it("should initialize empty properties, references, and relationships", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    expect(element.properties).toEqual({});
    expect(element.references).toEqual([]);
    expect(element.relationships).toEqual([]);
  });

  it("should get and set properties", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    element.setProperty("priority", "high");
    element.setProperty("owner", "team-a");

    expect(element.getProperty<string>("priority")).toBe("high");
    expect(element.getProperty<string>("owner")).toBe("team-a");
    expect(element.getProperty<string>("nonexistent")).toBeUndefined();
  });

  it("should handle array properties", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    element.setProperty("tags", []);
    element.addToArrayProperty("tags", "important");
    element.addToArrayProperty("tags", "urgent");

    const tags = element.getArrayProperty<string>("tags");
    expect(tags).toEqual(["important", "urgent"]);
  });

  it("should return empty array for non-existent array property", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    const tags = element.getArrayProperty<string>("tags");
    expect(tags).toEqual([]);
  });

  it("should serialize to JSON with optional fields omitted", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    const json = element.toJSON();

    expect(json.id).toBe("motivation-goal-test");
    expect(json.type).toBe("Goal");
    expect(json.name).toBe("Test Goal");
    expect(json.description).toBeUndefined();
    expect(json.properties).toBeUndefined();
    expect(json.references).toBeUndefined();
    expect(json.relationships).toBeUndefined();
  });

  it("should serialize to JSON with optional fields included", () => {
    const references: Reference[] = [
      {
        source: "motivation-goal-test",
        target: "business-process-test",
        type: "implements",
      },
    ];

    const relationships: Relationship[] = [
      {
        source: "motivation-goal-test",
        target: "motivation-goal-other",
        predicate: "depends-on",
      },
    ];

    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
      description: "A test goal",
      properties: { priority: "high" },
      references,
      relationships,
    });

    const json = element.toJSON();

    expect(json.id).toBe("motivation-goal-test");
    expect(json.description).toBe("A test goal");
    expect(json.properties).toEqual({ priority: "high" });
    expect(json.references).toEqual(references);
    expect(json.relationships).toEqual(relationships);
  });

  it("should return correct toString representation", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    expect(element.toString()).toBe("Element(motivation-goal-test)");
  });

  describe("UUID Generation Security", () => {
    it("should generate cryptographically secure UUIDs for legacy elements", () => {
      // Suppress expected deprecation warnings during this test
      const warnSpy = console.warn;
      console.warn = () => {};

      try {
        // Legacy format element that requires UUID generation
        const element = new Element({
          elementId: "motivation.goal.test-goal",
          type: "goal",
          name: "Test Goal",
          layer: "motivation",
        });

        // UUID should be valid format (RFC 4122 v4)
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(element.id).toMatch(uuidRegex);
      } finally {
        console.warn = warnSpy;
      }
    });

    it("should generate unique UUIDs for each element", () => {
      // Suppress expected deprecation warnings during this test
      const warnSpy = console.warn;
      console.warn = () => {};

      try {
        const elements = Array.from({ length: 10 }, (_, i) => {
          return new Element({
            elementId: `motivation.goal.test-goal-${i}`,
            type: "goal",
            name: `Test Goal ${i}`,
            layer: "motivation",
          });
        });

        const ids = new Set(elements.map((e) => e.id));
        // All generated UUIDs should be unique
        expect(ids.size).toBe(10);
      } finally {
        console.warn = warnSpy;
      }
    });

    it("should generate unique UUIDs without collisions", () => {
      // Suppress expected deprecation warnings during this test
      const warnSpy = console.warn;
      console.warn = () => {};

      try {
        // Generate multiple UUIDs and verify uniqueness
        const uuids = Array.from({ length: 100 }, () => {
          return new Element({
            elementId: `motivation.goal.collision-test`,
            type: "goal",
            name: "Collision Test",
            layer: "motivation",
          }).id;
        });

        // All should be unique (with cryptographic randomness, collision probability is negligible)
        const uniqueUuids = new Set(uuids);
        expect(uniqueUuids.size).toBe(100);

        // Verify format compliance for all generated UUIDs
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        uuids.forEach((uuid) => {
          expect(uuid).toMatch(uuidRegex);
        });
      } finally {
        console.warn = warnSpy;
      }
    });

    it("should preserve user-provided valid UUIDs", () => {
      const validUuid = "550e8400-e29b-41d4-a716-446655440000";
      const element = new Element({
        id: validUuid,
        type: "Goal",
        name: "Test Goal",
      });

      // Should preserve the provided UUID if it's valid format
      expect(element.id).toBe(validUuid);
    });

    it("should reject invalid UUIDs and generate new ones", () => {
      // Suppress expected deprecation warnings during this test
      const warnSpy = console.warn;
      console.warn = () => {};

      try {
        // Invalid UUID (wrong version bits - needs version 4)
        // Using legacy format with elementId to trigger UUID validation
        const invalidUuid = "550e8400-e29b-31d4-a716-446655440000";
        const element = new Element({
          elementId: "motivation.goal.test-goal",
          id: invalidUuid, // Provides an invalid UUID in legacy format
          type: "goal",
          name: "Test Goal",
          layer: "motivation",
        });

        // Should generate a new UUID instead of using invalid one
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(element.id).toMatch(uuidRegex);
        expect(element.id).not.toBe(invalidUuid);
      } finally {
        console.warn = warnSpy;
      }
    });

    it("should generate UUID for semantic ID in legacy format", () => {
      // Suppress expected deprecation warnings during this test
      const warnSpy = console.warn;
      console.warn = () => {};

      try {
        const element = new Element({
          id: "motivation.goal.test-goal", // Semantic ID (contains dots)
          type: "goal",
          name: "Test Goal",
          layer: "motivation",
        });

        // Should generate a new UUID for semantic IDs
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(element.id).toMatch(uuidRegex);
        // And extract semantic ID separately
        expect(element.elementId).toBe("motivation.goal.test-goal");
      } finally {
        console.warn = warnSpy;
      }
    });
  });
});
