/**
 * Produce gold labels for a corpus with Claude (full card context, high effort).
 *
 *   bun label.ts --corpus dr-cli --sync --limit 5         # direct calls (testing)
 *   bun label.ts --corpus dr-cli --submit                 # create a Message Batch (50% price)
 *   bun label.ts --corpus dr-cli --status                 # poll batch status
 *   bun label.ts --corpus dr-cli --fetch                  # pull results into gold.jsonl
 *   bun label.ts --corpus viewer --estimate --charter     # cost of a --submit, before submitting
 *                                                         # (token counting is free; nothing is labelled)
 *
 * Flags: --model opus|sonnet|haiku (default opus), --effort low|medium|high|xhigh (default high),
 *        --limit n, --concurrency n (sync mode), --force (relabel existing),
 *        --charter full|short (put spec/DESIGN_CHARTER.md in the labeler's context),
 *        --tag <name> (write gold@<name>.jsonl and batch@<name>.json instead of the defaults)
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, claudeCost, mapConcurrent, MODEL_IDS } from "./lib/claude.js";
import { repoRoot } from "./lib/env.js";
import { appendJsonl, corpusDir, flagNum, flagStr, parseFlags, readJson, readJsonl, writeJson, writeJsonl } from "./lib/io.js";
import { initSpec, isValidType, layerIds, specReferenceText } from "./lib/spec.js";
import { renderState } from "./lib/state.js";
import { ConcernsSchema, type Card, type Gold } from "./lib/types.js";

const SIG = ["0", "1", "2", "3", "4"] as const;

function outputSchema() {
  return z.object({
    layer: z.enum([...layerIds(), "none"] as unknown as [string, ...string[]]),
    element_type: z.string().nullable(),
    significance: z.enum(SIG),
    concerns: ConcernsSchema,
    rationale: z.string(),
  });
}
type Output = z.infer<ReturnType<typeof outputSchema>>;

function charterText(mode: "full" | "short"): string {
  const f = path.join(repoRoot(), "spec", "DESIGN_CHARTER.md");
  if (!existsSync(f)) throw new Error(`--charter given but ${f} does not exist`);
  const raw = readFileSync(f, "utf8");
  if (mode === "short") {
    const m = /## In one paragraph\n\n([\s\S]*?)\n\n## /.exec(raw);
    return m ? m[1].replace(/\n/g, " ").trim() : "";
  }
  return raw.replace(/^\*\*Status:\*\*[^\n]*\n(?:[^\n]*\n)*?\n/m, "").trim();
}

function systemPrompt(charter?: "full" | "short"): Anthropic.TextBlockParam[] {
  const text = [
    "You are an enterprise architect producing gold-standard labels for an evaluation dataset. Each input is a symbol from a codebase (a class, interface, function, method, module or HTTP route) described by a state card built from a code knowledge graph: its signature, docstring, callers, callees, imports and source.",
    "",
    "Decide, using the reference below:",
    "1. layer: which of the 13 Documentation Robotics layers this symbol belongs to if it were recorded as an element in an architecture model, or 'none' if it is not an architecturally meaningful element on its own (trivial helpers, formatting, boilerplate, scaffolding, generated code). Most ordinary application code structure belongs to 'application'; only choose a more specific layer when the symbol *is* that concern (an HTTP route handler or API contract -> api; an entity/schema definition -> data-model; a table/migration/query layer -> data-store; a test suite or fixture -> testing; telemetry -> apm; auth/permission logic -> security; a UI view/component -> ux; app routing/navigation -> navigation; infra/deployment -> technology).",
    "2. element_type: the element type id within that layer (the lowercase id, e.g. 'applicationservice', not the title), or null when layer is 'none' or no listed type fits.",
    "3. significance: 0-4 on the architectural significance scale.",
    "4. concerns: whether the symbol itself implements each cross-cutting concern (true only when the symbol does that work, not when it merely calls something that does).",
    "5. rationale: at most 60 words.",
    "",
    "Be decisive and consistent. Judge the symbol as it would be modelled, not by its file location alone.",
    "",
    ...(charter ? ["# The specification's design charter (what elements and relationships are meant to model; apply its granularity rule)", charterText(charter), ""] : []),
    specReferenceText(),
  ].join("\n");
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

function userPrompt(card: Card): string {
  return `Classify this symbol.\n\n${renderState(card, 400)}`;
}

function toGold(card: Card, out: Output, model: string, usage?: Gold["usage"]): Gold {
  const layer = out.layer;
  const et = layer === "none" ? null : out.element_type;
  return {
    card_id: card.id,
    layer,
    element_type: et,
    element_type_valid: layer !== "none" && isValidType(layer, et),
    significance: Number(out.significance),
    concerns: out.concerns,
    rationale: out.rationale,
    model,
    usage,
  };
}

async function main() {
  await initSpec();
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  if (!corpus) {
    console.error("Usage: bun label.ts --corpus <name> (--sync | --submit | --status | --fetch)");
    process.exit(2);
  }
  const dir = corpusDir(corpus);
  const model = MODEL_IDS[flagStr(flags, "model", "opus") ?? "opus"] ?? "claude-opus-5-5";
  const effort = (flagStr(flags, "effort", "high") ?? "high") as "low" | "medium" | "high" | "xhigh";
  const limit = flagNum(flags, "limit", Infinity);
  const tag = flagStr(flags, "tag");
  const charter = flags.charter ? ((flagStr(flags, "charter", "full") === "short" ? "short" : "full") as "full" | "short") : undefined;
  const goldFile = path.join(dir, `gold${tag ? `@${tag}` : ""}.jsonl`);
  const batchFile = path.join(dir, `batch${tag ? `@${tag}` : ""}.json`);
  const cards = readJsonl<Card>(path.join(dir, "cards.jsonl"));
  const existing = new Set(readJsonl<Gold>(goldFile).map((g) => g.card_id));
  const todo = (flags.force ? cards : cards.filter((c) => !existing.has(c.id))).slice(0, limit);
  const schema = outputSchema();
  const format = zodOutputFormat(schema);
  const system = systemPrompt(charter);
  const client = anthropic();

  const baseParams = (card: Card): Anthropic.MessageCreateParamsNonStreaming => ({
    model,
    max_tokens: 8000,
    system,
    output_config: { effort, format },
    messages: [{ role: "user", content: userPrompt(card) }],
  });

  if (flags.estimate) {
    if (todo.length === 0) {
      console.error("Nothing to label.");
      return;
    }
    // Token counting is free: the system prompt once, then every request in full.
    const count = (messages: Anthropic.MessageParam[]) => client.messages.countTokens({ model, system, messages }).then((r) => r.input_tokens);
    const systemTokens = await count([{ role: "user", content: "x" }]);
    const perCard = await mapConcurrent(todo, flagNum(flags, "concurrency", 4), async (card) => (await count([{ role: "user", content: userPrompt(card) }])) - systemTokens);
    const outputTokens = flagNum(flags, "output-tokens", meanGoldOutputTokens());
    const e = estimateBatchCost(model, systemTokens, perCard, outputTokens, flagNum(flags, "cache-hit-rate", goldCacheHitRate()));
    console.log(`Estimate for ${todo.length} cards (${model}, effort ${effort}${charter ? `, charter ${charter}` : ""}), Batch API:`);
    console.log(`  system prompt ${systemTokens} tokens (cached), per card ${Math.round(e.meanCardTokens)} input tokens, ${Math.round(outputTokens)} output tokens assumed`);
    console.log(`  every request reads the cache: $${e.best.toFixed(2)}`);
    console.log(`  cache-hit rate ${(100 * e.hitRate).toFixed(0)}% (the committed gold sets'): $${e.expected.toFixed(2)}`);
    console.log(`  every request writes the cache (worst case): $${e.worst.toFixed(2)}`);
    console.log(`  --sync instead (full price; the first request writes the cache, the rest read it): $${e.sync.toFixed(2)}`);
    return;
  }

  if (flags.sync) {
    const concurrency = flagNum(flags, "concurrency", 4);
    // --max-usd: stop starting requests once the run's cost reaches it (requests in flight finish).
    const maxUsd = flagNum(flags, "max-usd", Infinity);
    console.error(`Labeling ${todo.length} cards synchronously with ${model} (effort ${effort}${charter ? `, charter ${charter}` : ""})${Number.isFinite(maxUsd) ? `, stopping at $${maxUsd}` : ""}`);
    let cost = 0;
    let stopped = 0;
    const one = async (card: Card, i: number) => {
      if (cost >= maxUsd) {
        stopped++;
        return;
      }
      const t0 = Date.now();
      try {
        const res = await client.messages.parse({ ...baseParams(card), output_config: { effort, format } });
        if (res.stop_reason === "refusal") throw new Error(`refusal: ${res.stop_details?.category ?? "?"}`);
        const parsed = res.parsed_output;
        if (!parsed) throw new Error("no parsed_output (stop_reason " + res.stop_reason + ")");
        const gold = toGold(card, parsed, model, {
          input_tokens: res.usage.input_tokens,
          output_tokens: res.usage.output_tokens,
          cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
        });
        cost += claudeCost(model, res.usage);
        appendJsonl(goldFile, gold);
        console.error(`[${i + 1}/${todo.length}] ${card.label} ${card.name} -> ${gold.layer}/${gold.element_type ?? "-"} sig=${gold.significance} (${Date.now() - t0}ms, cache_read=${res.usage.cache_read_input_tokens ?? 0})`);
      } catch (e) {
        console.error(`[${i + 1}/${todo.length}] ${card.name} FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    // The first request alone writes the system prompt to the cache; the rest read it.
    if (todo.length) await one(todo[0], 0);
    await mapConcurrent(todo.slice(1), concurrency, (card, i) => one(card, i + 1));
    console.error(`Done. Approx cost $${cost.toFixed(3)}${stopped ? `; stopped at the $${maxUsd} cap, ${stopped} card(s) not labelled (rerun to resume)` : ""}`);
    return;
  }

  if (flags.submit) {
    if (todo.length === 0) {
      console.error("Nothing to label.");
      return;
    }
    const requests = todo.map((card) => ({ custom_id: card.id, params: baseParams(card) }));
    const batch = await client.messages.batches.create({ requests });
    const state = readJson<{ batches: Array<{ id: string; created_at: string; count: number; model: string }> }>(batchFile, { batches: [] });
    state.batches.push({ id: batch.id, created_at: batch.created_at, count: requests.length, model });
    writeJson(batchFile, state);
    console.log(`Submitted batch ${batch.id} with ${requests.length} requests (${model}, effort ${effort}${charter ? `, charter ${charter}` : ""}${tag ? `, tag ${tag}` : ""}). Status: ${batch.processing_status}`);
    return;
  }

  if (flags.status || flags.fetch) {
    const state = readJson<{ batches: Array<{ id: string; count: number; model: string; fetched?: boolean }> }>(batchFile, { batches: [] });
    if (state.batches.length === 0) {
      console.error("No batches recorded for this corpus.");
      return;
    }
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const b of state.batches) {
      const info = await client.messages.batches.retrieve(b.id);
      console.log(`${b.id}: ${info.processing_status} succeeded=${info.request_counts.succeeded} errored=${info.request_counts.errored} processing=${info.request_counts.processing} expired=${info.request_counts.expired}`);
      if (!flags.fetch || info.processing_status !== "ended" || b.fetched) continue;
      let ok = 0;
      let bad = 0;
      let cost = 0;
      const golds = readJsonl<Gold>(goldFile);
      const have = new Set(golds.map((g) => g.card_id));
      for await (const r of await client.messages.batches.results(b.id)) {
        const card = byId.get(r.custom_id);
        if (!card || have.has(r.custom_id)) continue;
        if (r.result.type !== "succeeded") {
          bad++;
          console.error(`  ${r.custom_id}: ${r.result.type}`);
          continue;
        }
        const msg = r.result.message;
        const text = msg.content.find((c): c is Anthropic.TextBlock => c.type === "text")?.text ?? "";
        const parsed = schema.safeParse(safeJson(text));
        if (!parsed.success) {
          bad++;
          console.error(`  ${r.custom_id}: unparseable output`);
          continue;
        }
        cost += claudeCost(b.model, msg.usage, true);
        golds.push(toGold(card, parsed.data, b.model, { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0 }));
        ok++;
      }
      writeJsonl(goldFile, golds);
      b.fetched = true;
      writeJson(batchFile, state);
      console.log(`  fetched ${ok} labels (${bad} failed), approx cost $${cost.toFixed(3)}; gold.jsonl now has ${golds.length}`);
    }
    return;
  }

  console.error("Specify one of --sync, --submit, --status, --fetch");
  process.exit(2);
}

/** The committed gold sets, whose recorded usage calibrates the estimate. */
const GOLD_CORPORA = ["dr-cli", "fastapi", "petclinic"];

function committedGoldUsage(): NonNullable<Gold["usage"]>[] {
  return GOLD_CORPORA.flatMap((c) => readJsonl<Gold>(path.join(corpusDir(c), "gold.jsonl")).flatMap((g) => (g.usage ? [g.usage] : [])));
}

/** Mean output tokens per label in the committed gold sets (thinking included), 200 when none recorded. */
function meanGoldOutputTokens(): number {
  const u = committedGoldUsage();
  return u.length ? u.reduce((s, x) => s + x.output_tokens, 0) / u.length : 200;
}

/** Share of the committed gold sets' batch requests that read the system prompt from the cache. */
function goldCacheHitRate(): number {
  const u = committedGoldUsage();
  return u.length ? u.filter((x) => (x.cache_read_input_tokens ?? 0) > 0).length / u.length : 0;
}

/**
 * Batch cost of labelling, with the harness's prices (`claudeCost`, batch half price): every request
 * reading the cached system prompt (best), every request writing it (worst: batch caching is best
 * effort), and the mix at `hitRate`.
 */
function estimateBatchCost(model: string, systemTokens: number, cardTokens: number[], outputTokens: number, hitRate: number) {
  let best = 0;
  let worst = 0;
  for (const t of cardTokens) {
    best += claudeCost(model, { input_tokens: t, output_tokens: outputTokens, cache_read_input_tokens: systemTokens }, true);
    worst += claudeCost(model, { input_tokens: t, output_tokens: outputTokens, cache_creation_input_tokens: systemTokens }, true);
  }
  const h = Math.min(1, Math.max(0, hitRate));
  // Direct calls one after another keep the 5-minute cache warm: one write, then reads, at full price.
  const sync = cardTokens.reduce(
    (s, t, i) =>
      s + claudeCost(model, { input_tokens: t, output_tokens: outputTokens, ...(i === 0 ? { cache_creation_input_tokens: systemTokens } : { cache_read_input_tokens: systemTokens }) }),
    0
  );
  return { best, worst, sync, expected: h * best + (1 - h) * worst, hitRate: h, meanCardTokens: cardTokens.length ? cardTokens.reduce((s, x) => s + x, 0) / cardTokens.length : 0 };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
