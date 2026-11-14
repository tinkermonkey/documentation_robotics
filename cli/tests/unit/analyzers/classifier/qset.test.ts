/**
 * Question set dr-qset-1 against the harness it was ported from.
 *
 * tests/fixtures/classifier/dr-qset-1/ was captured from the classify-eval harness before the port
 * (see `note` in spec-snapshot.json): the exact request bodies `callClef` sent for 20 dr-cli cards
 * spanning Tier-0 narrowing, the kind rule and no rule, and the spec input it built criteria from.
 * The ported builders must produce the same bytes from the same input.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CloudflareWorkersAiModel } from "../../../../src/analyzers/classifier/decision-model/adapters/cloudflare-workers-ai.js";
import {
  CURRENT_QSET_ID,
  NONE_OPTION,
  qsetVariantId,
  specCriteriaFromLayers,
  v1,
  type LayerInfo,
  type Narrowing,
  type StateCard,
} from "../../../../src/analyzers/classifier/index.js";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");

interface FixtureCard {
  category: string;
  tier0_rule: string | null;
  narrow: Narrowing | null;
  card: StateCard & { id: string };
}
interface FixtureRequest {
  card_id: string;
  category: string;
  stage: 1 | 2;
  layer: string | null;
  criteria: "full" | "core";
  asked?: boolean;
  body: string;
}

const readJsonl = <T>(file: string): T[] =>
  readFileSync(path.join(FIXTURES, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, "spec-snapshot.json"), "utf8")) as { layers: LayerInfo[] };
const cards = new Map(readJsonl<FixtureCard>("cards.jsonl").map((c) => [c.card.id, c]));
const requests = readJsonl<FixtureRequest>("requests.jsonl");
const full = specCriteriaFromLayers(snapshot.layers, "full");
const core = specCriteriaFromLayers(snapshot.layers, "core");
const clef = new CloudflareWorkersAiModel({
  model: "clef",
  credentials: { accountId: "acct", apiToken: "tok" },
  fetch: () => Promise.reject(new Error("no network in tests")),
});

/** The request body the ported code builds for a fixture request. */
function bodyFor(r: FixtureRequest): string {
  const c = cards.get(r.card_id)!;
  const state = v1.stateOf(c.card);
  const narrow = c.narrow ?? undefined;
  const spec = r.criteria === "core" ? core : full;
  const questions = r.stage === 1 ? v1.stage1Questions(spec, narrow) : v1.stage2Questions(spec, r.layer!, c.card.label, true, narrow);
  return clef.requestBody(state, questions);
}

/**
 * The digest of the question builders' output for the fixture cards. Pinned per question set id:
 * an edit to `qset/` or `state.ts` that changes what is sent must also change QSET_ID (and this pin).
 */
const QSET_DIGESTS: Record<string, string> = {
  "dr-qset-1": "3cad0b4ae90b4e1402bd97b54aacd0b266f3113f5e193c6d4809fd6167af3e5e",
};

describe("dr-qset-1 request parity with the harness", () => {
  test("the fixture spans narrowed, kind-narrowed and no-rule cards", () => {
    const categories = new Set([...cards.values()].map((c) => c.category));
    expect(categories).toEqual(new Set(["tier0-narrowed", "tier0-narrowed-none", "kind-narrowed", "no-rule-other-layer", "no-rule-none"]));
    expect(cards.size).toBe(20);
    expect(requests.filter((r) => r.stage === 2).length).toBeGreaterThan(10);
  });

  for (const r of requests) {
    test(`${r.card_id} stage ${r.stage}${r.layer ? ` (${r.layer})` : ""}${r.criteria === "core" ? " core" : ""} is byte-identical`, () => {
      expect(bodyFor(r)).toBe(r.body);
    });
  }

  test("the question builders' digest is pinned to QSET_ID", () => {
    const hash = createHash("sha256");
    for (const r of requests) hash.update(bodyFor(r)).update("\n");
    expect(CURRENT_QSET_ID).toBe("dr-qset-1");
    expect(hash.digest("hex")).toBe(QSET_DIGESTS[CURRENT_QSET_ID]);
  });
});

describe("dr-qset-1 questions", () => {
  test("stage 1 asks layer, significance and six concerns, none last among the layers", () => {
    const q = v1.stage1Questions(full);
    expect(Object.keys(q)).toEqual([
      "layer",
      "significance",
      "concern_authentication",
      "concern_authorization",
      "concern_data_persistence",
      "concern_external_integration",
      "concern_observability",
      "concern_user_interface",
    ]);
    const layer = q.layer;
    expect(layer.type).toBe("choice");
    if (layer.type !== "choice") return;
    expect(Object.keys(layer.criteria)).toHaveLength(14);
    expect(Object.keys(layer.criteria).at(-1)).toBe(NONE_OPTION);
    expect(q.significance.type === "score" && q.significance.criteria.length).toBe(5);
  });

  test("Tier-0 narrowing restricts the layers and keeps none", () => {
    const q = v1.stage1Questions(full, [{ layer: "application", type: "dataobject" }, { layer: "data-model", type: null }]);
    const layer = q.layer;
    if (layer.type !== "choice") throw new Error("layer is a choice");
    expect(Object.keys(layer.criteria)).toEqual(["application", "data-model", NONE_OPTION]);
    expect(layer.instructions).toContain("Only the layers this kind of symbol can belong to are listed.");
  });

  test("stage 2: Tier-0 types win over the kind rule; a layer-wide narrowing falls back to the kind rule", () => {
    const narrowed = v1.stage2Questions(full, "application", "Class", true, [{ layer: "application", type: "dataobject" }]).element_type;
    if (narrowed.type !== "choice") throw new Error("element_type is a choice");
    expect(Object.keys(narrowed.criteria)).toEqual(["dataobject", NONE_OPTION]);
    expect(narrowed.instructions).toContain("Only the element types this symbol can be are listed.");

    const wide = v1.stage2Questions(full, "application", "Function", true, [{ layer: "application", type: null }]).element_type;
    if (wide.type !== "choice") throw new Error("element_type is a choice");
    expect(Object.keys(wide.criteria).sort()).toEqual([...v1.KIND_CANDIDATES.application.Function, NONE_OPTION].sort());
    expect(wide.instructions).toContain("The symbol is a Function;");
  });

  test("stage 2 outside the kind rule's layers offers every type of the layer and none", () => {
    const q = v1.stage2Questions(full, "data-model", "Class", true).element_type;
    if (q.type !== "choice") throw new Error("element_type is a choice");
    const layer = snapshot.layers.find((l) => l.id === "data-model")!;
    expect(Object.keys(q.criteria)).toEqual([...layer.types.map((t) => t.id), NONE_OPTION]);
  });

  test("stage 2 is asked only for a real layer with at least two options", () => {
    expect(v1.asksStage2(NONE_OPTION, v1.stage2Questions(full, "application"))).toBe(false);
    expect(v1.asksStage2("application", v1.stage2Questions(full, "application"))).toBe(true);
    expect(v1.asksStage2("no-such-layer", v1.stage2Questions(full, "no-such-layer"))).toBe(false);
  });

  test("the narrowing key is sorted and order-free", () => {
    expect(v1.narrowingKey([{ layer: "b", type: "x" }, { layer: "a", type: null }])).toEqual(["a.*", "b.x"]);
    expect(v1.narrowingKey([{ layer: "a", type: null }, { layer: "b", type: "x" }])).toEqual(["a.*", "b.x"]);
    expect(v1.narrowingKey(undefined)).toBeNull();
  });

  test("harness variants get their own ids", () => {
    expect(qsetVariantId()).toBe("dr-qset-1");
    expect(qsetVariantId({ criteria: "core" })).toBe("dr-qset-1+core");
    expect(qsetVariantId({ criteria: "core", facts: true, charter: "short" })).toBe("dr-qset-1+core+facts+charter-short");
  });
});
