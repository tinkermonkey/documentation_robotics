/**
 * Measure the spec's definitional coverage: thin node descriptions, attributes
 * without descriptions, boilerplate relationship descriptions, missing evidence.
 *
 *   bun inventory.ts [--layer <id>] [--json]
 */
import path from "node:path";
import { flagStr, parseFlags, writeJson } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";
import { BOILERPLATE_REL, loadLayerIds, loadNodeSchemas, loadRelationshipSchemas } from "./lib/schemas.js";

const SHORT = 120;

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const layerFilter = flagStr(flags, "layer");
  const nodes = loadNodeSchemas(layerFilter);
  const rels = loadRelationshipSchemas(layerFilter);
  const layers = loadLayerIds().filter((l) => !layerFilter || l === layerFilter);

  const perLayer = layers.map((layer) => {
    const ln = nodes.filter((n) => n.layer === layer);
    const lr = rels.filter((r) => r.sourceLayer === layer);
    const attrs = ln.flatMap((n) => Object.entries(n.attributes).map(([k, v]) => ({ node: n.specNodeId, name: k, hasDesc: !!v.description })));
    return {
      layer,
      node_types: ln.length,
      short_descriptions: ln.filter((n) => n.description.trim().length < SHORT).length,
      without_evidence: ln.filter((n) => n.evidence.length === 0).length,
      attributes: attrs.length,
      attributes_without_description: attrs.filter((a) => !a.hasDesc).length,
      relationships: lr.length,
      boilerplate_relationships: lr.filter((r) => BOILERPLATE_REL.test(r.description) || !r.description.trim()).length,
      relationships_without_evidence: lr.filter((r) => r.evidence.length === 0).length,
      shortest: ln
        .slice()
        .sort((a, b) => a.description.length - b.description.length)
        .slice(0, 3)
        .map((n) => `${n.specNodeId} (${n.description.length})`),
    };
  });
  const total = perLayer.reduce(
    (acc, l) => {
      for (const k of Object.keys(acc) as Array<keyof typeof acc>) acc[k] += l[k as keyof typeof l] as number;
      return acc;
    },
    { node_types: 0, short_descriptions: 0, without_evidence: 0, attributes: 0, attributes_without_description: 0, relationships: 0, boilerplate_relationships: 0, relationships_without_evidence: 0 },
  );
  const out = { generated_at: new Date().toISOString(), short_threshold_chars: SHORT, total, layers: perLayer };
  writeJson(path.join(harnessDir(), "data", "inventory.json"), out);
  if (flags.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`Spec definitional coverage (short = description under ${SHORT} chars)\n`);
  console.log("| layer | types | short desc | no evidence | attrs | attrs w/o desc | rels | boilerplate rels |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const l of perLayer) console.log(`| ${l.layer} | ${l.node_types} | ${l.short_descriptions} | ${l.without_evidence} | ${l.attributes} | ${l.attributes_without_description} | ${l.relationships} | ${l.boilerplate_relationships} |`);
  console.log(`| **total** | ${total.node_types} | ${total.short_descriptions} | ${total.without_evidence} | ${total.attributes} | ${total.attributes_without_description} | ${total.relationships} | ${total.boilerplate_relationships} |`);
  console.log(`\nWritten to data/inventory.json`);
}

main();
