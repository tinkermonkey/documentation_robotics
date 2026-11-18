/**
 * Keeps prettier away from a project's changeset files.
 *
 * dr writes `documentation-robotics/changesets/` (changes.yaml, metadata.yaml, base-index.json) in
 * its own layout and rewrites them on every staging call. In a project that runs prettier (often as
 * a pre-commit hook), prettier reformats them, so every commit that touches a changeset fails once
 * and the working tree mixes the two layouts (#1155). Matching prettier's YAML layout isn't
 * practical, so `dr init`, `dr upgrade` and their MCP tools call
 * {@link ensurePrettierIgnoresChangesets}, which lists the folder in `.prettierignore` when the
 * project uses prettier.
 *
 * prettier reads `.prettierignore` from its working directory, which for hooks and CI is usually
 * the repository root. So the file is written at the git repository root when prettier is
 * configured there, else at the project root (the folder holding `documentation-robotics/`), and
 * the entry is relative to the folder the file is in.
 */

import { spawnSync } from "node:child_process";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

/** The changeset folder, relative to the project root. */
export const CHANGESETS_FOLDER = "documentation-robotics/changesets";

/** The comment DR writes above the line it adds. */
const HEADING = "# Documentation Robotics: dr writes its changeset files in its own layout";

/** prettier's config file names (https://prettier.io/docs/configuration). */
const CONFIG_FILE = /^(\.prettierrc(\.(json|json5|ya?ml|toml|[cm]?[jt]s))?|prettier\.config\.[cm]?[jt]s)$/;

export interface PrettierIgnoreResult {
  /**
   * `added`: this call appended the entry (creating the file when needed); `present`: the file
   * already ignores the folder (the entry or a parent folder); `not-using-prettier`: no sign of
   * prettier at the project or repository root, nothing written.
   */
  status: "added" | "present" | "not-using-prettier";
  /** The `.prettierignore` written or checked; unset when the project doesn't use prettier. */
  path?: string;
  /** The changeset folder as the ignore file names it, relative to the file's folder. */
  entry?: string;
  /** What showed prettier is in use, e.g. `.prettierrc.json`, `package.json devDependencies`. */
  signals: string[];
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

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The signs in one folder that prettier is in use there. */
export async function prettierSignals(folder: string): Promise<string[]> {
  const signals: string[] = [];

  const names = await readdir(folder).catch(() => [] as string[]);
  signals.push(...names.filter((name) => CONFIG_FILE.test(name)).sort());

  const pkgText = await readText(path.join(folder, "package.json"));
  if (pkgText !== null) {
    try {
      const pkg = JSON.parse(pkgText) as Record<string, unknown>;
      if (pkg.prettier !== undefined) signals.push("package.json prettier");
      for (const field of ["dependencies", "devDependencies"]) {
        const deps = pkg[field];
        if (deps && typeof deps === "object" && "prettier" in deps) signals.push(`package.json ${field}`);
      }
    } catch {
      // An unparseable package.json says nothing about prettier.
    }
  }

  const preCommit = await readText(path.join(folder, ".pre-commit-config.yaml"));
  if (preCommit !== null && preCommitRunsPrettier(preCommit)) signals.push(".pre-commit-config.yaml");

  return signals;
}

/** Whether a `.pre-commit-config.yaml` has a prettier hook (by repo URL or hook id). */
function preCommitRunsPrettier(text: string): boolean {
  let config: unknown;
  try {
    config = yaml.parse(text);
  } catch {
    // Unparseable: fall back to an uncommented mention.
    return text.split(/\r?\n/).some((line) => !line.trim().startsWith("#") && /prettier/i.test(line));
  }
  const repos = (config as { repos?: unknown })?.repos;
  if (!Array.isArray(repos)) return false;
  return repos.some((repo) => {
    if (!repo || typeof repo !== "object") return false;
    const { repo: url, hooks } = repo as { repo?: unknown; hooks?: unknown };
    if (typeof url === "string" && /prettier/i.test(url)) return true;
    return (
      Array.isArray(hooks) &&
      hooks.some((hook) => {
        const { id, entry } = (hook ?? {}) as { id?: unknown; entry?: unknown };
        return (typeof id === "string" && /prettier/i.test(id)) || (typeof entry === "string" && /prettier/i.test(entry));
      })
    );
  });
}

/** A `.prettierignore` pattern as a folder path: no anchor, no trailing slash or `/**`. */
function patternFolder(line: string): string {
  return line
    .replace(/^\/+/, "")
    .replace(/(\/\*\*?)+$/, "")
    .replace(/\/+$/, "");
}

/** Whether a pattern ignores the folder: names it or a folder above it. */
function covers(line: string, folder: string): boolean {
  const pattern = patternFolder(line);
  return pattern !== "" && (pattern === folder || folder.startsWith(`${pattern}/`));
}

/**
 * List the project's changeset folder in `.prettierignore` when the project uses prettier. Looks
 * for prettier at the git repository root (when the project is in one) and at the project root,
 * writes at the first that has it, and appends `<relative path>/documentation-robotics/changesets/`
 * unless a line already ignores that folder or a folder above it. Never removes or rewrites the
 * developer's lines.
 */
export async function ensurePrettierIgnoresChangesets(projectRoot: string): Promise<PrettierIgnoreResult> {
  const project = path.resolve(projectRoot);
  // git prints the repository root with symlinks resolved (macOS /var is /private/var), so the
  // project's place in the repository is worked out on resolved paths.
  const resolvedProject = await realpath(project).catch(() => project);
  const topLevel = gitTopLevel(project);
  const repo = topLevel ? await realpath(topLevel).catch(() => topLevel) : null;
  const inRepo = repo !== null ? path.relative(repo, resolvedProject) : "";

  // The repository root first: hooks and CI run prettier from there.
  const roots =
    repo && inRepo !== "" && !inRepo.startsWith("..") && !path.isAbsolute(inRepo)
      ? [
          { root: repo, folder: path.join(inRepo, CHANGESETS_FOLDER) },
          { root: project, folder: CHANGESETS_FOLDER },
        ]
      : [{ root: project, folder: CHANGESETS_FOLDER }];
  let chosen: { root: string; folder: string } | undefined;
  let signals: string[] = [];
  for (const candidate of roots) {
    signals = await prettierSignals(candidate.root);
    if (signals.length > 0) {
      chosen = candidate;
      break;
    }
  }
  if (!chosen) return { status: "not-using-prettier", signals: [] };
  const root = chosen.root;

  const folder = chosen.folder.split(path.sep).join("/");
  const entry = `${folder}/`;
  const file = path.join(root, ".prettierignore");
  const text = (await readText(file)) ?? "";

  const present = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line && !line.startsWith("#") && !line.startsWith("!") && covers(line, folder));
  if (present) return { status: "present", path: file, entry, signals };

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const separator = text === "" || text.endsWith(`${eol}${eol}`) ? "" : text.endsWith(eol) ? eol : `${eol}${eol}`;
  await writeFile(file, `${text}${separator}${HEADING}${eol}${entry}${eol}`, "utf-8");
  return { status: "added", path: file, entry, signals };
}

/** One line for the user when the call added the entry, else null. */
export function prettierIgnoreNote(result: PrettierIgnoreResult): string | null {
  if (result.status !== "added") return null;
  return `Added ${result.entry} to ${result.path} so prettier doesn't reformat dr's changeset files (commit the .prettierignore change)`;
}
