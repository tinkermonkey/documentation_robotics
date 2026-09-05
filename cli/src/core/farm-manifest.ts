/**
 * Farm Manifest - Manages farm.yaml configuration
 *
 * Represents a farm context containing multiple projects with detached model folders.
 * The farm manifest tracks project registrations and their model folder locations.
 */

import yaml from "yaml";
import { readFile, writeFile } from "../utils/file-io.js";

/**
 * Represents a project registered in a farm
 */
export interface FarmProject {
  name: string;
  source: string; // Path to the codebase folder (relative to farm root)
  model: string; // Path to the model folder (relative to farm root)
  remote?: string; // Optional git remote URL
  branch?: string; // Optional git branch
}

/**
 * Farm manifest data structure
 */
export interface FarmManifestData {
  schema: string; // Schema version (e.g., "dr-farm-v1")
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
 * FarmManifest class - Load, validate, and save farm.yaml
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
   */
  static async load(filePath: string): Promise<FarmManifest> {
    const content = await readFile(filePath);
    const data = yaml.parse(content) as FarmManifestData;

    if (!data.schema) {
      throw new Error("Farm manifest must have a 'schema' field");
    }

    if (!data.name) {
      throw new Error("Farm manifest must have a 'name' field");
    }

    if (!data.projects) {
      data.projects = {};
    }

    const manifest = new FarmManifest(data);
    manifest.filePath = filePath;
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
      schema: "dr-farm-v1",
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

    this.modified = new Date().toISOString();
    const data = this.toJSON();
    const yamlContent = yaml.stringify(data, { lineWidth: 0 });

    await writeFile(targetPath, yamlContent);
    this.filePath = targetPath;
  }

  /**
   * Add a project to the farm
   * @param name - Project name
   * @param project - Project configuration
   */
  addProject(name: string, project: FarmProject): void {
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
