/**
 * Tier 0's attributes for a Spring controller typed as an application interface (Context Studio
 * 43f52ae5): the protocol is HTTP, never REST, and only a @RestController is known to be an API.
 */
import { describe, it, expect } from "bun:test";
import { deriveAttributes } from "@/analyzers/extraction-plan";
import type { ExtractedSymbol } from "@/analyzers/cards/extract";

function controller(decorators: string[]): ExtractedSymbol {
  return {
    qualifiedName: "p.src.main.java.owner.OwnerController",
    card: { id: "src/main/java/owner/OwnerController.java#OwnerController", name: "OwnerController", label: "Class" },
    facts: { decorators, decorator_names: decorators, file_importers: 0, methods: 0, usage_files: 0 },
    tier0: null,
  } as unknown as ExtractedSymbol;
}

describe("deriveAttributes for application.applicationinterface", () => {
  it("gives a @RestController interfaceType api and protocol HTTP", () => {
    expect(deriveAttributes("application", "applicationinterface", controller(["RestController"]))).toEqual({
      facts: {},
      defaults: { interfaceType: "api", protocol: "HTTP" },
    });
  });

  it("gives a plain @Controller protocol HTTP and leaves its interfaceType open", () => {
    expect(deriveAttributes("application", "applicationinterface", controller(["Controller"]))).toEqual({
      facts: {},
      defaults: { protocol: "HTTP" },
    });
  });
});
