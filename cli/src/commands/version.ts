/**
 * Version Command - Display CLI and bundled spec versions
 */

import ansis from "ansis";
import { getCliBundledSpecVersion, getCliVersion } from "../utils/spec-version.js";
import { isTelemetryBuiltIn, isTelemetryConfigured } from "../telemetry/detect.js";
import { getSpecReferencePath, getModelPath } from "../utils/project-paths.js";

// Declare build-time constant (substituted by esbuild)
declare const GIT_HASH: string;

const gitHash = typeof GIT_HASH !== "undefined" ? GIT_HASH : "unknown";
const cliVersion = getCliVersion();

export async function versionCommand(): Promise<void> {
  const specVersion = getCliBundledSpecVersion();
  const telemetryBuiltIn = isTelemetryBuiltIn();
  const telemetryConfigured = await isTelemetryConfigured();

  // Determine telemetry status message
  let telemetryStatus: string;
  if (!telemetryBuiltIn) {
    telemetryStatus = ansis.dim("not available (build)");
  } else if (telemetryConfigured) {
    telemetryStatus = ansis.green("enabled, configured");
  } else {
    telemetryStatus = ansis.yellow("enabled, not configured");
  }

  console.log(ansis.bold("Documentation Robotics CLI"));
  console.log(`CLI Version:  ${ansis.cyan(cliVersion)}`);
  console.log(`Spec Version: ${ansis.cyan(specVersion)}`);
  console.log(`Git Hash:     ${ansis.cyan(gitHash)}`);
  console.log(`Telemetry:    ${telemetryStatus}`);
  console.log(`Spec source:  ${ansis.cyan("bundled with CLI")}`);
  const drFolder = await getSpecReferencePath();
  console.log(`DR folder:    ${ansis.cyan(drFolder || "Not found")}`);
  console.log(`Model path:   ${ansis.cyan((await getModelPath()) || "Not found")}`);
}
