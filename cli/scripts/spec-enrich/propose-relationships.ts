/**
 * Propose a meaning sentence and an evidence sentence for every relationship
 * schema, grouped one request per source type (so the source definition is in
 * context once and siblings stay consistent).
 *
 *   bun propose-relationships.ts --layer product --sync
 *   bun propose-relationships.ts --submit [--layer <id>] | --status | --fetch
 *   bun propose-relationships.ts --source testing.testcasesketch --sync --force   # redo one group
 *
 * Uses enriched node definitions from data/proposals/nodes when present.
 * Output: data/proposals/relationships/<layer>/<sourcetype>.json
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
import { BOILERPLATE_REL, loadNodeSchemas, loadPredicates, loadRelationshipSchemas, type NodeSchema, type RelationshipSchema } from "./lib/schemas.js";
import type { NodeProposal } from "./propose-nodes.js";

const OutputSchema = z.object({
  relationships: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      evidence: z.string(),
    }),
  ),
  notes: z.string(),
});
export interface RelationshipProposalFile {
  source: string;
  model: string;
  generated_at: string;
  relationships: Array<{ id: string; previous_description: string; description: string; evidence: string }>;
  notes: string;
}

function enrichedDefinition(n: NodeSchema | undefined, specNodeId: string): string {
  if (!n) return `${specNodeId}: (unknown type)`;
  const pf = path.join(proposalsDir("nodes", n.layer), `${n.type}.json`);
  if (existsSync(pf)) {
    const p = JSON.parse(readFileSync(pf, "utf8")) as NodeProposal;
    return `${n.specNodeId} (${n.title}): ${p.definition}`;
  }
  return `${n.specNodeId} (${n.title}): ${n.description || "(no description)"}`;
}

function system(): Anthropic.TextBlockParam[] {
  const preds = loadPredicates();
  const lines = Object.values(preds)
    .sort((a, b) => a.predicate.localeCompare(b.predicate))
    .map((p) => `- ${p.predicate}${p.inverse ? ` (inverse: ${p.inverse})` : ""} [${p.category ?? "?"}${p.archimate_alignment ? `, ArchiMate ${p.archimate_alignment}` : ""}]: ${p.description ?? ""}`);
  const text = [
    "You are the editor of the Documentation Robotics architecture specification. Each relationship type in the spec joins a source element type to a destination element type with a predicate. Today every relationship carries only the boilerplate description 'Defines relationship: X predicate Y'. You write the real semantics.",
    "",
    "# Predicate catalog",
    ...lines,
    "",
    "# Task",
    "For every relationship listed in the message, produce:",
    "- description: one sentence stating what it means, in the domain, that an instance of the source type stands in this predicate to an instance of the destination type. Name the roles concretely (e.g. 'The application service is the technical realization through which the business service is delivered'). Do not restate the predicate catalog entry and do not begin with the type names in id form.",
    "- evidence: one sentence naming what, in source code, configuration, infrastructure or documentation, would prove this relationship holds between two real elements (e.g. 'the controller method annotated with the route calls the service's public method', 'the Terraform module declares the database as a resource of the node').",
    "Return every id exactly as given, in the same order. notes: at most 60 words on relationships that look semantically wrong or redundant (e.g. two predicates expressing the same thing), empty string if none.",
  ].join("\n");
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

function userFor(source: NodeSchema, rels: RelationshipSchema[], nodesById: Map<string, NodeSchema>): string {
  const lines = [`Source type:\n${enrichedDefinition(source, source.specNodeId)}`, "", `Relationships (${rels.length}):`];
  for (const r of rels) {
    lines.push(`- id: ${r.id}`);
    lines.push(`  predicate: ${r.predicate}`);
    lines.push(`  destination: ${enrichedDefinition(nodesById.get(r.destination), r.destination)}`);
  }
  return lines.join("\n");
}

function proposalFile(source: NodeSchema): string {
  return path.join(proposalsDir("relationships", source.layer), `${source.type}.json`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  ensureDataDirs();
  const layerFilter = flagStr(flags, "layer");
  const model = MODEL_IDS[flagStr(flags, "model", "opus") ?? "opus"] ?? "claude-opus-5-5";
  const effort = (flagStr(flags, "effort", "high") ?? "high") as "high" | "medium";
  const limit = flagNum(flags, "limit", Infinity);
  const nodes = loadNodeSchemas();
  const nodesById = new Map(nodes.map((n) => [n.specNodeId, n]));
  const rels = loadRelationshipSchemas(layerFilter);
  const bySource = new Map<string, RelationshipSchema[]>();
  for (const r of rels) {
    const arr = bySource.get(r.source) ?? [];
    arr.push(r);
    bySource.set(r.source, arr);
  }
  const format = zodOutputFormat(OutputSchema);

  const save = (rawId: string, text: string, usage: Anthropic.Messages.Usage, usedModel: string) => {
    const customId = decodeId(rawId);
    const source = nodesById.get(customId);
    const group = bySource.get(customId);
    if (!source || !group) throw new Error(`unknown source ${customId}`);
    const parsed = OutputSchema.safeParse(safeJson(text));
    if (!parsed.success) throw new Error(`unparseable output for ${customId}`);
    const byId = new Map(parsed.data.relationships.map((r) => [r.id, r]));
    const missing = group.filter((r) => !byId.has(r.id)).map((r) => r.id);
    if (missing.length) console.error(`  ${customId}: ${missing.length} relationship(s) missing from output: ${missing.slice(0, 3).join(", ")}`);
    const out: RelationshipProposalFile = {
      source: customId,
      model: usedModel,
      generated_at: new Date().toISOString(),
      relationships: group
        .filter((r) => byId.has(r.id))
        .map((r) => ({ id: r.id, previous_description: r.description, description: byId.get(r.id)!.description, evidence: byId.get(r.id)!.evidence })),
      notes: parsed.data.notes,
    };
    writeJson(proposalFile(source), out);
  };

  if (flags.status || flags.fetch) {
    for (const s of await batchStatus("relationships")) console.log(`${s.id}: ${s.status} succeeded=${s.counts.succeeded} errored=${s.counts.errored} processing=${s.counts.processing}${s.fetched ? " (fetched)" : ""}`);
    if (flags.fetch) {
      const r = await fetchBatches("relationships", save);
      console.log(`fetched ${r.ok} source groups (${r.bad} failed), approx cost $${r.cost.toFixed(3)}`);
    }
    return;
  }

  const sourceFilter = flagStr(flags, "source");
  const sources = [...bySource.keys()]
    .map((id) => nodesById.get(id))
    .filter((n): n is NodeSchema => !!n)
    .filter((n) => !sourceFilter || n.specNodeId === sourceFilter)
    .filter((n) => flags.force || !existsSync(proposalFile(n)))
    .filter((n) => flags.all || (bySource.get(n.specNodeId) ?? []).some((r) => BOILERPLATE_REL.test(r.description) || !r.description.trim()))
    .slice(0, limit);
  const sys = system();
  const requests: ProposalRequest[] = sources.map((n) => ({
    custom_id: encodeId(n.specNodeId),
    params: {
      model,
      max_tokens: 12000,
      system: sys,
      output_config: { effort, format },
      messages: [{ role: "user", content: userFor(n, bySource.get(n.specNodeId) ?? [], nodesById) }],
    },
  }));
  if (requests.length === 0) {
    console.error("Nothing to propose.");
    return;
  }
  const relCount = sources.reduce((a, n) => a + (bySource.get(n.specNodeId)?.length ?? 0), 0);
  if (flags.sync) {
    console.error(`Proposing ${relCount} relationship descriptions in ${requests.length} source groups synchronously with ${model}`);
    const r = await runSync(requests, flagNum(flags, "concurrency", 4), save);
    console.error(`Done: ${r.ok} ok, ${r.bad} failed, approx cost $${r.cost.toFixed(3)}`);
    return;
  }
  if (flags.submit) {
    const id = await submitBatch("relationships", requests, model);
    console.log(`Submitted batch ${id}: ${requests.length} source groups covering ${relCount} relationships (${model}, effort ${effort}).`);
    return;
  }
  console.error("Specify --sync, --submit, --status or --fetch");
  process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
