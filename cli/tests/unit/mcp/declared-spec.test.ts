/**
 * A model is checked against the spec it declares, not only this CLI's catalog (#1411): a model on
 * spec 0.13.0 refuses the `applicationservice accesses objectschema` relationship and the
 * `application.message` type, which only 0.14.0 and later have, at staging, in model_validate and
 * at landing.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { clearModelCache, loadModel } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { modelUpdateHandler } from "../../../src/mcp/tools/model-update.js";
import { relationshipAddHandler } from "../../../src/mcp/tools/relationship-tools.js";
import { modelValidateHandler } from "../../../src/mcp/tools/model-validate.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetCommitPreviewHandler } from "../../../src/mcp/tools/changeset-commit.js";
import { modelShowHandler } from "../../../src/mcp/tools/model-show.js";
import { modelExportHandler } from "../../../src/mcp/tools/model-export.js";
import { getCliBundledSpecVersion } from "../../../src/utils/spec-version.js";
import { stringifyDrYaml } from "../../../src/core/dr-yaml.js";
import { projectUpgradeHandler } from "../../../src/mcp/tools/project-tools.js";
import { listed } from "../../helpers/batch-causes.js";

const SERVICE = "application.applicationservice.proposal-service";
const COMPONENT = "application.applicationcomponent.proposal-repository";
const SCHEMA = "data-model.objectschema.operation-draft";

let rootPath: string;

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function setUp(specVersion: string): Promise<void> {
  await Model.init(rootPath, { name: "Declared spec", version: "0.1.0", specVersion });
  const added = parse(
    await modelAddHandler({
      elements: [
        { layer: "application", type: "applicationservice", name: "proposal-service", attributes: { serviceType: "synchronous" } },
        { layer: "application", type: "applicationcomponent", name: "proposal-repository", attributes: { type: "internal" } },
        { layer: "data-model", type: "objectschema", name: "operation-draft", attributes: { type: "object" } },
      ],
      rootPath,
    })
  );
  expect(added.elements.counts).toEqual({ added: 3 });
}

beforeEach(async () => {
  rootPath = join(tmpdir(), `dr-declared-spec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  clearModelCache();
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("staging checks the spec the model declares (#1411)", () => {
  it("relationship_add refuses a relationship type only a later spec has, naming both versions", async () => {
    await setUp("0.13.0");
    const result = await relationshipAddHandler({ source: SERVICE, predicate: "accesses", target: SCHEMA, rootPath });
    expect(result.isError).toBe(true);
    const { error, suggestions } = parse(result);
    expect(error).toContain("application.applicationservice --[accesses]--> data-model.objectschema");
    expect(error).toContain("is not in spec 0.13.0, the model's version; it exists from spec 0.14.0");
    expect(suggestions.join(" ")).toContain("project_upgrade");

    // One 0.13.0 has is staged as before
    expect(parse(await relationshipAddHandler({ source: COMPONENT, predicate: "accesses", target: SCHEMA, rootPath })).status).toBe(
      "added"
    );
  });

  it("relationship_add's list form reports it as invalid and writes the rest", async () => {
    await setUp("0.13.0");
    const result = parse(
      await relationshipAddHandler({
        relationships: [
          { source: SERVICE, predicate: "accesses", target: SCHEMA },
          { source: COMPONENT, predicate: "accesses", target: SCHEMA },
        ],
        rootPath,
      })
    );
    expect(result.counts).toEqual({ added: 1, invalid: 1 });
    const [refused] = listed(result);
    expect(refused.reason).toContain("is not in spec 0.13.0");
    expect(refused.suggestions!.join(" ")).toContain("project_upgrade");
  });

  it("model_add refuses a type only a later spec has, alone and in a list", async () => {
    await setUp("0.13.0");
    const single = await modelAddHandler({
      layer: "application",
      type: "message",
      name: "operation-submitted",
      attributes: { messageType: "document" },
      rootPath,
    });
    expect(single.isError).toBe(true);
    expect(parse(single).error).toContain("Type application.message is not in spec 0.13.0");

    const batch = parse(
      await modelAddHandler({
        elements: [{ layer: "application", type: "message", name: "operation-submitted", attributes: { messageType: "document" } }],
        rootPath,
      })
    );
    expect(batch.elements.counts).toEqual({ invalid: 1 });
    expect(listed(batch.elements)[0].reason).toContain("it exists from spec 0.14.0");
  });

  it("model_update refuses changing an element to such a type", async () => {
    await setUp("0.13.0");
    await modelAddHandler({ layer: "application", type: "dataobject", name: "draft-payload", rootPath });
    const result = await modelUpdateHandler({ id: "application.dataobject.draft-payload", type: "message", rootPath });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toContain("Type application.message is not in spec 0.13.0");
  });

  it("accepts both once the model is on a spec that has them", async () => {
    await setUp("0.14.0");
    expect(parse(await relationshipAddHandler({ source: SERVICE, predicate: "accesses", target: SCHEMA, rootPath })).status).toBe(
      "added"
    );
    const message = await modelAddHandler({
      layer: "application",
      type: "message",
      name: "operation-submitted",
      attributes: { messageType: "document" },
      rootPath,
    });
    expect(message.isError).toBeFalsy();
  });
});

describe("a model on a spec newer than this dr's (#1411)", () => {
  it("is not refused what this dr knows, and a refusal says the spec is newer rather than the model wrong", async () => {
    await setUp("99.0.0");
    // Nothing this dr knows is refused for it
    expect(parse(await relationshipAddHandler({ source: SERVICE, predicate: "accesses", target: SCHEMA, rootPath })).status).toBe(
      "added"
    );

    // A type or relationship type this dr doesn't know: unknown here, not invalid
    const type = await modelAddHandler({ layer: "application", type: "futuretype", name: "x", rootPath });
    expect(type.isError).toBe(true);
    expect(parse(type).suggestions[0]).toContain("The model is on spec 99.0.0, newer than the");
    const relationship = parse(
      await relationshipAddHandler({ relationships: [{ source: SCHEMA, predicate: "serves", target: SERVICE }], rootPath })
    );
    // The predicates allowed between the two types first (#1354), then that the spec is newer
    const [refused] = listed(relationship);
    expect(refused.suggestions![0]).toContain("Between these types the catalog allows");
    expect(refused.suggestions![1]).toContain("unknown here, not invalid");
  });
});

const manifestFile = () => join(rootPath, "documentation-robotics/model/manifest.yaml");

describe("types the check leaves to the other validators (#1411)", () => {
  it("checks a legacy short type id as the type it names, and never names an unknown type", async () => {
    await Model.init(rootPath, { name: "Legacy", version: "0.1.0", specVersion: "0.8.4" });
    // business.service is the short id of business.businessservice; application.widget is no type
    const element = (path: string, type: string, layer: string) => ({
      [path]: { id: `${path}-id`, path, spec_node_id: `${layer}.${type}`, type, layer_id: layer, name: path },
    });
    await writeFile(
      join(rootPath, "documentation-robotics/model/02_business/business_service.yaml"),
      stringifyDrYaml(element("business.service.payments", "service", "business"))
    );
    await writeFile(
      join(rootPath, "documentation-robotics/model/05_application/widget.yaml"),
      stringifyDrYaml(element("application.widget.thing", "widget", "application"))
    );
    clearModelCache();

    const data = parse(await modelValidateHandler({ rootPath, detail: "full" }));
    const all = [...data.errors, ...(data.warnings ?? [])].map((issue: any) => issue.message);
    expect(all.filter((message: string) => message.includes("is not in spec"))).toEqual([]);
    // The unknown type is still reported, as an unknown type
    expect(all.some((message: string) => message.includes("application.widget.thing"))).toBe(true);
  });
});

describe("a manifest with no spec_version (#1411)", () => {
  async function versionless(): Promise<void> {
    await setUp(getCliBundledSpecVersion());
    await writeFile(manifestFile(), (await readFile(manifestFile(), "utf-8")).replace(/^spec_version:.*\n/m, ""));
    clearModelCache();
  }

  it("warns rather than refuses, names project_upgrade, and a write doesn't stamp the assumed version", async () => {
    await versionless();
    const added = await modelAddHandler({
      layer: "application",
      type: "message",
      name: "operation-submitted",
      attributes: { messageType: "document" },
      rootPath,
    });
    expect(added.isError).toBeFalsy();
    const warning = parse(added).warnings.join(" ");
    expect(warning).toContain("the version a manifest with no spec_version is read as");
    expect(warning).toContain("project_upgrade");
    expect(await readFile(manifestFile(), "utf-8")).not.toMatch(/^spec_version:/m);

    const related = parse(await relationshipAddHandler({ source: SERVICE, predicate: "accesses", target: SCHEMA, rootPath }));
    expect(related.status).toBe("added");
    expect(related.warnings.join(" ")).toContain("is not in spec 0.6.0");

    const data = parse(await modelValidateHandler({ rootPath, detail: "full" }));
    expect(data.errors.filter((e: any) => e.message.includes("is not in spec"))).toEqual([]);
    expect(data.warnings.some((w: any) => w.message.includes("is not in spec 0.6.0"))).toBe(true);
  });

  it("project_upgrade reads it as 0.6.0 and previews the migration, instead of refusing", async () => {
    await versionless();
    const preview = parse(await projectUpgradeHandler({ rootPath }));
    expect(preview.status).toBe("preview");
    expect(preview.model).toMatchObject({ specVersion: "0.6.0", assumed: true });
    expect(preview.model.note).toContain("no spec_version");
  });
});

describe("model_validate and the landing check the spec the model declares (#1411)", () => {
  it("model_validate reports a relationship the model's spec lacks as an error", async () => {
    await setUp("0.13.0");
    // As a landing by an older dr, or a hand edit, would leave it
    const model = await loadModel(rootPath);
    model.relationships.add({ source: SERVICE, predicate: "accesses", target: SCHEMA, layer: "application", targetLayer: "data-model" });

    const data = parse(await modelValidateHandler({ rootPath }));
    expect(data.valid).toBe(false);
    const errors = data.errors.filter((e: any) => e.message.includes("is not in spec 0.13.0"));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(`${SERVICE} --[accesses]--> ${SCHEMA}`);
    expect(errors[0].message).toContain("it exists from spec 0.14.0");
  });

  it("changeset_commit_preview refuses to land one a changeset stages", async () => {
    await setUp("0.13.0");
    await changesetCreateHandler({ name: "cross-context-rule", rootPath });
    // Staged by an older dr, which did not check the model's spec
    const model = await loadModel(rootPath);
    const manager = new StagingAreaManager(model.rootPath, model);
    const active = await manager.getActiveId();
    await manager.stage(active!, {
      type: "relationship-add",
      elementId: `${SERVICE}::accesses::${SCHEMA}`,
      layerName: "application",
      after: { source: SERVICE, predicate: "accesses", target: SCHEMA, layer: "application", targetLayer: "data-model", category: "structural" },
    });
    clearModelCache();

    const preview = await changesetCommitPreviewHandler({ rootPath, changeset: "cross-context-rule" });
    expect(preview.isError).toBe(true);
    expect(JSON.stringify(parse(preview))).toContain("is not in spec 0.13.0");
  });

  it("a model that already holds one still loads, reads, exports and takes unrelated changes; only validation names it", async () => {
    await setUp("0.13.0");
    const model = await loadModel(rootPath);
    model.relationships.add({ source: SERVICE, predicate: "accesses", target: SCHEMA, layer: "application", targetLayer: "data-model" });
    await model.saveRelationships();
    clearModelCache();

    // Reads
    const shown = parse(await modelShowHandler({ id: SERVICE, rootPath }));
    expect(shown.relationships.outgoing.some((r: any) => r.target === SCHEMA && r.predicate === "accesses")).toBe(true);
    const exported = await modelExportHandler({ format: "markdown", rootPath });
    expect(exported.isError).toBeFalsy();

    // An unrelated change stages and lands; the relationship already there is not counted against it
    await changesetCreateHandler({ name: "unrelated", rootPath });
    expect(parse(await relationshipAddHandler({ source: COMPONENT, predicate: "accesses", target: SCHEMA, rootPath })).status).toBe(
      "staged"
    );
    const preview = parse(await changesetCommitPreviewHandler({ rootPath, changeset: "unrelated" }));
    expect(preview.summary ?? JSON.stringify(preview)).toContain("already in the base model are not counted");

    // model_validate names the element ids, so it can be found and removed
    const data = parse(await modelValidateHandler({ rootPath }));
    const named = data.errors.filter((e: any) => e.message.includes(`${SERVICE} --[accesses]--> ${SCHEMA}`));
    expect(named).toHaveLength(1);
    expect(named[0].elementId).toBe(SERVICE);
  });

  it("checks nothing for a model on the bundled spec", async () => {
    await setUp(getCliBundledSpecVersion());
    expect(parse(await relationshipAddHandler({ source: SERVICE, predicate: "accesses", target: SCHEMA, rootPath })).status).toBe(
      "added"
    );
    expect(parse(await modelValidateHandler({ rootPath })).summary.errorCount).toBe(0);
  });
});
