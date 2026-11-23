/**
 * GET /api/changesets/:id/verification: a plan compared with an as-built changeset, the same report
 * changeset_verify gives. Runs the server's Hono app in-process against a copy of the golden model;
 * both changesets are staged through the real CLI.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { StagingAreaManager } from "../../src/core/staging-area.js";
import { VisualizationServer } from "../../src/server/server.js";
import { ChangesetVerificationSchema } from "../../src/server/schemas.js";

const OTHER = "application.applicationcomponent.other-comp";
const NEW = "application.applicationcomponent.new-comp";
const MISSED = "application.applicationcomponent.missed-comp";
const EXTRA = "application.applicationcomponent.extra-comp";

describe("changeset verification API", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let server: VisualizationServer | undefined;

  beforeEach(async () => {
    const workdir = await createTestWorkdir();
    dir = workdir.path;
    cleanup = workdir.cleanup;
  });

  afterEach(async () => {
    server?.stop();
    server = undefined;
    await cleanup().catch(() => {});
  });

  async function dr(args: string[]): Promise<void> {
    const result = await runDr(args, { cwd: dir });
    expect(result.exitCode).toBe(0);
  }

  const component = (name: string) => [
    "add", "application", "component", name, "--description", "x", "--attributes", '{"type":"internal"}',
  ];

  async function activeId(): Promise<string> {
    const model = await Model.load(dir, { lazyLoad: false });
    return (await new StagingAreaManager(dir, model).getActiveId())!;
  }

  /**
   * Base: Other Comp. Plan: add New Comp (uses Other Comp) and Missed Comp. As built: New Comp (uses
   * Other Comp) and Extra Comp, which the plan doesn't name.
   */
  async function seed(): Promise<{ plan: string; built: string }> {
    await dr(component("Other Comp"));
    await dr(["changeset", "create", "the-plan"]);
    await dr(component("New Comp"));
    await dr(component("Missed Comp"));
    await dr(["relationship", "add", NEW, OTHER, "--predicate", "uses"]);
    const plan = await activeId();
    await dr(["changeset", "deactivate"]);
    await dr(["changeset", "create", "the-plan-as-built"]);
    await dr(component("New Comp"));
    await dr(component("Extra Comp"));
    await dr(["relationship", "add", NEW, OTHER, "--predicate", "uses"]);
    const built = await activeId();
    await dr(["changeset", "deactivate"]);
    return { plan, built };
  }

  async function request(path: string): Promise<Response> {
    const model = await Model.load(dir, { lazyLoad: false });
    server = new VisualizationServer(model, { authEnabled: false });
    return (server as any).app.request(path) as Promise<Response>;
  }

  it("returns changeset_verify's report: matched, missing and unplanned, by element id", async () => {
    const { plan, built } = await seed();
    const response = await request(`/api/changesets/${plan}/verification?against=${built}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ChangesetVerificationSchema.safeParse(body).success).toBe(true);

    expect(body.plannedChangeset).toEqual({ id: plan, name: "the-plan" });
    expect(body.asBuiltChangeset).toEqual({ id: built, name: "the-plan-as-built" });
    expect(body.elements.matched.map((m: { planned: string }) => m.planned)).toContain(NEW);
    expect(body.elements.missing.map((m: { planned: string }) => m.planned)).toContain(MISSED);
    expect(body.elements.unplanned.map((u: { id: string }) => u.id)).toContain(EXTRA);
    expect(body.relationships.matched).toContainEqual(
      expect.objectContaining({ planned: { source: NEW, predicate: "uses", target: OTHER } })
    );
    expect(body.summary.elements.planned).toBe(2);
    expect(typeof body.verdictText).toBe("string");
  });

  it("answers 404 for an unknown plan or as-built changeset, and 400 when against is missing or the plan itself", async () => {
    const { plan, built } = await seed();
    expect((await request(`/api/changesets/no-such-changeset/verification?against=${built}`)).status).toBe(404);
    expect((await request(`/api/changesets/${plan}/verification?against=no-such-changeset`)).status).toBe(404);
    expect((await request(`/api/changesets/${plan}/verification`)).status).toBe(400);
    expect((await request(`/api/changesets/${plan}/verification?against=${plan}`)).status).toBe(400);
  });
});
