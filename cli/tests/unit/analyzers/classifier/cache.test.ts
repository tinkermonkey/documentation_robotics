import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CACHE_FORMAT_VERSION,
  cacheKey,
  normaliseEntry,
  Tier1Cache,
  type CacheEntry,
  type CacheKeyParts,
  type CacheScope,
} from "../../../../src/analyzers/classifier/index.js";
import { FakeDecisionModel } from "../../../helpers/fake-decision-model.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "dr-tier1-cache-"));
  dirs.push(d);
  return d;
}

const DAY = 24 * 60 * 60 * 1000;
const SCOPE: CacheScope = { qset: "dr-qset-1", host: "cloudflare-workers-ai", model: "clef" };
const PARTS: CacheKeyParts = {
  qset: "dr-qset-1",
  canonicalModel: "clef",
  host: "cloudflare-workers-ai",
  criteriaDigest: "c".repeat(64),
  narrowing: ["application.dataobject"],
  state: "Symbol kind: Class\nName: Foo",
};

function entryFor(cache: Tier1Cache, key: string, scope: CacheScope = SCOPE): CacheEntry {
  return cache.entry(key, scope, {
    criteriaDigest: PARTS.criteriaDigest,
    specVersion: "0.12.0",
    stages: [
      {
        shapes: { layer: { type: "choice" }, significance: { type: "score", levels: 5 } },
        raw: { layer: { choice: "application", probabilities: { application: 0.7, none: 0.3 } }, significance: { score: 7 } },
      },
      { shapes: { element_type: { type: "choice" } }, layer: "application", raw: { element_type: { probabilities: { dataobject: 0.6, none: 0.4 } } } },
    ],
    usage: { inputTokens: 3000, costUsd: 0.00072 },
  });
}

const key = (i: number) => cacheKey({ ...PARTS, state: `state ${i}` });

describe("cache key", () => {
  test("changes with each of question set, model, host, criteria, narrowing and state", () => {
    const base = cacheKey(PARTS);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    const variants: Array<Partial<CacheKeyParts>> = [
      { qset: "dr-qset-2" },
      { canonicalModel: "clef-flash" },
      { host: "DeepInfra" },
      { criteriaDigest: "d".repeat(64) },
      { narrowing: ["application.applicationinterface"] },
      { narrowing: null },
      { state: PARTS.state + " " },
    ];
    for (const v of variants) expect(cacheKey({ ...PARTS, ...v })).not.toBe(base);
  });

  test("changes with nothing else: narrowing order, and the spec version (not keyed)", () => {
    expect(cacheKey({ ...PARTS, narrowing: ["b.x", "a.*"] })).toBe(cacheKey({ ...PARTS, narrowing: ["a.*", "b.x"] }));
    const withSpec = { ...PARTS, specVersion: "9.9.9" } as CacheKeyParts;
    expect(cacheKey(withSpec)).toBe(cacheKey(PARTS));
  });
});

describe("entries", () => {
  test("round-trip through the file, normalised on read through the adapter", async () => {
    const root = tmp();
    const cache = new Tier1Cache(root);
    const k = cacheKey(PARTS);
    await cache.append(SCOPE, [entryFor(cache, k)]);
    expect(existsSync(path.join(root, "dr-qset-1", "cloudflare-workers-ai", "clef.jsonl"))).toBe(true);

    const fresh = new Tier1Cache(root);
    const e = await fresh.get(SCOPE, k);
    expect(e?.v).toBe(CACHE_FORMAT_VERSION);
    expect(e?.specVersion).toBe("0.12.0");
    expect(await fresh.get(SCOPE, key(99))).toBeUndefined();
    expect(fresh.stats).toEqual({ hits: 1, misses: 1, repaired: 0 });

    const stages = normaliseEntry(e!, new FakeDecisionModel());
    expect(stages[0].answers.layer).toEqual({ type: "choice", probabilities: { application: 0.7, none: 0.3 } });
    // the raw 1..N score is clamped by today's parser, though it was stored as sent
    expect(stages[0].answers.significance).toEqual({ type: "score", score: 4, distribution: null });
    expect(stages[0].raw.significance).toEqual({ score: 7 });
    expect(stages[1].answers.element_type).toEqual({ type: "choice", probabilities: { dataobject: 0.6, none: 0.4 } });
  });

  test("the last entry written for a key wins", async () => {
    const root = tmp();
    const cache = new Tier1Cache(root);
    const k = cacheKey(PARTS);
    const a = entryFor(cache, k);
    const b = { ...entryFor(cache, k), usage: { inputTokens: 1 } };
    await cache.append(SCOPE, [a]);
    await cache.append(SCOPE, [b]);
    expect((await new Tier1Cache(root).get(SCOPE, k))?.usage.inputTokens).toBe(1);
  });
});

describe("self-repair", () => {
  test("a torn last line is skipped and counted, and the next append starts on a new line", async () => {
    const root = tmp();
    const cache = new Tier1Cache(root);
    await cache.append(SCOPE, [entryFor(cache, key(1))]);
    const file = cache.fileOf(SCOPE);
    appendFileSync(file, JSON.stringify(entryFor(cache, key(2))).slice(0, 80)); // a crash mid-write

    const reader = new Tier1Cache(root);
    expect((await reader.load(SCOPE)).size).toBe(1);
    expect(reader.stats.repaired).toBe(1);

    await reader.append(SCOPE, [entryFor(reader, key(3))]);
    const after = new Tier1Cache(root);
    const loaded = await after.load(SCOPE);
    expect([...loaded.keys()].sort()).toEqual([key(1), key(3)].sort());
    expect(after.stats.repaired).toBe(1);
  });

  test("garbled lines and entries that don't match the schema are skipped", async () => {
    const root = tmp();
    const cache = new Tier1Cache(root);
    const file = cache.fileOf(SCOPE);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      [
        "\u0000\u0001garbage",
        JSON.stringify({ v: CACHE_FORMAT_VERSION, key: "not-a-hash" }),
        JSON.stringify(entryFor(cache, key(1))),
        "{",
      ].join("\n") + "\n"
    );
    const loaded = await cache.load(SCOPE);
    expect([...loaded.keys()]).toEqual([key(1)]);
    expect(cache.stats.repaired).toBe(3);
  });

  test("a format-version mismatch deletes the file, silently", async () => {
    const root = tmp();
    const cache = new Tier1Cache(root);
    const file = cache.fileOf(SCOPE);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ ...entryFor(cache, key(1)), v: CACHE_FORMAT_VERSION + 1 }) + "\n");
    expect((await cache.load(SCOPE)).size).toBe(0);
    expect(cache.stats.repaired).toBe(1);
    expect(existsSync(file)).toBe(false);
    await cache.append(SCOPE, [entryFor(cache, key(2))]);
    expect([...(await new Tier1Cache(root).load(SCOPE)).keys()]).toEqual([key(2)]);
  });

  test("a file that can't be read is deleted and rebuilt", async () => {
    const root = tmp();
    const cache = new Tier1Cache(root);
    const file = cache.fileOf(SCOPE);
    mkdirSync(file, { recursive: true }); // a directory where the file should be
    expect((await cache.load(SCOPE)).size).toBe(0);
    expect(cache.stats.repaired).toBe(1);
    await cache.append(SCOPE, [entryFor(cache, key(1))]);
    expect((await new Tier1Cache(root).load(SCOPE)).size).toBe(1);
  });
});

describe("compaction", () => {
  test("keeps used keys and recent entries, drops the rest", async () => {
    const root = tmp();
    let now = Date.parse("2026-11-13T00:00:00Z");
    const cache = new Tier1Cache(root, { now: () => now });
    const old = [entryFor(cache, key(1)), entryFor(cache, key(2))];
    await cache.append(SCOPE, old);
    now += 40 * DAY;
    await cache.append(SCOPE, [entryFor(cache, key(3))]);
    const report = await cache.compact({ currentQset: "dr-qset-1", configured: { host: SCOPE.host, model: SCOPE.model }, usedKeys: [key(1)] });
    expect(report.droppedEntries).toBe(1);
    expect(report.keptEntries).toBe(2);
    expect([...(await new Tier1Cache(root).load(SCOPE)).keys()].sort()).toEqual([key(1), key(3)].sort());
  });

  test("deletes other question sets at once, and other models' or hosts' files after 30 days", async () => {
    const root = tmp();
    const now = Date.parse("2026-11-13T00:00:00Z");
    const cache = new Tier1Cache(root, { now: () => now });
    const oldQset = { ...SCOPE, qset: "dr-qset-0" };
    const flash = { ...SCOPE, model: "clef-flash" };
    const deepinfra = { ...SCOPE, host: "DeepInfra" };
    await cache.append(oldQset, [entryFor(cache, key(1), oldQset)]);
    await cache.append(flash, [entryFor(cache, key(2), flash)]);
    await cache.append(deepinfra, [entryFor(cache, key(3), deepinfra)]);
    await cache.append(SCOPE, [entryFor(cache, key(4))]);
    const stale = (now - 31 * DAY) / 1000;
    utimesSync(cache.fileOf(flash), stale, stale);

    const report = await cache.compact({ currentQset: "dr-qset-1", configured: { host: SCOPE.host, model: SCOPE.model } });
    expect(existsSync(path.join(root, "dr-qset-0"))).toBe(false);
    expect(existsSync(cache.fileOf(flash))).toBe(false);
    expect(existsSync(cache.fileOf(deepinfra))).toBe(true);
    expect(existsSync(cache.fileOf(SCOPE))).toBe(true);
    expect(report.deletedFiles).toHaveLength(2);
  });

  test("holds the size ceiling, oldest entries first", async () => {
    const root = tmp();
    let now = Date.parse("2026-11-13T00:00:00Z");
    const one = JSON.stringify(entryFor(new Tier1Cache(root), key(0))).length + 1;
    const cache = new Tier1Cache(root, { now: () => now, maxBytes: one * 3 + 10 });
    for (let i = 0; i < 6; i++) {
      now += 1000;
      await cache.append(SCOPE, [entryFor(cache, key(i))]);
    }
    const report = await cache.compact({ currentQset: "dr-qset-1", configured: { host: SCOPE.host, model: SCOPE.model }, usedKeys: [0, 1, 2, 3, 4, 5].map(key) });
    expect(report.keptEntries).toBe(3);
    expect(statSync(cache.fileOf(SCOPE)).size).toBeLessThanOrEqual(one * 3 + 10);
    expect([...(await new Tier1Cache(root).load(SCOPE)).keys()].sort()).toEqual([key(3), key(4), key(5)].sort());
  });

  test("an append racing a compaction in another process loses nothing", async () => {
    const root = tmp();
    const cacheModule = path.resolve(import.meta.dir, "../../../../src/analyzers/classifier/cache.ts");
    const child = path.join(root, "append-child.ts");
    writeFileSync(
      child,
      `import { Tier1Cache, cacheKey } from ${JSON.stringify(cacheModule)};
const scope = ${JSON.stringify(SCOPE)};
const cache = new Tier1Cache(process.argv[2]);
for (let i = 0; i < 40; i++) {
  const key = cacheKey({ ...${JSON.stringify(PARTS)}, state: "child " + i });
  await cache.append(scope, [cache.entry(key, scope, { criteriaDigest: "c", stages: [{ shapes: { layer: { type: "choice" } }, raw: { layer: { probabilities: { none: 1 } } } }], usage: { inputTokens: 1 } })]);
}
`
    );
    const cacheRoot = path.join(root, "cache");
    const parent = new Tier1Cache(cacheRoot);
    await parent.append(SCOPE, [entryFor(parent, key(0))]);
    const proc = Bun.spawn([process.execPath, child, cacheRoot], { stdout: "pipe", stderr: "pipe" });
    let compactions = 0;
    let exited = false;
    void proc.exited.then(() => {
      exited = true;
    });
    while (!exited) {
      await parent.compact({ currentQset: "dr-qset-1", configured: { host: SCOPE.host, model: SCOPE.model } });
      compactions++;
    }
    expect(await proc.exited).toBe(0);
    await parent.compact({ currentQset: "dr-qset-1", configured: { host: SCOPE.host, model: SCOPE.model } });
    const all = await new Tier1Cache(cacheRoot).load(SCOPE);
    expect(all.size).toBe(41);
    expect(compactions).toBeGreaterThan(0);
    expect(readFileSync(parent.fileOf(SCOPE), "utf8").endsWith("\n")).toBe(true);
  });
});
