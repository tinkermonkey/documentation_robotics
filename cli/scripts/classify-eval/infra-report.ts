/**
 * Infrastructure extraction against hand-labelled gold (inventory step 9, #1081).
 *
 *   bun infra-report.ts [--corpus petclinic] [--mapping path/to/cbm.json] [--tag after] [--stdout]
 *
 * For each corpus with a data/<corpus>/infra-gold.json, runs the CLI's own extraction over the
 * corpus's live CBM index (read-only; root and project from data/<corpus>/meta.json): cards and
 * Tier 0 (cards/extract.ts), the element plan on an empty model with infrastructure symbols merged
 * by name (extraction-plan.ts planElements), and the relationships the edge mapping gives between
 * them (planRelationships). Only the infrastructure labels (Table, Resource, Image, Chart, Process)
 * the mapping reads are extracted: a mapping that names none of them (the one before #1081) reads
 * nothing.
 *
 * Scores, against gold:
 *   nodes          each CBM node: decided as gold, decided wrongly, rejected, left to the agent
 *   elements       one per merged name (layer.type|name): precision and recall
 *   staged alone   adds whose required attributes the code gives; the rest are needs-attributes
 *                  cards, which the agent stages
 *   relationships  gold relationships the edge mapping produces, in the first run (between adds
 *                  that stage alone) and once the agent has staged the needs-attributes cards
 *
 * Writes data/infra-report@<tag>.md (tag defaults to "after"), or prints it with --stdout.
 */
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { findCbmBinary } from "./lib/cbm.js";
import { StdioClient } from "../../src/analyzers/stdio-client.js";
import { CbmTools } from "../../src/analyzers/cbm-responses.js";
import { cbmCardGraph } from "../../src/analyzers/cards/graph.js";
import { corpusDir, flagStr, parseFlags, readJson } from "./lib/io.js";
import { harnessDir } from "./lib/env.js";
import { collectExtraction, extractionConfigFrom } from "../../src/analyzers/cards/extract.js";
import { INFRA_LABELS } from "../../src/analyzers/cards/build.js";
import { defaultLabels } from "../../src/analyzers/cards/classify.js";
import { planElements, planRelationships, type PlannedElement } from "../../src/analyzers/extraction-plan.js";
import { tier0RulesFrom } from "../../src/analyzers/tier0-rules.js";
import type { AnalyzerEdgeMapping, AnalyzerHeuristic, AnalyzerNodeMapping } from "../../src/analyzers/types.js";
import type { ChangesetGraph } from "../../src/core/changeset-graph.js";
import { getValidRelationships } from "../../src/generated/relationship-index.js";

interface GoldNode {
  label: string;
  name: string;
  files: string[];
  gold: string;
  rationale: string;
}
interface GoldRelationship {
  source: string;
  predicate: string;
  target: string;
  edge: string | null;
}
interface Gold {
  corpus: string;
  nodes: GoldNode[];
  relationships: GoldRelationship[];
}

const flags = parseFlags(process.argv.slice(2));
const repoRoot = path.resolve(harnessDir(), "../../..");
const mappingPath = flagStr(flags, "mapping", path.join(repoRoot, "spec/dist/analyzers/cbm.json"))!;
const tag = flagStr(flags, "tag", "after")!;
const only = flagStr(flags, "corpus");

function hasTriple(id: string): boolean {
  const p = id.split(".");
  return p.length === 5 && getValidRelationships(`${p[0]}.${p[1]}`, p[2], `${p[3]}.${p[4]}`).length > 0;
}

/** Required attributes per `layer.type`, from the compiled spec. */
function requiredAttributes(layer: string, type: string): string[] {
  const dist = JSON.parse(readFileSync(path.join(repoRoot, "spec/dist", `${layer}.json`), "utf-8"));
  const schema = dist.nodeSchemas?.[`${layer}.${type}`] ?? Object.values(dist.nodeSchemas ?? {}).find((s: any) => s?.properties?.spec_node_id?.const === `${layer}.${type}`);
  const required = new Set<string>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    const attrs = (o as any).properties?.attributes;
    if (attrs?.required) for (const r of attrs.required) required.add(r);
    for (const v of Object.values(o)) walk(v);
  };
  walk(schema);
  return [...required];
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "n/a");

async function run(corpus: string, gold: Gold): Promise<string> {
  const meta = readJson<{ root?: string; project?: string }>(path.join(corpusDir(corpus), "meta.json"), {});
  if (!meta.root) throw new Error(`data/${corpus}/meta.json has no root`);
  const mapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
  const rules = tier0RulesFrom((mapping.heuristics?.heuristics ?? []) as AnalyzerHeuristic[]);
  const config = extractionConfigFrom(
    rules,
    Object.values(mapping.edges_by_type) as AnalyzerEdgeMapping[],
    Object.values(mapping.nodes_by_label) as AnalyzerNodeMapping[]
  );
  // The infrastructure labels this mapping reads at all.
  const read = new Set([...defaultLabels(rules), ...Object.keys(config.labelDecisions)]);
  const labels = [...INFRA_LABELS].filter((l) => read.has(l));

  // The CLI's StdioClient waits 5 s for initialize, and CBM 0.12.1 has been seen to take just over
  // that to answer, so initialize here with a longer timeout.
  const client = new StdioClient();
  let extraction;
  try {
    client.spawn(findCbmBinary());
    await client.callTool("initialize", { name: "dr-classify-eval", version: "0.0.1" }, { timeout: 60_000 });
    const tools = new CbmTools(client, { timeout: 120_000 });
    const project = (await tools.listProjects()).find((p) => p.root_path === meta.root)?.name;
    if (!project) throw new Error(`${meta.root} is not indexed; index it with codebase-memory-mcp first`);
    extraction = labels.length ? await collectExtraction(cbmCardGraph(tools, project), config, "cbm", { sourceRoot: meta.root, labels }) : null;
  } finally {
    client.close();
  }

  const empty = { elements: new Map(), getRelationship: () => undefined } as unknown as ChangesetGraph;
  const plan = extraction ? planElements(extraction, empty, { fileExists: () => true }) : null;
  const adds: PlannedElement[] = plan?.adds ?? [];
  const keyOfAdd = (a: PlannedElement) => `${a.layer}.${a.type}|${a.symbol.card.name}`;

  // Nodes: one row per gold node (its CBM symbols share the outcome).
  const symbolsByName = new Map<string, NonNullable<typeof extraction>["symbols"]>();
  for (const s of extraction?.symbols ?? []) {
    const k = `${s.card.label}|${s.card.name}`;
    symbolsByName.set(k, [...(symbolsByName.get(k) ?? []), s]);
  }
  let symbolsTotal = 0;
  const nodeRows: string[] = [];
  const counts = { right: 0, wrong: 0, rejectedRight: 0, rejectedWrong: 0, agent: 0, unread: 0 };
  for (const n of gold.nodes) {
    const syms = symbolsByName.get(`${n.label}|${n.name}`) ?? [];
    symbolsTotal += Math.max(syms.length, 1);
    const t = syms[0]?.tier0;
    let outcome: string;
    if (!syms.length) {
      outcome = "not read";
      counts.unread++;
    } else if (!t || t.kind === "narrow") {
      outcome = t ? `narrowed (${t.rule})` : "left to the agent";
      counts.agent++;
    } else if (t.kind === "reject") {
      outcome = `none (${t.rule})`;
      if (n.gold === "none") counts.rejectedRight++;
      else counts.rejectedWrong++;
    } else {
      const decided = `${t.layer}.${t.type}`;
      outcome = `${decided} (${t.rule})`;
      if (decided === n.gold) counts.right++;
      else counts.wrong++;
    }
    const mark = outcome.startsWith(n.gold) || (n.gold === "none" && outcome.startsWith("none")) ? "yes" : "no";
    nodeRows.push(`| ${n.label} | \`${n.name}\` | ${syms.length || "-"} | ${n.gold} | ${outcome} | ${mark} |`);
  }

  // Elements.
  const goldElements = new Set(gold.nodes.filter((n) => n.gold !== "none").map((n) => `${n.gold}|${n.name}`));
  const predicted = new Set(adds.map(keyOfAdd));
  const tp = [...predicted].filter((k) => goldElements.has(k)).length;
  const alone = adds.filter((a) => requiredAttributes(a.layer, a.type).every((r) => a.attributes[r] !== undefined && a.attributes[r] !== ""));
  const needsAttributes = adds.filter((a) => !alone.includes(a));

  // Relationships: first run (only adds that stage alone are elements), then with every add.
  const relationshipsWith = (kept: PlannedElement[]) => {
    if (!extraction || !plan) return [];
    const elements = new Map(kept.map((a) => [a.id, { layer: a.layer, type: a.type }]));
    const elementOf = new Map([...plan.elementOf].filter(([, id]) => elements.has(id)));
    const byId = new Map(kept.map((a) => [a.id, keyOfAdd(a)]));
    return planRelationships(extraction, empty, elementOf, elements, hasTriple).relationships.map((r) => ({
      key: `${byId.get(r.source)} ${r.predicate} ${byId.get(r.target)}`,
      edge: r.edge,
    }));
  };
  const first = relationshipsWith(alone);
  const all = relationshipsWith(adds);
  const goldRel = new Set(gold.relationships.map((r) => `${r.source} ${r.predicate} ${r.target}`));
  const hits = (rs: Array<{ key: string }>) => rs.filter((r) => goldRel.has(r.key)).length;

  const out: string[] = [];
  out.push(`## ${corpus}`, "");
  const shown = mappingPath.startsWith(repoRoot + path.sep) ? path.relative(repoRoot, mappingPath) : path.basename(mappingPath);
  out.push(`Mapping: \`${shown}\`; infrastructure labels read: ${labels.length ? labels.join(", ") : "none"}.`, "");
  out.push(`### Nodes (${gold.nodes.length} names, ${symbolsTotal} CBM nodes)`, "");
  out.push(
    `Decided as gold ${counts.right}, decided wrongly ${counts.wrong}, rejected as gold ${counts.rejectedRight}, rejected wrongly ${counts.rejectedWrong}, ` +
      `left to the agent ${counts.agent}, not read ${counts.unread}.`,
    ""
  );
  out.push("| label | name | CBM nodes | gold | extraction | agrees |", "| --- | --- | --- | --- | --- | --- |", ...nodeRows, "");
  out.push("### Elements", "");
  out.push(
    `Gold elements ${goldElements.size}; extracted ${predicted.size}; correct ${tp} (precision ${pct(tp, predicted.size)}, recall ${pct(tp, goldElements.size)}). ` +
      `Staged without help ${alone.length}; needs-attributes cards ${needsAttributes.length}` +
      (needsAttributes.length ? ` (${[...new Set(needsAttributes.map((a) => `${a.layer}.${a.type}`))].join(", ")})` : "") +
      ".",
    ""
  );
  const wrongEls = [...predicted].filter((k) => !goldElements.has(k));
  const missedEls = [...goldElements].filter((k) => !predicted.has(k));
  if (wrongEls.length) out.push(`Not in gold: ${wrongEls.map((k) => `\`${k}\``).join(", ")}.`, "");
  if (missedEls.length) out.push(`Missed: ${missedEls.map((k) => `\`${k}\``).join(", ")}.`, "");
  out.push("### Relationships", "");
  out.push(
    `Gold ${goldRel.size}. First run: ${first.length} produced, ${hits(first)} in gold. ` +
      `After the agent stages the needs-attributes cards: ${all.length} produced, ${hits(all)} in gold (recall ${pct(hits(all), goldRel.size)}).`,
    ""
  );
  out.push("| gold relationship | CBM edge that could carry it | produced |", "| --- | --- | --- |");
  const allKeys = new Map(all.map((r) => [r.key, r.edge]));
  for (const r of gold.relationships) {
    const k = `${r.source} ${r.predicate} ${r.target}`;
    out.push(`| \`${k}\` | ${r.edge ?? "none"} | ${allKeys.has(k) ? `yes (${allKeys.get(k)})` : "no"} |`);
  }
  const extra = all.filter((r) => !goldRel.has(r.key));
  if (extra.length) out.push("", `Produced, not in gold: ${extra.map((r) => `\`${r.key}\` (${r.edge})`).join(", ")}.`);
  out.push("");
  return out.join("\n");
}

const corpora = ["petclinic", "fastapi"].filter((c) => !only || c === only);
const sections: string[] = [
  `# Infrastructure extraction against gold (${tag})`,
  "",
  "Generated by `infra-report.ts`; gold in `data/<corpus>/infra-gold.json`. See docs/analyzers/CBM_MAPPING_INVENTORY.md, step 9.",
  "",
];
for (const corpus of corpora) {
  const gold = readJson<Gold | null>(path.join(corpusDir(corpus), "infra-gold.json"), null);
  if (!gold) continue;
  sections.push(await run(corpus, gold));
}
const text = sections.join("\n").trimEnd();
if (flags.stdout) process.stdout.write(text + "\n");
else {
  const file = path.join(harnessDir(), "data", `infra-report@${tag}.md`);
  writeFileSync(file, text + "\n");
  process.stderr.write(`Wrote ${path.relative(repoRoot, file)}\n`);
}
