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
