/**
 * GET /api/tier1 (docs/analyzers/TIER1_DESIGN.md sections 4.3 and 7): Tier 1's state and spend
 * for the served project, from the same code as the tier1_status MCP tool. Read-only: no probe, no
 * request to a provider, no file written (not even `.dr/` when the project hasn't opted in), and
 * never a key or the account id, whether the keys are in tier1.json or the environment.
 *
 * No network and no real configuration: a temporary project, fake keys, an empty environment (or
 * one holding only fake keys), a fake git and a fixed clock, injected through the server's
 * `_testTier1Options` hook; `fetch` throws for the whole file.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { Model } from "../../../src/core/model.js";
import { tier1Paths } from "../../../src/analyzers/classifier/index.js";
import { createTier1StatusHandler } from "../../../src/mcp/tools/tier1-status.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { ChangeOriginSchema, Tier1StatusResponseSchema } from "../../../src/server/schemas.js";
import type { VisualizationServer } from "../../../src/server/server.js";
import { createServerWithoutChatDetection } from "./helpers.js";

const FAKE_ACCOUNT = "fake-account-0000ab12cd34ef56";
const FAKE_TOKEN = "fake-token-SECRET-never-returned-0123456789";
const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const AUTH_TOKEN = "test-viewer-token";

let rootPath: string;
let server: VisualizationServer | undefined;
const realFetch = globalThis.fetch;
let fetchCalls = 0;

beforeAll(() => {
  // A GET must never reach a provider: any fetch in this file is a failure.
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("no network in tests");
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  clearModelCache();
  fetchCalls = 0;
  const dir = join(tmpdir(), `dr-server-tier1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Tier1 REST Test", version: "0.1.0" });
});

afterEach(async () => {
  server?.stop();
  server = undefined;
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

const TEST_OPTIONS = (env: Record<string, string> = {}) => ({ env, git: () => null, now: () => NOW });

async function app(options: { auth?: boolean; env?: Record<string, string> } = {}) {
  const model = await Model.load(rootPath, { lazyLoad: false });
  server = createServerWithoutChatDetection(model, options.auth ? { authEnabled: true, authToken: AUTH_TOKEN } : { authEnabled: false });
  (server as any)._testTier1Options = TEST_OPTIONS(options.env);
  return (path: string, init?: RequestInit) => (server as any).app.request(path, init) as Promise<Response>;
}

/** The body of a 200, checked against the documented schema (strictly: no undocumented field) and scanned for secrets. */
async function body(response: Response): Promise<any> {
  const text = await response.text();
  expect(response.status).toBe(200);
  expectNoSecret(text);
  const json = JSON.parse(text);
  Tier1StatusResponseSchema.strict().parse(json);
  return json;
}

function expectNoSecret(text: string): void {
  expect(text).not.toContain(FAKE_TOKEN);
  expect(text).not.toContain(FAKE_ACCOUNT);
  // Nor a recognisable piece of either.
  expect(text).not.toContain("SECRET-never");
  expect(text).not.toContain("0000ab12cd34");
}

async function optIn(extra: Record<string, unknown> = {}, options: { keysInFile?: boolean } = {}): Promise<void> {
  const file = tier1Paths(rootPath, "cbm").config;
  await mkdir(join(file, ".."), { recursive: true });
  const credentials = options.keysInFile === false ? {} : { credentials: { accountId: FAKE_ACCOUNT, apiToken: FAKE_TOKEN } };
  await writeFile(file, JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef", ...credentials, ...extra }), { mode: 0o600 });
}

async function spend(costUsd: number, source = "extract", cards = 100): Promise<void> {
  const ledger = tier1Paths(rootPath, "cbm").ledger;
  await mkdir(join(ledger, ".."), { recursive: true });
  const line = { at: new Date(NOW - 3_600_000).toISOString(), source, provider: "cloudflare-workers-ai", model: "@cf/cloudflare/clef", cards, inputTokens: 1000, costUsd };
  await writeFile(ledger, JSON.stringify(line) + "\n", { flag: "a" });
}

/** Every path under the project with its size and modification time, to show nothing was written. */
async function snapshot(dir = rootPath): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(`${full}/`, ...(await snapshot(full)));
    else {
      const s = await stat(full);
      out.push(`${full} ${s.size} ${s.mtimeMs}`);
    }
  }
  return out.sort();
}

describe("GET /api/tier1", () => {
  it("off when the project hasn't opted in, without creating .dr/ or any file", async () => {
    const request = await app();
    const before = await snapshot();
    const json = await body(await request("/api/tier1"));
    expect(json).toMatchObject({
      state: "off",
      analyzer: "cbm",
      config: ".dr/analyzers/cbm/tier1.json",
      credentials: {},
      month: { spentUsd: 0, capUsd: 20, remainingUsd: 20, resetsAt: "2026-12-01T00:00:00.000Z", cards: 0 },
      nearCap: false,
      bySource: {},
      cache: { entries: 0, bytes: 0, files: 0, lastCompaction: null },
    });
    expect(json.reason).toContain("Tier 1 is opt-in");
    expect(json.summary).toStartWith("Tier 1 is off");
    expect(json.note).toContain("no tool writes tier1.json");
    expect(json.provider).toBeUndefined();
    expect(existsSync(join(rootPath, ".dr"))).toBe(false);
    expect(await snapshot()).toEqual(before);
    expect(fetchCalls).toBe(0);
  });

  it("off names provider variables that are set and unused, never their values", async () => {
    const request = await app({ env: { CLOUDFLARE_ACCOUNT_ID: FAKE_ACCOUNT, CLOUDFLARE_API_TOKEN: FAKE_TOKEN } });
    const json = await body(await request("/api/tier1"));
    expect(json.state).toBe("off");
    expect(json.reason).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("on with keys in tier1.json: provider, model, where keys come from, never their values; nothing written, nothing sent", async () => {
    await optIn({ monthlyCapUsd: 5 });
    const request = await app();
    const before = await snapshot();
    const json = await body(await request("/api/tier1"));
    expect(json).toMatchObject({
      state: "on",
      provider: "cloudflare-workers-ai",
      model: "clef",
      modelId: "@cf/cloudflare/clef",
      monthlyCapUsd: 5,
      concurrency: 4,
      credentials: { accountId: { set: true, from: "tier1.json" }, apiToken: { set: true, from: "tier1.json" } },
      month: { spentUsd: 0, capUsd: 5, remainingUsd: 5 },
      nearCap: false,
    });
    expect(json.reason).toBeUndefined();
    expect(await snapshot()).toEqual(before);
    expect(fetchCalls).toBe(0);
  });

  it("on with keys in the environment: names the variables, never the values", async () => {
    await optIn({}, { keysInFile: false });
    const request = await app({ env: { CLOUDFLARE_ACCOUNT_ID: FAKE_ACCOUNT, CLOUDFLARE_API_TOKEN: FAKE_TOKEN } });
    const json = await body(await request("/api/tier1"));
    expect(json.state).toBe("on");
    expect(json.credentials).toEqual({
      accountId: { set: true, from: "CLOUDFLARE_ACCOUNT_ID" },
      apiToken: { set: true, from: "CLOUDFLARE_API_TOKEN" },
    });
  });

  it("no-credentials: says which key is missing and where it may come from", async () => {
    await optIn({}, { keysInFile: false });
    const request = await app({ env: { CLOUDFLARE_ACCOUNT_ID: FAKE_ACCOUNT } });
    const json = await body(await request("/api/tier1"));
    expect(json.state).toBe("no-credentials");
    expect(json.reason).toContain("CLOUDFLARE_API_TOKEN");
    expect(json.credentials).toEqual({
      accountId: { set: true, from: "CLOUDFLARE_ACCOUNT_ID" },
      apiToken: { set: false, from: null },
    });
    expect(json.modelId).toBeUndefined();
  });

  it("nearCap at 80% of the cap, with the warning in the summary; spend by source", async () => {
    await optIn();
    await spend(15, "extract", 900);
    await spend(1.5, "classify", 90);
    const json = await body(await (await app())("/api/tier1"));
    expect(json.state).toBe("on");
    expect(json.nearCap).toBe(true);
    expect(json.month).toMatchObject({ spentUsd: 16.5, capUsd: 20, remainingUsd: 3.5, cards: 990 });
    expect(json.bySource).toMatchObject({ extract: { cards: 900, costUsd: 15 }, classify: { cards: 90, costUsd: 1.5 } });
    expect(json.summary).toContain("82% of this checkout's monthly cap");
  });

  it("capped once the month's spend reaches the cap (nearCap is then false)", async () => {
    await optIn({ monthlyCapUsd: 10 });
    await spend(10.25);
    const json = await body(await (await app())("/api/tier1"));
    expect(json.state).toBe("capped");
    expect(json.nearCap).toBe(false);
    expect(json.month).toMatchObject({ spentUsd: 10.25, capUsd: 10, remainingUsd: 0 });
  });

  it("misconfigured: a key pasted into another field is not repeated, and the cap still shows", async () => {
    await optIn({ model: FAKE_TOKEN, monthlyCapUsd: 3 });
    const json = await body(await (await app())("/api/tier1"));
    expect(json.state).toBe("misconfigured");
    expect(json.reason).toContain("not shown in case it is a key");
    expect(json.credentials).toEqual({});
    expect(json.month.capUsd).toBe(3);
  });

  it("misconfigured: invalid JSON holding a key is not quoted", async () => {
    const file = tier1Paths(rootPath, "cbm").config;
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, `{"version":1,"credentials":{"apiToken":"${FAKE_TOKEN}"`, { mode: 0o600 });
    const json = await body(await (await app())("/api/tier1"));
    expect(json.state).toBe("misconfigured");
    expect(json.reason).toContain("not valid JSON");
  });

  it("matches the tier1_status MCP tool's body (without its probe)", async () => {
    await optIn();
    await spend(2);
    const rest = await body(await (await app())("/api/tier1"));
    const mcp = await createTier1StatusHandler({ tier1: TEST_OPTIONS() })({ rootPath });
    expect(mcp.isError).toBeFalsy();
    expect(rest).toEqual(JSON.parse((mcp.content[0] as any).text));
  });

  it("takes an analyzer, and refuses a name that could leave .dr/analyzers/", async () => {
    const request = await app();
    const json = await body(await request("/api/tier1?analyzer=other"));
    expect(json).toMatchObject({ state: "off", analyzer: "other", config: ".dr/analyzers/other/tier1.json" });
    expect((await request("/api/tier1?analyzer=..%2F..%2Fetc")).status).toBe(400);
    expect((await request("/api/tier1?analyzer=..")).status).toBe(400);
  });

  it("uses the same bearer auth as the other /api/ routes", async () => {
    await optIn();
    const request = await app({ auth: true });
    const anonymous = await request("/api/tier1");
    expect(anonymous.status).toBe(401);
    expectNoSecret(await anonymous.text());
    expect((await request("/api/tier1", { headers: { Authorization: "Bearer wrong" } })).status).toBe(403);
    const json = await body(await request("/api/tier1", { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }));
    expect(json.state).toBe("on");
  });

  it("is documented in the OpenAPI spec with bearer auth, and its examples match the schema", () => {
    return app().then(() => {
      const doc = server!.getOpenAPIDocument({ openapi: "3.1.0", info: { title: "t", version: "1" } });
      const op = doc.paths["/api/tier1"].get;
      expect(op.tags).toEqual(["Extraction"]);
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      expect(op.parameters.map((p: any) => p.name)).toEqual(["analyzer"]);
      const content = op.responses["200"].content["application/json"];
      expect(content.schema).toEqual({ $ref: "#/components/schemas/Tier1Status" });
      expect(Object.keys(doc.components.schemas.Tier1Status.properties)).toContain("nearCap");
      const examples = Object.values(content.examples) as Array<{ value: unknown }>;
      expect(examples.length).toBeGreaterThanOrEqual(4);
      for (const example of examples) Tier1StatusResponseSchema.strict().parse(example.value);
      expect(examples.map((e: any) => e.value.state).sort()).toEqual(["capped", "no-credentials", "off", "on"]);
    });
  });
});

describe("docs/api-spec.yaml (generated: npm run generate:openapi)", () => {
  it("documents GET /api/tier1 and origin on change objects as the zod schemas define them", async () => {
    const doc = parseYaml(await readFile(resolve(import.meta.dir, "../../../../docs/api-spec.yaml"), "utf-8"));
    const tier1 = doc.components.schemas.Tier1Status;
    expect(Object.keys(tier1.properties).sort()).toEqual(Object.keys(Tier1StatusResponseSchema.shape).sort());
    expect(Object.keys(doc.components.schemas.ChangeOrigin.properties).sort()).toEqual(Object.keys(ChangeOriginSchema.shape).sort());
    const op = doc.paths["/api/tier1"].get;
    expect(op.security).toEqual([{ bearerAuth: [] }]);
    for (const example of Object.values(op.responses["200"].content["application/json"].examples) as Array<{ value: unknown }>) {
      Tier1StatusResponseSchema.strict().parse(example.value);
    }
    // origin on each change of GET /api/changesets/:changesetId (the spec keeps Hono's path syntax),
    // and on each tombstone's change.
    const detail = doc.paths["/api/changesets/:changesetId"].get.responses["200"].content["application/json"].schema.properties;
    expect(detail.changes.items.properties.origin).toEqual({ $ref: "#/components/schemas/ChangeOrigin" });
    expect(detail.unstaged.items.properties.change.properties.origin).toEqual({ $ref: "#/components/schemas/ChangeOrigin" });
  });
});
