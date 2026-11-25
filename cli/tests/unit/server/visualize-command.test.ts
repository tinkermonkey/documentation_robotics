/**
 * `dr visualize [path]` on the central process (issue 1279, slice 4A): it resolves (or registers)
 * the checkout, ensures the central process with its start-only options, and opens the link. The
 * registry, ensureCentralServer and the browser are injected: nothing here starts a process.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedCheckout, ServerRecord } from "../../../src/core/checkout-types.js";
import type { ProjectRegistry } from "../../../src/core/project-registry.js";
import type { EnsureCentralServerOptions, EnsuredCentralServer } from "../../../src/server/central-mcp-contract.js";
import { refusedVisualizeOptions, startOnlyFlags, visualizeCommand, type VisualizeDeps } from "../../../src/commands/visualize.js";

const scratch = mkdtempSync(join(tmpdir(), "dr-visualize-command-"));
mkdirSync(join(scratch, "sub"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const record: ServerRecord = {
  farmRoot: "/farm",
  pid: 4242,
  port: 8090,
  cliVersion: "0.7.1",
  startedAt: "2026-11-24T09:00:00.000Z",
  tokenPath: "/state/servers/x.token",
};

function resolvedFor(project: string, checkout: string): ResolvedCheckout {
  return { ref: { project, checkout }, modelPath: "/m" } as unknown as ResolvedCheckout;
}

/** A fake world: a registry that knows `known`, registers anything else, and an ensure that may start. */
function world(options: { known?: boolean; started?: boolean; hasModel?: boolean; notice?: string } = {}) {
  const out: string[] = [];
  const opened: string[] = [];
  const ensured: EnsureCentralServerOptions[] = [];
  const registered: string[] = [];
  const registry = {
    resolvePath: async () => (options.known === false ? null : resolvedFor("alpha", "main")),
    resolveOrRegister: async (target: string) => {
      registered.push(target);
      return resolvedFor("gamma", "main");
    },
  } as unknown as ProjectRegistry;
  const deps: Partial<VisualizeDeps> = {
    cwd: scratch,
    env: { DR_STATE_DIR: join(scratch, "state") },
    openRegistry: async () => registry,
    findProjectRoot: async (path) => (options.hasModel === false ? null : path),
    ensure: async (opts): Promise<EnsuredCentralServer> => {
      ensured.push(opts ?? {});
      return { record, token: "tok", started: options.started ?? false, ...(options.notice ? { notice: options.notice } : {}) };
    },
    openBrowser: (url) => void opened.push(url),
    out: (line) => void out.push(line),
  };
  return { deps, out, opened, ensured, registered };
}

describe("dr visualize [path]", () => {
  it("opens the browser at the checkout's link on the central process", async () => {
    const w = world();
    await visualizeCommand({ json: false }, w.deps);
    expect(w.opened).toEqual(["http://127.0.0.1:8090/#/p/alpha/c/main/?token=tok"]);
    expect(w.ensured[0]).toMatchObject({ cwd: scratch, start: {} });
    expect(w.out.join("\n")).toContain("alpha / main: http://127.0.0.1:8090/#/p/alpha/c/main/?token=tok");
  });

  it("prints the link and opens nothing with --no-browser", async () => {
    const w = world();
    await visualizeCommand({ noBrowser: true, json: false }, w.deps);
    expect(w.opened).toEqual([]);
    expect(w.out.join("\n")).toContain("#/p/alpha/c/main/");
  });

  it("registers a folder with a model that no project owns, as dr farm add does", async () => {
    const w = world({ known: false });
    await visualizeCommand({ path: "sub", noBrowser: true, json: false }, w.deps);
    expect(w.registered).toEqual([join(scratch, "sub")]);
    expect(w.out.join("\n")).toContain("gamma / main");
  });

  it("refuses a folder with no model instead of registering it", async () => {
    const w = world({ known: false, hasModel: false });
    await expect(visualizeCommand({ noBrowser: true, json: false }, w.deps)).rejects.toThrow("No DR model at");
    expect(w.registered).toEqual([]);
    expect(w.ensured).toEqual([]);
  });

  it("passes the start-only options to the process it starts", async () => {
    const w = world({ started: true });
    await visualizeCommand(
      { port: "9000", viewerPath: "viewer", readOnly: true, withDanger: false, noBrowser: true, json: false },
      w.deps
    );
    expect(w.ensured[0].start).toEqual({ port: 9000, viewerPath: join(scratch, "viewer"), readOnly: true });
    expect(w.out.join("\n")).toContain("Started the DR process (pid 4242, port 8090)");
    expect(w.out.join("\n")).not.toContain("Not applied");
  });

  it("says which start-only options were not applied when the process was already running", async () => {
    const w = world({ started: false });
    await visualizeCommand({ port: "9000", readOnly: true, noBrowser: true, json: false }, w.deps);
    expect(w.out.join("\n")).toContain("Not applied (the DR process was already running): --port, --read-only.");

    const j = world({ started: false, notice: "older and in use" });
    await visualizeCommand({ withDanger: true, noBrowser: true, json: true }, j.deps);
    expect(JSON.parse(j.out.join("\n"))).toMatchObject({
      url: "http://127.0.0.1:8090/#/p/alpha/c/main/?token=tok",
      project: "alpha",
      checkout: "main",
      started: false,
      notApplied: ["--with-danger"],
      notice: "older and in use",
    });
  });

  it("refuses --no-auth and --token (every route requires the token), and starts nothing", async () => {
    const w = world();
    await expect(visualizeCommand({ noAuth: true, token: "x", json: false }, w.deps)).rejects.toThrow(
      /no longer takes these options:[\s\S]*--no-auth[\s\S]*--token/
    );
    expect(w.ensured).toEqual([]);
    expect(refusedVisualizeOptions({ idleExit: "1", exitWithParent: true })).toHaveLength(2);
  });

  it("rejects a bad port before anything starts", async () => {
    const w = world();
    await expect(visualizeCommand({ port: "80x", json: false }, w.deps)).rejects.toThrow("Invalid port number");
    expect(w.ensured).toEqual([]);
  });

  it("names the start-only flags given", () => {
    expect(startOnlyFlags({ port: 1, viewerPath: "v", withDanger: true, readOnly: true, withChangesets: true })).toEqual([
      "--port",
      "--viewer-path",
      "--with-danger",
      "--read-only",
      "--with-changesets",
    ]);
    expect(startOnlyFlags({ noBrowser: true })).toEqual([]);
  });
});
