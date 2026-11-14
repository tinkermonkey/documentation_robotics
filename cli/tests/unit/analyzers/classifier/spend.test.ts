/**
 * The spend ledger, the UTC month window and the cap's messages (TIER1_DESIGN.md section 4.3).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
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
