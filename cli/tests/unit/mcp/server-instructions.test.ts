/**
 * The server instructions are the agent's map of the tools: they must fit Claude Code's cap and
 * name only tools the server registers.
 */

import { describe, expect, it } from "bun:test";
import { SERVER_INSTRUCTIONS } from "../../../src/mcp/server-instructions.js";
import { registeredToolNames } from "../../../src/mcp/tool-registry.js";
import { reviewOpenTool } from "../../../src/mcp/tools/review-open.js";

const TOOL_GROUPS = /\b(?:model|changeset|relationship|spec|annotation|chat|project|codebase|review)_[a-z_]+\b/g;

describe("SERVER_INSTRUCTIONS", () => {
  it("fits within Claude Code's 4096-character cap on server instructions", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  it("names only registered tools", () => {
    const registered = new Set(registeredToolNames());
    const named = [...new Set(SERVER_INSTRUCTIONS.match(TOOL_GROUPS) ?? [])];
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((name) => !registered.has(name))).toEqual([]);
  });

  it("lands a change only when the user asks, and only with their confirmation", () => {
    expect(SERVER_INSTRUCTIONS).toContain("changeset_commit only when the user asks");
    expect(SERVER_INSTRUCTIONS).toContain("Never commit on your own initiative");
  });

  it("starts the session with project_status", () => {
    expect(SERVER_INSTRUCTIONS).toContain("Start with project_status");
  });

  it("has the agent confirm the model's name, bootstrap or grow, and the changeset's name and intent", () => {
    expect(SERVER_INSTRUCTIONS).toContain("Confirm with the user");
    expect(SERVER_INSTRUCTIONS).toContain("the model's name (project_init)");
    expect(SERVER_INSTRUCTIONS).toContain("bootstrap the model from the code now or grow it with each change");
    expect(SERVER_INSTRUCTIONS).toContain("a changeset's name and intent (changeset_create)");
  });

  it("waits on the index with wait: 30 rather than polling in a loop", () => {
    expect(SERVER_INSTRUCTIONS).toContain("codebase_index indexes in the background. Call it with wait: 30");
    expect(SERVER_INSTRUCTIONS).toContain("status: true and wait: 30");
    expect(SERVER_INSTRUCTIONS).not.toContain("about every 30 seconds");
  });

  it("stages many changes in one call", () => {
    expect(SERVER_INSTRUCTIONS).toContain("model_add with elements: [...]");
    expect(SERVER_INSTRUCTIONS).toContain('sourceProvenance: "extracted"');
    expect(SERVER_INSTRUCTIONS).toContain("relationship_add with relationships: [...]");
  });

  it("reads the compact brief, asking for detail only when needed", () => {
    expect(SERVER_INSTRUCTIONS).toContain('detail: "full"');
  });

  it("builds from the brief's layers, verifies against an extracted as-built, and answers comments", () => {
    expect(SERVER_INSTRUCTIONS).toContain('sections: ["layers"]');
    expect(SERVER_INSTRUCTIONS).toContain('unwired: "summary"');
    expect(SERVER_INSTRUCTIONS).toContain("never written by hand");
    expect(SERVER_INSTRUCTIONS).toContain("unverifiable items and notes need no plan edit");
    expect(SERVER_INSTRUCTIONS).toContain("answer with annotation_reply");
  });

  it("verifies only after the build is committed, and lands the plan, not the as-built (round 2)", () => {
    expect(SERVER_INSTRUCTIONS).toContain("Don't extract or verify during the build");
    expect(SERVER_INSTRUCTIONS).toContain("Verify as its own step, once the build is committed");
    expect(SERVER_INSTRUCTIONS).toContain("never written by hand or copied from the plan");
    expect(SERVER_INSTRUCTIONS).toContain("the as-built changeset is discarded or kept as a record, not landed");
    expect(SERVER_INSTRUCTIONS).toContain("Ask the user about cards you can't place, in one short list");
    expect(SERVER_INSTRUCTIONS).toContain("changeset_unstage (changes: [...] for several)");
  });

  it("review_open's description never sends the human to the CLI", () => {
    expect(reviewOpenTool.description).not.toContain("dr visualize");
    expect(reviewOpenTool.description).toContain("free local port");
  });

  it("says codebase_verify checks only the API layer", () => {
    expect(SERVER_INSTRUCTIONS).toContain("codebase_verify checks only the API layer");
  });

  it("names a dr command only as the commit fallback, after the viewer, in a form the CLI accepts", () => {
    // A dr subcommand is one of the CLI's command words; "dr command" and "run dr for" are prose.
    const commands = SERVER_INSTRUCTIONS.match(/\bdr (?:changeset|visualize|upgrade|init|analyzer|validate|add|update|claude)\b[^.,;]*/g) ?? [];
    expect(commands).toEqual(["dr changeset commit <name>"]);
    const fallback = SERVER_INSTRUCTIONS.indexOf("If it is refused");
    expect(SERVER_INSTRUCTIONS.indexOf("review_open, then Apply", fallback)).toBeLessThan(
      SERVER_INSTRUCTIONS.indexOf("dr changeset commit", fallback)
    );
    expect(SERVER_INSTRUCTIONS).not.toContain("dr changeset activate");
  });
});
