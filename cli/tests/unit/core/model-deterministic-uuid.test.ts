/**
 * Tests for the deterministic UUID migration behavior in model loading.
 *
 * The model uses a deterministicUUID function to convert slug-format element IDs
 * to UUIDs on load. This is tested indirectly via Layer behavior, which stores
 * elements with uuid = element.id (when it's a UUID) and graph key = element.path.
 *
 * UUID migration logic lives in model.ts (loadLayer). These tests verify the
 * graph-level storage contract that the migration relies on.
 */
import { describe, it, expect } from "bun:test";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("UUID/path storage contract (pre-condition for migration)", () => {
  it("element with UUID id and slug path stores uuid separately from graph key", () => {
    // This simulates what model.ts produces after deterministicUUID migration:
    // element.id = UUID, element.path = slug
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const slug = "motivation.goal.customer-satisfaction";

    const element = new Element({
      id: uuid,
      path: slug,
      type: "Goal",
      name: "Customer Satisfaction",
    });

    const layer = new Layer("motivation", [element]);
    const stored = layer.listElements()[0];

    // id should be the UUID (preserved from element.id)
    expect(stored.id).toBe(uuid);
    // path should be the slug (graph key)
    expect(stored.path).toBe(slug);
  });

  it("element with slug-only id stores slug as both id and path", () => {
    // Before migration: element.id is a slug, no separate path
    // Layer stores it with graph key = slug, no uuid
    const slug = "motivation.goal.test-slug";

    const element = new Element({
      id: slug,
      type: "Goal",
      name: "Test Slug",
    });

    const layer = new Layer("motivation", [element]);
    const stored = layer.listElements()[0];

    // id = node.uuid || node.id → slug (no uuid since element.id is not a UUID)
    expect(stored.id).toBe(slug);
    // path = node.id = graphId = element.path || element.id = slug
    expect(stored.path).toBe(slug);
  });

  it("two elements with different UUID/path pairs are stored independently", () => {
    const uuid1 = "550e8400-e29b-41d4-a716-446655440001";
    const uuid2 = "550e8400-e29b-41d4-a716-446655440002";
    const slug1 = "motivation.goal.goal-one";
    const slug2 = "motivation.goal.goal-two";

    const element1 = new Element({ id: uuid1, path: slug1, type: "Goal", name: "Goal One" });
    const element2 = new Element({ id: uuid2, path: slug2, type: "Goal", name: "Goal Two" });

    const layer = new Layer("motivation", [element1, element2]);
    const elements = layer.listElements();

    expect(elements).toHaveLength(2);

    const ids = elements.map((e) => e.id).sort();
    expect(ids).toContain(uuid1);
    expect(ids).toContain(uuid2);

    const paths = elements.map((e) => e.path).sort();
    expect(paths).toContain(slug1);
    expect(paths).toContain(slug2);
  });

  it("same slug used twice (two loads) yields same UUID when manually supplying the same UUID", () => {
    // The deterministicUUID function in model.ts is not exported, but we can verify
    // the storage contract: if model.ts produces uuid X for slug Y, loading it again
    // produces the same uuid X (because SHA-256 of Y is deterministic).
    //
    // We simulate this by constructing two elements with the same pre-computed UUID/path
    // pair (as model.ts would) and verifying they store identically.
    const slug = "motivation.goal.stable-goal";

    // Simulated deterministicUUID output (would be same on both loads)
    // We use a fixed UUID here to represent the deterministic output
    const deterministicUUIDForSlug = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

    const element1 = new Element({ id: deterministicUUIDForSlug, path: slug, type: "Goal", name: "Stable Goal" });
    const layer1 = new Layer("motivation", [element1]);

    const element2 = new Element({ id: deterministicUUIDForSlug, path: slug, type: "Goal", name: "Stable Goal" });
    const layer2 = new Layer("motivation", [element2]);

    const stored1 = layer1.listElements()[0];
    const stored2 = layer2.listElements()[0];

    expect(stored1.id).toBe(stored2.id);
    expect(stored1.path).toBe(stored2.path);
    expect(stored1.id).toBe(deterministicUUIDForSlug);
    expect(UUID_PATTERN.test(stored1.id)).toBe(true);
  });
});
