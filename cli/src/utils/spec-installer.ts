/**
 * Spec Reference Installer
 *
 * Manages the .dr/ folder, which stores:
 *   - The 15 compiled spec files in .dr/spec/ for agent and user access
 *   - The installed spec version in .dr/manifest.json
 *   - Changesets in .dr/changesets/
 *
 * The spec files in .dr/spec/ are the same 15 compiled JSON files bundled
 * with the CLI (manifest.json, base.json, {layer}.json x13). They are copied
 * from the CLI's bundled schemas on every install/upgrade so agents, skills,
 * and end users can read the spec directly from the project directory.
 */

import { ensureDir, writeFile } from "./file-io.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getCliBundledSpecVersion } from "./spec-version.js";
import fs from "fs/promises";
import { existsSync } from "fs";

/**
 * Resolve the directory containing the CLI's bundled compiled spec files.
 * Mirrors the logic in SpecDataLoader.getDefaultBundledDir().
 */
function getBundledSpecDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  // CLI installation: dist/utils → dist/schemas/bundled
  const installPath = join(currentDir, "..", "schemas", "bundled");
  if (existsSync(join(installPath, "manifest.json"))) {
    return installPath;
  }

  // Development monorepo: spec/dist/
  const devDistPath = join(currentDir, "../../../spec/dist");
  if (existsSync(join(devDistPath, "manifest.json"))) {
    return devDistPath;
  }

  throw new Error("Cannot find bundled spec schemas. Run 'npm run build' first.");
}

/**
 * Install or update the .dr/ spec reference folder.
 *
 * Creates:
 * - .dr/spec/            — 15 compiled spec files (manifest.json, base.json, {layer}.json x13)
 * - .dr/manifest.json    — installed spec version record
 * - .dr/changesets/      — directory for model changesets
 * - .dr/README.md        — informational readme
 *
 * @param projectRoot - Path to project root
 * @param _force - Reserved; kept for API compatibility
 */
export async function installSpecReference(
  projectRoot: string,
  _force: boolean = false
): Promise<void> {
  const drPath = join(projectRoot, ".dr");
  const specVersion = getCliBundledSpecVersion();

  await ensureDir(drPath);
  await ensureDir(join(drPath, "changesets"));

  // Copy the 15 bundled compiled spec files to .dr/spec/
  // This gives agents, skills, and end users direct file access to the spec.
  // Remove first to clear any stale files or subdirectories from old formats.
  const bundledDir = getBundledSpecDir();
  const specDestDir = join(drPath, "spec");
  await fs.rm(specDestDir, { recursive: true, force: true });
  await ensureDir(specDestDir);

  const specFiles = await fs.readdir(bundledDir);
  await Promise.all(
    specFiles
      .filter((f) => f.endsWith(".json"))
      .map((f) => fs.copyFile(join(bundledDir, f), join(specDestDir, f)))
  );

  // Write manifest.json
  const manifest = {
    specVersion: specVersion,
    installedAt: new Date().toISOString(),
  };
  await writeFile(join(drPath, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Write README.md
  const readme = `# Documentation Robotics - Spec Reference

This directory is managed by the Documentation Robotics CLI.

**Spec Version:** ${specVersion}
**Installed:** ${new Date().toISOString()}

## Structure

- \`spec/\`          — Compiled spec files (15 JSON files: manifest, base, one per layer)
- \`manifest.json\`  — Spec version information
- \`changesets/\`    — Model changesets (active and saved)

## Spec Files

The \`spec/\` directory contains the complete compiled specification:

- \`manifest.json\`  — Layer index with node type and relationship counts
- \`base.json\`      — Base schemas and predicate definitions
- \`{layer}.json\`   — One file per layer (13 total), each containing:
  - \`layer\`               — Layer metadata (id, name, description, node_types)
  - \`nodeSchemas\`         — JSON Schema definitions for all node types in the layer
  - \`relationshipSchemas\` — Flat relationship definitions for all relationships in the layer

These files are regenerated on \`dr init\` and \`dr upgrade\` to match the
current CLI version. Do not manually edit them.

This directory should be git-ignored.
`;
  await writeFile(join(drPath, "README.md"), readme);
}

/**
 * Check if spec reference needs to be installed or updated.
 *
 * Returns true if .dr/manifest.json is missing, unreadable, or records a
 * specVersion that doesn't match the CLI's bundled spec version.
 */
export async function needsSpecReferenceInstall(projectRoot: string): Promise<boolean> {
  const manifestPath = join(projectRoot, ".dr", "manifest.json");

  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as { specVersion?: string };
    return manifest.specVersion !== getCliBundledSpecVersion();
  } catch {
    return true; // manifest missing or unreadable
  }
}

/**
 * How the spec reference (.dr/spec) stands in a checkout. `.dr/` is per-checkout state that git
 * ignores, so a fresh clone or worktree has none until `dr upgrade` (or `dr init`) installs it.
 * dr itself validates against the spec it carries, never against `.dr/spec`: the reference is there
 * for agents, skills and people who read the spec files directly.
 */
export type SpecReferenceStanding =
  /** `.dr/spec` holds the spec this dr carries */
  | { state: "installed"; version: string }
  /** No `.dr/spec` here: never installed in this checkout */
  | { state: "missing" }
  /** `.dr/spec` is for another spec version (`version`), or its manifest is missing or unreadable (null) */
  | { state: "stale"; version: string | null };

export async function specReferenceStanding(projectRoot: string): Promise<SpecReferenceStanding> {
  const drPath = join(projectRoot, ".dr");
  if (!existsSync(join(drPath, "spec", "manifest.json"))) {
    return { state: "missing" };
  }
  let version: string | null = null;
  try {
    const manifest = JSON.parse(await fs.readFile(join(drPath, "manifest.json"), "utf-8")) as { specVersion?: unknown };
    version = typeof manifest.specVersion === "string" ? manifest.specVersion : null;
  } catch {
    // missing or unreadable: stale, with no version to name
  }
  return version === getCliBundledSpecVersion() ? { state: "installed", version } : { state: "stale", version };
}

/**
 * One line for the user when the spec reference isn't the one this dr carries, with the step
 * that fixes it; null when it is installed and current. Validation never depends on it, and the
 * line says so, so its absence isn't read as the cause of validation errors (#1168).
 *
 * `via` names the step for whoever reads the line: `dr upgrade` on the command line,
 * project_upgrade for an agent using the MCP tools. The MCP step previews first and applies with
 * modelOnly once the user approves: apply alone also writes .gitignore and .prettierignore lines
 * and layer reports, and either way it migrates a model that is behind the spec dr carries.
 */
export function specReferenceNotice(standing: SpecReferenceStanding, via: "cli" | "mcp" = "cli"): string | null {
  const bundled = getCliBundledSpecVersion();
  if (standing.state === "installed") return null;
  const validator = via === "cli" ? "dr" : "this server";
  if (standing.state === "missing") {
    const step =
      via === "cli"
        ? `run "dr upgrade" to install the reference for tools that read .dr/spec.`
        : `project_upgrade installs it for tools that read .dr/spec: preview it, then, once the user approves, call it with apply: true, modelOnly: true (nothing else outside the model; a model behind v${bundled} is migrated too).`;
    return (
      `Spec reference not installed in this checkout (.dr/spec is per-checkout and not committed). ` +
      `${validator} validates against the spec it carries (v${bundled}), so validation is unaffected; ${step}`
    );
  }
  const step =
    via === "cli"
      ? `Run "dr upgrade" to refresh the reference.`
      : `project_upgrade refreshes it: preview it, then, once the user approves, call it with apply: true, modelOnly: true (nothing else outside the model; a model behind v${bundled} is migrated too).`;
  return (
    `The spec reference in .dr/ is ${standing.version ? `for spec v${standing.version}` : "incomplete (no readable .dr/manifest.json)"}; ` +
    `${validator} validates against the v${bundled} it carries, so validation is unaffected. ${step}`
  );
}
