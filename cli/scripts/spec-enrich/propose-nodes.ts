/**
 * Propose enriched definitions for node types: an operational definition,
 * distinctions from sibling types, a standard reference, code-level evidence,
 * and descriptions for attributes that lack one.
 *
 *   bun propose-nodes.ts --layer application --sync            # direct calls (pilot)
 *   bun propose-nodes.ts --submit [--layer <id>]               # Message Batch for all/one layer
 *   bun propose-nodes.ts --status | --fetch
 *
 * Flags: --model opus|sonnet (default opus), --effort high|medium (default high),
 *        --force (re-propose types that already have a proposal), --limit n
 * Output: data/proposals/nodes/<layer>/<type>.json
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { MODEL_IDS } from "../classify-eval/lib/claude.js";
import { flagNum, flagStr, parseFlags, writeJson } from "../classify-eval/lib/io.js";
import { batchStatus, decodeId, encodeId, fetchBatches, runSync, safeJson, submitBatch, type ProposalRequest } from "./lib/batch.js";
import { ensureDataDirs, proposalsDir } from "./lib/paths.js";
import { describeNodeForPrompt, loadLayerDescription, loadLayerIds, loadNodeSchemas, loadRelationshipSchemas, type NodeSchema } from "./lib/schemas.js";

const OutputSchema = z.object({
  definition: z.string(),
  distinguish_from: z.array(z.object({ type: z.string(), when: z.string() })),
  standard_reference: z.string().nullable(),
  code_evidence: z.array(z.string()),
  attribute_descriptions: z.array(z.object({ name: z.string(), description: z.string() })),
  notes: z.string(),
});
export type NodeProposal = z.infer<typeof OutputSchema> & { spec_node_id: string; previous_description: string; model: string; generated_at: string };

function systemFor(layer: string, siblings: NodeSchema[]): Anthropic.TextBlockParam[] {
  const text = [
    "You are the editor of the Documentation Robotics architecture specification, a 13-layer federated model whose element types must be definable precisely enough that a classifier can decide, from a code symbol's state card, whether the symbol is an instance of the type. You write operational definitions.",
    "",
    `# Layer: ${layer}`,
    loadLayerDescription(layer),
    "",
    "# All element types in this layer (current definitions and attributes)",
    ...siblings.map((s) => describeNodeForPrompt(s)),
    "",
    "# Your task for the one type named in the message",
    "1. definition: one or two sentences in genus-and-differentia form ('A <kind of thing> that <what sets it apart>'), decidable by a reader who knows the codebase. State what it IS, not why it is useful. Do not start with the type name. No marketing adjectives.",
    "2. distinguish_from: up to four sibling types in this layer that a modeller could confuse with this one; for each, the element type id (lowercase, as listed) and a clause completing 'Use <that type> instead when ...'. Only real confusions, not every sibling.",
    "3. standard_reference: the concept or clause in the layer's standard this type corresponds to (e.g. 'ArchiMate 3.2 §9.3 Application Service', 'OpenAPI 3.0 Operation Object', 'NIST SP 800-53 AC-3'), or null if none applies.",
    "4. code_evidence: exactly three concrete, observable signals in source code, configuration or documentation that indicate an instance of this type (e.g. 'a class annotated @Service whose public methods are called from controllers', 'a route handler registered on an HTTP router'). Signals, not restatements of the definition.",
    "5. attribute_descriptions: for every attribute listed in the message as lacking a description, one sentence giving its meaning, format or units, and when to set it. Use the attribute names exactly as given. Leave the array empty if none are listed.",
    "6. notes: at most 60 words of concerns a spec maintainer should hear: overlap with another type, a missing or misnamed attribute, an enum that does not fit. Empty string if none.",
    "Be consistent with the sibling definitions above; where a sibling definition is thin, define this type so the boundary is clear from this side.",
  ].join("\n");
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

function userFor(n: NodeSchema, rels: ReturnType<typeof loadRelationshipSchemas>): string {
  const missing = Object.entries(n.attributes)
    .filter(([, v]) => !v.description)
    .map(([k]) => k);
  const outgoing = rels.filter((r) => r.source === n.specNodeId).map((r) => `  ${r.source} --[${r.predicate}]--> ${r.destination}`);
  const incoming = rels.filter((r) => r.destination === n.specNodeId).map((r) => `  ${r.source} --[${r.predicate}]--> ${r.destination}`);
  return [
    `Define this element type: ${n.specNodeId}`,
    "",
    describeNodeForPrompt(n),
    "",
    `Attributes lacking a description: ${missing.length ? missing.join(", ") : "(none)"}`,
    "",
    `Relationships in which it participates (${outgoing.length} outgoing, ${incoming.length} incoming):`,
    ...outgoing.slice(0, 40),
    ...incoming.slice(0, 40),
    outgoing.length + incoming.length > 80 ? "  ... (truncated)" : "",
  ].join("\n");
}

function proposalFile(n: NodeSchema): string {
  return path.join(proposalsDir("nodes", n.layer), `${n.type}.json`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  ensureDataDirs();
  const layerFilter = flagStr(flags, "layer");
  const model = MODEL_IDS[flagStr(flags, "model", "opus") ?? "opus"] ?? "claude-opus-5-5";
  const effort = (flagStr(flags, "effort", "high") ?? "high") as "high" | "medium";
  const limit = flagNum(flags, "limit", Infinity);
  const nodes = loadNodeSchemas(layerFilter);
  const rels = loadRelationshipSchemas();
  const byId = new Map(nodes.map((n) => [n.specNodeId, n]));
  const format = zodOutputFormat(OutputSchema);

  const save = (rawId: string, text: string, usage: Anthropic.Messages.Usage, usedModel: string) => {
    const customId = decodeId(rawId);
    const n = byId.get(customId);
    if (!n) throw new Error(`unknown type ${customId}`);
    const parsed = OutputSchema.safeParse(safeJson(text));
    if (!parsed.success) throw new Error(`unparseable output for ${customId}`);
    const proposal: NodeProposal = { spec_node_id: n.specNodeId, previous_description: n.description, ...parsed.data, model: usedModel, generated_at: new Date().toISOString() };
    writeJson(proposalFile(n), proposal);
  };

  if (flags.status || flags.fetch) {
    for (const s of await batchStatus("nodes")) console.log(`${s.id}: ${s.status} succeeded=${s.counts.succeeded} errored=${s.counts.errored} processing=${s.counts.processing}${s.fetched ? " (fetched)" : ""}`);
    if (flags.fetch) {
      const r = await fetchBatches("nodes", save);
      console.log(`fetched ${r.ok} proposals (${r.bad} failed), approx cost $${r.cost.toFixed(3)}`);
    }
    return;
  }

  const todo = nodes.filter((n) => flags.force || !existsSync(proposalFile(n))).slice(0, limit);
  const systems = new Map<string, Anthropic.TextBlockParam[]>();
  for (const layer of loadLayerIds()) systems.set(layer, systemFor(layer, nodes.filter((n) => n.layer === layer)));
  const requests: ProposalRequest[] = todo.map((n) => ({
    custom_id: encodeId(n.specNodeId),
    params: {
      model,
      max_tokens: 6000,
      system: systems.get(n.layer),
      output_config: { effort, format },
      messages: [{ role: "user", content: userFor(n, rels) }],
    },
  }));
  if (requests.length === 0) {
    console.error("Nothing to propose (all types have proposals; use --force to redo).");
    return;
  }
  if (flags.sync) {
    console.error(`Proposing ${requests.length} node definitions synchronously with ${model} (effort ${effort})`);
    const r = await runSync(requests, flagNum(flags, "concurrency", 4), save);
    console.error(`Done: ${r.ok} ok, ${r.bad} failed, approx cost $${r.cost.toFixed(3)}`);
    return;
  }
  if (flags.submit) {
    const id = await submitBatch("nodes", requests, model);
    console.log(`Submitted batch ${id} with ${requests.length} node-type requests (${model}, effort ${effort}).`);
    return;
  }
  console.error("Specify --sync, --submit, --status or --fetch");
  process.exit(2);
}

// Keep readFileSync import used for potential future resume logic
void readFileSync;
main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
