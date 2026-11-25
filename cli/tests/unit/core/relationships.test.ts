/**
 * Unit tests for the Relationships store (relationships.yaml in memory).
 */

import { describe, it, expect } from "bun:test";
import { Relationships, elementIdentifiers, relationshipEndLayer, type Relationship } from "../../../src/core/relationships.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const PATH = "application.applicationcomponent.alpha";

function rel(source: string, target: string, predicate = "uses"): Relationship {
  return { source, target, predicate, layer: "application", category: "structural" };
}

describe("elementIdentifiers", () => {
  it("returns the UUID id and the dotted path once each", () => {
    expect(elementIdentifiers({ id: UUID, path: PATH })).toEqual([UUID, PATH]);
    expect(elementIdentifiers({ id: UUID, path: PATH }, PATH, UUID)).toEqual([UUID, PATH]);
  });

  it("includes extra identifiers and drops empty values", () => {
    expect(elementIdentifiers({ id: UUID, path: "" }, undefined, "typed-id")).toEqual([UUID, "typed-id"]);
    expect(elementIdentifiers({})).toEqual([]);
  });
});

describe("Relationships.deleteForElement", () => {
  it("removes rows that name the element by any of its identifiers (#963)", () => {
    const store = new Relationships([
      rel(UUID, "other"),
      rel("other", PATH),
      rel("other", "another"),
    ]);
    const removed = store.deleteForElement([UUID, PATH]);
    expect(removed).toBe(2);
    expect(store.getAll()).toEqual([rel("other", "another")]);
    expect(store.isDirty()).toBe(true);
  });

  it("still accepts a single identifier", () => {
    const store = new Relationships([rel(UUID, "other"), rel("other", PATH)]);
    expect(store.deleteForElement(PATH)).toBe(1);
    expect(store.getAll()).toEqual([rel(UUID, "other")]);
  });

  it("ignores empty identifiers", () => {
    const store = new Relationships([rel("a", "b")]);
    expect(store.deleteForElement([""])).toBe(0);
    expect(store.getAll()).toHaveLength(1);
  });
});

describe("Relationships.retain", () => {
  it("keeps matching rows in their original order and reports the removed count", () => {
    const rows = [rel("a", "b"), rel("c", "d"), rel("e", "f")];
    const store = new Relationships([...rows]);
    const removed = store.retain((r) => r.source !== "c");
    expect(removed).toBe(1);
    expect(store.getAll()).toEqual([rows[0], rows[2]]);
    expect(store.isDirty()).toBe(true);
  });

  it("does not mark the store dirty when nothing is removed", () => {
    const store = new Relationships([rel("a", "b")]);
    expect(store.retain(() => true)).toBe(0);
    expect(store.isDirty()).toBe(false);
  });
});

describe("relationshipEndLayer (#1259)", () => {
  it("reads a dotted id's layer from its first segment", () => {
    const rel = { source: "api.operation.x", target: "data-model.objectschema.y", layer: "api" };
    expect(relationshipEndLayer(rel, "source")).toBe("api");
    expect(relationshipEndLayer(rel, "target")).toBe("data-model");
  });

  it("reads an end named by UUID from the layers the row records", () => {
    const rel = { source: "a920ab1c-c481-46b6-bdb4-4050501adeac", target: "e642ad79-62ea-47a4-ae04-d512d0ef7881" };
    expect(relationshipEndLayer({ ...rel, layer: "application", targetLayer: "business" }, "source")).toBe("application");
    expect(relationshipEndLayer({ ...rel, layer: "application", targetLayer: "business" }, "target")).toBe("business");
    // No targetLayer: an intra-layer row
    expect(relationshipEndLayer({ ...rel, layer: "application" }, "target")).toBe("application");
    expect(relationshipEndLayer(rel, "source")).toBeNull();
  });
});
