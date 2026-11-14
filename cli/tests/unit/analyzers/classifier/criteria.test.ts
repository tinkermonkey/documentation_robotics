import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SpecDataLoader } from "../../../../src/core/spec-loader.js";
import {
  coreDescription,
  criteriaDigest,
  layerCriteria,
  loadSpecCriteria,
  NONE_OPTION,
  NONE_SCOPE,
  specCriteriaFromLayers,
  typeCriteria,
  type LayerInfo,
} from "../../../../src/analyzers/classifier/index.js";

const FIXTURES = path.join(import.meta.dir, "../../../fixtures/classifier/dr-qset-1");
const snapshot = JSON.parse(readFileSync(path.join(FIXTURES, "spec-snapshot.json"), "utf8")) as { specLayerFilesSha256: string; layers: LayerInfo[] };
const bundledDir = new SpecDataLoader().getBundledDir();
const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

function layerFilesHash(dir: string): string {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { layers: Array<{ id: string }> };
  const h = createHash("sha256");
  for (const l of manifest.layers) h.update(readFileSync(path.join(dir, `${l.id}.json`)));
  return h.digest("hex");
}

/** A copy of the bundled spec with one layer file edited. */
function editedSpec(layer: string, edit: (d: { layer: Record<string, unknown>; nodeSchemas: Record<string, Record<string, unknown>> }) => void): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dr-criteria-"));
  tmp.push(dir);
  cpSync(bundledDir, dir, { recursive: true });
  const f = path.join(dir, `${layer}.json`);
  const d = JSON.parse(readFileSync(f, "utf8"));
  edit(d);
  writeFileSync(f, JSON.stringify(d));
  return dir;
}

describe("criteria from the bundled spec", () => {
  test("reads the 13 layers in order, types sorted, with descriptions", async () => {
    const spec = await loadSpecCriteria();
    expect(spec.layers.map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (const l of spec.layers) {
      expect(l.scope.length).toBeGreaterThan(20);
      expect(l.types.map((t) => t.id)).toEqual([...l.types.map((t) => t.id)].sort((a, b) => a.localeCompare(b)));
      for (const t of l.types) expect(t.specNodeId).toBe(`${l.id}.${t.id}`);
    }
    expect(spec.specVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  // The harness read spec/dist; the CLI reads its bundled copy. While the bundled spec is the one the
  // fixture was captured from, the loaders must agree field for field.
  test.if(layerFilesHash(bundledDir) === snapshot.specLayerFilesSha256)("matches the harness's loader on the spec the fixture was captured from", async () => {
    const spec = await loadSpecCriteria();
    expect(JSON.parse(JSON.stringify(spec.layers))).toEqual(snapshot.layers);
  });

  test("refuses a placeholder layer description", async () => {
    const dir = editedSpec("application", (d) => {
      d.layer.description = "Layer 5: Application";
    });
    await expect(loadSpecCriteria({ bundledDir: dir })).rejects.toThrow(/application has no real description/);
  });

  test("refuses an empty layer description", async () => {
    const dir = editedSpec("api", (d) => {
      d.layer.description = "  ";
    });
    await expect(loadSpecCriteria({ bundledDir: dir })).rejects.toThrow(/api has no real description/);
  });
});

describe("criteria text", () => {
  const spec = specCriteriaFromLayers(snapshot.layers);

  test("layer criteria: name, standard, scope and up to eight example titles; none last", () => {
    const c = layerCriteria(spec);
    expect(Object.keys(c)).toEqual([...snapshot.layers.map((l) => l.id), NONE_OPTION]);
    expect(c[NONE_OPTION]).toBe(NONE_SCOPE);
    const app = snapshot.layers.find((l) => l.id === "application")!;
    expect(c.application.startsWith(`${app.name} (${app.standard}): ${app.scope} Example element types: `)).toBe(true);
    expect(c.application.endsWith(`${app.types.slice(0, 8).map((t) => t.title).join(", ")}.`)).toBe(true);
  });

  test("type criteria: title, description and evidence; none last; empty for an unknown layer", () => {
    const c = typeCriteria(spec, "application");
    expect(Object.keys(c).at(-1)).toBe(NONE_OPTION);
    expect(typeCriteria(spec, "no-such-layer")).toEqual({});
    const withEvidence = snapshot.layers.flatMap((l) => l.types.map((t) => ({ l, t }))).find(({ t }) => t.evidence.length);
    if (withEvidence) {
      expect(typeCriteria(spec, withEvidence.l.id)[withEvidence.t.id]).toContain(` Evidence: ${withEvidence.t.evidence.join("; ")}.`);
    }
  });

  test("core mode drops the 'Use X instead when' sentences", () => {
    const t = {
      id: "x",
      specNodeId: "l.x",
      title: "X",
      description: "An X does things. Use Y instead when it only stores data. It has evidence.",
      evidence: [],
      distinguish: { "l.y": "when it only stores data." },
    };
    expect(coreDescription(t)).toBe("An X does things. It has evidence.");
  });

  test("the digest changes when any text the model sees changes, and only then", () => {
    const base = criteriaDigest(spec);
    expect(criteriaDigest(specCriteriaFromLayers(snapshot.layers))).toBe(base);
    expect(criteriaDigest(specCriteriaFromLayers(snapshot.layers, "full", "9.9.9"))).toBe(base);
    const edited = structuredClone(snapshot.layers);
    edited[4].types[0].description += " Changed.";
    expect(criteriaDigest(specCriteriaFromLayers(edited))).not.toBe(base);
    const scope = structuredClone(snapshot.layers);
    scope[0].scope += " Changed.";
    expect(criteriaDigest(specCriteriaFromLayers(scope))).not.toBe(base);
    const hasDistinguish = snapshot.layers.some((l) => l.types.some((t) => Object.keys(t.distinguish).length && coreDescription(t) !== t.description));
    if (hasDistinguish) expect(criteriaDigest(specCriteriaFromLayers(snapshot.layers, "core"))).not.toBe(base);
  });
});
