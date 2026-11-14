/**
 * Tier 1's decision cache (TIER1_DESIGN.md section 4.1). It needs no attention:
 *
 * - **Correct by construction.** The key is SHA-256 of everything the model sees: the cache format
 *   version, the question set id, the canonical model and serving host, the criteria digest, the
 *   narrowing and SHA-256 of the rendered state. A hit is an answer to the same request.
 * - **Raw entries, normalised on read.** An entry holds the provider's answers as sent, with the
 *   question shapes they answer; the reader normalises them through the adapter, so a fix to an
 *   adapter's parsing applies to cached entries too.
 * - **Self-repair.** A torn or garbled line is skipped and counted (`stats.repaired`); a file that
 *   can't be read, or an entry of another format version, makes the file be deleted and rebuilt.
 *   An append after a torn last line starts on a new line.
 * - **Concurrent writers.** Appends and compaction take a short lock of the cache's own
 *   (`FileLock`), never across a network call; compaction writes a new file and renames it over
 *   the old one, so a reader sees one or the other, never half.
 * - **Never in the way.** No cache method a run calls throws: a file that can't be read right now (EACCES,
 *   EBUSY, EMFILE) is a miss and is left alone, a write that doesn't land is counted
 *   (`stats.errors`) and asked again next time, and compaction lists the steps it skipped.
 *
 * Files: `<root>/<qset>/<host>/<model>.jsonl`, `root` being `.dr/analyzers/<analyzer>/tier1-cache`
 * (`tier1Paths`). `status` and `clear` serve `dr analyzer tier1 cache status|clear`; a full run
 * compacts at its end and records the report (`compaction.json`) for `status`.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FileLock } from "../../utils/file-lock.js";
import type { AskResult, DecisionModel } from "./decision-model/types.js";
import type { RawStage } from "./run.js";

/** Bumped when the entry layout changes; entries of another version are discarded. */
export const CACHE_FORMAT_VERSION = 1;

/** Days an entry (or another model's or host's file) is kept after it was last written. */
export const DEFAULT_RETENTION_DAYS = 30;
/** Hard ceiling across the cache; the oldest entries go first. */
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export interface CacheKeyParts {
  qset: string;
  /** Canonical model (`clef`): what thresholds key on. */
  canonicalModel: string;
  /** Serving host: `cloudflare-workers-ai`, an OpenRouter upstream, or `any`. */
  host: string;
  criteriaDigest: string;
  /** Sorted candidate list (`qset/v1.ts` `narrowingKey`), or null. */
  narrowing: string[] | null;
  /** The rendered state, exactly as sent. */
  state: string;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function cacheKey(parts: CacheKeyParts): string {
  return sha256(
    JSON.stringify([
      CACHE_FORMAT_VERSION,
      parts.qset,
      parts.canonicalModel,
      parts.host,
      parts.criteriaDigest,
      parts.narrowing ? [...parts.narrowing].sort() : null,
      sha256(parts.state),
    ])
  );
}

/** Which file an entry lives in. */
export interface CacheScope {
  qset: string;
  host: string;
  /** Canonical model. */
  model: string;
}

const ShapeSchema = z.object({ type: z.enum(["choice", "score", "noul"]), levels: z.number().optional() });
const EntrySchema = z.object({
  v: z.number(),
  key: z.string().regex(/^[0-9a-f]{64}$/),
  at: z.string(),
  qset: z.string(),
  model: z.string(),
  host: z.string(),
  criteriaDigest: z.string(),
  specVersion: z.string().optional(),
  stages: z
    .array(
      z.object({
        shapes: z.record(z.string(), ShapeSchema),
        layer: z.string().optional(),
        raw: z.record(z.string(), z.record(z.string(), z.unknown())),
      })
    )
    .min(1),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number().optional(), costUsd: z.number().optional() }),
  servedBy: z.object({ upstream: z.string().optional(), model: z.string().optional() }).optional(),
});

/** One cached card decision: the raw answers of its stages. */
export interface CacheEntry {
  v: number;
  key: string;
  /** ISO time it was written. */
  at: string;
  qset: string;
  model: string;
  host: string;
  criteriaDigest: string;
  /** Recorded, deliberately not keyed. */
  specVersion?: string;
  stages: RawStage[];
  usage: { inputTokens: number; outputTokens?: number; costUsd?: number };
  servedBy?: { upstream?: string; model?: string };
}

export interface CacheStats {
  hits: number;
  misses: number;
  /** Lines skipped or files rebuilt by self-repair. */
  repaired: number;
  /**
   * Cache operations that failed (a file busy or unreadable for now, a lock not taken, a write
   * that didn't land). Never an error for the caller: a failed read is a miss, a failed write is
   * asked again next time.
   */
  errors: number;
}

export interface CompactOptions {
  /** The current question set: other question sets' files are deleted. */
  currentQset: string;
  /** The configured host and model: other hosts' and models' files go after the retention period. */
  configured: { host: string; model: string };
  /** Keys a full run used, kept whatever their age. */
  usedKeys?: Iterable<string>;
}

export interface CompactReport {
  deletedFiles: string[];
  droppedEntries: number;
  keptEntries: number;
  bytes: number;
  /** Steps that failed and were skipped; compaction never throws. */
  errors: string[];
}

/** The last compaction's report, beside the cache's question-set folders. */
export const COMPACTION_FILE = "compaction.json";

export interface CacheFileStatus {
  qset: string;
  host: string;
  /** Canonical model. */
  model: string;
  file: string;
  entries: number;
  bytes: number;
  lastWrite: string | null;
  /** What its answers cost when they were asked. */
  costUsd: number;
}

export interface CacheStatus {
  root: string;
  files: CacheFileStatus[];
  entries: number;
  bytes: number;
  costUsd: number;
  lastCompaction: { at: string; deletedFiles: string[]; droppedEntries: number; keptEntries: number; bytes: number; errors: number } | null;
}

/** The cache in brief ({@link Tier1Cache.peek}): file count, bytes, lines, the last compaction's time. */
export interface CachePeek {
  files: number;
  /** Lines across the files (an entry is one line; see `peek`). */
  entries: number;
  bytes: number;
  lastCompaction: string | null;
}

/** Line counts by file, valid while the file's size and modification time are unchanged. */
const lineCounts = new Map<string, { size: number; mtimeMs: number; lines: number }>();

/** Newline-terminated lines in a file, streamed (never held whole), remembered by size and mtime. */
async function countLines(file: string, size: number, mtimeMs: number): Promise<number> {
  const known = lineCounts.get(file);
  if (known && known.size === size && known.mtimeMs === mtimeMs) return known.lines;
  let lines = 0;
  try {
    for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
      for (let i = chunk.indexOf(0x0a); i !== -1; i = chunk.indexOf(0x0a, i + 1)) lines++;
    }
  } catch {
    return 0; // unreadable this time: counted as empty, not remembered
  }
  lineCounts.set(file, { size, mtimeMs, lines });
  return lines;
}

export interface Tier1CacheOptions {
  now?: () => number;
  retentionDays?: number;
  maxBytes?: number;
  lockTimeoutMs?: number;
}

/** A path segment safe on every filesystem. */
function segment(s: string): string {
  const clean = s.replace(/[^A-Za-z0-9._+-]/g, "_");
  return clean && clean !== "." && clean !== ".." ? clean : "_";
}

export class Tier1Cache {
  readonly root: string;
  readonly stats: CacheStats = { hits: 0, misses: 0, repaired: 0, errors: 0 };
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxBytes: number;
  private readonly lockTimeoutMs: number;
  private readonly loaded = new Map<string, Map<string, CacheEntry>>();

  constructor(root: string, options: Tier1CacheOptions = {}) {
    this.root = root;
    this.now = options.now ?? Date.now;
    this.retentionMs = (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  }

  fileOf(scope: CacheScope): string {
    return path.join(this.root, segment(scope.qset), segment(scope.host), `${segment(scope.model)}.jsonl`);
  }

  /** A fresh entry for a card's raw stages. */
  entry(key: string, scope: CacheScope, fields: Pick<CacheEntry, "criteriaDigest" | "stages" | "usage"> & Partial<Pick<CacheEntry, "specVersion" | "servedBy">>): CacheEntry {
    const e: CacheEntry = {
      v: CACHE_FORMAT_VERSION,
      key,
      at: new Date(this.now()).toISOString(),
      qset: scope.qset,
      model: scope.model,
      host: scope.host,
      criteriaDigest: fields.criteriaDigest,
      stages: fields.stages,
      usage: fields.usage,
    };
    if (fields.specVersion !== undefined) e.specVersion = fields.specVersion;
    if (fields.servedBy && (fields.servedBy.model || fields.servedBy.upstream)) e.servedBy = fields.servedBy;
    return e;
  }

  /**
   * Every valid entry of a scope's file, the last one written winning for a key. Repairs as it
   * reads. Never throws: a file that can't be read right now reads as empty (every key a miss) and
   * is read again next time.
   */
  async load(scope: CacheScope): Promise<Map<string, CacheEntry>> {
    const file = this.fileOf(scope);
    const memo = this.loaded.get(file);
    if (memo) return memo;
    try {
      const { entries, transient } = await this.readFile(file);
      if (!transient) this.loaded.set(file, entries);
      return entries;
    } catch {
      this.stats.errors++;
      return new Map();
    }
  }

  /** The entry for a key, or undefined (a miss, also when the cache can't be read). Never throws. */
  async get(scope: CacheScope, key: string): Promise<CacheEntry | undefined> {
    const hit = (await this.load(scope)).get(key);
    if (hit) this.stats.hits++;
    else this.stats.misses++;
    return hit;
  }

  /**
   * Append entries to their scope's file under the cache lock. Never throws: a write that doesn't
   * land is counted in `stats.errors` and the cards are asked again next time. A directory removed
   * by a concurrent compaction is recreated.
   */
  async append(scope: CacheScope, entries: CacheEntry[]): Promise<boolean> {
    if (!entries.length) return true;
    const file = this.fileOf(scope);
    const text = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await new FileLock(file).withLock(
          async () => {
            const prefix = (await endsWithNewline(file)) ? "" : "\n";
            await appendFile(file, prefix + text, "utf8");
          },
          { timeout: this.lockTimeoutMs }
        );
        const memo = this.loaded.get(file);
        if (memo) for (const e of entries) memo.set(e.key, e);
        return true;
      } catch {
        // the folder vanished under us (a compaction removed an old question set), or the lock
        // wasn't taken in time: try again, then give up quietly
      }
    }
    this.stats.errors++;
    return false;
  }

  /**
   * End-of-run upkeep: other question sets' files are deleted; other models' and hosts' files go
   * once they haven't been written for the retention period; the configured file keeps the keys
   * the run used and entries written within the retention period; and the whole cache is held
   * under the size ceiling, the oldest entries going first. Every file is changed under its lock.
   * Never throws: a step that fails is listed in `errors` and skipped.
   */
  async compact(options: CompactOptions): Promise<CompactReport> {
    const report: CompactReport = { deletedFiles: [], droppedEntries: 0, keptEntries: 0, bytes: 0, errors: [] };
    const step = async (what: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        report.errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    if (!existsSync(this.root)) return report;
    const used = new Set(options.usedKeys ?? []);
    const cutoff = this.now() - this.retentionMs;
    const currentQset = segment(options.currentQset);
    const configuredFile = this.fileOf({ qset: options.currentQset, host: options.configured.host, model: options.configured.model });

    // Other question sets: each file deleted under its lock (so no append is mid-write), then the
    // folder. An append that arrives after recreates the folder; the next compaction removes it.
    await step("list question sets", async () => {
      for (const qsetDir of await readdir(this.root, { withFileTypes: true })) {
        if (!qsetDir.isDirectory() || qsetDir.name === currentQset) continue;
        const dir = path.join(this.root, qsetDir.name);
        await step(`delete ${dir}`, async () => {
          for (const file of await this.cacheFiles(dir)) await this.deleteFile(file);
          await rm(dir, { recursive: true, force: true });
          report.deletedFiles.push(dir);
        });
      }
    });

    let files: string[] = [];
    await step("list files", async () => {
      files = await this.cacheFiles(path.join(this.root, currentQset));
    });
    const remaining: string[] = [];
    for (const file of files) {
      if (file === configuredFile) {
        remaining.push(file);
        continue;
      }
      const s = await stat(file).catch(() => null);
      if (s && s.mtimeMs < cutoff) {
        await step(`delete ${file}`, async () => {
          await this.deleteFile(file);
          report.deletedFiles.push(file);
        });
      } else remaining.push(file);
    }

    if (existsSync(configuredFile)) {
      await step(`compact ${configuredFile}`, async () => {
        report.droppedEntries += await this.rewrite(configuredFile, (entries) => entries.filter((e) => used.has(e.key) || Date.parse(e.at) >= cutoff));
      });
    }

    // Size ceiling, measured on the deduplicated entries (torn lines and superseded duplicates
    // don't count, and every file is rewritten without them); oldest entries go first.
    await step("size ceiling", async () => {
      const sizes = await Promise.all(remaining.map(async (f) => (await stat(f).catch(() => null))?.size ?? 0));
      if (sizes.reduce((a, b) => a + b, 0) <= this.maxBytes) return;
      const all: Array<{ file: string; key: string; at: number; bytes: number }> = [];
      for (const file of remaining) {
        const { entries, transient } = await this.readFile(file);
        if (transient) throw new Error(`${file} could not be read`);
        for (const e of entries.values()) all.push({ file, key: e.key, at: Date.parse(e.at) || 0, bytes: Buffer.byteLength(JSON.stringify(e)) + 1 });
      }
      let total = all.reduce((a, x) => a + x.bytes, 0);
      all.sort((a, b) => a.at - b.at);
      const drop = new Set<string>();
      for (const x of all) {
        if (total <= this.maxBytes) break;
        total -= x.bytes;
        drop.add(`${x.file}\u0000${x.key}`);
      }
      for (const file of remaining) {
        report.droppedEntries += await this.rewrite(file, (entries) => entries.filter((e) => !drop.has(`${file}\u0000${e.key}`)));
      }
    });

    for (const file of remaining) {
      if (!existsSync(file)) continue;
      await step(`measure ${file}`, async () => {
        report.keptEntries += (await this.readFile(file)).entries.size;
        report.bytes += (await stat(file)).size;
      });
    }
    this.loaded.clear();
    return report;
  }

  /** Record a compaction's report beside the cache, for `cache status`. Never throws. */
  async recordCompaction(report: CompactReport): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true });
      const at = new Date(this.now()).toISOString();
      await writeFile(path.join(this.root, COMPACTION_FILE), JSON.stringify({ at, ...report, errors: report.errors.length }) + "\n", "utf8");
    } catch {
      this.stats.errors++;
    }
  }

  /**
   * What the cache holds in brief, strictly read-only, for the status views (`tier1Status`: the
   * `tier1_status` tool, `GET /api/tier1`, `dr analyzer tier1 status`), which a process of another
   * CLI version may serve. Unlike {@link status} it never parses an entry, so it never discards a
   * file (of another format version, say), takes a lock or writes: it lists the files, takes their
   * sizes, and counts their lines, streamed and remembered per file by size and modification time.
   * `entries` counts lines, so it includes lines a compaction would drop (torn, duplicate, other
   * versions); `dr analyzer tier1 cache status` has the exact count.
   */
  async peek(): Promise<CachePeek> {
    const out: CachePeek = { files: 0, entries: 0, bytes: 0, lastCompaction: null };
    if (!existsSync(this.root)) return out;
    for (const qsetDir of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
      if (!qsetDir.isDirectory()) continue;
      for (const file of await this.cacheFiles(path.join(this.root, qsetDir.name)).catch(() => [] as string[])) {
        const s = await stat(file).catch(() => null);
        if (!s?.isFile()) continue;
        out.files++;
        out.bytes += s.size;
        out.entries += await countLines(file, s.size, s.mtimeMs);
      }
    }
    try {
      const last = JSON.parse(await readFile(path.join(this.root, COMPACTION_FILE), "utf8"));
      if (last && typeof last.at === "string") out.lastCompaction = last.at;
    } catch {
      // never compacted, or the record is unreadable: nothing to show
    }
    return out;
  }

  /** What the cache holds, per file: for `dr analyzer tier1 cache status`. */
  async status(): Promise<CacheStatus> {
    const out: CacheStatus = { root: this.root, files: [], entries: 0, bytes: 0, costUsd: 0, lastCompaction: null };
    if (!existsSync(this.root)) return out;
    for (const qsetDir of await readdir(this.root, { withFileTypes: true })) {
      if (!qsetDir.isDirectory()) continue;
      for (const file of await this.cacheFiles(path.join(this.root, qsetDir.name))) {
        const s = await stat(file).catch(() => null);
        const { entries } = await this.readFile(file);
        let costUsd = 0;
        for (const e of entries.values()) costUsd += e.usage.costUsd ?? 0;
        out.files.push({
          qset: qsetDir.name,
          host: path.basename(path.dirname(file)),
          model: path.basename(file, ".jsonl"),
          file,
          entries: entries.size,
          bytes: s?.size ?? 0,
          lastWrite: s ? new Date(s.mtimeMs).toISOString() : null,
          costUsd: Math.round(costUsd * 1e6) / 1e6,
        });
        out.entries += entries.size;
        out.bytes += s?.size ?? 0;
        out.costUsd += costUsd;
      }
    }
    out.files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    out.costUsd = Math.round(out.costUsd * 1e6) / 1e6;
    try {
      const last = JSON.parse(await readFile(path.join(this.root, COMPACTION_FILE), "utf8"));
      if (last && typeof last.at === "string") out.lastCompaction = last;
    } catch {
      // never compacted, or the record is unreadable: nothing to show
    }
    return out;
  }

  /**
   * Delete the cache, or the files of one question set or model (`cache clear --qset/--model`).
   * Returns what went, with what those answers cost, which is what refilling them costs again.
   */
  async clear(filter: { qset?: string; model?: string } = {}): Promise<{ files: number; entries: number; bytes: number; costUsd: number }> {
    const before = await this.status();
    const qset = filter.qset !== undefined ? segment(filter.qset) : undefined;
    const model = filter.model !== undefined ? segment(filter.model) : undefined;
    const gone = before.files.filter((f) => (qset === undefined || f.qset === qset) && (model === undefined || f.model === model));
    for (const f of gone) await this.deleteFile(f.file);
    if (qset === undefined && model === undefined) await rm(this.root, { recursive: true, force: true });
    else {
      // Folders left empty go too.
      for (const dir of new Set(gone.map((f) => path.dirname(f.file)))) {
        if (existsSync(dir) && (await readdir(dir)).every((n) => n.endsWith(".lock"))) await rm(dir, { recursive: true, force: true });
        const parent = path.dirname(dir);
        if (existsSync(parent) && (await readdir(parent)).length === 0) await rm(parent, { recursive: true, force: true });
      }
    }
    this.loaded.clear();
    return {
      files: gone.length,
      entries: gone.reduce((a, f) => a + f.entries, 0),
      bytes: gone.reduce((a, f) => a + f.bytes, 0),
      costUsd: Math.round(gone.reduce((a, f) => a + f.costUsd, 0) * 1e6) / 1e6,
    };
  }

  /** Every `.jsonl` file under a directory (host directories one level down). */
  private async cacheFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const host of await readdir(dir, { withFileTypes: true })) {
      if (!host.isDirectory()) continue;
      for (const f of await readdir(path.join(dir, host.name), { withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith(".jsonl")) out.push(path.join(dir, host.name, f.name));
      }
    }
    return out.sort();
  }

  /** Rewrite a file under its lock, through `keep`; returns how many entries were dropped. */
  private async rewrite(file: string, keep: (entries: CacheEntry[]) => CacheEntry[]): Promise<number> {
    return new FileLock(file).withLock(
      async () => {
        const { entries: read, transient } = await this.readFile(file, true);
        if (transient) throw new Error(`${file} could not be read`);
        const entries = [...read.values()];
        const kept = keep(entries);
        const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
        await writeFile(tmp, kept.map((e) => JSON.stringify(e) + "\n").join(""), "utf8");
        await rename(tmp, file);
        this.loaded.delete(file);
        return entries.length - kept.length;
      },
      { timeout: this.lockTimeoutMs }
    );
  }

  private async deleteFile(file: string): Promise<void> {
    await new FileLock(file).withLock(() => rm(file, { force: true }), { timeout: this.lockTimeoutMs });
    this.loaded.delete(file);
  }

  /**
   * Parse a file, skipping (and counting) bad lines. Corruption (a directory where the file
   * should be, an entry of another format version) deletes the file: it reads as empty and the run
   * rebuilds it. Any other read error (EACCES, EBUSY, EMFILE, ...) is `transient`: the file reads
   * as empty this time and is left alone. `locked`: the caller already holds the file's lock.
   */
  private async readFile(file: string, locked = false): Promise<{ entries: Map<string, CacheEntry>; transient: boolean }> {
    const discard = async () => {
      this.stats.repaired++;
      const remove = () => rm(file, { recursive: true, force: true });
      await (locked ? remove() : new FileLock(file).withLock(remove, { timeout: this.lockTimeoutMs })).catch(() => undefined);
      this.loaded.delete(file);
      return { entries: new Map<string, CacheEntry>(), transient: false };
    };
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { entries: new Map(), transient: false };
      if (code === "EISDIR") return discard();
      this.stats.errors++;
      return { entries: new Map(), transient: true };
    }
    const out = new Map<string, CacheEntry>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        this.stats.repaired++; // a torn or garbled line
        continue;
      }
      const v = json && typeof json === "object" ? (json as { v?: unknown }).v : undefined;
      if (typeof v === "number" && v !== CACHE_FORMAT_VERSION) return discard();
      const parsed = EntrySchema.safeParse(json);
      if (!parsed.success) {
        this.stats.repaired++;
        continue;
      }
      out.set(parsed.data.key, parsed.data as CacheEntry);
    }
    return { entries: out, transient: false };
  }
}

/** A cached entry's stages with their answers normalised by the model's adapter (raw stays as stored). */
export function normaliseEntry(entry: CacheEntry, model: Pick<DecisionModel, "normalise">): Array<RawStage & Pick<AskResult, "answers" | "malformed">> {
  return entry.stages.map((s) => ({ ...s, ...model.normalise(s.raw, s.shapes) }));
}

/** True when the file is missing, empty, or ends with a newline. */
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
