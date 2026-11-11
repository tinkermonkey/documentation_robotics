/**
 * Tools are registered strict: an argument a tool doesn't take is refused, not dropped, with a
 * suggestion for the one probably meant (`changeset` and `changesetId` are spelled differently
 * across tools). Every tool takes the optional rootPath.
 */

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { registeredInputSchema, unknownArgumentsMessage } from "../../../src/mcp/tool-registry.js";

const BRIEF = { changesetId: z.string().optional(), sections: z.array(z.string()).optional(), rootPath: z.string().optional() };
const COMMIT = { changeset: z.string(), force: z.boolean().optional() };
const NO_ARGS = {};

function refusal(schema: z.ZodType, args: unknown): string | undefined {
  const result = schema.safeParse(args);
  return result.success ? undefined : result.error.issues.map((issue) => issue.message).join(" | ");
}

describe("registeredInputSchema", () => {
  it("accepts calls that use only the tool's arguments", () => {
    const schema = registeredInputSchema("changeset_brief", BRIEF);
    expect(schema.safeParse({ changesetId: "x", sections: ["gaps"] }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("refuses changeset for changesetId, and the other way round, even when the meant one is required", () => {
    expect(refusal(registeredInputSchema("changeset_brief", BRIEF), { changeset: "x" })).toBe(
      "changeset_brief doesn't take 'changeset' (did you mean 'changesetId' for 'changeset'?). It takes: changesetId, sections, rootPath."
    );
    expect(refusal(registeredInputSchema("changeset_commit", COMMIT), { changesetId: "x" })).toContain(
      "did you mean 'changeset' for 'changesetId'"
    );
  });

  it("gives every tool the optional rootPath", () => {
    const schema = registeredInputSchema("spec_type", { layer: z.string() });
    expect(schema.safeParse({ layer: "api", rootPath: "/p" }).success).toBe(true);
    expect(refusal(registeredInputSchema("chat_status", NO_ARGS), { verbose: true })).toBe(
      "chat_status doesn't take 'verbose'. It takes: rootPath."
    );
  });

  it("still checks the types of the arguments it knows", () => {
    expect(registeredInputSchema("changeset_brief", BRIEF).safeParse({ changesetId: 5 }).success).toBe(false);
  });

  it("tells clients in its JSON schema that no other argument is accepted", () => {
    const json = z.toJSONSchema(registeredInputSchema("changeset_brief", BRIEF)) as Record<string, unknown>;
    expect(json.additionalProperties).toBe(false);
    expect(Object.keys(json.properties as object)).toEqual(["changesetId", "sections", "rootPath"]);
  });
});

describe("unknownArgumentsMessage", () => {
  it("lists the arguments the tool takes when it has no guess", () => {
    expect(unknownArgumentsMessage("changeset_brief", ["changesetId", "rootPath"], ["verbose"])).toBe(
      "changeset_brief doesn't take 'verbose'. It takes: changesetId, rootPath."
    );
  });
});

describe("strict arguments inside arrays and nested objects (round 3)", () => {
  // Round 3 found keys inside array items still dropped: model_add staged an element with a
  // misspelled sourceSymbl and no symbol, with no warning.
  it("refuses a key an elements[] item doesn't take, with the likely match", async () => {
    const { modelAddTool } = await import("../../../src/mcp/tools/model-add.js");
    const message = refusal(registeredInputSchema("model_add", modelAddTool.inputSchema), {
      elements: [{ layer: "application", type: "applicationcomponent", name: "C", sourceFile: "x.ts", sourceSymbl: "C" }],
    });
    expect(message).toContain("An elements[] item doesn't take 'sourceSymbl' (did you mean 'sourceSymbol' for 'sourceSymbl'?)");
    expect(message).toContain("It takes: layer, type, name,");
  });

  it("refuses unknown keys in relationship_add items, changeset_unstage changes, codebase_extract rejects and changeset_verify's against", async () => {
    const tools = await import("../../../src/mcp/tools/index.js");
    const rel = refusal(registeredInputSchema("relationship_add", tools.relationshipAddTool.inputSchema), {
      relationships: [{ source: "a.b.c", predicate: "serves", target: "d.e.f", props: {} }],
    });
    expect(rel).toContain("A relationships[] item doesn't take 'props'");
    const unstage = refusal(registeredInputSchema("changeset_unstage", tools.changesetUnstageTool.inputSchema), {
      changes: [{ element: "a.b.c" }],
    });
    expect(unstage).toContain("A changes[] item doesn't take 'element'");
    const reject = refusal(registeredInputSchema("codebase_extract", tools.codebaseExtractTool.inputSchema), {
      reject: [{ card: "x", reason: "y", why: "z" }],
    });
    expect(reject).toContain("A reject[] item doesn't take 'why'");
    const verify = refusal(registeredInputSchema("changeset_verify", tools.changesetVerifyTool.inputSchema), {
      against: { base: true, extract: true },
    });
    expect(verify).toContain("against doesn't take 'extract' (did you mean 'extracted' for 'extract'?)");
  });

  it("still accepts well-formed items", async () => {
    const { modelAddTool } = await import("../../../src/mcp/tools/model-add.js");
    const schema = registeredInputSchema("model_add", modelAddTool.inputSchema);
    expect(
      schema.safeParse({ elements: [{ layer: "api", type: "operation", name: "Get", sourceFile: "a.ts", sourceSymbol: "get" }] }).success
    ).toBe(true);
  });

  it("suggests a name a couple of letters away, not just an Id suffix", () => {
    expect(unknownArgumentsMessage("changeset_brief", ["changesetId", "sections", "rootPath"], ["section"])).toContain(
      "did you mean 'sections' for 'section'?"
    );
    expect(unknownArgumentsMessage("changeset_brief", ["changesetId", "sections", "rootPath"], ["verbose"])).not.toContain("did you mean");
  });
});
