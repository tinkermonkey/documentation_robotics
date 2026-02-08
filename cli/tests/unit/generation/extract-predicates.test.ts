import { describe, test, expect, beforeAll } from "bun:test";
import path from "path";
import fs from "fs/promises";

describe("Predicate Catalog Consolidation", () => {
  let specsDir: string;

  beforeAll(() => {
    specsDir = path.resolve(path.join(__dirname, "..", "..", "..", "..", "spec"));
  });

  test("should load predicate catalog", async () => {
    const predicateFile = path.join(specsDir, "predicates.json");
    const content = await fs.readFile(predicateFile, "utf-8");
    const catalog = JSON.parse(content);

    expect(catalog.predicates).toBeDefined();
    expect(typeof catalog.predicates).toBe("object");
  });

  test("should have consolidated predicates from common schema", async () => {
    const predicateFile = path.join(specsDir, "predicates.json");
    const content = await fs.readFile(predicateFile, "utf-8");
    const catalog = JSON.parse(content);

    const predicateNames = Object.keys(catalog.predicates);
    expect(predicateNames.length).toBeGreaterThan(0);
  });

  test("should have predicate definitions with required fields", async () => {
    const predicateFile = path.join(specsDir, "predicates.json");
    const content = await fs.readFile(predicateFile, "utf-8");
    const catalog = JSON.parse(content);

    for (const [name, predDef] of Object.entries(catalog.predicates)) {
      const pred = predDef as Record<string, any>;
      expect(pred.predicate).toBeDefined();
      expect(pred.inverse).toBeDefined();
      expect(pred.category).toBeDefined();
      expect(pred.description).toBeDefined();
    }
  });

  test("should have semantics properties for predicates", async () => {
    const predicateFile = path.join(specsDir, "predicates.json");
    const content = await fs.readFile(predicateFile, "utf-8");
    const catalog = JSON.parse(content);

    // Check a few known predicates have semantics
    const checkPredicates = ["supports", "realizes"];
    for (const name of checkPredicates) {
      if (catalog.predicates[name]) {
        const pred = catalog.predicates[name] as Record<string, any>;
        expect(pred.semantics).toBeDefined();
        expect(pred.semantics.directionality).toBeDefined();
        expect(pred.semantics.transitivity).toBeDefined();
        expect(pred.semantics.symmetry).toBeDefined();
        expect(pred.semantics.reflexivity).toBeDefined();
      }
    }
  });

  test("should include archimate_alignment where applicable", async () => {
    const predicateFile = path.join(specsDir, "predicates.json");
    const content = await fs.readFile(predicateFile, "utf-8");
    const catalog = JSON.parse(content);

    // Some predicates should have archimate alignment
    let foundAlignment = false;
    for (const predDef of Object.values(catalog.predicates)) {
      const pred = predDef as Record<string, any>;
      if (pred.archimate_alignment) {
        foundAlignment = true;
        break;
      }
    }
    expect(foundAlignment).toBe(true);
  });
});
