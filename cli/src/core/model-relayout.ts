/**
 * Lay a model's element files out as dr writes them, data unchanged (#1439).
 *
 * dr's layout (`stringifyDrYaml`, dr-yaml.ts) keeps each long string on its key's line and quotes
 * as prettier does (#1246). A file an earlier dr wrote (long strings folded at 80 columns) or
 * prettier laid out settles into it the first time dr writes a data change to it, so that landing
 * mixes its change with a re-layout of the whole file: a 35-change plan became a 7,000-line diff.
 * project_upgrade with relayout: true and `dr upgrade --relayout` run relayoutModelFiles as a step of
 * its own, previewed with dryRun, so it is committed apart and later landings carry only their own
 * changes; without it an upgrade only counts the files, since it writes no model file whose data
 * does not change. Until then, changeset_commit_preview names the files a landing would re-lay out
 * (filesALandingRelaysOut).
 *
 * Only the element files (`documentation-robotics/model/NN_layer/*.yaml`) are rewritten: dr writes
 * the manifest and relationships.yaml whole on every change. A file is only rewritten when its
 * new text parses to the same data, as YAML reads it: comments are dropped (as any dr write of the
 * file drops them), and a value YAML reads as a number is written as that number.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import yaml from "yaml";
import { stringifyDrYaml } from "./dr-yaml.js";
import { typeToSnakeStem } from "./model.js";
import type { Change } from "./changeset.js";

const LAYER_FOLDER = /^\d{2}_/;
const YAML_FILE = /\.ya?ml$/;

export interface RelayoutResult {
  /** Element files looked at */
  total: number;
  /** Element files not in dr's layout (re-laid out unless dryRun), relative to the project root, in order */
  files: string[];
  /** Files left alone because they don't parse, or because re-laying them out would change their data */
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * The text dr would write for a file, with the data it holds; why it is left alone; or null when it
 * is already in dr's layout. Data is as YAML reads it: comments are not data, and a value YAML reads
 * as a number is written as that number (`1.10` becomes `1.1`). `stringify` is dr's writer.
 */
export function relaidOut(
  text: string,
  stringify: (value: unknown) => string = stringifyDrYaml
): { text: string; data: unknown } | { skip: string } | null {
  let data: unknown;
  try {
    data = yaml.parse(text);
  } catch (error) {
    return { skip: `it does not parse: ${error instanceof Error ? error.message : String(error)}` };
  }
  // An empty or comment-only file has nothing to lay out
  if (data === null || data === undefined) return null;
  const next = stringify(data);
  if (next === text) return null;
  if (!isDeepStrictEqual(yaml.parse(next), data)) return { skip: "re-laying it out would change its data" };
  return { text: next, data };
}

async function layerFolders(modelDir: string): Promise<string[]> {
  try {
    const entries = await readdir(modelDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && LAYER_FOLDER.test(entry.name)).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Re-lays out every element file of the model at projectRoot that is not in dr's layout, or with
 * dryRun only lists them.
 */
export async function relayoutModelFiles(projectRoot: string, options: { dryRun?: boolean } = {}): Promise<RelayoutResult> {
  const modelDir = join(projectRoot, "documentation-robotics", "model");
  const result: RelayoutResult = { total: 0, files: [], skipped: [] };
  for (const folder of await layerFolders(modelDir)) {
    for (const name of (await readdir(join(modelDir, folder))).sort()) {
      if (!YAML_FILE.test(name)) continue;
      const file = join(modelDir, folder, name);
      const shown = relative(projectRoot, file);
      result.total++;
      const outcome = relaidOut(await readFile(file, "utf-8"));
      if (!outcome) continue;
      if ("skip" in outcome) {
        result.skipped.push({ file: shown, reason: outcome.skip });
        continue;
      }
      result.files.push(shown);
      if (!options.dryRun) await writeFile(file, outcome.text, "utf-8");
    }
  }
  return result;
}

/**
 * The element files a landing of these changes writes that are not in dr's layout, relative to
 * the project root: each file holding an element the changes add, update or delete, and the file
 * of each type they add an element of. Writing a data change to one lays the whole file out anew.
 */
export async function filesALandingRelaysOut(projectRoot: string, changes: readonly Change[]): Promise<string[]> {
  const touched = new Map<string, { ids: Set<string>; files: Set<string> }>();
  for (const change of changes) {
    if (change.type !== "add" && change.type !== "update" && change.type !== "delete") continue;
    const layer = touched.get(change.layerName) ?? { ids: new Set<string>(), files: new Set<string>() };
    touched.set(change.layerName, layer);
    layer.ids.add(change.elementId);
    for (const side of [change.before, change.after]) {
      if (!side) continue;
      for (const key of ["id", "path"] as const) if (typeof side[key] === "string") layer.ids.add(side[key] as string);
      if (typeof side.type === "string") {
        const specNodeId = typeof side.spec_node_id === "string" ? side.spec_node_id : undefined;
        layer.files.add(`${typeToSnakeStem(specNodeId, side.type)}.yaml`);
      }
    }
  }
  if (touched.size === 0) return [];

  const modelDir = join(projectRoot, "documentation-robotics", "model");
  const out: string[] = [];
  for (const folder of await layerFolders(modelDir)) {
    const layer = touched.get(folder.replace(LAYER_FOLDER, ""));
    if (!layer) continue;
    for (const name of (await readdir(join(modelDir, folder))).sort()) {
      if (!YAML_FILE.test(name)) continue;
      const file = join(modelDir, folder, name);
      const outcome = relaidOut(await readFile(file, "utf-8"));
      if (!outcome || "skip" in outcome) continue;
      if (layer.files.has(name) || holdsAny(outcome.data, layer.ids)) out.push(relative(projectRoot, file));
    }
  }
  return out;
}

/** Whether a layer file's data holds an element named by any of these ids (its key, id or path). */
function holdsAny(data: unknown, ids: Set<string>): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.entries(data).some(([key, value]) => {
    if (ids.has(key)) return true;
    if (!value || typeof value !== "object") return false;
    const { id, path } = value as { id?: unknown; path?: unknown };
    return (typeof id === "string" && ids.has(id)) || (typeof path === "string" && ids.has(path));
  });
}

/** How many files the landing note names before counting the rest. */
const LANDING_FILES_NAMED = 5;

/**
 * The landing summary's line about the files a landing of these changes would re-lay out, or
 * null when it re-lays out none.
 */
export async function landingRelayoutNote(projectRoot: string, changes: readonly Change[]): Promise<string | null> {
  const files = await filesALandingRelaysOut(projectRoot, changes);
  if (files.length === 0) return null;
  const named = files.slice(0, LANDING_FILES_NAMED).join(", ");
  const rest = files.length > LANDING_FILES_NAMED ? `, and ${files.length - LANDING_FILES_NAMED} more` : "";
  return (
    `Layout: landing this also lays out ${files.length} model file(s) an earlier dr wrote (long strings folded at ` +
    `80 columns) as this dr writes them, data unchanged: ${named}${rest}. Its diff will show every line of them. ` +
    "Run the relayout first, on its own: project_upgrade with relayout: true (preview, then apply with the user's " +
    "approval; dr upgrade --relayout in a terminal), and commit it apart from this plan, so the plan's pull request " +
    "shows only its own changes."
  );
}
