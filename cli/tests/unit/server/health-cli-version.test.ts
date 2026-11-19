/**
 * GET /health reports the dr CLI's version as `cliVersion`. `version` is the HTTP API's own
 * ("0.1.0"), which the viewer must not show as the CLI's: without `cliVersion` its status bar
 * reads "cli —".
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { HealthResponseSchema } from "../../../src/server/schemas.js";
import type { VisualizationServer } from "../../../src/server/server.js";
import { getCliBundledSpecVersion, getCliVersion } from "../../../src/utils/spec-version.js";
import { createServerWithoutChatDetection } from "./helpers.js";

let rootPath: string;
let server: VisualizationServer | undefined;

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-server-health-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Health Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
});

afterEach(async () => {
  server?.stop();
  server = undefined;
  await rm(rootPath, { recursive: true, force: true });
});

describe("GET /health", () => {
  it.serial("reports the CLI's version beside the API's own", async () => {
    const model = await Model.load(rootPath, { lazyLoad: false });
    server = createServerWithoutChatDetection(model, { authEnabled: false });
    const response = (await (server as any).app.request("/health")) as Response;
    expect(response.status).toBe(200);

    const health = HealthResponseSchema.parse(await response.json());
    expect(health.status).toBe("ok");
    expect(health.version).toBe("0.1.0");
    expect(health.cliVersion).toBe(getCliVersion());
    expect(health.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
