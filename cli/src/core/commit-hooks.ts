/**
 * Says when a project's pre-commit hooks would get in the way of committing the files dr writes.
 *
 * Two hooks do, and the first the user hears of either is a refused commit after the work is done:
 *
 * - `check-added-large-files` (default limit 500 KB) refuses a new file over its limit. dr writes
 *   a changeset's `changes.yaml` whole, and a bootstrap's runs to several MB; a model's larger
 *   element files reach hundreds of KB.
 * - A prettier hook is passed the files dr writes unless its `exclude` covers the DR folder.
 *   `.prettierignore` (prettier-ignore.ts) keeps prettier from reformatting them, but it does not
 *   stop pre-commit handing them over, and a commit that holds only ignored files can fail the hook
 *   because prettier finds nothing to format.
 *
 * `dr init`, `dr upgrade` and their MCP tools call {@link commitHookNotes} and pass the notes on.
 * dr never edits the hook configuration: the user decides, and each note gives the line to add.
 */

import { spawnSync } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

/** How many over-limit files the note names by default; `overLimit` holds them all */
const OVER_LIMIT_NAMED = 3;

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

interface PreCommitHook {
  id?: unknown;
  entry?: unknown;
  args?: unknown;
  exclude?: unknown;
  files?: unknown;
}

interface PreCommitConfig {
  /** The folder pre-commit runs in: the git repository root, else the project root */
  root: string;
  /** The project root, with symlinks resolved */
  project: string;
  configPath: string;
  config: { repos?: unknown; exclude?: unknown; files?: unknown };
}

/**
 * The project's `.pre-commit-config.yaml`, parsed; null when there is none or it can't be read.
 * Looks at the git repository root, where pre-commit reads its config, else at the project root.
 */
async function readPreCommitConfig(projectRoot: string): Promise<PreCommitConfig | null> {
  const project = await realpath(path.resolve(projectRoot)).catch(() => path.resolve(projectRoot));
  const topLevel = gitTopLevel(project);
  const repo = topLevel ? await realpath(topLevel).catch(() => topLevel) : project;
  const inRepo = path.relative(repo, project);
  const root = inRepo.startsWith("..") || path.isAbsolute(inRepo) ? project : repo;

  const configPath = path.join(root, CONFIG_FILE);
  try {
    const config = yaml.parse(await readFile(configPath, "utf-8"));
    if (!config || typeof config !== "object" || !Array.isArray((config as { repos?: unknown }).repos)) return null;
    return { root, project, configPath, config };
  } catch {
    return null;
  }
}

/** The first hook in the config that the test accepts, with its repository's URL */
function findHook(
  config: PreCommitConfig["config"],
  accept: (hook: PreCommitHook, repoUrl: string) => boolean
): PreCommitHook | undefined {
  for (const entry of config.repos as unknown[]) {
    const { repo, hooks } = (entry ?? {}) as { repo?: unknown; hooks?: unknown };
    if (!Array.isArray(hooks)) continue;
    const found = hooks.find((candidate) => candidate && typeof candidate === "object" && accept(candidate, String(repo ?? "")));
    if (found) return found as PreCommitHook;
  }
  return undefined;
}

/**
 * Whether pre-commit would leave a file out of a hook's run: the hook's or the config's `exclude`
 * matches it, or a `files` pattern is set and does not.
 */
function hookSkips(config: PreCommitConfig["config"], hook: PreCommitHook, file: string): boolean {
  const matches = (pattern: unknown) => excludePattern(pattern)?.test(file) ?? false;
  if (matches(hook.exclude) || matches(config.exclude)) return true;
  const limitedTo = [hook.files, config.files].map(excludePattern).filter((pattern): pattern is RegExp => pattern !== null);
  return limitedTo.some((pattern) => !pattern.test(file));
}

/**
 * The project's `check-added-large-files` pre-commit hook and how it stands with the files dr
 * writes; null when there is no such hook (or no readable pre-commit config). Looks at the git
 * repository root, where pre-commit reads its config, else at the project root.
 */
export async function largeFileHook(projectRoot: string): Promise<LargeFileHook | null> {
  const found = await readPreCommitConfig(projectRoot);
  if (!found) return null;
  const { root, project, configPath, config } = found;

  const hook = findHook(config, (candidate) => candidate.id === HOOK_ID);
  if (!hook) return null;

  const folder = path.join(path.relative(root, project), PROJECT_FOLDER).split(path.sep).join("/");
  const excluded = (file: string) => hookSkips(config, hook, file);
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
export function largeFileHookNote(hook: LargeFileHook | null, options: { full?: boolean } = {}): string | null {
  if (!hook || (hook.excludesChangesets && hook.overLimit.length === 0)) return null;

  // The count is of every file over the limit; the largest few are named unless all are asked for
  const named = options.full ? hook.overLimit : hook.overLimit.slice(0, OVER_LIMIT_NAMED);
  const now =
    hook.overLimit.length > 0
      ? ` ${hook.overLimit.length} file(s) over the limit now, largest first: ${named
          .map((file) => `${file.path} (${file.kb} KB)`)
          .join(", ")}${hook.overLimit.length > named.length ? `, and ${hook.overLimit.length - named.length} more` : ""}.`
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

export interface PrettierHook {
  /** The `.pre-commit-config.yaml` that has the hook */
  configPath: string;
  /** The folder dr writes, as the hook sees it (relative to the config's folder) */
  folder: string;
  /** pre-commit never passes the hook a file dr writes: its `exclude` (or `files`) rules them out */
  skipsDrFiles: boolean;
}

/** The files dr writes that a prettier hook formats: one of each kind, as paths under the DR folder */
const DR_FILE_SAMPLES = ["model/01_motivation/goal.yaml", "changesets/changeset-0/changes.yaml", "README.md"];

/**
 * The project's prettier pre-commit hook (found by repository URL, hook id or entry) and whether
 * pre-commit keeps the files dr writes away from it; null when there is no such hook.
 */
export async function prettierHook(projectRoot: string): Promise<PrettierHook | null> {
  const found = await readPreCommitConfig(projectRoot);
  if (!found) return null;
  const { root, project, configPath, config } = found;

  const hook = findHook(
    config,
    (candidate, repoUrl) =>
      /prettier/i.test(repoUrl) ||
      (typeof candidate.id === "string" && /prettier/i.test(candidate.id)) ||
      (typeof candidate.entry === "string" && /prettier/i.test(candidate.entry))
  );
  if (!hook) return null;

  const folder = path.join(path.relative(root, project), PROJECT_FOLDER).split(path.sep).join("/");
  return {
    configPath,
    folder,
    skipsDrFiles: DR_FILE_SAMPLES.every((sample) => hookSkips(config, hook, `${folder}/${sample}`)),
  };
}

/**
 * What to tell the user about the prettier hook, or null when there is none or it never sees a
 * file dr writes. dr changes nothing: the note gives the line to add.
 */
export function prettierHookNote(hook: PrettierHook | null): string | null {
  if (!hook || hook.skipsDrFiles) return null;
  const folder = `${hook.folder}/`;
  return (
    `This repository's prettier pre-commit hook is passed the files dr writes under ${folder}. ` +
    `.prettierignore keeps prettier from reformatting them, but a commit that holds only those files can then fail the hook, because prettier finds nothing to format. ` +
    `dr does not edit hook configuration: add the folder to that hook's exclude in ${hook.configPath} ` +
    `(exclude: ^${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}), joined with any pattern it already has.`
  );
}

/**
 * Every note about the project's commit hooks and the files dr writes: the prettier hook, then the
 * large-file hook. Empty when neither would get in the way. A config that can't be read says
 * nothing: the notes are advice.
 *
 * @param options.full - name every file over the large-file limit, not only the largest
 */
export async function commitHookNotes(projectRoot: string, options: { full?: boolean } = {}): Promise<string[]> {
  const notes: string[] = [];
  try {
    const prettier = prettierHookNote(await prettierHook(projectRoot));
    if (prettier) notes.push(prettier);
    const largeFiles = largeFileHookNote(await largeFileHook(projectRoot), options);
    if (largeFiles) notes.push(largeFiles);
  } catch {
    // advice only
  }
  return notes;
}
