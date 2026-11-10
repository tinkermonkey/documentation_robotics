/**
 * MCP errors name MCP parameters and tools, CLI errors keep flags (dogfood bug 7):
 * model_add without sourceProvenance said "--source-provenance is required", and attribute
 * errors pointed at "model_info ... spec resource" instead of the spec_type tool.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { specTypeTool } from "../../../src/mcp/tools/spec-type.js";
import { resolveSourceReferenceOptions, validateSourceReferenceOptions } from "../../../src/utils/source-reference.js";
import { schemaLookupHint, undefinedTypeWarning } from "../../../src/utils/error-hints.js";
import { updateCommand } from "../../../src/commands/update.js";
import { reloadModel } from "../../../src/mcp/tools/shared.js";
import { CLIError } from "../../../src/utils/errors.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

function text(body: any): string {
  return [body.error, ...(body.suggestions ?? [])].join("\n");
}

async function withProject(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = join(tmpdir(), `dr-mcp-error-hints-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Error Hints Test Model", version: "0.1.0" });
  try {
    await fn(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

describe("MCP error hints", () => {
  it("model_add without sourceProvenance defaults it, and the warning names the parameter, not the CLI flag", async () => {
    await withProject(async (rootPath) => {
      const result = await modelAddHandler({
        layer: "business",
        type: "businessservice",
        name: "payments",
        sourceFile: "src/payments.ts",
        rootPath,
      });
      expect(result.isError).toBeFalsy();
      const body = parse(result);
      expect(body.warnings.join("\n")).toContain("sourceProvenance was not given; used 'manual'");
      expect(body.warnings.join("\n")).not.toContain("--source");
    });
  });

  it("model_add with a bad source symbol names sourceSymbol and sourceFile", async () => {
    await withProject(async (rootPath) => {
      const result = await modelAddHandler({
        layer: "business",
        type: "businessservice",
        name: "payments",
        sourceSymbol: "pay",
        sourceProvenance: "manual",
        rootPath,
      });
      expect(result.isError).toBe(true);
      const body = parse(result);
      expect(body.error).toContain("sourceSymbol requires sourceFile");
      expect(text(body)).not.toContain("--source");
    });
  });

  it("model_add attribute errors point at spec_type with arguments that work", async () => {
    await withProject(async (rootPath) => {
      const result = await modelAddHandler({ layer: "api", type: "operation", name: "broken", attributes: {}, rootPath });
      expect(result.isError).toBe(true);
      const body = parse(result);
      const hints = body.suggestions.join(" ");
      expect(hints).toContain('"spec_type"');
      expect(hints).toContain('layer "api"');
      expect(hints).toContain('type "operation"');
      expect(hints).not.toContain("spec resource");

      const spec = await specTypeTool.handler({ layer: "api", type: "operation" } as any);
      expect(spec.isError).toBeFalsy();
    });
  });

  it("model_update attribute errors point at spec_type", async () => {
    await withProject(async (rootPath) => {
      const added = await modelAddHandler({ layer: "business", type: "businessservice", name: "payments", rootPath });
      expect(added.isError).toBeFalsy();
      const result = await modelUpdateHandler({
        id: "business.businessservice.payments",
        attributes: { notAnAttribute: { nested: true } },
        rootPath,
      });
      expect(result.isError).toBe(true);
      const body = parse(result);
      expect(body.suggestions.join(" ")).toContain('"spec_type"');
      expect(body.suggestions.join(" ")).not.toContain("spec resource");
    });
  });

  it("relationship_delete with no match (no changeset) suggests MCP tools, not dr commands", async () => {
    await withProject(async (rootPath) => {
      await modelAddHandler({ layer: "business", type: "businessservice", name: "payments", rootPath });
      await modelAddHandler({ layer: "business", type: "businessservice", name: "orders", rootPath });
      const result = await relationshipDeleteHandler({
        source: "business.businessservice.payments",
        target: "business.businessservice.orders",
        rootPath,
      });
      expect(result.isError).toBe(true);
      const body = parse(result);
      expect(body.error).toContain("No matching relationships found");
      expect(body.suggestions.join(" ")).toContain("model_show");
      expect(body.suggestions.join(" ")).not.toContain('"dr ');
    });
  });
});

describe("CLI error hints keep flags and commands", () => {
  it("validateSourceReferenceOptions names CLI flags by default", () => {
    try {
      validateSourceReferenceOptions({ sourceSymbol: "pay", sourceProvenance: "manual" });
      throw new Error("expected a CLIError");
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError);
      expect((error as Error).message).toContain("--source-symbol requires --source-file");
    }
    const { warnings } = resolveSourceReferenceOptions({ sourceFile: "src/a.ts" });
    expect(warnings.join("\n")).toContain("--source-provenance was not given; used 'manual'");
  });

  it("schemaLookupHint names a dr schema command that exists", () => {
    expect(schemaLookupHint("cli", "api", "operation")).toContain('"dr schema node api.operation"');
    expect(schemaLookupHint("mcp", "api", "operation")).toContain('"spec_type"');
  });
});

/**
 * Review of PR #1022: the new undefined-type check made an attributes-only update to an element
 * of an obsolete type (heimdall's product.capability) fail, with a spec_type / dr schema hint on
 * the obsolete type that itself fails. The update now goes through with a warning naming the
 * type change.
 */
async function withObsoleteCapability(fn: (rootPath: string, id: string) => Promise<void>): Promise<void> {
  await withProject(async (rootPath) => {
    const added = await modelAddHandler({ layer: "product", type: "softwarecapability", name: "radial-tree-layout", attributes: { status: "proposed" }, rootPath });
    expect(added.isError).toBeFalsy();
    const id = "product.softwarecapability.radial-tree-layout";
    const model = await Model.load(rootPath);
    const layer = await model.getLayer("product");
    const elem = layer!.getElement(id)!;
    elem.type = "capability";
    elem.spec_node_id = "product.capability";
    layer!.updateElement(elem);
    await model.saveLayer("product");
    const reloaded = await Model.load(rootPath);
    expect((await reloaded.getLayer("product"))!.getElement(id)!.type).toBe("capability");
    await reloadModel(rootPath); // the MCP tools cache the model
    await fn(rootPath, id);
  });
}

describe("updates to an element of an obsolete type", () => {
  it("model_update with attributes only goes through and warns with the type change to make", async () => {
    await withObsoleteCapability(async (rootPath, id) => {
      const result = await modelUpdateHandler({ id, attributes: { status: "planned" }, rootPath });
      expect(result.isError).toBeFalsy();
      const body = parse(result);
      expect(body.status).toBe("updated");
      const warnings = body.warnings.join(" ");
      expect(warnings).toContain("'capability'");
      expect(warnings).toContain('Pass type "softwarecapability" to model_update');
      expect(warnings).not.toContain('"spec_type" with layer "product" and type "capability"');

      const model = await Model.load(rootPath);
      expect((await model.getLayer("product"))!.getElement(id)!.attributes).toEqual({ status: "planned" });
    });
  });

  it("the suggested type change over MCP works", async () => {
    await withObsoleteCapability(async (rootPath, id) => {
      const result = await modelUpdateHandler({ id, type: "softwarecapability", rootPath });
      expect(result.isError).toBeFalsy();
      expect(parse(result).warnings).toBeUndefined();
    });
  });

  it("dr update with attributes only goes through and warns with a dr update --type hint", async () => {
    await withObsoleteCapability(async (rootPath, id) => {
      const warned: string[] = [];
      const originalWarn = console.warn;
      const originalLog = console.log;
      console.warn = (...args: unknown[]) => warned.push(args.join(" "));
      console.log = () => {};
      try {
        await updateCommand(id, { model: rootPath, attributes: JSON.stringify({ status: "planned" }) });
      } finally {
        console.warn = originalWarn;
        console.log = originalLog;
      }
      const out = warned.join("\n");
      expect(out).toContain("'capability'");
      expect(out).toContain(`dr update ${id} --type softwarecapability`);
      expect(out).not.toContain("dr schema node product.capability");

      const model = await Model.load(rootPath);
      expect((await model.getLayer("product"))!.getElement(id)!.attributes).toEqual({ status: "planned" });
    });
  });

  it("undefinedTypeWarning falls back to listing the layer's types when nothing is close", () => {
    expect(undefinedTypeWarning("mcp", "product", "x", "zzz", []).hint).toContain('"spec_type" with layer "product" and no type');
    expect(undefinedTypeWarning("cli", "product", "x", "zzz", []).hint).toContain('"dr schema types product"');
  });
});
