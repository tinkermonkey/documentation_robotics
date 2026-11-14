/**
 * `dr analyzer tier1 enable|disable|set|status|test` and `tier1 cache status|clear`, end to end in
 * temporary git repositories. Never sends a request: `enable` runs with --no-test, the
 * credentials are fake, and `test` is only run where it must refuse before sending.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkdir, runDr, stripAnsi } from "../../helpers/cli-runner.js";

const FAKE_ACCOUNT = "fake-account-00009z9z";
const FAKE_TOKEN = "fake-token-SECRET-never-printed";
/** No provider credentials, whatever the developer's shell holds. */
const NO_CREDS = { CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "", OPENROUTER_API_KEY: "" };
const CREDS = { CLOUDFLARE_ACCOUNT_ID: FAKE_ACCOUNT, CLOUDFLARE_API_TOKEN: FAKE_TOKEN, OPENROUTER_API_KEY: "" };

let dir: { path: string; cleanup: () => Promise<void> };
const configPath = () => join(dir.path, ".dr/analyzers/cbm/tier1.json");
const out = (r: { stdout: string; stderr: string }) => stripAnsi(r.stdout + r.stderr);

function git(...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir.path, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const dr = (args: string[], env: Record<string, string> = NO_CREDS) => runDr(args, { cwd: dir.path, env });

describe("dr analyzer tier1", () => {
  beforeEach(async () => {
    dir = await createTempWorkdir();
    git("init", "-q");
    const init = await dr(["init", "--name", "Tier1 Test"]);
    expect(init.exitCode).toBe(0);
    // Start without the rule dr init adds, to see enable add it.
    writeFileSync(join(dir.path, ".gitignore"), "node_modules/\n");
  });
  afterEach(async () => {
    await dir.cleanup();
  });

  it("is off by default and says provider variables are set and unused", async () => {
    const r = await dr(["analyzer", "tier1", "status", "--json"], CREDS);
    expect(r.exitCode).toBe(0);
    const s = JSON.parse(r.stdout);
    expect(s.state).toBe("off");
    expect(s.reason).toContain("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN are set and unused");
    expect(r.stdout).not.toContain(FAKE_TOKEN);
  });

  it("enable adds /.dr/ to .gitignore, writes a 0600 file without keys, and status says where keys come from", async () => {
    const r = await dr(["analyzer", "tier1", "enable", "--provider", "cloudflare-workers-ai", "--model", "clef", "--use-env", "--no-test", "--monthly-cap", "5"], CREDS);
    expect(r.exitCode).toBe(0);
    expect(out(r)).toContain("Tier 1 enabled");
    expect(out(r)).toContain("Added /.dr/ to");
    expect(readFileSync(join(dir.path, ".gitignore"), "utf8")).toContain("node_modules/\n");
    expect(readFileSync(join(dir.path, ".gitignore"), "utf8")).toContain("/.dr/");
    expect(git("check-ignore", "--no-index", ".dr/analyzers/cbm/tier1.json").trim()).toBe(".dr/analyzers/cbm/tier1.json");
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    const file = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(file).toEqual({ version: 1, provider: "cloudflare-workers-ai", model: "clef", monthlyCapUsd: 5 });

    const status = await dr(["analyzer", "tier1", "status", "--json"], CREDS);
    expect(status.exitCode).toBe(0);
    const s = JSON.parse(status.stdout);
    expect(s).toMatchObject({ state: "on", provider: "cloudflare-workers-ai", model: "clef", monthlyCapUsd: 5, dotDrIgnored: true });
    expect(s.credentials).toEqual({ accountId: { set: true, from: "CLOUDFLARE_ACCOUNT_ID" }, apiToken: { set: true, from: "CLOUDFLARE_API_TOKEN" } });
    expect(s.month).toMatchObject({ spentUsd: 0, capUsd: 5, remainingUsd: 5 });
    const text = await dr(["analyzer", "tier1", "status"], CREDS);
    for (const shown of [status.stdout, text.stdout, text.stderr, r.stdout, r.stderr]) {
      expect(shown).not.toContain(FAKE_TOKEN);
      expect(shown).not.toContain(FAKE_ACCOUNT);
    }
    expect(out(text)).toContain("set monthly-cap");

    const none = await dr(["analyzer", "tier1", "status", "--json"]);
    expect(JSON.parse(none.stdout)).toMatchObject({ state: "no-credentials" });
  });

  it("set monthly-cap changes the cap and keeps keys and mode", async () => {
    mkdirSync(join(dir.path, ".dr/analyzers/cbm"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef", credentials: { accountId: FAKE_ACCOUNT, apiToken: FAKE_TOKEN } }), { mode: 0o600 });
    const r = await dr(["analyzer", "tier1", "set", "monthly-cap", "40"]);
    expect(r.exitCode).toBe(0);
    expect(out(r)).toContain("monthly cap set to $40.00");
    expect(out(r)).toContain("This month: $0.00 of the $40.00 cap");
    const file = JSON.parse(readFileSync(configPath(), "utf8"));
    expect(file.monthlyCapUsd).toBe(40);
    expect(file.credentials).toEqual({ accountId: FAKE_ACCOUNT, apiToken: FAKE_TOKEN });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(out(r)).not.toContain(FAKE_TOKEN);
    const bad = await dr(["analyzer", "tier1", "set", "monthly-cap", "-1"]);
    expect(bad.exitCode).not.toBe(0);
    const status = JSON.parse((await dr(["analyzer", "tier1", "status", "--json"])).stdout);
    expect(status.credentials.apiToken).toEqual({ set: true, from: "tier1.json" });
    expect(JSON.stringify(status)).not.toContain(FAKE_TOKEN);
  });

  it("a negation that un-ignores .dr/ makes enable refuse to keep keys in the file", async () => {
    mkdirSync(join(dir.path, ".dr/analyzers/cbm"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef", credentials: { apiToken: FAKE_TOKEN } }), { mode: 0o600 });
    writeFileSync(join(dir.path, ".gitignore"), "/.dr/\n!/.dr/\n");
    const r = await dr(["analyzer", "tier1", "enable", "--provider", "cloudflare-workers-ai", "--model", "clef", "--no-test"]);
    expect(r.exitCode).not.toBe(0);
    expect(out(r)).toContain("not git-ignored");
    expect(readFileSync(join(dir.path, ".gitignore"), "utf8")).toBe("/.dr/\n!/.dr/\n");
    expect(out(r)).not.toContain(FAKE_TOKEN);
  });

  it("a tracked tier1.json is refused, and test refuses before sending anything", async () => {
    mkdirSync(join(dir.path, ".dr/analyzers/cbm"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef" }), { mode: 0o600 });
    git("add", "-f", configPath());
    const s = JSON.parse((await dr(["analyzer", "tier1", "status", "--json"], CREDS)).stdout);
    expect(s.state).toBe("misconfigured");
    expect(s.reason).toContain("tracked by git");
    const t = await dr(["analyzer", "tier1", "test"], CREDS);
    expect(t.exitCode).not.toBe(0);
    expect(out(t)).toContain("misconfigured");
  });

  it("test refuses at a cap of 0, so nothing is sent", async () => {
    mkdirSync(join(dir.path, ".dr/analyzers/cbm"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef", monthlyCapUsd: 0 }), { mode: 0o600 });
    const t = await dr(["analyzer", "tier1", "test"], CREDS);
    expect(t.exitCode).not.toBe(0);
    expect(out(t)).toContain("The probe was not sent");
    expect(existsSync(join(dir.path, ".dr/analyzers/cbm/tier1-spend.jsonl"))).toBe(false);
  });

  it("cache status and clear; disable keeps the cache, disable --clear-cache deletes it", async () => {
    await dr(["analyzer", "tier1", "enable", "--provider", "cloudflare-workers-ai", "--model", "clef", "--use-env", "--no-test"], CREDS);
    const cacheFile = join(dir.path, ".dr/analyzers/cbm/tier1-cache/dr-qset-2/cloudflare-workers-ai/clef.jsonl");
    const seed = () => {
      mkdirSync(join(cacheFile, ".."), { recursive: true });
      const entry = (i: number) =>
        JSON.stringify({
          v: 1,
          key: String(i).padStart(64, "0"),
          at: new Date().toISOString(),
          qset: "dr-qset-2",
          model: "clef",
          host: "cloudflare-workers-ai",
          criteriaDigest: "c",
          stages: [{ shapes: { layer: { type: "choice" } }, raw: { layer: { probabilities: { none: 1 } } } }],
          usage: { inputTokens: 5000, costUsd: 0.0012 },
        });
      writeFileSync(cacheFile, [entry(1), entry(2)].join("\n") + "\n");
    };
    seed();
    const status = JSON.parse((await dr(["analyzer", "tier1", "cache", "status", "--json"])).stdout);
    expect(status.entries).toBe(2);
    const clear = await dr(["analyzer", "tier1", "cache", "clear"]);
    expect(clear.exitCode).toBe(0);
    expect(out(clear)).toContain("Cleared 2 cached answers");
    expect(out(clear)).toContain("Refilling them costs about $0.00");
    expect(existsSync(cacheFile)).toBe(false);

    seed();
    const disable = await dr(["analyzer", "tier1", "disable"]);
    expect(disable.exitCode).toBe(0);
    expect(existsSync(configPath())).toBe(false);
    expect(existsSync(cacheFile)).toBe(true);
    await dr(["analyzer", "tier1", "enable", "--provider", "cloudflare-workers-ai", "--model", "clef", "--use-env", "--no-test"], CREDS);
    const both = await dr(["analyzer", "tier1", "disable", "--clear-cache"]);
    expect(both.exitCode).toBe(0);
    expect(existsSync(configPath())).toBe(false);
    expect(existsSync(cacheFile)).toBe(false);
  });

  it("enable refuses an unknown provider or model, and openrouter until its adapter ships", async () => {
    const p = await dr(["analyzer", "tier1", "enable", "--provider", "acme", "--model", "clef", "--use-env", "--no-test"]);
    expect(p.exitCode).not.toBe(0);
    expect(out(p)).toContain('Unknown provider "acme"');
    const m = await dr(["analyzer", "tier1", "enable", "--provider", "cloudflare-workers-ai", "--model", "gpt", "--use-env", "--no-test"]);
    expect(m.exitCode).not.toBe(0);
    expect(out(m)).toContain("clef, clef-flash");
    const o = await dr(["analyzer", "tier1", "enable", "--provider", "openrouter", "--model", "cloudflare/clef", "--use-env", "--no-test"]);
    expect(o.exitCode).not.toBe(0);
    expect(out(o)).toContain("not available in this version");
    expect(existsSync(configPath())).toBe(false);
  });
});
