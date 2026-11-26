/**
 * Plans staged in a project's other checkouts (#1368) and the branch beside every checkout (#1422):
 * changeset_create warns when a sibling's plan looks like the same work, project_status lists the
 * siblings' plans, both say so when the farm can't tell, and a landing names its branch.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";
import { changesetCreateHandler } from "../../../src/mcp/tools/changeset-lifecycle.js";
import { landsOnSentence } from "../../../src/mcp/tools/central-viewer.js";
import { projectStatus, projectStatusList } from "../../../src/mcp/tools/project-status.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { changesetCommitPreviewHandler } from "../../../src/mcp/tools/changeset-commit.js";
import { matchSiblingPlans } from "../../../src/core/sibling-plans.js";
import { withResultCheckout } from "../../../src/mcp/tool-registry.js";
import { jsonResult } from "../../../src/mcp/tools/shared.js";
import { centralFarm, fakeFind, git, type CentralFarm } from "./central-farm-fixture.js";

let farm: CentralFarm;

beforeEach(async () => {
  clearModelCache();
  farm = await centralFarm("Sibling Plans Model");
});

afterEach(async () => {
  clearModelCache();
  await farm.cleanup();
});

const created = (result: any) => JSON.parse(result.content[0].text);
const deps = () => ({ openRegistry: farm.openRegistry });

describe("changeset_create and sibling plans", () => {
  it("warns, without refusing, when another checkout has a plan for the same issue or a similar name", async () => {
    await farm.register();
    const other = await farm.addWorktree("other");
    const mine = await farm.addWorktree("mine");
    await changesetCreateHandler({ name: "scoped-checkout-routes", intent: "Scope the routes by checkout, issue #623.", rootPath: other });

    const result = created(await changesetCreateHandler({ name: "checkout-scoped-viewer", intent: "The viewer picks a checkout (#623).", rootPath: mine }));
    expect(result.name).toBe("checkout-scoped-viewer");
    expect(result.active).toBe(true);
    expect(result.siblingPlans).toHaveLength(1);
    expect(result.siblingPlans[0]).toMatchObject({ checkout: "other", branch: "branch-other", name: "scoped-checkout-routes" });
    expect(result.siblingWarning).toContain("scoped-checkout-routes");
    expect(result.siblingWarning).toContain("#623");
    expect(result.siblingWarning).toContain("nothing was refused");
  });

  it("lists a sibling's plan without a warning when nothing matches", async () => {
    await farm.register();
    const other = await farm.addWorktree("other");
    const mine = await farm.addWorktree("mine");
    await changesetCreateHandler({ name: "audit-export", intent: "Export the audit log.", rootPath: other });
    const result = created(await changesetCreateHandler({ name: "viewer-dark-mode", intent: "Dark theme.", rootPath: mine }));
    expect(result.siblingPlans.map((p: any) => p.name)).toEqual(["audit-export"]);
    expect(result).not.toHaveProperty("siblingWarning");
  });

  it("says so when the farm can't tell, instead of showing none", async () => {
    // Not registered: no project in the farm owns the folder.
    const result = created(await changesetCreateHandler({ name: "plain", rootPath: farm.project }));
    expect(result.siblingPlans).toMatchObject({ status: "unavailable" });
    expect(result.siblingPlans.reason).toContain("No project in the farm owns");
  });
});

describe("project_status sibling plans", () => {
  it("lists the staged plans in the other checkouts, paged, and leaves this checkout's own out", async () => {
    await farm.register();
    const a = await farm.addWorktree("feature-a");
    await changesetCreateHandler({ name: "plan-in-a", intent: "Plan A.", rootPath: a });
    await changesetCreateHandler({ name: "plan-in-main", rootPath: farm.project });
    const options = { central: { ...deps(), findRunningServer: fakeFind(null), cliVersion: "999.0.0" } };

    const s: any = await projectStatus({ rootPath: farm.project }, options);
    expect(s.checkout.siblingPlans).toHaveLength(1);
    expect(s.checkout.siblingPlans[0]).toMatchObject({ checkout: "feature-a", branch: "branch-feature-a", name: "plan-in-a", active: true });

    const page: any = await projectStatusList({ rootPath: farm.project, list: "siblingPlans" }, options);
    expect(JSON.stringify(page)).toContain("plan-in-a");
  });
});

describe("the branch beside the checkout (#1422)", () => {
  it("names the branch in a landing sentence, even for the main checkout on a feature branch", async () => {
    await farm.register();
    git(farm.project, "checkout", "-q", "-b", "dr/feature-branch");
    clearModelCache();
    expect(await landsOnSentence(farm.project, deps())).toBe("Lands on branch dr/feature-branch in checkout main (project project).");
    git(farm.project, "checkout", "-q", "--detach");
    expect(await landsOnSentence(farm.project, deps())).toContain("detached HEAD");
  });

  it("names the branch in changeset_commit_preview's summary and result", async () => {
    await farm.register();
    git(farm.project, "checkout", "-q", "-b", "dr/landing-branch");
    await changesetCreateHandler({ name: "land-me", rootPath: farm.project });
    await modelAddHandler({ layer: "motivation", type: "goal", name: "faster-checkout", attributes: { priority: "high" }, rootPath: farm.project });
    const preview = JSON.parse(((await changesetCommitPreviewHandler({ changeset: "land-me", rootPath: farm.project })) as any).content[0].text);
    expect(preview.status).toBe("ready-to-commit");
    expect(preview.landsOn).toBe("Lands on branch dr/landing-branch in checkout main (project project).");
    expect(preview.summary).toContain("Lands on branch dr/landing-branch in checkout main");
  });

  it("returns null for a folder the farm doesn't know", async () => {
    expect(await landsOnSentence(farm.project, deps())).toBeNull();
  });

  it("puts branch beside checkout in a result, unless the tool has its own branch field", () => {
    const named = withResultCheckout(jsonResult({ ok: true }), { project: "p", checkout: "main", branch: "feat" });
    expect(JSON.parse((named.content[0] as any).text)).toMatchObject({ project: "p", checkout: "main", branch: "feat", ok: true });
    expect((named._meta as any)["dr/checkout"]).toEqual({ project: "p", checkout: "main", branch: "feat" });

    const own = withResultCheckout(jsonResult({ branch: "tools-own" }), { project: "p", checkout: "main", branch: "feat" });
    expect(JSON.parse((own.content[0] as any).text).branch).toBe("tools-own");

    const detached = withResultCheckout(jsonResult({}), { project: "p", checkout: "main", branch: null });
    expect(JSON.parse((detached.content[0] as any).text)).toEqual({ project: "p", checkout: "main", branch: null });
  });
});

describe("matchSiblingPlans", () => {
  const plan = (name: string, description?: string) => ({ checkout: "x", branch: null, path: "/x", id: name, name, description, active: false });
  it("matches the same name, a similar name, a shared issue and a similar intent, and not unrelated plans", () => {
    const plans = [
      plan("add-order-export"),
      plan("export-order-add-csv"),
      plan("other", "fixes #77 properly"),
      plan("viewer-dark-mode", "Dark theme for the viewer panes and the toolbar and the menus"),
    ];
    const hit = (name: string, description?: string) => matchSiblingPlans({ name, description }, plans).map((m) => m.plan.name);
    expect(hit("add-order-export")).toContain("add-order-export");
    expect(hit("order-export-csv")).toContain("export-order-add-csv");
    expect(hit("something", "see issue #77")).toEqual(["other"]);
    expect(hit("themes", "Dark theme for the viewer panes and the toolbar and the menus too")).toEqual(["viewer-dark-mode"]);
    expect(hit("billing-reports", "Quarterly billing")).toEqual([]);
  });
});
