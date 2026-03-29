import { describe, it, expect } from "bun:test";
import { getLayerNumber, LAYER_MAP, LAYER_NAMES } from "../../../src/scan/layer-constants.js";

describe("Layer Constants", () => {
  describe("LAYER_MAP", () => {
    it("contains all 12 layers with correct mappings", () => {
      expect(Object.keys(LAYER_MAP).length).toBe(12);
      expect(LAYER_MAP.motivation).toBe(1);
      expect(LAYER_MAP.business).toBe(2);
      expect(LAYER_MAP.security).toBe(3);
      expect(LAYER_MAP.application).toBe(4);
      expect(LAYER_MAP.technology).toBe(5);
      expect(LAYER_MAP.api).toBe(6);
      expect(LAYER_MAP["data-model"]).toBe(7);
      expect(LAYER_MAP["data-store"]).toBe(8);
      expect(LAYER_MAP.ux).toBe(9);
      expect(LAYER_MAP.navigation).toBe(10);
      expect(LAYER_MAP.apm).toBe(11);
      expect(LAYER_MAP.testing).toBe(12);
    });
  });

  describe("LAYER_NAMES", () => {
    it("contains all layer names in correct order", () => {
      expect(LAYER_NAMES.length).toBe(12);
      expect(LAYER_NAMES[0]).toBe("motivation");
      expect(LAYER_NAMES[11]).toBe("testing");
    });
  });

  describe("getLayerNumber", () => {
    it("returns correct layer number for single-word layer names", () => {
      expect(getLayerNumber("motivation.goal.customer-satisfaction")).toBe(1);
      expect(getLayerNumber("business.service.order-management")).toBe(2);
      expect(getLayerNumber("security.control.authentication")).toBe(3);
      expect(getLayerNumber("application.service.user-service")).toBe(4);
      expect(getLayerNumber("technology.platform.kubernetes")).toBe(5);
      expect(getLayerNumber("api.endpoint.create-order")).toBe(6);
      expect(getLayerNumber("ux.screen.checkout")).toBe(9);
      expect(getLayerNumber("navigation.page.dashboard")).toBe(10);
      expect(getLayerNumber("testing.testcase.login-flow")).toBe(12);
    });

    it("returns correct layer number for hyphenated layer names", () => {
      // data-model layer (7)
      expect(getLayerNumber("data-model.entity.customer")).toBe(7);
      expect(getLayerNumber("data-model.entity.order")).toBe(7);

      // data-store layer (8)
      expect(getLayerNumber("data-store.table.users")).toBe(8);
      expect(getLayerNumber("data-store.table.orders")).toBe(8);
    });

    it("returns correct layer number for apm layer", () => {
      expect(getLayerNumber("apm.metric.request-latency")).toBe(11);
      expect(getLayerNumber("apm.trace.distributed-trace")).toBe(11);
    });

    it("returns null for invalid layer names", () => {
      expect(getLayerNumber("invalid.something.else")).toBeNull();
      expect(getLayerNumber("nonexistent.element.id")).toBeNull();
      expect(getLayerNumber("random.type.name")).toBeNull();
    });

    it("returns correct layer number even for abbreviated element IDs", () => {
      // The function just looks at the first segment before the first dot
      expect(getLayerNumber("api")).toBe(6);
      expect(getLayerNumber("api.endpoint")).toBe(6);

      // Invalid layer name still returns null
      expect(getLayerNumber("badlayer.type.name")).toBeNull();
    });

    it("returns null for empty or whitespace-only layer names", () => {
      expect(getLayerNumber(".type.name")).toBeNull();
      expect(getLayerNumber("")).toBeNull();
    });

    it("extracts layer from first dot-separated segment only", () => {
      // Only the first segment should be checked
      expect(getLayerNumber("api.endpoint.api")).toBe(6);
      expect(getLayerNumber("api.application.service")).toBe(6); // First segment is still "api"
      expect(getLayerNumber("motivation.business.security")).toBe(1); // First segment is "motivation"
    });
  });
});
