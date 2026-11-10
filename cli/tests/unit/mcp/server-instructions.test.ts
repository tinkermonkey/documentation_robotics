/**
 * The server instructions are the agent's map of the tools: they must fit Claude Code's cap and
 * name only tools the server registers.
 */

import { describe, expect, it } from "bun:test";
import { SERVER_INSTRUCTIONS } from "../../../src/mcp/server-instructions.js";
import { registeredToolNames } from "../../../src/mcp/tool-registry.js";

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
});
