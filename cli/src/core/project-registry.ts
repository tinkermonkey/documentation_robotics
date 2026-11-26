/**
 * The project registry: the one code that answers what projects exist, what a path is, what
 * checkouts a project has and what a new project is called (issue 1279, design
 * `docs/design/USER_LEVEL_DR.md` sections 2-6; `application.applicationcomponent.project-registry`).
 *
 * Projects come from the farm in use (`resolveFarm`). Checkouts are never stored: they are
 * discovered from `git worktree list --porcelain` and cached until the repository's worktree
 * metadata changes.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readActiveMarker } from "./active-changeset-marker.js";
import { FarmManifest, farmPathFor, resolveFarmPath, type FarmProject } from "./farm-manifest.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";
import {
  MAIN_CHECKOUT,
  type Checkout,
  type CheckoutRef,
  type CheckoutResolver,
  type CheckoutState,
  type ProjectListCheckout,
  type ProjectListEntry,
  type Repository,
  type ResolvedCheckout,
  type SiblingPlan,
} from "./checkout-types.js";
import { getErrorMessage } from "../utils/errors.js";
import { findFarmRoot, resolveModelDirectory } from "../utils/project-paths.js";

const execFileAsync = promisify(execFile);

const FARM_FILE = "farm.yaml";

/** The default model folder of a repository that carries its own model. */
export const DEFAULT_MODEL_FOLDER = path.join("documentation-robotics", "model");

// ---------------------------------------------------------------------------------------------
// resolve-farm
// ---------------------------------------------------------------------------------------------

/** Where the farm in use came from. */
export type FarmSource = "env" | "folder" | "user";

/** The farm in use: its root folder, its farm.yaml and how it was found. */
export interface FarmLocation {
  root: string;
  file: string;
  source: FarmSource;
}

export interface ResolveFarmOptions {
  /** Where an upward search for a folder farm starts (default: the working directory). */
  cwd?: string;
  /** Environment to read `DR_FARM_PATH`, `XDG_CONFIG_HOME` and `HOME` from (default: process.env). */
  env?: NodeJS.ProcessEnv;
}

/** The user farm's file: `$XDG_CONFIG_HOME/dr/farm.yaml`, else `~/.config/dr/farm.yaml`. */
export function userFarmFile(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const configHome =
    xdg && path.isAbsolute(xdg) ? xdg : path.join(env.HOME || os.homedir(), ".config");
  return path.join(configHome, "dr", FARM_FILE);
}

/**
 * The farm in use (`application.applicationfunction.resolve-farm`): the folder `DR_FARM_PATH`
 * names, else a farm root found upward from `cwd`, else the user farm. Nothing is created here;
 * `loadFarm` creates the user farm on first use.
 */
export async function resolveFarm(options: ResolveFarmOptions = {}): Promise<FarmLocation> {
  const env = options.env ?? process.env;
  if (env.DR_FARM_PATH) {
    const root = path.resolve(env.DR_FARM_PATH);
    const file = path.join(root, FARM_FILE);
    if (!existsSync(file)) {
      throw new Error(
        `Invalid DR_FARM_PATH: ${env.DR_FARM_PATH}\n` +
          `Expected farm.yaml at: ${file}\n` +
          `Ensure DR_FARM_PATH points to a directory containing a farm.yaml file.`
      );
    }
    return { root, file, source: "env" };
  }

  // DR_FARM_PATH is handled above, so only the upward walk is asked for.
  const found = await findFarmRoot(options.cwd ?? process.cwd(), {});
  if (found) {
    const root = path.resolve(found);
    return { root, file: path.join(root, FARM_FILE), source: "folder" };
  }

  const file = userFarmFile(env);
  return { root: path.dirname(file), file, source: "user" };
}

/**
 * Load the farm at `location`. A user farm that does not exist yet is created empty, written
 * to disk only when `create` is true (the default); otherwise an empty in-memory farm comes back.
 */
export async function loadFarm(
  location: FarmLocation,
  options: { create?: boolean } = {}
): Promise<FarmManifest> {
  if (existsSync(location.file)) {
    return FarmManifest.load(location.file);
  }
  if (location.source !== "user") {
    // A folder farm is found by its farm.yaml, so this is a race with a delete.
    throw new Error(`Farm manifest not found: ${location.file}`);
  }
  const manifest = FarmManifest.create(userFarmName());
  manifest.filePath = location.file;
  if (options.create ?? true) {
    await manifest.save(location.file);
  }
  return manifest;
}

function userFarmName(): string {
  try {
    return os.userInfo().username || "user";
  } catch {
    return "user";
  }
}

// ---------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function realOrResolved(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/** One record of `git worktree list --porcelain`. */
interface WorktreeRecord {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

function parseWorktreePorcelain(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length),
        head: "",
        branch: null,
        bare: false,
        locked: false,
        prunable: false,
      };
      records.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true;
    }
  }
  return records;
}

/**
 * The repository `target` is in, from git, or null when it is not in a git working tree (or
 * does not exist). `commonDir` and `mainCheckout` are real paths.
 */
export async function resolveRepository(target: string): Promise<Repository | null> {
  const start = path.resolve(target);
  if (!existsSync(start)) return null;
  const cwd = (await stat(start)).isDirectory() ? start : path.dirname(start);
  let commonDirOut: string;
  try {
    commonDirOut = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    // A path inside .git itself has no working tree.
    const inside = (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
    if (inside !== "true") return null;
  } catch {
    return null;
  }
  const commonDir = await realOrResolved(commonDirOut.trim());
  const records = parseWorktreePorcelain(await git(cwd, ["worktree", "list", "--porcelain"]));
  const main = records[0];
  if (!main || main.bare) return null;
  const repository: Repository = { commonDir, mainCheckout: await realOrResolved(main.path) };
  try {
    const remote = (await git(cwd, ["remote", "get-url", "origin"])).trim();
    if (remote) repository.remote = remote;
  } catch {
    // no origin
  }
  return repository;
}

/** The main checkout of the repository `target` is in, or null when it is not in one. */
export async function resolveMainCheckout(target: string): Promise<string | null> {
  return (await resolveRepository(target))?.mainCheckout ?? null;
}

/**
 * Map each linked worktree's real path to the name git gives it under
 * `<commonDir>/worktrees/<name>`.
 */
async function worktreeNames(commonDir: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const dir = path.join(commonDir, "worktrees");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return names;
  }
  for (const name of entries) {
    try {
      const gitdir = (await readFile(path.join(dir, name, "gitdir"), "utf-8")).trim();
      const worktreePath = path.dirname(path.resolve(dir, name, gitdir));
      names.set(await realOrResolved(worktreePath), name);
    } catch {
      // not a worktree record
    }
  }
  return names;
}

/** A cheap fingerprint of a repository's worktree metadata: changes when a checkout comes, goes, moves or commits. */
async function worktreeSignature(commonDir: string): Promise<string> {
  const parts: string[] = [];
  const fileStamp = async (file: string): Promise<string> => {
    try {
      const s = await stat(file);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return "-";
    }
  };
  const fileText = async (file: string): Promise<string> => {
    try {
      return (await readFile(file, "utf-8")).trim();
    } catch {
      return "-";
    }
  };
  parts.push(await fileText(path.join(commonDir, "HEAD")), await fileStamp(path.join(commonDir, "logs", "HEAD")));
  const dir = path.join(commonDir, "worktrees");
  let entries: string[] = [];
  try {
    entries = (await readdir(dir)).sort();
  } catch {
    // no linked worktrees
  }
  for (const name of entries) {
    const admin = path.join(dir, name);
    const gitdir = await fileText(path.join(admin, "gitdir"));
    const present = gitdir !== "-" && existsSync(path.resolve(admin, gitdir));
    parts.push(
      name,
      gitdir,
      String(present),
      String(existsSync(path.join(admin, "locked"))),
      await fileText(path.join(admin, "HEAD")),
      await fileStamp(path.join(admin, "logs", "HEAD"))
    );
  }
  return parts.join("\n");
}

/**
 * A repository's checkouts, from `git worktree list --porcelain`
 * (`application.applicationfunction.discover-checkouts`, uncached). `main` is the main
 * worktree; a linked worktree's key is git's own name for it. A worktree whose folder is gone
 * is `prunable` when git says so, else `missing`.
 */
export async function listCheckouts(repository: Repository): Promise<Checkout[]> {
  const cwd = existsSync(repository.mainCheckout) ? repository.mainCheckout : repository.commonDir;
  const records = parseWorktreePorcelain(await git(cwd, ["worktree", "list", "--porcelain"]));
  const names = await worktreeNames(repository.commonDir);
  const checkouts: Checkout[] = [];
  for (const [index, record] of records.entries()) {
    if (record.bare) continue;
    const isMain = index === 0;
    const exists = existsSync(record.path);
    const realPath = await realOrResolved(record.path);
    const state: CheckoutState = exists ? "present" : record.prunable ? "prunable" : "missing";
    checkouts.push({
      key: isMain ? MAIN_CHECKOUT : (names.get(realPath) ?? path.basename(realPath)),
      path: realPath,
      branch: record.branch,
      head: record.head,
      isMain,
      state,
      locked: record.locked,
    });
  }
  return checkouts;
}

// ---------------------------------------------------------------------------------------------
// derive-project-name
// ---------------------------------------------------------------------------------------------

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True when `name` is a valid project name (kebab-case). */
export function isProjectName(name: string): boolean {
  return KEBAB.test(name);
}

/** A folder name in kebab case: `documentation_robotics` is `documentation-robotics`. */
export function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The call that registers a repository under a name of the caller's choosing. */
export function explicitNameCall(repositoryPath: string): string {
  return `dr farm add <name> --codebase ${repositoryPath}`;
}

/** The call that drops a project from the farm (one whose repository folder is gone, say). */
export function removeProjectCall(name: string): string {
  return `dr farm remove ${name}`;
}

/**
 * The name a new project gets (`application.applicationfunction.derive-project-name`): the
 * explicit name when given, else the main checkout's folder name in kebab case. A name another
 * repository holds is refused with the explicit-name call, never suffixed.
 *
 * @param holderOf - the repository (main checkout path) that holds a name in the farm, if any
 */
export function deriveProjectName(
  mainCheckout: string,
  holderOf: (name: string) => string | undefined,
  explicit?: string
): string {
  const name = explicit ?? toKebabCase(path.basename(mainCheckout));
  if (!isProjectName(name)) {
    throw new Error(
      explicit
        ? `Project name '${explicit}' is not kebab-case (lowercase letters, digits and single hyphens).`
        : `Cannot derive a project name from '${path.basename(mainCheckout)}'. Name it: ${explicitNameCall(mainCheckout)}`
    );
  }
  const holder = holderOf(name);
  if (holder !== undefined && holder !== mainCheckout) {
    throw new Error(
      `Project name '${name}' is already held by ${holder}. ` +
        `Register ${mainCheckout} with an explicit name: ${explicitNameCall(mainCheckout)}`
    );
  }
  return name;
}

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

/** Raised when a checkout the registry listed is gone (`application.applicationevent.checkout-removed`). */
export interface CheckoutRemovedEvent {
  ref: CheckoutRef;
  checkout: Checkout;
}

export type CheckoutRemovedListener = (event: CheckoutRemovedEvent) => void;

export interface RegisterProjectOptions {
  /** An explicit project name; else derived from the main checkout's folder. */
  name?: string;
  /** The model folder (absolute, or relative to the main checkout). Default: the one the repository carries, else documentation-robotics/model. */
  model?: string;
  remote?: string;
}

export interface RegisterProjectResult {
  project: FarmProject;
  /** False when a project already owned the repository. */
  created: boolean;
}

interface CheckoutCache {
  signature: string;
  checkouts: Checkout[];
}

/**
 * The project registry over one farm. Open it with `ProjectRegistry.open()`.
 */
export class ProjectRegistry {
  readonly farm: FarmLocation;
  private manifest: FarmManifest;
  private readonly repositories = new Map<string, Repository>();
  /** Projects whose folder git said is no repository, and which still has no `.git`: not asked again. */
  private readonly notRepositories = new Set<string>();
  private readonly checkoutCache = new Map<string, CheckoutCache>();
  private readonly removedAnnounced = new Map<string, Set<string>>();
  private readonly listeners = new Set<CheckoutRemovedListener>();
  /** The farm.yaml text the manifest was last read from: a reload with the same text reads nothing again. */
  private manifestText: string | null = null;
  /** The listing under way, shared by every caller that asks while it runs (#1436). */
  private listing: Promise<ProjectListEntry[]> | null = null;
  private readonly projectListings = new Map<string, Promise<ProjectListEntry | null>>();

  private constructor(farm: FarmLocation, manifest: FarmManifest) {
    this.farm = farm;
    this.manifest = manifest;
  }

  /** The registry over the farm in use (`resolveFarm`). A user farm is created on first write, not here. */
  static async open(options: ResolveFarmOptions = {}): Promise<ProjectRegistry> {
    const farm = await resolveFarm(options);
    return new ProjectRegistry(farm, await loadFarm(farm, { create: false }));
  }

  /** The registry over a farm already resolved and loaded. */
  static fromManifest(farm: FarmLocation, manifest: FarmManifest): ProjectRegistry {
    return new ProjectRegistry(farm, manifest);
  }

  /** The farm manifest the registry reads. */
  get farmManifest(): FarmManifest {
    return this.manifest;
  }

  /**
   * Re-read farm.yaml from disk (another process may have registered a project). When its text is
   * what was read last time, nothing changes, and the repositories already resolved are kept.
   */
  async reload(): Promise<void> {
    let text: string | null = null;
    try {
      text = await readFile(this.farm.file, "utf-8");
    } catch {
      // No farm.yaml (a user farm not created yet): loadFarm says what that means.
    }
    if (text !== null && text === this.manifestText) return;
    this.manifest = await loadFarm(this.farm, { create: false });
    this.manifestText = text;
    this.repositories.clear();
    this.notRepositories.clear();
  }

  /** Listen for `checkout-removed`. Returns the call that stops listening. */
  onCheckoutRemoved(listener: CheckoutRemovedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The project named `name`, or undefined. */
  getProject(name: string): FarmProject | undefined {
    return this.manifest.getProject(name);
  }

  /** A project's main checkout path, absolute. */
  repositoryPath(project: FarmProject): string {
    return resolveFarmPath(this.farm.root, project.repository);
  }

  /**
   * The repository of a project, from git; null when its folder is not a git working tree. A
   * repository found is cached. "Not a repository" is cached only while the folder exists with no
   * `.git` in it, so a folder that stays a plain folder costs no git call per listing, while a
   * `git init` or a clone there, or a repository whose git call failed once, is asked again.
   */
  async repositoryOf(project: FarmProject): Promise<Repository | null> {
    const key = project.name;
    const cached = this.repositories.get(key);
    if (cached) return cached;
    const folder = this.repositoryPath(project);
    const plainFolder = () => existsSync(folder) && !existsSync(path.join(folder, ".git"));
    if (this.notRepositories.has(key) && plainFolder()) return null;
    const repository = await resolveRepository(folder);
    if (repository) {
      this.repositories.set(key, repository);
      this.notRepositories.delete(key);
    } else if (plainFolder()) {
      this.notRepositories.add(key);
    } else {
      this.notRepositories.delete(key);
    }
    return repository;
  }

  /**
   * A project's checkouts (`discover-checkouts`), cached until `<commonDir>/worktrees/` (or a
   * checkout's HEAD) changes. A checkout that was present and is now gone or missing raises
   * `checkout-removed` once. A project whose folder is not a git repository has one checkout,
   * `main`, at its repository path.
   */
  async checkouts(projectName: string): Promise<Checkout[]> {
    const project = this.manifest.getProject(projectName);
    if (!project) {
      throw new Error(`Unknown project '${projectName}'`);
    }
    const repository = await this.repositoryOf(project);
    const lone = async (): Promise<Checkout[]> => {
      const repoPath = await realOrResolved(this.repositoryPath(project));
      return [
        {
          key: MAIN_CHECKOUT,
          path: repoPath,
          branch: null,
          head: "",
          isMain: true,
          state: existsSync(repoPath) ? "present" : "missing",
          locked: false,
        },
      ];
    };
    if (!repository) return lone();
    if (!existsSync(repository.commonDir)) {
      // The repository was deleted since it was resolved: resolve it again next time, and list its
      // main checkout as missing rather than failing the whole listing on git (#1438).
      this.repositories.delete(project.name);
      const checkouts = await lone();
      this.announceRemoved(projectName, this.checkoutCache.get(projectName)?.checkouts ?? [], checkouts);
      this.checkoutCache.delete(projectName);
      return checkouts;
    }

    const signature = await worktreeSignature(repository.commonDir);
    const cached = this.checkoutCache.get(projectName);
    if (cached && cached.signature === signature) {
      return cached.checkouts;
    }
    const checkouts = await listCheckouts(repository);
    this.checkoutCache.set(projectName, { signature, checkouts });
    this.announceRemoved(projectName, cached?.checkouts ?? [], checkouts);
    return checkouts;
  }

  private announceRemoved(project: string, before: Checkout[], after: Checkout[]): void {
    const announced = this.removedAnnounced.get(project) ?? new Set<string>();
    this.removedAnnounced.set(project, announced);
    const now = new Map(after.map((c) => [c.key, c]));
    for (const checkout of after) {
      if (checkout.state === "present") announced.delete(checkout.key);
    }
    for (const previous of before) {
      if (previous.state !== "present" || announced.has(previous.key)) continue;
      const current = now.get(previous.key);
      if (current && current.state === "present") continue;
      announced.add(previous.key);
      const event: CheckoutRemovedEvent = {
        ref: { project, checkout: previous.key },
        checkout: current ?? previous,
      };
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }

  /**
   * The model folder for a checkout: the farm's model path, followed into the checkout when it
   * lies inside the main checkout.
   */
  modelPathFor(project: FarmProject, checkout: Checkout, mainCheckout: string): string {
    const model = resolveFarmPath(this.farm.root, project.model);
    const main = path.resolve(mainCheckout);
    const repoPath = this.repositoryPath(project);
    for (const base of [main, repoPath]) {
      if (model === base || model.startsWith(base + path.sep)) {
        return path.join(checkout.path, path.relative(base, model));
      }
    }
    return model;
  }

  /** The project whose repository is `repository` (same git common dir), or undefined. */
  async projectForRepository(repository: Repository): Promise<FarmProject | undefined> {
    for (const project of this.manifest.getAllProjects()) {
      const held = await this.repositoryOf(project);
      if (held && held.commonDir === repository.commonDir) return project;
    }
    return undefined;
  }

  /**
   * A path, a project name or a CheckoutRef to its project and checkout
   * (`application.applicationfunction.resolve-checkout`). Null when no project owns it, the
   * checkout is unknown, or (for a ref or name) the checkout is not present.
   *
   * A string is a path when it is absolute or contains a path separator; otherwise a project name
   * (its `main` checkout).
   */
  async resolveCheckout(input: string | CheckoutRef): Promise<ResolvedCheckout | null> {
    if (typeof input !== "string") {
      return this.resolveRef(input);
    }
    if (path.isAbsolute(input) || input.includes("/") || input.includes(path.sep) || input === ".") {
      return this.resolvePath(input);
    }
    return this.resolveRef({ project: input, checkout: MAIN_CHECKOUT });
  }

  /** A CheckoutRef to the checkout it names, or null when unknown or not present. */
  async resolveRef(ref: CheckoutRef): Promise<ResolvedCheckout | null> {
    const project = this.manifest.getProject(ref.project);
    if (!project) return null;
    const checkouts = await this.checkouts(project.name);
    const checkout = checkouts.find((c) => c.key === ref.checkout);
    if (!checkout || checkout.state !== "present") return null;
    return this.resolved(project, checkout, checkouts);
  }

  /** A path to the checkout whose folder contains it, and that checkout's project; null when no project owns it. */
  async resolvePath(target: string): Promise<ResolvedCheckout | null> {
    const full = await realOrResolved(target);
    const repository = await resolveRepository(full);
    let project: FarmProject | undefined;
    if (repository) {
      project = await this.projectForRepository(repository);
    } else {
      // A project whose folder is not a git repository owns the paths inside it.
      for (const candidate of this.manifest.getAllProjects()) {
        const repoPath = await realOrResolved(this.repositoryPath(candidate));
        if (full === repoPath || full.startsWith(repoPath + path.sep)) {
          project = candidate;
          break;
        }
      }
    }
    if (!project) return null;

    const checkouts = await this.checkouts(project.name);
    let best: Checkout | undefined;
    for (const checkout of checkouts) {
      if (full === checkout.path || full.startsWith(checkout.path + path.sep)) {
        if (!best || checkout.path.length > best.path.length) best = checkout;
      }
    }
    if (!best) return null;
    return this.resolved(project, best, checkouts);
  }

  private resolved(project: FarmProject, checkout: Checkout, checkouts: Checkout[]): ResolvedCheckout {
    const main = checkouts.find((c) => c.isMain)?.path ?? this.repositoryPath(project);
    return {
      ref: { project: project.name, checkout: checkout.key },
      checkout,
      modelPath: this.modelPathFor(project, checkout, main),
    };
  }

  /** A `CheckoutResolver` over this registry, for the server's checkout context pool. */
  resolver(): CheckoutResolver {
    return (ref) => this.resolveRef(ref);
  }

  /**
   * Every registered project with its checkouts (`application.applicationfunction.list-projects`),
   * in name order. Re-checks each project's worktrees. Calls made while a listing runs share it,
   * so a page load's several requests cost one scan (#1436); the entries are shared, not copied.
   */
  listProjects(): Promise<ProjectListEntry[]> {
    this.listing ??= this.scanProjects().finally(() => {
      this.listing = null;
    });
    return this.listing;
  }

  private async scanProjects(): Promise<ProjectListEntry[]> {
    const projects = this.manifest.getAllProjects().sort((a, b) => a.name.localeCompare(b.name));
    const entries: ProjectListEntry[] = [];
    for (const project of projects) {
      entries.push(await this.listEntry(project));
    }
    return entries;
  }

  /**
   * One project as `listProjects` lists it, or null when the farm has no project of that name.
   * Scans that project only; calls for the same project while one runs share it.
   */
  listProject(name: string): Promise<ProjectListEntry | null> {
    let listing = this.projectListings.get(name);
    if (!listing) {
      const project = this.manifest.getProject(name);
      listing = (project ? this.listEntry(project) : Promise.resolve(null)).finally(() => {
        this.projectListings.delete(name);
      });
      this.projectListings.set(name, listing);
    }
    return listing;
  }

  /**
   * The staged plans in the project's other checkouts (#1368), from each changeset's metadata.yaml.
   * `except` is the checkout asking (its own plans are not siblings'). `notes` says what could not
   * be looked at (a checkout that is missing, a plan whose metadata is unreadable), so an empty
   * list is never mistaken for "none". Throws on an unknown project.
   */
  async siblingPlans(projectName: string, except: string): Promise<{ plans: SiblingPlan[]; notes: string[] }> {
    const project = this.manifest.getProject(projectName);
    if (!project) throw new Error(`Unknown project '${projectName}'`);
    const checkouts = await this.checkouts(projectName);
    const main = checkouts.find((c) => c.isMain)?.path ?? this.repositoryPath(project);
    const rootOf = (checkout: Checkout) => projectRootOf(this.modelPathFor(project, checkout, main), checkout.path);
    const own = checkouts.find((c) => c.key === except);
    // A model kept outside the repository is one folder for every checkout: its plans are not siblings'.
    const ownRoot = own ? rootOf(own) : null;
    const plans: SiblingPlan[] = [];
    const notes: string[] = [];
    for (const checkout of checkouts) {
      if (checkout.key === except) continue;
      if (checkout.state !== "present") {
        notes.push(`Checkout ${checkout.key} is ${checkout.state}, so its plans were not read.`);
        continue;
      }
      const root = rootOf(checkout);
      if (root === ownRoot) continue;
      let active: string | null = null;
      try {
        active = await readActiveMarker(root);
      } catch (error) {
        notes.push(`Checkout ${checkout.key}: its active changeset could not be read (${getErrorMessage(error)}).`);
      }
      const { summaries, unreadable } = await new StagedChangesetStorage(root).listStagedSummaries();
      if (unreadable.length > 0) {
        notes.push(
          `Checkout ${checkout.key}: ${unreadable.length} changeset folder(s) could not be read, so a plan there may be missing (${unreadable.slice(0, 3).join("; ")}).`
        );
      }
      for (const summary of summaries) {
        plans.push({ checkout: checkout.key, branch: checkout.branch, path: checkout.path, ...summary, active: summary.id === active });
      }
    }
    return { plans, notes };
  }

  private async listEntry(project: FarmProject): Promise<ProjectListEntry> {
    const checkouts = await this.checkouts(project.name);
    const main = checkouts.find((c) => c.isMain)?.path ?? this.repositoryPath(project);
    const listed: ProjectListCheckout[] = [];
    for (const checkout of checkouts) {
      listed.push({
        key: checkout.key,
        path: checkout.path,
        branch: checkout.branch,
        head: checkout.head,
        state: checkout.state,
        ...(await changesetSummary(checkout, this.modelPathFor(project, checkout, main))),
      });
    }
    const repository = this.repositoryPath(project);
    return {
      name: project.name,
      repository,
      model: project.model,
      ...(project.remote ? { remote: project.remote } : {}),
      // A project whose repository was deleted stays in the farm until removed: say so, and how (#1438).
      ...(existsSync(repository) ? {} : { missing: true as const, remove: removeProjectCall(project.name) }),
      checkouts: listed,
    };
  }

  /**
   * Add the project that owns `target` to the farm (`application.applicationfunction.register-project`),
   * or return the project that already owns it. A worktree path registers (or finds) its
   * repository's project, never a project per worktree. Saves the farm (creating the user farm
   * on first use).
   */
  async registerProject(target: string, options: RegisterProjectOptions = {}): Promise<RegisterProjectResult> {
    if (this.manifest.isLegacy()) {
      throw new Error(this.manifest.legacyNotice() ?? "Farm is dr-farm-v1; run 'dr farm migrate'");
    }
    const repository = await resolveRepository(target);
    if (!repository) {
      throw new Error(`${path.resolve(target)} is not in a git working tree; a project is a git repository.`);
    }
    const existing = await this.projectForRepository(repository);
    if (existing) {
      if (options.name && options.name !== existing.name) {
        throw new Error(
          `Repository ${repository.mainCheckout} is already in the farm as project '${existing.name}'.`
        );
      }
      return { project: existing, created: false };
    }

    const holders = new Map<string, string>();
    for (const project of this.manifest.getAllProjects()) {
      const held = await this.repositoryOf(project);
      holders.set(project.name, held?.mainCheckout ?? this.repositoryPath(project));
    }
    const name = deriveProjectName(repository.mainCheckout, (n) => holders.get(n), options.name);

    const model = await this.modelFor(repository.mainCheckout, options.model);
    const project: FarmProject = {
      name,
      repository: farmPathFor(this.farm.root, repository.mainCheckout),
      model: farmPathFor(this.farm.root, model),
      ...((options.remote ?? repository.remote) ? { remote: options.remote ?? repository.remote } : {}),
    };
    this.manifest.addProject(name, project);
    await this.manifest.save(this.farm.file);
    this.repositories.set(name, repository);
    return { project, created: true };
  }

  /**
   * The checkout a path is in, registering its repository first when no project owns it (the
   * auto-registration an MCP root or `dr visualize <path>` gets). Throws when the path is not in
   * a git working tree, or its derived name is held by another repository.
   */
  async resolveOrRegister(target: string, options: RegisterProjectOptions = {}): Promise<ResolvedCheckout> {
    const existing = await this.resolvePath(target);
    if (existing) return existing;
    await this.registerProject(target, options);
    const resolved = await this.resolvePath(target);
    if (!resolved) {
      throw new Error(`Registered the repository of ${target}, but no checkout of it contains that path`);
    }
    return resolved;
  }

  private async modelFor(mainCheckout: string, explicit?: string): Promise<string> {
    if (explicit) return path.resolve(mainCheckout, explicit);
    const detected = await resolveModelDirectory(mainCheckout, { requireManifest: true });
    return detected?.modelDir ?? path.join(mainCheckout, DEFAULT_MODEL_FOLDER);
  }
}

/** The active changeset and the staged changeset count of a checkout. */
async function changesetSummary(
  checkout: Checkout,
  modelPath: string
): Promise<{ activeChangeset: string | null; stagedChangesets: number }> {
  if (checkout.state !== "present") {
    return { activeChangeset: null, stagedChangesets: 0 };
  }
  const root = projectRootOf(modelPath, checkout.path);
  let activeChangeset: string | null = null;
  let stagedChangesets = 0;
  try {
    activeChangeset = await readActiveMarker(root);
  } catch {
    activeChangeset = null;
  }
  try {
    // metadata.yaml alone, cached by mtime: never every changes.yaml in the farm (#1436).
    const statuses = await new StagedChangesetStorage(root).listStatuses();
    stagedChangesets = statuses.filter((c) => c.status === "staged").length;
  } catch {
    stagedChangesets = 0;
  }
  return { activeChangeset, stagedChangesets };
}

/** The project root holding `documentation-robotics/` for a model folder. */
function projectRootOf(modelPath: string, fallback: string): string {
  const parts = path.resolve(modelPath).split(path.sep);
  const n = parts.length;
  if (n >= 2 && parts[n - 2] === "documentation-robotics" && parts[n - 1] === "model") {
    return parts.slice(0, n - 2).join(path.sep) || path.sep;
  }
  return fallback;
}
