import { describe, it, expect } from "bun:test";
import { Element } from "@/core/element";
import type { Reference, Relationship } from "@/types/index";

describe("Element", () => {
  it("should create an element with required fields", () => {
    const element = new Element({
      id: "motivation-goal-test-goal",
      spec_node_id: "motivation.goal",
      type: "goal",
      name: "Test Goal",
      layer_id: "motivation",
    });

    expect(element.id).toBe("motivation-goal-test-goal");
    expect(element.spec_node_id).toBe("motivation.goal");
    expect(element.type).toBe("goal");
    expect(element.name).toBe("Test Goal");
    expect(element.layer_id).toBe("motivation");
    expect(element.description).toBeUndefined();
  });

  it("should serialize to JSON with optional fields omitted", () => {
    const element = new Element({
      id: "motivation-goal-test-goal",
      spec_node_id: "motivation.goal",
      type: "goal",
      name: "Test Goal",
      layer_id: "motivation",
    });

    const json = element.toJSON();

    expect(json.id).toBe("motivation-goal-test-goal");
    expect(json.spec_node_id).toBe("motivation.goal");
    expect(json.type).toBe("goal");
    expect(json.name).toBe("Test Goal");
    expect(json.layer_id).toBe("motivation");
    expect(json.description).toBeUndefined();
    expect(json.attributes).toBeUndefined();
    expect(json.references).toBeUndefined();
    expect(json.relationships).toBeUndefined();
  });

  it("should return correct toString representation", () => {
    const element = new Element({
      id: "motivation-goal-test-goal",
      spec_node_id: "motivation.goal",
      type: "goal",
      name: "Test Goal",
      layer_id: "motivation",
    });

    expect(element.toString()).toBe("Element(motivation-goal-test-goal)");
  });
});
