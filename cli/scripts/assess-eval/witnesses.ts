/**
 * Track B: the review question bank's model witnesses, computed before the agent reads any code.
 *
 *   bun witnesses.ts --models heimdall=~/workspace/heimdall [--check]
 *
 * `--check` only validates questions.json against the catalog. Otherwise it writes, per model,
 * data/<model>/witnesses.json and data/<model>/witnesses.md (the agent's input, kept local), and
 * data/witness-report.md (counts only). Code witnesses and code preconditions are listed for the
 * agent to run against the CBM index; this script does not evaluate them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HARNESS_DIR, layerOf, type Catalog } from "./catalog.js";
import type { PairRow, TypeRow } from "./ledger-core.js";
import { indexModel, type El, type Model, type ModelIndex } from "./model.js";
import { dataDir, num, parseFlags, setup } from "./run.js";

type Direction = "out" | "in";
interface Alt {
  direction: Direction;
  predicate: string;
  /** A spec node id, a prefix ending in "." (a layer or `layer.type`), or "" for any type. */
  otherType: string;
}
type Witness =
  | { id: string; kind: "present"; anyType: string[] }
  | { id: string; kind: "has"; type: string; anyOf: Alt[] }
  | {
      id: string;
      kind: "trace";
      from: string[];
      to: string[];
      via: Array<{ predicate: string; direction: Direction | "both" }>;
      maxDepth: number;
    }
  | { id: string; kind: "code"; cbm: string; compareTo: string[] };
interface Question {
  id: string;
  view: string;
  question: string;
  layers: string[];
  applies?: { anyLayer?: string[]; anyType?: string[]; code?: string };
  witnesses: Witness[];
  evidence: string[];
  answer: string;
}
interface Bank {
  version: string;
  questions: Question[];
}

export function loadBank(): Bank {
  return JSON.parse(
    readFileSync(path.join(HARNESS_DIR, "questions.json"), "utf8")
  ) as Bank;
}

const matches = (type: string, pattern: string): boolean =>
  pattern === "" ||
  (pattern.endsWith(".") ? type.startsWith(pattern) : type === pattern);

/** Every type and shape the bank names must exist in the spec. */
export function validateBank(bank: Bank, catalog: Catalog): string[] {
  const errors: string[] = [];
  const types = new Set(catalog.nodeTypes);
  const known = (t: string, where: string) => {
    if (t === "" || t.endsWith(".")) {
      if (!catalog.nodeTypes.some((n) => matches(n, t)))
        errors.push(`${where}: no type matches ${t}`);
    } else if (!types.has(t)) errors.push(`${where}: unknown type ${t}`);
  };
  for (const q of bank.questions) {
    for (const w of q.witnesses) {
      const where = `${q.id}/${w.id}`;
      if (w.kind === "present") w.anyType.forEach((t) => known(t, where));
      if (w.kind === "code") w.compareTo.forEach((t) => known(t, where));
      if (w.kind === "trace")
        [...w.from, ...w.to].forEach((t) => known(t, where));
      if (w.kind !== "has") continue;
      known(w.type, where);
      for (const a of w.anyOf) {
        known(a.otherType, where);
        const ok = catalog.triples.some((t) =>
          a.direction === "out"
            ? t.source === w.type &&
              t.predicate === a.predicate &&
              matches(t.destination, a.otherType)
            : t.destination === w.type &&
              t.predicate === a.predicate &&
              matches(t.source, a.otherType)
        );
        if (!ok)
          errors.push(
            `${where}: no catalog triple for ${a.direction === "out" ? `${w.type} ${a.predicate} ${a.otherType || "*"}` : `${a.otherType || "*"} ${a.predicate} ${w.type}`}`
          );
      }
    }
  }
  return errors;
}

interface Edge {
  predicate: string;
  direction: Direction;
  other: string;
}

function adjacency(model: Model): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  const add = (id: string, e: Edge) => {
    const list = adj.get(id);
    if (list) list.push(e);
    else adj.set(id, [e]);
  };
  for (const r of model.rels) {
    add(r.source, {
      predicate: r.predicate,
      direction: "out",
      other: r.target
    });
    add(r.target, { predicate: r.predicate, direction: "in", other: r.source });
  }
  return adj;
}

export interface WitnessResult {
  question: string;
  witness: string;
  kind: Witness["kind"];
  /** Whether the witness could run on this model (its subject type is present). */
  ran: boolean;
  fired: boolean;
  /** Elements the answer is missing (has, trace), with what the trace reached. */
  items: Array<{ element: string; reached?: string[] }>;
  /** For code witnesses: the query and the model's count of the types it is compared with. */
  cbm?: string;
  modelCount?: number;
}

function hasShape(
  el: El,
  a: Alt,
  adj: Map<string, Edge[]>,
  model: Model
): boolean {
  return (adj.get(el.id) ?? []).some(
    (e) =>
      e.direction === a.direction &&
      e.predicate === a.predicate &&
      matches(model.elements.get(e.other)!.type, a.otherType)
  );
}

function runWitness(
  q: Question,
  w: Witness,
  model: Model,
  idx: ModelIndex,
  adj: Map<string, Edge[]>
): WitnessResult {
  const base = { question: q.id, witness: w.id, kind: w.kind };
  const countOf = (patterns: string[]) =>
    [...model.elements.values()].filter((el) =>
      patterns.some((p) => matches(el.type, p))
    ).length;
  switch (w.kind) {
    case "present": {
      const n = countOf(w.anyType);
      return { ...base, ran: true, fired: n === 0, items: [] };
    }
    case "code":
      return {
        ...base,
        ran: false,
        fired: false,
        items: [],
        cbm: w.cbm,
        modelCount: countOf(w.compareTo)
      };
    case "has": {
      const els = idx.byType.get(w.type) ?? [];
      const items = els
        .filter((el) => !w.anyOf.some((a) => hasShape(el, a, adj, model)))
        .map((el) => ({ element: el.id }));
      return { ...base, ran: els.length > 0, fired: items.length > 0, items };
    }
    case "trace": {
      const entries = [...model.elements.values()].filter((el) =>
        w.from.some((p) => matches(el.type, p))
      );
      const items: WitnessResult["items"] = [];
      for (const start of entries) {
        const seen = new Set([start.id]);
        let frontier = [start.id];
        let reached = false;
        for (let d = 0; d < w.maxDepth && frontier.length && !reached; d++) {
          const next: string[] = [];
          for (const id of frontier)
            for (const e of adj.get(id) ?? []) {
              if (seen.has(e.other)) continue;
              const step = w.via.find(
                (v) =>
                  v.predicate === e.predicate &&
                  (v.direction === "both" || v.direction === e.direction)
              );
              if (!step) continue;
              seen.add(e.other);
              next.push(e.other);
              if (
                w.to.some((p) => matches(model.elements.get(e.other)!.type, p))
              )
                reached = true;
            }
          frontier = next;
        }
        if (!reached)
          items.push({
            element: start.id,
            reached: [
              ...new Set(
                [...seen]
                  .filter((id) => id !== start.id)
                  .map((id) => model.elements.get(id)!.type)
              )
            ].sort()
          });
      }
      return {
        ...base,
        ran: entries.length > 0,
        fired: items.length > 0,
        items
      };
    }
  }
}

/** Whether the question applies, from the model alone; a code precondition is the agent's. */
function applies(q: Question, idx: ModelIndex): "yes" | "no" | "code" {
  if (!q.applies) return "yes";
  const { anyLayer, anyType, code } = q.applies;
  if (anyLayer?.some((l) => (idx.byLayer.get(l)?.length ?? 0) > 0))
    return "yes";
  if (anyType?.some((t) => (idx.byType.get(t)?.length ?? 0) > 0)) return "yes";
  return code ? "code" : "no";
}

/** Assign each open ledger row to the question whose layers cover it most narrowly. */
function assign(bank: Bank, a: string, b: string): string {
  const fits = (need: string[]) =>
    bank.questions
      .filter((q) => need.every((l) => q.layers.includes(l)))
      .sort((x, y) => x.layers.length - y.layers.length)[0]?.id;
  return fits([a, b]) ?? fits([a]) ?? fits([b]) ?? "other";
}

const flags = parseFlags(process.argv.slice(2));
const { catalog, models } = await setup({ ...flags, "no-code": true });
const bank = loadBank();
const errors = validateBank(bank, catalog);
if (errors.length) {
  console.error(`questions.json does not match spec ${catalog.specVersion}:`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
if (flags.check) {
  console.log(
    `questions.json ${bank.version}: ${bank.questions.length} questions, ${bank.questions.reduce((n, q) => n + q.witnesses.length, 0)} witnesses, valid against spec ${catalog.specVersion}`
  );
  process.exit(0);
}

const report: string[] = [
  "# Question bank witnesses",
  "",
  `Bank ${bank.version}, spec ${catalog.specVersion}. Generated by \`witnesses.ts\`; no model calls. A witness "fired" when the model lacks what it asks for; the number is the elements the answer is missing (for \`present\`, 1 means the types are absent). Code witnesses are run by the agent and are not counted here. Ledger rows are the open layer pairs (empty or thin) and open relationship types, each assigned to the question that covers its layers.`,
  ""
];
for (const { model, idx, ledger } of models) {
  const adj = adjacency(model);
  const perQuestion = bank.questions.map((q) => {
    const state = applies(q, idx);
    const results = q.witnesses.map((w) => runWitness(q, w, model, idx, adj));
    return { q, state, results };
  });
  const openPairs = ledger.pairs.filter(
    (p: PairRow) => p.state === "empty" || p.state === "thin"
  );
  const openTypes = ledger.types.filter((t: TypeRow) => t.state !== "used");
  const rows = new Map<string, { pairs: string[]; types: string[] }>();
  const slot = (id: string) => {
    if (!rows.has(id)) rows.set(id, { pairs: [], types: [] });
    return rows.get(id)!;
  };
  for (const p of openPairs)
    slot(assign(bank, p.layers[0], p.layers[1])).pairs.push(
      `${p.pair} (${p.state})`
    );
  for (const t of openTypes)
    slot(
      assign(bank, layerOf(t.triple.source), layerOf(t.triple.destination))
    ).types.push(`${t.triple.id} (${t.state})`);

  const dir = dataDir(model.name);
  writeFileSync(
    path.join(dir, "witnesses.json"),
    JSON.stringify(
      {
        model: model.name,
        commit: model.commit,
        bank: bank.version,
        spec: catalog.specVersion,
        questions: perQuestion.map(({ q, state, results }) => ({
          id: q.id,
          applies: state,
          witnesses: results,
          ledger: rows.get(q.id) ?? { pairs: [], types: [] }
        })),
        unassigned: rows.get("other") ?? { pairs: [], types: [] }
      },
      null,
      2
    )
  );

  const md: string[] = [
    `# Witnesses: ${model.name} (${model.commit})`,
    "",
    `Bank ${bank.version}. The agent's input for step A of the protocol (RUNBOOK.md). Every fired witness and every ledger row below needs a verdict in the answer log.`,
    ""
  ];
  for (const { q, state, results } of perQuestion) {
    md.push(`## ${q.id}. ${q.question}`, "");
    md.push(
      state === "yes"
        ? "Applies."
        : state === "code"
          ? `Applies if the code shows it: ${q.applies!.code}. Check before answering; if it does not, record the question as not applicable.`
          : "Does not apply to this model (record it as not applicable).",
      ""
    );
    for (const r of results) {
      if (r.kind === "code") {
        md.push(
          `- **${r.witness}** (code): run \`${r.cbm}\` and compare with the model's ${r.modelCount} element(s) of the compared types.`
        );
        continue;
      }
      if (!r.ran) {
        md.push(
          `- **${r.witness}** (${r.kind}): subject type absent, did not run.`
        );
        continue;
      }
      if (!r.fired) {
        md.push(`- **${r.witness}** (${r.kind}): satisfied.`);
        continue;
      }
      if (r.kind === "present") {
        md.push(
          `- **${r.witness}** (present): fired, none of these types in the model.`
        );
        continue;
      }
      md.push(`- **${r.witness}** (${r.kind}): ${r.items.length} element(s).`);
      for (const it of r.items)
        md.push(
          `  - \`${it.element}\`${it.reached ? ` (reached: ${it.reached.join(", ") || "nothing"})` : ""}`
        );
    }
    const led = rows.get(q.id);
    if (led?.pairs.length || led?.types.length) {
      md.push("", "Ledger rows assigned here:");
      for (const p of led.pairs) md.push(`- pair ${p}`);
      for (const t of led.types) md.push(`- type ${t}`);
    }
    md.push("");
  }
  const other = rows.get("other");
  if (other?.pairs.length || other?.types.length) {
    md.push("## Ledger rows no question covers", "");
    for (const p of other.pairs) md.push(`- pair ${p}`);
    for (const t of other.types) md.push(`- type ${t}`);
  }
  writeFileSync(path.join(dir, "witnesses.md"), md.join("\n") + "\n");

  report.push(`## ${model.name} (${model.commit})`, "");
  report.push(
    "| Question | Applies | Witnesses run | Fired | Elements flagged | Ledger pairs | Ledger types |",
    "| -------- | ------- | ------------- | ----- | ---------------- | ------------ | ------------ |"
  );
  for (const { q, state, results } of perQuestion) {
    const ran = results.filter((r) => r.ran);
    const fired = ran.filter((r) => r.fired);
    const flagged = fired.reduce(
      (n, r) => n + (r.kind === "present" ? 1 : r.items.length),
      0
    );
    const led = rows.get(q.id);
    report.push(
      `| ${q.id} | ${state} | ${ran.length} of ${results.filter((r) => r.kind !== "code").length} | ${fired.length} | ${num(flagged)} | ${led?.pairs.length ?? 0} | ${led?.types.length ?? 0} |`
    );
  }
  report.push(
    `| other | | | | | ${other?.pairs.length ?? 0} | ${other?.types.length ?? 0} |`,
    ""
  );
}
writeFileSync(path.join(dataDir(), "witness-report.md"), report.join("\n"));
console.log(`Wrote ${path.join(dataDir(), "witness-report.md")}`);
