import { describe, it, expect } from "bun:test";
import { Element } from "@/core/element";
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
        const references = [
            {
                source: "motivation-goal-test",
                target: "business-process-test",
                type: "implements",
                description: "implements process",
            },
        ];
        const relationships = [
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
        expect(element.getProperty("priority")).toBe("high");
        expect(element.getProperty("owner")).toBe("team-a");
        expect(element.getProperty("nonexistent")).toBeUndefined();
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
        const tags = element.getArrayProperty("tags");
        expect(tags).toEqual(["important", "urgent"]);
    });
    it("should return empty array for non-existent array property", () => {
        const element = new Element({
            id: "motivation-goal-test",
            type: "Goal",
            name: "Test Goal",
        });
        const tags = element.getArrayProperty("tags");
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
        const references = [
            {
                source: "motivation-goal-test",
                target: "business-process-test",
                type: "implements",
            },
        ];
        const relationships = [
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
});
//# sourceMappingURL=element.test.js.map