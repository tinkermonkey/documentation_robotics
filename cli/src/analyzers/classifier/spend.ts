/**
 * Tier 1's spend: the per-checkout ledger, the calendar month (UTC) and the monthly cap
 * (TIER1_DESIGN.md section 4.3, decisions 6 and 16).
 *
 * - **Ledger**: `.dr/analyzers/<analyzer>/tier1-spend.jsonl`, one line per card asked, written as
 *   it finishes so an interrupted run loses at most its in-flight cards (`at`, `source`,
 *   `provider`, `model`, `upstream`, `cards`, `inputTokens`, `costUsd`). Appends take a short
 *   lock; a torn or garbled line is skipped on read.
 * - **Window**: the calendar month in UTC; the month's total is summed on read.
 * - **Cap**: `monthlyCapUsd` in `tier1.json`, $20 by default. At the cap Tier 1 sends nothing more
 *   and cached answers are still used; a cap of 0 sends nothing; 80% of the cap adds a warning.
 *
 * The ledger is per checkout: it can't see spend from other clones or machines on the same account.
 */
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { FileLock } from "../../utils/file-lock.js";
import { formatUsd } from "./config.js";
import type { Tier1Month } from "./types.js";

export type SpendSource = "extract" | "index" | "classify" | "probe";

export interface SpendEntry {
  at: string;
  source: SpendSource;
  provider: string;
  model: string;
  upstream?: string;
  cards: number;
  inputTokens: number;
  costUsd: number;
}

/**
 * What a card costs before the cache has any to average: Clef on Workers AI, both stages, from the
 * classify-eval harness ($0.0011-0.0017 a card); the upper half, so the estimate errs on asking less.
 */
export const DEFAULT_CARD_COST_USD = 0.0014;

/** The share of the cap at which the notice warns. */
export const WARN_SHARE = 0.8;

/** The UTC calendar month holding `now`: its first instant and the next month's. */
export function monthWindow(now: number): { start: number; end: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

const SOURCES = new Set<SpendSource>(["extract", "index", "classify", "probe"]);

function isEntry(v: unknown): v is SpendEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.at === "string" &&
    !Number.isNaN(Date.parse(e.at)) &&
    SOURCES.has(e.source as SpendSource) &&
    typeof e.provider === "string" &&
    typeof e.model === "string" &&
    typeof e.cards === "number" &&
    typeof e.inputTokens === "number" &&
    typeof e.costUsd === "number" &&
    Number.isFinite(e.costUsd) &&
    e.costUsd >= 0
  );
}

export interface SpendLedgerOptions {
  now?: () => number;
  lockTimeoutMs?: number;
}

export class SpendLedger {
  readonly file: string;
  private readonly now: () => number;
  private readonly lockTimeoutMs: number;
  /** Lines skipped on the last read (torn or garbled). */
  skipped = 0;

  constructor(file: string, options: SpendLedgerOptions = {}) {
    this.file = file;
    this.now = options.now ?? Date.now;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  }

  /** Append one batch. Throws if it can't be written: spend that isn't recorded would let a run pass the cap. */
  async record(entry: Omit<SpendEntry, "at"> & { at?: string }): Promise<SpendEntry> {
    const line: SpendEntry = {
      at: entry.at ?? new Date(this.now()).toISOString(),
      source: entry.source,
      provider: entry.provider,
      model: entry.model,
      ...(entry.upstream ? { upstream: entry.upstream } : {}),
      cards: entry.cards,
      inputTokens: entry.inputTokens,
      costUsd: round6(entry.costUsd),
    };
    await mkdir(path.dirname(this.file), { recursive: true });
    await new FileLock(this.file).withLock(
      async () => {
        const prefix = (await endsWithNewline(this.file)) ? "" : "\n"; // after a torn last line
        await appendFile(this.file, prefix + JSON.stringify(line) + "\n", "utf8");
      },
      { timeout: this.lockTimeoutMs }
    );
    return line;
  }

  /** Every readable entry, oldest first. */
  async entries(): Promise<SpendEntry[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: SpendEntry[] = [];
    this.skipped = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line);
        if (isEntry(v)) out.push(v);
        else this.skipped++;
      } catch {
        this.skipped++;
      }
    }
    return out;
  }

  /** This month's spend (UTC window) against a cap. */
  async month(capUsd: number): Promise<Tier1Month> {
    const { start, end } = monthWindow(this.now());
    let spent = 0;
    let cards = 0;
    for (const e of await this.entries()) {
      const at = Date.parse(e.at);
      if (at >= start && at < end) {
        spent += e.costUsd;
        cards += e.cards;
      }
    }
    return monthOf(spent, capUsd, cards, end);
  }
}

/** True when the file is missing, empty, or ends with a newline (reads one byte). */
async function endsWithNewline(file: string): Promise<boolean> {
  let fh;
  try {
    fh = await open(file, "r");
  } catch {
    return true;
  }
  try {
    const { size } = await fh.stat();
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await fh.close();
  }
}

export function monthOf(spentUsd: number, capUsd: number, cards: number, end: number): Tier1Month {
  const spent = round6(spentUsd);
  return { spentUsd: spent, capUsd, remainingUsd: round6(Math.max(0, capUsd - spent)), resetsAt: new Date(end).toISOString(), cards };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** True once the month's spend reaches the cap (a cap of 0 is always reached). */
export function isCapped(month: Tier1Month): boolean {
  return month.remainingUsd <= 0;
}

/** True at 80% of the cap or more (and not for a cap of 0, which sends nothing by choice). */
export function nearCap(month: Tier1Month): boolean {
  return month.capUsd > 0 && month.spentUsd >= WARN_SHARE * month.capUsd;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `1 Dec 2026`, in UTC. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `This month: $6.12 of the $20.00 cap, $13.88 left, resets 1 Dec 2026 (UTC).` */
export function monthLine(month: Tier1Month): string {
  if (month.capUsd === 0) {
    return `The monthly cap is $0.00: Tier 1 sends nothing and uses only cached answers (${formatUsd(month.spentUsd)} spent this month).`;
  }
  return `This month: ${formatUsd(month.spentUsd)} of the ${formatUsd(month.capUsd)} cap, ${formatUsd(month.remainingUsd)} left, resets ${formatDay(month.resetsAt)} (UTC).`;
}

/** The 80% warning, or null. */
export function nearCapWarning(month: Tier1Month): string | null {
  if (!nearCap(month) || isCapped(month)) return null;
  const share = Math.floor((100 * month.spentUsd) / month.capUsd);
  return `Tier 1 has used ${share}% of this checkout's monthly cap (${formatUsd(month.spentUsd)} of ${formatUsd(month.capUsd)}). To raise it: \`dr analyzer tier1 set monthly-cap ${suggestCap(month.capUsd)}\`.`;
}

/**
 * The message at the cap (section 4.3), addressed to the user: an agent relays it and doesn't
 * change the cap itself. `unanswered`: cards that went on without a Tier-1 answer because of it.
 */
export function capMessage(month: Tier1Month, unanswered: number): string {
  if (month.capUsd === 0) {
    return `Tier 1's monthly cap is $0.00, so it sent nothing: cached answers were used; ${unanswered.toLocaleString("en-US")} card${unanswered === 1 ? "" : "s"} went on without a Tier-1 answer. To let it ask: \`dr analyzer tier1 set monthly-cap 20\`.`;
  }
  return (
    `Tier 1 reached this checkout's monthly cap: ${formatUsd(month.spentUsd)} spent of ${formatUsd(month.capUsd)}; it resets on ${formatDay(month.resetsAt)} (UTC). ` +
    `Cached answers were still used; ${unanswered.toLocaleString("en-US")} card${unanswered === 1 ? "" : "s"} went on without a Tier-1 answer. ` +
    `To raise the cap: \`dr analyzer tier1 set monthly-cap ${suggestCap(month.capUsd)}\`.`
  );
}

/** Double the cap, as a whole number of dollars. */
function suggestCap(cap: number): number {
  return Math.max(1, Math.ceil(cap * 2));
}
