import { describe, it, expect, beforeEach } from "bun:test";
import { ReferenceRegistry } from "@/core/reference-registry";
import type { Reference } from "@/types/index";

describe("ReferenceRegistry", () => {
  let registry: ReferenceRegistry;

  beforeEach(() => {
    registry = new ReferenceRegistry();
  });

  describe("addReference", () => {
    it("should add a reference to the registry", () => {
      const ref: Reference = {
        source: "01-motivation-goal-create-customer",
        target: "02-business-process-create-order",
        type: "realizes",
        description: "Goal realized by process",
      };

      registry.addReference(ref);

      expect(registry.getReferencesFrom("01-motivation-goal-create-customer")).toHaveLength(1);
    });

    it("should add multiple references from same source", () => {
      const ref1: Reference = {
        source: "01-motivation-goal-create-customer",
        target: "02-business-process-create-order",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "01-motivation-goal-create-customer",
        target: "02-business-process-validate-order",
        type: "realizes",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);

      expect(registry.getReferencesFrom("01-motivation-goal-create-customer")).toHaveLength(2);
    });
  });

  describe("getReferencesFrom", () => {
    it("should return empty array for unknown source", () => {
      expect(registry.getReferencesFrom("unknown-element")).toEqual([]);
    });

    it("should return all references from a source", () => {
      const ref1: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "01-goal-test",
        target: "03-security-policy-test",
        type: "requires",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);

      const refs = registry.getReferencesFrom("01-goal-test");
      expect(refs).toHaveLength(2);
      expect(refs[0].target).toBe("02-process-test");
      expect(refs[1].target).toBe("03-security-policy-test");
    });
  });

  describe("getReferencesTo", () => {
    it("should return empty array for unknown target", () => {
      expect(registry.getReferencesTo("unknown-element")).toEqual([]);
    });

    it("should return all references to a target", () => {
      const ref1: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "04-application-service-test",
        target: "02-process-test",
        type: "implements",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);

      const refs = registry.getReferencesTo("02-process-test");
      expect(refs).toHaveLength(2);
    });
  });

  describe("getReferencesByType", () => {
    it("should return empty array for unknown type", () => {
      expect(registry.getReferencesByType("unknown-type")).toEqual([]);
    });

    it("should return all references of a specific type", () => {
      const ref1: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      const ref2: Reference = {
        source: "01-goal-test2",
        target: "02-process-test2",
        type: "realizes",
      };

      const ref3: Reference = {
        source: "01-goal-test3",
        target: "03-security-policy-test",
        type: "requires",
      };

      registry.addReference(ref1);
      registry.addReference(ref2);
      registry.addReference(ref3);

      const refs = registry.getReferencesByType("realizes");
      expect(refs).toHaveLength(2);
      expect(refs.every(ref => ref.type === "realizes")).toBe(true);
    });
  });

  describe("hasReference", () => {
    it("should return false for non-existent reference", () => {
      expect(
        registry.hasReference("01-goal-test", "02-process-test")
      ).toBe(false);
    });

    it("should return true for existing reference", () => {
      const ref: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      registry.addReference(ref);

      expect(
        registry.hasReference("01-goal-test", "02-process-test")
      ).toBe(true);
    });
  });

  describe("getAllReferences", () => {
    it("should return empty array when no references", () => {
      expect(registry.getAllReferences()).toEqual([]);
    });

    it("should return all references", () => {
      const refs = [
        { source: "01-goal-test", target: "02-process-test", type: "realizes" },
        {
          source: "01-goal-test2",
          target: "02-process-test2",
          type: "realizes",
        },
        {
          source: "04-application-service-test",
          target: "06-api-endpoint-test",
          type: "exposes",
        },
      ];

      refs.forEach(ref => registry.addReference(ref));

      expect(registry.getAllReferences()).toHaveLength(3);
    });
  });

  describe("clear", () => {
    it("should clear all references", () => {
      const ref: Reference = {
        source: "01-goal-test",
        target: "02-process-test",
        type: "realizes",
      };

      registry.addReference(ref);
      expect(registry.getAllReferences()).toHaveLength(1);

      registry.clear();
      expect(registry.getAllReferences()).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      const refs = [
        { source: "01-goal-test", target: "02-process-test", type: "realizes" },
        { source: "01-goal-test", target: "02-process-test2", type: "realizes" },
        {
          source: "04-application-service-test",
          target: "06-api-endpoint-test",
          type: "exposes",
        },
      ];

      refs.forEach(ref => registry.addReference(ref));

      const stats = registry.getStats();
      expect(stats.totalReferences).toBe(3);
      expect(stats.uniqueSources).toBe(2);
      expect(stats.uniqueTargets).toBe(3);
      expect(stats.referenceTypes).toContain("realizes");
      expect(stats.referenceTypes).toContain("exposes");
    });
  });
});
