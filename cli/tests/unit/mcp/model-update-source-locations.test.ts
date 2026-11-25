/**
 * model_update and an element's source locations (#1260): a source file set by hand is 'manual',
 * sourceFile replaces the locations, and addSourceLocation / removeSourceLocation add or remove one
 * without touching the others.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";

const ID = "application.applicationfunction.load-orders";

async function newProject(): Promise<string> {
  clearModelCache();
  const rootPath = join(tmpdir(), `dr-update-locations-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Update Locations", version: "0.1.0" });
  await modelAddHandler({
    layer: "application",
    type: "applicationfunction",
    name: "load-orders",
    sourceFile: "src/orders.ts",
    sourceSymbol: "loadOrders",
    sourceProvenance: "extracted",
    rootPath,
  });
  return rootPath;
}

const parse = (result: { content: Array<{ text?: string }> }) => JSON.parse(result.content[0].text!);

async function reference(rootPath: string) {
  clearModelCache();
  return parse(await modelShowHandler({ id: ID, rootPath })).element.source_reference;
}

async function inEachMode(fn: (rootPath: string) => Promise<void>): Promise<void> {
  for (const staged of [false, true]) {
    const rootPath = await newProject();
    try {
      if (staged) await changesetCreateHandler({ name: "plan", rootPath });
      await fn(rootPath);
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  }
}

describe("model_update and source locations (#1260)", () => {
  it("gives a source file set by hand 'manual', and replaces the locations with it", async () => {
    await inEachMode(async (rootPath) => {
      const result = parse(await modelUpdateHandler({ id: ID, sourceFile: "src/hooks/use-orders.ts", rootPath }));
      expect(result.changedFields).toContain("source_reference");
      expect(await reference(rootPath)).toEqual({ provenance: "manual", locations: [{ file: "src/hooks/use-orders.ts" }] });
    });
  });

  it("adds a second location beside the first, keeping the provenance", async () => {
    await inEachMode(async (rootPath) => {
      await modelUpdateHandler({ id: ID, addSourceLocation: { file: "src/hooks/use-orders.ts", symbol: "useOrders" }, rootPath });
      expect(await reference(rootPath)).toEqual({
        provenance: "extracted",
        locations: [
          { file: "src/orders.ts", symbol: "loadOrders" },
          { file: "src/hooks/use-orders.ts", symbol: "useOrders" },
        ],
      });
      // Never twice.
      const again = parse(
        await modelUpdateHandler({ id: ID, addSourceLocation: { file: "src/hooks/use-orders.ts", symbol: "useOrders" }, rootPath })
      );
      expect((await reference(rootPath)).locations.length).toBe(2);
      expect(again.status).not.toBe("invalid");
    });
  });

  it("removes one location, and the reference with its last one", async () => {
    await inEachMode(async (rootPath) => {
      await modelUpdateHandler({ id: ID, addSourceLocation: { file: "src/hooks/use-orders.ts" }, rootPath });
      await modelUpdateHandler({ id: ID, removeSourceLocation: { file: "src/orders.ts" }, rootPath });
      expect(await reference(rootPath)).toEqual({ provenance: "extracted", locations: [{ file: "src/hooks/use-orders.ts" }] });

      const last = parse(await modelUpdateHandler({ id: ID, removeSourceLocation: { file: "src/hooks/use-orders.ts" }, rootPath }));
      expect(last.warnings.join(" ")).toContain("its source reference was removed");
      expect(await reference(rootPath)).toBeUndefined();
    });
  });

  it("refuses a removal that matches nothing, naming the locations, and a location change beside sourceFile", async () => {
    const rootPath = await newProject();
    try {
      const nothing = await modelUpdateHandler({ id: ID, removeSourceLocation: { file: "src/elsewhere.ts" }, rootPath });
      expect(nothing.isError).toBe(true);
      expect(nothing.content[0].text).toContain("src/orders.ts#loadOrders");

      const both = await modelUpdateHandler({
        id: ID,
        sourceFile: "src/a.ts",
        addSourceLocation: { file: "src/b.ts" },
        rootPath,
      });
      expect(both.isError).toBe(true);
      expect(both.content[0].text).toContain("sourceFile replaces them all");
      expect(await reference(rootPath)).toEqual({ provenance: "extracted", locations: [{ file: "src/orders.ts", symbol: "loadOrders" }] });
    } finally {
      clearModelCache();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
