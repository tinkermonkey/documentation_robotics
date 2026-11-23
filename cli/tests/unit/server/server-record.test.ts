/**
 * The central server record (issue 1279, design section 7): servers/<farm-hash>.json with its
 * 0600 token beside it, written atomically, keyed by the farm root's real path, and swept when
 * its process is gone.
 *
 * tests/unit/server runs with --concurrent, so each test makes its own state dir.
 */
import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  farmHash,
  findRunningServer,
  parseServerRecord,
  readServerRecord,
  readServerToken,
  removeServerRecord,
  serverRecordDir,
  serverRecordPath,
  serverTokenPath,
  sweepServerRecords,
  writeServerRecord,
} from "../../../src/server/server-record.js";

const posix = process.platform !== "win32";

async function withFixture<T>(fn: (f: { env: NodeJS.ProcessEnv; farm: string; dir: string }) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "dr-server-record-"));
  const farm = join(dir, "farm");
  await mkdir(farm);
  try {
    return await fn({ env: { ...process.env, DR_STATE_DIR: join(dir, "state") }, farm, dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function newRecord(farmRoot: string, pid = process.pid) {
  return { farmRoot, pid, port: 8080, cliVersion: "0.7.1", startedAt: "2026-11-23T00:00:00.000Z" };
}

describe("server record paths", () => {
  it("lives at servers/<farm-hash>.json and .token under the state dir", async () => {
    await withFixture(async ({ env, farm, dir }) => {
      const hash = farmHash(farm);
      expect(hash).toMatch(/^[0-9a-f]{24}$/);
      expect(serverRecordDir(env)).toBe(join(dir, "state", "servers"));
      expect(serverRecordPath(farm, env)).toBe(join(dir, "state", "servers", `${hash}.json`));
      expect(serverTokenPath(farm, env)).toBe(join(dir, "state", "servers", `${hash}.token`));
    });
  });

  it("keys a farm by its real path", async () => {
    await withFixture(async ({ farm, dir }) => {
      const link = join(dir, "link");
      await symlink(farm, link);
      expect(farmHash(link)).toBe(farmHash(farm));
      expect(farmHash(join(dir, "other"))).not.toBe(farmHash(farm));
    });
  });
});

describe("writeServerRecord / readServerRecord", () => {
  it("writes the record and its token, and reads them back", async () => {
    await withFixture(async ({ env, farm }) => {
      const written = await writeServerRecord({ ...newRecord(farm), launcherPid: process.pid }, "tok", env);
      expect(written.tokenPath).toBe(serverTokenPath(farm, env));
      expect(await readServerRecord(farm, env)).toEqual(written);
      expect(await readServerToken(written)).toBe("tok");
      // The token is never in the record.
      expect(await readFile(serverRecordPath(farm, env), "utf8")).not.toContain("tok\"");
      expect(Object.keys(JSON.parse(await readFile(serverRecordPath(farm, env), "utf8")))).not.toContain("token");
    });
  });

  it("stores the farm root as its real path", async () => {
    await withFixture(async ({ env, farm, dir }) => {
      const link = join(dir, "link");
      await symlink(farm, link);
      const written = await writeServerRecord(newRecord(link), "tok", env);
      const { realpath } = await import("node:fs/promises");
      expect(written.farmRoot).toBe(await realpath(farm));
      expect(await readServerRecord(farm, env)).toEqual(written);
    });
  });

  it.skipIf(!posix)("makes the token and record 0600 and the directory 0700", async () => {
    await withFixture(async ({ env, farm }) => {
      await writeServerRecord(newRecord(farm), "tok", env);
      expect((await stat(serverRecordDir(env))).mode & 0o777).toBe(0o700);
      expect((await stat(serverTokenPath(farm, env))).mode & 0o777).toBe(0o600);
      expect((await stat(serverRecordPath(farm, env))).mode & 0o777).toBe(0o600);
    });
  });

  it("replaces an earlier record and leaves no temp files", async () => {
    await withFixture(async ({ env, farm }) => {
      await writeServerRecord(newRecord(farm), "one", env);
      const second = await writeServerRecord({ ...newRecord(farm), port: 9090 }, "two", env);
      expect((await readServerRecord(farm, env))?.port).toBe(9090);
      expect(await readServerToken(second)).toBe("two");
      expect((await readdir(serverRecordDir(env))).sort()).toEqual([`${farmHash(farm)}.json`, `${farmHash(farm)}.token`]);
    });
  });

  it("refuses an empty token", async () => {
    await withFixture(async ({ env, farm }) => {
      await expect(writeServerRecord(newRecord(farm), "", env)).rejects.toThrow(/token/);
    });
  });

  it("reads null when there is no record or it can't be read", async () => {
    await withFixture(async ({ env, farm }) => {
      expect(await readServerRecord(farm, env)).toBeNull();
      await mkdir(serverRecordDir(env), { recursive: true });
      await writeFile(serverRecordPath(farm, env), "{not json");
      expect(await readServerRecord(farm, env)).toBeNull();
      expect(await readServerToken({ tokenPath: serverTokenPath(farm, env) })).toBeNull();
    });
  });
});

describe("parseServerRecord", () => {
  it("accepts a whole record and rejects a broken one", () => {
    const good = { ...newRecord("/farm"), tokenPath: "/t" };
    expect(parseServerRecord(JSON.stringify(good))).toEqual(good);
    expect(parseServerRecord(JSON.stringify({ ...good, launcherPid: 7 }))?.launcherPid).toBe(7);
    for (const broken of [
      { ...good, pid: 0 },
      { ...good, pid: "1" },
      { ...good, port: 70000 },
      { ...good, farmRoot: "" },
      { ...good, tokenPath: undefined },
      { ...good, launcherPid: -1 },
    ]) {
      expect(parseServerRecord(JSON.stringify(broken))).toBeNull();
    }
    expect(parseServerRecord("null")).toBeNull();
  });
});

describe("removeServerRecord", () => {
  it("removes the record and its token", async () => {
    await withFixture(async ({ env, farm }) => {
      await writeServerRecord(newRecord(farm), "tok", env);
      expect(await removeServerRecord(farm, { env })).toBe(true);
      expect(await readdir(serverRecordDir(env))).toEqual([]);
      expect(await removeServerRecord(farm, { env })).toBe(false);
    });
  });

  it("with pid, leaves a successor's record alone", async () => {
    await withFixture(async ({ env, farm }) => {
      await writeServerRecord(newRecord(farm, 4242), "tok", env);
      expect(await removeServerRecord(farm, { env, pid: process.pid })).toBe(false);
      expect(await readServerRecord(farm, env)).not.toBeNull();
      expect(await removeServerRecord(farm, { env, pid: 4242 })).toBe(true);
    });
  });
});

describe("sweepServerRecords", () => {
  it("removes records of gone processes with their tokens, and keeps live ones", async () => {
    await withFixture(async ({ env, farm, dir }) => {
      const other = join(dir, "other");
      await mkdir(other);
      await writeServerRecord(newRecord(farm, 111), "live", env);
      await writeServerRecord(newRecord(other, 222), "dead", env);
      const swept = await sweepServerRecords({ env, isAlive: (pid) => pid === 111 });
      expect(swept).toMatchObject({ records: 1, tokens: 1, tempFiles: 0, unreadable: [] });
      expect(swept.removed.sort()).toEqual([serverRecordPath(other, env), serverTokenPath(other, env)].sort());
      expect(await readServerRecord(farm, env)).not.toBeNull();
    });
  });

  it("keeps an unreadable record whose pid is alive, and reports it", async () => {
    await withFixture(async ({ env, farm }) => {
      await mkdir(serverRecordDir(env), { recursive: true });
      await writeFile(serverRecordPath(farm, env), JSON.stringify({ pid: 111, future: true }));
      const kept = await sweepServerRecords({ env, isAlive: () => true });
      expect(kept.unreadable).toEqual([serverRecordPath(farm, env)]);
      const dropped = await sweepServerRecords({ env, isAlive: () => false });
      expect(dropped.records).toBe(1);
    });
  });

  it("removes old orphan tokens and temp files, but not a token newer than a minute", async () => {
    await withFixture(async ({ env, farm }) => {
      const dir = serverRecordDir(env);
      await mkdir(dir, { recursive: true });
      const token = serverTokenPath(farm, env);
      const temp = join(dir, `${farmHash(farm)}.json.1.1.tmp`);
      await writeFile(token, "tok");
      await writeFile(temp, "{");
      const now = Date.now();
      expect(await sweepServerRecords({ env, now })).toMatchObject({ records: 0, tokens: 0, tempFiles: 0 });
      const old = new Date(now - 120_000);
      await utimes(token, old, old);
      await utimes(temp, old, old);
      expect(await sweepServerRecords({ env, now })).toMatchObject({ tokens: 1, tempFiles: 1 });
      expect(await readdir(dir)).toEqual([]);
    });
  });

  it("does nothing when there is no servers directory", async () => {
    await withFixture(async ({ env }) => {
      expect(await sweepServerRecords({ env })).toEqual({ removed: [], records: 0, tokens: 0, tempFiles: 0, unreadable: [] });
    });
  });
});

describe("findRunningServer", () => {
  it("returns a live process's record and token, and removes a gone one's", async () => {
    await withFixture(async ({ env, farm }) => {
      expect(await findRunningServer(farm, { env })).toBeNull();
      const written = await writeServerRecord(newRecord(farm), "tok", env);
      expect(await findRunningServer(farm, { env })).toEqual({ record: written, token: "tok" });
      expect(await findRunningServer(farm, { env, isAlive: () => false })).toBeNull();
      expect(await readdir(serverRecordDir(env))).toEqual([]);
    });
  });
});
