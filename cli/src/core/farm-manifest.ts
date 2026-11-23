/**
 * Farm Manifest - Manages farm.yaml configuration
 *
 * Represents a farm context containing multiple projects with detached model folders.
 * The farm manifest tracks project registrations and their model folder locations.
 */

import path from "path";
import yaml from "yaml";
import { readFile, writeFile } from "../utils/file-io.js";

/** The farm format this CLI writes. */
export const FARM_SCHEMA_V2 = "dr-farm-v2";
/** The farm format before user-level DR (issue 1279): one entry per checkout, `source` and `branch`. */
export const FARM_SCHEMA_V1 = "dr-farm-v1";

/**
 * A project in the farm (dr-farm-v2). Checkouts are not recorded: they come from git.
 * (`data-model.objectschema.farm-project`)
 */
export interface FarmProject {
  /** The project's name: unique in the farm, also its `@name` federation name. */
  name: string;
  /** The main checkout's path: absolute, or relative to the farm root. */
  repository: string;
  /**
   * The model folder: absolute, or relative to the farm root. A model inside the main checkout
   * is followed into every other checkout at the same path relative to the checkout's root.
   */
  model: string;
  /** origin's URL, when the farm records one. */
  remote?: string;
}

/** A dr-farm-v1 entry as the file holds it. Read only, for `dr farm migrate`. */
export interface LegacyFarmEntry {
  name: string;
  /** Path to the codebase folder (relative to farm root): a main checkout or a worktree. */
  source: string;
  model: string;
  remote?: string;
  branch?: string;
}

/** The notice printed when a dr-farm-v1 farm is read. */
export function legacyFarmNotice(filePath: string): string {
  return (
    `${filePath} is ${FARM_SCHEMA_V1}: it is read, but nothing is written to it until it is migrated. ` +
    `Run 'dr farm migrate' to preview the move to ${FARM_SCHEMA_V2}, then 'dr farm migrate --apply'.`
  );
}

function requireString(p: Record<string, unknown>, field: string, projectKey: string, fields: string): string {
  const value = p[field];
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `Project "${projectKey}" is missing required '${field}' field. ` +
        `Each project must have ${fields} fields.`
    );
  }
  return value;
}

function projectRecord(project: unknown, projectKey: string): Record<string, unknown> {
  if (!project || typeof project !== "object") {
    throw new Error(
      `Invalid project entry "${projectKey}": expected object, got ${typeof project}`
    );
  }
  return project as Record<string, unknown>;
}

function checkKeyMatchesName(name: string, projectKey: string): void {
  if (name !== projectKey) {
    throw new Error(
      `Project name mismatch: key is "${projectKey}" but project.name is "${name}". ` +
      `They must match for consistent sync state tracking.`
    );
  }
}

// Validate a dr-farm-v2 project entry: required fields and key/name consistency
function validateFarmProject(project: unknown, projectKey: string): FarmProject {
  const p = projectRecord(project, projectKey);
  const fields = "name, repository, and model";
  const name = requireString(p, "name", projectKey, fields);
  const repository = requireString(p, "repository", projectKey, fields);
  const model = requireString(p, "model", projectKey, fields);
  checkKeyMatchesName(name, projectKey);

  const validated: FarmProject = { name, repository, model };
  if (typeof p.remote === "string") {
    validated.remote = p.remote;
  }
  return validated;
}

// Validate a dr-farm-v1 entry: required fields and key/name consistency
function validateLegacyEntry(project: unknown, projectKey: string): LegacyFarmEntry {
  const p = projectRecord(project, projectKey);
  const fields = "name, source, and model";
  const name = requireString(p, "name", projectKey, fields);
  const source = requireString(p, "source", projectKey, fields);
  const model = requireString(p, "model", projectKey, fields);
  checkKeyMatchesName(name, projectKey);

  const entry: LegacyFarmEntry = { name, source, model };
  if (typeof p.remote === "string") {
    entry.remote = p.remote;
  }
  if (typeof p.branch === "string") {
    entry.branch = p.branch;
  }
  return entry;
}

/** A farm path (absolute, or relative to the farm root) as an absolute path. */
export function resolveFarmPath(farmRoot: string, farmPath: string): string {
  return path.resolve(farmRoot, farmPath);
}

/**
 * How farm.yaml records `target`: relative to the farm root (forward slashes) when it lies
 * inside it, so a folder farm stays portable; absolute otherwise.
 */
export function farmPathFor(farmRoot: string, target: string): string {
  const root = path.resolve(farmRoot);
  const full = path.resolve(target);
  if (full === root) return ".";
  if (full.startsWith(root + path.sep)) {
    return path.relative(root, full).split(path.sep).join("/");
  }
  return full;
}

/**
 * Farm manifest data structure
 */
export interface FarmManifestData {
  schema: string; // Schema version: "dr-farm-v2" (written) or "dr-farm-v1" (read)
  name: string; // Human-readable farm name
  created?: string; // ISO 8601 timestamp
  modified?: string; // ISO 8601 timestamp
  projects: Record<string, FarmProject>; // Projects indexed by name
  platform_view?: boolean; // Optional: Enable platform view mode
  sync?: {
    track_commits?: boolean; // Optional: Track commits during sync
  };
}

/**
 * FarmManifest: loads, validates and saves farm.yaml. dr-farm-v2 is read and written; a
 * dr-farm-v1 file is read (its entries mapped to projects, `source` as `repository`) with a
 * notice, and never written until `dr farm migrate` moves it.
 */
export class FarmManifest {
  schema: string;
  name: string;
  created: string;
  modified: string;
  projects: Map<string, FarmProject>;
  platform_view?: boolean;
  sync?: {
    track_commits?: boolean;
  };
  filePath?: string;
  /** The dr-farm-v1 entries as the file held them, when the file is dr-farm-v1. */
  legacyEntries?: Map<string, LegacyFarmEntry>;

  constructor(data: FarmManifestData) {
    this.schema = data.schema;
    this.name = data.name;
    this.created = data.created ?? new Date().toISOString();
    this.modified = data.modified ?? new Date().toISOString();
    this.projects = new Map(Object.entries(data.projects || {}));
    this.platform_view = data.platform_view;
    this.sync = data.sync;
  }

  /**
   * Load farm manifest from file
   * @param filePath - Path to farm.yaml
   * @returns FarmManifest instance
   * @throws Error if manifest is malformed or projects lack required fields
   */
  static async load(filePath: string): Promise<FarmManifest> {
    const content = await readFile(filePath);
    const data = yaml.parse(content) as FarmManifestData;

    if (!data) {
      throw new Error(
        `Invalid farm manifest: file is empty or contains invalid YAML at ${filePath}`
      );
    }

    if (!data.schema) {
      throw new Error("Farm manifest must have a 'schema' field");
    }

    if (!data.name) {
      throw new Error("Farm manifest must have a 'name' field");
    }

    if (data.schema !== FARM_SCHEMA_V2 && data.schema !== FARM_SCHEMA_V1) {
      throw new Error(
        `Unsupported farm schema '${data.schema}' in ${filePath}: expected ${FARM_SCHEMA_V2} (or ${FARM_SCHEMA_V1}, read for migration)`
      );
    }

    const rawProjects = (data.projects ?? {}) as Record<string, unknown>;
    const projects: Record<string, FarmProject> = {};
    let legacyEntries: Map<string, LegacyFarmEntry> | undefined;

    // Validate each project has required fields before proceeding
    if (data.schema === FARM_SCHEMA_V1) {
      legacyEntries = new Map();
      for (const [key, project] of Object.entries(rawProjects)) {
        const entry = validateLegacyEntry(project, key);
        legacyEntries.set(key, entry);
        projects[key] = {
          name: entry.name,
          repository: entry.source,
          model: entry.model,
          ...(entry.remote !== undefined ? { remote: entry.remote } : {}),
        };
      }
    } else {
      for (const [key, project] of Object.entries(rawProjects)) {
        projects[key] = validateFarmProject(project, key);
      }
    }

    const manifest = new FarmManifest({ ...data, projects });
    manifest.filePath = filePath;
    manifest.legacyEntries = legacyEntries;
    return manifest;
  }

  /**
   * Create a new farm manifest
   * @param name - Farm name
   * @param options - Optional additional properties
   * @returns FarmManifest instance
   */
  static create(
    name: string,
    options: {
      platform_view?: boolean;
      sync?: {
        track_commits?: boolean;
      };
    } = {}
  ): FarmManifest {
    return new FarmManifest({
      schema: FARM_SCHEMA_V2,
      name,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      projects: {},
      platform_view: options.platform_view,
      sync: options.sync,
    });
  }

  /**
   * Save manifest to file
   * @param filePath - Path where to save farm.yaml
   */
  async save(filePath?: string): Promise<void> {
    const targetPath = filePath || this.filePath;
    if (!targetPath) {
      throw new Error("No file path specified for saving farm manifest");
    }
    if (this.isLegacy()) {
      throw new Error(legacyFarmNotice(this.filePath ?? targetPath));
    }

    this.modified = new Date().toISOString();
    const data = this.toJSON();
    const yamlContent = yaml.stringify(data, { lineWidth: 0 });

    await writeFile(targetPath, yamlContent);
    this.filePath = targetPath;
  }

  /** True when the file was dr-farm-v1: it is read, and refused for writing until migrated. */
  isLegacy(): boolean {
    return this.schema === FARM_SCHEMA_V1;
  }

  /** The notice to show when this farm is dr-farm-v1, else null. */
  legacyNotice(): string | null {
    return this.isLegacy() ? legacyFarmNotice(this.filePath ?? "farm.yaml") : null;
  }

  /**
   * The project whose repository is `repository` (compared as absolute paths against the farm
   * root, when the manifest has a file), or undefined.
   */
  findProjectByRepository(repository: string, farmRoot = this.farmRoot()): FarmProject | undefined {
    const wanted = farmRoot ? resolveFarmPath(farmRoot, repository) : repository;
    for (const project of this.projects.values()) {
      const held = farmRoot ? resolveFarmPath(farmRoot, project.repository) : project.repository;
      if (held === wanted) return project;
    }
    return undefined;
  }

  /** The folder farm.yaml is in, when the manifest has a file. */
  farmRoot(): string | undefined {
    return this.filePath ? path.dirname(path.resolve(this.filePath)) : undefined;
  }

  /**
   * Add a project to the farm (dr-farm-v2 entry). The key must match project.name, and a
   * repository the farm already holds is refused, naming the project that holds it.
   */
  addProject(name: string, project: FarmProject): void {
    if (project.name !== name) {
      throw new Error(
        `Project name mismatch: key is "${name}" but project.name is "${project.name}". ` +
        `They must match for consistent sync state tracking. ` +
        `Downstream code reads project.name for changeset names and sync state paths.`
      );
    }
    const holder = this.findProjectByRepository(project.repository);
    if (holder && holder.name !== name) {
      throw new Error(
        `Repository '${project.repository}' is already in the farm as project '${holder.name}'. ` +
          `A repository is one project; its worktrees are that project's checkouts.`
      );
    }

    this.projects.set(name, project);
    this.modified = new Date().toISOString();
  }

  /**
   * Remove a project from the farm
   * @param name - Project name to remove
   * @returns true if project was removed, false if not found
   */
  removeProject(name: string): boolean {
    const existed = this.projects.has(name);
    this.projects.delete(name);
    if (existed) {
      this.modified = new Date().toISOString();
    }
    return existed;
  }

  /**
   * Get a project by name
   * @param name - Project name
   * @returns Project configuration or undefined
   */
  getProject(name: string): FarmProject | undefined {
    return this.projects.get(name);
  }

  /**
   * Get all projects
   * @returns Array of all projects
   */
  getAllProjects(): FarmProject[] {
    return Array.from(this.projects.values());
  }

  /**
   * Check if platform-view is enabled on this farm
   * @returns true if platform-view is enabled
   */
  isPlatformViewEnabled(): boolean {
    return this.platform_view === true;
  }

  /**
   * Serialize to JSON representation for saving
   */
  toJSON(): FarmManifestData {
    return {
      schema: this.schema,
      name: this.name,
      created: this.created,
      modified: this.modified,
      projects: Object.fromEntries(this.projects),
      ...(this.platform_view !== undefined && { platform_view: this.platform_view }),
      ...(this.sync && { sync: this.sync }),
    };
  }
}
