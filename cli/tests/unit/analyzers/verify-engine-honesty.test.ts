/**
 * The API check never reports "in step" or "in the model only" for what it could not check
 * (#1180): every operation no route matched ends in in_model_only with a reason, in not_indexed, or
 * in not_checked with why and what would make it checkable. Routes an OpenAPI file declares are
 * compared with the operations sourced to that file, and a route recorded as not an element
 * (codebase_extract reject) is not in the code only.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VerifyEngine, apiLayerReport, IN_CODE_ONLY_HINT, type DiscoveredRoute } from "@/analyzers/verify-engine.js";
import { decisionKey } from "@/analyzers/extraction-plan.js";

let root: string;

interface Operation {
  name: string;
  method?: string;
  path?: string;
  file?: string;
  symbol?: string;
}

async function writeModel(operations: Operation[]): Promise<void> {
  const modelDir = join(root, "documentation-robotics", "model");
  await mkdir(join(modelDir, "07_api"), { recursive: true });
  await writeFile(join(modelDir, "manifest.yaml"), `project:\n  name: "Honest verify"\n  version: "0.1.0"\nspec_version: "0.6.0"\n`);
  const yaml = operations
    .map((op) =>
      [
        `${op.name}:`,
        `  id: "uuid-${op.name}"`,
        `  path: "api.operation.${op.name}"`,
        `  type: "operation"`,
        `  name: "${op.name}"`,
        `  layer_id: "api"`,
        ...(op.file
          ? [`  source_reference:`, `    provenance: "extracted"`, `    locations:`, `      - file: "${op.file}"`, ...(op.symbol ? [`        symbol: "${op.symbol}"`] : [])]
          : []),
        ...(op.method ? [`  attributes:`, `    http_method: "${op.method}"`, `    http_path: "${op.path}"`] : []),
      ].join("\n")
    )
    .join("\n");
  await writeFile(join(modelDir, "07_api", "operations.yaml"), `${yaml}\n`);
}

async function file(relative: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, relative)), { recursive: true });
  await writeFile(join(root, relative), text);
}

const declared = (method: string, path: string): DiscoveredRoute => ({
  id: `__route__${method}__${path}`,
  http_method: method,
  http_path: path,
  source_file: "docs/api-spec.yaml",
  source_symbol: "",
});

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "dr-verify-honest-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("API check on a frontend: routes described only by an OpenAPI file (#1180)", () => {
  it("compares the operations sourced to the OpenAPI file with the routes it declares", async () => {
    await writeModel([
      { name: "get-model", method: "GET", path: "/api/model", file: "docs/api-spec.yaml", symbol: "GET /api/model" },
      // The model names the parameter; the analyzer gives it as {}.
      { name: "get-layer", method: "GET", path: "/api/layers/{layerName}", file: "docs/api-spec.yaml", symbol: "GET /api/layers/{layerName}" },
      // No longer in the description.
      { name: "delete-layer", method: "DELETE", path: "/api/layers/{layerName}", file: "docs/api-spec.yaml", symbol: "DELETE /api/layers/{layerName}" },
    ]);
    await file("docs/api-spec.yaml", "openapi: 3.0.0\n");

    const report = await new VerifyEngine().computeReport(root, [], { changesetAware: false, layers: ["api"] }, "cbm", undefined, undefined, {
      declaredRoutes: [declared("GET", "/api/model"), declared("GET", "/api/layers/{}"), declared("POST", "/api/annotations")],
    });

    expect(report.buckets.matched.map((m) => [m.path, m.declared_in])).toEqual([
      ["api.operation.get-model", "docs/api-spec.yaml"],
      ["api.operation.get-layer", "docs/api-spec.yaml"],
    ]);
    expect(report.buckets.in_graph_only.map((g) => [g.http_method, g.http_path, g.declared_in])).toEqual([["POST", "/api/annotations", "docs/api-spec.yaml"]]);
    expect(report.buckets.in_model_only.map((e) => [e.path, e.reason])).toEqual([
      ["api.operation.delete-layer", "docs/api-spec.yaml doesn't declare it (any more)"],
    ]);
    // Every one of them has a source reference: none is counted as lacking one.
    expect(report.summary).toMatchObject({ matched_count: 2, gap_count: 1, drift_count: 1, elements_without_source_ref: 0, elements_not_checked: 0, total_model_entries: 3 });

    const layer = apiLayerReport(report);
    expect(layer.status).toBe("drifted");
    expect(layer.coverage).toEqual({ model_elements: 3, checked: 3, not_checked: 0, code_entries: 3 });
    // A match against a description is not a claim that code serves the route.
    expect(layer.status_text).toContain("does not show that code here serves them");
    // Elements are named by their dotted id, not a UUID.
    expect(layer.buckets.in_model_only.map((e) => e.id)).toEqual(["api.operation.delete-layer"]);
  });

  it("says in step when every operation is declared, and not checked when the analyzer read no description", async () => {
    await writeModel([{ name: "get-model", method: "GET", path: "/api/model", file: "docs/api-spec.yaml", symbol: "GET /api/model" }]);
    await file("docs/api-spec.yaml", "openapi: 3.0.0\n");
    const engine = new VerifyEngine();

    const withSpec = apiLayerReport(
      await engine.computeReport(root, [], { changesetAware: false }, "cbm", undefined, undefined, { declaredRoutes: [declared("GET", "/api/model")] })
    );
    expect(withSpec.status).toBe("in_step");
    // In step with the description, which is all that was compared: not a claim about served code.
    expect(withSpec.status_text).toBe(
      "Checked 1 of the model's 1 API operations: in step with the API description (docs/api-spec.yaml), which declares each of them. " +
        "That does not show that code here serves them."
    );

    // The analyzer read no route from the file (not indexed, or not an API description): the
    // operation was not checked. It used to be counted under elements_without_source_ref.
    const report = await engine.computeReport(root, [], { changesetAware: false });
    expect(report.summary).toMatchObject({ elements_without_source_ref: 0, elements_not_checked: 1, drift_count: 0 });
    const without = apiLayerReport(report);
    expect(without.status).toBe("not_checked");
    expect(without.status_text).toContain("none of the model's 1 API operations could be compared");
    expect(without.not_checked).toEqual([
      {
        reason: "sourced to a file that is neither source code nor an API description the analyzer read routes from",
        to_check: expect.stringContaining("OpenAPI file inside the indexed tree"),
        count: 1,
        ids: ["api.operation.get-model"],
      },
    ]);
  });

  it("says what each match was compared with when some are served by code and some only declared", async () => {
    await writeModel([
      { name: "get-users", method: "GET", path: "/users", file: "src/users.ts", symbol: "listUsers" },
      { name: "get-model", method: "GET", path: "/api/model", file: "docs/api-spec.yaml", symbol: "GET /api/model" },
    ]);
    await file("src/users.ts", "export function listUsers() {}\n");
    await file("docs/api-spec.yaml", "openapi: 3.0.0\n");
    const routes: DiscoveredRoute[] = [{ id: "r", http_method: "GET", http_path: "/users", source_file: "src/users.ts", source_symbol: "listUsers" }];
    const layer = apiLayerReport(
      await new VerifyEngine().computeReport(root, routes, { changesetAware: false }, "cbm", undefined, undefined, { declaredRoutes: [declared("GET", "/api/model")] })
    );
    expect(layer.status).toBe("in_step");
    // "In step with the code" is never said of a match against a description, which may be stale.
    expect(layer.status_text).toBe(
      "Checked 2 of the model's 2 API operations: in step: 1 with routes the code serves, and 1 with routes an API description declares " +
        "(docs/api-spec.yaml), which does not show that code here serves those."
    );
    expect(layer.status_text).not.toContain("in step with the code");
  });

  it("never lets a route that only the description declares stand for an operation sourced to code", async () => {
    await writeModel([{ name: "get-model", method: "GET", path: "/api/model", file: "src/server.ts", symbol: "getModel" }]);
    await file("src/server.ts", "export const other = 1;\n");
    const report = await new VerifyEngine().computeReport(root, [], { changesetAware: false }, "cbm", undefined, undefined, {
      declaredRoutes: [declared("GET", "/api/model")],
    });
    expect(report.buckets.matched).toEqual([]);
    // Not in the code only either: the model has an operation for it.
    expect(report.buckets.in_graph_only).toEqual([]);
    // The analyzer reads no route from that file: for the agent to check, not drift (#1321).
    expect(report.buckets.in_model_only).toEqual([]);
    expect(report.buckets.not_checked!.flatMap((g) => g.ids)).toEqual(["api.operation.get-model"]);
  });
});

describe("operations sourced to code the analyzer reads no route from", () => {
  it("is not checked, never drift, whether or not the file still names the route (#1321)", async () => {
    await writeModel([
      { name: "get-ws", method: "GET", path: "/ws", file: "src/server.ts", symbol: "GET /ws" },
      { name: "post-mcp", method: "POST", path: "/mcp", file: "src/server.ts", symbol: "GET /mcp" },
      { name: "get-handler", file: "src/server.ts", symbol: "Server.listUsers" },
      { name: "get-root", method: "GET", path: "/", file: "src/server.ts", symbol: "GET /" },
    ]);
    await file("src/server.ts", 'app.get("/ws", upgrade);\nclass Server { listUsers() {} }\napp.get("/", home);\n');

    const report = await new VerifyEngine().computeReport(root, [], { changesetAware: false });
    expect(report.buckets.in_model_only).toEqual([]);
    const groups = report.buckets.not_checked!;
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(4);
    const unnamed = groups.find((g) => g.ids.includes("api.operation.post-mcp"))!;
    expect(unnamed.reason).toContain("no longer names its path");
    expect(unnamed.to_check).toContain("check by hand whether the route is still served");
    const named = groups.find((g) => g.ids.includes("api.operation.get-ws"))!;
    expect(named.ids).toEqual(["api.operation.get-ws", "api.operation.get-handler", "api.operation.get-root"]);
    expect(unnamed.ids).toEqual(["api.operation.post-mcp"]);
    expect(named.to_check).toContain("check these routes in the code by hand");
    const layer = apiLayerReport(report);
    expect(layer.status).not.toBe("drifted");
    expect(layer.coverage).toEqual({ model_elements: 4, checked: 0, not_checked: 4, code_entries: 0 });
  });

  it("is not checked in a hand-routed file whose reading is partial, even when it has some routes", async () => {
    await writeModel([
      { name: "get-health", method: "GET", path: "/health", file: "src/gateway.ts", symbol: "GET /health" },
      { name: "post-revert", method: "POST", path: "/api/projects/{id}/revert", file: "src/gateway.ts", symbol: "POST /api/projects/{id}/revert" },
    ]);
    await file("src/gateway.ts", "// routes by regex\n");
    const routes: DiscoveredRoute[] = [{ id: "src/gateway.ts:GET /health", http_method: "GET", http_path: "/health", source_file: "src/gateway.ts", source_symbol: "GET /health" }];
    const report = await new VerifyEngine().computeReport(root, routes, { changesetAware: false }, undefined, undefined, undefined, { partialFiles: new Set(["src/gateway.ts"]) });
    expect(report.buckets.matched.map((m) => m.path)).toEqual(["api.operation.get-health"]);
    expect(report.buckets.in_model_only).toEqual([]);
    expect(report.buckets.not_checked!.flatMap((g) => g.ids)).toEqual(["api.operation.post-revert"]);
  });

  it("is drift in a file the analyzer does read routes from", async () => {
    await writeModel([
      { name: "get-users", method: "GET", path: "/users", file: "src/users.ts", symbol: "listUsers" },
      { name: "delete-user", method: "DELETE", path: "/users/{id}", file: "src/users.ts", symbol: "deleteUser" },
    ]);
    await file("src/users.ts", "export function listUsers() {}\nexport function deleteUser() {}\n");
    const routes: DiscoveredRoute[] = [{ id: "src/users.ts:listUsers", http_method: "GET", http_path: "/users", source_file: "src/users.ts", source_symbol: "listUsers" }];
    const report = await new VerifyEngine().computeReport(root, routes, { changesetAware: false });
    expect(report.buckets.matched.map((m) => m.path)).toEqual(["api.operation.get-users"]);
    expect(report.buckets.in_model_only.map((e) => [e.path, e.reason])).toEqual([
      ["api.operation.delete-user", "the analyzer reads routes from its source file and none is this one"],
    ]);
    expect(report.buckets.not_checked).toBeUndefined();
  });

  it("matches a route whose path names its parameters differently from the model", async () => {
    await writeModel([{ name: "get-owner", method: "GET", path: "/owners/{ownerId}", file: "src/owners.ts", symbol: "OwnerController.show" }]);
    await file("src/owners.ts", "class OwnerController { show() {} }\n");
    const routes: DiscoveredRoute[] = [{ id: "r", http_method: "GET", http_path: "/owners/{id}", source_file: "src/owners.ts", source_symbol: "showOwner" }];
    const report = await new VerifyEngine().computeReport(root, routes, { changesetAware: false });
    expect(report.buckets.matched.map((m) => m.path)).toEqual(["api.operation.get-owner"]);
    expect(report.buckets.in_graph_only).toEqual([]);
  });

  it("lists an operation with no source reference as not checked, with what would make it checkable", async () => {
    await writeModel([{ name: "documented-only" }]);
    const report = await new VerifyEngine().computeReport(root, [], { changesetAware: false });
    expect(report.summary).toMatchObject({ elements_without_source_ref: 1, elements_not_checked: 0, total_model_entries: 1 });
    expect(report.buckets.not_checked?.[0]).toMatchObject({ count: 1, ids: ["api.operation.documented-only"] });
    expect(report.buckets.not_checked?.[0].to_check).toContain("sourceFile and sourceSymbol");
    expect(apiLayerReport(report).status).toBe("not_checked");
  });
});

describe("routes recorded as not elements, and hints", () => {
  const fixture: DiscoveredRoute = {
    id: "fixtures/backend/main.py:list_todos",
    http_method: "GET",
    http_path: "/todos/{todo_id}",
    source_file: "fixtures/backend/main.py",
    source_symbol: "list_todos",
  };
  const product: DiscoveredRoute = { id: "src/api.ts:health", http_method: "GET", http_path: "/health", source_file: "src/api.ts", source_symbol: "health" };

  it("leaves a rejected route out of the code-only bucket, and says why under ignored", async () => {
    await writeModel([]);
    const report = await new VerifyEngine().computeReport(root, [fixture, product], { changesetAware: false }, "cbm", undefined, undefined, {
      // As codebase_extract keys it: the file, and the route with its parameters unnamed.
      notElements: new Set([decisionKey("fixtures/backend/main.py", "GET /todos/{}")]),
    });
    expect(report.buckets.in_graph_only.map((g) => g.id)).toEqual(["src/api.ts:health"]);
    expect(report.buckets.ignored).toEqual([
      { id: "fixtures/backend/main.py:list_todos", entry_type: "route", reason: "recorded as not an element (codebase_extract reject)" },
    ]);
  });

  it("gives a hint that names no deprecated command", async () => {
    await writeModel([]);
    const report = await new VerifyEngine().computeReport(root, [product], { changesetAware: false });
    expect(report.hints).toEqual([IN_CODE_ONLY_HINT]);
    expect(report.hints!.join(" ")).not.toContain("/dr-map");
    expect(report.hints!.join(" ")).not.toContain("dr analyzer endpoints");
    expect(report.hints!.join(" ")).not.toContain("dr add");
  });
});
