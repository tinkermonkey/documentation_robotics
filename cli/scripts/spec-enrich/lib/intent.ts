import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../../classify-eval/lib/env.js";
import { proposalsDir } from "./paths.js";
import { describeNodeForPrompt, loadLayerDescription, loadNodeSchemas, loadPredicates, loadRelationshipSchemas, type NodeSchema } from "./schemas.js";
import type { NodeProposal } from "../propose-nodes.js";
import type { RelationshipProposalFile } from "../propose-relationships.js";

/**
 * "Design intent" context for triage: what the spec's own documentation says a
 * layer is for, plus the type's current schema and its proposed definition.
 * The proposer never saw this, which is why some of its concerns are the spec
 * working as designed.
 */

const SKILL_DIRS: Record<string, string> = {
  motivation: "dr_01_motivation_layer",
  business: "dr_02_business_layer",
  product: "dr_03_product_layer",
  security: "dr_04_security_layer",
  application: "dr_05_application_layer",
  technology: "dr_06_technology_layer",
  api: "dr_07_api_layer",
  "data-model": "dr_08_data_model_layer",
  "data-store": "dr_09_dataset_layer",
  ux: "dr_10_ux_layer",
  navigation: "dr_11_navigation_layer",
  apm: "dr_12_apm_layer",
  testing: "dr_13_testing_layer",
};

const intentCache = new Map<string, string>();

let charterCache: string | null = null;
/** spec/DESIGN_CHARTER.md: what the spec is, what nodes and relationships model, how to judge a change. */
export function charterText(): string {
  if (charterCache !== null) return charterCache;
  const f = path.join(repoRoot(), "spec", "DESIGN_CHARTER.md");
  charterCache = existsSync(f) ? readFileSync(f, "utf8").replace(/^\*\*Status:\*\*[^\n]*\n(?:[^\n]*\n)*?\n/m, "").trim() : "";
  return charterCache;
}

export function layerIntent(layer: string): string {
  const cached = intentCache.get(layer);
  if (cached) return cached;
  const parts = [`Layer definition: ${loadLayerDescription(layer)}`];
  const skill = path.join(repoRoot(), "integrations", "claude_code", "skills", SKILL_DIRS[layer] ?? "", "SKILL.md");
  if (existsSync(skill)) {
    const text = readFileSync(skill, "utf8");
    const m = /## Layer Overview\n([\s\S]*?)\n## /.exec(text);
    if (m) parts.push(`Layer skill overview (design intent):\n${m[1].trim()}`);
  }
  const out = parts.join("\n\n");
  intentCache.set(layer, out);
  return out;
}

let nodeCache: NodeSchema[] | null = null;
export function allNodes(): NodeSchema[] {
  if (!nodeCache) nodeCache = loadNodeSchemas();
  return nodeCache;
}

export function nodeById(specNodeId: string): NodeSchema | undefined {
  return allNodes().find((n) => n.specNodeId === specNodeId);
}

export function nodeProposal(n: NodeSchema): NodeProposal | null {
  const f = path.join(proposalsDir("nodes", n.layer), `${n.type}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as NodeProposal) : null;
}

export function relationshipProposals(source: NodeSchema): RelationshipProposalFile | null {
  const f = path.join(proposalsDir("relationships", source.layer), `${source.type}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as RelationshipProposalFile) : null;
}

/** Context block for a claim about a node type (or the relationships of a source type). */
export function typeContext(specNodeId: string, includeRelationships: boolean): string {
  const n = nodeById(specNodeId);
  if (!n) return `(unknown type ${specNodeId})`;
  const parts: string[] = [];
  parts.push(`Current schema:\n${describeNodeForPrompt(n)}`);
  const p = nodeProposal(n);
  if (p) {
    parts.push(`Proposed definition: ${p.definition}`);
    if (p.distinguish_from.length) parts.push(`Proposed distinctions: ${p.distinguish_from.map((d) => `use ${d.type.split(".").pop()} when ${d.when}`).join("; ")}`);
    if (p.standard_reference) parts.push(`Standard reference: ${p.standard_reference}`);
  }
  const siblings = allNodes()
    .filter((s) => s.layer === n.layer && s.specNodeId !== specNodeId)
    .map((s) => s.type);
  parts.push(`Sibling types in ${n.layer}: ${siblings.join(", ")}`);
  if (includeRelationships) {
    const rels = loadRelationshipSchemas().filter((r) => r.source === specNodeId || r.destination === specNodeId);
    parts.push(`Relationships (${rels.length}):\n${rels.map((r) => `  ${r.source} --[${r.predicate}]--> ${r.destination}`).join("\n")}`);
  }
  return parts.join("\n");
}

/**
 * Evidence pack: the verifiable facts a claim turns on, built deterministically
 * from the schema sources by looking at the ids the claim names.
 *  - attribute paths  -> how every type in the layer declares that attribute
 *  - type ids         -> every relationship between any two named types, both directions,
 *                        plus each named type's own relationship count
 *  - relationship ids -> the relationship's definition and its reverse/sibling predicates
 */
export function claimEvidence(affectedIds: string[], subject: string): string {
  const nodes = allNodes();
  const rels = loadRelationshipSchemas();
  const preds = loadPredicates();
  const out: string[] = [];
  const typeIds = new Set<string>([subject]);
  for (const id of affectedIds) {
    const parts = id.split(".");
    if (parts.length === 2 && nodes.some((n) => n.specNodeId === id)) typeIds.add(id);
  }
  // attribute declarations across the layer
  for (const id of affectedIds) {
    const parts = id.split(".");
    if (parts.length !== 3) continue;
    const [layer, , attr] = parts;
    const rows = nodes
      .filter((n) => n.layer === layer && n.attributes[attr])
      .map((n) => {
        const a = n.attributes[attr];
        return `  ${n.type}.${attr}: type=${String(a.type ?? "any")}${a.enum ? ` enum[${(a.enum as unknown[]).join("|")}]` : ""} required=${n.requiredAttributes.includes(attr)}${a.description ? ` desc="${String(a.description).slice(0, 90)}"` : " (no description)"}`;
      });
    out.push(`Attribute '${attr}' as declared across layer ${layer} (${rows.length} types):
${rows.join("\n") || "  (none)"}`);
  }
  // relationships between named types
  const ids = [...typeIds];
  const between = rels.filter((r) => ids.includes(r.source) && ids.includes(r.destination) && (r.source !== subject || r.destination !== subject || ids.length === 1));
  if (ids.length > 1 || between.length) {
    const seen = new Set<string>();
    const rows = between.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).map((r) => `  ${r.id}  (${r.predicate}: ${preds[r.predicate]?.description ?? "?"})`);
    out.push(`Relationship schemas between ${ids.join(", ")} (exact list, ${rows.length} schemas):
${rows.join("\n") || "  (none)"}`);
  }
  // named relationship ids
  for (const id of affectedIds) {
    const r = rels.find((x) => x.id === id);
    if (!r) continue;
    const reverse = rels.filter((x) => x.source === r.destination && x.destination === r.source).map((x) => x.predicate);
    const same = rels.filter((x) => x.source === r.source && x.destination === r.destination).map((x) => x.predicate);
    out.push(`Relationship ${id}: predicate ${r.predicate} (${preds[r.predicate]?.description ?? "?"}); all predicates ${r.source} -> ${r.destination}: [${same.join(", ")}]; reverse direction ${r.destination} -> ${r.source}: [${reverse.join(", ") || "none"}]`);
  }
  return out.join("\n\n") || "(no structured evidence for the named ids)";
}

/** All notes from proposals as {id, layer, subject, kind, text}. */
export interface Note {
  id: string; // node:<spec_node_id> | rel:<source spec_node_id>
  layer: string;
  subject: string; // spec_node_id
  kind: "node" | "relationships";
  text: string;
}

export function loadNotes(layerFilter?: string): Note[] {
  const out: Note[] = [];
  for (const n of allNodes()) {
    if (layerFilter && n.layer !== layerFilter) continue;
    const p = nodeProposal(n);
    if (p?.notes?.trim()) out.push({ id: `node:${n.specNodeId}`, layer: n.layer, subject: n.specNodeId, kind: "node", text: p.notes.trim() });
    const r = relationshipProposals(n);
    if (r?.notes?.trim()) out.push({ id: `rel:${n.specNodeId}`, layer: n.layer, subject: n.specNodeId, kind: "relationships", text: r.notes.trim() });
  }
  return out;
}

void readdirSync;
