/**
 * Testing a configuration (TIER1_DESIGN.md section 2.4): a fixed synthetic card, shipped with DR
 * and holding no project code, asked through the configured adapter. The result says who served
 * it, the model the response named, latency, the layer probabilities and cost, and flags a
 * failure, a different model, or (for a model with an expectation) answers further from the
 * expected ones than a tolerance. `dr analyzer tier1 test` and `enable` run it; its cost goes into
 * the ledger as `probe`.
 *
 * OpenRouter's per-upstream probes (one per upstream in `only`, each pinned) are rollout PR 6;
 * `upstream` is already passed through.
 */
import { askCard, chosenOf } from "../run.js";
import type { SpecCriteria } from "../criteria.js";
import type { StateCard } from "../state.js";
import { CURRENT_QSET_ID } from "../qset/index.js";
import { DecisionModelError, type DecisionModel } from "./types.js";

/** A repository class over a SQL table: synthetic, in no project. */
export const PROBE_CARD: Readonly<StateCard> = Object.freeze({
  label: "Class",
  name: "InvoiceRepository",
  qualified_name: "src.billing.invoice_repository.InvoiceRepository",
  file_path: "src/billing/invoice-repository.ts",
  start_line: 12,
  end_line: 58,
  signature: null,
  docstring: "Persists invoices in the billing database and reads them back by id or customer.",
  is_exported: true,
  is_entry_point: false,
  complexity: 6,
  parent_class: null,
  base_classes: [],
  return_type: null,
  callers: ["src.billing.invoice_service.InvoiceService.issue", "src.billing.invoice_service.InvoiceService.find"],
  callees: ["src.db.pool.Pool.query"],
  callers_total: 2,
  callees_total: 1,
  imports: ["src/db/pool.ts", "src/billing/invoice.ts"],
  env_vars: [],
  routes_handled: [],
  http_calls: [],
  inherits: [],
  implements: [],
  route_method: null,
  source: [
    "export class InvoiceRepository {",
    "  constructor(private readonly pool: Pool) {}",
    "",
    "  async save(invoice: Invoice): Promise<void> {",
    "    await this.pool.query(",
    '      "INSERT INTO invoices (id, customer_id, total_cents, issued_at) VALUES ($1, $2, $3, $4)",',
    "      [invoice.id, invoice.customerId, invoice.totalCents, invoice.issuedAt]",
    "    );",
    "  }",
    "",
    "  async findById(id: string): Promise<Invoice | null> {",
    '    const { rows } = await this.pool.query("SELECT * FROM invoices WHERE id = $1", [id]);',
    "    return rows[0] ? toInvoice(rows[0]) : null;",
    "  }",
    "",
    "  async findByCustomer(customerId: string): Promise<Invoice[]> {",
    '    const { rows } = await this.pool.query("SELECT * FROM invoices WHERE customer_id = $1", [customerId]);',
    "    return rows.map(toInvoice);",
    "  }",
    "}",
  ].join("\n"),
  source_lines_total: 20,
  source_truncated: false,
}) as StateCard;

/** What a model is expected to answer for the probe, measured live, and how far it may stray. */
export interface ProbeExpectation {
  qset: string;
  /** Expected layer probabilities (the leading ones). The comparison is by distribution, not by the top layer, which can be a near tie. */
  layers: Readonly<Record<string, number>>;
  /** Largest absolute difference in any listed layer's probability before the probe flags it. */
  tolerance: number;
  /** When and how it was measured. */
  measured: string;
}

/**
 * Expected answers by canonical model. A model without one is probed without the comparison.
 * Clef on Workers AI, measured once live (`dr analyzer tier1 test`, 2026-11-14): data-store 0.33,
 * application 0.31, data-model 0.13; Clef answers deterministically, so 0.1 is room for an fp8
 * upstream (OpenRouter's DeepInfra), not for noise.
 */
export const PROBE_EXPECTED: Readonly<Record<string, ProbeExpectation>> = Object.freeze({
  clef: {
    qset: "dr-qset-2",
    layers: { "data-store": 0.33, application: 0.31, "data-model": 0.13 },
    tolerance: 0.1,
    measured: "Clef on Workers AI, 2026-11-14",
  },
});

/** Input tokens the probe's two stages take (11,238 measured on Clef, 2026-11-14), with some room. */
export const PROBE_INPUT_TOKENS = 12_000;

/** What the probe is expected to cost on a model: refused when the month has less left than this. */
export function probeCostEstimate(model: Pick<DecisionModel, "pricing">): number {
  return (PROBE_INPUT_TOKENS * model.pricing.inputPerM) / 1e6;
}

export interface ProbeResult {
  ok: boolean;
  provider: string;
  /** The configured model's provider id. */
  model: string;
  /** The model the response named, when it named one. */
  servedModel?: string;
  /** The upstream that served (OpenRouter). */
  upstream?: string;
  latencyMs: number;
  layer?: { top: string | null; p: number | null; probabilities: Record<string, number> };
  type?: { top: string | null; p: number | null };
  inputTokens: number;
  costUsd: number;
  /** Problems found: a failure, another model answering, answers off the expectation. */
  flags: string[];
  error?: { kind: string; message: string };
}

export interface ProbeOptions {
  qset?: string;
  /** Pin the probe to one upstream (OpenRouter). */
  upstream?: string;
  /** Default 30 s for both stages. */
  timeoutMs?: number;
  expected?: Readonly<Record<string, ProbeExpectation>>;
}

/** Whether a model name in a response is the configured model. */
function sameModel(served: string, model: DecisionModel): boolean {
  const s = served.toLowerCase();
  const { model: id, canonicalModel } = model.id;
  return s === id.toLowerCase() || s === canonicalModel || s.endsWith(`/${canonicalModel}`);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Send the probe card through a model. Never throws: a failure is a flagged result. */
export async function probeTier1(model: DecisionModel, spec: SpecCriteria, options: ProbeOptions = {}): Promise<ProbeResult> {
  const qset = options.qset ?? CURRENT_QSET_ID;
  const t0 = Date.now();
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const base = { provider: model.id.provider, model: model.id.model };
  try {
    const ask = await askCard(model, spec, { qset, card: PROBE_CARD }, { signal, ...(options.upstream ? { upstream: options.upstream } : {}) });
    const latencyMs = Date.now() - t0;
    const flags: string[] = [];
    const layerAnswer = ask.stage1.result.answers.layer;
    const top = ask.layer;
    const probabilities = layerAnswer?.type === "choice" ? Object.fromEntries(Object.entries(layerAnswer.probabilities).map(([k, v]) => [k, round3(v)])) : {};
    const p = top !== null && typeof probabilities[top] === "number" ? probabilities[top] : null;
    if (!top) flags.push("the layer question came back without a usable answer");
    const typeAnswer = ask.stage2?.result.answers.element_type;
    const typeTop = chosenOf(typeAnswer);
    const typeP = typeTop && typeAnswer?.type === "choice" ? round3(typeAnswer.probabilities[typeTop] ?? NaN) : null;
    const served = ask.servedBy.model;
    if (served && !sameModel(served, model)) flags.push(`the response named model ${served}, not ${model.id.model}`);
    if (options.upstream && ask.servedBy.upstream && ask.servedBy.upstream !== options.upstream) {
      flags.push(`served by ${ask.servedBy.upstream}, not the pinned ${options.upstream}`);
    }
    const expected = (options.expected ?? PROBE_EXPECTED)[model.id.canonicalModel];
    if (expected && expected.qset === qset && top) {
      const off = Object.entries(expected.layers).filter(([layer, want]) => Math.abs((probabilities[layer] ?? 0) - want) > expected.tolerance);
      if (off.length) {
        const got = off.map(([layer, want]) => `${layer} ${(probabilities[layer] ?? 0).toFixed(2)} (expected ${want.toFixed(2)})`).join(", ");
        flags.push(`layer probabilities differ by more than ${expected.tolerance} from the expected answer (${expected.measured}): ${got}`);
      }
    }
    return {
      ok: flags.length === 0,
      ...base,
      ...(served ? { servedModel: served } : {}),
      ...(ask.servedBy.upstream ? { upstream: ask.servedBy.upstream } : {}),
      latencyMs,
      layer: { top, p, probabilities },
      ...(ask.stage2 ? { type: { top: typeTop, p: typeP !== null && Number.isFinite(typeP) ? typeP : null } } : {}),
      inputTokens: ask.usage.inputTokens,
      costUsd: Math.round(ask.usage.costUsd * 1e6) / 1e6,
      flags,
    };
  } catch (e) {
    const err = e instanceof DecisionModelError ? e : null;
    const kind = err?.kind ?? "error";
    const message = e instanceof Error ? e.message : String(e);
    // A stage answered before the failure is billed all the same: the caller records it.
    const billed = err?.billed ?? { inputTokens: 0, costUsd: 0 };
    return {
      ok: false,
      ...base,
      latencyMs: Date.now() - t0,
      inputTokens: billed.inputTokens,
      costUsd: Math.round(billed.costUsd * 1e6) / 1e6,
      flags: [`the probe failed (${kind}): ${message}`],
      error: { kind, message },
    };
  }
}
