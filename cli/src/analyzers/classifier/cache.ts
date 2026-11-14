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
 *
 * Files: `<root>/<qset>/<host>/<model>.jsonl`, `root` being `.dr/analyzers/<analyzer>/tier1-cache`
 * once the run loop is wired (rollout PR 3). `cache clear`, spend and the run's budget are PR 3.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
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
  readonly stats: CacheStats = { hits: 0, misses: 0, repaired: 0 };
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

  /** Every valid entry of a scope's file, the last one written winning for a key. Repairs as it reads. */
  async load(scope: CacheScope): Promise<Map<string, CacheEntry>> {
    const file = this.fileOf(scope);
    const memo = this.loaded.get(file);
    if (memo) return memo;
    const entries = await this.readFile(file);
    this.loaded.set(file, entries);
    return entries;
  }

  async get(scope: CacheScope, key: string): Promise<CacheEntry | undefined> {
    const hit = (await this.load(scope)).get(key);
    if (hit) this.stats.hits++;
    else this.stats.misses++;
    return hit;
  }

  /** Append entries to their scope's file under the cache lock. */
  async append(scope: CacheScope, entries: CacheEntry[]): Promise<void> {
    if (!entries.length) return;
    const file = this.fileOf(scope);
    await mkdir(path.dirname(file), { recursive: true });
    const text = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await new FileLock(file).withLock(
      async () => {
        const prefix = (await endsWithNewline(file)) ? "" : "\n";
        await appendFile(file, prefix + text, "utf8");
      },
      { timeout: this.lockTimeoutMs }
    );
    const memo = this.loaded.get(file);
    if (memo) for (const e of entries) memo.set(e.key, e);
  }

  /**
   * End-of-run upkeep: other question sets' files are deleted; other models' and hosts' files go
   * once they haven't been written for the retention period; the configured file keeps the keys
   * the run used and entries written within the retention period; and the whole cache is held
   * under the size ceiling, the oldest entries going first.
   */
  async compact(options: CompactOptions): Promise<CompactReport> {
    const report: CompactReport = { deletedFiles: [], droppedEntries: 0, keptEntries: 0, bytes: 0 };
    if (!existsSync(this.root)) return report;
    const used = new Set(options.usedKeys ?? []);
    const cutoff = this.now() - this.retentionMs;
    const currentQset = segment(options.currentQset);
    const configuredFile = this.fileOf({ qset: options.currentQset, host: options.configured.host, model: options.configured.model });

    for (const qsetDir of await readdir(this.root, { withFileTypes: true })) {
      const p = path.join(this.root, qsetDir.name);
      if (qsetDir.name !== currentQset) {
        await rm(p, { recursive: true, force: true });
        report.deletedFiles.push(p);
      }
    }

    const files = await this.cacheFiles(path.join(this.root, currentQset));
    const remaining: string[] = [];
    for (const file of files) {
      if (file === configuredFile) {
        remaining.push(file);
        continue;
      }
      const s = await stat(file).catch(() => null);
      if (s && s.mtimeMs < cutoff) {
        await this.deleteFile(file);
        report.deletedFiles.push(file);
      } else remaining.push(file);
    }

    if (existsSync(configuredFile)) {
      report.droppedEntries += await this.rewrite(configuredFile, (entries) =>
        entries.filter((e) => used.has(e.key) || Date.parse(e.at) >= cutoff)
      );
    }

    // Size ceiling: oldest entries first, across every remaining file.
    const sizes = await Promise.all(remaining.map(async (f) => (await stat(f).catch(() => null))?.size ?? 0));
    let total = sizes.reduce((a, b) => a + b, 0);
    if (total > this.maxBytes) {
      const all: Array<{ file: string; key: string; at: number; bytes: number }> = [];
      for (const file of remaining) {
        for (const e of (await this.readFile(file)).values()) {
          all.push({ file, key: e.key, at: Date.parse(e.at) || 0, bytes: Buffer.byteLength(JSON.stringify(e)) + 1 });
        }
      }
      all.sort((a, b) => a.at - b.at);
      const drop = new Map<string, Set<string>>();
      for (const x of all) {
        if (total <= this.maxBytes) break;
        total -= x.bytes;
        if (!drop.has(x.file)) drop.set(x.file, new Set());
        drop.get(x.file)!.add(x.key);
      }
      for (const [file, keys] of drop) {
        report.droppedEntries += await this.rewrite(file, (entries) => entries.filter((e) => !keys.has(e.key)));
      }
    }

    for (const file of remaining) {
      if (!existsSync(file)) continue;
      report.keptEntries += (await this.readFile(file)).size;
      report.bytes += (await stat(file)).size;
    }
    this.loaded.clear();
    return report;
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
        const entries = [...(await this.readFile(file, true)).values()];
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
   * Parse a file, skipping (and counting) bad lines. A file that can't be read, or that holds an
   * entry of another format version, is deleted and read as empty: the run rebuilds it.
   * `locked`: the caller already holds the file's lock.
   */
  private async readFile(file: string, locked = false): Promise<Map<string, CacheEntry>> {
    const out = new Map<string, CacheEntry>();
    const discard = async () => {
      this.stats.repaired++;
      const remove = () => rm(file, { recursive: true, force: true });
      await (locked ? remove() : new FileLock(file).withLock(remove, { timeout: this.lockTimeoutMs })).catch(() => undefined);
      this.loaded.delete(file);
      return new Map<string, CacheEntry>();
    };
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return out;
      return discard();
    }
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
    return out;
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
