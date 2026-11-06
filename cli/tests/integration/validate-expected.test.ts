/**
 * `dr validate --expected`: connections the spec expects are reported as warnings, opt-in, and
 * never fail validation, not even with --strict.
 *
 * Uses the bundled seed expectation `application.applicationfunction.performed-by`.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../src/core/model.js";
import { clearModelCache } from "../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../src/mcp/tools/model-add.js";
import { relationshipAddHandler } from "../../src/mcp/tools/relationship-tools.js";

const cliPath = join(import.meta.dir, "../../dist/cli.js");
let rootPath: string;

function validate(...flags: string[]) {
  const run = spawnSync("node", [cliPath, "validate", ...flags], { cwd: rootPath, encoding: "utf-8" });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

beforeAll(async () => {
  clearModelCache();
  rootPath = join(tmpdir(), `dr-validate-expected-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "Validate Expected Test Model", version: "0.1.0" });
  const source = { sourceFile: "src/orders.ts", sourceProvenance: "manual" as const, description: "Test element." };
  for (const args of [
    { layer: "application", type: "applicationservice", name: "orders", attributes: { serviceType: "synchronous" }, ...source },
    { layer: "application", type: "applicationfunction", name: "export-orders", ...source },
  ]) {
    const result = await modelAddHandler({ ...args, rootPath });
    if (result.isError) throw new Error((result.content[0] as { text: string }).text);
  }
  // The function realizes the service (so neither is orphaned), but no component performs it.
  const rel = await relationshipAddHandler({
    source: "application.applicationfunction.export-orders",
    predicate: "realizes",
    target: "application.applicationservice.orders",
    rootPath,
  });
  if (rel.isError) throw new Error((rel.content[0] as { text: string }).text);
  // A cross-layer connection: an api operation realizing the application function.
  const op = await modelAddHandler({
    layer: "api",
    type: "operation",
    name: "create-order",
    attributes: { operationId: "createOrder", summary: "Create an order", tags: "orders" },
    ...source,
    rootPath,
  });
  if (op.isError) throw new Error((op.content[0] as { text: string }).text);
  const realizes = await relationshipAddHandler({
    source: "api.operation.create-order",
    predicate: "realizes",
    target: "application.applicationfunction.export-orders",
    rootPath,
  });
  if (realizes.isError) throw new Error((realizes.content[0] as { text: string }).text);
  clearModelCache();
});

afterAll(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("dr validate --expected", () => {
  it("does not report expected connections without the flag", () => {
    const { output } = validate("--verbose");
    expect(output).not.toContain("lacks an expected connection");
  });

  it("reports them as warnings with the flag", () => {
    const { output } = validate("--expected", "--verbose");
    expect(output).toContain(
      "Element 'application.applicationfunction.export-orders' lacks an expected connection"
    );
  });

  it("with --layers, still counts connections to layers it did not load for validation", () => {
    // Without --layers the operation's realizes link meets api.operation.backed-by.
    expect(validate("--expected", "--verbose").output).not.toContain(
      "Element 'api.operation.create-order' lacks an expected connection"
    );
    // With --layers api the application layer is not validated, but the link still counts,
    // and only api elements are reported.
    const { output } = validate("--layers", "api", "--expected", "--verbose");
    expect(output).not.toContain("Element 'api.operation.create-order' lacks an expected connection");
    expect(output).not.toContain("Element 'application.applicationfunction.export-orders' lacks");
  });

  it("does not let --strict turn them into a failure", () => {
    const { status, output } = validate("--expected", "--strict");
    expect(output).not.toContain("treating warnings as errors");
    expect(status).toBe(0);
  });
});
