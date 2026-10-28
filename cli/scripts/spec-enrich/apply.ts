/**
 * Apply proposals to the hand-maintained spec sources.
 *
 *   bun apply.ts --layer application --dry-run     # show what would change
 *   bun apply.ts --layer application                # write node + relationship changes
 *   bun apply.ts --nodes-only | --rels-only
 *
 * Node schemas: description <- definition + "Use X instead when ..." sentences;
 *   x-dr-standard, x-dr-evidence, x-dr-distinguish; attribute descriptions filled
 *   where missing (never overwritten unless --overwrite-attributes).
 * Relationship schemas: description <- meaning sentence; x-dr-evidence <- [evidence].
 * Afterwards run `npm run build:spec` at the repo root and `npm run build` in cli/.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { flagStr, parseFlags } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { loadNodeSchemas, loadRelationshipSchemas, writeSchemaFile, type NodeSchema } from "./lib/schemas.js";
import type { NodeProposal } from "./propose-nodes.js";
import type { RelationshipProposalFile } from "./propose-relationships.js";

function composeDescription(p: NodeProposal, siblings: Map<string, NodeSchema>): string {
  const parts = [p.definition.trim()];
  for (const d of p.distinguish_from) {
    const sib = siblings.get(d.type) ?? siblings.get(d.type.split(".").pop() ?? d.type);
    const name = sib ? sib.title : d.type;
    const when = d.when.trim().replace(/^when\s+/i, "").replace(/\.$/, "");
    parts.push(`Use ${name} instead when ${when}.`);
  }
  return parts.join(" ");
}

function show(label: string, before: string, after: string) {
  console.log(`\n### ${label}`);
  console.log(`- before: ${before || "(empty)"}`);
  console.log(`+ after:  ${after}`);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const layerFilter = flagStr(flags, "layer");
  const dry = !!flags["dry-run"];
  const doNodes = !flags["rels-only"];
  const doRels = !flags["nodes-only"];
  let nodeChanges = 0,
    attrChanges = 0,
    relChanges = 0;

  if (doNodes) {
    const nodes = loadNodeSchemas(layerFilter);
    const byType = new Map<string, NodeSchema>();
    for (const n of nodes) {
      byType.set(n.type, n);
      byType.set(n.specNodeId, n);
    }
    for (const n of nodes) {
      const pf = path.join(harnessDir(), "data", "proposals", "nodes", n.layer, `${n.type}.json`);
      if (!existsSync(pf)) continue;
      const p = JSON.parse(readFileSync(pf, "utf8")) as NodeProposal;
      const siblings = new Map([...byType.entries()].filter(([, s]) => s.layer === n.layer));
      const newDesc = composeDescription(p, siblings);
      const raw = n.raw;
      const changed = raw.description !== newDesc;
      if (changed) {
        show(`node ${n.specNodeId}`, String(raw.description ?? ""), newDesc);
        raw.description = newDesc;
        nodeChanges++;
      }
      if (p.standard_reference) raw["x-dr-standard"] = p.standard_reference;
      raw["x-dr-evidence"] = p.code_evidence;
      if (p.distinguish_from.length) raw["x-dr-distinguish"] = Object.fromEntries(p.distinguish_from.map((d) => [d.type, d.when]));
      const attrs = ((raw.properties as Record<string, unknown>)?.attributes as { properties?: Record<string, Record<string, unknown>> } | undefined)?.properties ?? {};
      for (const a of p.attribute_descriptions) {
        const spec = attrs[a.name];
        if (!spec) {
          console.error(`  (skip) ${n.specNodeId}.${a.name}: attribute not in schema`);
          continue;
        }
        if (spec.description && !flags["overwrite-attributes"]) continue;
        show(`attribute ${n.specNodeId}.${a.name}`, String(spec.description ?? ""), a.description);
        spec.description = a.description;
        attrChanges++;
      }
      if (!dry) writeSchemaFile(n.file, raw);
    }
  }

  if (doRels) {
    const rels = loadRelationshipSchemas(layerFilter);
    const byId = new Map(rels.map((r) => [r.id, r]));
    const root = path.join(harnessDir(), "data", "proposals", "relationships");
    if (existsSync(root)) {
      for (const layer of readdirSync(root)) {
        if (layerFilter && layer !== layerFilter) continue;
        for (const fn of readdirSync(path.join(root, layer)).filter((f) => f.endsWith(".json"))) {
          const pf = JSON.parse(readFileSync(path.join(root, layer, fn), "utf8")) as RelationshipProposalFile;
          for (const pr of pf.relationships) {
            const r = byId.get(pr.id);
            if (!r) continue;
            const desc = pr.description.trim();
            if (r.raw.description === desc && JSON.stringify(r.raw["x-dr-evidence"]) === JSON.stringify([pr.evidence])) continue;
            show(`relationship ${pr.id}`, String(r.raw.description ?? ""), `${desc}  [evidence: ${pr.evidence}]`);
            r.raw.description = desc;
            r.raw["x-dr-evidence"] = [pr.evidence.trim()];
            relChanges++;
            if (!dry) writeSchemaFile(r.file, r.raw);
          }
        }
      }
    }
  }

  console.log(`\n${dry ? "Would change" : "Changed"}: ${nodeChanges} node descriptions, ${attrChanges} attribute descriptions, ${relChanges} relationship descriptions.`);
  if (!dry && nodeChanges + attrChanges + relChanges > 0) console.log("Next: npm run build:spec (repo root) && cd cli && npm run build");
}

main();
