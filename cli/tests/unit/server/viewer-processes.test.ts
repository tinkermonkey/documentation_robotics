/**
 * Finding `dr visualize` processes in the process table, without the registry (#1237): what
 * `dr visualize --list` uses to show viewers whose record was lost.
 */

import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findViewerProcesses,
  isLauncherCommand,
  isServerCommand,
  listProcesses,
  looksLikeViewer,
  parsePs,
  processCwd,
  projectRootFromCwd,
} from "../../../src/server/viewer-processes.js";

const NODE = "/Users/me/.nvm/versions/node/v24.3.0/bin/node";
const DIST = "/Users/me/.nvm/versions/node/v24.3.0/lib/node_modules/@documentation-robotics/cli/dist";

// As `ps -A -ww -o pid=,ppid=,lstart=,args=` prints it (C locale).
const PS_OUTPUT = `
    1     0 Mon Nov 16 08:00:01 2026     /sbin/launchd
46531     1 Fri Nov 20 09:16:49 2026     ${NODE} ${DIST}/cli.js visualize --with-changesets --no-browser
46533 46531 Fri Nov 20 09:16:49 2026     ${NODE} ${DIST}/server-entry.js
75855 65473 Fri Nov 20 10:41:03 2026     ${NODE} ${DIST}/cli.js visualize --no-auth --port 8099
75857 75855 Fri Nov 20 10:41:03 2026     ${NODE} ${DIST}/server-entry.js
80001     1 Thu Nov 19 14:02:10 2026     ${NODE} ${DIST}/server-entry.js
80100 65473 Fri Nov 20 11:00:00 2026     ${NODE} ${DIST}/cli.js visualize --list
80200 65473 Fri Nov 20 11:00:00 2026     ${NODE} /srv/other-tool/cli.js visualize
80300 65473 Fri Nov 20 11:00:00 2026     vim visualize.ts
80400 80399 Fri Nov 20 11:00:00 2026     bun /repo/cli/dist/server-entry.js
`;

describe("parsePs", () => {
  it("reads pid, parent, start time and the whole command line", () => {
    const processes = parsePs(PS_OUTPUT);
    expect(processes).toHaveLength(10);
    const launcher = processes.find((info) => info.pid === 46531)!;
    expect(launcher.ppid).toBe(1);
    expect(launcher.command).toBe(`${NODE} ${DIST}/cli.js visualize --with-changesets --no-browser`);
    expect(new Date(launcher.startedAt).getTime()).toBe(new Date("Fri Nov 20 09:16:49 2026").getTime());
  });

  it("skips lines it cannot read", () => {
    expect(parsePs("garbage\n\n  12 nope")).toEqual([]);
  });
});

describe("isLauncherCommand / isServerCommand", () => {
  it("recognises the launcher however the CLI was started", () => {
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js visualize --with-changesets --no-browser`)).toBe(true);
    expect(isLauncherCommand("node /opt/homebrew/bin/dr visualize")).toBe(true);
    expect(isLauncherCommand("dr visualize --port 3000")).toBe(true);
    expect(isLauncherCommand("bun run src/cli.ts --debug visualize --no-auth")).toBe(true);
    expect(isLauncherCommand("node /Users/me/Application Support/dr/dist/cli.js visualize")).toBe(true);
  });

  it("does not take --list, --stop or other commands for a viewer", () => {
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js visualize --list`)).toBe(false);
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js visualize --stop --all`)).toBe(false);
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js validate`)).toBe(false);
    expect(isLauncherCommand("vim visualize.ts")).toBe(false);
    expect(isLauncherCommand("node /srv/app/address.js visualize")).toBe(false);
  });

  it("recognises the server the launcher runs", () => {
    expect(isServerCommand(`${NODE} ${DIST}/server-entry.js`)).toBe(true);
    expect(isServerCommand(`${NODE} ${DIST}/cli.js visualize`)).toBe(false);
    expect(isServerCommand("node /srv/app/src/server-entry.js")).toBe(false);
  });
});

describe("findViewerProcesses", () => {
  const viewers = findViewerProcesses(parsePs(PS_OUTPUT), new Set(), 99999);

  it("pairs each launcher with its server", () => {
    expect(viewers.filter((viewer) => viewer.launcherPid !== null).map((v) => [v.launcherPid, v.serverPid])).toEqual([
      [46531, 46533],
      [75855, 75857],
    ]);
  });

  it("finds a server whose launcher is gone", () => {
    expect(viewers.filter((viewer) => viewer.launcherPid === null).map((viewer) => viewer.serverPid)).toEqual([80001]);
  });

  it("leaves out --list runs, other programs' `cli.js visualize`, and servers something else runs", () => {
    const pids = viewers.flatMap((viewer) => [viewer.launcherPid, viewer.serverPid]);
    for (const pid of [80100, 80200, 80300, 80400]) expect(pids).not.toContain(pid);
  });

  it("includes a launcher the registry knows even before it has a server", () => {
    const table = parsePs(`90001 1 Fri Nov 20 11:00:00 2026 ${NODE} ${DIST}/cli.js visualize --no-browser`);
    expect(findViewerProcesses(table, new Set(), 99999)).toEqual([]);
    expect(findViewerProcesses(table, new Set([90001]), 99999)).toMatchObject([{ launcherPid: 90001, serverPid: null }]);
  });

  it("never lists the process doing the looking", () => {
    expect(findViewerProcesses(parsePs(PS_OUTPUT), new Set(), 46531).map((viewer) => viewer.launcherPid)).not.toContain(46531);
  });
});

describe("the real process table", () => {
  it.skipIf(process.platform === "win32")("lists this process, and reads a process's working directory", async () => {
    const table = listProcesses();
    expect(table).not.toBeNull();
    expect(table!.some((info) => info.pid === process.pid)).toBe(true);

    const dir = await realpath(tmpdir());
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: dir, stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await realpath(processCwd(child.pid!)!)).toBe(dir);
      // Alive, and not a viewer: a recorded pid that went to another program.
      expect(looksLikeViewer(child.pid!)).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("cannot say what a pid that does not exist is", () => {
    expect(looksLikeViewer(2 ** 30)).toBeNull();
  });
});

describe("projectRootFromCwd", () => {
  it("is the nearest folder up that holds documentation-robotics/, else the folder itself", async () => {
    const scratch = join(tmpdir(), `dr-viewer-processes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      await mkdir(join(scratch, "project", "documentation-robotics", "model"), { recursive: true });
      await mkdir(join(scratch, "project", "cli", "src"), { recursive: true });
      await mkdir(join(scratch, "plain"), { recursive: true });
      expect(projectRootFromCwd(join(scratch, "project", "cli", "src"))).toBe(join(scratch, "project"));
      expect(projectRootFromCwd(join(scratch, "project"))).toBe(join(scratch, "project"));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
