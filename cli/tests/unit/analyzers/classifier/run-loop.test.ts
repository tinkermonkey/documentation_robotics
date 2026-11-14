/**
 * classifyTier1, the run loop (TIER1_DESIGN.md sections 4.1-4.6): cache, budget and cap, pool,
 * deadline, circuit breaker, 429 halving, provider down; and `dr analyzer classify`'s Tier-1 pass
 * (classifyReportWithTier1) with its notice and run output. A FakeDecisionModel only: no network.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClassifyReport, ClassifyResult } from "../../../../src/analyzers/cards/classify.js";
import {
  classifyReportWithTier1,
  classifyTier1,
  DecisionModelError,
  openTier1,
  SpendLedger,
  specCriteriaFromLayers,
  Tier1Cache,
  tier1ForClassify,
  tier1Paths,
  type AskOptions,
  type AskResult,
  type DecisionModel,
  type LayerInfo,
  type Narrowing,
  type Question,
  type QuestionShape,
  type RawAnswer,
  type ReadyTier1,
  type StateCard,
  type Tier1Item,
  v2,
} from "../../../../src/analyzers/classifier/index.js";
import { choiceAnswer, FakeDecisionModel } from "../../../helpers/fake-decision-model.js";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");
const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, "spec-snapshot.json"), "utf8")) as { layers: LayerInfo[] };
const spec = specCriteriaFromLayers(snapshot.layers);
const fixtureCards = readFileSync(path.join(FIXTURES, "cards.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as { card: StateCard & { id: string; corpus?: string }; narrow: Narrowing | null; tier0_rule: string | null });

const items = (n: number): Tier1Item[] =>
  fixtureCards.slice(0, n).map((c) => ({ id: c.card.id, card: c.card, ...(c.narrow ? { narrow: c.narrow } : {}) }));

const stage1 = (layer: string, p = 0.8) => ({
  layer: choiceAnswer(layer, p),
  significance: { score: 2 },
  concern_authentication: { noul: 0.01 },
  concern_authorization: { noul: 0.01 },
  concern_data_persistence: { noul: 0.7 },
  concern_external_integration: { noul: 0.01 },
  concern_observability: { noul: 0.01 },
  concern_user_interface: { noul: 0.01 },
});
/** Every card: layer application at 0.8, type picked at 0.6 from what is offered (accept band). */
const accepting = () =>
  new FakeDecisionModel().answer("*", {
    ...stage1("application"),
    element_type: (q: Question) => {
      const keys = q.type === "choice" ? Object.keys(q.criteria).filter((k) => k !== "none") : [];
      return choiceAnswer(keys[0] ?? "none", 0.6)(q);
    },
  });
const THRESHOLDS = { layer: 0.6, type: 0.4, none: 0.6 };
const HOST = "cloudflare-workers-ai";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "dr-tier1-run-"));
  dirs.push(d);
  return d;
}

describe("classifyTier1", () => {
  test("misses are asked and cached; a rerun is answered from the cache with no request, identically", async () => {
    const root = tmp();
    const fake = accepting();
    const first = await classifyTier1(items(4), { model: fake, spec, host: HOST, cache: new Tier1Cache(root), thresholds: THRESHOLDS, concurrency: 4 });
    expect(first.stats).toMatchObject({ state: "on", cards: 4, cached: 0, sent: 4, failed: 0, skipped: 0 });
    expect(first.stats.bands.accept).toBe(4);
    expect(fake.calls.length).toBeGreaterThanOrEqual(4);
    const again = accepting();
    const second = await classifyTier1(items(4), { model: again, spec, host: HOST, cache: new Tier1Cache(root), thresholds: THRESHOLDS, concurrency: 1 });
    expect(again.calls).toHaveLength(0);
    expect(second.stats).toMatchObject({ cached: 4, sent: 0, costUsd: 0 });
    const strip = (m: Map<string, unknown>) => JSON.stringify([...m].map(([k, d]) => [k, { ...(d as object), cached: undefined }]));
    expect(strip(second.decisions)).toBe(strip(first.decisions));
    expect([...second.decisions.keys()]).toEqual(items(4).map((i) => i.id));
    const d = second.decisions.get(items(1)[0].id)!;
    expect(d).toMatchObject({ band: "accept", status: "answered", layer: "application", cached: true, significance: 2, concerns: ["data_persistence"] });
  });

  test("cards with the same state and narrowing are asked once", async () => {
    const fake = accepting();
    const one = items(1)[0];
    const r = await classifyTier1([one, { ...one, id: "twin" }], { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS });
    expect(r.stats.sent).toBe(2);
    expect(new Set(fake.calls.map((c) => c.stateHash)).size).toBe(1);
    expect(fake.calls.filter((c) => "layer" in c.questions)).toHaveLength(1);
    expect(r.decisions.get("twin")?.band).toBe("accept");
  });

  test("the state is rendered with the run's question set: dr-qset-2 sends no line range", async () => {
    const fake = accepting();
    await classifyTier1(items(1), { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS });
    expect(fake.calls[0].state).not.toMatch(/\(lines \d+-/);
    const v1 = accepting();
    await classifyTier1(items(1), { model: v1, spec, host: HOST, cache: null, thresholds: THRESHOLDS, qset: "dr-qset-1" });
    expect(v1.calls[0].state).toMatch(/\(lines \d+-/);
  });

  test("a cap of 0 sends nothing, still serves the cache, and the rest escalate as capped", async () => {
    const root = tmp();
    await classifyTier1(items(2), { model: accepting(), spec, host: HOST, cache: new Tier1Cache(root), thresholds: THRESHOLDS });
    const fake = accepting();
    let announced = false;
    const r = await classifyTier1(items(5), {
      model: fake,
      spec,
      host: HOST,
      cache: new Tier1Cache(root),
      thresholds: THRESHOLDS,
      remainingUsd: 0,
      onBeforeSend: () => (announced = true),
    });
    expect(fake.calls).toHaveLength(0);
    expect(announced).toBe(false);
    expect(r.stats).toMatchObject({ state: "capped", cached: 2, sent: 0, skipped: 3, skippedFor: { cap: 3, deadline: 0, unavailable: 0 } });
    const skipped = r.decisions.get(items(5)[4].id)!;
    expect(skipped).toMatchObject({ band: "escalate", status: "skipped" });
    expect(skipped.reason).toContain("monthly cap");
  });

  test("asks only what the month's remainder covers, by estimate, and records the spend", async () => {
    const root = tmp();
    const fake = new FakeDecisionModel().answer("*", stage1("none", 0.9)); // one request a card
    fake.inputTokensPerCall = 5000; // $0.0012 a card at $0.24/M
    const ledger = new SpendLedger(path.join(root, "spend.jsonl"));
    const r = await classifyTier1(items(8), {
      model: fake,
      spec,
      host: HOST,
      cache: null,
      thresholds: THRESHOLDS,
      concurrency: 1,
      remainingUsd: 0.005,
      estimatePerCardUsd: 0.0012,
      ledger,
      flushEvery: 3,
    });
    expect(r.stats.sent).toBe(4);
    expect(r.stats.state).toBe("capped");
    expect(r.stats.skippedFor.cap).toBe(4);
    expect(r.stats.costUsd).toBeCloseTo(0.0048, 6);
    expect(r.stats.bands.notElement).toBe(4);
    const month = await ledger.month(20);
    expect(month.spentUsd).toBeCloseTo(0.0048, 6);
    expect(month.cards).toBe(4);
    const lines = readFileSync(ledger.file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.length).toBe(4); // one line per card, written as it finishes
    expect(lines[0]).toMatchObject({ source: "classify", provider: "fake", model: "fake/clef", cards: 1, inputTokens: 5000 });
  });

  test("each card's spend is in the ledger as soon as it finishes, before the run ends", async () => {
    const root = tmp();
    const ledger = new SpendLedger(path.join(root, "spend.jsonl"));
    const seen: number[] = [];
    const fake = new FakeDecisionModel().answer("*", stage1("none", 0.9));
    const ask = fake.ask.bind(fake);
    fake.ask = async (...args) => {
      seen.push((await ledger.entries()).length); // what an interrupt at this moment would have kept
      return ask(...args);
    };
    await classifyTier1(items(3), { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 1, ledger, flushEvery: 100 });
    expect(seen).toEqual([0, 1, 2]);
  });

  test("in-flight cards commit the most a card has cost so far, so a low estimate can't run far past the cap", async () => {
    const fake = new FakeDecisionModel().answer("*", stage1("none", 0.9));
    fake.inputTokensPerCall = 5000; // $0.0012 a card
    const r = await classifyTier1(items(12), {
      model: fake,
      spec,
      host: HOST,
      cache: null,
      thresholds: THRESHOLDS,
      concurrency: 2,
      remainingUsd: 0.006,
      estimatePerCardUsd: 0.0001, // far too low
    });
    // the first pair goes on the estimate; after that each card commits $0.0012
    expect(r.stats.costUsd).toBeLessThanOrEqual(0.006 + 1e-9);
    expect(r.stats.sent).toBe(5);
    expect(r.stats.state).toBe("capped");
  });

  test("spend another process records meanwhile lowers what the run may still ask", async () => {
    const root = tmp();
    const file = path.join(root, "spend.jsonl");
    const ledger = new SpendLedger(file);
    const other = new SpendLedger(file);
    const fake = new FakeDecisionModel().answer("*", stage1("none", 0.9));
    fake.inputTokensPerCall = 5000; // $0.0012 a card
    let calls = 0;
    const ask = fake.ask.bind(fake);
    fake.ask = async (...args) => {
      // a second process spends $0.006 of the $0.012 while this run's first card is in flight
      if (calls++ === 0) await other.record({ source: "index", provider: "fake", model: "fake/clef", cards: 5, inputTokens: 25000, costUsd: 0.006 });
      return ask(...args);
    };
    const r = await classifyTier1(items(12), {
      model: fake,
      spec,
      host: HOST,
      cache: null,
      thresholds: THRESHOLDS,
      concurrency: 1,
      remainingUsd: 0.012,
      capUsd: 0.012,
      estimatePerCardUsd: 0.0012,
      ledger,
      flushEvery: 1,
    });
    expect(r.stats.sent).toBe(5); // not the 10 the starting remainder allowed
    expect((await ledger.month(0.012)).spentUsd).toBeLessThanOrEqual(0.012 + 1e-9);
  });

  test("a failed second stage still records the first stage's billed spend", async () => {
    const root = tmp();
    const ledger = new SpendLedger(path.join(root, "spend.jsonl"));
    const fake = accepting();
    const ask = fake.ask.bind(fake);
    fake.ask = async (state, questions, options) => {
      if ("element_type" in questions) throw new DecisionModelError("unavailable", "stage 2 down");
      return ask(state, questions, options);
    };
    const r = await classifyTier1(items(2), { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 1, ledger, breakerAfter: 10 });
    expect(r.stats.failed).toBe(2);
    expect(r.stats.costUsd).toBeCloseTo(2 * 0.00024, 8); // two stage-1 calls of 1,000 tokens at $0.24/M
    expect(r.stats.inputTokens).toBe(2000);
    expect((await ledger.month(20)).spentUsd).toBeCloseTo(2 * 0.00024, 8);
  });

  test("a 429 on the last card in flight is asked again, not skipped as out of time", async () => {
    // concurrency 2, two cards: A answers at once, B gets a 429 after 30 ms, when A's worker has
    // already finished and B's worker loses its slot to the halving
    const fake = new FakeDecisionModel().answer("*", stage1("none", 0.9));
    const [a, b] = items(2);
    const stateB = v2.stateOf(b.card);
    let failedB = false;
    const ask = fake.ask.bind(fake);
    fake.ask = async (state, questions, options) => {
      if (state === stateB && !failedB) {
        failedB = true;
        await new Promise((r) => setTimeout(r, 30));
        throw new DecisionModelError("rate-limit", "429", { status: 429 });
      }
      return ask(state, questions, options);
    };
    const r = await classifyTier1([a, b], { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 2 });
    expect(r.stats).toMatchObject({ state: "on", sent: 2, skipped: 0, failed: 0, concurrency: { start: 2, end: 1 } });
    expect(r.decisions.get(b.id)?.status).toBe("answered");
  });

  test("every asked card failing, unreadable answers and provider errors mixed, is unavailable", async () => {
    const fake = accepting().failNext("unavailable");
    let n = 0;
    const ask = fake.ask.bind(fake);
    fake.ask = async (...args) => {
      if (n++ >= 1) fake.malformedNext = true; // the first call throws, the others come back unreadable
      return ask(...args);
    };
    const r = await classifyTier1(items(3), { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 1, breakerAfter: 10 });
    expect(r.stats.sent).toBe(0);
    expect(r.stats.state).toBe("unavailable");
    expect(r.stats.unavailable?.reason).toContain("every card asked failed");
  });

  test("the estimate defaults to the mean cost of this scope's cached answers", async () => {
    const root = tmp();
    const cheap = new FakeDecisionModel().answer("*", stage1("none", 0.9));
    cheap.inputTokensPerCall = 100; // $0.000024 a card
    await classifyTier1(items(2), { model: cheap, spec, host: HOST, cache: new Tier1Cache(root), thresholds: THRESHOLDS });
    const fake = new FakeDecisionModel().answer("*", stage1("none", 0.9));
    fake.inputTokensPerCall = 100;
    const r = await classifyTier1(items(6), { model: fake, spec, host: HOST, cache: new Tier1Cache(root), thresholds: THRESHOLDS, remainingUsd: 0.0002, concurrency: 1 });
    // with the default estimate ($0.0014) nothing would be asked; with the cache's mean all four misses are
    expect(r.stats.sent).toBe(4);
  });

  test("provider down: the breaker stops after 5 failures in a row, every card escalates, state unavailable", async () => {
    const fake = accepting().failNext(...Array(20).fill("unavailable"));
    const r = await classifyTier1(items(12), { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 1 });
    expect(fake.calls).toHaveLength(5);
    expect(r.stats.state).toBe("unavailable");
    expect(r.stats.unavailable?.kind).toBe("provider");
    expect(r.stats).toMatchObject({ failed: 5, skipped: 7, skippedFor: { unavailable: 7 } });
    expect(r.stats.bands).toEqual({ accept: 0, notElement: 0, escalate: 12 });
    expect([...r.decisions.values()].every((d) => d.band === "escalate")).toBe(true);
  });

  test("401/403 stops at the first", async () => {
    const fake = accepting().failNext("auth");
    const r = await classifyTier1(items(6), { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 1 });
    expect(fake.calls).toHaveLength(1);
    expect(r.stats.unavailable?.kind).toBe("auth");
    expect(r.stats).toMatchObject({ failed: 1, skipped: 5, sent: 0 });
  });

  test("a 429 halves the pool and the card is asked again", async () => {
    const fake = accepting().failNext("rate-limit");
    const r = await classifyTier1(items(6), { model: fake, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 4 });
    expect(r.stats.concurrency).toEqual({ start: 4, end: 2 });
    expect(r.stats).toMatchObject({ state: "on", sent: 6, failed: 0 });
  });

  test("a malformed answer for one card escalates that card, uncached; the run stays on", async () => {
    const root = tmp();
    const fake = accepting();
    fake.malformedNext = true;
    const r = await classifyTier1(items(3), { model: fake, spec, host: HOST, cache: new Tier1Cache(root), thresholds: THRESHOLDS, concurrency: 1 });
    expect(r.stats).toMatchObject({ state: "on", failed: 1, sent: 2 });
    const failed = [...r.decisions.values()].find((d) => d.status === "failed")!;
    expect(failed.band).toBe("escalate");
    const rerun = accepting();
    await classifyTier1(items(3), { model: rerun, spec, host: HOST, cache: new Tier1Cache(root), thresholds: THRESHOLDS });
    expect(rerun.calls.filter((c) => "layer" in c.questions)).toHaveLength(1); // only the failed card is asked again
  });

  test("the deadline: nothing is asked after it, in-flight requests are cancelled and skipped", async () => {
    const past = await classifyTier1(items(3), { model: accepting(), spec, host: HOST, cache: null, thresholds: THRESHOLDS, deadlineAt: Date.now() - 1 });
    expect(past.stats).toMatchObject({ sent: 0, skipped: 3, skippedFor: { deadline: 3 }, state: "on" });

    const hanging: DecisionModel = {
      id: { provider: "fake", model: "fake/slow", canonicalModel: "clef" },
      pricing: { inputPerM: 0.24 },
      normalise: (raw: Record<string, RawAnswer>, shapes: Record<string, QuestionShape>) => new FakeDecisionModel().normalise(raw, shapes),
      ask: (_s: string, _q: Record<string, Question>, options: AskOptions = {}) =>
        new Promise<AskResult>((_, reject) => options.signal?.addEventListener("abort", () => reject(new DecisionModelError("timeout", "cancelled")))),
    };
    const r = await classifyTier1(items(5), { model: hanging, spec, host: HOST, cache: null, thresholds: THRESHOLDS, concurrency: 2, deadlineAt: Date.now() + 50 });
    expect(r.stats).toMatchObject({ sent: 0, failed: 0, skipped: 5, skippedFor: { deadline: 5 } });
  });

  test("no thresholds: every answered card escalates with its hint", async () => {
    const r = await classifyTier1(items(2), { model: accepting(), spec, host: HOST, cache: null, thresholds: null });
    expect(r.stats.bands).toEqual({ accept: 0, notElement: 0, escalate: 2 });
    expect([...r.decisions.values()][0]).toMatchObject({ status: "answered", layer: "application" });
  });
});

describe("dr analyzer classify with Tier 1", () => {
  const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct-00003f9a", CLOUDFLARE_API_TOKEN: "tok-SECRET-run-loop" };
  async function session(root: string, fake: DecisionModel, extra: Record<string, unknown> = {}): Promise<ReadyTier1> {
    const file = tier1Paths(root, "cbm").config;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, provider: "cloudflare-workers-ai", model: "clef", ...extra }), { mode: 0o600 });
    const s = await openTier1(root, "cbm", { env: ENV, createModel: () => fake });
    if (s.state !== "ready") throw new Error(`not ready: ${s.state}`);
    return s;
  }
  function report(): ClassifyReport {
    const facts = { decorators: [], decorator_names: [], file_importers: 0, methods: 0, usage_files: 0 };
    const results: ClassifyResult[] = fixtureCards.slice(0, 6).map((c, i) => {
      const { id, corpus: _corpus, ...card } = c.card;
      void _corpus;
      const tier0 =
        i === 0
          ? { kind: "decide" as const, layer: "application", type: "applicationcomponent", rule: "r-decide", confidence: "high" as const }
          : i === 1
            ? { kind: "reject" as const, rule: "r-reject", confidence: "high" as const }
            : c.narrow
              ? { kind: "narrow" as const, candidates: c.narrow, rule: c.tier0_rule ?? "r-narrow", confidence: "medium" as const }
              : null;
      return { card_id: id, label: card.label, name: card.name, qualified_name: card.qualified_name, file_path: card.file_path, start_line: card.start_line, end_line: card.end_line, tier0, facts, card: { id, ...card } };
    });
    return {
      analyzer: "cbm",
      project: "p",
      mode: "tier0",
      card_version: 2,
      rules: 3,
      summary: { cards: 6, decided: 1, rejected: 1, narrowed: 0, undecided: 4, no_source: 0, by_rule: {}, by_target: {} },
      results,
    };
  }

  test("asks the undecided and narrowed cards only, writes the run output, strips cards, writes no changeset", async () => {
    const root = tmp();
    const s = await session(root, accepting());
    let notice = "";
    const out = await classifyReportWithTier1(report(), s, { projectRoot: root, full: true, includeCards: false, spec, runId: "20261114T000000Z-test", onBeforeSend: (n) => (notice = `${n}`) });
    expect(out.mode).toBe("tier0+tier1");
    expect(out.tier1).toMatchObject({ state: "on", provider: "cloudflare-workers-ai", model: "fake/clef", qset: "dr-qset-2", mode: "suggest", cards: 4, sent: 4 });
    expect(out.tier1.thresholds).toMatchObject({ layer: 0.6, source: "default", fit: "in-sample" });
    expect(notice).toBe("4");
    expect(out.results[0].tier1).toBeUndefined();
    expect(out.results[1].tier1).toBeUndefined();
    expect(out.results[2].tier1?.band).toBe("accept");
    expect(out.results.every((r) => !("card" in r))).toBe(true);
    expect(out.tier1.notice).toContain("Sent 4 cards (symbol, signature, docstring, callers, callees, imports and up to 40 source lines each) to Cloudflare Workers AI (fake/clef, account …3f9a)");
    expect(out.tier1.notice).toContain("This month: $0.00");
    const runDir = path.join(root, ".dr/analyzers/cbm/classify/20261114T000000Z-test");
    expect(out.run).toBe(path.relative(root, runDir));
    const decisions = readFileSync(path.join(runDir, "decisions.jsonl"), "utf8").trim().split("\n");
    expect(decisions).toHaveLength(4);
    expect(JSON.parse(decisions[0])).toMatchObject({ band: "accept", card_id: out.results[2].card_id });
    const summary = JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8"));
    expect(summary.tier1.state).toBe("on");
    expect(summary.results).toBeUndefined();
    expect(existsSync(path.join(root, ".dr/analyzers/cbm/tier1-cache/compaction.json"))).toBe(true);
    expect(existsSync(path.join(root, "documentation-robotics"))).toBe(false);
    const all = JSON.stringify(out) + readFileSync(path.join(runDir, "summary.json"), "utf8");
    expect(all).not.toContain(ENV.CLOUDFLARE_API_TOKEN);
    expect(all).not.toContain(ENV.CLOUDFLARE_ACCOUNT_ID);
    expect((await s.ledger.month(20)).cards).toBe(4);
  });

  test("at the cap: the cache still answers, the rest go on, and the notice is the cap message", async () => {
    const root = tmp();
    await classifyReportWithTier1(report(), await session(root, accepting()), { projectRoot: root, full: false, includeCards: false, spec });
    const fake = accepting();
    const s = await session(root, fake, { monthlyCapUsd: 0 });
    const r = report();
    r.results.push({ ...r.results[5], card_id: "new", card: { ...r.results[5].card!, id: "new", name: "Other", qualified_name: "x.Other" } });
    const out = await classifyReportWithTier1(r, s, { projectRoot: root, full: false, includeCards: true, spec });
    expect(fake.calls).toHaveLength(0);
    expect(out.tier1).toMatchObject({ state: "capped", cached: 4, sent: 0, skipped: 1 });
    expect(out.tier1.notice).toContain("cap is $0.00, so it sent nothing");
    expect(out.tier1.notice).toContain("1 card went on without a Tier-1 answer");
    expect(out.results[0].card).toBeDefined();
  });

  test("--tier0-only builds no model and opens nothing, even with a ready tier1.json", async () => {
    const root = tmp();
    await session(root, accepting()); // a ready configuration on disk
    let built = 0;
    const createModel = () => {
      built++;
      return accepting();
    };
    const fetch = () => Promise.reject(new Error("no network in tests"));
    expect(await tier1ForClassify(root, "cbm", { tier0Only: true, env: ENV, createModel, fetch })).toBeNull();
    expect(built).toBe(0);
    const on = await tier1ForClassify(root, "cbm", { tier0Only: false, env: ENV, createModel, fetch });
    expect(on?.state).toBe("ready");
    expect(built).toBe(1);
  });

  test("provider down: the run reports unavailable and what it got", async () => {
    const root = tmp();
    const s = await session(root, accepting().failNext(...Array(10).fill("unavailable")));
    const out = await classifyReportWithTier1(report(), s, { projectRoot: root, full: false, includeCards: false, spec });
    expect(out.tier1.state).toBe("unavailable");
    expect(out.tier1.reason).toContain("provider");
    expect(out.tier1.bands).toEqual({ accept: 0, notElement: 0, escalate: 4 });
    expect(out.tier1.notice).toContain("Tier 1 stopped (provider)");
  });
});
