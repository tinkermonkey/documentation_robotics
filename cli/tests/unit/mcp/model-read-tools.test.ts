/**
 * Unit tests for the MCP tools an agent reads a model with, as fixed for CLI 0.7.0:
 *
 * - model_stats and model_validate agree on validity over the same view, and name it (#1214)
 * - model_validate summarizes by default, lists warnings on request, and doesn't ask intent-layer
 *   elements for a source reference (#1215)
 * - spec_type queries the catalog across types and shows required enums in a layer listing (#1216)
 * - model_trace reports only the changeset edges it walked (#1203)
 * - model_trace counts what serves or realizes an element among its dependencies (#1204), by one
 *   rule that `dr trace` reads too
 * - model_list lists orphans only, by layer and type
 *
 * Each test builds its own project (the unit suite runs under `bun test --concurrent`).
 */

import { describe, it, expect, spyOn } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DependencyTracker, TraceDirection } from "../../../src/core/dependency-tracker.js";
import {
  buildDependencyGraph,
  dependencyEnds,
  SOURCE_IS_DEPENDENCY_PREDICATES,
} from "../../../src/core/dependency-direction.js";
import { Model } from "../../../src/core/model.js";
import { StatsCollector } from "../../../src/core/stats-collector.js";
import { loadModel } from "../../../src/mcp/tools/shared.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { LIST_FULL_LIMIT, modelListHandler } from "../../../src/mcp/tools/model-list.js";
import { modelStatsHandler } from "../../../src/mcp/tools/model-stats.js";
import { DependencyGraph, modelTraceHandler, TRACE_LIST_LIMIT } from "../../../src/mcp/tools/model-trace.js";
import { modelValidateHandler, VALIDATE_ERROR_LIMIT, VALIDATE_LIST_LIMIT } from "../../../src/mcp/tools/model-validate.js";
import { relationshipAddHandler, relationshipDeleteHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { specTypeHandler } from "../../../src/mcp/tools/spec-type.js";
import { addModelWarnings } from "../../../src/validators/model-warnings.js";
import { ValidationResult } from "../../../src/validators/types.js";
import { Validator } from "../../../src/validators/validator.js";

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

  it("counts what realizes an element among its dependencies: the artifact that realizes a component", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const ARTIFACT = "technology.artifact.recorder-bundle";
      const SERVICE = "application.applicationservice.recording";
      const added = parse(
        await modelAddHandler({
          elements: [
            { layer: "technology", type: "artifact", name: "recorder-bundle", attributes: { artifactType: "archive" } },
            { layer: "application", type: "applicationservice", name: "recording", attributes: { serviceType: "synchronous" } },
            { layer: "motivation", type: "goal", name: "record-a-session", attributes: { priority: "high" } },
          ],
          relationships: [
            { source: ARTIFACT, predicate: "realizes", target: RECORDER },
            { source: RECORDER, predicate: "realizes", target: SERVICE },
            { source: SERVICE, predicate: "realizes", target: GOAL },
          ],
          rootPath,
        })
      );
      expect(added.relationships.results.every((r: any) => r.status === "added")).toBe(true);

      // Down from the component: what it uses, what serves it, and the artifact that realizes it.
      // Not the service it realizes, nor the goal behind that.
      const down = parse(await modelTraceHandler({ id: RECORDER, direction: "down", rootPath }));
      expect(down.dependencies.direct.sort()).toEqual([ENCODER, ARTIFACT, ELECTRON, HOST].sort());
      expect(down.dependencies.transitive).toEqual([FFMPEG]);

      // Up from the component: what uses it, and what it realizes, through to the goal.
      const up = parse(await modelTraceHandler({ id: RECORDER, direction: "up", rootPath }));
      expect(up.dependents.direct.sort()).toEqual([SERVICE, UI].sort());
      expect(up.dependents.transitive).toEqual([GOAL]);

      // Down from the goal reaches everything that implements it; nothing depends on the artifact but that chain.
      const goal = parse(await modelTraceHandler({ id: GOAL, rootPath }));
      expect(goal.dependents).toEqual({ direct: [], transitive: [] });
      expect(goal.dependencies.direct).toEqual([SERVICE]);
      expect(goal.dependencies.transitive).toEqual(expect.arrayContaining([RECORDER, ARTIFACT, ELECTRON, FFMPEG]));
      const artifact = parse(await modelTraceHandler({ id: ARTIFACT, rootPath }));
      expect(artifact.dependencies).toEqual({ direct: [], transitive: [] });
      expect(artifact.dependents.direct).toEqual([RECORDER]);
    });
  });

  it("counts what satisfies, delivers or supports an element among its dependencies", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const FEATURE = "product.feature.one-click-record";
      const VALUE = "motivation.value.less-friction";
      const SERVICE = "application.applicationservice.recording";
      const added = parse(
        await modelAddHandler({
          elements: [
            { layer: "motivation", type: "goal", name: "record-a-session", attributes: { priority: "high" } },
            { layer: "motivation", type: "requirement", name: "record-in-one-click", attributes: { requirementType: "functional", priority: "high" } },
            { layer: "motivation", type: "value", name: "less-friction", attributes: { valueType: "operational" } },
            { layer: "product", type: "feature", name: "one-click-record", attributes: { priority: "high", status: "planned" } },
            { layer: "application", type: "applicationservice", name: "recording", attributes: { serviceType: "synchronous" } },
            { layer: "api", type: "operation", name: "start-recording", attributes: { operationId: "startRecording", summary: "Start", tags: "recording" } },
          ],
          relationships: [
            { source: FEATURE, predicate: "satisfies", target: REQUIREMENT },
            { source: FEATURE, predicate: "delivers", target: VALUE },
            { source: SERVICE, predicate: "realizes", target: FEATURE },
            { source: RECORDER, predicate: "realizes", target: SERVICE },
            { source: "api.operation.start-recording", predicate: "supports", target: GOAL },
          ],
          rootPath,
        })
      );
      expect(added.relationships.results.every((r: any) => r.status === "added")).toBe(true);

      // Down from the requirement, and from the value, is what meets it, through to the code and
      // the technology under it.
      for (const intent of [REQUIREMENT, VALUE]) {
        const down = parse(await modelTraceHandler({ id: intent, rootPath }));
        expect(down.dependents).toEqual({ direct: [], transitive: [] });
        expect(down.dependencies.direct).toEqual([FEATURE]);
        expect(down.dependencies.transitive).toEqual(expect.arrayContaining([SERVICE, RECORDER, ENCODER, ELECTRON, FFMPEG]));
      }

      // Up from the feature is the requirement it satisfies and the value it delivers; down is
      // what realizes it. Neither is on both sides.
      const feature = parse(await modelTraceHandler({ id: FEATURE, depth: 1, rootPath }));
      expect(feature.dependents.direct.sort()).toEqual([REQUIREMENT, VALUE].sort());
      expect(feature.dependencies.direct).toEqual([SERVICE]);

      // Up from the code reaches the intent it stands under.
      const up = parse(await modelTraceHandler({ id: RECORDER, direction: "up", rootPath }));
      expect([...up.dependents.direct, ...up.dependents.transitive]).toEqual(
        expect.arrayContaining([SERVICE, FEATURE, REQUIREMENT, VALUE])
      );

      // supports runs the same way: the operation that supports the goal is on the goal's down
      // side, and the goal on the operation's up side.
      const operation = parse(await modelTraceHandler({ id: "api.operation.start-recording", rootPath }));
      expect(operation.dependents.direct).toEqual([GOAL]);
      expect(operation.dependencies.direct).toEqual([]);
      const goal = parse(await modelTraceHandler({ id: GOAL, rootPath }));
      expect(goal.dependencies.direct).toEqual(["api.operation.start-recording"]);
      expect(goal.dependents.direct).toEqual([]);
    });
  });

  it("a capability that supports a goal traces down to what realizes the capability, not to the goal's whole implementation", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const CAPABILITY = "product.softwarecapability.recording";
      const FEATURE = "product.feature.one-click-record";
      const OTHER = "product.softwarecapability.sharing";
      const OTHER_FEATURE = "product.feature.share-a-link";
      const added = parse(
        await modelAddHandler({
          elements: [
            { layer: "motivation", type: "goal", name: "record-a-session", attributes: { priority: "high" } },
            { layer: "product", type: "softwarecapability", name: "recording", attributes: { status: "planned" } },
            { layer: "product", type: "softwarecapability", name: "sharing", attributes: { status: "planned" } },
            { layer: "product", type: "feature", name: "one-click-record", attributes: { priority: "high", status: "planned" } },
            { layer: "product", type: "feature", name: "share-a-link", attributes: { priority: "low", status: "planned" } },
          ],
          relationships: [
            // Two capabilities support the same goal; each is realized by its own feature.
            { source: CAPABILITY, predicate: "supports", target: GOAL },
            { source: OTHER, predicate: "supports", target: GOAL },
            { source: FEATURE, predicate: "realizes", target: CAPABILITY },
            { source: OTHER_FEATURE, predicate: "realizes", target: OTHER },
          ],
          rootPath,
        })
      );
      expect(added.elements.results.every((r: any) => r.status === "added")).toBe(true);
      expect(added.relationships.results.every((r: any) => r.status === "added")).toBe(true);

      // Down from the capability: the feature that realizes it. Not the goal, and so not the other
      // capability and its feature, which implement the same goal.
      const down = parse(await modelTraceHandler({ id: CAPABILITY, direction: "down", rootPath }));
      expect(down.dependencies).toEqual({ direct: [FEATURE], transitive: [] });
      // The goal is what the capability stands under.
      const up = parse(await modelTraceHandler({ id: CAPABILITY, direction: "up", rootPath }));
      expect(up.dependents).toEqual({ direct: [GOAL], transitive: [] });
      // Down from the goal is both capabilities and what realizes them.
      const goal = parse(await modelTraceHandler({ id: GOAL, direction: "down", rootPath }));
      expect(goal.dependencies.direct.sort()).toEqual([CAPABILITY, OTHER].sort());
      expect(goal.dependencies.transitive.sort()).toEqual([FEATURE, OTHER_FEATURE].sort());
    });
  });

  it("puts each edge's ends on opposite sides: no element is both a dependency and a dependent through one edge", async () => {
    expect([...SOURCE_IS_DEPENDENCY_PREDICATES].sort()).toEqual(["delivers", "realizes", "satisfies", "serves", "supports"]);
    for (const predicate of ["serves", "realizes", "satisfies", "delivers", "supports"]) {
      expect(dependencyEnds({ source: "a", predicate, target: "b" })).toEqual({ dependent: "b", dependency: "a" });
    }
    // The control and cause predicates, and the rest, run from the dependent to what it depends on.
    for (const predicate of ["uses", "depends-on", "accesses", "composes", "governs", "constrains", "protects", "triggers", "flows-to"]) {
      expect(dependencyEnds({ source: "a", predicate, target: "b" })).toEqual({ dependent: "a", dependency: "b" });
    }
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      for (const id of [RECORDER, ENCODER, UI, PLAYER, ELECTRON, FFMPEG, HOST]) {
        const trace = parse(await modelTraceHandler({ id, depth: 1, rootPath }));
        const both = trace.dependencies.direct.filter((other: string) => trace.dependents.direct.includes(other));
        expect(both).toEqual([]);
      }
    });
  });

  it("does not list the traced element in its own trace when relationships form a cycle", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      // Two cycles through the recorder: one of uses alone, one that mixes uses with a flipped
      // predicate (the encoder realizes a service that serves the recorder).
      const added = parse(
        await modelAddHandler({
          elements: [{ layer: "application", type: "applicationservice", name: "encoding", attributes: { serviceType: "synchronous" } }],
          relationships: [
            { source: ENCODER, predicate: "uses", target: RECORDER },
            { source: ENCODER, predicate: "realizes", target: "application.applicationservice.encoding" },
            { source: "application.applicationservice.encoding", predicate: "serves", target: RECORDER },
          ],
          rootPath,
        })
      );
      expect(added.relationships.results.every((r: any) => r.status === "added")).toBe(true);

      for (const direction of ["down", "up"] as const) {
        const trace = parse(await modelTraceHandler({ id: RECORDER, direction, rootPath }));
        const side = direction === "down" ? trace.dependencies : trace.dependents;
        const reached = [...side.direct, ...side.transitive];
        // The walk ends, the recorder is not in its own trace, and nothing is listed twice.
        expect(reached).not.toContain(RECORDER);
        expect(new Set(reached).size).toBe(reached.length);
        expect(side.direct).toContain(ENCODER);
      }
      const down = parse(await modelTraceHandler({ id: RECORDER, direction: "down", rootPath }));
      expect(down.dependencies.direct).toContain("application.applicationservice.encoding");
    });
  });

  it("keeps one edge, with the relationship's standing, when a relationship repeats a cross-layer reference", () => {
    const edge = { source: "a", predicate: "uses", target: "b" };
    const staged = new DependencyGraph();
    staged.add(edge); // the reference the element carries
    staged.add(edge, { status: "added", follow: true }); // the staged relationship
    expect(staged.dependencies.get("a")).toEqual([{ ...edge, status: "added", follow: true }]);
    expect(staged.dependents.get("b")).toHaveLength(1);

    const removed = new DependencyGraph();
    removed.add(edge);
    removed.add(edge, { status: "deleted", follow: false });
    expect(removed.dependencies.get("a")).toEqual([{ ...edge, status: "deleted", follow: false }]);

    // A plain repeat changes nothing.
    removed.add(edge);
    expect(removed.dependencies.get("a")).toEqual([{ ...edge, status: "deleted", follow: false }]);
  });
});

describe("dr trace reads the same direction rule", () => {
  it("builds the tracker's graph from the dependent to what it depends on", () => {
    const graph = buildDependencyGraph([
      { source: "component", predicate: "uses", target: "library" },
      { source: "runtime", predicate: "serves", target: "component" },
      { source: "artifact", predicate: "realizes", target: "component" },
      { source: "component", predicate: "realizes", target: "service" },
      { source: "runtime", predicate: "serves", target: "other" },
      { source: "service", predicate: "satisfies", target: "requirement" },
      { source: "service", predicate: "delivers", target: "value" },
      { source: "service", predicate: "supports", target: "goal" },
    ]);
    const tracker = new DependencyTracker(graph);
    // TraceDirection.UP is what the element depends on; DOWN is what depends on it (dr trace's naming).
    expect(tracker.traceDependencies("component", TraceDirection.UP, null).sort()).toEqual(["artifact", "library", "runtime"]);
    expect(tracker.traceDependencies("component", TraceDirection.DOWN, null).sort()).toEqual(["goal", "requirement", "service", "value"]);
    expect(tracker.traceDependencies("runtime", TraceDirection.DOWN, null).sort()).toEqual([
      "component",
      "goal",
      "other",
      "requirement",
      "service",
      "value",
    ]);
    // supports runs the same way: the goal is among what depends on the service, not what it depends on.
    expect(tracker.traceDependencies("service", TraceDirection.UP, null).sort()).toEqual(["artifact", "component", "library", "runtime"]);
    expect(tracker.traceDependencies("service", TraceDirection.DOWN, null).sort()).toEqual(["goal", "requirement", "value"]);
    expect(tracker.traceDependencies("goal", TraceDirection.UP, 1)).toEqual(["service"]);
    expect(tracker.traceDependencies("requirement", TraceDirection.UP, 1)).toEqual(["service"]);
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

  it("model_stats still returns the statistics when validation cannot run, with the sentinel and the reason", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const failing = spyOn(Validator.prototype, "validateModel").mockRejectedValueOnce(new Error("projection failed"));
      try {
        const stats = parse(await modelStatsHandler({ rootPath }));
        expect(stats.validation).toMatchObject({ isValid: false, errors: -1, warnings: 0, error: "projection failed" });
        expect(stats.view.model).toBe("unknown");
        expect(stats.statistics.totalElements).toBe(7);
        expect(stats.statistics.totalRelationships).toBe(6);
        expect(stats.orphans.count).toBe(0);
      } finally {
        failing.mockRestore();
      }
      // The next call validates again.
      expect(parse(await modelStatsHandler({ rootPath })).validation).toMatchObject({ isValid: true, errors: 0 });
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

      // A kind with more than a page is listed a page at a time: the counts are of all of it,
      // the page says how many there are and where the next page starts, and the pages together
      // are every warning of the kind, each once.
      const first = parse(await modelValidateHandler({ warnings: ["orphan"], rootPath }));
      expect(first.warnings[0].count).toBe(count);
      expect(first.warnings[0].elements).toHaveLength(VALIDATE_LIST_LIMIT);
      expect(first.page).toEqual({ of: "warnings", total: count, returned: VALIDATE_LIST_LIMIT, offset: 0, nextOffset: VALIDATE_LIST_LIMIT });
      expect(first.more).toContain(`offset: ${VALIDATE_LIST_LIMIT}`);
      expect(first.summary.warningCount).toBe(count * 2);
      expect(first.warningCounts.find((w: any) => w.kind === "orphan").byLayer).toEqual([
        { layer: "application", count, types: { applicationfunction: 120, applicationcomponent: 40 } },
      ]);
      const second = parse(await modelValidateHandler({ warnings: ["orphan"], offset: first.page.nextOffset, rootPath }));
      expect(second.page).toEqual({ of: "warnings", total: count, returned: 10, offset: VALIDATE_LIST_LIMIT });
      expect(second.more).toBeUndefined();
      const paged = [...first.warnings[0].elements, ...second.warnings[0].elements];
      expect(new Set(paged).size).toBe(count);

      // Two kinds page as one list in the order named; limit sets the page.
      const seen: Record<string, string[]> = { orphan: [], "no-source-reference": [] };
      let offset: number | undefined = 0;
      let calls = 0;
      while (offset !== undefined) {
        const part = parse(await modelValidateHandler({ warnings: ["orphan", "no-source-reference"], limit: 70, offset, rootPath }));
        expect(part.page.total).toBe(count * 2);
        for (const group of part.warnings) {
          expect(group.count).toBe(count);
          seen[group.kind].push(...(group.elements ?? []));
        }
        offset = part.page.nextOffset;
        calls++;
      }
      expect(calls).toBe(Math.ceil((count * 2) / 70));
      expect(new Set(seen.orphan).size).toBe(count);
      expect(seen.orphan).toHaveLength(count);
      expect(seen["no-source-reference"].sort()).toEqual([...seen.orphan].sort());

      // detail: "full" with a kind lists every match on one page.
      const listed = parse(await modelValidateHandler({ warnings: ["orphan"], detail: "full", rootPath }));
      expect(listed.warnings[0].elements).toHaveLength(count);
      expect(listed.page).toEqual({ of: "warnings", total: count, returned: count, offset: 0 });

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
      expect(data.page).toEqual({ of: "errors", total: data.errors.length, returned: data.errors.length, offset: 0 });
      expect(data.errorsByLayer).toBeUndefined();

      // A warnings listing counts the errors and says where they are listed.
      const listing = parse(await modelValidateHandler({ warnings: ["orphan"], rootPath }));
      expect(listing.valid).toBe(false);
      expect(listing.errors).toBeUndefined();
      expect(listing.summary.errorCount).toBe(data.errors.length);
      expect(listing.errorsMore).toContain("without warnings");
    });
  });

  it("pages errors: the verdict and counts are of all of them, and the pages together are every error", async () => {
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
      const first = parse(await modelValidateHandler({ rootPath }));
      const total = first.summary.errorCount;
      expect(total).toBeGreaterThanOrEqual(VALIDATE_ERROR_LIMIT + 5);
      expect(first.valid).toBe(false);
      expect(first.errors).toHaveLength(VALIDATE_ERROR_LIMIT);
      expect(first.page).toEqual({ of: "errors", total, returned: VALIDATE_ERROR_LIMIT, offset: 0, nextOffset: VALIDATE_ERROR_LIMIT });
      // The summary of all of them, and the exact call for the rest.
      expect(first.errorsByLayer.reduce((sum: number, l: any) => sum + l.count, 0)).toBe(total);
      expect(first.more).toContain(`offset: ${VALIDATE_ERROR_LIMIT}`);
      expect(first.more).toContain("model_validate");

      const messages: string[] = first.errors.map((e: any) => `${e.elementId} ${e.message}`);
      let offset: number | undefined = first.page.nextOffset;
      while (offset !== undefined) {
        const next = parse(await modelValidateHandler({ offset, rootPath }));
        // Every page carries the whole verdict and the whole counts.
        expect(next.valid).toBe(false);
        expect(next.summary.errorCount).toBe(total);
        expect(next.page.total).toBe(total);
        messages.push(...next.errors.map((e: any) => `${e.elementId} ${e.message}`));
        offset = next.page.nextOffset;
      }
      const all = parse(await modelValidateHandler({ detail: "full", rootPath })).errors;
      expect(messages).toEqual(all.map((e: any) => `${e.elementId} ${e.message}`));

      // limit sets the page size, here to everything at once; past the end is an empty last page.
      const one = parse(await modelValidateHandler({ limit: total, rootPath }));
      expect(one.errors).toHaveLength(total);
      expect(one.page).toEqual({ of: "errors", total, returned: total, offset: 0 });
      expect(one.errorsByLayer).toBeUndefined();
      const past = parse(await modelValidateHandler({ offset: total + 50, rootPath }));
      expect(past.errors).toEqual([]);
      expect(past.page).toEqual({ of: "errors", total, returned: 0, offset: total });
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

  it("orphans: true pages the ids when there are more than a page, with the counts of all of them", async () => {
    await withProject(async (rootPath) => {
      const count = VALIDATE_LIST_LIMIT + 1;
      parse(
        await modelAddHandler({
          elements: Array.from({ length: count }, (_, i) => ({ layer: "application", type: "applicationfunction", name: `Unit ${i}` })),
          rootPath,
        })
      );
      const first = parse(await modelValidateHandler({ orphans: true, rootPath }));
      expect(first.orphanCount).toBe(count);
      expect(first.byLayer).toEqual([{ layer: "application", count, types: { applicationfunction: count } }]);
      expect(first.orphanedElements).toHaveLength(VALIDATE_LIST_LIMIT);
      expect(first.page).toEqual({ of: "orphans", total: count, returned: VALIDATE_LIST_LIMIT, offset: 0, nextOffset: VALIDATE_LIST_LIMIT });
      expect(first.more).toContain(`offset: ${VALIDATE_LIST_LIMIT}`);
      expect(first.more).toContain("model_list");

      const second = parse(await modelValidateHandler({ orphans: true, offset: first.page.nextOffset, rootPath }));
      expect(second.orphanCount).toBe(count);
      expect(second.page).toEqual({ of: "orphans", total: count, returned: 1, offset: VALIDATE_LIST_LIMIT });
      expect(second.more).toBeUndefined();
      expect(new Set([...first.orphanedElements, ...second.orphanedElements]).size).toBe(count);

      expect(parse(await modelValidateHandler({ orphans: true, detail: "full", rootPath })).orphanedElements).toHaveLength(count);
      expect(parse(await modelValidateHandler({ orphans: true, limit: 500, rootPath })).orphanedElements).toHaveLength(count);
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

describe("paged listings: a limit is a page size, never a cut-off", () => {
  it("model_list pages a compact or full listing across layers, and the pages are every element once", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      parse(
        await modelAddHandler({
          elements: Array.from({ length: 60 }, (_, i) => ({ layer: "application", type: "applicationfunction", name: `Unit ${i}` })),
          rootPath,
        })
      );
      // 67 elements: 64 application, 3 technology. Full is LIST_FULL_LIMIT a page by default.
      const ids: string[] = [];
      const counts = new Map<string, number>();
      let offset: number | undefined = 0;
      let pages = 0;
      while (offset !== undefined) {
        const part = parse(await modelListHandler({ detail: "full", offset, rootPath }));
        expect(part.totalElements).toBe(67);
        expect(part.page.total).toBe(67);
        for (const layer of part.layers) {
          counts.set(layer.layer, layer.count);
          ids.push(...layer.elements.map((e: any) => e.path));
        }
        if (part.page.nextOffset !== undefined) expect(part.more).toContain(`offset: ${part.page.nextOffset}`);
        offset = part.page.nextOffset;
        pages++;
      }
      expect(pages).toBe(Math.ceil(67 / LIST_FULL_LIMIT));
      expect(ids).toHaveLength(67);
      expect(new Set(ids).size).toBe(67);
      // A layer's count is its total on every page it appears on.
      expect(Object.fromEntries(counts)).toEqual({ application: 64, technology: 3 });

      // The same for the orphans-only listing, with a page size of the caller's.
      const orphans: string[] = [];
      offset = 0;
      while (offset !== undefined) {
        const part = parse(await modelListHandler({ orphans: true, detail: "compact", limit: 25, offset, rootPath }));
        expect(part.page.total).toBe(60);
        expect(part.totalElements).toBe(60);
        orphans.push(...part.layers.flatMap((l: any) => l.elements.map((e: any) => e.id)));
        offset = part.page.nextOffset;
      }
      expect(new Set(orphans).size).toBe(60);
      expect(orphans).toHaveLength(60);

      // A layer-scoped listing pages the same way.
      const scoped = parse(await modelListHandler({ layer: "application", detail: "compact", limit: 10, offset: 60, rootPath }));
      expect(scoped.count).toBe(64);
      expect(scoped.elements).toHaveLength(4);
      expect(scoped.page).toEqual({ total: 64, returned: 4, offset: 60 });
    });
  });

  it("model_trace pages each list with its true total, and the pages together are the whole trace", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      const count = TRACE_LIST_LIMIT + 30;
      const added = parse(
        await modelAddHandler({
          elements: Array.from({ length: count }, (_, i) => ({
            layer: "application",
            type: "applicationcomponent",
            name: `Plugin ${i}`,
            attributes: { type: "internal" },
          })),
          relationships: Array.from({ length: count }, (_, i) => ({
            source: `application.applicationcomponent.plugin-${i}`,
            predicate: "uses",
            target: RECORDER,
          })),
          rootPath,
        })
      );
      expect(added.relationships.counts.invalid ?? 0).toBe(0);

      const whole = parse(await modelTraceHandler({ id: RECORDER, limit: 1000, rootPath }));
      expect(whole.dependents.direct).toHaveLength(count + 1); // the plugins and the UI
      expect(whole.page).toEqual({
        offset: 0,
        totals: { "dependents.direct": count + 1, "dependents.transitive": 0, "dependencies.direct": 3, "dependencies.transitive": 1 },
      });
      expect(whole.more).toBeUndefined();

      const first = parse(await modelTraceHandler({ id: RECORDER, rootPath }));
      expect(first.dependents.direct).toHaveLength(TRACE_LIST_LIMIT);
      // The short lists are whole on the first page, and the totals are the true lengths.
      expect(first.dependencies).toEqual(whole.dependencies);
      expect(first.page).toEqual({ offset: 0, totals: whole.page.totals, nextOffset: TRACE_LIST_LIMIT });
      expect(first.summary.dependents).toEqual([
        { layer: "application", count: count + 1, types: { applicationcomponent: count + 1 } },
      ]);
      expect(first.more).toContain(`offset: ${TRACE_LIST_LIMIT}`);

      const second = parse(await modelTraceHandler({ id: RECORDER, offset: first.page.nextOffset, rootPath }));
      expect(second.page).toEqual({ offset: TRACE_LIST_LIMIT, totals: whole.page.totals });
      expect(second.dependencies).toEqual({ direct: [], transitive: [] });
      expect([...first.dependents.direct, ...second.dependents.direct]).toEqual(whole.dependents.direct);
      // The last page keeps the summary of the whole trace, and says it is the last.
      expect(second.summary).toEqual(first.summary);
      expect(second.more).toContain("last page");
      expect(second.more).not.toContain("offset:");
    });
  }, 60_000);

  it("model_trace pages changedEdges and changedElements too", async () => {
    await withProject(async (rootPath) => {
      await recorderModel(rootPath);
      await changesetCreateHandler({ name: "plugins", description: "Add plugins", rootPath });
      parse(
        await modelAddHandler({
          elements: Array.from({ length: 12 }, (_, i) => ({
            layer: "application",
            type: "applicationcomponent",
            name: `Plugin ${i}`,
            attributes: { type: "internal" },
          })),
          relationships: Array.from({ length: 12 }, (_, i) => ({
            source: `application.applicationcomponent.plugin-${i}`,
            predicate: "uses",
            target: RECORDER,
          })),
          rootPath,
        })
      );
      const whole = parse(await modelTraceHandler({ id: RECORDER, direction: "up", rootPath }));
      expect(whole.changedEdges).toHaveLength(12);
      expect(whole.page.totals).toMatchObject({ changedEdges: 12, changedElements: 12, "dependents.direct": 13 });

      const edges: any[] = [];
      const elements: Record<string, string> = {};
      let offset: number | undefined = 0;
      while (offset !== undefined) {
        const part = parse(await modelTraceHandler({ id: RECORDER, direction: "up", limit: 5, offset, rootPath }));
        expect(part.page.totals).toEqual(whole.page.totals);
        edges.push(...part.changedEdges);
        Object.assign(elements, part.changedElements);
        offset = part.page.nextOffset;
      }
      expect(edges).toEqual(whole.changedEdges);
      expect(elements).toEqual(whole.changedElements);
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

  it("shows the enum of a required array's items, keyed name[]", async () => {
    const store = parse(await specTypeHandler({ layer: "data-store" }));
    const handler = store.types.find((t: any) => t.type === "eventhandler");
    expect(handler.requiredAttributes).toEqual(["handlerType", "events"]);
    expect(Object.keys(handler.requiredEnums).sort()).toEqual(["events[]", "handlerType"]);
    expect(handler.requiredEnums["events[]"]).toEqual(expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]));
    expect(handler.requiredEnums["events[]"]).toHaveLength(13);

    // The one-type form names the items' values too.
    const one = parse(await specTypeHandler({ layer: "data-store", type: "eventhandler" }));
    const events = one.attributes.find((a: any) => a.name === "events");
    expect(events).toMatchObject({ required: true, type: "array" });
    expect(events.itemsEnum).toHaveLength(13);
    expect(events.enum).toBeUndefined();
  });

  it("keeps one side of a type's relationships with direction", async () => {
    const both = parse(await specTypeHandler({ layer: "application", type: "applicationfunction", otherLayer: "application" }));
    expect(both.outgoing.length).toBeGreaterThan(0);
    expect(both.incoming.length).toBeGreaterThan(0);
    const out = parse(await specTypeHandler({ layer: "application", type: "applicationfunction", otherLayer: "application", direction: "out" }));
    expect(out.outgoing).toEqual(both.outgoing);
    expect(out.incoming).toBeUndefined();
    const into = parse(await specTypeHandler({ layer: "application", type: "applicationfunction", otherLayer: "application", direction: "in" }));
    expect(into.incoming).toEqual(both.incoming);
    expect(into.outgoing).toBeUndefined();
  });
});
