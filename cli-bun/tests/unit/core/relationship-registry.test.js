import { describe, it, expect, beforeEach } from "bun:test";
import { RelationshipRegistry } from "@/core/relationship-registry";
describe("RelationshipRegistry", () => {
    let registry;
    beforeEach(() => {
        registry = new RelationshipRegistry();
    });
    describe("registerType", () => {
        it("should register a relationship type", () => {
            registry.registerType({
                id: "depends-on",
                predicate: "depends-on",
                inversePredicate: "depended-by",
                category: "dependency",
                description: "Element depends on another element",
                applicable_layers: ["01", "02", "04"],
            });
            expect(registry.getType("depends-on")).toBeDefined();
            expect(registry.getTypeByPredicate("depends-on")).toBeDefined();
        });
    });
    describe("addRelationship", () => {
        it("should add a relationship to the registry", () => {
            const rel = {
                source: "01-goal-create-customer",
                target: "01-goal-validate-customer",
                predicate: "depends-on",
            };
            registry.addRelationship(rel);
            expect(registry.getRelationshipsFrom("01-goal-create-customer")).toHaveLength(1);
        });
        it("should add multiple relationships from same source", () => {
            const rel1 = {
                source: "02-process-create-order",
                target: "02-process-validate-order",
                predicate: "depends-on",
            };
            const rel2 = {
                source: "02-process-create-order",
                target: "02-process-process-payment",
                predicate: "precedes",
            };
            registry.addRelationship(rel1);
            registry.addRelationship(rel2);
            expect(registry.getRelationshipsFrom("02-process-create-order")).toHaveLength(2);
        });
    });
    describe("getRelationshipsFrom", () => {
        it("should return empty array for unknown source", () => {
            expect(registry.getRelationshipsFrom("unknown-element")).toEqual([]);
        });
        it("should return all relationships from a source", () => {
            const rel1 = {
                source: "02-process-test",
                target: "02-process-test2",
                predicate: "depends-on",
            };
            const rel2 = {
                source: "02-process-test",
                target: "02-process-test3",
                predicate: "precedes",
            };
            registry.addRelationship(rel1);
            registry.addRelationship(rel2);
            const rels = registry.getRelationshipsFrom("02-process-test");
            expect(rels).toHaveLength(2);
            expect(rels[0].target).toBe("02-process-test2");
            expect(rels[1].target).toBe("02-process-test3");
        });
    });
    describe("getRelationshipsByLayer", () => {
        it("should return empty array for unknown layer", () => {
            expect(registry.getRelationshipsByLayer("99")).toEqual([]);
        });
        it("should return all relationships in a layer", () => {
            const rel1 = {
                source: "02-process-test",
                target: "02-process-test2",
                predicate: "depends-on",
            };
            const rel2 = {
                source: "02-process-test2",
                target: "02-process-test3",
                predicate: "precedes",
            };
            registry.addRelationship(rel1);
            registry.addRelationship(rel2);
            const rels = registry.getRelationshipsByLayer("02");
            expect(rels).toHaveLength(2);
        });
    });
    describe("getRelationshipsByPredicate", () => {
        it("should return empty array for unknown predicate", () => {
            expect(registry.getRelationshipsByPredicate("unknown-predicate")).toEqual([]);
        });
        it("should return all relationships with a specific predicate", () => {
            const rel1 = {
                source: "02-process-test",
                target: "02-process-test2",
                predicate: "depends-on",
            };
            const rel2 = {
                source: "02-process-test2",
                target: "02-process-test3",
                predicate: "depends-on",
            };
            const rel3 = {
                source: "02-process-test3",
                target: "02-process-test4",
                predicate: "precedes",
            };
            registry.addRelationship(rel1);
            registry.addRelationship(rel2);
            registry.addRelationship(rel3);
            const rels = registry.getRelationshipsByPredicate("depends-on");
            expect(rels).toHaveLength(2);
            expect(rels.every(rel => rel.predicate === "depends-on")).toBe(true);
        });
    });
    describe("hasRelationship", () => {
        it("should return false for non-existent relationship", () => {
            expect(registry.hasRelationship("02-process-test", "02-process-test2", "depends-on")).toBe(false);
        });
        it("should return true for existing relationship", () => {
            const rel = {
                source: "02-process-test",
                target: "02-process-test2",
                predicate: "depends-on",
            };
            registry.addRelationship(rel);
            expect(registry.hasRelationship("02-process-test", "02-process-test2", "depends-on")).toBe(true);
        });
        it("should return false for different predicate", () => {
            const rel = {
                source: "02-process-test",
                target: "02-process-test2",
                predicate: "depends-on",
            };
            registry.addRelationship(rel);
            expect(registry.hasRelationship("02-process-test", "02-process-test2", "precedes")).toBe(false);
        });
    });
    describe("getAllRelationships", () => {
        it("should return empty array when no relationships", () => {
            expect(registry.getAllRelationships()).toEqual([]);
        });
        it("should return all relationships", () => {
            const rels = [
                { source: "02-process-test", target: "02-process-test2", predicate: "depends-on" },
                { source: "02-process-test2", target: "02-process-test3", predicate: "precedes" },
                { source: "04-application-service-test", target: "04-application-service-test2", predicate: "depends-on" },
            ];
            rels.forEach(rel => registry.addRelationship(rel));
            expect(registry.getAllRelationships()).toHaveLength(3);
        });
    });
    describe("getAllTypes", () => {
        it("should return empty array when no types registered", () => {
            expect(registry.getAllTypes()).toEqual([]);
        });
        it("should return all registered types", () => {
            registry.registerType({
                id: "depends-on",
                predicate: "depends-on",
                category: "dependency",
            });
            registry.registerType({
                id: "precedes",
                predicate: "precedes",
                category: "ordering",
            });
            const types = registry.getAllTypes();
            expect(types).toHaveLength(2);
        });
    });
    describe("isValidPredicate", () => {
        it("should return false for unregistered predicate", () => {
            expect(registry.isValidPredicate("unknown-predicate")).toBe(false);
        });
        it("should return true for registered predicate", () => {
            registry.registerType({
                id: "depends-on",
                predicate: "depends-on",
                category: "dependency",
            });
            expect(registry.isValidPredicate("depends-on")).toBe(true);
        });
    });
    describe("getValidPredicatesForLayer", () => {
        it("should return empty array when no types applicable to layer", () => {
            registry.registerType({
                id: "depends-on",
                predicate: "depends-on",
                category: "dependency",
                applicable_layers: ["04", "05"],
            });
            expect(registry.getValidPredicatesForLayer("02")).toEqual([]);
        });
        it("should return predicates applicable to layer", () => {
            registry.registerType({
                id: "depends-on",
                predicate: "depends-on",
                category: "dependency",
                applicable_layers: ["02", "04"],
            });
            registry.registerType({
                id: "precedes",
                predicate: "precedes",
                category: "ordering",
                applicable_layers: ["02"],
            });
            const predicates = registry.getValidPredicatesForLayer("02-process");
            expect(predicates).toHaveLength(2);
            expect(predicates).toContain("depends-on");
            expect(predicates).toContain("precedes");
        });
        it("should handle types with no applicable layers", () => {
            registry.registerType({
                id: "generic",
                predicate: "generic",
                category: "generic",
            });
            const predicates = registry.getValidPredicatesForLayer("02-process");
            expect(predicates).toContain("generic");
        });
    });
    describe("clear", () => {
        it("should clear all relationships and types", () => {
            registry.registerType({
                id: "depends-on",
                predicate: "depends-on",
                category: "dependency",
            });
            registry.addRelationship({
                source: "02-process-test",
                target: "02-process-test2",
                predicate: "depends-on",
            });
            expect(registry.getAllRelationships()).toHaveLength(1);
            expect(registry.getAllTypes()).toHaveLength(1);
            registry.clear();
            expect(registry.getAllRelationships()).toHaveLength(0);
            expect(registry.getAllTypes()).toHaveLength(0);
        });
    });
    describe("getStats", () => {
        it("should return correct statistics", () => {
            registry.registerType({
                id: "depends-on",
                predicate: "depends-on",
                category: "dependency",
            });
            registry.registerType({
                id: "precedes",
                predicate: "precedes",
                category: "ordering",
            });
            registry.addRelationship({
                source: "02-process-test",
                target: "02-process-test2",
                predicate: "depends-on",
            });
            registry.addRelationship({
                source: "02-process-test",
                target: "02-process-test3",
                predicate: "precedes",
            });
            registry.addRelationship({
                source: "04-application-service-test",
                target: "04-application-service-test2",
                predicate: "depends-on",
            });
            const stats = registry.getStats();
            expect(stats.totalRelationships).toBe(3);
            expect(stats.uniquePredicates).toBe(2);
            expect(stats.uniqueLayers).toBe(2);
            expect(stats.totalTypes).toBe(2);
        });
    });
});
//# sourceMappingURL=relationship-registry.test.js.map