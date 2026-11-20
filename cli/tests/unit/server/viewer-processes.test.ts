/**
 * Finding `dr visualize` processes in the process table, without the registry (#1237): what
 * `dr visualize --list` uses to show viewers whose record was lost, and what decides which
 * processes `--stop` may signal. A server counts only when its script is the dr CLI's.
 */

import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DR_CLI_PACKAGE,
  findViewerProcesses,
  hasVisualizeArgument,
  isDrServerScript,
  isLauncherCommand,
  isServerCommand,
  listProcesses,
  looksLikeViewer,
  parsePs,
  processCwd,
  processScanDisabled,
  projectRootFromCwd,
  scanViewerProcesses,
  serverScriptCandidates,
} from "../../../src/server/viewer-processes.js";

const NODE = "/Users/me/.nvm/versions/node/v24.3.0/bin/node";
const DIST = "/Users/me/.nvm/versions/node/v24.3.0/lib/node_modules/@documentation-robotics/cli/dist";

// As `ps -A -ww -o pid=,ppid=,uid=,lstart=,args=` prints it (C locale).
const PS_OUTPUT = `
    1     0     0 Mon Nov 16 08:00:01 2026     /sbin/launchd
46531     1   501 Fri Nov 20 09:16:49 2026     ${NODE} ${DIST}/cli.js visualize --with-changesets --no-browser
46533 46531   501 Fri Nov 20 09:16:49 2026     ${NODE} ${DIST}/server-entry.js
75855 65473   501 Fri Nov 20 10:41:03 2026     ${NODE} ${DIST}/cli.js --codebase-path /repo visualize --no-auth --port 8099
75857 75855   501 Fri Nov 20 10:41:03 2026     ${NODE} ${DIST}/server-entry.js
80001     1   501 Thu Nov 19 14:02:10 2026     ${NODE} ${DIST}/server-entry.js
80050   900   501 Thu Nov 19 14:02:10 2026     ${NODE} ${DIST}/server-entry.js
  900     1   501 Mon Nov 16 08:00:05 2026     /usr/lib/systemd/systemd --user
80100 65473   501 Fri Nov 20 11:00:00 2026     ${NODE} ${DIST}/cli.js visualize --list
80200 65473   501 Fri Nov 20 11:00:00 2026     ${NODE} /srv/other-tool/cli.js visualize
80300 65473   501 Fri Nov 20 11:00:00 2026     vim visualize.ts
80400     1   501 Fri Nov 20 11:00:00 2026     node /srv/shop/dist/server-entry.js
80500     1   501 Fri Nov 20 11:00:00 2026     node /srv/unknown/dist/server-entry.js
90001     1   777 Fri Nov 20 11:00:00 2026     ${NODE} ${DIST}/cli.js visualize
90002 90001   777 Fri Nov 20 11:00:00 2026     ${NODE} ${DIST}/server-entry.js
`;

/** The dr CLI's server script, another package's, and one whose package cannot be read. */
const isDrServer = (command: string) =>
  command.includes(DIST) ? true : command.includes("/srv/shop/") ? false : null;
const scanOptions = { uid: 501, selfPid: 99999, isDrServer };

describe("parsePs", () => {
  it("reads pid, parent, owner, start time and the whole command line", () => {
    const processes = parsePs(PS_OUTPUT);
    expect(processes).toHaveLength(15);
    const launcher = processes.find((info) => info.pid === 46531)!;
    expect(launcher).toMatchObject({ ppid: 1, uid: 501 });
    expect(launcher.command).toBe(`${NODE} ${DIST}/cli.js visualize --with-changesets --no-browser`);
    expect(new Date(launcher.startedAt).getTime()).toBe(new Date("Fri Nov 20 09:16:49 2026").getTime());
  });

  it("skips lines it cannot read", () => {
    expect(parsePs("garbage\n\n  12 nope")).toEqual([]);
  });
});

describe("command lines", () => {
  it("recognises the launcher's shape however the CLI was started", () => {
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js visualize --with-changesets --no-browser`)).toBe(true);
    expect(isLauncherCommand("node /opt/homebrew/bin/dr visualize")).toBe(true);
    expect(isLauncherCommand("dr visualize --port 3000")).toBe(true);
    expect(isLauncherCommand("bun run src/cli.ts --debug visualize --no-auth")).toBe(true);
    expect(isLauncherCommand("node /Users/me/Application Support/dr/dist/cli.js visualize")).toBe(true);
    // A global option that takes a value.
    expect(isLauncherCommand("node /x/dist/cli.js --codebase-path /repo visualize")).toBe(true);
    expect(isLauncherCommand("node /x/dist/cli.js --json --codebase-path=/repo visualize --no-auth")).toBe(true);
  });

  it("does not take --list, --stop or other commands for a viewer", () => {
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js visualize --list`)).toBe(false);
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js visualize --stop --all`)).toBe(false);
    expect(isLauncherCommand(`${NODE} ${DIST}/cli.js validate`)).toBe(false);
    expect(isLauncherCommand("vim visualize.ts")).toBe(false);
    expect(isLauncherCommand("node /srv/app/address.js visualize")).toBe(false);
    expect(hasVisualizeArgument("python manage.py visualize --all")).toBe(true);
    expect(hasVisualizeArgument(`${NODE} ${DIST}/cli.js visualize --stop`)).toBe(false);
    expect(hasVisualizeArgument("/usr/bin/postgres -D /var/db")).toBe(false);
  });

  it("recognises a dist/server-entry.js, whoever's it is", () => {
    expect(isServerCommand(`${NODE} ${DIST}/server-entry.js`)).toBe(true);
    expect(isServerCommand("node /srv/shop/dist/server-entry.js")).toBe(true);
    expect(isServerCommand(`${NODE} ${DIST}/cli.js visualize`)).toBe(false);
    expect(isServerCommand("node /srv/app/src/server-entry.js")).toBe(false);
  });

  it("finds the script path in a command line, also when the path has spaces", () => {
    expect(serverScriptCandidates("/usr/bin/node /opt/dr/dist/server-entry.js")).toEqual([
      "/opt/dr/dist/server-entry.js",
      "/usr/bin/node /opt/dr/dist/server-entry.js",
    ]);
    expect(serverScriptCandidates("node /Users/me/My Apps/dr/dist/server-entry.js")).toEqual([
      "/Users/me/My Apps/dr/dist/server-entry.js",
    ]);
    expect(serverScriptCandidates("node /x/cli.js visualize")).toEqual([]);
  });
});

describe("isDrServerScript", () => {
  it("is true only for a script whose package is the dr CLI", async () => {
    const scratch = join(await realpath(tmpdir()), `dr viewer scripts ${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      for (const [name, pkg] of [
        ["dr", { name: DR_CLI_PACKAGE }],
        ["shop", { name: "shop-server" }],
      ] as const) {
        await mkdir(join(scratch, name, "dist"), { recursive: true });
        await writeFile(join(scratch, name, "dist", "server-entry.js"), "");
        await writeFile(join(scratch, name, "package.json"), JSON.stringify(pkg));
      }
      await mkdir(join(scratch, "bare", "dist"), { recursive: true });
      await writeFile(join(scratch, "bare", "dist", "server-entry.js"), "");

      // The scratch path has spaces in it, as an install path can.
      expect(isDrServerScript(`node ${join(scratch, "dr", "dist", "server-entry.js")}`)).toBe(true);
      expect(isDrServerScript(`node ${join(scratch, "shop", "dist", "server-entry.js")}`)).toBe(false);
      // No package.json to read: cannot say.
      expect(isDrServerScript(`node ${join(scratch, "bare", "dist", "server-entry.js")}`)).toBeNull();
      expect(isDrServerScript("node /no/such/place/dist/server-entry.js")).toBeNull();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("scanViewerProcesses", () => {
  const scan = scanViewerProcesses(parsePs(PS_OUTPUT), scanOptions);

  it("pairs each dr server with the launcher above it, whatever the launcher's options", () => {
    expect(scan.viewers.filter((viewer) => viewer.launcherPid !== null).map((v) => [v.launcherPid, v.serverPid])).toEqual([
      [46531, 46533],
      [75855, 75857],
    ]);
  });

  it("finds a dr server whose launcher is gone, under init or under a subreaper", () => {
    expect(scan.viewers.filter((viewer) => viewer.launcherPid === null).map((viewer) => viewer.serverPid)).toEqual([80001, 80050]);
  });

  it("does not take another program's dist/server-entry.js for a viewer, even under init", () => {
    const pids = scan.viewers.flatMap((viewer) => [viewer.launcherPid, viewer.serverPid]);
    expect(pids).not.toContain(80400);
  });

  it("counts a dist/server-entry.js it cannot confirm, without listing it", () => {
    expect(scan.candidates).toEqual([80500]);
    expect(scan.viewers.map((viewer) => viewer.serverPid)).not.toContain(80500);
  });

  it("counts another user's viewers, without listing them", () => {
    expect(scan.otherUsers).toBe(1);
    const pids = scan.viewers.flatMap((viewer) => [viewer.launcherPid, viewer.serverPid]);
    expect(pids).not.toContain(90001);
    expect(pids).not.toContain(90002);
  });

  it("leaves out --list runs, launcher-shaped commands with no dr server, and editors", () => {
    const pids = scan.viewers.flatMap((viewer) => [viewer.launcherPid, viewer.serverPid]);
    for (const pid of [80100, 80200, 80300]) expect(pids).not.toContain(pid);
  });

  it("includes a launcher the registry names even before it has a server, when it has a launcher's shape", () => {
    const table = parsePs(
      `90101 1 501 Fri Nov 20 11:00:00 2026 ${NODE} ${DIST}/cli.js visualize --no-browser\n` +
        `90102 1 501 Fri Nov 20 11:00:00 2026 /usr/bin/postgres -D /var/db`
    );
    expect(findViewerProcesses(table, scanOptions)).toEqual([]);
    expect(findViewerProcesses(table, { ...scanOptions, knownLaunchers: new Set([90101, 90102]) })).toMatchObject([
      { launcherPid: 90101, serverPid: null },
    ]);
  });

  it("never lists the process doing the looking", () => {
    const viewers = findViewerProcesses(parsePs(PS_OUTPUT), { ...scanOptions, selfPid: 46531 });
    expect(viewers.map((viewer) => viewer.launcherPid)).not.toContain(46531);
  });
});

describe("the real process table", () => {
  it.skipIf(process.platform === "win32")("lists this process, and reads a process's working directory", async () => {
    const table = listProcesses({});
    expect(table).not.toBeNull();
    const self = table!.find((info) => info.pid === process.pid);
    expect(self?.uid).toBe(process.getuid?.());

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

  it("is not read when DR_VIEWER_PROCESS_SCAN is off", () => {
    expect(processScanDisabled({ DR_VIEWER_PROCESS_SCAN: "off" })).toBe(true);
    expect(processScanDisabled({ DR_VIEWER_PROCESS_SCAN: "OFF " })).toBe(true);
    expect(processScanDisabled({ DR_VIEWER_PROCESS_SCAN: "on" })).toBe(false);
    expect(processScanDisabled({})).toBe(false);
    expect(listProcesses({ DR_VIEWER_PROCESS_SCAN: "off" })).toBeNull();
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
