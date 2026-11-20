/**
 * Says when a project's large-file commit hook would refuse the files dr writes.
 *
 * dr writes a changeset's `changes.yaml` whole, and a bootstrap's runs to several MB; a model's
 * larger element files reach hundreds of KB. A project with pre-commit's
 * `check-added-large-files` hook (default limit 500 KB) refuses to commit a new file over its
 * limit, and the first the user hears of it is a refused commit after the work is done. `dr init`,
 * `dr upgrade` and their MCP tools call {@link largeFileHook} and pass its note on. dr never edits
 * the hook configuration: the user decides whether to exclude the folder or raise the limit.
 */

import { spawnSync } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

/** pre-commit's default for `check-added-large-files` when `--maxkb` isn't given */
const DEFAULT_LIMIT_KB = 500;

const HOOK_ID = "check-added-large-files";
const CONFIG_FILE = ".pre-commit-config.yaml";
const PROJECT_FOLDER = "documentation-robotics";

export interface LargeFileHook {
  /** The `.pre-commit-config.yaml` that has the hook */
  configPath: string;
  limitKb: number;
  /** The folder dr writes, as the hook sees it (relative to the config's folder) */
  folder: string;
  /** The hook (or the config) excludes dr's changesets folder, so its files are never checked */
  excludesChangesets: boolean;
  /** The hook (or the config) excludes dr's model folder */
  excludesModel: boolean;
  /** Files dr wrote that are over the limit now and not excluded, largest first */
  overLimit: Array<{ path: string; kb: number }>;
}

/** The git repository root containing a folder, or null outside git (or without git). */
function gitTopLevel(folder: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: folder,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * A pre-commit `exclude` pattern (a Python regular expression, matched with `re.search`) as a
 * JavaScript one. Handles the verbose form (`(?x)`) pre-commit configs often use; null when the
 * pattern doesn't translate, which callers treat as excluding nothing.
 */
export function excludePattern(pattern: unknown): RegExp | null {
  if (typeof pattern !== "string" || pattern.trim() === "") return null;
  let source = pattern;
  if (/^\(\?x\)/.test(source.trim())) {
    source = source
      .trim()
      .replace(/^\(\?x\)/, "")
      .split("\n")
      .map((line) => line.replace(/(^|[^\\])#.*$/, "$1"))
      .join("")
      .replace(/\s+/g, "");
  }
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

/** `--maxkb=1000` or `--maxkb 1000` in a hook's args */
function limitFrom(args: unknown): number {
  if (!Array.isArray(args)) return DEFAULT_LIMIT_KB;
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    const inline = /^--maxkb=(\d+)$/.exec(arg);
    if (inline) return Number(inline[1]);
    if (arg === "--maxkb" && /^\d+$/.test(String(args[i + 1] ?? ""))) return Number(args[i + 1]);
  }
  return DEFAULT_LIMIT_KB;
}

/** Every file under a folder with its size, by path relative to `root`; empty when the folder is missing. */
async function fileSizes(root: string, folder: string): Promise<Array<{ path: string; bytes: number }>> {
  let entries;
  try {
    entries = await readdir(path.join(root, folder), { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const sizes: Array<{ path: string; bytes: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    try {
      sizes.push({ path: path.relative(root, file).split(path.sep).join("/"), bytes: (await stat(file)).size });
    } catch {
      // gone since the listing
    }
  }
  return sizes;
}

/**
 * The project's `check-added-large-files` pre-commit hook and how it stands with the files dr
 * writes; null when there is no such hook (or no readable pre-commit config). Looks at the git
 * repository root, where pre-commit reads its config, else at the project root.
 */
export async function largeFileHook(projectRoot: string): Promise<LargeFileHook | null> {
  const project = await realpath(path.resolve(projectRoot)).catch(() => path.resolve(projectRoot));
  const topLevel = gitTopLevel(project);
  const repo = topLevel ? await realpath(topLevel).catch(() => topLevel) : project;
  const inRepo = path.relative(repo, project);
  const root = inRepo.startsWith("..") || path.isAbsolute(inRepo) ? project : repo;

  const configPath = path.join(root, CONFIG_FILE);
  let config: unknown;
  try {
    config = yaml.parse(await readFile(configPath, "utf-8"));
  } catch {
    return null;
  }
  const repos = (config as { repos?: unknown })?.repos;
  if (!Array.isArray(repos)) return null;

  let hook: { args?: unknown; exclude?: unknown } | undefined;
  for (const entry of repos) {
    const hooks = (entry as { hooks?: unknown })?.hooks;
    if (!Array.isArray(hooks)) continue;
    hook = hooks.find((candidate) => (candidate as { id?: unknown })?.id === HOOK_ID) as typeof hook;
    if (hook) break;
  }
  if (!hook) return null;

  const folder = path.join(path.relative(root, project), PROJECT_FOLDER).split(path.sep).join("/");
  const excludes = [excludePattern(hook.exclude), excludePattern((config as { exclude?: unknown }).exclude)].filter(
    (pattern): pattern is RegExp => pattern !== null
  );
  const excluded = (file: string) => excludes.some((pattern) => pattern.test(file));
  const limitKb = limitFrom(hook.args);

  const overLimit = (await fileSizes(root, folder))
    .filter((file) => file.bytes > limitKb * 1024 && !excluded(file.path))
    .map((file) => ({ path: file.path, kb: Math.round(file.bytes / 1024) }))
    .sort((a, b) => b.kb - a.kb);

  return {
    configPath,
    limitKb,
    folder,
    excludesChangesets: excluded(`${folder}/changesets/changeset-0/changes.yaml`),
    excludesModel: excluded(`${folder}/model/01_motivation/goal.yaml`),
    overLimit,
  };
}

/**
 * What to tell the user about the hook, or null when there is nothing to say: no hook, or the
 * changesets folder (whose files grow largest) is excluded and no file dr wrote is over the limit.
 * dr changes nothing: the note says what to add.
 */
export function largeFileHookNote(hook: LargeFileHook | null): string | null {
  if (!hook || (hook.excludesChangesets && hook.overLimit.length === 0)) return null;

  const now =
    hook.overLimit.length > 0
      ? ` Over the limit now: ${hook.overLimit
          .slice(0, 3)
          .map((file) => `${file.path} (${file.kb} KB)`)
          .join(", ")}${hook.overLimit.length > 3 ? `, and ${hook.overLimit.length - 3} more` : ""}.`
      : "";
  const folder = hook.excludesChangesets ? `${hook.folder}/model/` : `${hook.folder}/changesets/`;
  return (
    `This repository's ${HOOK_ID} pre-commit hook refuses a new file over ${hook.limitKb} KB. ` +
    (hook.excludesChangesets
      ? "dr writes each element type's file whole, and a large model's can pass that."
      : "dr writes a changeset's changes.yaml whole, and a bootstrap's runs to several MB, so the commit that adds one can be refused.") +
    now +
    ` dr does not edit hook configuration: to let these files through, add an exclude for ${folder} to that hook in ${hook.configPath} ` +
    `(exclude: ^${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}), or raise --maxkb.`
  );
}
