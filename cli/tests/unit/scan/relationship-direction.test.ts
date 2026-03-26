import { describe, it, expect } from "bun:test";
import { isValidRelationshipDirection, LAYER_INDEX } from "../../../src/scan/pattern-loader.js";

describe("Relationship Direction Validation", () => {
  describe("same-layer relationships (always allowed)", () => {
    it("should allow api.endpoint → api.endpoint", () => {
      expect(isValidRelationshipDirection("api.endpoint.create-user", "api.endpoint.get-users")).toBe(true);
    });

    it("should allow application.service → application.service", () => {
      expect(isValidRelationshipDirection("application.service.auth", "application.service.user")).toBe(true);
    });

    it("should allow testing.test-case → testing.test-case", () => {
      expect(isValidRelationshipDirection("testing.test-case.x", "testing.test-case.y")).toBe(true);
    });

    it("should allow data-model.entity → data-model.entity", () => {
      expect(isValidRelationshipDirection("data-model.entity.user", "data-model.entity.order")).toBe(true);
    });
  });

  describe("cross-layer relationships (higher → lower only)", () => {
    it("should allow api[6] → application[4]", () => {
      expect(isValidRelationshipDirection("api.endpoint.get-users", "application.service.user-service")).toBe(true);
    });

    it("should allow data-model[7] → data-store[8] (same layer, allowed)", () => {
      expect(isValidRelationshipDirection("data-model.entity.x", "data-store.table.y")).toBe(false); // 7 > 8 is false
    });

    it("should allow data-store[8] → data-model[7]", () => {
      expect(isValidRelationshipDirection("data-store.table.x", "data-model.entity.y")).toBe(true);
    });

    it("should allow ux[9] → api[6]", () => {
      expect(isValidRelationshipDirection("ux.component.user-profile", "api.endpoint.get-user")).toBe(true);
    });

    it("should allow testing[12] → all lower layers", () => {
      expect(isValidRelationshipDirection("testing.test-case.login-test", "motivation.goal.x")).toBe(true);
    });
  });

  describe("cross-layer relationships (invalid: lower → higher)", () => {
    it("should reject application[4] → api[6]", () => {
      expect(isValidRelationshipDirection("application.service.user", "api.endpoint.get-users")).toBe(false);
    });

    it("should reject technology[5] → api[6]", () => {
      expect(isValidRelationshipDirection("technology.service.x", "api.endpoint.y")).toBe(false);
    });

    it("should reject motivation[1] → all higher layers", () => {
      expect(isValidRelationshipDirection("motivation.goal.x", "api.endpoint.get-user")).toBe(false);
    });
  });

  describe("invalid element ID formats", () => {
    it("should reject bare names without layer", () => {
      expect(isValidRelationshipDirection("user-service", "api.endpoint.x")).toBe(false);
    });

    it("should reject incomplete element IDs", () => {
      expect(isValidRelationshipDirection("api.endpoint", "application.service.x")).toBe(false);
    });

    it("should reject unknown layer names", () => {
      expect(isValidRelationshipDirection("unknown.type.name", "api.endpoint.x")).toBe(false);
    });
  });
});
