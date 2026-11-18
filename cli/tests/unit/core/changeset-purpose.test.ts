/**
 * A changeset's purpose (#1171): declared at creation in metadata.yaml, inferred for changesets made
 * before that, deciding which landings stamp `reconciled`, and refusing to land a verification
 * record (#1172) in StagingAreaManager.commit, which the CLI, changeset_commit and the viewer share.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { Model } from "../../../src/core/model.js";
import { StagingAreaManager } from "../../../src/core/staging-area.js";
import { resolveOrigin } from "../../../src/core/changeset-review.js";
import {
  allowedActions,
  creationPurpose,
  extractionPurpose,
  purposeOf,
  readPurpose,
  VerificationRecordLandingError,
} from "../../../src/core/changeset-purpose.js";
import { reconciliationStamp } from "../../../src/core/reconciliation.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";

const MARKER = "As-built extraction of the code at abc1234. Staged by codebase_extract.";

async function tempDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeRecord(root: string, file: string, record: Record<string, unknown>): Promise<void> {
  const dir = join(root, ".dr", "analyzers", "extract");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), JSON.stringify(record));
}

async function newProject(): Promise<{ rootPath: string; manager: StagingAreaManager; model: Model }> {
  clearModelCache();
  const rootPath = await tempDir("dr-changeset-purpose");
  await Model.init(rootPath, { name: "Changeset Purpose", version: "0.1.0" });
  const model = await Model.load(rootPath, { lazyLoad: false });
  return { rootPath, model, manager: new StagingAreaManager(model.rootPath, model) };
}

describe("readPurpose and allowedActions", () => {
  it("reads a declaration leniently", () => {
    expect(readPurpose({ purpose: "plan" })).toEqual({ purpose: "plan" });
    expect(readPurpose({ purpose: "verification", verifies: "cs-1", scope: { since: "main", codeCommit: "abc" } })).toEqual({
      purpose: "verification",
      verifies: "cs-1",
      scope: { since: "main", codeCommit: "abc" },
    });
    expect(readPurpose({ purpose: "verification", verifies: 3, scope: { codeCommit: "abc" } })).toEqual({ purpose: "verification" });
    expect(readPurpose({ purpose: "recorded" })).toBeUndefined();
    expect(readPurpose({})).toBeUndefined();
    expect(readPurpose(null)).toBeUndefined();
  });

  it("offers commit and discard while staged, never commit for a verification record, nothing once closed", () => {
    for (const purpose of ["plan", "chat", "bootstrap", "reconcile"] as const) {
      expect(allowedActions(purpose, "staged")).toEqual(["commit", "discard"]);
    }
    expect(allowedActions("verification", "staged")).toEqual(["discard"]);
    for (const status of ["committed", "discarded"]) {
      expect(allowedActions("plan", status)).toEqual([]);
      expect(allowedActions("verification", status)).toEqual([]);
    }
  });

  it("gives an extraction run's purpose by its since and the plan active before", () => {
    expect(extractionPurpose({ since: null, gitHead: "h" })).toEqual({ purpose: "bootstrap" });
    expect(extractionPurpose({ since: "main", gitHead: "h", previousActive: null })).toEqual({ purpose: "reconcile" });
    expect(extractionPurpose({ since: "main", gitHead: "h", previousActive: { id: "cs-plan" } })).toEqual({
      purpose: "verification",
      verifies: "cs-plan",
      scope: { since: "main", codeCommit: "h" },
    });
    // A plan active before a whole-code run doesn't make it a verification.
    expect(extractionPurpose({ since: null, previousActive: { id: "cs-plan" } })).toEqual({ purpose: "bootstrap" });
  });
});

describe("purposeOf", () => {
  it("returns the declared purpose, over anything the extraction record says", async () => {
    const root = await tempDir("dr-purpose-of");
    try {
      await writeRecord(root, "cs-1.json", { changesetId: "cs-1", changesetName: "x", gitHead: "h", since: "main", previousActive: { id: "p", name: "p" } });
      expect(await purposeOf(root, { id: "cs-1", name: "x", purpose: "reconcile" })).toEqual({ purpose: "reconcile", declared: true });
      expect(
        await purposeOf(root, { id: "cs-2", name: "y", purpose: "verification", verifies: "p", scope: { since: "main" } })
      ).toEqual({ purpose: "verification", verifies: "p", scope: { since: "main" }, declared: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("infers an older changeset's purpose from its extraction record, waiting cards, description and origin", async () => {
    const root = await tempDir("dr-purpose-infer");
    try {
      await writeRecord(root, "cs-boot.json", { changesetId: "cs-boot", changesetName: "boot", gitHead: "h1", since: null });
      await writeRecord(root, "cs-rec.json", { changesetId: "cs-rec", changesetName: "rec", gitHead: "h2", since: "main" });
      await writeRecord(root, "cs-ver.json", {
        changesetId: "cs-ver",
        changesetName: "ver",
        gitHead: "h3",
        since: "main",
        previousActive: { id: "cs-plan", name: "the-plan" },
      });
      await writeRecord(root, "pending.json", { changesetId: "", changesetName: "waiting", gitHead: "h4", since: "dev", pending: true });

      expect(await purposeOf(root, { id: "cs-boot", name: "boot" })).toEqual({ purpose: "bootstrap", declared: false });
      expect(await purposeOf(root, { id: "cs-rec", name: "rec" })).toEqual({ purpose: "reconcile", declared: false });
      expect(await purposeOf(root, { id: "cs-ver", name: "ver" })).toEqual({
        purpose: "verification",
        verifies: "cs-plan",
        scope: { since: "main", codeCommit: "h3" },
        declared: false,
      });
      expect(await purposeOf(root, { id: "cs-w", name: "waiting" })).toEqual({ purpose: "reconcile", declared: false });
      // Only the description codebase_extract wrote: its since, when it names one.
      expect(await purposeOf(root, { id: "cs-d", name: "d", description: MARKER })).toEqual({ purpose: "bootstrap", declared: false });
      expect(
        await purposeOf(root, {
          id: "cs-e",
          name: "e",
          description: "As-built extraction of the code at abc1234, files changed since release/1.2. Staged by codebase_extract.",
        })
      ).toEqual({ purpose: "reconcile", declared: false });
      expect(await purposeOf(root, { id: "cs-x", name: "x", origin: { kind: "extract" } })).toMatchObject({ purpose: "bootstrap" });
      expect(await purposeOf(root, { id: "cs-c", name: "c", origin: { kind: "chat" } })).toEqual({ purpose: "chat", declared: false });
      expect(await purposeOf(root, { id: "cs-p", name: "p", origin: { kind: "plan" } })).toEqual({ purpose: "plan", declared: false });
      expect(await purposeOf(root, { id: "cs-l", name: "l", origin: { kind: "cli" } })).toEqual({ purpose: "plan", declared: false });
      expect(await purposeOf(root, { id: "cs-n", name: "n" })).toEqual({ purpose: "plan", declared: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("declaring the purpose at creation", () => {
  it("creationPurpose: the waiting cards' run, chat for DrBot, else plan", async () => {
    const root = await tempDir("dr-creation-purpose");
    try {
      await writeRecord(root, "pending.json", {
        changesetId: "",
        changesetName: "extract-abc+worktree",
        gitHead: "abc",
        since: "HEAD",
        previousActive: { id: "cs-plan", name: "plan" },
        pending: true,
      });
      expect(await creationPurpose(root, "extract-abc+worktree", { kind: "plan" })).toEqual({
        purpose: "verification",
        verifies: "cs-plan",
        scope: { since: "HEAD", codeCommit: "abc" },
      });
      expect(await creationPurpose(root, "other", resolveOrigin("plan", { DR_CHANGESET_ORIGIN: "chat" }))).toEqual({ purpose: "chat" });
      expect(await creationPurpose(root, "other", resolveOrigin("cli", {}))).toEqual({ purpose: "plan" });
      expect(await creationPurpose(root, "other", undefined)).toEqual({ purpose: "plan" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("StagingAreaManager.create writes the purpose to metadata.yaml, and loading reads it back", async () => {
    const { rootPath, manager } = await newProject();
    try {
      const plan = await manager.create("plan", "A plan", resolveOrigin("cli", {}));
      const chat = await manager.create("chat", "DrBot's", resolveOrigin("plan", { DR_CHANGESET_ORIGIN: "chat" }));
      const record = await manager.create("plan-as-built", MARKER, { kind: "extract" }, extractionPurpose({ since: "main", gitHead: "abc", previousActive: { id: plan.id } }));
      expect(plan.purpose).toBe("plan");
      expect(chat.purpose).toBe("chat");

      const metadata = yaml.parse(await readFile(join(rootPath, "documentation-robotics", "changesets", record.id, "metadata.yaml"), "utf-8"));
      expect(metadata).toMatchObject({ purpose: "verification", verifies: plan.id, scope: { since: "main", codeCommit: "abc" }, origin: { kind: "extract" } });

      // Staging rewrites metadata.yaml; the declaration survives it.
      await manager.stage(record.id, {
        type: "add",
        elementId: "motivation.goal.kept",
        layerName: "motivation",
        timestamp: new Date().toISOString(),
        after: { type: "goal", name: "Kept", attributes: { priority: "high" } },
      });
      const loaded = (await manager.load(record.id))!;
      expect(loaded).toMatchObject({ purpose: "verification", verifies: plan.id, scope: { since: "main", codeCommit: "abc" } });
      expect(await manager.purposeOf(loaded)).toMatchObject({ purpose: "verification", declared: true });
      expect((await manager.load(chat.id))!.purpose).toBe("chat");

      // declarePurpose replaces it.
      await manager.declarePurpose(chat.id, { purpose: "reconcile" });
      expect((await manager.load(chat.id))!).toMatchObject({ purpose: "reconcile", verifies: undefined, scope: undefined });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

describe("which landings stamp reconciled", () => {
  it("only bootstrap and reconcile, declared or inferred", async () => {
    const root = await tempDir("dr-stamp-rule");
    try {
      const stamp = (subject: Parameters<typeof reconciliationStamp>[1]) => reconciliationStamp(root, subject, root, "2026-11-18T00:00:00.000Z");
      expect(await stamp({ id: "a", name: "a", purpose: "bootstrap" })).toMatchObject({ changeset: "a", changeset_id: "a" });
      expect(await stamp({ id: "b", name: "b", purpose: "reconcile" })).toMatchObject({ changeset_id: "b" });
      expect(await stamp({ id: "c", name: "c", purpose: "plan", description: MARKER })).toBeNull();
      expect(await stamp({ id: "d", name: "d", purpose: "chat" })).toBeNull();
      expect(await stamp({ id: "e", name: "e", purpose: "verification", verifies: "p", scope: { since: "main" } })).toBeNull();

      // Inferred, for changesets made before purposes were declared.
      await writeRecord(root, "f.json", { changesetId: "f", changesetName: "f", gitHead: "h", since: "main", previousActive: { id: "p", name: "p" } });
      await writeRecord(root, "g.json", { changesetId: "g", changesetName: "g", gitHead: "h", since: "main" });
      expect(await stamp({ id: "f", name: "f" })).toBeNull();
      expect(await stamp({ id: "g", name: "g" })).toMatchObject({ changeset_id: "g", code_commit: "h" });
      expect(await stamp({ id: "h", name: "h", origin: { kind: "plan" } })).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("StagingAreaManager.commit refuses a verification record", () => {
  it("with force or without, dry run included, naming the plan; the plan still lands", async () => {
    const { rootPath } = await newProject();
    try {
      clearModelCache();
      let model = await Model.load(rootPath, { lazyLoad: false });
      let manager = new StagingAreaManager(model.rootPath, model);
      const plan = await manager.create("add-goal", "Add a goal", resolveOrigin("plan", {}));
      await manager.setActive(plan.id);
      await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath });
      const record = await manager.create(
        "add-goal-as-built",
        MARKER,
        { kind: "extract" },
        extractionPurpose({ since: "main", gitHead: "abc", previousActive: { id: plan.id } })
      );
      await manager.setActive(record.id);
      clearModelCache();
      await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-refunds", attributes: { priority: "high" }, rootPath });
      await manager.clearActive();

      clearModelCache();
      model = await Model.load(rootPath, { lazyLoad: false });
      manager = new StagingAreaManager(model.rootPath, model);
      for (const options of [{}, { force: true }, { dryRun: true, force: true }]) {
        const error = await manager.commit(model, record.id, { validate: true, ...options }).catch((e) => e);
        expect(error).toBeInstanceOf(VerificationRecordLandingError);
        expect(error.message).toBe(
          "Changeset 'add-goal-as-built' is a verification record: the record of what was built, compared with plan " +
            "'add-goal'. A verification record is never landed."
        );
        expect(error.suggestions).toEqual([
          "Land the plan 'add-goal' instead",
          "Keep this record (it stays staged and is committed to git with the plan) or discard it",
          "To reconcile the model with code drift, extract without a plan active and land that changeset",
        ]);
        expect(error.plan).toEqual({ id: plan.id, name: "add-goal" });
      }
      expect((await manager.load(record.id))!.status).toBe("staged");
      expect(model.manifest.changeset_history ?? []).toEqual([]);

      const landed = await manager.commit(model, plan.id, { validate: true });
      expect(landed.committed).toBe(1);
      expect(landed.reconciled).toBeUndefined();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("names the plan from the extraction record when the declared plan is gone", async () => {
    const { rootPath, manager } = await newProject();
    try {
      const record = await manager.create("gone-as-built", MARKER, { kind: "extract" }, { purpose: "verification", verifies: "cs-gone", scope: { since: "main" } });
      await writeRecord(rootPath, `${record.id}.json`, {
        changesetId: record.id,
        changesetName: "gone-as-built",
        gitHead: "abc",
        since: "main",
        previousActive: { id: "cs-gone", name: "gone-plan" },
      });
      const refusal = await manager.landingRefusal((await manager.load(record.id))!);
      expect(refusal?.message).toContain("compared with plan 'gone-plan'");
      expect(await manager.landingRefusal((await manager.create("a-plan", "x"))!)).toBeNull();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
