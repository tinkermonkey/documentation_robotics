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
import { validateSourceReferenceOptions } from "../../../src/utils/source-reference.js";
import { schemaLookupHint } from "../../../src/utils/error-hints.js";
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
  it("model_add without sourceProvenance names the parameter, not the CLI flag", async () => {
    await withProject(async (rootPath) => {
      const result = await modelAddHandler({
        layer: "business",
        type: "businessservice",
        name: "payments",
        sourceFile: "src/payments.ts",
        rootPath,
      });
      expect(result.isError).toBe(true);
      const body = parse(result);
      expect(body.error).toContain("sourceProvenance is required");
      expect(text(body)).not.toContain("--source");
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
      validateSourceReferenceOptions({ sourceFile: "src/a.ts" });
      throw new Error("expected a CLIError");
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError);
      expect((error as Error).message).toContain("--source-provenance is required");
    }
  });

  it("schemaLookupHint names a dr schema command that exists", () => {
    expect(schemaLookupHint("cli", "api", "operation")).toContain('"dr schema node api.operation"');
    expect(schemaLookupHint("mcp", "api", "operation")).toContain('"spec_type"');
  });
});
