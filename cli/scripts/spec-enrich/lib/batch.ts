import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, claudeCost, mapConcurrent } from "../../classify-eval/lib/claude.js";
import { readJson, writeJson } from "../../classify-eval/lib/io.js";
import { harnessDir } from "./paths.js";

/**
 * Thin wrapper over Message Batches + a synchronous fallback, shared by the
 * proposal steps. Each step provides requests keyed by custom_id and a handler
 * that turns a message's text into a saved proposal.
 */

export interface BatchState {
  batches: Array<{ id: string; created_at: string; count: number; model: string; fetched?: boolean }>;
}

export interface ProposalRequest {
  custom_id: string;
  params: Anthropic.MessageCreateParamsNonStreaming;
}

/** Batch custom_id must match ^[a-zA-Z0-9_-]{1,64}$; spec ids contain dots. */
export function encodeId(id: string): string {
  return id.replace(/\./g, "__");
}
export function decodeId(customId: string): string {
  return customId.replace(/__/g, ".");
}

export function stateFile(kind: string): string {
  return path.join(harnessDir(), "data", "batches", `${kind}.json`);
}

export async function submitBatch(kind: string, requests: ProposalRequest[], model: string): Promise<string> {
  const client = anthropic();
  const batch = await client.messages.batches.create({ requests });
  const file = stateFile(kind);
  const state = readJson<BatchState>(file, { batches: [] });
  state.batches.push({ id: batch.id, created_at: batch.created_at, count: requests.length, model });
  writeJson(file, state);
  return batch.id;
}

export async function batchStatus(kind: string): Promise<Array<{ id: string; status: string; counts: Anthropic.Messages.MessageBatchRequestCounts; fetched: boolean }>> {
  const client = anthropic();
  const state = readJson<BatchState>(stateFile(kind), { batches: [] });
  const out = [];
  for (const b of state.batches) {
    const info = await client.messages.batches.retrieve(b.id);
    out.push({ id: b.id, status: info.processing_status, counts: info.request_counts, fetched: !!b.fetched });
  }
  return out;
}

/** Fetch ended, unfetched batches; call onResult(custom_id, text, usage, model) for each success. Returns counts. */
export async function fetchBatches(kind: string, onResult: (customId: string, text: string, usage: Anthropic.Messages.Usage, model: string) => void): Promise<{ ok: number; bad: number; cost: number }> {
  const client = anthropic();
  const file = stateFile(kind);
  const state = readJson<BatchState>(file, { batches: [] });
  let ok = 0,
    bad = 0,
    cost = 0;
  for (const b of state.batches) {
    if (b.fetched) continue;
    const info = await client.messages.batches.retrieve(b.id);
    if (info.processing_status !== "ended") continue;
    for await (const r of await client.messages.batches.results(b.id)) {
      if (r.result.type !== "succeeded") {
        bad++;
        console.error(`  ${r.custom_id}: ${r.result.type}`);
        continue;
      }
      const msg = r.result.message;
      const text = msg.content.find((c): c is Anthropic.TextBlock => c.type === "text")?.text ?? "";
      try {
        onResult(r.custom_id, text, msg.usage, b.model);
        ok++;
        cost += claudeCost(b.model, msg.usage, true);
      } catch (e) {
        bad++;
        console.error(`  ${r.custom_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    b.fetched = true;
    writeJson(file, state);
  }
  return { ok, bad, cost };
}

/** Synchronous alternative: run requests directly with bounded concurrency. */
export async function runSync(requests: ProposalRequest[], concurrency: number, onResult: (customId: string, text: string, usage: Anthropic.Messages.Usage, model: string) => void): Promise<{ ok: number; bad: number; cost: number }> {
  const client = anthropic();
  let ok = 0,
    bad = 0,
    cost = 0;
  await mapConcurrent(requests, concurrency, async (req, i) => {
    const t0 = Date.now();
    try {
      const res = await client.messages.create(req.params);
      if (res.stop_reason === "refusal") throw new Error(`refusal: ${res.stop_details?.category ?? "?"}`);
      const text = res.content.find((c): c is Anthropic.TextBlock => c.type === "text")?.text ?? "";
      onResult(req.custom_id, text, res.usage, req.params.model);
      ok++;
      cost += claudeCost(req.params.model, res.usage);
      console.error(`[${i + 1}/${requests.length}] ${req.custom_id} ok (${Date.now() - t0}ms, cache_read=${res.usage.cache_read_input_tokens ?? 0})`);
    } catch (e) {
      bad++;
      console.error(`[${i + 1}/${requests.length}] ${req.custom_id} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { ok, bad, cost };
}

export function safeJson(text: string): unknown {
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
