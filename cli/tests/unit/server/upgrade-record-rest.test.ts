/**
 * The upgrade record on the viewer's changeset endpoints (#1164): GET .../changesets and GET
 * .../changesets/:id (scoped to the checkout) report it with its purpose, the one move it allows and no base drift, each
 * dropped relationship with the origin that names what retired it, and POST .../commit (the
 * viewer's Apply) refuses it.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { upgradeModel } from "../../../src/core/model-upgrade.js";
import { ChangesetDetailSchema, ChangesetsListSchema } from "../../../src/server/schemas.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { startTestFarmServer, type TestFarmServer } from "../../helpers/test-farm-server.js";

const VERSION = getCliBundledSpecVersion();
const DROPPED = { source: "api.operation.list-orders", predicate: "delivers", target: "api.response.ok", layer: "api" };

let rootPath: string;
let server: TestFarmServer | undefined;

beforeEach(async () => {
  const dir = join(tmpdir(), `dr-server-upgrade-record-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  rootPath = await realpath(dir);
  await Model.init(rootPath, { name: "Upgrade Record REST Test", version: "0.1.0", specVersion: VERSION });
  const modelDir = join(rootPath, "documentation-robotics/model");
  const element = (path: string) => {
    const [layerId, type, name] = path.split(".");
    return { [path]: { id: crypto.randomUUID(), path, spec_node_id: `${layerId}.${type}`, type, layer_id: layerId, name } };
  };
  await mkdir(join(modelDir, "07_api"), { recursive: true });
  await writeFile(
    join(modelDir, "07_api/elements.yaml"),
    yaml.stringify({ ...element(DROPPED.source), ...element(DROPPED.target) })
  );
  await writeFile(join(modelDir, "relationships.yaml"), yaml.stringify([DROPPED]));
});

afterEach(async () => {
  await server?.stop();
  server = undefined;
  await rm(rootPath, { recursive: true, force: true });
});

describe("the upgrade record on the changeset endpoints", () => {
  it.serial("is listed as a record that can only be discarded, shows what was dropped, and Apply refuses it", async () => {
    const upgraded = await upgradeModel(rootPath, { fromVersion: VERSION, toVersion: VERSION, catalogOnly: true });
    const id = upgraded.dropRecord!.id!;

    server = await startTestFarmServer(rootPath);
    const request = (rest: string, init?: RequestInit) => server!.request(rest, init);

    // The list: parsed by the published schema, so the new purpose and origin kind are in it
    const list = ChangesetsListSchema.parse(await (await request("/changesets")).json()).changesets;
    expect(Object.keys(list)).toEqual([id]);
    expect(list[id]).toMatchObject({
      name: `upgrade-drops-${VERSION}`,
      status: "staged",
      purpose: "upgrade-record",
      actions: ["discard"],
      drift: {
        state: "not-applicable",
        blocksCommit: false,
        message: "An upgrade record is never landed, so base drift does not apply to it.",
      },
    });

    // The detail: the dropped relationship, and who decided it
    const detail = ChangesetDetailSchema.parse(await (await request(`/changesets/${id}`)).json());
    expect(detail).toMatchObject({ purpose: "upgrade-record", actions: ["discard"], origin: { kind: "upgrade" } });
    expect(detail.drift.state).toBe("not-applicable");
    const raw = JSON.stringify(detail);
    expect(raw).toContain(`${DROPPED.source}::delivers::${DROPPED.target}`);
    expect(raw).toContain('"by":"upgrade"');
    expect(raw).toContain("api.operation.delivers.api.response retired by ");

    // Apply is refused, and the model is as the upgrade left it
    const commit = await request(`/changesets/${id}/commit`, { method: "POST" });
    expect(commit.status).toBe(409);
    expect(((await commit.json()) as { error: string }).error).toContain("is an upgrade record");
    const relationships = yaml.parse(
      await readFile(join(rootPath, "documentation-robotics/model/relationships.yaml"), "utf-8")
    );
    expect(relationships ?? []).toEqual([]);
  });
});
