/**
 * tier1.json: the opt-in, its checks (tracked, permissions), credentials from the file or the
 * environment, and `set`. Temp dirs and temp git repositories only; no network, no real config.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import {
  DEFAULT_MONTHLY_CAP_USD,
  openTier1,
  resolveTier1,
  setTier1Value,
  tier1Paths,
  writeTier1File,
} from "../../../../src/analyzers/classifier/index.js";

const SECRET = "tok-SECRET-do-not-print-0123456789";
const ACCOUNT = "acct-0000000000003f9a";
const NO_ENV = {};
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: SECRET };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function project(): string {
  const d = mkdtempSync(path.join(tmpdir(), "dr-tier1-config-"));
  dirs.push(d);
  return d;
}
function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}
function writeConfig(root: string, content: unknown, mode = 0o600): string {
  const file = tier1Paths(root, "cbm").config;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  chmodSync(file, mode);
  return file;
}
const base = { version: 1, provider: "cloudflare-workers-ai", model: "clef" };

describe("resolveTier1", () => {
  test("off without the file, whatever the environment holds, and says the variables are unused", async () => {
    const root = project();
    const r = await resolveTier1(root, "cbm", { env: ENV });
    expect(r.state).toBe("off");
    if (r.state !== "off") return;
    expect(r.envSet).toEqual(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
    expect(r.reason).toContain("set and unused");
    expect(r.reason).not.toContain(SECRET);
  });

  test("off means no model is ever built (so no request can be made)", async () => {
    const root = project();
    let built = 0;
    const s = await openTier1(root, "cbm", {
      env: ENV,
      createModel: () => {
        built++;
        throw new Error("must not be called");
      },
      fetch: () => Promise.reject(new Error("no network")),
    });
    expect(s.state).toBe("off");
    expect(built).toBe(0);
  });

  test("keys in a file readable by others are refused; at 0600 they are used", async () => {
    const root = project();
    writeConfig(root, { ...base, credentials: { accountId: ACCOUNT, apiToken: SECRET } }, 0o644);
    const loose = await resolveTier1(root, "cbm", { env: NO_ENV, platform: "darwin" });
    expect(loose.state).toBe("misconfigured");
    if (loose.state === "misconfigured") expect(loose.reason).toContain("chmod 600");
    chmodSync(tier1Paths(root, "cbm").config, 0o600);
    const tight = await resolveTier1(root, "cbm", { env: NO_ENV, platform: "darwin" });
    expect(tight.state).toBe("ready");
  });

  test("a loose mode without keys is a warning; Windows skips the check and says so", async () => {
    const root = project();
    writeConfig(root, base, 0o644);
    const r = await resolveTier1(root, "cbm", { env: ENV, platform: "linux" });
    expect(r.state).toBe("ready");
    if (r.state === "ready") expect(r.warnings.join(" ")).toContain("readable by others");
    writeConfig(root, { ...base, credentials: { accountId: ACCOUNT, apiToken: SECRET } }, 0o644);
    const win = await resolveTier1(root, "cbm", { env: NO_ENV, platform: "win32" });
    expect(win.state).toBe("ready");
    if (win.state === "ready") expect(win.warnings.join(" ")).toContain("skipped on Windows");
  });

  test("a file git tracks is refused, from the project root and from the codebase root", async () => {
    const root = project();
    git(root, "init", "-q");
    const file = writeConfig(root, base);
    git(root, "add", "-f", file);
    const r = await resolveTier1(root, "cbm", { env: ENV });
    expect(r.state).toBe("misconfigured");
    if (r.state === "misconfigured") expect(r.reason).toContain("tracked by git");

    // project not a repository, codebase root is one that tracks the file
    const outer = project();
    git(outer, "init", "-q");
    const inner = path.join(outer, "model");
    mkdirSync(inner);
    const f2 = writeConfig(inner, base);
    git(outer, "add", "-f", f2);
    expect((await resolveTier1(inner, "cbm", { env: ENV, codebaseRoot: outer })).state).toBe("misconfigured");
  });

  test("misconfigured: invalid JSON (without quoting it), wrong types, unknown provider or model, openrouter without only", async () => {
    const root = project();
    writeConfig(root, `{"version":1,"provider":"cloudflare-workers-ai","model":"clef","credentials":{"apiToken":"${SECRET}"`);
    const bad = await resolveTier1(root, "cbm", { env: NO_ENV });
    expect(bad.state).toBe("misconfigured");
    if (bad.state === "misconfigured") {
      expect(bad.reason).toContain("not valid JSON");
      expect(bad.reason).not.toContain(SECRET);
    }
    const cases: Array<[unknown, string]> = [
      [{ ...base, monthlyCapUsd: "20" }, "monthlyCapUsd"],
      [{ ...base, monthlyCapUsd: -1 }, "monthlyCapUsd"],
      [{ ...base, concurrency: 17 }, "concurrency"],
      [{ ...base, credentials: { apiToken: 42 } }, "credentials"],
      [{ ...base, provider: "acme" }, 'unknown provider "acme"'],
      [{ ...base, model: "gpt" }, 'unknown model "gpt"'],
      [{ version: 1, provider: "openrouter", model: "cloudflare/clef" }, "openrouter.only"],
      [{ version: 1, provider: "openrouter", model: "cloudflare/clef", openrouter: { only: ["cloudflare"] } }, "not available in this version"],
      [{ ...base, version: 2 }, "version"],
    ];
    for (const [content, expected] of cases) {
      writeConfig(root, content);
      const r = await resolveTier1(root, "cbm", { env: ENV });
      expect(r.state).toBe("misconfigured");
      if (r.state === "misconfigured") expect(r.reason).toContain(expected);
    }
  });

  test("a key pasted into provider, model, a setting name or a credential name is never repeated", async () => {
    const root = project();
    const pasted = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";
    for (const content of [
      { ...base, provider: pasted },
      { ...base, model: pasted },
      { ...base, [pasted]: 1 },
      { ...base, credentials: { [pasted]: "x", accountId: "a", apiToken: "b" } },
    ]) {
      writeConfig(root, content);
      const r = await resolveTier1(root, "cbm", { env: ENV });
      // What messages carry (reason and warnings), which reach MCP results.
      const text = JSON.stringify({ reason: "reason" in r ? r.reason : null, warnings: "warnings" in r ? r.warnings : [] });
      expect(text).not.toContain(pasted);
      expect(text).toContain("not shown");
      if (r.state === "misconfigured") expect(r.reason).toContain("32-character value, not shown");
    }
  });

  test("no-credentials names what it looked for", async () => {
    const root = project();
    writeConfig(root, base);
    const r = await resolveTier1(root, "cbm", { env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
    expect(r.state).toBe("no-credentials");
    if (r.state === "no-credentials") {
      expect(r.missing).toEqual(["credentials.apiToken in tier1.json or CLOUDFLARE_API_TOKEN"]);
      expect(r.config.monthlyCapUsd).toBe(DEFAULT_MONTHLY_CAP_USD);
    }
  });

  test("credentials: the file first, else the environment; never printable", async () => {
    const root = project();
    writeConfig(root, { ...base, credentials: { apiToken: SECRET } });
    const r = await resolveTier1(root, "cbm", { env: { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: "env-token-unused" } });
    expect(r.state).toBe("ready");
    if (r.state !== "ready") return;
    expect(r.credentials.sources).toEqual({ accountId: "CLOUDFLARE_ACCOUNT_ID", apiToken: "tier1.json" });
    expect(r.credentials.reveal().apiToken).toBe(SECRET);
    expect(r.credentials.tail("accountId")).toBe("3f9a");
    for (const shown of [JSON.stringify(r), inspect(r, { depth: 10 }), String(r.credentials), JSON.stringify(r.config)]) {
      expect(shown).not.toContain(SECRET);
      expect(shown).not.toContain(ACCOUNT);
    }
    expect(r.config.fileCredentials).toEqual(["apiToken"]);
  });

  test("a ready session's model and notice never carry the token", async () => {
    const root = project();
    writeConfig(root, base);
    const s = await openTier1(root, "cbm", { env: ENV, fetch: () => Promise.reject(new Error("no network")) });
    expect(s.state).toBe("ready");
    if (s.state !== "ready") return;
    expect(s.party).toBe("Cloudflare Workers AI (@cf/cloudflare/clef, account …3f9a)");
    for (const shown of [JSON.stringify(s.model), inspect(s.model, { depth: 10 }), JSON.stringify(s.config), JSON.stringify(s.resolved)]) {
      expect(shown).not.toContain(SECRET);
    }
    expect(s.host).toBe("cloudflare-workers-ai");
    expect(s.mode).toBe("suggest");
    expect(s.thresholds).toEqual({ layer: 0.6, type: 0.4, none: 0.6 });
  });

  test("a key used as a credential's name is described by its length, never quoted; schema keys are named", async () => {
    const root = project();
    writeConfig(root, { ...base, credentials: { [SECRET]: 5, accountId: ACCOUNT }, thresholds: { layer: 2 } });
    const r = await resolveTier1(root, "cbm", { env: NO_ENV });
    expect(r.state).toBe("misconfigured");
    if (r.state !== "misconfigured") return;
    expect(r.reason).not.toContain(SECRET);
    expect(r.reason).not.toContain("SECRET");
    expect(r.reason).toContain(`credentials.(a ${SECRET.length}-character value, not shown in case it is a key)`);
    // The schema's own keys, and a credential name that looks like an id, are still named.
    expect(r.reason).toContain("thresholds.layer");
    const named = project();
    writeConfig(named, { ...base, credentials: { apiToken: 5 } });
    const n = await resolveTier1(named, "cbm", { env: NO_ENV });
    if (n.state === "misconfigured") expect(n.reason).toContain("credentials.apiToken: ");
    else throw new Error(`expected misconfigured, got ${n.state}`);
  });
});

describe("writing tier1.json", () => {
  test("writeTier1File makes a 0600 file", async () => {
    const root = project();
    const paths = tier1Paths(root, "cbm");
    const file = paths.config;
    await writeTier1File(paths, { ...base, credentials: { apiToken: SECRET } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("set monthly-cap keeps keys and mode; bad values are refused", async () => {
    const root = project();
    const paths = tier1Paths(root, "cbm");
    const file = paths.config;
    await writeTier1File(paths, { ...base, credentials: { accountId: ACCOUNT, apiToken: SECRET }, monthlyCapUsd: 20 });
    expect(await setTier1Value(paths, "monthly-cap", "40")).toBe("monthly cap set to $40.00");
    const after = JSON.parse(readFileSync(file, "utf8"));
    expect(after.monthlyCapUsd).toBe(40);
    expect(after.credentials).toEqual({ accountId: ACCOUNT, apiToken: SECRET });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await setTier1Value(paths, "monthly-cap", "0")).toContain("sends nothing");
    await expect(setTier1Value(paths, "monthly-cap", "-3")).rejects.toThrow("dollar amount");
    await expect(setTier1Value(paths, "monthly-cap", "ten")).rejects.toThrow("dollar amount");
    await expect(setTier1Value(paths, "concurrency", "0")).rejects.toThrow("1 to 16");
    expect(await setTier1Value(paths, "concurrency", "2")).toBe("concurrency set to 2");
    expect(await setTier1Value(paths, "model", "clef-flash")).toContain("@cf/cloudflare/clef-flash");
    await expect(setTier1Value(paths, "model", "gpt")).rejects.toThrow('unknown model "gpt"');
    await expect(setTier1Value(paths, "upstreams", "cloudflare")).rejects.toThrow("openrouter provider only");
    await expect(setTier1Value(paths, "apiToken", "x")).rejects.toThrow("Keys are set with");
    const r = await resolveTier1(root, "cbm", { env: NO_ENV });
    expect(r.state).toBe("ready");
    if (r.state === "ready") expect(r.config).toMatchObject({ monthlyCapUsd: 0, concurrency: 2, model: "clef-flash" });
  });

  test("set on a missing file says to enable first", async () => {
    const root = project();
    await expect(setTier1Value(tier1Paths(root, "cbm"), "monthly-cap", "5")).rejects.toThrow("tier1 enable");
  });

  test("a symbolic link on the way to tier1.json is refused for reads and writes", async () => {
    // .dr linked into a tracked folder: git sees neither the link's path tracked nor un-ignored
    const root = project();
    git(root, "init", "-q");
    mkdirSync(path.join(root, "tracked/analyzers/cbm"), { recursive: true });
    writeFileSync(path.join(root, "tracked/analyzers/cbm/tier1.json"), JSON.stringify(base), { mode: 0o600 });
    git(root, "add", "tracked");
    writeFileSync(path.join(root, ".gitignore"), "/.dr/\n");
    symlinkSync(path.join(root, "tracked"), path.join(root, ".dr"));
    const paths = tier1Paths(root, "cbm");
    const r = await resolveTier1(root, "cbm", { env: ENV });
    expect(r.state).toBe("misconfigured");
    if (r.state === "misconfigured") expect(r.reason).toContain(".dr is a symbolic link");
    await expect(writeTier1File(paths, { ...base, credentials: { apiToken: SECRET } })).rejects.toThrow("symbolic link");
    await expect(setTier1Value(paths, "monthly-cap", "5")).rejects.toThrow("symbolic link");
    expect(readFileSync(path.join(root, "tracked/analyzers/cbm/tier1.json"), "utf8")).not.toContain(SECRET);

    // tier1.json itself a link to a tracked file elsewhere
    const other = project();
    writeFileSync(path.join(other, "elsewhere.json"), JSON.stringify(base), { mode: 0o600 });
    mkdirSync(path.join(other, ".dr/analyzers/cbm"), { recursive: true });
    symlinkSync(path.join(other, "elsewhere.json"), tier1Paths(other, "cbm").config);
    const r2 = await resolveTier1(other, "cbm", { env: ENV });
    expect(r2.state).toBe("misconfigured");
    if (r2.state === "misconfigured") expect(r2.reason).toContain("tier1.json is a symbolic link");
    await expect(writeTier1File(tier1Paths(other, "cbm"), base)).rejects.toThrow("symbolic link");
  });

  test("an unreadable spend ledger makes Tier 1 misconfigured, not a crash", async () => {
    if (process.getuid?.() === 0) return; // root reads anything
    const root = project();
    writeConfig(root, base);
    const ledger = tier1Paths(root, "cbm").ledger;
    writeFileSync(ledger, "");
    chmodSync(ledger, 0o000);
    try {
      const s = await openTier1(root, "cbm", { env: ENV, fetch: () => Promise.reject(new Error("no network")) });
      expect(s.state).toBe("misconfigured");
      if (s.state !== "ready") {
        expect(s.block.reason).toContain("spend ledger");
        expect(s.block.notice).toContain("Tier 0 only");
      }
    } finally {
      chmodSync(ledger, 0o600);
    }
  });

  test("an analyzer name can't leave .dr/analyzers", () => {
    expect(() => tier1Paths("/p", "../x")).toThrow("Invalid analyzer name");
  });
});
