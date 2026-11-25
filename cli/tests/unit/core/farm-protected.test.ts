/**
 * Keeping tests out of the developer's real user farm (#1438): the test preload points the user
 * farm at a scratch folder and names the real one in DR_PROTECTED_FARM_FILES, which
 * FarmManifest.save refuses to write.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FarmManifest, PROTECTED_FARM_FILES_ENV, assertFarmFileWritable } from "../../../src/core/farm-manifest.js";
import { userFarmFile } from "../../../src/core/project-registry.js";

const scratchDirs: string[] = [];
afterAll(async () => {
  await Promise.all(scratchDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("the test preload", () => {
  it("points the user farm at a scratch folder and protects the real one", () => {
    const real = path.join(os.homedir(), ".config", "dr", "farm.yaml");
    expect(process.env.DR_FARM_PATH).toBeUndefined();
    expect(userFarmFile()).not.toBe(real);
    expect(userFarmFile().startsWith(os.tmpdir())).toBe(true);
    expect((process.env[PROTECTED_FARM_FILES_ENV] ?? "").split(path.delimiter)).toContain(real);
  });

  it("makes a save to the real user farm fail, without writing it", async () => {
    const real = path.join(os.homedir(), ".config", "dr", "farm.yaml");
    const existed = existsSync(real);
    // An env without XDG_CONFIG_HOME resolves to the real farm: the leak #1438 found.
    expect(userFarmFile({})).toBe(real);
    await expect(FarmManifest.create("leak").save(userFarmFile({}))).rejects.toThrow(/Refused to write .*protected/);
    expect(existsSync(real)).toBe(existed);
  });
});

describe("assertFarmFileWritable", () => {
  it("refuses a protected file however it is spelled, and allows any other", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dr-protected-"));
    scratchDirs.push(dir);
    await mkdir(path.join(dir, "farm"));
    const file = path.join(dir, "farm", "farm.yaml");
    const env = { [PROTECTED_FARM_FILES_ENV]: ["/nowhere/farm.yaml", file].join(path.delimiter) };
    expect(() => assertFarmFileWritable(path.join(dir, "farm", "..", "farm", "farm.yaml"), env)).toThrow(
      "Refused to write"
    );
    expect(() => assertFarmFileWritable(path.join(dir, "other.yaml"), env)).not.toThrow();
    expect(() => assertFarmFileWritable(file, {})).not.toThrow();
  });
});
