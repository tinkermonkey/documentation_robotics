/**
 * The spend ledger, the UTC month window and the cap's messages (TIER1_DESIGN.md section 4.3).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { capMessage, formatDay, isCapped, monthLine, monthOf, monthWindow, nearCapWarning, SpendLedger } from "../../../../src/analyzers/classifier/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function ledgerFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), "dr-tier1-spend-"));
  dirs.push(d);
  return path.join(d, "tier1-spend.jsonl");
}
const at = (iso: string) => () => Date.parse(iso);
const batch = { source: "classify" as const, provider: "cloudflare-workers-ai", model: "@cf/cloudflare/clef", cards: 10, inputTokens: 50_000 };

describe("monthly window (UTC)", () => {
  test("a month boundary in UTC, whatever the local time zone", () => {
    const { start, end } = monthWindow(Date.parse("2026-11-30T23:59:59Z"));
    expect(new Date(start).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(new Date(monthWindow(Date.parse("2026-12-01T00:00:00Z")).start).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(new Date(monthWindow(Date.parse("2026-12-31T12:00:00Z")).end).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("the ledger sums this month only", async () => {
    const file = ledgerFile();
    await new SpendLedger(file, { now: at("2026-10-31T23:59:00Z") }).record({ ...batch, costUsd: 5 });
    await new SpendLedger(file, { now: at("2026-11-01T00:00:00Z") }).record({ ...batch, costUsd: 1.25 });
    await new SpendLedger(file, { now: at("2026-11-14T10:00:00Z") }).record({ ...batch, source: "probe", cards: 1, costUsd: 0.002 });
    const month = await new SpendLedger(file, { now: at("2026-11-30T23:00:00Z") }).month(20);
    expect(month).toEqual({ spentUsd: 1.252, capUsd: 20, remainingUsd: 18.748, resetsAt: "2026-12-01T00:00:00.000Z", cards: 11 });
    const december = await new SpendLedger(file, { now: at("2026-12-01T00:00:01Z") }).month(20);
    expect(december.spentUsd).toBe(0);
  });

  test("a torn or garbled line is skipped, and the next append starts on a new line", async () => {
    const file = ledgerFile();
    const ledger = new SpendLedger(file, { now: at("2026-11-14T10:00:00Z") });
    await ledger.record({ ...batch, costUsd: 1 });
    appendFileSync(file, '{"at":"2026-11-14T10:01:00Z","source":"clas');
    await ledger.record({ ...batch, costUsd: 2 });
    appendFileSync(file, "not json\n" + JSON.stringify({ at: "2026-11-14", source: "classify", costUsd: "free" }) + "\n");
    expect((await ledger.month(20)).spentUsd).toBe(3);
    expect(ledger.skipped).toBe(3);
  });
});

describe("pruning (lines before last month go)", () => {
  test("keeps this month and last, drops older and unreadable lines; the month's spend reads the same; the mode is kept", async () => {
    const file = ledgerFile();
    const write = (iso: string, costUsd: number) => new SpendLedger(file, { now: at(iso) }).record({ ...batch, costUsd });
    await write("2026-08-31T23:59:59Z", 7);
    await write("2026-09-30T23:59:59Z", 5);
    await write("2026-10-01T00:00:00Z", 1.5); // last month's first instant: kept
    await write("2026-11-01T00:00:00Z", 2);
    appendFileSync(file, "not json\n");
    await write("2026-11-15T12:00:00Z", 0.25);
    chmodSync(file, 0o600);
    const ledger = new SpendLedger(file, { now: at("2026-11-15T13:00:00Z") });
    const before = await ledger.month(20);

    expect(await ledger.prune()).toEqual({ kept: 3, dropped: 3 });
    expect(await ledger.month(20)).toEqual(before);
    expect(before.spentUsd).toBe(2.25);
    expect((await ledger.entries()).map((e) => e.at)).toEqual(["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "2026-11-15T12:00:00.000Z"]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(path.dirname(file)).filter((n) => n.includes(".tmp") || n.endsWith(".lock"))).toEqual([]);
  });

  test("a newer CLI's lines (an unknown source, a date this CLI can't read) are kept; only provably old ones go", async () => {
    const file = ledgerFile();
    const newer = JSON.stringify({ at: "2026-11-10T00:00:00.000Z", source: "warmup", provider: "x", model: "y", cards: 3, inputTokens: 9, costUsd: 4 });
    const undated = JSON.stringify({ at: "sometime", source: "index", provider: "x", model: "y", cards: 1, inputTokens: 1, costUsd: 1 });
    const oldUnknown = JSON.stringify({ at: "2026-01-10T00:00:00.000Z", source: "warmup", provider: "x", model: "y", cards: 1, inputTokens: 1, costUsd: 1 });
    writeFileSync(file, [newer, undated, oldUnknown, "{torn"].join("\n") + "\n");
    const ledger = new SpendLedger(file, { now: at("2026-11-15T13:00:00Z") });
    expect(await ledger.prune()).toEqual({ kept: 2, dropped: 2 });
    expect(readFileSync(file, "utf8")).toBe(`${newer}\n${undated}\n`);
  });

  test("a ledger that is a symbolic link isn't pruned (the rename would split it), and says why", async () => {
    const file = ledgerFile();
    const target = path.join(path.dirname(file), "shared-ledger.jsonl");
    await new SpendLedger(target, { now: at("2026-01-15T00:00:00Z") }).record({ ...batch, costUsd: 1 });
    symlinkSync(target, file);
    const result = await new SpendLedger(file, { now: at("2026-11-15T13:00:00Z") }).prune();
    expect(result.dropped).toBe(0);
    expect(result.skipped).toContain("symbolic link");
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("a temporary file a dead prune left behind is removed by the next prune", async () => {
    const file = ledgerFile();
    await new SpendLedger(file, { now: at("2026-11-15T12:00:00Z") }).record({ ...batch, costUsd: 1 });
    const stale = `${file}.99999.1.prune.tmp`;
    writeFileSync(stale, "half");
    await new SpendLedger(file, { now: at("2026-11-15T13:00:00Z") }).prune();
    expect(readdirSync(path.dirname(file)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("nothing to drop rewrites nothing; a missing ledger is fine", async () => {
    const file = ledgerFile();
    const ledger = new SpendLedger(file, { now: at("2026-11-15T13:00:00Z") });
    expect(await ledger.prune()).toEqual({ kept: 0, dropped: 0 });
    await ledger.record({ ...batch, costUsd: 1 });
    const mtime = statSync(file).mtimeMs;
    const ino = statSync(file).ino;
    expect(await ledger.prune()).toEqual({ kept: 1, dropped: 0 });
    expect(statSync(file).ino).toBe(ino);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  test("at a month boundary (UTC): on the 1st of December, October goes and November stays", async () => {
    const file = ledgerFile();
    await new SpendLedger(file, { now: at("2026-10-31T23:59:59Z") }).record({ ...batch, costUsd: 3 });
    await new SpendLedger(file, { now: at("2026-11-30T23:59:59Z") }).record({ ...batch, costUsd: 4 });
    const ledger = new SpendLedger(file, { now: at("2026-12-01T00:00:00Z") });
    expect(await ledger.prune()).toEqual({ kept: 1, dropped: 1 });
    expect((await ledger.month(20)).spentUsd).toBe(0);
    expect((await new SpendLedger(file, { now: at("2026-11-30T23:59:59Z") }).month(20)).spentUsd).toBe(4);
  });

  test("a prune racing appends from another process loses no line", async () => {
    const file = ledgerFile();
    // Old lines, so every prune has something to drop and rewrites the file.
    for (let i = 0; i < 30; i++) await new SpendLedger(file, { now: at("2026-01-15T00:00:00Z") }).record({ ...batch, costUsd: 0.01 });
    const spendModule = path.resolve(import.meta.dir, "../../../../src/analyzers/classifier/spend.ts");
    const child = path.join(path.dirname(file), "append-child.ts");
    writeFileSync(
      child,
      `import { SpendLedger } from ${JSON.stringify(spendModule)};
const ledger = new SpendLedger(process.argv[2]);
for (let i = 0; i < 60; i++) {
  await ledger.record({ source: "index", provider: "fake", model: "fake/clef", cards: 1, inputTokens: 1000, costUsd: 0.001 });
  if (i % 10 === 0) await ledger.record({ source: "classify", provider: "fake", model: "fake/clef", cards: 1, inputTokens: 1000, costUsd: 0.001, at: "2026-01-15T00:00:00.000Z" });
}
`
    );
    const proc = Bun.spawn([process.execPath, child, file], { stdout: "pipe", stderr: "pipe" });
    let exited = false;
    void proc.exited.then(() => {
      exited = true;
    });
    const parent = new SpendLedger(file);
    let prunes = 0;
    while (!exited) {
      await parent.prune();
      prunes++;
    }
    expect(await proc.exited).toBe(0);
    await parent.prune();
    const month = await parent.month(20);
    expect(month.cards).toBe(60);
    expect(month.spentUsd).toBeCloseTo(0.06, 9);
    expect((await parent.entries()).length).toBe(60);
    expect(parent.skipped).toBe(0);
    expect(prunes).toBeGreaterThan(0);
  });
});

describe("cap messages", () => {
  const end = Date.parse("2026-12-01T00:00:00Z");

  test("the month line, and the 80% warning", () => {
    expect(monthLine(monthOf(6.12, 20, 100, end))).toBe("This month: $6.12 of the $20.00 cap, $13.88 left, resets 1 Dec 2026 (UTC).");
    expect(nearCapWarning(monthOf(15.99, 20, 0, end))).toBeNull();
    expect(nearCapWarning(monthOf(16, 20, 0, end))).toContain("80% of this checkout's monthly cap");
    expect(nearCapWarning(monthOf(16, 20, 0, end))).toContain("dr analyzer tier1 set monthly-cap 40");
    expect(nearCapWarning(monthOf(20, 20, 0, end))).toBeNull(); // capped: the cap message says it
  });

  test("the message at the cap is the design's", () => {
    const m = monthOf(20, 20, 0, end);
    expect(isCapped(m)).toBe(true);
    expect(capMessage(m, 1240)).toBe(
      "Tier 1 reached this checkout's monthly cap: $20.00 spent of $20.00; it resets on 1 Dec 2026 (UTC). " +
        "Cached answers were still used; 1,240 cards went on without a Tier-1 answer. To raise the cap: `dr analyzer tier1 set monthly-cap 40`."
    );
  });

  test("a cap of 0 is always reached and says it sends nothing", () => {
    const m = monthOf(0, 0, 0, end);
    expect(isCapped(m)).toBe(true);
    expect(nearCapWarning(m)).toBeNull();
    expect(monthLine(m)).toContain("sends nothing and uses only cached answers");
    expect(capMessage(m, 3)).toContain("cap is $0.00, so it sent nothing");
  });

  test("formatDay is UTC", () => {
    expect(formatDay("2027-01-01T00:00:00.000Z")).toBe("1 Jan 2027");
  });
});
