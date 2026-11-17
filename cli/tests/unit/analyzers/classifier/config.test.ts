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
  CURRENT_QSET_ID,
  DEFAULT_MONTHLY_CAP_USD,
  DEFAULT_THRESHOLDS,
  modeOf,
  tier1ModeFor,
  resolveTier1Mode,
  servingOfConfig,
  criteriaDigest,
  loadSpecCriteria,
  openTier1,
  resolveTier1,
  setTier1Value,
  tier1Paths,
  writeTier1File,
} from "../../../../src/analyzers/classifier/index.js";
import { shippedModeNow } from "../../../helpers/tier1-shipped-mode.js";

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
      [{ version: 1, provider: "openrouter", model: "cloudflare/clef", openrouter: { only: ["Cloud flare"] } }, "openrouter.only.0: expected an OpenRouter provider slug"],
      [{ version: 1, provider: "openrouter", model: "cloudflare/clef", openrouter: { only: ["cloudflare"], allowFallbacks: true } }, "openrouter.allowFallbacks: must be false"],
      [{ version: 1, provider: "openrouter", model: "cloudflare/clef", openrouter: { only: ["cloudflare"], dataCollection: "allow" } }, 'openrouter.dataCollection: must be "deny"'],
      [{ version: 1, provider: "openrouter", model: "~typesafe/jev-latest", openrouter: { only: ["typesafe"] } }, "is an alias"],
      [{ version: 1, provider: "openrouter", model: "clef", openrouter: { only: ["cloudflare"] } }, 'unknown model "clef" for openrouter'],
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
    expect(s.mode).toBe(await shippedModeNow(CURRENT_QSET_ID, "clef"));
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

describe("mode: suggest, hide or stage", () => {
  const DIGEST = "d".repeat(64);
  const record = {
    corpora: [{ corpus: "viewer", sourceCommit: "0".repeat(40), cards: 290, accept: { cards: 60, correct: 60 }, notElement: { cards: 60, correct: 60 } }],
    run: "clef@x",
    cards: 290,
    specVersion: "0.12.0",
    date: "2026-11-16",
    serving: { provider: "cloudflare-workers-ai", upstream: null },
    criteriaDigest: DIGEST,
    accept: { cards: 60, correct: 60 },
    notElement: { cards: 60, correct: 60 },
  };
  const heldOut = { "dr-qset-2": { clef: { layer: 0.6, type: 0.4, none: 0.6, fit: "held-out" as const, heldOut: record } } };
  const inSample = { "dr-qset-2": { clef: { layer: 0.6, type: 0.4, none: 0.6, fit: "in-sample" as const, heldOut: record } } };
  const hideOnly = { "dr-qset-2": { clef: { layer: 0.6, type: 0.4, none: 0.6, fit: "in-sample" as const, heldOutBands: ["not-element"] as const, heldOut: record } } };
  const workersAi = { serving: { provider: "cloudflare-workers-ai", upstream: null }, criteriaDigest: DIGEST };

  test("hide for a default whose not-element band alone is held-out verified, under the same checks as stage", () => {
    const hide = tier1ModeFor({}, "clef", "dr-qset-2", hideOnly, workersAi);
    expect(hide.mode).toBe("hide");
    expect(hide.reason).toContain("not-element band is verified");
    expect(hide.reason).toContain("acceptTier1");
    // The same serving and criteria checks as stage mode, and the same opt-outs.
    expect(tier1ModeFor({}, "clef", "dr-qset-2", hideOnly, { ...workersAi, criteriaDigest: "e".repeat(64) }).mode).toBe("suggest");
    expect(tier1ModeFor({}, "clef", "dr-qset-2", hideOnly, { serving: { provider: "openrouter", upstream: "cloudflare" }, criteriaDigest: DIGEST }).mode).toBe("suggest");
    expect(tier1ModeFor({ mode: "suggest" }, "clef", "dr-qset-2", hideOnly, workersAi).mode).toBe("suggest");
    expect(tier1ModeFor({ thresholds: { none: 0.5 } }, "clef", "dr-qset-2", hideOnly, workersAi).mode).toBe("suggest");
    // An accept band verified alone stages nothing: there is no stage-only mode.
    const acceptOnly = { "dr-qset-2": { clef: { ...hideOnly["dr-qset-2"].clef, heldOutBands: ["accept"] as const } } };
    expect(tier1ModeFor({}, "clef", "dr-qset-2", acceptOnly, workersAi).mode).toBe("suggest");
  });

  test("stage only for DR's held-out defaults with mode left at auto, the held-out serving and the same criteria", () => {
    expect(tier1ModeFor({}, "clef", "dr-qset-2", heldOut, workersAi)).toMatchObject({ mode: "stage" });
    expect(tier1ModeFor({ mode: "auto" }, "clef", "dr-qset-2", heldOut, workersAi)).toMatchObject({ mode: "stage" });
    expect(tier1ModeFor({}, "clef", "dr-qset-2", inSample, workersAi)).toMatchObject({ mode: "suggest" });
    expect(tier1ModeFor({}, "clef", "dr-qset-2", inSample, workersAi).reason).toContain("in-sample");
  });

  test("another serving than the held-out run's suggests, saying which", () => {
    const viaOpenRouter = tier1ModeFor({}, "clef", "dr-qset-2", heldOut, { serving: { provider: "openrouter", upstream: "deepinfra/fp8" }, criteriaDigest: DIGEST });
    expect(viaOpenRouter.mode).toBe("suggest");
    expect(viaOpenRouter.reason).toContain("as served by cloudflare-workers-ai");
    expect(viaOpenRouter.reason).toContain("openrouter via deepinfra/fp8");
    expect(tier1ModeFor({}, "clef", "dr-qset-2", heldOut, { criteriaDigest: DIGEST }).mode).toBe("suggest");
    // servingOfConfig: a provider serving the model itself has no upstream; OpenRouter names its pinned one.
    expect(servingOfConfig({ provider: "cloudflare-workers-ai" })).toEqual({ provider: "cloudflare-workers-ai", upstream: null });
    expect(servingOfConfig({ provider: "openrouter", openrouter: { only: ["cloudflare"] } })).toEqual({ provider: "openrouter", upstream: "cloudflare" });
    expect(servingOfConfig({ provider: "openrouter", openrouter: { only: ["deepinfra/fp8", "cloudflare"] } })).toEqual({ provider: "openrouter", upstream: "any:cloudflare,deepinfra/fp8" });
  });

  test("other criteria than the held-out run's (a spec or criteria change) suggest: the verdict is stale", () => {
    const stale = tier1ModeFor({}, "clef", "dr-qset-2", heldOut, { ...workersAi, criteriaDigest: "e".repeat(64) });
    expect(stale.mode).toBe("suggest");
    expect(stale.reason).toContain("other criteria");
    expect(tier1ModeFor({}, "clef", "dr-qset-2", heldOut, { serving: workersAi.serving }).mode).toBe("suggest");
  });

  test("held-out without a held-out record suggests", () => {
    const bare = { "dr-qset-2": { clef: { layer: 0.6, type: 0.4, none: 0.6, fit: "held-out" as const } } };
    expect(tier1ModeFor({}, "clef", "dr-qset-2", bare, workersAi)).toMatchObject({ mode: "suggest" });
  });

  test("resolveTier1Mode checks the criteria this CLI sends against the record", async () => {
    const spec = await loadSpecCriteria();
    const current = { "dr-qset-2": { clef: { ...heldOut["dr-qset-2"].clef, heldOut: { ...record, criteriaDigest: criteriaDigest(spec) } } } };
    expect((await resolveTier1Mode({ provider: "cloudflare-workers-ai" }, "clef", "dr-qset-2", current, spec)).mode).toBe("stage");
    expect((await resolveTier1Mode({ provider: "cloudflare-workers-ai" }, "clef", "dr-qset-2", heldOut, spec)).mode).toBe("suggest");
    expect((await resolveTier1Mode({ provider: "openrouter", openrouter: { only: ["cloudflare"] } }, "clef", "dr-qset-2", current, spec)).mode).toBe("suggest");
  });

  test('"mode": "suggest" opts out; overridden thresholds never stage; a model without thresholds suggests', () => {
    const forced = tier1ModeFor({ mode: "suggest" }, "clef", "dr-qset-2", heldOut);
    expect(forced.mode).toBe("suggest");
    expect(forced.reason).toContain('"mode": "suggest"');
    const overridden = tier1ModeFor({ thresholds: { layer: 0.8 } }, "clef", "dr-qset-2", heldOut);
    expect(overridden.mode).toBe("suggest");
    expect(overridden.reason).toContain("overrides the thresholds");
    expect(tier1ModeFor({}, "jev-1.14", "dr-qset-2", heldOut)).toMatchObject({ mode: "suggest" });
  });

  test("the session takes its mode from tier1ModeFor, with the defaults it is given", async () => {
    const root = project();
    writeConfig(root, base);
    const spec = await loadSpecCriteria();
    const opts = { env: ENV, fetch: () => Promise.reject(new Error("no network")), spec };
    const heldOut = { "dr-qset-2": { clef: { layer: 0.6, type: 0.4, none: 0.6, fit: "held-out" as const, heldOut: { ...record, criteriaDigest: criteriaDigest(spec) } } } };
    const staged = await openTier1(root, "cbm", { ...opts, defaults: heldOut });
    expect(staged.state === "ready" && staged.mode).toBe("stage");
    const suggested = await openTier1(root, "cbm", { ...opts, defaults: inSample });
    expect(suggested.state === "ready" && suggested.mode).toBe("suggest");
    writeConfig(root, { ...base, mode: "suggest" });
    const optedOut = await openTier1(root, "cbm", { ...opts, defaults: heldOut });
    expect(optedOut.state === "ready" && optedOut.mode).toBe("suggest");
    // The shipped defaults decide when none are given.
    writeConfig(root, base);
    const shipped = await openTier1(root, "cbm", { ...opts });
    expect(shipped.state === "ready" && shipped.thresholds).toEqual(thresholdsOf(DEFAULT_THRESHOLDS["dr-qset-2"].clef));
    // Clef's shipped dr-qset-2 defaults: the not-element band is verified on four held-out corpora, so hide mode on Workers AI
    // while the bundled spec sends the criteria those runs were scored with, and suggest mode once it doesn't.
    expect(modeOf("dr-qset-2", "clef")).toBe("hide");
    expect(shipped.state === "ready" && shipped.mode).toBe(await shippedModeNow("dr-qset-2", "clef"));
    expect(shipped.state === "ready" && shipped.thresholdsSource).toMatchObject({ fit: "in-sample", heldOutBands: ["not-element"] });
    const hideCurrent = { "dr-qset-2": { clef: { ...hideOnly["dr-qset-2"].clef, heldOut: { ...record, criteriaDigest: criteriaDigest(spec) } } } };
    const hidden = await openTier1(root, "cbm", { ...opts, defaults: hideCurrent });
    expect(hidden.state === "ready" && hidden.mode).toBe("hide");
  });

  test("tier1.json: mode is auto or suggest; stage can't be forced", async () => {
    const root = project();
    writeConfig(root, { ...base, mode: "stage" });
    const r = await resolveTier1(root, "cbm", { env: ENV });
    expect(r.state).toBe("misconfigured");
    writeConfig(root, { ...base, mode: "suggest" });
    const ok = await resolveTier1(root, "cbm", { env: ENV });
    expect(ok.state === "ready" && ok.config.mode).toBe("suggest");
    if (ok.state === "ready") expect(ok.warnings.join(" ")).not.toContain("unknown setting");
  });

  test("set mode suggest writes it, set mode auto removes it, keys and file mode kept; other values refused", async () => {
    const root = project();
    const paths = tier1Paths(root, "cbm");
    await writeTier1File(paths, { ...base, credentials: { accountId: ACCOUNT, apiToken: SECRET } });
    expect(await setTier1Value(paths, "mode", "suggest")).toContain("mode set to suggest");
    let after = JSON.parse(readFileSync(paths.config, "utf8"));
    expect(after.mode).toBe("suggest");
    expect(after.credentials).toEqual({ accountId: ACCOUNT, apiToken: SECRET });
    expect(statSync(paths.config).mode & 0o777).toBe(0o600);
    expect(await setTier1Value(paths, "mode", "auto")).toContain("mode set to auto");
    after = JSON.parse(readFileSync(paths.config, "utf8"));
    expect(after.mode).toBeUndefined();
    await expect(setTier1Value(paths, "mode", "stage")).rejects.toThrow("mode must be auto or suggest");
  });
});

function thresholdsOf(r: { layer: number; type: number; none: number }) {
  return { layer: r.layer, type: r.type, none: r.none };
}
