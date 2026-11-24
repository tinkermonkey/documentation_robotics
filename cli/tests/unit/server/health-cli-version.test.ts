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
import { getCliBundledSpecVersion, getCliVersion } from "../../../src/utils/spec-version.js";
import { startTestFarmServer, type TestFarmServer } from "../../helpers/test-farm-server.js";

let rootPath: string;
let server: TestFarmServer | undefined;

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-server-health-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Health Test", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
});

afterEach(async () => {
  await server?.stop();
  server = undefined;
  await rm(rootPath, { recursive: true, force: true });
});

describe("GET /health", () => {
  it.serial("reports the CLI's version beside the API's own", async () => {
    server = await startTestFarmServer(rootPath);
    const response = await server.raw("/health", { headers: {} });
    expect(response.status).toBe(200);

    const health = HealthResponseSchema.parse(await response.json());
    expect(health.status).toBe("ok");
    expect(health.version).toBe("0.1.0");
    expect(health.cliVersion).toBe(getCliVersion());
    expect(health.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(health.warnings).toBeUndefined();
  });

  it.serial("says degraded when the chat service failed to start, and what failed only with the token", async () => {
    server = await startTestFarmServer(rootPath);
    (server.server as any).chatInitializationError = new Error("no chat CLI at /private/path");
    const anonymous = HealthResponseSchema.parse(await (await server.raw("/health", { headers: {} })).json());
    expect(anonymous.status).toBe("degraded");
    expect(anonymous.warnings).toBeUndefined();

    const withToken = HealthResponseSchema.parse(await (await server.raw("/health", { headers: server.auth })).json());
    expect(withToken.status).toBe("degraded");
    expect(withToken.warnings).toEqual(["Chat service unavailable: no chat CLI at /private/path"]);
  });
});
