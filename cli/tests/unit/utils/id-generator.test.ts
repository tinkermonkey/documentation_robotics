/**
 * toKebabCase and generateElementId. Bug 9 of the gateway validation: a dot between code-symbol
 * parts was dropped without a word break, so "PetTypeRepository.findPetTypes" became
 * "pet-type-repositoryfind-pet-types".
 */

import { describe, it, expect } from "bun:test";
import { generateElementId, toKebabCase } from "../../../src/utils/id-generator.js";

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
