/**
 * Unit tests for the MCP tools an agent reads a model with, as fixed for CLI 0.7.0:
 *
 * - model_stats and model_validate agree on validity over the same view, and name it (#1214)
 * - model_validate summarizes by default, lists warnings on request, and doesn't ask intent-layer
 *   elements for a source reference (#1215)
 * - spec_type queries the catalog across types and shows required enums in a layer listing (#1216)
 * - model_trace reports only the changeset edges it walked (#1203)
 * - model_trace counts what serves an element among its dependencies (#1204)
 * - model_list lists orphans only, by layer and type
 *
 * Each test builds its own project (the unit suite runs under `bun test --concurrent`).
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StatsCollector } from "../../../src/core/stats-collector.js";
import { loadModel } from "../../../src/mcp/tools/shared.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelListHandler } from "../../../src/mcp/tools/model-list.js";
import { modelStatsHandler } from "../../../src/mcp/tools/model-stats.js";
import {
  dependencyEnds,
  modelTraceHandler,
  PROVIDER_TO_CONSUMER_PREDICATES,
} from "../../../src/mcp/tools/model-trace.js";
import { modelValidateHandler, VALIDATE_ERROR_LIMIT, VALIDATE_LIST_LIMIT } from "../../../src/mcp/tools/model-validate.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { specTypeHandler } from "../../../src/mcp/tools/spec-type.js";
import { addModelWarnings } from "../../../src/validators/model-warnings.js";
import { ValidationResult } from "../../../src/validators/types.js";

function parse(result: any): any {
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

function text(result: any): string {
  return result.content[0].text;
}

async function withProject(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = join(tmpdir(), `dr-mcp-read-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "MCP Read Tools Test Model", version: "0.1.0" });
  try {
    await fn(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

const RECORDER = "application.applicationcomponent.recorder";
const ENCODER = "application.applicationcomponent.encoder";
const UI = "application.applicationcomponent.ui";
const PLAYER = "application.applicationcomponent.player";
const ELECTRON = "technology.systemsoftware.electron";
const FFMPEG = "technology.systemsoftware.ffmpeg";
const HOST = "technology.device.host";
const GOAL = "motivation.goal.record-a-session";
const REQUIREMENT = "motivation.requirement.record-in-one-click";

/**
 * A recorder component that uses an encoder, with the technology that serves each, a UI that uses
 * the recorder, and a player the same runtime also serves. All relationships are in the base model.
 */
async function recorderModel(rootPath: string): Promise<void> {
  const component = (name: string) => ({
    layer: "application",
    type: "applicationcomponent",
    name,
    attributes: { type: "internal" },
    sourceFile: `src/${name}.ts`,
  });
  const software = (name: string) => ({
    layer: "technology",
    type: "systemsoftware",
    name,
    attributes: { softwareType: "middleware" },
    sourceFile: "package.json",
  });
  const added = parse(
    await modelAddHandler({
      elements: [
        component("recorder"),
        component("encoder"),
        component("ui"),
        component("player"),
        software("electron"),
        software("ffmpeg"),
        { layer: "technology", type: "device", name: "host", attributes: { deviceType: "workstation" }, sourceFile: "README.md" },
      ],
      relationships: [
        { source: RECORDER, predicate: "uses", target: ENCODER },
        { source: UI, predicate: "uses", target: RECORDER },
        { source: ELECTRON, predicate: "serves", target: RECORDER },
        { source: ELECTRON, predicate: "serves", target: PLAYER },
        { source: HOST, predicate: "serves", target: RECORDER },
        { source: FFMPEG, predicate: "serves", target: ENCODER },
      ],
      rootPath,
    })
  );
  expect(added.elements.results.every((r: any) => r.status === "added")).toBe(true);
  expect(added.relationships.results.every((r: any) => r.status === "added")).toBe(true);
}

describe("model_trace: which end depends on the other (#1204)", () => {
  it("counts what serves an element among its dependencies, at every depth", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const trace = parse(await modelTraceHandler({ id: RECORDER, direction: "down", rootPath }));
      // The encoder it uses, and the runtime and device that serve it.
      expect(trace.dependencies.direct.sort()).toEqual([ENCODER, ELECTRON, HOST].sort());
      // What serves the encoder. Not the player, which the same runtime also serves, nor the UI.
      expect(trace.dependencies.transitive).toEqual([FFMPEG]);

      const oneHop = parse(await modelTraceHandler({ id: RECORDER, direction: "down", depth: 1, rootPath }));
      expect(oneHop.dependencies.transitive).toEqual([]);
    });
  });

  it("counts what an element serves among its dependents, not its dependencies", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const trace = parse(await modelTraceHandler({ id: ELECTRON, rootPath }));
      expect(trace.dependents.direct.sort()).toEqual([PLAYER, RECORDER].sort());
      expect(trace.dependents.transitive).toEqual([UI]);
      expect(trace.dependencies).toEqual({ direct: [], transitive: [] });
    });
  });

  it("leaves the other predicates running from the dependent to what it depends on", async () => {
    expect([...PROVIDER_TO_CONSUMER_PREDICATES]).toEqual(["serves"]);
    expect(dependencyEnds({ source: "a", predicate: "serves", target: "b" })).toEqual({ dependent: "b", dependency: "a" });
    for (const predicate of ["uses", "depends-on", "accesses", "realizes", "composes", "satisfies", "governs", "triggers"]) {
      expect(dependencyEnds({ source: "a", predicate, target: "b" })).toEqual({ dependent: "a", dependency: "b" });
    }
  });

  it("does not list the traced element in its own trace when relationships form a cycle", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      parse(await relationshipAddHandler({ source: ENCODER, predicate: "uses", target: RECORDER, rootPath }));
      const trace = parse(await modelTraceHandler({ id: RECORDER, direction: "down", rootPath }));
      expect([...trace.dependencies.direct, ...trace.dependencies.transitive]).not.toContain(RECORDER);
      expect(trace.dependencies.direct).toContain(ENCODER);
    });
  });
});

describe("model_trace: changedEdges over a changeset (#1203)", () => {
  it("lists the staged edges the trace walked, not every staged edge that touches what it reached", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      await changesetCreateHandler({ name: "add-muxer", description: "Mux audio", rootPath });
      parse(
        await modelAddHandler({
          elements: [
            { layer: "application", type: "applicationcomponent", name: "muxer", attributes: { type: "internal" } },
            { layer: "application", type: "applicationcomponent", name: "exporter", attributes: { type: "internal" } },
          ],
          relationships: [
            // On the way down from the recorder.
            { source: ENCODER, predicate: "uses", target: "application.applicationcomponent.muxer" },
            // Touch elements the trace reaches, but lead away from it: other things that use them.
            { source: "application.applicationcomponent.exporter", predicate: "uses", target: ENCODER },
            { source: "application.applicationcomponent.exporter", predicate: "uses", target: "application.applicationcomponent.muxer" },
            { source: ELECTRON, predicate: "serves", target: "application.applicationcomponent.exporter" },
          ],
          rootPath,
        })
      );

      const trace = parse(await modelTraceHandler({ id: RECORDER, direction: "down", rootPath }));
      expect(trace.dependencies.transitive.sort()).toEqual(["application.applicationcomponent.muxer", FFMPEG].sort());
      expect(trace.changedEdges).toEqual([
        { source: ENCODER, predicate: "uses", target: "application.applicationcomponent.muxer", status: "added" },
      ]);
      expect(trace.changedElements).toEqual({ "application.applicationcomponent.muxer": "added" });

      // Upward from the encoder the exporter's edge is on the way; the muxer's is not.
      const up = parse(await modelTraceHandler({ id: ENCODER, direction: "up", rootPath }));
      expect(up.changedEdges).toEqual([
        { source: "application.applicationcomponent.exporter", predicate: "uses", target: ENCODER, status: "added" },
      ]);
    });
  });

  it("lists a removed edge where the trace would have walked it, and only there", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      await changesetCreateHandler({ name: "drop-ffmpeg", description: "Encode in process", rootPath });
      parse(await relationshipDeleteHandler({ source: FFMPEG, target: ENCODER, rootPath }));
      parse(await relationshipDeleteHandler({ source: ELECTRON, target: PLAYER, rootPath }));

      const trace = parse(await modelTraceHandler({ id: RECORDER, direction: "down", rootPath }));
      expect(trace.dependencies.transitive).toEqual([]);
      // ffmpeg no longer serves the encoder: the recorder lost a dependency. That the runtime no
      // longer serves the player says nothing about what the recorder depends on.
      expect(trace.changedEdges).toEqual([{ source: FFMPEG, predicate: "serves", target: ENCODER, status: "deleted" }]);
    });
  });
});

describe("model_stats and model_validate over the same view (#1214)", () => {
  it("agree that a changeset's relationships between its own new elements are valid", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      await changesetCreateHandler({ name: "add-uploader", description: "Upload recordings", rootPath });
      parse(
        await modelAddHandler({
          elements: [
            { layer: "application", type: "applicationcomponent", name: "uploader", attributes: { type: "internal" } },
            { layer: "application", type: "applicationcomponent", name: "queue", attributes: { type: "internal" } },
            { layer: "technology", type: "systemsoftware", name: "s3-client", attributes: { softwareType: "middleware" } },
          ],
          relationships: [
            { source: "application.applicationcomponent.uploader", predicate: "uses", target: "application.applicationcomponent.queue" },
            { source: "technology.systemsoftware.s3-client", predicate: "serves", target: "application.applicationcomponent.uploader" },
            { source: "application.applicationcomponent.uploader", predicate: "uses", target: RECORDER },
          ],
          rootPath,
        })
      );

      const validated = parse(await modelValidateHandler({ rootPath }));
      const stats = parse(await modelStatsHandler({ rootPath }));
      expect(validated.valid).toBe(true);
      expect(validated.summary.errorCount).toBe(0);
      expect(stats.validation).toMatchObject({
        isValid: true,
        errors: validated.summary.errorCount,
        warnings: validated.summary.warningCount,
      });
      expect(stats.validation.lastValidated).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Both say which model they looked at: the changeset's projection.
      const view = { model: "changeset", changeset: { name: "add-uploader" } };
      expect(validated.view).toMatchObject(view);
      expect(stats.view).toMatchObject(view);
      expect(stats.view.changeset.id).toBe(validated.view.changeset.id);
      expect(stats.statistics.totalElements).toBe(10);
      expect(stats.statistics.totalRelationships).toBe(9);
    });
  });

  it("say base when no changeset is active", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      expect(parse(await modelValidateHandler({ rootPath })).view).toEqual({ model: "base" });
      expect(parse(await modelStatsHandler({ rootPath })).view).toEqual({ model: "base" });
    });
  });

  it("StatsCollector validates the changeset's projection too, as dr stats reads it", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      await changesetCreateHandler({ name: "add-uploader", description: "Upload recordings", rootPath });
      parse(
        await modelAddHandler({
          elements: [
            { layer: "application", type: "applicationcomponent", name: "uploader", attributes: { type: "internal" } },
            { layer: "application", type: "applicationcomponent", name: "queue", attributes: { type: "internal" } },
          ],
          relationships: [
            { source: "application.applicationcomponent.uploader", predicate: "uses", target: "application.applicationcomponent.queue" },
          ],
          rootPath,
        })
      );
      const stats = await new StatsCollector(await loadModel(rootPath)).collect();
      expect(stats.validation).toMatchObject({ isValid: true, errors: 0 });
    });
  });

  it("model_stats counts orphans by layer and type instead of listing their ids", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      parse(
        await modelAddHandler({
          elements: [
            { layer: "application", type: "applicationcomponent", name: "lonely", attributes: { type: "internal" } },
            { layer: "application", type: "applicationfunction", name: "idle" },
            { layer: "motivation", type: "goal", name: "record-a-session", attributes: { priority: "high" } },
          ],
          rootPath,
        })
      );
      const stats = parse(await modelStatsHandler({ rootPath }));
      expect(stats.orphanedElements).toBeUndefined();
      expect(stats.orphans.count).toBe(3);
      expect(stats.orphans.byLayer).toEqual([
        { layer: "motivation", count: 1, types: { goal: 1 } },
        { layer: "application", count: 2, types: { applicationcomponent: 1, applicationfunction: 1 } },
      ]);
      expect(stats.orphans.more).toContain("orphans: true");
    });
  });
});

describe("model_validate: summary by default (#1215)", () => {
  /**
   * The recorder model plus four intent-layer elements with no source reference (one of them, the
   * goal, an orphan) and a component with no source reference.
   */
  async function mixedModel(rootPath: string): Promise<void> {
    await recorderModel(rootPath);
    const added = parse(
      await modelAddHandler({
        elements: [
          { layer: "motivation", type: "goal", name: "record-a-session", attributes: { priority: "high" } },
          {
            layer: "motivation",
            type: "requirement",
            name: "record-in-one-click",
            attributes: { requirementType: "functional", priority: "high" },
          },
          { layer: "business", type: "businessservice", name: "recording" },
          { layer: "product", type: "feature", name: "one-click-record", attributes: { priority: "high", status: "planned" } },
          { layer: "application", type: "applicationcomponent", name: "unsourced", attributes: { type: "internal" } },
        ],
        relationships: [
          { source: "application.applicationcomponent.unsourced", predicate: "uses", target: RECORDER },
          { source: "product.feature.one-click-record", predicate: "satisfies", target: REQUIREMENT },
          { source: "business.businessservice.recording", predicate: "satisfies", target: REQUIREMENT },
        ],
        rootPath,
      })
    );
    expect(added.relationships.results.every((r: any) => r.status === "added")).toBe(true);
  }

  it("does not ask motivation, business or product elements for a source reference", async () => {
    await withProject(async (rootPath) => {
      await mixedModel(rootPath);
      const data = parse(await modelValidateHandler({ warnings: ["all"], rootPath }));
      const sourceReference = data.warnings.find((w: any) => w.kind === "no-source-reference");
      // The one implementation element without one, and none of the four intent-layer elements.
      expect(sourceReference).toMatchObject({
        count: 1,
        means: "has no source reference",
        elements: ["application.applicationcomponent.unsourced"],
      });
      expect(sourceReference.fix).toContain("source_reference");
      expect(data.warnings.find((w: any) => w.kind === "no-document-reference").count).toBe(0);
      expect(data.summary.warningCount).toBe(2);
      expect(data.valid).toBe(true);
    });
  });

  it("asks them for a document reference under strict, and says so in those words", async () => {
    await withProject(async (rootPath) => {
      await mixedModel(rootPath);
      const data = parse(await modelValidateHandler({ strict: true, warnings: ["no-document-reference", "no-description"], rootPath }));
      const [documents, descriptions] = data.warnings;
      expect(documents).toMatchObject({ kind: "no-document-reference", count: 4, means: "has no document reference" });
      expect(documents.elements.sort()).toEqual([
        "business.businessservice.recording",
        GOAL,
        REQUIREMENT,
        "product.feature.one-click-record",
      ]);
      expect(documents.fix).toContain("no implementation to point at");
      expect(descriptions.kind).toBe("no-description");
      expect(descriptions.count).toBeGreaterThan(0);
      // Strict: a warning makes the model invalid.
      expect(data.valid).toBe(false);
    });
  });

  it("returns counts by kind, layer and type, and no warning list", async () => {
    await withProject(async (rootPath) => {
      await mixedModel(rootPath);
      const result = await modelValidateHandler({ rootPath });
      const data = parse(result);
      expect(data.valid).toBe(true);
      expect(data.errors).toEqual([]);
      expect(data.warnings).toBeUndefined();
      expect(data.orphanedElements).toBeUndefined();
      expect(data.summary).toMatchObject({ totalElements: 12, errorCount: 0, warningCount: 2, orphanedCount: 1 });
      expect(data.warningCounts).toEqual([
        { kind: "orphan", count: 1, byLayer: [{ layer: "motivation", count: 1, types: { goal: 1 } }] },
        {
          kind: "no-source-reference",
          count: 1,
          byLayer: [{ layer: "application", count: 1, types: { applicationcomponent: 1 } }],
        },
      ]);
      expect(data.more).toContain("warnings:");
      expect(data.more).toContain("orphans: true");
      expect(text(result).length).toBeLessThan(1_200);
    });
  });

  it("stays the same size however many warnings there are, and lists a kind on request", async () => {
    await withProject(async (rootPath) => {
      const count = VALIDATE_LIST_LIMIT + 10;
      parse(
        await modelAddHandler({
          elements: Array.from({ length: count }, (_, i) => ({
            layer: "application",
            type: i % 4 ? "applicationfunction" : "applicationcomponent",
            name: `Unit ${i}`,
            ...(i % 4 ? {} : { attributes: { type: "internal" } }),
          })),
          rootPath,
        })
      );

      // The default: two kinds counted, nothing listed.
      const summary = await modelValidateHandler({ rootPath });
      expect(parse(summary).summary.warningCount).toBe(count * 2);
      expect(text(summary).length).toBeLessThan(1_200);

      // A kind with more than the limit is counted, with the way to list it.
      const orphan = parse(await modelValidateHandler({ warnings: ["orphan"], rootPath })).warnings[0];
      expect(orphan.count).toBe(count);
      expect(orphan.elements).toBeUndefined();
      expect(orphan.byLayer).toEqual([
        { layer: "application", count, types: { applicationfunction: 120, applicationcomponent: 40 } },
      ]);
      expect(orphan.more).toContain('detail: "full"');

      // detail: "full" with a kind lists every match.
      const listed = parse(await modelValidateHandler({ warnings: ["orphan"], detail: "full", rootPath })).warnings[0];
      expect(listed.elements).toHaveLength(count);

      // detail: "full" alone is the whole report: every warning as an issue.
      const full = parse(await modelValidateHandler({ detail: "full", rootPath }));
      expect(full.warnings).toHaveLength(count * 2);
      expect(full.warnings[0]).toMatchObject({ severity: "warning", category: "orphan" });
      expect(full.orphanedElements).toHaveLength(count);
    });
  });

  it("returns the errors whole", async () => {
    await withProject(async (rootPath) => {
      await mixedModel(rootPath);
      const model = await loadModel(rootPath);
      model.relationships.add({
        source: RECORDER,
        target: "application.applicationcomponent.missing",
        predicate: "uses",
        layer: "application",
        category: "structural",
      });
      const data = parse(await modelValidateHandler({ rootPath }));
      expect(data.valid).toBe(false);
      expect(data.summary.errorCount).toBe(data.errors.length);
      expect(data.errors.length).toBeGreaterThan(0);
      expect(data.errors[0]).toMatchObject({ severity: "error" });
      expect(data.errors.map((e: any) => e.message).join("\n")).toContain("application.applicationcomponent.missing");
      expect(data.errorsOmitted).toBeUndefined();
    });
  });

  it("returns the first errors whole and counts the rest by layer and type when there are very many", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const model = await loadModel(rootPath);
      for (let i = 0; i < VALIDATE_ERROR_LIMIT + 5; i++) {
        model.relationships.add({
          source: RECORDER,
          target: `application.applicationcomponent.missing-${i}`,
          predicate: "uses",
          layer: "application",
          category: "structural",
        });
      }
      const data = parse(await modelValidateHandler({ rootPath }));
      expect(data.valid).toBe(false);
      expect(data.errors).toHaveLength(VALIDATE_ERROR_LIMIT);
      expect(data.errorsOmitted).toBe(data.summary.errorCount - VALIDATE_ERROR_LIMIT);
      expect(data.errorsOmitted).toBeGreaterThanOrEqual(5);
      expect(data.errorsByLayer.reduce((sum: number, l: any) => sum + l.count, 0)).toBe(data.summary.errorCount);

      const full = parse(await modelValidateHandler({ detail: "full", rootPath }));
      expect(full.errors).toHaveLength(data.summary.errorCount);
    });
  });

  it("refuses a warning kind it does not have, naming the kinds", async () => {
    await withProject(async (rootPath) => {
      const result = await modelValidateHandler({ warnings: ["orphans"], rootPath });
      expect(result.isError).toBe(true);
      const body = JSON.parse(text(result));
      expect(body.error).toContain("Unknown warning kind(s): orphans");
      expect(body.suggestions.join(" ")).toContain('"orphan"');
      expect(body.suggestions.join(" ")).toContain("no-source-reference");
    });
  });

  it("orphans: true counts orphans by layer and type and lists them, within the layers asked for", async () => {
    await withProject(async (rootPath) => {
      await mixedModel(rootPath);
      parse(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "idle", rootPath }));
      const all = parse(await modelValidateHandler({ orphans: true, rootPath }));
      expect(all).toMatchObject({
        view: { model: "base" },
        orphanCount: 2,
        byLayer: [
          { layer: "motivation", count: 1, types: { goal: 1 } },
          { layer: "application", count: 1, types: { applicationfunction: 1 } },
        ],
        orphanedElements: [GOAL, "application.applicationfunction.idle"],
      });
      const scoped = parse(await modelValidateHandler({ orphans: true, layers: ["application"], rootPath }));
      expect(scoped.orphanedElements).toEqual(["application.applicationfunction.idle"]);
      expect(scoped.layers).toEqual(["application"]);
    });
  });

  it("orphans: true counts without listing when there are more than the limit, and says how to list", async () => {
    await withProject(async (rootPath) => {
      const count = VALIDATE_LIST_LIMIT + 1;
      parse(
        await modelAddHandler({
          elements: Array.from({ length: count }, (_, i) => ({ layer: "application", type: "applicationfunction", name: `Unit ${i}` })),
          rootPath,
        })
      );
      const counted = parse(await modelValidateHandler({ orphans: true, rootPath }));
      expect(counted.orphanCount).toBe(count);
      expect(counted.orphanedElements).toBeUndefined();
      expect(counted.more).toContain("model_list");
      expect(parse(await modelValidateHandler({ orphans: true, detail: "full", rootPath })).orphanedElements).toHaveLength(count);
    });
  });
});

describe("addModelWarnings", () => {
  it("still warns about every element with no source reference when intent layers are not exempt, as dr validate does", async () => {
    await withProject(async (rootPath) => {
      parse(await modelAddHandler({ layer: "motivation", type: "goal", name: "record-a-session", attributes: { priority: "high" }, rootPath }));
      parse(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "idle", rootPath }));
      const model = await loadModel(rootPath);

      const asValidate = new ValidationResult();
      addModelWarnings(asValidate, model);
      expect(asValidate.warnings.filter((w) => w.category === "no-source-reference").map((w) => w.elementId).sort()).toEqual([
        "application.applicationfunction.idle",
        GOAL,
      ]);
      expect(asValidate.warnings.map((w) => w.message)).toContain(`Element '${GOAL}' has no source reference`);

      const exempt = new ValidationResult();
      addModelWarnings(exempt, model, { exemptIntentLayers: true });
      expect(exempt.warnings.filter((w) => w.category === "no-source-reference").map((w) => w.elementId)).toEqual([
        "application.applicationfunction.idle",
      ]);
    });
  });
});

describe("model_list: orphans only", () => {
  it("lists the elements with no relationship, by layer and type, and nothing else", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      parse(
        await modelAddHandler({
          elements: [
            { layer: "application", type: "applicationcomponent", name: "lonely", description: "Talks to nothing.", attributes: { type: "internal" } },
            { layer: "application", type: "applicationfunction", name: "idle" },
            { layer: "motivation", type: "goal", name: "record-a-session", attributes: { priority: "high" } },
          ],
          rootPath,
        })
      );

      const all = parse(await modelListHandler({ orphans: true, rootPath }));
      expect(all).toMatchObject({ detail: "compact", orphans: true, totalElements: 3 });
      expect(all.layers.map((l: any) => [l.layer, l.elements.map((e: any) => e.id)])).toEqual([
        [GOAL.split(".")[0], [GOAL]],
        ["application", ["application.applicationcomponent.lonely", "application.applicationfunction.idle"]],
      ]);
      expect(all.layers[1].elements[0].description).toBe("Talks to nothing.");

      const byType = parse(await modelListHandler({ orphans: true, layer: "application", type: "applicationfunction", rootPath }));
      expect(byType.elements.map((e: any) => e.id)).toEqual(["application.applicationfunction.idle"]);

      const counts = parse(await modelListHandler({ orphans: true, detail: "summary", rootPath }));
      expect(counts.layers).toEqual([
        { layer: "motivation", count: 1, types: { goal: 1 } },
        { layer: "application", count: 2, types: { applicationcomponent: 1, applicationfunction: 1 } },
      ]);
      expect(counts.more).toContain("orphaned element counts");

      // Without the filter the listing is every element, as before.
      expect(parse(await modelListHandler({ rootPath })).totalElements).toBe(10);
    });
  });

  it("reads orphans as the active changeset leaves them", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      parse(await modelAddHandler({ layer: "application", type: "applicationfunction", name: "idle", rootPath }));
      await changesetCreateHandler({ name: "wire-idle", description: "Use the idle function", rootPath });
      parse(
        await modelAddHandler({
          elements: [{ layer: "application", type: "applicationfunction", name: "planned" }],
          relationships: [{ source: RECORDER, predicate: "assigned-to", target: "application.applicationfunction.idle" }],
          rootPath,
        })
      );
      const listed = parse(await modelListHandler({ orphans: true, rootPath }));
      // The plan wires the idle function and adds one that nothing is wired to yet.
      expect(listed.layers.flatMap((l: any) => l.elements.map((e: any) => e.id))).toEqual(["application.applicationfunction.planned"]);
    });
  });
});

describe("spec_type: the catalog across types (#1216)", () => {
  it("lists the relationships the catalog allows from a layer to other layers in one call", async () => {
    const result = await specTypeHandler({ layer: "application", otherLayers: ["product", "motivation"], direction: "out" });
    const data = parse(result);
    expect(data.query).toEqual({ otherLayers: ["product", "motivation"], direction: "out" });
    expect(data.relationships).toContainEqual({
      source: "application.applicationservice",
      predicate: "realizes",
      targets: ["motivation.goal", "product.feature", "product.softwarecapability"],
    });
    // Only application sources, only product and motivation targets.
    for (const group of data.relationships) {
      expect(group.source.startsWith("application.")).toBe(true);
      for (const target of group.targets) expect(target).toMatch(/^(product|motivation)\./);
    }
    expect(data.count).toBe(data.relationships.reduce((sum: number, g: any) => sum + g.targets.length, 0));
    expect(text(result).length).toBeLessThan(2_000);
  });

  it("answers for several types at once, in both directions, and by the other end's type", async () => {
    const both = parse(await specTypeHandler({ layer: "application", types: ["applicationcomponent"], otherLayer: "technology" }));
    expect(both.query).toEqual({ types: ["application.applicationcomponent"], otherLayers: ["technology"], direction: "both" });
    expect(both.relationships).toContainEqual({
      source: "technology.systemsoftware",
      predicate: "serves",
      targets: ["application.applicationcomponent"],
    });

    const several = parse(
      await specTypeHandler({ layer: "technology", types: ["systemsoftware", "device"], otherLayer: "application", predicate: "serves" })
    );
    expect(several.relationships.map((g: any) => g.source)).toEqual(["technology.device", "technology.systemsoftware"]);

    const byOtherType = parse(await specTypeHandler({ layer: "application", otherType: "product.feature", direction: "out" }));
    expect(byOtherType.relationships).toEqual([
      { source: "application.applicationservice", predicate: "realizes", targets: ["product.feature"] },
    ]);
    // A bare type name is matched in whichever layer has it.
    expect(parse(await specTypeHandler({ layer: "application", otherType: "feature", direction: "out" })).relationships).toEqual(
      byOtherType.relationships
    );
  });

  it("answers by predicate within a layer", async () => {
    const data = parse(await specTypeHandler({ layer: "security", predicate: "mitigates" }));
    expect(data.count).toBeGreaterThan(0);
    expect(data.relationships.every((g: any) => g.predicate === "mitigates")).toBe(true);
    expect(data.relationships).toContainEqual(
      expect.objectContaining({ source: "security.countermeasure", targets: expect.arrayContaining(["security.threat"]) })
    );
  });

  it("says so when the catalog allows nothing that matches", async () => {
    const data = parse(await specTypeHandler({ layer: "technology", types: ["device"], otherLayer: "motivation", predicate: "serves" }));
    expect(data.count).toBe(0);
    expect(data.relationships).toEqual([]);
    expect(data.more).toContain("Nothing in the catalog matches");
  });

  it("refuses a layer or type it does not know, with the close matches", async () => {
    const badLayer = await specTypeHandler({ layer: "application", otherLayers: ["prodct"] });
    expect(badLayer.isError).toBe(true);
    expect(text(badLayer)).toContain("product");

    const badType = await specTypeHandler({ layer: "application", types: ["applicationcomponnt"] });
    expect(badType.isError).toBe(true);
    expect(text(badType)).toContain("applicationcomponent");

    const badOther = await specTypeHandler({ layer: "application", otherType: "feture" });
    expect(badOther.isError).toBe(true);
    expect(text(badOther)).toContain("layer.type");

    const both = await specTypeHandler({ layer: "application", type: "applicationservice", types: ["applicationcomponent"] });
    expect(both.isError).toBe(true);
  });

  it("applies otherLayers and otherType to one type's relationships too", async () => {
    const data = parse(
      await specTypeHandler({ layer: "application", type: "applicationservice", predicate: "realizes", otherLayers: ["motivation", "product"] })
    );
    expect(data.outgoing.map((r: any) => r.target).sort()).toEqual([
      "motivation.goal",
      "product.feature",
      "product.softwarecapability",
    ]);
    const one = parse(await specTypeHandler({ layer: "application", type: "applicationservice", otherType: "product.feature" }));
    expect(one.outgoing).toEqual([{ predicate: "realizes", target: "product.feature" }]);
  });

  it("shows the enum values of required attributes in the layer listing", async () => {
    const data = parse(await specTypeHandler({ layer: "motivation" }));
    const goal = data.types.find((t: any) => t.type === "goal");
    expect(goal.requiredAttributes).toEqual(["priority"]);
    expect(goal.requiredEnums).toEqual({ priority: ["critical", "high", "medium", "low", "informational"] });
    const requirement = data.types.find((t: any) => t.type === "requirement");
    expect(Object.keys(requirement.requiredEnums).sort()).toEqual(["priority", "requirementType"]);
    // A type with no required enum has no requiredEnums.
    const api = parse(await specTypeHandler({ layer: "api" }));
    expect(api.types.find((t: any) => t.type === "operation").requiredEnums).toBeUndefined();
    expect(data.more).toContain("requiredEnums");
  });
});
