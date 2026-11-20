/**
 * toKebabCase and generateElementId. Bug 9 of the gateway validation: a dot between code-symbol
 * parts was dropped without a word break, so "PetTypeRepository.findPetTypes" became
 * "pet-type-repositoryfind-pet-types".
 */

import { describe, it, expect } from "bun:test";
import {
  MAX_ID_SLUG,
  compactId,
  deriveElementId,
  elementUnderEarlierId,
  generateElementId,
  nearDuplicateId,
  toKebabCase,
} from "../../../src/utils/id-generator.js";
import { extractedElementId } from "../../../src/analyzers/extraction-plan.js";

describe("toKebabCase", () => {
  it("breaks the word at a dot between code-symbol parts", () => {
    expect(toKebabCase("PetTypeRepository.findPetTypes")).toBe("pet-type-repository-find-pet-types");
    expect(toKebabCase("aB.cD")).toBe("a-b-c-d");
    expect(toKebabCase("OwnerController.showOwner")).toBe("owner-controller-show-owner");
    expect(toKebabCase("graphUtils.nodeDegree.compute")).toBe("graph-utils-node-degree-compute");
    expect(toKebabCase("call PetTypeRepository.findPetTypes now")).toBe("call-pet-type-repository-find-pet-types-now");
  });

  it("keeps product names and version numbers joined, as before", () => {
    expect(toKebabCase("Node.js")).toBe("nodejs");
    expect(toKebabCase("Vue.js")).toBe("vuejs");
    expect(toKebabCase("ASP.NET Core")).toBe("aspnet-core");
    expect(toKebabCase("Node@.js$")).toBe("nodejs");
    expect(toKebabCase("Python 3.12")).toBe("python-312");
    expect(toKebabCase("v1.2.3")).toBe("v123");
  });

  it("keeps the existing conversions", () => {
    expect(toKebabCase("Customer Management")).toBe("customer-management");
    expect(toKebabCase("CustomerManagement")).toBe("customer-management");
    expect(toKebabCase("customer_management")).toBe("customer-management");
    expect(toKebabCase("  --Leading and trailing--  ")).toBe("leading-and-trailing");
  });

  it("gives a three-segment element id for a dotted symbol name", () => {
    const id = generateElementId("application", "applicationfunction", "PetTypeRepository.findPetTypes");
    expect(id).toBe("application.applicationfunction.pet-type-repository-find-pet-types");
    expect(id.split(".")).toHaveLength(3);
  });

  it("model_add names a symbol-named element with the word break", async () => {
    const { mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { Model } = await import("../../../src/core/model.js");
    const { clearModelCache } = await import("../../../src/mcp/tools/shared.js");
    const { modelAddHandler } = await import("../../../src/mcp/tools/model-add.js");
    const rootPath = join(tmpdir(), `dr-id-generator-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootPath, { recursive: true });
    clearModelCache();
    try {
      await Model.init(rootPath, { name: "Id Test Model", version: "0.1.0" });
      const result = await modelAddHandler({
        layer: "application",
        type: "applicationfunction",
        name: "PetTypeRepository.findPetTypes",
        rootPath,
      });
      expect(JSON.parse((result.content[0] as any).text).id).toBe(
        "application.applicationfunction.pet-type-repository-find-pet-types"
      );
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

describe("toKebabCase and digits (#1184)", () => {
  it("breaks after a digit that a capitalised word follows, as after a lowercase letter", () => {
    expect(toKebabCase("Tier1Status")).toBe("tier1-status");
    expect(toKebabCase("Tier1 Panel")).toBe("tier1-panel");
    expect(toKebabCase("useTier1")).toBe("use-tier1");
    expect(toKebabCase("base64Encode")).toBe("base64-encode");
    expect(toKebabCase("S3Bucket")).toBe("s3-bucket");
  });

  it("keeps a digit joined to a lone capital or an acronym", () => {
    expect(toKebabCase("Vector3D")).toBe("vector3d");
    expect(toKebabCase("3D Object Effect")).toBe("3d-object-effect");
    expect(toKebabCase("P2PNetwork")).toBe("p2pnetwork");
    expect(toKebabCase("sha256")).toBe("sha256");
    expect(toKebabCase("i18n")).toBe("i18n");
  });
});

describe("deriveElementId: one id function for dr add, model_add and extraction (#1225)", () => {
  const slug = (name: string) => deriveElementId("testing", "testcasesketch", name).slug;

  it("treats dots, slashes and braces as word breaks, and the root path as 'root'", () => {
    expect(slug("Node.js")).toBe("node-js");
    expect(slug("v1.2.3")).toBe("v1-2-3");
    expect(slug("PetTypeRepository.findPetTypes")).toBe("pet-type-repository-find-pet-types");
    expect(slug("GET /owners/{ownerId}")).toBe("get-owners-owner-id");
    expect(slug("GET /")).toBe("get-root");
    expect(slug("GET /*")).toBe("get");
    expect(slug("src/utils/graphDegree")).toBe("src-utils-graph-degree");
  });

  it("prefixes a slug that starts with a digit, and says so (#1212)", () => {
    const derived = deriveElementId("application", "applicationcomponent", "3D Object Effect");
    expect(derived.id).toBe("application.applicationcomponent.n-3d-object-effect");
    expect(derived.notes).toEqual([
      "The name starts with a digit and an id must start with a letter, so the id is prefixed with 'n-'.",
    ]);
    expect(slug("2FA Enrollment")).toBe("n-2fa-enrollment");
    expect(slug("404 for an unknown route")).toBe("n-404-for-an-unknown-route");
    expect(deriveElementId("api", "operation", "Create Order").notes).toEqual([]);
  });

  it("always gives an id the element schema's pattern accepts, or an empty slug", () => {
    const pattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
    const names = ["3D", "2FA", "4K Video", "007", "1.2.3", "_private", "$scope", "a", "Ünïcode Name", "x".repeat(300), "9".repeat(300)];
    for (const name of names) {
      expect(deriveElementId("application", "applicationcomponent", name).id).toMatch(pattern);
    }
    expect(deriveElementId("application", "applicationcomponent", "!!!").slug).toBe("");
    expect(deriveElementId("application", "applicationcomponent", "日本語").slug).toBe("");
  });

  it("cuts a long name at a word break and ends it with a hash of the whole, and says so", () => {
    const base = "changeset commit preview refuses to land a verification record even when the caller passes force and the plan it verifies has landed";
    const a = deriveElementId("testing", "testcasesketch", `${base} already`);
    const b = deriveElementId("testing", "testcasesketch", `${base} twice`);
    expect(a.slug.length).toBeLessThanOrEqual(MAX_ID_SLUG + 9);
    expect(a.slug).toMatch(/^changeset-commit-preview-refuses-.*-[0-9a-f]{8}$/);
    expect(a.slug).not.toBe(b.slug);
    expect(a.slug.slice(0, -8)).toBe(b.slug.slice(0, -8));
    // The note says the id was shortened, and from what.
    expect(a.notes).toEqual([
      "The id is shortened: the name is 140 characters as an id and an id keeps 100, so it is cut at a word and ends with a hash of the whole. The element keeps its full name.",
    ]);
    // Stable: the same name gives the same id every time.
    expect(deriveElementId("testing", "testcasesketch", `${base} already`).id).toBe(a.id);
  });

  it("gives model_add's id and extraction's id from the same name", () => {
    const names = [
      "renders the panel",
      "Tier1Status",
      "GET /",
      "GET /owners/{ownerId}/pets",
      "PetTypeRepository.findPetTypes",
      "src/apps/embedded/data/useModel",
      "3D Object Effect",
      "stages the valid items in one write, one sequence number each, and reports every item even when the batch is large and slow",
    ];
    for (const name of names) {
      expect(generateElementId("testing", "testcasesketch", name)).toBe(extractedElementId("testing", "testcasesketch", name));
    }
  });
});

describe("deriveElementId notes", () => {
  it("says when the id is not the name's plain kebab case, and nothing otherwise", () => {
    const notes = (name: string) => deriveElementId("api", "operation", name).notes;
    expect(notes("Node.js")).toEqual(["Dots, slashes and braces in the name are word breaks in the id."]);
    expect(notes("GET /owners/{ownerId}")).toEqual(["Dots, slashes and braces in the name are word breaks in the id."]);
    expect(notes("GET /")).toEqual(["A route on the root path gets an id that ends in -root."]);
    for (const name of ["Create Order", "GraphLayoutSnapshot", "Tier1Status", "customer_management", "PetTypeRepository.findPetTypes"]) {
      expect(notes(name)).toEqual([]);
    }
  });
});

describe("ids that differ only by hyphens", () => {
  it("elementUnderEarlierId finds the same-named element whose id differs only by hyphens", () => {
    const elements = [
      { id: "data-model.objectschema.tier1status", name: "Tier1Status" },
      { id: "data-model.objectschema.tier-1-panel", name: "Tier 1 Panel" },
      { id: "application.applicationfunction.tier1status", name: "Tier1Status" },
    ];
    expect(elementUnderEarlierId("data-model.objectschema.tier1-status", "Tier1Status", elements)).toBe(elements[0]);
    // Another name under a near id is another element; so is the same name in another layer.
    expect(elementUnderEarlierId("data-model.objectschema.tier1-panel", "Tier1Panel", elements)).toBeUndefined();
    expect(elementUnderEarlierId("api.operation.tier1-status", "Tier1Status", elements)).toBeUndefined();
    // The exact id is not an earlier id.
    expect(elementUnderEarlierId("data-model.objectschema.tier1status", "Tier1Status", elements)).toBeUndefined();
  });

  it("compactId ignores hyphens and case in the type and name, not the layer", () => {
    expect(compactId("data-model.objectschema.tier1-status")).toBe("data-model.objectschema.tier1status");
    expect(compactId("data-model.objectschema.tier1status")).toBe("data-model.objectschema.tier1status");
    expect(compactId("data-model.object-schema.Tier1Status")).toBe("data-model.objectschema.tier1status");
    expect(compactId("Tier1Status")).toBeUndefined();
  });

  it("nearDuplicateId names the same-named element as existing, and warns about another name", () => {
    const near = [{ id: "data-model.objectschema.tier1status", name: "Tier1Status" }];
    expect(nearDuplicateId("data-model.objectschema.tier1-status", "Tier1Status", near)).toEqual({
      existing: "data-model.objectschema.tier1status",
    });
    expect(nearDuplicateId("data-model.objectschema.tier1-status", "Tier 1 Status", near).warning).toContain(
      "differs only by hyphens from data-model.objectschema.tier1status"
    );
    expect(nearDuplicateId("data-model.objectschema.tier1-status", "Tier1Status", [])).toEqual({});
  });
});
