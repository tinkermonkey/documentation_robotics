/** Shared set-up for the harness scripts: flags, models, and one pass of every free finder. */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { HARNESS_DIR, loadCatalog, type Catalog } from "./catalog.js";
import {
  CODE_FINDERS,
  claimNodes,
  loadCodeGraph,
  type Claims,
  type CodeGraph
} from "./code-graph.js";
import {
  fleetEntry,
  MODEL_FINDERS,
  type FinderContext,
  type Finding
} from "./finders.js";
import { buildLedger, type Ledger } from "./ledger-core.js";
import {
  indexModel,
  loadModel,
  parseModelsFlag,
  type Model,
  type ModelIndex
} from "./model.js";

export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--"))
      out[arg.slice(2)] = argv[++i];
    else out[arg.slice(2)] = true;
  }
  return out;
}

export function dataDir(...parts: string[]): string {
  const dir = path.join(HARNESS_DIR, "data", ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface Loaded {
  model: Model;
  idx: ModelIndex;
  ledger: Ledger;
  /** The code index for the model's repository, when codebase-memory-mcp has one. */
  graph: CodeGraph | null;
}

export interface Setup {
  catalog: Catalog;
  models: Loaded[];
}

export async function setup(
  flags: Record<string, string | boolean>
): Promise<Setup> {
  const spec =
    typeof flags.models === "string"
      ? flags.models
      : process.env.DR_ASSESS_MODELS;
  if (!spec)
    throw new Error(
      "Pass --models name=path,name=path (a model directory or a repository root), or set DR_ASSESS_MODELS"
    );
  const catalog = loadCatalog();
  const edgeTypes = catalog.edgeMappings
    .filter((m) => m.usage === "verification_and_mapping")
    .map((m) => m.cbm_edge);
  const models: Loaded[] = [];
  for (const { name, dir } of parseModelsFlag(spec)) {
    const model = loadModel(name, dir);
    const idx = indexModel(model);
    const graph = flags["no-code"]
      ? null
      : await loadCodeGraph(model.root, edgeTypes);
    models.push({
      model,
      idx,
      ledger: buildLedger(model, idx, catalog),
      graph
    });
  }
  return { catalog, models };
}

export interface FinderRun {
  findings: Map<string, Finding[]>;
  claims: Claims | null;
}

/** Every free finder over one (possibly ablated) model. `fleet` is the other models, as loaded. */
export function runFinders(
  model: Model,
  catalog: Catalog,
  fleet: Loaded[],
  graph: CodeGraph | null
): FinderRun {
  const idx = indexModel(model);
  const ctx: FinderContext = {
    model,
    idx,
    catalog,
    ledger: buildLedger(model, idx, catalog),
    fleet: fleet.map((f) => fleetEntry(f.model, f.idx))
  };
  const findings = new Map<string, Finding[]>();
  for (const [name, finder] of Object.entries(MODEL_FINDERS))
    findings.set(name, finder(ctx));
  let claims: Claims | null = null;
  if (graph) {
    claims = claimNodes(model, graph);
    for (const [name, finder] of Object.entries(CODE_FINDERS))
      findings.set(name, finder({ ...ctx, graph, claims }));
  }
  return { findings, claims };
}

export const FINDER_NAMES = [
  ...Object.keys(MODEL_FINDERS),
  ...Object.keys(CODE_FINDERS)
];
/** The ledger's rows are the questions; the rest propose answers. */
export const QUESTION_FINDERS = new Set([
  "ledger-empty-pair",
  "ledger-open-type"
]);

export const pct = (k: number, n: number): string =>
  n ? `${((100 * k) / n).toFixed(0)}%` : "-";
export const num = (n: number): string => n.toLocaleString("en-US");
