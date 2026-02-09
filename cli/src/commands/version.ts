/**
 * Version Command - Display CLI and bundled spec versions
 */

import ansis from "ansis";
import { readJSON, fileExists } from "../utils/file-io.js";
import { getCliBundledSpecVersion } from "../utils/spec-version.js";
import { isTelemetryBuiltIn } from "../telemetry/detect.js";
import { getSpecReferencePath, getModelPath } from "../utils/project-paths.js";

// Declare GIT_HASH as a build-time constant (substituted by esbuild)
declare const GIT_HASH: string;
const gitHash = typeof GIT_HASH !== "undefined" ? GIT_HASH : "unknown";

/**
 * Read CLI version from package.json
 */
async function getPackageVersion(): Promise<string> {
  const packagePath = `${import.meta.url.replace("file://", "").split("/src/")[0]}/package.json`;

  if (await fileExists(packagePath)) {
    try {
      const data = await readJSON<{ version: string }>(packagePath);
      return data.version;
    } catch {
      // Fall through to default
    }
  }

  return "0.1.0";
}

export async function versionCommand(): Promise<void> {
  const cliVersion = await getPackageVersion();
  const specVersion = getCliBundledSpecVersion();
  const telemetryEnabled = isTelemetryBuiltIn();

  console.log(ansis.bold("Documentation Robotics CLI"));
  console.log(`CLI Version:  ${ansis.cyan(cliVersion)}`);
  console.log(`Spec Version: ${ansis.cyan(specVersion)}`);
  console.log(`Git Hash:     ${ansis.cyan(gitHash)}`);
  console.log(`Telemetry:    ${telemetryEnabled ? ansis.green("enabled") : ansis.dim("disabled")}`);
  console.log(`Spec path:    ${ansis.cyan((await getSpecReferencePath()) || "Not found")}/spec`);
  console.log(`Model path:   ${ansis.cyan((await getModelPath()) || "Not found")}`);
}
