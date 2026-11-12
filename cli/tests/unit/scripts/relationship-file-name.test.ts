import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  ambiguousTypeNames,
  parseRelationshipFileName,
  parseRelationshipId,
  relationshipFileName,
  relationshipFileNameProblem,
  relationshipFileNameProblems,
  relationshipFilePath,
  specNodeIdsIn,
} from "../../../../spec/scripts/lib/relationship-file-name.js";
import { SpecState } from "../../../scripts/spec-enrich/lib/spec-state.js";

/**
 * The relationship schema file-naming rule (#1090): a destination whose type name is defined in
 * more than one layer carries its layer in the file name, so two same-named types in different
 * layers get two files.
 */
const SPEC_SCHEMAS = path.resolve(import.meta.dir, "../../../../spec/schemas");

describe("relationship schema file names", () => {
  const ambiguous = ambiguousTypeNames(["ux.view", "data-store.view", "security.validationrule", "data-store.validationrule", "motivation.goal", "testing.testcasesketch"]);

  it("finds the type names more than one layer defines", () => {
    expect([...ambiguous].sort()).toEqual(["validationrule", "view"]);
  });

  it("qualifies only an ambiguous destination, never the source", () => {
    expect(relationshipFileName("testing.testcasesketch.tests.security.validationrule", ambiguous)).toBe("testcasesketch.tests.security.validationrule.relationship.schema.json");
    expect(relationshipFileName("testing.testcasesketch.tests.data-store.validationrule", ambiguous)).toBe("testcasesketch.tests.data-store.validationrule.relationship.schema.json");
    expect(relationshipFileName("ux.view.supports.motivation.goal", ambiguous)).toBe("view.supports.goal.relationship.schema.json");
    expect(relationshipFilePath("data-store.view.derives-from.data-store.view", ambiguous)).toBe("data-store/view.derives-from.data-store.view.relationship.schema.json");
  });

  it("parses three-segment and four-segment names, hyphenated layers included", () => {
    expect(parseRelationshipFileName("view.supports.goal.relationship.schema.json")).toEqual({ sourceType: "view", predicate: "supports", destinationType: "goal" });
    expect(parseRelationshipFileName("collection.composes.data-store.validationrule.relationship.schema.json")).toEqual({
      sourceType: "collection",
      predicate: "composes",
      destinationLayer: "data-store",
      destinationType: "validationrule",
    });
    expect(parseRelationshipFileName("view.derives-from.data-store.view.relationship.schema.json")?.predicate).toBe("derives-from");
  });

  it("rejects names that are not two or three dots before the suffix", () => {
    expect(parseRelationshipFileName("a.b.relationship.schema.json")).toBeNull();
    expect(parseRelationshipFileName("testing.testcasesketch.tests.ux.view.relationship.schema.json")).toBeNull();
    expect(parseRelationshipFileName("a..b.relationship.schema.json")).toBeNull();
    expect(parseRelationshipFileName("a.b.c.node.schema.json")).toBeNull();
    expect(() => parseRelationshipId("testing.testcasesketch.tests.view")).toThrow(/relationship id/);
  });

  it("refuses an unqualified name for an ambiguous destination and a qualified one for a unique destination", () => {
    expect(relationshipFileNameProblem("testing", "testcasesketch.tests.view.relationship.schema.json", "testing.testcasesketch.tests.ux.view", ambiguous)).toMatch(
      /leaves out the destination layer.*rename it to testcasesketch\.tests\.ux\.view\.relationship\.schema\.json/
    );
    expect(relationshipFileNameProblem("ux", "view.supports.motivation.goal.relationship.schema.json", "ux.view.supports.motivation.goal", ambiguous)).toMatch(
      /qualifies goal, which only one layer defines/
    );
    expect(relationshipFileNameProblem("ux", "testcasesketch.tests.ux.view.relationship.schema.json", "testing.testcasesketch.tests.ux.view", ambiguous)).toMatch(/in the ux directory/);
    expect(relationshipFileNameProblem("testing", "testcasesketch.tests.ux.view.relationship.schema.json", "testing.testcasesketch.tests.ux.view", ambiguous)).toBeNull();
  });

  it("names every relationship schema in the spec by the rule", () => {
    expect(relationshipFileNameProblems(SPEC_SCHEMAS)).toEqual([]);
    const specAmbiguous = ambiguousTypeNames(specNodeIdsIn(SPEC_SCHEMAS));
    expect([...specAmbiguous].sort()).toEqual(["retentionpolicy", "validationrule", "view"]);
    for (const f of [
      "testing/testcasesketch.tests.ux.view",
      "testing/testcasesketch.tests.data-store.validationrule",
      "testing/testcasesketch.accesses.data-store.view",
      "testing/testcoveragetarget.covers.ux.view",
    ]) {
      expect(fs.existsSync(path.join(SPEC_SCHEMAS, "relationships", `${f}.relationship.schema.json`))).toBe(true);
    }
  });

  describe("a spec with one source linked to two same-named types", () => {
    let spec: string;

    function writeNode(layer: string, type: string) {
      const dir = path.join(spec, "schemas", "nodes", layer);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${type}.node.schema.json`), JSON.stringify({ properties: { spec_node_id: { const: `${layer}.${type}` } } }));
    }

    function writeRelationship(id: string, fileName: string) {
      const [sl, , predicate, dl] = id.split(".");
      const dir = path.join(spec, "schemas", "relationships", sl);
      fs.mkdirSync(dir, { recursive: true });
      const p = id.split(".");
      const schema = {
        properties: {
          id: { const: id },
          source_spec_node_id: { const: `${p[0]}.${p[1]}` },
          source_layer: { const: sl },
          destination_spec_node_id: { const: `${p[3]}.${p[4]}` },
          destination_layer: { const: dl },
          predicate: { const: predicate },
        },
      };
      fs.writeFileSync(path.join(dir, fileName), JSON.stringify(schema));
    }

    beforeEach(() => {
      spec = mkdtempSync(path.join(tmpdir(), "test-rel-file-name-"));
      writeNode("testing", "testcasesketch");
      writeNode("security", "validationrule");
      writeNode("data-store", "validationrule");
      fs.mkdirSync(path.join(spec, "schemas", "base"), { recursive: true });
      fs.writeFileSync(path.join(spec, "schemas", "base", "predicates.json"), JSON.stringify({ predicates: { tests: {} } }));
    });

    afterEach(() => {
      rmSync(spec, { recursive: true, force: true });
    });

    it("holds both triples in two files, and the loaders read both", () => {
      writeRelationship("testing.testcasesketch.tests.security.validationrule", "testcasesketch.tests.security.validationrule.relationship.schema.json");
      writeRelationship("testing.testcasesketch.tests.data-store.validationrule", "testcasesketch.tests.data-store.validationrule.relationship.schema.json");

      expect(relationshipFileNameProblems(path.join(spec, "schemas"))).toEqual([]);
      const state = new SpecState(spec);
      expect([...state.relFiles.keys()].sort()).toEqual(["testing.testcasesketch.tests.data-store.validationrule", "testing.testcasesketch.tests.security.validationrule"]);
      expect(new Set(state.relFiles.values()).size).toBe(2);
    });

    it("reports the old unqualified name for an ambiguous destination", () => {
      writeRelationship("testing.testcasesketch.tests.data-store.validationrule", "testcasesketch.tests.validationrule.relationship.schema.json");
      expect(relationshipFileNameProblems(path.join(spec, "schemas"))).toEqual([
        "relationships/testing/testcasesketch.tests.validationrule.relationship.schema.json holds testing.testcasesketch.tests.data-store.validationrule, but its name leaves out the destination layer, and validationrule is defined in more than one layer; rename it to testcasesketch.tests.data-store.validationrule.relationship.schema.json",
      ]);
    });
  });
});
