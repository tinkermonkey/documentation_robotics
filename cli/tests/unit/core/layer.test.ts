import { describe, it, expect } from "bun:test";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";

describe("Layer", () => {
  it("should create an empty layer", () => {
    const layer = new Layer("motivation");

    expect(layer.name).toBe("motivation");
    expect(layer.listElements()).toEqual([]);
    expect(layer.isDirty()).toBe(false);
  });

  it("should create a layer with initial elements", () => {
    const element1 = new Element({
      id: "motivation-goal-test1",
      type: "Goal",
      name: "Goal 1",
    });

    const element2 = new Element({
      id: "motivation-goal-test2",
      type: "Goal",
      name: "Goal 2",
    });

    const layer = new Layer("motivation", [element1, element2]);

    expect(layer.listElements()).toHaveLength(2);
    expect(layer.getElement("motivation-goal-test1")).toEqual(element1);
    expect(layer.getElement("motivation-goal-test2")).toEqual(element2);
  });

  it("should add elements to layer and mark as dirty", () => {
    const layer = new Layer("motivation");
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    layer.addElement(element);

    expect(layer.isDirty()).toBe(true);
    expect(layer.listElements()).toHaveLength(1);
    expect(layer.getElement("motivation-goal-test")).toEqual(element);
  });

  it("should get element by ID", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    const layer = new Layer("motivation", [element]);

    expect(layer.getElement("motivation-goal-test")).toEqual(element);
    expect(layer.getElement("nonexistent")).toBeUndefined();
  });

  it("should delete element by ID", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
    });

    const layer = new Layer("motivation", [element]);

    expect(layer.listElements()).toHaveLength(1);
    expect(layer.isDirty()).toBe(false);

    const deleted = layer.deleteElement("motivation-goal-test");

    expect(deleted).toBe(true);
    expect(layer.listElements()).toHaveLength(0);
    expect(layer.isDirty()).toBe(true);
  });

  it("should return false when deleting nonexistent element", () => {
    const layer = new Layer("motivation");

    const deleted = layer.deleteElement("nonexistent");

    expect(deleted).toBe(false);
    expect(layer.isDirty()).toBe(false);
  });

  it("should track dirty state correctly", () => {
    const layer = new Layer("motivation");

    expect(layer.isDirty()).toBe(false);

    layer.addElement(
      new Element({
        id: "motivation-goal-test",
        type: "Goal",
        name: "Test Goal",
      })
    );

    expect(layer.isDirty()).toBe(true);

    layer.markClean();

    expect(layer.isDirty()).toBe(false);
  });

  it("should serialize to JSON", () => {
    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
      description: "A test goal",
    });

    const layer = new Layer("motivation", [element]);
    layer.metadata = { layer: "motivation", version: "1.0" };

    const json = layer.toJSON();

    expect(json.elements).toHaveLength(1);
    expect(json.elements[0].id).toBe("motivation-goal-test");
    expect(json.metadata).toEqual({ layer: "motivation", version: "1.0" });
  });

  it("should deserialize from JSON", () => {
    const data = {
      elements: [
        {
          id: "motivation-goal-test",
          type: "Goal",
          name: "Test Goal",
          description: "A test goal",
        },
      ],
      metadata: { layer: "motivation", version: "1.0" },
    };

    const layer = Layer.fromJSON("motivation", data);

    expect(layer.name).toBe("motivation");
    expect(layer.listElements()).toHaveLength(1);
    expect(layer.metadata).toEqual({ layer: "motivation", version: "1.0" });

    const element = layer.getElement("motivation-goal-test");
    expect(element?.name).toBe("Test Goal");
    expect(element?.description).toBe("A test goal");
  });

  it("should list all elements", () => {
    const element1 = new Element({
      id: "motivation-goal-test1",
      type: "Goal",
      name: "Goal 1",
    });

    const element2 = new Element({
      id: "motivation-goal-test2",
      type: "Goal",
      name: "Goal 2",
    });

    const layer = new Layer("motivation", [element1, element2]);

    const elements = layer.listElements();

    expect(elements).toHaveLength(2);
    expect(elements.map((e) => e.id)).toContain("motivation-goal-test1");
    expect(elements.map((e) => e.id)).toContain("motivation-goal-test2");
  });

  it("should cache elements getter results", () => {
    const element1 = new Element({
      id: "motivation-goal-test1",
      type: "Goal",
      name: "Goal 1",
    });

    const layer = new Layer("motivation", [element1]);

    // First access
    const elements1 = layer.elements;
    // Second access without changes should return same cached map
    const elements2 = layer.elements;

    expect(elements1).toBe(elements2); // Same object reference
    expect(elements1.get("motivation-goal-test1")).toEqual(element1);
  });

  it("should invalidate elements cache when graph changes", () => {
    const element1 = new Element({
      id: "motivation-goal-test1",
      type: "Goal",
      name: "Goal 1",
    });

    const layer = new Layer("motivation", [element1]);

    // First access - caches result
    const elements1 = layer.elements;
    expect(elements1.size).toBe(1);

    // Add new element - should invalidate cache
    const element2 = new Element({
      id: "motivation-goal-test2",
      type: "Goal",
      name: "Goal 2",
    });

    layer.addElement(element2);

    // Second access - should rebuild cache due to changes
    const elements2 = layer.elements;
    expect(elements2).not.toBe(elements1); // Different object reference
    expect(elements2.size).toBe(2);
  });

  it("should return correct element references and relationships from elements getter", () => {
    const reference = {
      source: "motivation-goal-test",
      target: "business-service-test",
      type: "IMPLEMENTS",
    };

    const relationship = {
      source: "motivation-goal-test",
      target: "motivation-goal-other",
      predicate: "depends-on",
    };

    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
      references: [reference],
      relationships: [relationship],
    });

    const layer = new Layer("motivation", [element]);

    const retrieved = layer.elements.get("motivation-goal-test");
    expect(retrieved?.references).toEqual([reference]);
    expect(retrieved?.relationships).toEqual([relationship]);
  });

  it("should preserve references and relationships through update", () => {
    const reference = {
      source: "motivation-goal-test",
      target: "business-service-test",
      type: "IMPLEMENTS",
    };

    const element = new Element({
      id: "motivation-goal-test",
      type: "Goal",
      name: "Test Goal",
      description: "Original",
      references: [reference],
    });

    const layer = new Layer("motivation", [element]);

    // Update element with new description
    element.description = "Updated";
    layer.updateElement(element);

    // Verify reference is preserved
    const retrieved = layer.getElement("motivation-goal-test");
    expect(retrieved?.description).toBe("Updated");
    expect(retrieved?.references).toEqual([reference]);
  });
});
