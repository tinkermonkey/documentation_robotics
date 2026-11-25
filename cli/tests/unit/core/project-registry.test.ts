/**
 * Project registry (issue 1279): farm resolution, project naming, checkout discovery and
 * resolution, against real temporary git repositories and worktrees.
 *
 * Covers testing.testcasesketch.project-naming-sketch and checkout-discovery-sketch.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FarmManifest } from "../../../src/core/farm-manifest.js";
import {
  ProjectRegistry,
  deriveProjectName,
  listCheckouts,
  loadFarm,
  resolveFarm,
  resolveRepository,
  toKebabCase,
  userFarmFile,
  type CheckoutRemovedEvent,
  type FarmLocation,
} from "../../../src/core/project-registry.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: GIT_ENV,
    stdio: "pipe",
    encoding: "utf-8",
  });
}

async function createRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  await writeFile(path.join(dir, "README.md"), "# test\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return realpath(dir);
}

// Tests in tests/unit/core/ run concurrently: each test gets its own folder.
const scratchDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "dr-registry-")));
  scratchDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(scratchDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** An empty dr-farm-v2 farm at `<tmp>/farm`, as a folder farm. */
async function folderFarm(tmp: string): Promise<{ location: FarmLocation; registry: ProjectRegistry }> {
  const root = path.join(tmp, "farm");
  await mkdir(root, { recursive: true });
  const file = path.join(root, "farm.yaml");
  await FarmManifest.create("test").save(file);
  const location: FarmLocation = { root, file, source: "folder" };
  return { location, registry: ProjectRegistry.fromManifest(location, await FarmManifest.load(file)) };
}

describe("resolveFarm", () => {
  it("uses DR_FARM_PATH first", async () => {
    const tmp = await scratch();
    const root = path.join(tmp, "env-farm");
    await mkdir(root);
    await FarmManifest.create("env").save(path.join(root, "farm.yaml"));
    const location = await resolveFarm({ cwd: tmp, env: { DR_FARM_PATH: root } });
    expect(location).toEqual({ root, file: path.join(root, "farm.yaml"), source: "env" });
  });

  it("refuses a DR_FARM_PATH without farm.yaml", async () => {
    const tmp = await scratch();
    await expect(resolveFarm({ cwd: tmp, env: { DR_FARM_PATH: path.join(tmp, "nope") } })).rejects.toThrow(
      /Invalid DR_FARM_PATH/
    );
  });

  it("finds a folder farm upward from the working directory", async () => {
    const tmp = await scratch();
    const root = path.join(tmp, "folder");
    const deep = path.join(root, "a", "b");
    await mkdir(deep, { recursive: true });
    await FarmManifest.create("folder").save(path.join(root, "farm.yaml"));
    const location = await resolveFarm({ cwd: deep, env: {} });
    expect(location.source).toBe("folder");
    expect(location.root).toBe(root);
  });

  it("falls back to the user farm under XDG_CONFIG_HOME, created empty on first use", async () => {
    const tmp = await scratch();
    const xdg = path.join(tmp, "xdg");
    const cwd = path.join(tmp, "nowhere");
    await mkdir(cwd);
    const location = await resolveFarm({ cwd, env: { XDG_CONFIG_HOME: xdg } });
    expect(location).toEqual({ root: path.join(xdg, "dr"), file: path.join(xdg, "dr", "farm.yaml"), source: "user" });

    const inMemory = await loadFarm(location, { create: false });
    expect(inMemory.projects.size).toBe(0);
    expect(await Bun.file(location.file).exists()).toBe(false);

    const created = await loadFarm(location);
    expect(created.schema).toBe("dr-farm-v2");
    expect(await Bun.file(location.file).exists()).toBe(true);
  });

  it("puts the user farm under ~/.config without XDG_CONFIG_HOME", () => {
    expect(userFarmFile({ HOME: "/home/someone" })).toBe("/home/someone/.config/dr/farm.yaml");
  });
});

describe("project naming", () => {
  it("kebab-cases folder names", () => {
    expect(toKebabCase("documentation_robotics")).toBe("documentation-robotics");
    expect(toKebabCase("MyService")).toBe("my-service");
    expect(toKebabCase("api.v2 Service")).toBe("api-v2-service");
  });

  it("derives a name from the main checkout's folder, or takes an explicit one", () => {
    const none = () => undefined;
    expect(deriveProjectName("/x/documentation_robotics", none)).toBe("documentation-robotics");
    expect(deriveProjectName("/x/documentation_robotics", none, "dr")).toBe("dr");
    expect(() => deriveProjectName("/x/repo", none, "Not_Kebab")).toThrow(/not kebab-case/);
  });

  it("refuses a name another repository holds, naming the explicit-name call, never suffixing", () => {
    const holder = (name: string) => (name === "service" ? "/a/service" : undefined);
    expect(() => deriveProjectName("/b/service", holder)).toThrow(
      /already held by \/a\/service.*dr farm add <name> --codebase \/b\/service/
    );
    // The same repository may keep its name.
    expect(deriveProjectName("/a/service", holder)).toBe("service");
  });

  it("refuses a second repository with the same folder name; a worktree path finds the existing project", async () => {
    const tmp = await scratch();
    const { registry, location } = await folderFarm(tmp);
    const first = await createRepo(path.join(tmp, "one", "service"));
    const second = await createRepo(path.join(tmp, "two", "service"));
    const worktree = path.join(tmp, "wt-feature");
    git(first, "worktree", "add", "-q", worktree);

    const added = await registry.registerProject(first);
    expect(added.created).toBe(true);
    expect(added.project.name).toBe("service");
    expect(added.project.repository).toBe(first);

    await expect(registry.registerProject(second)).rejects.toThrow(/dr farm add <name> --codebase/);

    const again = await registry.registerProject(path.join(worktree, "README.md"));
    expect(again).toEqual({ project: added.project, created: false });

    const named = await registry.registerProject(second, { name: "service-two" });
    expect(named.project.name).toBe("service-two");

    const saved = await FarmManifest.load(location.file);
    expect([...saved.projects.keys()].sort()).toEqual(["service", "service-two"]);
    expect(saved.schema).toBe("dr-farm-v2");
  });
});

describe("checkout discovery", () => {
  it("lists main and git's worktree names; a deleted folder is prunable and raises checkout-removed once", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const repo = await createRepo(path.join(tmp, "repo"));
    const wtA = path.join(tmp, "trees", "alpha");
    const wtB = path.join(tmp, "trees", "beta");
    const wtGone = path.join(tmp, "trees", "gone");
    git(repo, "worktree", "add", "-q", "-b", "a", wtA);
    git(repo, "worktree", "add", "-q", "--detach", wtB);
    git(repo, "worktree", "add", "-q", "-b", "g", wtGone);
    await registry.registerProject(repo, { name: "repo" });

    const events: CheckoutRemovedEvent[] = [];
    registry.onCheckoutRemoved((e) => events.push(e));

    const before = await registry.checkouts("repo");
    expect(before.map((c) => [c.key, c.state, c.isMain])).toEqual([
      ["main", "present", true],
      ["alpha", "present", false],
      ["beta", "present", false],
      ["gone", "present", false],
    ]);
    expect(before.find((c) => c.key === "alpha")?.branch).toBe("a");
    expect(before.find((c) => c.key === "beta")?.branch).toBeNull();
    expect(before[0].head).toMatch(/^[0-9a-f]{40}$/);

    // Cached while nothing changes
    expect(await registry.checkouts("repo")).toBe(before);

    await rm(wtGone, { recursive: true, force: true });
    const after = await registry.checkouts("repo");
    expect(after.find((c) => c.key === "gone")?.state).toBe("prunable");
    expect(events.map((e) => e.ref)).toEqual([{ project: "repo", checkout: "gone" }]);

    // Raised once: neither a re-check nor the prune raises it again
    await registry.checkouts("repo");
    git(repo, "worktree", "prune");
    const pruned = await registry.checkouts("repo");
    expect(pruned.map((c) => c.key)).toEqual(["main", "alpha", "beta"]);
    expect(events).toHaveLength(1);

    // git worktree remove drops it from the list and raises the event
    git(repo, "worktree", "remove", wtA);
    const removed = await registry.checkouts("repo");
    expect(removed.map((c) => c.key)).toEqual(["main", "beta"]);
    expect(events.map((e) => e.ref.checkout)).toEqual(["gone", "alpha"]);
  });

  it("keys a worktree by git's name, not its folder name, when they differ", async () => {
    const tmp = await scratch();
    const repo = await createRepo(path.join(tmp, "repo"));
    const first = path.join(tmp, "x", "same");
    const second = path.join(tmp, "y", "same");
    git(repo, "worktree", "add", "-q", "--detach", first);
    git(repo, "worktree", "add", "-q", "--detach", second);
    const repository = await resolveRepository(repo);
    const keys = (await listCheckouts(repository!)).map((c) => c.key);
    expect(keys[0]).toBe("main");
    expect(new Set(keys).size).toBe(3);
    expect(keys.slice(1).every((k) => k.startsWith("same"))).toBe(true);
  });

  it("re-reads a checkout's head after a commit", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const repo = await createRepo(path.join(tmp, "repo"));
    await registry.registerProject(repo, { name: "repo" });
    const before = (await registry.checkouts("repo"))[0].head;
    await writeFile(path.join(repo, "b.txt"), "b");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "b");
    const after = (await registry.checkouts("repo"))[0].head;
    expect(after).not.toBe(before);
  });
});

describe("resolving checkouts", () => {
  it("resolves a path, a project name and a CheckoutRef; the model follows into each checkout", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const repo = await createRepo(path.join(tmp, "repo"));
    await mkdir(path.join(repo, "documentation-robotics", "model"), { recursive: true });
    await writeFile(path.join(repo, "documentation-robotics", "model", "manifest.yaml"), "version: 1\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "model");
    const wt = path.join(tmp, "feature-wt");
    git(repo, "worktree", "add", "-q", "-b", "feature", wt);
    const { project } = await registry.registerProject(repo, { name: "repo" });
    expect(project.model).toBe(path.join(repo, "documentation-robotics", "model"));

    const inWorktree = await registry.resolveCheckout(path.join(wt, "documentation-robotics"));
    expect(inWorktree?.ref).toEqual({ project: "repo", checkout: "feature-wt" });
    expect(inWorktree?.checkout.branch).toBe("feature");
    expect(inWorktree?.modelPath).toBe(path.join(wt, "documentation-robotics", "model"));

    const byName = await registry.resolveCheckout("repo");
    expect(byName?.ref).toEqual({ project: "repo", checkout: "main" });
    expect(byName?.modelPath).toBe(path.join(repo, "documentation-robotics", "model"));

    const resolver = registry.resolver();
    expect((await resolver({ project: "repo", checkout: "feature-wt" }))?.checkout.path).toBe(wt);
    expect(await resolver({ project: "repo", checkout: "nope" })).toBeNull();
    expect(await resolver({ project: "nope", checkout: "main" })).toBeNull();

    // A missing checkout is not served
    await rm(wt, { recursive: true, force: true });
    expect(await resolver({ project: "repo", checkout: "feature-wt" })).toBeNull();

    // A path no project owns
    const other = await createRepo(path.join(tmp, "other"));
    expect(await registry.resolveCheckout(other)).toBeNull();
  });

  it("auto-registers an unowned path, then resolves it", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const repo = await createRepo(path.join(tmp, "auto_reg"));
    const wt = path.join(tmp, "auto-wt");
    git(repo, "worktree", "add", "-q", "-b", "w", wt);
    const resolved = await registry.resolveOrRegister(wt);
    expect(resolved.ref).toEqual({ project: "auto-reg", checkout: "auto-wt" });
    expect(registry.getProject("auto-reg")?.repository).toBe(repo);
    await expect(registry.resolveOrRegister(path.join(tmp, "farm"))).rejects.toThrow(/not in a git working tree/);
  });

  it("lists projects in name order with each checkout's active and staged changesets", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const zeta = await createRepo(path.join(tmp, "zeta"));
    const alpha = await createRepo(path.join(tmp, "alpha"));
    const wt = path.join(tmp, "alpha-wt");
    git(alpha, "worktree", "add", "-q", "-b", "w", wt);
    await registry.registerProject(zeta);
    await registry.registerProject(alpha, { remote: "https://example.com/alpha.git" });

    await mkdir(path.join(wt, ".dr"), { recursive: true });
    await writeFile(path.join(wt, ".dr", "active-changeset"), "cs-1\n");

    const list = await registry.listProjects();
    expect(list.map((p) => p.name)).toEqual(["alpha", "zeta"]);
    expect(list[0].remote).toBe("https://example.com/alpha.git");
    expect(list[0].repository).toBe(alpha);
    expect(list[0].checkouts.map((c) => [c.key, c.activeChangeset, c.stagedChangesets])).toEqual([
      ["main", null, 0],
      ["alpha-wt", "cs-1", 0],
    ]);
  });

  it("counts staged changesets from metadata.yaml alone, never parsing changes.yaml (#1436)", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const repo = await createRepo(path.join(tmp, "big"));
    await registry.registerProject(repo);
    const changesets = path.join(repo, "documentation-robotics", "changesets");
    const write = async (id: string, status: string, changes: string) => {
      await mkdir(path.join(changesets, id), { recursive: true });
      await writeFile(path.join(changesets, id, "metadata.yaml"), `id: ${id}\nname: ${id}\nstatus: ${status}\n`);
      await writeFile(path.join(changesets, id, "changes.yaml"), changes);
    };
    await write("a", "staged", "- type: add\n");
    await write("b", "committed", "- type: add\n");
    // Not YAML at all: a listing that parsed it would skip this changeset and count 1.
    await write("c", "staged", "{{{ not yaml");

    const [entry] = await registry.listProjects();
    expect(entry.checkouts[0].stagedChangesets).toBe(2);

    // A status rewritten on disk is read again (the cache keys on mtime and size).
    await writeFile(path.join(changesets, "a", "metadata.yaml"), "id: a\nname: a\nstatus: discarded\n");
    expect((await registry.listProject("big"))?.checkouts[0].stagedChangesets).toBe(1);
  });

  it("shares one scan between listings asked for while it runs (#1436)", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    await registry.registerProject(await createRepo(path.join(tmp, "one")));
    const [first, second] = await Promise.all([registry.listProjects(), registry.listProjects()]);
    expect(second).toBe(first);
    const [a, b] = await Promise.all([registry.listProject("one"), registry.listProject("one")]);
    expect(b).toBe(a);
    // Once it is done, the next listing scans again.
    expect(await registry.listProjects()).not.toBe(first);
    expect(await registry.listProject("nope")).toBeNull();
  });

  it("flags a project whose repository folder is gone, with the call that removes it (#1438)", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const gone = await createRepo(path.join(tmp, "gone"));
    await registry.registerProject(gone);
    await registry.registerProject(await createRepo(path.join(tmp, "here")));
    await rm(gone, { recursive: true, force: true });

    const list = await registry.listProjects();
    const missing = list.find((p) => p.name === "gone");
    expect(missing).toMatchObject({ missing: true, remove: "dr farm remove gone" });
    expect(list.find((p) => p.name === "here")).not.toHaveProperty("missing");
  });

  it("lists a repository restored after it was gone as present again, without a restart", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const dir = path.join(tmp, "comeback");
    await registry.registerProject(await createRepo(dir));
    expect((await registry.listProject("comeback"))?.checkouts[0]).toMatchObject({ state: "present", branch: "main" });

    await rm(dir, { recursive: true, force: true });
    expect(await registry.listProject("comeback")).toMatchObject({ missing: true, checkouts: [{ state: "missing" }] });

    // Cloned again at the same place: the failed lookup in between was not cached.
    await createRepo(dir);
    await registry.reload();
    const back = await registry.listProject("comeback");
    expect(back).not.toHaveProperty("missing");
    expect(back?.checkouts[0]).toMatchObject({ key: "main", state: "present", branch: "main" });
  });

  it("asks git again for a project folder that was not a repository when first seen", async () => {
    const tmp = await scratch();
    const { registry } = await folderFarm(tmp);
    const dir = path.join(tmp, "later-repo");
    await registry.registerProject(await createRepo(dir));
    // As if registered before its `git init`: the folder exists, but has no repository yet.
    await rm(path.join(dir, ".git"), { recursive: true, force: true });
    await registry.reload();
    expect((await registry.listProject("later-repo"))?.checkouts[0]).toMatchObject({ branch: null });
    await createRepo(dir);
    expect((await registry.listProject("later-repo"))?.checkouts[0]).toMatchObject({ branch: "main" });
  });

  it("reloads farm.yaml only when its text changed, keeping what it resolved otherwise", async () => {
    const tmp = await scratch();
    const { location, registry } = await folderFarm(tmp);
    await registry.reload();
    const manifest = registry.farmManifest;
    await registry.reload();
    expect(registry.farmManifest).toBe(manifest);

    // Another process registers a project: the next reload sees it.
    const other = await FarmManifest.load(location.file);
    const repo = await createRepo(path.join(tmp, "later"));
    other.addProject("later", { name: "later", repository: repo, model: path.join(repo, "documentation-robotics", "model") });
    await other.save(location.file);
    await registry.reload();
    expect(registry.getProject("later")).toBeDefined();
  });
});
