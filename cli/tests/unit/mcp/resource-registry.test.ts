/**
 * Unit tests for `readBundledSchema` (`cli/src/mcp/resource-registry.ts`) —
 * verifies missing bundled schema files produce an actionable error instead
 * of a raw ENOENT propagating to the MCP client.
 */

import { describe, it, expect } from "bun:test";
import { readBundledSchema } from "../../../src/mcp/resource-registry.js";

describe("readBundledSchema", () => {
  it("reads an existing bundled schema file", async () => {
    const text = await readBundledSchema("manifest.json");
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("translates a missing bundled schema file into an actionable error", async () => {
    await expect(readBundledSchema("does-not-exist.json")).rejects.toThrow(
      /Bundled schema "does-not-exist\.json" is missing.*npm run build.*cli\//s
    );
  });

  it("re-throws non-ENOENT errors unchanged", async () => {
    // A directory read via readFile fails with EISDIR, not ENOENT — the
    // pass-through branch should leave that error as-is rather than
    // reinterpreting it as a missing-file condition.
    let caught: unknown;
    try {
      await readBundledSchema("analyzers");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect((caught as Error).message).not.toContain("npm run build");
  });
});
