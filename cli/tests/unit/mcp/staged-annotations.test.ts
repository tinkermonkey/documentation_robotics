/**
 * Annotations made while a changeset is active are staged in it (#1447): they stay out of the base
 * model's annotations until the plan lands, land with it, and are discarded with it.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { AnnotationStore } from "../../../src/core/annotation-store.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { annotationCreateHandler } from "../../../src/mcp/tools/annotation-create.js";
import { annotationListHandler } from "../../../src/mcp/tools/annotation-list.js";
import { annotationGetHandler } from "../../../src/mcp/tools/annotation-get.js";
import { annotationReplyHandler } from "../../../src/mcp/tools/annotation-reply.js";
import { annotationUpdateHandler } from "../../../src/mcp/tools/annotation-update.js";
import { annotationDeleteHandler } from "../../../src/mcp/tools/annotation-delete.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { changesetBriefHandler } from "../../../src/mcp/tools/changeset-analysis-tools.js";
import { changesetCommitHandler, changesetCommitPreviewHandler } from "../../../src/mcp/tools/changeset-commit.js";
import { changesetDiscardHandler } from "../../../src/mcp/tools/changeset-editing.js";

const SERVICE = "business.businessservice.payments";
let rootPath: string;

function parse(result: any): any {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

async function setUp(): Promise<void> {
  rootPath = join(tmpdir(), `dr-staged-annotations-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(rootPath, { recursive: true });
  clearModelCache();
  await Model.init(rootPath, { name: "Staged Annotations Test", version: "0.1.0" });
  await modelAddHandler({ layer: "business", type: "businessservice", name: "payments", description: "Payments", rootPath });
}

afterEach(async () => {
  clearModelCache();
  if (rootPath) await rm(rootPath, { recursive: true, force: true });
});

const baseIds = async () => (await new AnnotationStore(rootPath).list()).map((a) => a.id);

describe("annotations staged in a changeset", () => {
  it("stages while a changeset is active, keeps replies and updates staged, and lands with the plan", async () => {
    await setUp();
    parse(await changesetCreateHandler({ name: "plan-a", description: "Plan A", rootPath }));

    const created = parse(await annotationCreateHandler({ elementId: SERVICE, content: "Split next quarter", rootPath }));
    expect(created.staged).toEqual({ changeset: "plan-a" });
    expect(await baseIds()).toEqual([]);

    const reply = parse(await annotationReplyHandler({ annotationId: created.id, content: "Agreed", rootPath }));
    expect(reply.staged).toEqual({ changeset: "plan-a" });
    parse(await annotationUpdateHandler({ annotationId: created.id, tags: ["later"], rootPath }));
    expect(await baseIds()).toEqual([]);

    const got = parse(await annotationGetHandler({ annotationId: created.id, rootPath }));
    expect(got.replies).toHaveLength(1);
    expect(got.tags).toEqual(["later"]);
    const listed = parse(await annotationListHandler({ rootPath }));
    expect(listed.annotations.map((a: any) => a.id)).toEqual([created.id]);
    expect(listed.annotations[0].staged).toEqual({ changeset: "plan-a" });

    // The brief lists it as feedback, marked staged.
    const brief = parse(await changesetBriefHandler({ rootPath, detail: "full" }));
    expect(brief.feedback).toEqual([expect.objectContaining({ annotationId: created.id, staged: true, replies: 1 })]);

    // An empty plan has nothing to land; give it a change.
    parse(await modelAddHandler({ layer: "business", type: "businessservice", name: "refunds", description: "Refunds", rootPath }));
    // The landing summary names it.
    const preview = parse(await changesetCommitPreviewHandler({ changeset: "plan-a", rootPath } as any));
    expect(JSON.stringify(preview)).toContain(`Annotations: 1 staged`);
    expect(JSON.stringify(preview)).toContain(created.id);
    // The preview is a dry run: nothing reaches the base.
    expect(await baseIds()).toEqual([]);

    const landed = parse(await changesetCommitHandler({ changeset: "plan-a", rootPath } as any));
    expect(landed.status).toBe("committed");
    expect(landed.annotationsLanded).toBe(1);
    expect(landed.filesToCommit).toContain(join("documentation-robotics", "annotations"));

    const inBase = await new AnnotationStore(rootPath).get(created.id);
    expect(inBase?.replies).toHaveLength(1);
    expect(inBase?.tags).toEqual(["later"]);
  });

  it("is discarded with the plan", async () => {
    await setUp();
    parse(await changesetCreateHandler({ name: "plan-b", description: "Plan B", rootPath }));
    const created = parse(await annotationCreateHandler({ elementId: SERVICE, content: "Scratch", rootPath }));
    parse(await changesetDiscardHandler({ changesetId: "plan-b", confirm: true, rootPath }));
    expect(await baseIds()).toEqual([]);
    expect(existsSync(join(rootPath, "documentation-robotics", "annotations"))).toBe(false);
    expect((await annotationGetHandler({ annotationId: created.id, rootPath })).isError).toBe(true);
  });

  it("deletes a staged annotation from the changeset, not the base", async () => {
    await setUp();
    const base = parse(await annotationCreateHandler({ elementId: SERVICE, content: "Base note", rootPath }));
    parse(await changesetCreateHandler({ name: "plan-c", description: "Plan C", rootPath }));
    const staged = parse(await annotationCreateHandler({ elementId: SERVICE, content: "Staged note", rootPath }));
    parse(await annotationDeleteHandler({ annotationId: staged.id, rootPath }));
    expect(await baseIds()).toEqual([base.id]);
    const listed = parse(await annotationListHandler({ rootPath }));
    expect(listed.annotations.map((a: any) => a.id)).toEqual([base.id]);
  });

  it("takes `changeset` to stage in a changeset that is not active", async () => {
    await setUp();
    parse(await changesetCreateHandler({ name: "plan-d", description: "Plan D", rootPath }));
    parse(await changesetDeactivateHandler({ rootPath }));
    const created = parse(await annotationCreateHandler({ elementId: SERVICE, content: "Named", changeset: "plan-d", rootPath }));
    expect(created.staged).toEqual({ changeset: "plan-d" });
    expect(await baseIds()).toEqual([]);
    const missing = await annotationCreateHandler({ elementId: SERVICE, content: "x", changeset: "nope", rootPath });
    expect(missing.isError).toBe(true);
  });

  it("writes to the base as before when no changeset is active, and reads a changeset without annotations", async () => {
    await setUp();
    const created = parse(await annotationCreateHandler({ elementId: SERVICE, content: "Plain", rootPath }));
    expect(created.staged).toBeUndefined();
    expect(await baseIds()).toEqual([created.id]);

    // A changeset made before staged annotations has no annotations folder and reads as having none.
    parse(await changesetCreateHandler({ name: "old-plan", description: "Old", rootPath }));
    const dir = join(rootPath, "documentation-robotics", "changesets");
    for (const id of await readdir(dir)) expect(existsSync(join(dir, id, "annotations"))).toBe(false);
    const listed = parse(await annotationListHandler({ rootPath }));
    expect(listed.annotations.map((a: any) => a.id)).toEqual([created.id]);
    const brief = parse(await changesetBriefHandler({ rootPath, detail: "full" }));
    expect(brief.feedback).toEqual([]);
  });

  it("says so in the landing summary and the result when a staged annotation can't be read", async () => {
    await setUp();
    const plan = parse(await changesetCreateHandler({ name: "plan-e", description: "Plan E", rootPath }));
    const good = parse(await annotationCreateHandler({ elementId: SERVICE, content: "Fine", rootPath }));
    const dir = join(rootPath, "documentation-robotics", "changesets", plan.id, "annotations");
    await writeFile(join(dir, "corrupt.yaml"), "id: corrupt\n");
    parse(await modelAddHandler({ layer: "business", type: "businessservice", name: "refunds", description: "Refunds", rootPath }));

    const preview = parse(await changesetCommitPreviewHandler({ changeset: "plan-e", rootPath } as any));
    expect(JSON.stringify(preview)).toContain("Staged annotation not landing: corrupt");

    const landed = parse(await changesetCommitHandler({ changeset: "plan-e", rootPath } as any));
    expect(landed.status).toBe("committed");
    expect(landed.annotationsLanded).toBe(1);
    expect(landed.annotationsWarning).toContain("corrupt");
    expect(await baseIds()).toEqual([good.id]);
  });
});
