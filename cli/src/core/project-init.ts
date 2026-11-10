/**
 * Project init - creates an empty model at the CLI's spec version in a folder.
 *
 * Shared by `dr init` (which gathers the name and the rest by prompting) and the
 * `project_init` MCP tool (which takes them as arguments). Neither installs per-project
 * integration files: `dr claude install` and the Claude Code plugin do that.
 */

import { join } from "path";
import { Model } from "./model.js";
import { fileExists } from "../utils/file-io.js";
import { logVerbose as globalLogVerbose, logDebug as globalLogDebug } from "../utils/globals.js";
import { installSpecReference } from "../utils/spec-installer.js";
import { getCliBundledSpecVersion } from "../utils/spec-version.js";
import { getErrorMessage } from "../utils/errors.js";
import { regenerateLayerReports } from "../commands/reports.js";

export interface ProjectInitOptions {
  name: string;
  description?: string;
  author?: string;
  /** Where progress lines go; `dr init` prints them, the MCP server must not write stdout. */
  log?: (message: string) => void;
  /** Where --verbose lines go (default: stdout when verbose is on). */
  logVerbose?: (message: string) => void;
  /** Where --debug lines go (default: console.debug when debug is on). */
  logDebug?: (message: string) => void;
}

export interface ProjectInitResult {
  rootPath: string;
  modelPath: string;
  name: string;
  version: string;
  specVersion: string;
  /** Set when the model was created but its layer reports and README could not be generated. */
  reportError?: string;
}

/** The manifest path of the model in a folder (not searching parent folders). */
export function modelManifestPath(rootPath: string): string {
  return join(rootPath, "documentation-robotics", "model", "manifest.yaml");
}

/** Whether the folder already holds a model. */
export async function hasModel(rootPath: string): Promise<boolean> {
  return fileExists(modelManifestPath(rootPath));
}

/**
 * Create the model in rootPath, install the spec reference (.dr/) and generate the layer
 * reports and README. Throws when the folder already has a model. A report failure doesn't
 * fail the init: it comes back as reportError.
 */
export async function initProject(rootPath: string, options: ProjectInitOptions): Promise<ProjectInitResult> {
  if (await hasModel(rootPath)) {
    throw new Error(`A model already exists in ${rootPath}`);
  }

  const logVerbose = options.logVerbose ?? globalLogVerbose;
  const logDebug = options.logDebug ?? globalLogDebug;
  const specVersion = getCliBundledSpecVersion();
  const modelPath = join(rootPath, "documentation-robotics", "model");

  logDebug(`Creating model directory at ${rootPath}/documentation-robotics/model`);
  const model = await Model.init(
    rootPath,
    {
      name: options.name,
      version: "0.1.0",
      description: options.description || undefined,
      author: options.author || undefined,
      specVersion,
      created: new Date().toISOString(),
    },
    { lazyLoad: false }
  );

  logVerbose(`Model saved with:
  - Version: 0.1.0
  - Spec Version: ${specVersion}
  - Location: ${rootPath}/documentation-robotics/model`);

  logDebug("Installing spec reference (.dr/ folder)...");
  await installSpecReference(rootPath, false);
  logVerbose("Spec reference installed");

  let reportError: string | undefined;
  logDebug("Generating reports and README...");
  try {
    await regenerateLayerReports(rootPath, options.log);
    logVerbose("Reports and README generated");
  } catch (error) {
    reportError = getErrorMessage(error);
    logDebug(`Report generation failed (non-fatal): ${reportError}`);
  }

  return {
    rootPath,
    modelPath,
    name: model.manifest.name,
    version: "0.1.0",
    specVersion,
    ...(reportError !== undefined ? { reportError } : {}),
  };
}
