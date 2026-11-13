/**
 * Code drift is reconciled only by an as-built landing (issue #1094).
 *
 * The maintainer's decision: a bootstrap, or a keep-as-built changeset staged by codebase_extract,
 * reconciles the model with the code. Landing a plan, or any other commit to documentation-robotics/,
 * doesn't. These tests reproduce the validation-round-3 repro over real git repositories: drift
 * counted from an as-built landing survives a plan landing, an as-built landing resets it, and a
 * model with no as-built landing recorded keeps the earlier rule.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { clearModelCache } from "../../src/mcp/tools/shared.js";
import { resetGlobalOptions } from "../../src/utils/globals.js";
import { modelAddHandler } from "../../src/mcp/tools/model-add.js";
import { changesetCreateHandler, changesetDeactivateHandler } from "../../src/mcp/tools/changeset-lifecycle.js";
import { clearProjectStatusSignatures, projectStatusHandler, suggestNextStep } from "../../src/mcp/tools/project-status.js";
import { getCliBundledSpecVersion } from "../../src/utils/spec-version.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpToolRegistry } from "../../src/mcp/tool-registry.js";
import { VisualizationServer } from "../../src/server/server.js";
import { runDr } from "../helpers/cli-runner.js";

let rootPath: string;

function git(...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: rootPath, encoding: "utf-8" }
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function ok(result: any): Promise<any> {
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
}

async function status(): Promise<any> {
  clearModelCache();
  clearProjectStatusSignatures();
  return ok(await projectStatusHandler({ rootPath }));
}

async function writeCode(file: string, text: string): Promise<void> {
  await mkdir(join(rootPath, "src"), { recursive: true });
  await writeFile(join(rootPath, file), text);
}

async function commitCode(file: string, text: string, message: string): Promise<string> {
  await writeCode(file, text);
  git("add", "-A", "--", "src");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

/** Commit documentation-robotics/ (the landed model), as the human does in the PR. */
function commitModel(message: string): string {
  git("add", "-A", "--", "documentation-robotics");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

/** Land a staged changeset the way changeset_commit, the viewer's Apply and the CLI all do. */
async function land(changesetId: string) {
  clearModelCache();
  const model = await Model.load(rootPath, { lazyLoad: false });
  const result = await new StagingAreaManager(model.rootPath, model).commit(model, changesetId, { validate: true });
  clearModelCache();
  return result;
}

/** A plan: a changeset the agent staged by hand, describing code before it exists. */
async function stagePlan(name: string, element: string): Promise<string> {
  clearModelCache();
  const created = await ok(await changesetCreateHandler({ name, description: `Plan: add ${element}.`, rootPath }));
  await ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: element,
      attributes: { serviceType: "synchronous" },
      rootPath,
    })
  );
  await ok(await changesetDeactivateHandler({ rootPath }));
  return created.id;
}

/**
 * An as-built changeset as codebase_extract leaves it: its description and its record under
 * .dr/analyzers/extract/ (the record is what marks a changeset as extraction's).
 */
async function stageAsBuilt(name: string, element: string, sourceFile: string): Promise<string> {
  clearModelCache();
  const head = git("rev-parse", "HEAD");
  const created = await ok(
    await changesetCreateHandler({
      name,
      description: `As-built extraction of the code at ${head.slice(0, 7)}. Staged by codebase_extract.`,
      rootPath,
    })
  );
  const dir = join(rootPath, ".dr", "analyzers", "extract");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${created.id.replace(/[^\w.-]/g, "_")}.json`),
    JSON.stringify({ changesetId: created.id, changesetName: name, gitHead: head, since: null, layers: null, createdAt: "", cards: [], staged: [] })
  );
  await ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: element,
      attributes: { serviceType: "synchronous" },
      sourceFile,
      sourceSymbol: element,
      sourceProvenance: "extracted",
      rootPath,
    })
  );
  await ok(await changesetDeactivateHandler({ rootPath }));
  return created.id;
}

/**
 * A bootstrap as the agent stages it after a codebase_extract run that staged nothing: the run left
 * its cards in pending.json under a name, and the agent created that changeset (with its own
 * description, no marker) and staged the cards into it. Nothing but pending.json ties it to
 * extraction until a later run adopts it.
 */
async function stageBootstrapFromWaitingCards(name: string, element: string, sourceFile: string): Promise<string> {
  clearModelCache();
  const head = git("rev-parse", "HEAD");
  const dir = join(rootPath, ".dr", "analyzers", "extract");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "pending.json"),
    JSON.stringify({ changesetId: "", changesetName: name, gitHead: head, since: null, layers: null, createdAt: "", cards: [], staged: [], pending: true })
  );
  const created = await ok(await changesetCreateHandler({ name, description: "Bootstrap the model from the code.", rootPath }));
  await ok(
    await modelAddHandler({
      layer: "application",
      type: "applicationservice",
      name: element,
      attributes: { serviceType: "synchronous" },
      sourceFile,
      sourceSymbol: element,
      sourceProvenance: "extracted",
      rootPath,
    })
  );
  await ok(await changesetDeactivateHandler({ rootPath }));
  return created.id;
}

async function manifest(): Promise<any> {
  return parseYaml(await readFile(join(rootPath, "documentation-robotics", "model", "manifest.yaml"), "utf-8"));
}

beforeEach(async () => {

  resetGlobalOptions(); // a --codebase-path from another file would hide this repo
  clearModelCache();
  clearProjectStatusSignatures();
  rootPath = await realpath(
    await (async () => {
      const dir = join(tmpdir(), `dr-drift-reconcile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(dir, { recursive: true });
      return dir;
    })()
  );
  git("init", "-q");
  // .dr/ is local state, never committed.
  await writeFile(join(rootPath, ".gitignore"), ".dr/\n");
  await Model.init(rootPath, { name: "Drift Reconciliation", version: "0.1.0", specVersion: getCliBundledSpecVersion() });
  await writeCode("src/checkout.ts", "export const checkout = 1;\n");
  await writeCode("src/billing.ts", "export const billing = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "empty model and code");
});

afterEach(async () => {
  clearModelCache();
  await rm(rootPath, { recursive: true, force: true });
});

describe("code drift is reconciled only by an as-built landing (#1094)", () => {
  it("an as-built landing stamps the manifest and resets drift; a plan landing leaves it unchanged", async () => {
    // Bootstrap: an as-built changeset from codebase_extract, landed and committed.
    const bootstrap = await stageAsBuilt("extract-bootstrap", "checkout", "src/checkout.ts");
    const landed = await land(bootstrap);
    expect(landed.reconciled).toMatchObject({ changeset: "extract-bootstrap", changeset_id: bootstrap });
    expect(landed.reconciled!.code_commit).toBe(git("rev-parse", "HEAD"));
    expect((await manifest()).reconciled).toMatchObject({ changeset: "extract-bootstrap", changeset_id: bootstrap });
    const bootstrapSha = commitModel("bootstrap the model from the code");

    let data = await status();
    expect(data.codeDrift).toMatchObject({
      status: "in-step",
      basis: "last-reconciling-commit",
      modelCommit: { sha: bootstrapSha },
      reconciledBy: { changeset: "extract-bootstrap", changesetId: bootstrap },
      commitsSince: 0,
    });
    expect(data.nextStep.summary).not.toContain("drift");

    // The code moves on.
    await commitCode("src/checkout.ts", "export const checkout = 2;\n", "change checkout");
    await commitCode("src/billing.ts", "export const billing = 2;\n", "change billing");
    data = await status();
    expect(data.codeDrift).toMatchObject({ status: "drift", basis: "last-reconciling-commit", commitsSince: 2 });
    expect(data.codeDrift.modelCommit.sha).toBe(bootstrapSha);

    // The repro: land a plan and commit documentation-robotics/. Drift is unchanged.
    const plan = await stagePlan("add-refunds", "refunds");
    const planLanded = await land(plan);
    expect(planLanded.reconciled).toBeUndefined();
    // The plan's landing keeps the stamp of the last as-built landing.
    expect((await manifest()).reconciled).toMatchObject({ changeset_id: bootstrap });
    const planSha = commitModel("land the add-refunds plan");

    data = await status();
    expect(data.codeDrift.status).toBe("drift");
    expect(data.codeDrift.basis).toBe("last-reconciling-commit");
    expect(data.codeDrift.modelCommit.sha).toBe(bootstrapSha);
    expect(data.codeDrift.commitsSince).toBe(3);
    expect(data.codeDrift.changedSourceFiles.map((f: any) => f.file)).toEqual(["src/checkout.ts"]);
    expect(data.codeDrift.lastModelCommit.sha).toBe(planSha);
    expect(data.codeDrift.note).toContain("don't reconcile the model with the code");
    expect(data.nextStep.summary).toContain('as-built landing "extract-bootstrap"');
    expect(data.nextStep.summary).toContain("Landed plans don't reconcile it");
    expect(data.nextStep.summary).not.toContain("in step");

    // A keep-as-built catch-up (codebase_extract since the reconciled commit) resets it.
    const catchUp = await stageAsBuilt("extract-catch-up", "checkout-v2", "src/checkout.ts");
    const caught = await land(catchUp);
    expect(caught.reconciled).toMatchObject({ changeset: "extract-catch-up", changeset_id: catchUp });

    // Landed but not committed yet: drift still counts from the bootstrap, and says so.
    data = await status();
    expect(data.codeDrift.modelCommit.sha).toBe(bootstrapSha);
    expect(data.codeDrift.uncommittedReconciliation).toMatchObject({ changeset: "extract-catch-up", changesetId: catchUp });
    expect(data.codeDrift.note).toContain('"extract-catch-up" isn\'t committed yet');

    const catchUpSha = commitModel("catch the model up with the code");
    data = await status();
    expect(data.codeDrift).toMatchObject({
      status: "in-step",
      basis: "last-reconciling-commit",
      modelCommit: { sha: catchUpSha },
      reconciledBy: { changeset: "extract-catch-up", changesetId: catchUp },
      commitsSince: 0,
    });
    expect(data.codeDrift.uncommittedReconciliation).toBeUndefined();
    expect(data.codeDrift.lastModelCommit).toBeUndefined();
  }, 240_000);

  it("finds the reconciling commit after the history is rewritten (a squash merge keeps the stamp)", async () => {
    git("checkout", "-q", "-b", "feature");
    const bootstrap = await stageAsBuilt("extract-bootstrap", "checkout", "src/checkout.ts");
    await land(bootstrap);
    commitModel("bootstrap");
    await commitCode("src/billing.ts", "export const billing = 3;\n", "more code");
    git("checkout", "-q", "-");
    git("merge", "-q", "--squash", "feature");
    git("commit", "-q", "-m", "squash feature");
    const squashSha = git("rev-parse", "HEAD");

    const data = await status();
    expect(data.codeDrift.basis).toBe("last-reconciling-commit");
    expect(data.codeDrift.modelCommit.sha).toBe(squashSha);
    expect(data.codeDrift.status).toBe("in-step");
  }, 120_000);

  it("falls back to the last non-migration model commit for a model with no as-built landing (legacy)", async () => {
    // A model grown by hand in the base, never by an as-built landing: no stamp.
    clearModelCache();
    await ok(
      await modelAddHandler({
        layer: "application",
        type: "applicationservice",
        name: "checkout",
        attributes: { serviceType: "synchronous" },
        sourceFile: "src/checkout.ts",
        sourceProvenance: "manual",
        rootPath,
      })
    );
    const modelSha = commitModel("model checkout");
    await commitCode("src/checkout.ts", "export const checkout = 2;\n", "change checkout");

    let data = await status();
    expect((await manifest()).reconciled).toBeUndefined();
    expect(data.codeDrift).toMatchObject({ status: "drift", basis: "last-non-migration-commit", modelCommit: { sha: modelSha } });
    expect(data.codeDrift.reconciledBy).toBeUndefined();
    expect(data.nextStep.summary).toContain("no as-built landing is recorded yet");

    // Today's rule still applies to such a model: a plan landing resets it.
    const plan = await stagePlan("add-refunds", "refunds");
    await land(plan);
    const planSha = commitModel("land the add-refunds plan");
    data = await status();
    expect(data.codeDrift).toMatchObject({ status: "in-step", basis: "last-non-migration-commit", modelCommit: { sha: planSha } });
  }, 180_000);
});

describe("a bootstrap codebase_extract staged is stamped on every landing path", () => {
  /** changeset_commit, through a client that shows the confirmation dialog and accepts it. */
  async function landWithMcp(name: string): Promise<any> {
    clearModelCache();
    const server = new McpServer({ name: "dr-test", version: "0.0.0" });
    new McpToolRegistry().registerAll(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { confirm: true } }));
    await client.connect(clientTransport);
    try {
      return await ok(await client.callTool({ name: "changeset_commit", arguments: { changeset: name, rootPath } }));
    } finally {
      await client.close();
      clearModelCache();
    }
  }

  /** The viewer's Apply: POST /api/changesets/:id/commit. */
  async function landWithViewer(id: string): Promise<void> {
    clearModelCache();
    const model = await Model.load(rootPath, { lazyLoad: false });
    const server = new VisualizationServer(model, { authEnabled: false });
    const response: Response = await (server as any).app.request(`/api/changesets/${id}/commit`, { method: "POST" });
    expect(response.status).toBe(200);
    clearModelCache();
  }

  it("changeset_commit stamps it, linked to extraction by its record or by the waiting cards", async () => {
    const recorded = await stageAsBuilt("extract-bootstrap", "checkout", "src/checkout.ts");
    const landed = await landWithMcp("extract-bootstrap");
    expect(landed.reconciled).toMatchObject({ changeset: "extract-bootstrap", changeset_id: recorded });
    expect((await manifest()).reconciled).toMatchObject({ changeset_id: recorded });

    const waiting = await stageBootstrapFromWaitingCards("extract-billing", "billing", "src/billing.ts");
    const second = await landWithMcp("extract-billing");
    expect(second.reconciled).toMatchObject({ changeset: "extract-billing", changeset_id: waiting });
    expect((await manifest()).reconciled).toMatchObject({ changeset_id: waiting });
  }, 120_000);

  it("dr changeset commit stamps it", async () => {
    const id = await stageBootstrapFromWaitingCards("extract-bootstrap", "checkout", "src/checkout.ts");
    const result = await runDr(["changeset", "commit", "extract-bootstrap", "--force"], { cwd: rootPath });
    expect(result.exitCode).toBe(0);
    expect((await manifest()).reconciled).toMatchObject({ changeset: "extract-bootstrap", changeset_id: id });
  }, 120_000);

  it("the viewer's Apply stamps it", async () => {
    const id = await stageAsBuilt("extract-bootstrap", "checkout", "src/checkout.ts");
    await landWithViewer(id);
    expect((await manifest()).reconciled).toMatchObject({ changeset: "extract-bootstrap", changeset_id: id });
  }, 120_000);

  it("project_status says when extracted elements have no as-built landing recorded, and how to get one", async () => {
    // Bootstrapped by hand: extracted elements written straight into the base, never landed as-built.
    clearModelCache();
    await ok(
      await modelAddHandler({
        layer: "application",
        type: "applicationservice",
        name: "checkout",
        attributes: { serviceType: "synchronous" },
        sourceFile: "src/checkout.ts",
        sourceSymbol: "checkout",
        sourceProvenance: "extracted",
        rootPath,
      })
    );
    commitModel("model checkout by hand");
    const data = await status();
    expect(data.codeDrift).toMatchObject({ basis: "last-non-migration-commit" });
    expect(data.codeDrift.note).toContain("No as-built landing is recorded, though 1 element(s) came from extraction");
    expect(data.codeDrift.note).toContain("run codebase_extract (no since) and land the changeset it stages");

    // Once an as-built landing is recorded, the note goes.
    const catchUp = await stageAsBuilt("extract-catch-up", "billing", "src/billing.ts");
    await land(catchUp);
    commitModel("land the as-built catch-up");
    const after = await status();
    expect(after.codeDrift.basis).toBe("last-reconciling-commit");
    expect(after.codeDrift.note ?? "").not.toContain("No as-built landing is recorded");
  }, 120_000);
});

describe("project_status wording for a reconciled model (#1094)", () => {
  const sections = (codeDrift: Record<string, unknown>) =>
    ({
      model: { status: "present", path: "/p/documentation-robotics/model" },
      spec: { status: "current", model: "0.12.0", cli: "0.12.0", upgradeNeeded: false },
      changesets: { status: "ok", active: null, staged: [], committed: 0, discarded: 0 },
      codeIndex: { status: "fresh", analyzer: "cbm" },
      codeDrift,
      indexing: { status: "none" },
      viewer: { status: "none" },
    }) as any;

  it("names the as-built landing the model is in step with", () => {
    const step = suggestNextStep(
      sections({
        status: "in-step",
        basis: "last-reconciling-commit",
        modelCommit: { sha: "abcdef1234567", date: "", subject: "bootstrap" },
        reconciledBy: { changeset: "extract-abcdef1", changesetId: "c1", landedAt: "" },
      }),
      { root: "/p" }
    );
    expect(step.tool).toBe("changeset_create");
    expect(step.summary).toContain('since the as-built landing "extract-abcdef1" (abcdef1)');
  });

  it("says when no as-built landing is recorded", () => {
    const step = suggestNextStep(
      sections({ status: "in-step", basis: "last-non-migration-commit", modelCommit: { sha: "abcdef1234567", date: "", subject: "x" } }),
      { root: "/p" }
    );
    expect(step.summary).toContain("no as-built landing is recorded yet");
  });
});
