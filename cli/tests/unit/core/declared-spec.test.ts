import { describe, expect, it } from "bun:test";
import {
  compareSpecVersions,
  relationshipNotInDeclaredSpec,
  typeNotInDeclaredSpec,
  type SpecCatalogHistory,
} from "../../../src/core/declared-spec.js";
import { SPEC_CATALOG_HISTORY } from "../../../src/core/spec-catalog-history.js";
import { MigrationRegistry } from "../../../src/core/migration-registry.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";

const bundled = getCliBundledSpecVersion();

describe("declared-spec check (#1411)", () => {
  it("refuses the relationship #1411 found landed in a 0.13.0 model, naming both versions", () => {
    const gap = relationshipNotInDeclaredSpec(
      "0.13.0",
      "application.applicationservice",
      "accesses",
      "data-model.objectschema"
    );
    expect(gap).not.toBeNull();
    expect(gap!.since).toBe("0.14.0");
    expect(gap!.message).toContain("is not in spec 0.13.0, the model's version");
    expect(gap!.message).toContain("it exists from spec 0.14.0");
    expect(gap!.message).toContain("project_upgrade");
  });

  it("accepts it once the model is on the version that has it", () => {
    expect(
      relationshipNotInDeclaredSpec("0.14.0", "application.applicationservice", "accesses", "data-model.objectschema")
    ).toBeNull();
    expect(
      relationshipNotInDeclaredSpec(bundled, "application.applicationservice", "accesses", "data-model.objectschema")
    ).toBeNull();
  });

  it("accepts what 0.13.0 already had", () => {
    expect(
      relationshipNotInDeclaredSpec("0.13.0", "application.applicationcomponent", "accesses", "data-model.objectschema")
    ).toBeNull();
  });

  it("refuses a type the declared spec lacks", () => {
    const gap = typeNotInDeclaredSpec("0.13.0", "application.message");
    expect(gap?.since).toBe("0.14.0");
    expect(gap?.message).toStartWith("Type application.message is not in spec 0.13.0");
    expect(typeNotInDeclaredSpec("0.14.0", "application.message")).toBeNull();
    expect(typeNotInDeclaredSpec("0.13.0", "application.applicationservice")).toBeNull();
  });

  it("says a type only the bundled spec has exists from the bundled version", () => {
    // Not in any released catalog the table has: only the CLI's own spec defines it
    const history: SpecCatalogHistory = { versions: ["0.13.0", "0.14.0"], types: {}, relationships: {} };
    expect(typeNotInDeclaredSpec("0.14.0", "ux.designtoken", history)?.since).toBe(bundled);
  });

  it("checks nothing for a model with no declared version, or one on or past the bundled spec", () => {
    expect(typeNotInDeclaredSpec(undefined, "application.message")).toBeNull();
    expect(typeNotInDeclaredSpec(null, "application.message")).toBeNull();
    expect(typeNotInDeclaredSpec("99.0.0", "application.message")).toBeNull();
  });

  it("refuses on a version between two released ones only what neither of them has", () => {
    const history: SpecCatalogHistory = {
      versions: ["0.12.0", "0.13.0", "0.14.0"],
      types: { "a.added-in-13": "011", "a.added-in-14": "001", "a.removed-in-13": "100" },
      relationships: {},
    };
    // 0.12.5 sits between 0.12.0 and 0.13.0
    expect(typeNotInDeclaredSpec("0.12.5", "a.added-in-13", history)).toBeNull();
    expect(typeNotInDeclaredSpec("0.12.5", "a.removed-in-13", history)).toBeNull();
    expect(typeNotInDeclaredSpec("0.12.5", "a.added-in-14", history)?.since).toBe("0.14.0");
  });

  it("reads a model older than the first released catalog as on it", () => {
    const history: SpecCatalogHistory = { versions: ["0.8.0", "0.9.0"], types: { "a.old": "11", "a.new": "01" }, relationships: {} };
    expect(typeNotInDeclaredSpec("0.6.0", "a.old", history)).toBeNull();
    expect(typeNotInDeclaredSpec("0.6.0", "a.new", history)?.since).toBe("0.9.0");
  });

  it("names the first version after the model's that has it again, for one removed and restored", () => {
    const history: SpecCatalogHistory = {
      versions: ["0.10.0", "0.11.0", "0.12.0", "0.13.0"],
      types: {},
      relationships: { "a.x.serves.a.y": "1001" },
    };
    expect(relationshipNotInDeclaredSpec("0.11.0", "a.x", "serves", "a.y", history)?.since).toBe("0.13.0");
    expect(relationshipNotInDeclaredSpec("0.10.0", "a.x", "serves", "a.y", history)).toBeNull();
  });

  it("compares versions part by part", () => {
    expect(compareSpecVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareSpecVersions("0.10.0", "0.10.0")).toBe(0);
    expect(compareSpecVersions("1.0", "0.99.9")).toBe(1);
  });
});

describe("spec catalog history table", () => {
  it("ends at the released version the bundled spec migrates from (regenerate it after a spec release)", () => {
    const previous = new MigrationRegistry().getMigrationPath("0.5.0", bundled).at(-1)?.fromVersion;
    const last = SPEC_CATALOG_HISTORY.versions.at(-1);
    if (last !== previous || SPEC_CATALOG_HISTORY.versions.includes(bundled)) {
      throw new Error(
        `cli/src/core/spec-catalog-history.ts ends at spec ${last}, but the bundled spec ${bundled} migrates from ` +
          `${previous}: the spec moved past the table. Regenerate it from cli/ with ` +
          "bun scripts/generate-spec-catalog-history.ts, and commit the result."
      );
    }
  });

  it("is ordered oldest first, with one mask character per version", () => {
    const { versions, types, relationships } = SPEC_CATALOG_HISTORY;
    for (let i = 1; i < versions.length; i++) expect(compareSpecVersions(versions[i - 1], versions[i])).toBe(-1);
    for (const mask of [...Object.values(types), ...Object.values(relationships)]) {
      expect(mask).toMatch(new RegExp(`^[01]{${versions.length}}$`));
    }
  });
});
